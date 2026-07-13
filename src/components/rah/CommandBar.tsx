import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Send, Paperclip, MonitorPlay, Camera, Trash2, ImagePlus, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRah } from "@/lib/rah/context";
import { AGENTS } from "@/lib/rah/agents";
import { createRecognizer, isSpeechSupported } from "@/lib/rah/speech";
import { getDB, uid } from "@/lib/rah/db";
import { localDemoResponse } from "@/lib/rah/demo";
import { Link } from "@tanstack/react-router";
import { streamChat } from "@/lib/rah/ai";
import { ResponsePanel, type LiveResponse } from "./ResponsePanel";
import { AiStatusBadge, useAiHealth } from "./AiStatusBadge";
import { LocalAiBadge } from "./LocalAiPanel";
import { OrchestrationPanel } from "./OrchestrationPanel";
import { useOrchestration } from "@/lib/rah/orchestrationRuntime";
import {
  TEAM_MODE_LABEL, buildTeamSummarySuggestion,
  type TeamMode,
} from "@/lib/rah/orchestrator";
import {
  getLocalAiSettings, saveLocalAiSettings, subscribeLocalAi,
  engineLabel, isLocalEngine,
  type LocalAiSettings,
} from "@/lib/rah/localAi";
import { useBridgeStatus, refreshBridgeStatus } from "@/lib/rah/bridgeStatus";
import { routeText as computeRouteText, shouldShowBridgeOfflineBanner } from "@/lib/rah/bridgeStatusLabels";
import {
  prepareImage, releasePrepared, validateBatch, metaFromPrepared,
  drainPendingImages, preparedFromPending, ACCEPTED_MIME,
  type PreparedImage,
} from "@/lib/rah/images";

