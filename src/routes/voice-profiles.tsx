import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { getDB } from "@/lib/rah/db";
import { useRah } from "@/lib/rah/context";
import { shouldConfirmDiscard } from "@/lib/rah/draftGuard";
import { isSpeechSupported, createRecognizer, queryPermission } from "@/lib/rah/speech";
import {
  GLOBAL_PROFILE_ID,
  VOICE_PROFILES_SCHEMA_VERSION,
  ALLOWED_COMMAND_CATEGORIES,
  normalizeProfile,
  buildGlobalDefaultProfile,
  resolveProfileForProject,
  matchWakePhrase,
  buildTranscriptReview,
  proposeVoiceCommand,
  buildConfirmationView,
  buildReadinessSummary,
  shapeHistoryForExport,
  filterVoiceHistory,
  isProfileDraftDirty,
  isReviewDraftDirty,
  shapeProfileForExport,
  validateProfileImport,
  planProfileMerge,
  buildCleanupPrompt,
  isCleanupSuspicious,
  type VoiceProfile,
  type VoiceTranscriptReview,
  type VoiceCommandProposalTop,
} from "@/lib/rah/voiceProfiles";
import { streamChat } from "@/lib/rah/ai";
import { Mic, Save, Trash2, Play, Radio, Download, Upload, Check, X, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/voice-profiles")({
  head: () => ({ meta: [
    { title: "Voice Profiles — Raven Command" },
    { name: "description", content: "Per-project voice profiles, wake-phrase tuning, and approval-safe voice commands." },
  ]}),
  component: VoiceProfilesPage,
});