export function CommandBar() {
  const rah = useRah();
  const [text, setText] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(["brain"]);
  const [mode, setMode] = useState(rah.prefs.defaultMode);
  const [approvalMode, setApprovalMode] = useState(rah.prefs.approvalMode);
  const [teamMode, setTeamMode] = useState<TeamMode>("fast");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  useEffect(() => { setVoiceSupported(isSpeechSupported()); }, []);
  const recRef = useRef<any>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [response, setResponse] = useState<LiveResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { health, loading: healthLoading, refresh: refreshHealth } = useAiHealth(true);
  const aiLive = health?.state === "connected";
  const [localAi, setLocalAi] = useState<LocalAiSettings>(() => getLocalAiSettings());
  useEffect(() => subscribeLocalAi(setLocalAi), []);
  const streaming = response?.state === "thinking" || response?.state === "streaming";
  const { snapshot: bridgeSnap, refresh: refreshBridge, refreshing: bridgeRefreshing } = useBridgeStatus();
  const orch = useOrchestration();
  // Also kick a refresh whenever the CommandBar mounts (e.g. user returns to
  // Command Center from another route) so the route line and offline banner
  // reflect current truth immediately, not the 5s-old poll tick.
  useEffect(() => { void refreshBridgeStatus(); void refreshHealth(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const localOffline = shouldShowBridgeOfflineBanner(localAi, bridgeSnap);
  const localServerOffline =
    isLocalEngine(localAi.engine) && health?.ok === false && bridgeSnap?.ui === "paired_online";

  /**
   * Non-model-generated runtime metadata line rendered above every response.
   * Sourced entirely from app state (settings + bridge snapshot) so the user
   * has an out-of-band proof of what actually served the reply.
   */
  function currentRuntimeLine(): string {
    const eng = localAi.engine;
    const label = engineLabel(eng);
    if (eng === "cloud") return `Runtime: ${label} · cloud`;
    if (eng === "demo") return `Runtime: ${label} · no model call`;
    const model = eng === "lmstudio"
      ? (localAi.lmStudioModel || "unknown")
      : (localAi.ollamaModel || "unknown");
    // Reflect actual bridge state so the runtime line matches what actually
    // served the request, not just what the settings request.
    const wantsBridge = localAi.transport !== "direct";
    const online = bridgeSnap?.ui === "paired_online";
    const version = bridgeSnap?.version;
    const tail = !wantsBridge
      ? " · direct"
      : online
        ? ` · via Bridge${version ? ` v${version}` : ""}`
        : bridgeSnap == null ? " · Checking bridge…" : " · Bridge required";
    return `Runtime: ${label} · ${model}${tail}`;
  }

  useEffect(() => rah.registerCommandBarFocus(() => ref.current?.focus()), [rah]);
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      const t = detail?.text?.trim();
      if (!t) return;
      setText((cur) => (cur ? cur + " " : "") + t);
      ref.current?.focus();
    };
    window.addEventListener("rah:prefill-command", onPrefill as EventListener);
    return () => window.removeEventListener("rah:prefill-command", onPrefill as EventListener);
  }, []);
  useEffect(() => {
    const cancel = () => { stopListening(); abortRef.current?.abort(); };
    window.addEventListener("rah:cancel", cancel);
    return () => window.removeEventListener("rah:cancel", cancel);
  }, []);

  useEffect(() => {
    const pending = drainPendingImages();
    if (!pending.length) return;
    (async () => {
      const prepared: PreparedImage[] = [];
      for (const p of pending) prepared.push(await preparedFromPending(p));
      setImages((cur) => [...cur, ...prepared].slice(0, 4));
      toast.success(`Attached ${prepared.length} snapshot${prepared.length > 1 ? "s" : ""} from Screen Vision`);
      ref.current?.focus();
    })();
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const files: File[] = [];
      for (const it of Array.from(e.clipboardData.items)) {
        if (it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) files.push(f); }
      }
      if (files.length) { e.preventDefault(); void addImages(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  useEffect(() => () => releasePrepared(images), []);

  async function addImages(files: File[]) {
    const addingBytes = files.reduce((s, f) => s + f.size, 0);
    const err = validateBatch(images, files.length, addingBytes);
    if (err) { toast.error(err); return; }
    const next: PreparedImage[] = [];
    for (const f of files) {
      const p = await prepareImage(f);
      if (p.state !== "ready") toast.error(`${p.name}: ${p.error ?? p.state}`);
      next.push(p);
    }
    setImages((cur) => [...cur, ...next]);
  }
  function removeImage(id: string) {
    setImages((cur) => {
      const gone = cur.find((p) => p.id === id);
      if (gone) { try { URL.revokeObjectURL(gone.thumbUrl); } catch { /* */ } }
      return cur.filter((p) => p.id !== id);
    });
  }
  function toggleImageIncluded(id: string) {
    setImages((cur) => cur.map((p) => p.id === id ? { ...p, included: !p.included } : p));
  }
  function clearImages() { releasePrepared(images); setImages([]); }
  function onImagePicker(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length) void addImages(files);
    e.target.value = "";
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) void addImages(files);
  }

  function startListening() {
    if (!voiceSupported) {
      toast.error("Speech recognition is not available in this browser. Use text input.");
      return;
    }
    const r = createRecognizer(rah.prefs.voiceLang || "en-US");
    if (!r) return;
    recRef.current = r;
    let finalTxt = "";
    r.onresult = (e: any) => {
      let i = "";
      for (let idx = e.resultIndex; idx < e.results.length; idx++) {
        const res = e.results[idx];
        if (res.isFinal) finalTxt += res[0].transcript;
        else i += res[0].transcript;
      }
      setInterim(i);
      if (finalTxt) {
        setText((t) => (t ? t + " " : "") + finalTxt.trim());
        finalTxt = "";
      }
    };
    r.onerror = (e: any) => {
      toast.error("Speech recognition error: " + (e?.error ?? "unknown"));
      setListening(false);
    };
    r.onend = () => setListening(false);
    try { r.start(); setListening(true); } catch { /* already started */ }
  }
  function stopListening() {
    try { recRef.current?.stop(); } catch {}
    setListening(false); setInterim("");
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files; if (!files?.length) return;
    const db = await getDB();
    for (const f of Array.from(files)) {
      await db.put("files", {
        id: uid(), name: f.name, mime: f.type || "application/octet-stream",
        size: f.size, createdAt: Date.now(), blob: f, projectId: rah.activeProject?.id,
        tags: [], folder: undefined, favorite: false,
      });
    }
    toast.success(`Attached ${files.length} file${files.length > 1 ? "s" : ""}`);
    e.target.value = "";
  }

  async function send() {
    const prompt = text.trim();
    if (!prompt) { toast.error("Type or dictate a command first."); return; }
    stopListening();
    // Team run: fan out to specialists, then Master Brain synthesis.
    // Team runs bypass the queued-approval flow — the run itself is visible
    // in the live Team panel with a Cancel button, and any side-effect tool
    // calls still surface their own approval card at execution time.
    if (teamMode !== "fast") {
      await runTeam(prompt);
      setText(""); setInterim("");
      return;
    }
    const needsApproval = approvalMode !== "advisory";

    if (needsApproval) {
      const includedImages = images.filter((i) => i.state === "ready" && i.included);
      const memory = rah.prefs.memoryEnabled
        ? rah.memory.filter((m) => !m.disabled && (!m.projectId || m.projectId === rah.activeProject?.id)).map((m) => m.text)
        : [];
      const projectMemoryBlock = rah.prefs.memoryEnabled ? rah.buildProjectMemoryContext().memoryBlock : "";
      const cmd = await rah.addCommand({
        prompt, agents: selectedAgents, mode, fileIds: [],
        projectId: rah.activeProject?.id, inputType: listening ? "voice" : "text",
        status: "awaiting_approval",
        resultSummary: "Queued for approval before running.",
        attachments: images.map((i) => metaFromPrepared(i, i.included && i.state === "ready")),
        pending: {
          context: {
            projectName: rah.activeProject?.name,
            projectGoals: rah.activeProject?.goals,
            memory,
            projectMemoryBlock,
          },
          images: includedImages.map((i) => ({ name: i.name, mime: i.mime, dataUrl: i.dataUrl })),
        },
      });
      await rah.requestApproval({
        title: `Run "${prompt.slice(0, 60)}"`,
        reason: `Execute across agents: ${selectedAgents.join(", ")}.`,
        tools: selectedAgents,
        dataShared: rah.activeProject ? [`Project: ${rah.activeProject.name}`] : [],
        expectedResult: aiLive
          ? "Live AI runs after approval and the response is saved to History."
          : "Local demo response after approval (AI backend offline).",
        risk: "low",
        category: "agent-run",
        commandId: cmd.id,
      });
      setText(""); setInterim("");
      clearImages();
      toast.success("Queued for approval.");
      return;
    }

    await runInference(prompt);
    setText(""); setInterim("");
  }

  async function runTeam(prompt: string) {
    const memory = rah.prefs.memoryEnabled
      ? rah.memory.filter((m) => !m.disabled && (!m.projectId || m.projectId === rah.activeProject?.id)).map((m) => m.text)
      : [];
    const projectMemoryBlock = rah.prefs.memoryEnabled ? rah.buildProjectMemoryContext().memoryBlock : "";
    const bridgeOnline = bridgeSnap?.ui === "paired_online";
    setResponse(null);
    await orch.start({
      userPrompt: prompt,
      teamMode,
      manualSelection: teamMode === "manual" ? selectedAgents.filter((a) => a !== "brain") : undefined,
      context: {
        projectName: rah.activeProject?.name,
        projectGoals: rah.activeProject?.goals,
        memory, projectMemoryBlock,
      },
      bridgeOnline,
      onFinal: async (final) => {
        // Persist ONE final synthesized command to History.
        await rah.addCommand({
          prompt: final.prompt,
          agents: ["brain", ...final.specialists],
          mode,
          fileIds: [],
          projectId: rah.activeProject?.id,
          inputType: listening ? "voice" : "text",
          status: "done",
          resultSummary: final.synthesis,
          provider: final.provider,
          model: final.model,
          latencyMs: final.latencyMs,
          attachments: [],
          visionUsed: false,
        });
        toast.success(`Team run complete — ${final.specialists.length} specialist${final.specialists.length > 1 ? "s" : ""} synthesized (${final.privacy}).`);
      },
    });
  }

  async function saveTeamSummary() {
    if (!orch.state) return;
    const sug = buildTeamSummarySuggestion({
      userPrompt: orch.state.userPrompt,
      taskStates: orch.state.tasks.map((t) => ({
        agentId: t.agentId, agentName: t.agentName,
        state: t.state === "queued" || t.state === "running" ? "failed" : t.state,
        text: t.text, error: t.error,
      })),
      synthesis: orch.state.synthesis,
      projectId: rah.activeProject?.id ?? null,
    });
    if (!sug) { toast.error("Nothing to save yet."); return; }
    await rah.addMemory({
      layer: sug.draft.projectId ? "project" : "personal",
      projectId: sug.draft.projectId ?? undefined,
      text: `[${new Date().toLocaleString()}] ${sug.draft.title}\n---\n${sug.draft.content}`,
      category: "team_run_summary",
      source: "team_run",
    });
    toast.success("Saved team summary to Memory.");
  }

  async function runInference(prompt: string) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const startedAt = Date.now();

    const includedImages = images.filter((i) => i.state === "ready" && i.included);
    const attachmentsMeta = images.map((i) => metaFromPrepared(i, false));
    const imagePayload = includedImages.map((i) => ({ name: i.name, mime: i.mime, dataUrl: i.dataUrl }));
    const hasImages = imagePayload.length > 0;

    if (!aiLive) {
      const demoBase = localDemoResponse(prompt, selectedAgents, mode);
      const demo = hasImages
        ? `${demoBase}\n\n> ⚠ ${imagePayload.length} image${imagePayload.length > 1 ? "s were" : " was"} attached but the AI backend is offline. No visual analysis was performed. Reconnect the AI backend to enable RAH Vision.`
        : demoBase;
      const cmd = await rah.addCommand({
        prompt, agents: selectedAgents, mode, fileIds: [],
        projectId: rah.activeProject?.id,
        inputType: hasImages ? "screen" : (listening ? "voice" : "text"),
        status: "done", resultSummary: demo, demo: true,
        attachments: attachmentsMeta, visionUsed: false,
      });
      setResponse({
        id: cmd.id, prompt, agents: selectedAgents, text: demo,
        state: "done", demo: true, startedAt, latencyMs: 0,
        provider: "Local Demo Engine",
        visionUsed: false, attachmentCount: attachmentsMeta.length,
        runtimeLine: currentRuntimeLine(),
      });
      toast.message("Local Demo Response (no live AI).");
      return;
    }

    setResponse({
      prompt, agents: selectedAgents, text: "",
      state: "thinking", startedAt,
      provider: "Lovable AI Gateway",
      visionUsed: false, attachmentCount: attachmentsMeta.length,
      runtimeLine: currentRuntimeLine(),
    });

    const memory = rah.prefs.memoryEnabled
      ? rah.memory.filter((m) => !m.disabled && (!m.projectId || m.projectId === rah.activeProject?.id)).map((m) => m.text)
      : [];
    const projectMemoryBlock = rah.prefs.memoryEnabled ? rah.buildProjectMemoryContext().memoryBlock : "";

    try {
      let providerLabel = "Lovable AI Gateway";
      let modelLabel: string | undefined;
      let latencyMs = 0;
      let usage: unknown = null;
      let finalText = "";
      let visionUsed = false;

      await streamChat({
        prompt, agents: selectedAgents, mode,
        signal: ac.signal,
        context: {
          projectName: rah.activeProject?.name,
          projectGoals: rah.activeProject?.goals,
          memory,
          projectMemoryBlock,
        },
        images: imagePayload,
      }, {
        onStart: (info) => {
          providerLabel = info.provider;
          modelLabel = info.model;
          setResponse((r) => r ? { ...r, state: "streaming", provider: info.provider, model: info.model } : r);
        },
        onVision: (info) => {
          visionUsed = info.imageCount > 0;
          setResponse((r) => r ? { ...r, visionUsed: true, attachmentCount: info.imageCount } : r);
        },
        onDelta: (_c, full) => {
          finalText = full;
          setResponse((r) => r ? { ...r, text: full, state: "streaming" } : r);
        },
        onDone: (info) => {
          finalText = info.text;
          modelLabel = info.model;
          providerLabel = info.provider;
          latencyMs = info.latencyMs;
          usage = info.usage;
        },
        onError: (msg, state) => {
          setResponse((r) => r ? { ...r, state: "error", error: msg, errorState: state } : r);
        },
      });

      const finalAttachments = attachmentsMeta.map((a) => ({
        ...a,
        analyzed: a.included && visionUsed,
      }));
      const cmd = await rah.addCommand({
        prompt, agents: selectedAgents, mode, fileIds: [],
        projectId: rah.activeProject?.id,
        inputType: hasImages ? "screen" : (listening ? "voice" : "text"),
        status: "done", resultSummary: finalText,
        provider: providerLabel, model: modelLabel, latencyMs, usage, demo: false,
        attachments: finalAttachments, visionUsed,
      });
      setResponse({
        id: cmd.id, prompt, agents: selectedAgents, text: finalText,
        state: "done", provider: providerLabel, model: modelLabel,
        latencyMs, usage, demo: false, startedAt,
        visionUsed, attachmentCount: finalAttachments.length,
        runtimeLine: currentRuntimeLine(),
      });
      clearImages();
    } catch (err) {
      if (ac.signal.aborted) {
        setResponse((r) => r ? { ...r, state: "cancelled" } : r);
        await rah.addCommand({
          prompt, agents: selectedAgents, mode, fileIds: [],
          projectId: rah.activeProject?.id, inputType: listening ? "voice" : "text",
          status: "error", resultSummary: "Cancelled by user.", errorMessage: "aborted",
          attachments: attachmentsMeta, visionUsed: false,
        });
        toast.message("Cancelled.");
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const hint = hasImages && /image|multimodal|unsupported|size|payload|too large/i.test(msg)
        ? " — try removing images or reducing their size, then Retry as text-only."
        : "";
      setResponse((r) => r ? { ...r, state: "error", error: msg + hint } : r);
      await rah.addCommand({
        prompt, agents: selectedAgents, mode, fileIds: [],
        projectId: rah.activeProject?.id, inputType: listening ? "voice" : "text",
        status: "error", resultSummary: `Error: ${msg}`, errorMessage: msg,
        attachments: attachmentsMeta, visionUsed: false,
      });
      toast.error("AI request failed: " + msg);
      void refreshHealth();
    }
  }

  const toggleAgent = (id: string) =>
    setSelectedAgents((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="space-y-4">
    <div
      className={"glass-panel gold-border p-4 md:p-5 space-y-3 relative " + (dragging ? "ring-2 ring-primary/60" : "")}
      onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Select value={rah.activeProject?.id ?? "none"} onValueChange={(v) => void rah.setActiveProject(v === "none" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No project</SelectItem>
            {rah.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.icon} {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={mode} onValueChange={(v) => setMode(v as any)}>
          <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Fast Answer</SelectItem>
            <SelectItem value="expert">Expert Team</SelectItem>
            <SelectItem value="debate">Debate Mode</SelectItem>
            <SelectItem value="deep_project">Deep Project</SelectItem>
          </SelectContent>
        </Select>
        <Select value={teamMode} onValueChange={(v) => setTeamMode(v as TeamMode)}>
          <SelectTrigger className="h-8 w-[170px]" aria-label="Team mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Solo (Master Brain)</SelectItem>
            <SelectItem value="team_review">Team Review (2–3)</SelectItem>
            <SelectItem value="full_council">Full Council (up to 5)</SelectItem>
            <SelectItem value="manual">Manual selection</SelectItem>
          </SelectContent>
        </Select>
        <Select value={approvalMode} onValueChange={(v) => setApprovalMode(v as any)}>
          <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="advisory">Advisory Only</SelectItem>
            <SelectItem value="ask_every">Ask Before Every Action</SelectItem>
            <SelectItem value="trusted_low_risk">Trusted Low-Risk</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={localAi.engine}
            onValueChange={(v) => setLocalAi(saveLocalAiSettings({ engine: v as LocalAiSettings["engine"] }))}
          >
            <SelectTrigger className="h-8 w-[180px]" aria-label="AI engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloud">Lovable Cloud</SelectItem>
              <SelectItem value="lmstudio">LM Studio (Bridge)</SelectItem>
              <SelectItem value="ollama">Ollama (Bridge)</SelectItem>
              <SelectItem value="demo">Demo / Offline</SelectItem>
            </SelectContent>
          </Select>
          <LocalAiBadge />
          <AiStatusBadge health={health} loading={healthLoading} />
          {!aiLive && !healthLoading && (
            <Link to="/connections" className="text-[11px] text-primary hover:underline">Fix →</Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-widest">Route:</span>
        <span className="text-foreground">{computeRouteText(localAi, bridgeSnap)}</span>
        {bridgeRefreshing && bridgeSnap?.ui === "paired_online" && (
          <span className="text-[10px] text-muted-foreground/70 italic">refreshing…</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void refreshBridge(); void refreshHealth(); }}
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-accent"
          >Refresh status</button>
          <button
            type="button"
            onClick={() => { setText(""); setInterim(""); setResponse(null); ref.current?.focus(); }}
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-accent"
          >New chat</button>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            disabled={!streaming}
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-accent disabled:opacity-40"
          >Stop generation</button>
        </span>
      </div>

      {(localOffline || localServerOffline) && (
        <div className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-xs text-destructive flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {localOffline
              ? "RAH Desktop Bridge is offline — start the bridge on your PC to reach LM Studio."
              : `${localAi.engine === "lmstudio" ? "LM Studio" : "Ollama"} server is offline — start it on your PC and load a model.`}
          </span>
          <Link to="/connections" className="ml-auto underline">Open Connections</Link>
          <button
            type="button"
            className="rounded border border-destructive/60 px-2 py-0.5 hover:bg-destructive/20"
            onClick={() => setLocalAi(saveLocalAiSettings({ engine: "cloud", transport: "auto" }))}
          >Use Lovable Cloud instead</button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {AGENTS.map((a) => {
          const on = selectedAgents.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggleAgent(a.id)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                (on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")
              }
              aria-pressed={on}
            >
              <span>{a.emoji}</span>
              <span>{a.name.replace("RAH ", "")}</span>
            </button>
          );
        })}
      </div>

      <Textarea
        ref={ref}
        value={interim ? `${text}${text ? " " : ""}${interim}` : text}
        onChange={(e) => { setText(e.target.value); setInterim(""); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder='Try: "Ask the coding, design, and business agents to review this project."  (Enter to send · Shift+Enter for new line · drop or paste images to analyze)'
        rows={4}
        className="resize-y bg-background/60"
        aria-label="Command input"
      />

      {images.length > 0 && (
        <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-widest">Image attachments</span>
            <span>· {images.filter((i) => i.state === "ready" && i.included).length} of {images.length} will be sent to the AI</span>
            <button type="button" onClick={clearImages} className="ml-auto text-destructive hover:underline">Remove all</button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {images.map((im) => {
              const badge =
                im.state !== "ready" ? im.state.replace("_", " ") :
                im.included ? "Included for AI" : "Excluded";
              return (
                <li key={im.id} className={"relative w-40 rounded-md border p-1.5 " + (im.included && im.state === "ready" ? "border-primary/50" : "border-border")}>
                  <img src={im.thumbUrl} alt={`Attachment thumbnail: ${im.name}`} className="w-full h-24 object-cover rounded" />
                  <div className="mt-1 text-[10px] leading-tight">
                    <div className="truncate" title={im.name}>{im.name}</div>
                    <div className="text-muted-foreground">{im.width || "?"}×{im.height || "?"} · {im.mime.replace("image/", "")} · {(im.sizeBytes / 1024).toFixed(0)}KB</div>
                    <div className={
                      im.state !== "ready" ? "text-destructive" :
                      im.included ? "text-primary" : "text-muted-foreground"
                    }>{badge}</div>
                  </div>
                  <div className="absolute top-1 right-1 flex gap-1">
                    {im.state === "ready" && (
                      <button
                        type="button"
                        onClick={() => toggleImageIncluded(im.id)}
                        aria-label={im.included ? "Exclude from AI" : "Include for AI"}
                        title={im.included ? "Exclude from AI" : "Include for AI"}
                        className="rounded bg-background/80 border border-border/60 p-0.5 hover:bg-accent"
                      >
                        {im.included ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(im.id)}
                      aria-label={`Remove ${im.name}`}
                      className="rounded bg-background/80 border border-border/60 p-0.5 hover:bg-destructive/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] text-muted-foreground">
            Only included snapshots are sent with this command. Raw image data is never saved to history — only filename, dimensions, and type.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => (listening ? stopListening() : startListening())}
          variant={listening ? "destructive" : "default"}
          className={listening ? "pulse-gold" : ""}
          aria-pressed={listening}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {listening ? "Stop listening" : "Push to talk"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => imageRef.current?.click()}>
          <ImagePlus className="h-4 w-4" /> Add image
        </Button>
        <input
          ref={imageRef}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_MIME.join(",")}
          onChange={onImagePicker}
        />
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
          <Paperclip className="h-4 w-4" /> Attach
        </Button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFiles} />
        <Button asChild type="button" variant="secondary">
          <Link to="/vision"><MonitorPlay className="h-4 w-4" /> Share screen</Link>
        </Button>
        <Button asChild type="button" variant="secondary">
          <Link to="/vision"><Camera className="h-4 w-4" /> Screenshot</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={() => { setText(""); setInterim(""); }}>
          <Trash2 className="h-4 w-4" /> Clear
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {voiceSupported ? (
            <span className="text-[11px] text-muted-foreground">
              {listening ? "Listening…" : "Voice ready (browser)"}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Voice unsupported — text only</span>
          )}
          <Button type="button" onClick={() => void send()} className="min-w-24">
            <Send className="h-4 w-4" /> Send
          </Button>
        </div>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 rounded-lg border-2 border-dashed border-primary/70 bg-primary/5 grid place-items-center">
          <span className="text-primary text-sm">Drop images to attach for AI vision</span>
        </div>
      )}
    </div>

    <ResponsePanel
      response={response}
      onStop={() => { abortRef.current?.abort(); }}
      onRetry={() => { if (response) void runInference(response.prompt); }}
      onFavorite={async () => {
        if (!response?.id) { toast.error("Nothing to favorite yet."); return; }
        await rah.updateCommand(response.id, { favorite: true });
        setResponse((r) => r ? { ...r, favorite: true } : r);
        toast.success("Favorited");
      }}
      onSaveToProject={async () => {
        if (!response?.text) return;
        if (!rah.activeProject) { toast.error("Select an active project first."); return; }
        await rah.addMemory({
          layer: "project",
          projectId: rah.activeProject.id,
          text: `[${new Date().toLocaleString()}] ${response.prompt}\n---\n${response.text.slice(0, 4000)}`,
          category: "ai_response",
          source: response.model ?? "Lovable AI Gateway",
        });
        toast.success(`Saved to ${rah.activeProject.name}`);
      }}
      onClear={() => setResponse(null)}
    />
    {orch.state && (
      <OrchestrationPanel
        state={orch.state}
        onCancelAll={orch.cancelAll}
        onCancelTask={orch.cancelTask}
        onRetryAgent={(id) => void orch.retryAgent(id, {
          context: {
            projectName: rah.activeProject?.name,
            projectGoals: rah.activeProject?.goals,
            memory: rah.prefs.memoryEnabled
              ? rah.memory.filter((m) => !m.disabled && (!m.projectId || m.projectId === rah.activeProject?.id)).map((m) => m.text)
              : [],
            projectMemoryBlock: rah.prefs.memoryEnabled ? rah.buildProjectMemoryContext().memoryBlock : "",
          },
          bridgeOnline: bridgeSnap?.ui === "paired_online",
        })}
        onRetrySynthesis={() => void orch.retrySynthesis({
          context: {
            projectName: rah.activeProject?.name,
            projectGoals: rah.activeProject?.goals,
            memory: rah.prefs.memoryEnabled
              ? rah.memory.filter((m) => !m.disabled && (!m.projectId || m.projectId === rah.activeProject?.id)).map((m) => m.text)
              : [],
            projectMemoryBlock: rah.prefs.memoryEnabled ? rah.buildProjectMemoryContext().memoryBlock : "",
          },
        })}
        onSaveSummary={saveTeamSummary}
        onClose={orch.reset}
      />
    )}
    </div>
  );
}