function VoiceProfilesPage() {
  const rah = useRah();
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string>(GLOBAL_PROFILE_ID);
  const [draft, setDraft] = useState<VoiceProfile | null>(null);
  const [baseline, setBaseline] = useState<VoiceProfile | null>(null);

  const [transcripts, setTranscripts] = useState<VoiceTranscriptReview[]>([]);
  const [review, setReview] = useState<VoiceTranscriptReview | null>(null);
  const [proposal, setProposal] = useState<ReturnType<typeof proposeVoiceCommand> | null>(null);

  const [wakeInput, setWakeInput] = useState("");
  const [micPerm, setMicPerm] = useState<string>("unknown");
  const [supported] = useState(() => isSpeechSupported());
  const [historyQuery, setHistoryQuery] = useState<{ status?: string; q?: string }>({});
  const [pttActive, setPttActive] = useState(false);
  const recRef = useRef<any>(null);
  const bufRef = useRef<string>("");

  // ─── Load ───────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    const db = await getDB();
    const all = (await db.getAll("voiceProfiles")) as VoiceProfile[];
    const withGlobal = all.some((p) => p.id === GLOBAL_PROFILE_ID)
      ? all
      : [buildGlobalDefaultProfile(), ...all];
    setProfiles(withGlobal);
    if (!withGlobal.some((p) => p.id === GLOBAL_PROFILE_ID)) {
      // Persist the initial global default so it survives reloads.
      await db.put("voiceProfiles", buildGlobalDefaultProfile());
    }
    const txs = (await db.getAll("voiceTranscripts")) as VoiceTranscriptReview[];
    setTranscripts(txs.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void queryPermission("microphone" as any).then(setMicPerm); }, []);

  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId]);

  useEffect(() => {
    if (!selected) { setDraft(null); setBaseline(null); return; }
    setDraft(selected);
    setBaseline(selected);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const draftDirty = isProfileDraftDirty(draft, baseline);
  const reviewDirty = isReviewDraftDirty(review);

  function guardedSelect(id: string) {
    if (shouldConfirmDiscard({ dirty: draftDirty, currentId: selectedId, targetId: id })) {
      if (!window.confirm("Discard unsaved profile changes?")) return;
    }
    setSelectedId(id);
  }

  // ─── Beforeunload guard for either dirty state ─────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (draftDirty || reviewDirty || proposal?.status === "ready") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draftDirty, reviewDirty, proposal]);

  // ─── Save profile ──────────────────────────────────────────────────
  async function saveDraft() {
    if (!draft) return;
    const now = Date.now();
    const rec = normalizeProfile({ ...draft, updatedAt: now, now });
    const db = await getDB();
    await db.put("voiceProfiles", rec);
    toast.success("Voice profile saved.");
    await reload();
    setSelectedId(rec.id);
  }

  async function newProfile() {
    if (draftDirty && !window.confirm("Discard unsaved changes and start a new profile?")) return;
    const now = Date.now();
    const draftProf = normalizeProfile({
      projectId: rah.activeProject?.id ?? null,
      name: rah.activeProject ? `${rah.activeProject.name} voice` : "New profile",
      now,
    });
    setDraft(draftProf);
    setBaseline(null); // unsaved
    setSelectedId(draftProf.id);
  }

  async function deleteProfile(id: string) {
    if (id === GLOBAL_PROFILE_ID) { toast.error("Global default cannot be deleted."); return; }
    if (!window.confirm("Delete this voice profile?")) return;
    const db = await getDB();
    await db.delete("voiceProfiles", id);
    await reload();
    setSelectedId(GLOBAL_PROFILE_ID);
  }

  // ─── Wake tester ───────────────────────────────────────────────────
  const wakeResult = useMemo(() => {
    if (!draft) return null;
    return matchWakePhrase(wakeInput, draft);
  }, [wakeInput, draft]);

  // ─── PTT capture → review ──────────────────────────────────────────
  async function startPtt() {
    if (!supported) { toast.error("SpeechRecognition unsupported in this browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: draft?.preferredInputDeviceId ? { deviceId: { exact: draft.preferredInputDeviceId } } : true,
      });
      stream.getTracks().forEach((t) => t.stop());
      setMicPerm("granted");
    } catch {
      setMicPerm("denied");
      toast.error("Microphone permission denied.");
      return;
    }
    const r = createRecognizer(draft?.locale ?? "en-US");
    if (!r) return;
    recRef.current = r;
    bufRef.current = "";
    let conf: number | null = null;
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        txt += res[0].transcript;
        if (res[0].confidence != null) conf = res[0].confidence;
      }
      bufRef.current = txt;
    };
    r.onend = () => {
      const raw = bufRef.current.trim();
      if (!raw) { setPttActive(false); return; }
      const rev = buildTranscriptReview({
        raw,
        projectId: draft?.projectId ?? null,
        profileId: draft?.id ?? null,
        sourceApi: "browser.SpeechRecognition",
        locale: draft?.locale,
        confidence: conf,
        wakeMatch: draft ? matchWakePhrase(raw, draft) : null,
      });
      setReview(rev);
      setPttActive(false);
    };
    r.onerror = () => setPttActive(false);
    try { r.start(); setPttActive(true); } catch { setPttActive(false); }
  }
  function stopPtt() {
    try { recRef.current?.stop(); } catch { /* */ }
  }

  // ─── Review actions ────────────────────────────────────────────────
  async function discardReview() {
    if (reviewDirty && !window.confirm("Discard this transcript?")) return;
    setReview(null);
    setProposal(null);
  }

  async function saveReviewToMemory() {
    if (!review) return;
    const text = review.editedText ?? review.normalizedText;
    await rah.createProjectMemory({
      projectId: review.projectId,
      title: `Voice transcript ${new Date(review.createdAt).toLocaleTimeString()}`,
      content: text,
      type: "note",
      tags: ["voice"],
      source: "voice_transcript",
      archived: false,
      pinned: false,
    } as any);
    const updated = { ...review, status: "saved" as const, saveDestination: "projectMemory" };
    const db = await getDB();
    await db.put("voiceTranscripts", updated);
    await reload();
    setReview(null);
    toast.success("Transcript saved to Project Memory.");
  }

  async function sendAsPrompt() {
    if (!review) return;
    const prompt = review.editedText ?? review.normalizedText;
    await rah.addCommand({
      prompt, agents: ["brain"], mode: rah.prefs.defaultMode, fileIds: [],
      projectId: review.projectId ?? undefined, inputType: "voice",
      status: "queued",
    });
    const db = await getDB();
    await db.put("voiceTranscripts", { ...review, status: "prompt_sent", saveDestination: "command" });
    await reload();
    setReview(null);
    toast.success("Transcript sent as a normal AI prompt.");
  }

  function proposeCommand() {
    if (!review) return;
    const prof = draft ?? buildGlobalDefaultProfile();
    const result = proposeVoiceCommand({
      transcript: review.editedText ?? review.normalizedText,
      profile: prof,
      confidence: review.confidence,
    });
    setProposal(result);
  }

  async function confirmProposal(top: VoiceCommandProposalTop) {
    const view = buildConfirmationView(top);
    if (!view) return;
    const goAhead = window.confirm(
      `Confirm voice command?\n\n${(view as any).title}\nAction: ${(view as any).exactAction}\nSide-effect: ${(view as any).sideEffect}\n\nOnly a click here dispatches the action.`,
    );
    if (!goAhead) return;
    // ONLY the ui_only branch dispatches directly. requires_approval must
    // never be dispatched here — it hands off to the Workflow Engine.
    if ((top.sideEffect as string) === "requires_approval" || top.action == null) {
      toast.info("Workflow proposals must be picked in Automations — approval-gated.");
    } else if ((top.action as any).type === "navigate") {
      window.location.hash = ""; // ensure no stale hash
      window.location.assign((top.action as any).to);
    } else if ((top.action as any).type === "event") {
      const ev = new CustomEvent((top.action as any).event, { detail: (top.action as any).payload ?? null });
      window.dispatchEvent(ev);
    }
    if (review) {
      const db = await getDB();
      await db.put("voiceTranscripts", {
        ...review,
        status: "confirmed",
        proposalId: top.id,
        confirmationId: `conf_${Date.now()}`,
      });
    }
    setProposal(null);
    setReview(null);
    await reload();
  }

  async function cleanupWithAi() {
    if (!review) return;
    const raw = review.editedText ?? review.normalizedText;
    let acc = "";
    try {
      await streamChat({
        prompt: buildCleanupPrompt(raw), agents: ["brain"], mode: "fast",
        context: { memory: [], projectMemoryBlock: "" },
      }, {
        onDelta: (_c, full) => { acc = full; },
        onDone: (i) => { acc = i.text; },
        onError: (m) => { toast.error(m); },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return;
    }
    if (isCleanupSuspicious(raw, acc)) {
      toast.error("AI cleanup produced suspicious output — leaving original text.");
      return;
    }
    setReview((r) => (r ? { ...r, editedText: acc } : r));
    toast.success("AI cleanup applied (unsaved).");
  }

  // ─── Import / export ───────────────────────────────────────────────
  function exportProfile() {
    if (!draft) return;
    const payload = shapeProfileForExport(draft);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-profile-${draft.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importProfile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    let json: unknown;
    try { json = JSON.parse(await file.text()); }
    catch { toast.error("Invalid JSON."); return; }
    const val = validateProfileImport(json);
    if (!val.ok) { toast.error(`Import failed: ${val.error}`); return; }
    const db = await getDB();
    const existing = (await db.getAll("voiceProfiles")) as VoiceProfile[];
    const plan = planProfileMerge({ incoming: val.profiles, existing });
    const decisions: Record<string, "replace" | "skip"> = {};
    for (const op of plan.ops) {
      if (op.op !== "conflict") continue;
      const answer = window.confirm(`Replace existing profile "${op.previous?.name}" (${op.profile.id}) with imported "${op.profile.name}"?`);
      decisions[op.profile.id] = answer ? "replace" : "skip";
    }
    const final = planProfileMerge({ incoming: val.profiles, existing, decisions });
    for (const op of final.ops) {
      if (op.op === "skip") continue;
      await db.put("voiceProfiles", op.profile);
    }
    toast.success(`Imported ${final.ops.filter((o) => o.op !== "skip").length} profile(s).`);
    await reload();
  }

  function exportHistory() {
    const rows = shapeHistoryForExport(filterVoiceHistory(transcripts, historyQuery));
    const blob = new Blob([JSON.stringify({ schemaVersion: VOICE_PROFILES_SCHEMA_VERSION, exportedAt: new Date().toISOString(), transcripts: rows }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `voice-transcripts.json`; a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Readiness view ────────────────────────────────────────────────
  const readiness = useMemo(() => buildReadinessSummary({
    sttSupported: supported,
    ttsSupported: typeof window !== "undefined" && "speechSynthesis" in window,
    micPermission: micPerm,
  }), [supported, micPerm]);

  const projectResolution = useMemo(() => {
    const g = profiles.find((p) => p.id === GLOBAL_PROFILE_ID) ?? buildGlobalDefaultProfile();
    return resolveProfileForProject(rah.activeProject?.id ?? null, profiles, g);
  }, [profiles, rah.activeProject?.id]);

  const filteredHistory = useMemo(() => filterVoiceHistory(transcripts, historyQuery) as VoiceTranscriptReview[],
    [transcripts, historyQuery]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="display text-3xl">Voice Profiles</h1>
          <span className="rounded-full border border-primary/40 text-primary text-xs px-2 py-0.5">v0.2</span>
        </div>
        <p className="text-muted-foreground">
          Per-project profiles, wake-phrase tuning, and approval-safe voice commands.
          Nothing captures audio until you press Hold to talk.
          <Link to="/voice" className="ml-2 underline text-primary">Open Voice Assistant</Link>
        </p>
      </header>

      {/* Readiness */}
      <section className="glass-panel gold-border p-4 text-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="rounded-full border px-2 py-0.5">STT: <b>{readiness.sttSupported ? "supported" : "unsupported"}</b></span>
          <span className="rounded-full border px-2 py-0.5">Mic: <b>{readiness.micPermission}</b></span>
          <span className="rounded-full border px-2 py-0.5">Level: <b>{readiness.level}</b></span>
          <span className="rounded-full border px-2 py-0.5">Active project: <b>{rah.activeProject?.name ?? "(none)"}</b></span>
          <span className="rounded-full border px-2 py-0.5">
            Resolved profile: <b>{projectResolution.profile?.name ?? "(none)"}</b>
            {projectResolution.fallback && <em className="ml-1 text-amber-500">(fallback)</em>}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{readiness.honestCapabilityStatement}</p>
        {readiness.blockers.length > 0 && (
          <ul className="mt-2 text-xs text-destructive list-disc pl-4">
            {readiness.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
      </section>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        {/* Profile list */}
        <aside className="glass-panel gold-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={newProfile}><Save className="h-3.5 w-3.5" /> New</Button>
            <label className="text-xs cursor-pointer inline-flex items-center gap-1">
              <Upload className="h-3.5 w-3.5" /> Import
              <input type="file" accept="application/json" onChange={importProfile} className="hidden" />
            </label>
          </div>
          <ul className="space-y-1 text-sm">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  className={"w-full text-left rounded px-2 py-1 " + (p.id === selectedId ? "bg-primary/10 text-primary" : "hover:bg-muted")}
                  onClick={() => guardedSelect(p.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{p.name}</span>
                    {!p.enabled && <span className="text-xs text-muted-foreground">off</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {p.projectId ? `project ${p.projectId.slice(0, 6)}` : "global"} · {p.locale} · “{p.wakePhrase}”
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Editor */}
        <section className="space-y-4">
          {draft && (
            <div className="glass-panel gold-border p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="display text-xl flex-1">{draft.name || "Unnamed profile"}</h2>
                {draftDirty && <span className="text-xs rounded-full border border-amber-500/40 text-amber-500 px-2 py-0.5">unsaved</span>}
                {baseline == null && <span className="text-xs rounded-full border border-primary/40 text-primary px-2 py-0.5">new draft</span>}
                <Button size="sm" variant="secondary" onClick={exportProfile}><Download className="h-3.5 w-3.5" /> Export</Button>
                <Button size="sm" onClick={saveDraft} disabled={!draftDirty && baseline != null}><Save className="h-3.5 w-3.5" /> Save</Button>
                {draft.id !== GLOBAL_PROFILE_ID && baseline && (
                  <Button size="sm" variant="destructive" onClick={() => deleteProfile(draft.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-3 text-sm">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Profile name</span>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Project</span>
                  <Select value={draft.projectId ?? "__none__"} onValueChange={(v) => setDraft({ ...draft, projectId: v === "__none__" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Global (no project)</SelectItem>
                      {rah.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Locale (BCP-47)</span>
                  <Input value={draft.locale} onChange={(e) => setDraft({ ...draft, locale: e.target.value })} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Wake phrase</span>
                  <Input value={draft.wakePhrase} onChange={(e) => setDraft({ ...draft, wakePhrase: e.target.value })} />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs text-muted-foreground">Alternate phrases (comma separated)</span>
                  <Input
                    value={draft.alternatePhrases.join(", ")}
                    onChange={(e) => setDraft({ ...draft, alternatePhrases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Wake confidence threshold: {draft.wakeConfidenceThreshold.toFixed(2)}</span>
                  <Slider min={0} max={1} step={0.05}
                    value={[draft.wakeConfidenceThreshold]}
                    onValueChange={([v]) => setDraft({ ...draft, wakeConfidenceThreshold: v })} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Auto-stop silence (ms)</span>
                  <Input type="number" value={draft.autoStopSilenceMs}
                    onChange={(e) => setDraft({ ...draft, autoStopSilenceMs: Number(e.target.value) || 0 })} />
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={draft.pushToTalk} onCheckedChange={(v) => setDraft({ ...draft, pushToTalk: v })} />
                  <span>Push-to-talk enabled</span>
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={draft.continuousListening} onCheckedChange={(v) => setDraft({ ...draft, continuousListening: v })} />
                  <span>Continuous listening (off by default)</span>
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
                  <span>Profile enabled</span>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Default mode</span>
                  <Select value={draft.defaultMode} onValueChange={(v) => setDraft({ ...draft, defaultMode: v as "fast" | "deep" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">Fast</SelectItem>
                      <SelectItem value="deep">Deep</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <div className="md:col-span-2 space-y-1">
                  <span className="text-xs text-muted-foreground">Allowed command categories</span>
                  <div className="flex flex-wrap gap-2">
                    {ALLOWED_COMMAND_CATEGORIES.map((cat) => {
                      const on = draft.allowedCommandCategories.includes(cat);
                      return (
                        <button key={cat}
                          className={"text-xs rounded-full border px-2 py-0.5 " + (on ? "border-primary text-primary" : "border-border text-muted-foreground")}
                          onClick={() => setDraft({
                            ...draft,
                            allowedCommandCategories: on
                              ? draft.allowedCommandCategories.filter((c) => c !== cat)
                              : [...draft.allowedCommandCategories, cat],
                          })}
                        >{cat}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Wake-phrase tester */}
          <div className="glass-panel gold-border p-4 space-y-2">
            <h3 className="display text-lg">Wake-phrase tester</h3>
            <p className="text-xs text-muted-foreground">Type or paste sample transcripts. This is a text tester — no microphone is used here.</p>
            <Input placeholder="e.g. hey raven summarise today" value={wakeInput} onChange={(e) => setWakeInput(e.target.value)} />
            {wakeResult && wakeInput && (
              <div className="text-sm rounded-md border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  {wakeResult.matched
                    ? <span className="inline-flex items-center gap-1 text-primary"><Check className="h-3.5 w-3.5" />match</span>
                    : <span className="inline-flex items-center gap-1 text-destructive"><X className="h-3.5 w-3.5" />no match</span>}
                  <span className="text-xs text-muted-foreground">reason: {wakeResult.reason}</span>
                </div>
                <div className="text-xs">score <b>{wakeResult.score}</b> ≥ threshold <b>{wakeResult.threshold}</b> · method <b>{wakeResult.method}</b></div>
                {wakeResult.phrase && <div className="text-xs">matched phrase: <code>{wakeResult.phrase}</code></div>}
                {wakeResult.command && <div className="text-xs">command tail: <code>{wakeResult.command}</code></div>}
              </div>
            )}
          </div>

          {/* PTT capture */}
          <div className="glass-panel gold-border p-4 space-y-2">
            <h3 className="display text-lg">Push-to-talk capture</h3>
            <p className="text-xs text-muted-foreground">
              Microphone access starts only after you click. Continuous listening is off by default.
              Nothing is sent anywhere until you click an action on the transcript.
            </p>
            <div className="flex gap-2">
              <Button onMouseDown={() => void startPtt()} onMouseUp={stopPtt} onMouseLeave={stopPtt}
                disabled={!supported || pttActive}>
                <Mic className="h-4 w-4" /> {pttActive ? "Listening… release to stop" : "Hold to talk"}
              </Button>
              {pttActive && <span className="inline-flex items-center gap-1 text-primary text-xs"><Radio className="h-3.5 w-3.5 animate-pulse" /> ACTIVE</span>}
            </div>
          </div>

          {/* Transcript review */}
          {review && (
            <div className="glass-panel gold-border p-4 space-y-3">
              <h3 className="display text-lg">Transcript review</h3>
              <div className="grid md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div>source: <b>{review.sourceApi}</b></div>
                <div>confidence: <b>{review.confidence == null ? "n/a" : review.confidence.toFixed(2)}</b></div>
                <div>locale: <b>{review.locale ?? "n/a"}</b></div>
                <div>project: <b>{review.projectId ?? "(none)"}</b></div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Raw</span>
                <div className="rounded border p-2 text-sm">{review.rawText}</div>
              </div>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">Editable</span>
                <Textarea
                  value={review.editedText ?? review.normalizedText}
                  onChange={(e) => setReview({ ...review, editedText: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={discardReview}><Trash2 className="h-4 w-4" /> Discard</Button>
                <Button variant="secondary" onClick={saveReviewToMemory}><Save className="h-4 w-4" /> Save to Project Memory</Button>
                <Button variant="secondary" onClick={sendAsPrompt}><Play className="h-4 w-4" /> Send as prompt</Button>
                <Button variant="secondary" onClick={cleanupWithAi}>AI cleanup (unsaved)</Button>
                <Button onClick={proposeCommand}>Propose voice command</Button>
              </div>
            </div>
          )}

          {/* Proposal + confirmation */}
          {proposal && (
            <div className="glass-panel gold-border p-4 space-y-2">
              <h3 className="display text-lg">Command proposal</h3>
              {proposal.status === "ready" && proposal.top && (
                <div className="space-y-2 text-sm">
                  <div>Top match: <b>{proposal.top.title}</b> ({proposal.top.category})</div>
                  <div className="text-xs text-muted-foreground">
                    intent {proposal.top.intentScore} · STT {proposal.top.sttConfidence ?? "n/a"} · side-effect: {proposal.top.sideEffect}
                  </div>
                  <Button onClick={() => confirmProposal(proposal.top!)}>Confirm & dispatch</Button>
                </div>
              )}
              {proposal.status === "ambiguous" && (
                <div className="space-y-2 text-sm">
                  <div className="inline-flex items-center gap-1 text-amber-500"><AlertTriangle className="h-4 w-4" /> Ambiguous — pick one:</div>
                  {[proposal.top!, ...proposal.alternatives].map((c) => (
                    <Button key={c.id} variant="secondary" onClick={() => confirmProposal(c)}>{c.title} ({c.intentScore})</Button>
                  ))}
                </div>
              )}
              {(proposal.status === "low_confidence" || proposal.status === "no_match" || proposal.status === "empty") && (
                <div className="text-sm text-destructive">
                  {proposal.status === "low_confidence" ? "Below confidence threshold — refusing to dispatch." :
                    proposal.status === "no_match" ? "No allowlisted command matches. Nothing will run." :
                    "Empty transcript."}
                </div>
              )}
            </div>
          )}

          {/* History */}
          <div className="glass-panel gold-border p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="display text-lg flex-1">Session history</h3>
              <Input placeholder="Search…" value={historyQuery.q ?? ""} className="w-40"
                onChange={(e) => setHistoryQuery({ ...historyQuery, q: e.target.value })} />
              <Select value={historyQuery.status ?? "__any__"}
                onValueChange={(v) => setHistoryQuery({ ...historyQuery, status: v === "__any__" ? undefined : v })}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Any status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any status</SelectItem>
                  {["review", "discarded", "saved", "prompt_sent", "proposed", "confirmed"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="secondary" onClick={exportHistory}><Download className="h-3.5 w-3.5" /> Export</Button>
            </div>
            {filteredHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transcripts yet.</p>
            ) : (
              <ul className="divide-y">
                {filteredHistory.slice(0, 30).map((t) => (
                  <li key={t.id} className="py-2 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{new Date(t.createdAt).toLocaleString()}</span>
                      <span className="rounded-full border px-2">{t.status}</span>
                      <span>{t.locale ?? "n/a"}</span>
                      <span>conf {t.confidence == null ? "n/a" : t.confidence.toFixed(2)}</span>
                    </div>
                    <div>{t.editedText || t.normalizedText || t.rawText}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}