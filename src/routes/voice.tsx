import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Square, Play, StopCircle, Radio, Volume2, Save, Trash2, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  createRecognizer, isSpeechSupported, listMicrophones, queryPermission,
  getVoices, speak, stopSpeaking,
} from "@/lib/rah/speech";
import {
  canTransition, parseWakePhrase, shouldInterruptTts,
  buildVoiceCommandPayload, buildSummarySuggestion, buildVoiceDiagnostics,
  explainVoiceError,
  type VoiceState, type VoiceSessionTurn,
} from "@/lib/rah/voiceAssistant";
import { useRah } from "@/lib/rah/context";
import { streamChat } from "@/lib/rah/ai";
import { getLocalAiSettings, engineLabel, subscribeLocalAi, type LocalAiSettings } from "@/lib/rah/localAi";
import { useBridgeStatus } from "@/lib/rah/bridgeStatus";

export const Route = createFileRoute("/voice")({
  head: () => ({ meta: [
    { title: "Voice Assistant — Raven Command" },
    { name: "description", content: "Consent-first hands-free voice interface for Raven Command with wake phrase, push-to-talk, and TTS." },
  ]}),
  component: VoicePage,
});

const LANGS = [
  { v: "en-US", l: "English (US)" },
  { v: "en-GB", l: "English (UK)" },
  { v: "nb-NO", l: "Norsk" },
  { v: "bn-BD", l: "বাংলা" },
  { v: "es-ES", l: "Español" },
  { v: "fr-FR", l: "Français" },
  { v: "de-DE", l: "Deutsch" },
];

interface VoicePrefsLocal {
  ttsPitch: number;
  ttsVolume: number;
  outputLang: string;
  sessionMode: boolean;
  wakePhraseEnabled: boolean;
  directDictation: boolean;
}
const VOICE_PREFS_KEY = "rah.voice.prefs.v1";
function loadVoicePrefs(): VoicePrefsLocal {
  if (typeof localStorage === "undefined") return defaultVoicePrefs();
  try {
    const raw = localStorage.getItem(VOICE_PREFS_KEY);
    if (!raw) return defaultVoicePrefs();
    return { ...defaultVoicePrefs(), ...JSON.parse(raw) };
  } catch { return defaultVoicePrefs(); }
}
function saveVoicePrefs(p: VoicePrefsLocal) {
  try { localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(p)); } catch { /* */ }
}
function defaultVoicePrefs(): VoicePrefsLocal {
  return { ttsPitch: 1, ttsVolume: 1, outputLang: "en-US", sessionMode: false, wakePhraseEnabled: true, directDictation: false };
}

function VoicePage() {
  const rah = useRah();
  const [supported] = useState(() => isSpeechSupported());
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [state, setStateRaw] = useState<VoiceState>("idle");
  const stateRef = useRef<VoiceState>("idle");
  function setState(next: VoiceState) {
    const cur = stateRef.current;
    if (cur === next) return;
    if (!canTransition(cur, next)) return; // reject illegal transition silently
    stateRef.current = next;
    setStateRaw(next);
  }

  const [inputLang, setInputLang] = useState(rah.prefs.voiceLang || "en-US");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [micPerm, setMicPerm] = useState<string>("unknown");
  const [voicePrefs, setVoicePrefsState] = useState<VoicePrefsLocal>(() => defaultVoicePrefs());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [interim, setInterim] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [turns, setTurns] = useState<VoiceSessionTurn[]>([]);
  const [summarySuggestion, setSummarySuggestion] = useState<ReturnType<typeof buildSummarySuggestion> | null>(null);
  const [localAi, setLocalAi] = useState<LocalAiSettings>(() => getLocalAiSettings());
  useEffect(() => subscribeLocalAi(setLocalAi), []);
  const { snapshot: bridgeSnap } = useBridgeStatus();

  const recRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pttHoldingRef = useRef(false);
  const sessionActiveRef = useRef(false);

  // Load persisted voice prefs on client only (avoid SSR hydration mismatch)
  useEffect(() => { setVoicePrefsState(loadVoicePrefs()); }, []);
  function updateVoicePrefs(patch: Partial<VoicePrefsLocal>) {
    setVoicePrefsState((cur) => {
      const next = { ...cur, ...patch };
      saveVoicePrefs(next);
      return next;
    });
  }

  useEffect(() => {
    queryPermission("microphone" as any).then((s) => setMicPerm(s));
    listMicrophones().then(setMics);
    if (ttsSupported) {
      const load = () => setVoices(getVoices());
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, [ttsSupported]);

  // ─── Recognizer control ───────────────────────────────────────────
  function beginRecognition(): boolean {
    if (!supported) { setErrorMsg(explainVoiceError("unsupported")); setState("error"); return false; }
    const r = createRecognizer(inputLang);
    if (!r) return false;
    recRef.current = r;
    let finalTxt = "";
    r.onstart = () => {
      setErrorMsg(null);
      setState("listening");
      // If TTS is speaking when user starts talking (barge-in), cut it off.
      if (shouldInterruptTts(stateRef.current, "user-speech-start")) stopSpeaking();
    };
    r.onspeechstart = () => {
      if (shouldInterruptTts(stateRef.current, "user-speech-start")) stopSpeaking();
    };
    r.onresult = (e: any) => {
      let i = "";
      for (let idx = e.resultIndex; idx < e.results.length; idx++) {
        const res = e.results[idx];
        if (res.isFinal) finalTxt += res[0].transcript;
        else i += res[0].transcript;
      }
      setInterim(i);
      if (finalTxt.trim()) {
        const seg = finalTxt.trim();
        finalTxt = "";
        handleFinalUtterance(seg);
      }
    };
    r.onerror = (e: any) => {
      const code = e?.error ?? "unknown";
      if (code === "aborted") return;
      setErrorMsg(explainVoiceError(code));
      setState("error");
    };
    r.onend = () => {
      // Session mode: keep listening after each response until user stops.
      if (sessionActiveRef.current && stateRef.current !== "thinking" && stateRef.current !== "speaking") {
        try { r.start(); } catch { /* recognizer may still be shutting down */ }
      } else if (stateRef.current === "listening" || stateRef.current === "transcribing") {
        setState("idle");
        setInterim("");
      }
    };
    try { r.start(); return true; }
    catch { return false; }
  }

  function stopRecognition() {
    try { recRef.current?.stop(); } catch { /* */ }
  }

  // ─── Session / PTT lifecycle ──────────────────────────────────────
  async function requestMicAndStart(mode: "ptt" | "session") {
    if (!supported) { setErrorMsg(explainVoiceError("unsupported")); setState("error"); return; }
    setState("requesting_mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId } } : true,
      });
      // Immediately release — SpeechRecognition manages its own capture path.
      stream.getTracks().forEach((t) => t.stop());
      setMicPerm("granted");
    } catch {
      setErrorMsg(explainVoiceError("not-allowed"));
      setState("error");
      return;
    }
    if (mode === "session") {
      sessionActiveRef.current = true;
      updateVoicePrefs({ sessionMode: true });
    }
    beginRecognition();
  }

  function endSession() {
    sessionActiveRef.current = false;
    updateVoicePrefs({ sessionMode: false });
    stopRecognition();
    stopSpeaking();
    setState("idle");
    setInterim("");
    // Offer summary suggestion (never save silently).
    if (turns.length) {
      setSummarySuggestion(buildSummarySuggestion({ turns }, { projectId: rah.activeProject?.id ?? null }));
    }
  }

  // Push-to-talk: hold Space (when not typing in an input)
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isEditable(e.target)) return;
      if (sessionActiveRef.current) return;
      e.preventDefault();
      if (pttHoldingRef.current) return;
      pttHoldingRef.current = true;
      void requestMicAndStart("ptt");
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !pttHoldingRef.current) return;
      pttHoldingRef.current = false;
      stopRecognition();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micId, supported, inputLang]);

  // ─── Handle a finalized utterance (wake gate + dispatch) ──────────
  async function handleFinalUtterance(seg: string) {
    setState("transcribing");
    // Wake gate only applies in session mode; PTT utterances are always intentional.
    let commandText = seg;
    if (sessionActiveRef.current && voicePrefs.wakePhraseEnabled && !voicePrefs.directDictation) {
      const parsed = parseWakePhrase(seg, { directDictation: false });
      if (!parsed) {
        // Ignore chatter before the wake phrase.
        setState("listening");
        return;
      }
      commandText = parsed.command;
      if (!commandText) {
        // Just "Raven" alone — acknowledge and keep listening.
        setState("listening");
        return;
      }
    }
    await sendTranscript(commandText);
  }

  async function sendTranscript(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    setTurns((t) => [...t, { role: "user", text: prompt, ts: Date.now() }]);
    setInterim("");
    setState("thinking");
    const memory = rah.prefs.memoryEnabled
      ? rah.memory.filter((m) => !m.disabled && (!m.projectId || m.projectId === rah.activeProject?.id)).map((m) => m.text)
      : [];
    const projectMemoryBlock = rah.prefs.memoryEnabled ? rah.buildProjectMemoryContext().memoryBlock : "";

    const payload = buildVoiceCommandPayload({
      transcript: prompt,
      project: rah.activeProject ?? null,
      memoryTextItems: memory,
      projectMemoryBlock,
      agents: ["brain"],
      mode: rah.prefs.defaultMode,
      approvalMode: rah.prefs.approvalMode,
    });

    // Route through existing pipeline.
    if (payload.status === "awaiting_approval") {
      const cmd = await rah.addCommand(payload);
      await rah.requestApproval({
        title: `Voice: "${prompt.slice(0, 60)}"`,
        reason: "Executed from Voice Assistant (spoken command).",
        tools: ["brain"], dataShared: rah.activeProject ? [`Project: ${rah.activeProject.name}`] : [],
        expectedResult: "AI runs after approval; response saved to History.",
        risk: "low", category: "voice-command", commandId: cmd.id,
      });
      setTurns((t) => [...t, { role: "assistant", text: "(queued for approval — see Approvals)", ts: Date.now() }]);
      toast.success("Voice command queued for approval.");
      setState(sessionActiveRef.current ? "listening" : "idle");
      if (sessionActiveRef.current) { try { recRef.current?.start(); } catch { /* */ } }
      return;
    }

    // Advisory: stream inline like Command Center does.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let finalText = "";
    try {
      await streamChat({
        prompt, agents: ["brain"], mode: rah.prefs.defaultMode, signal: ac.signal,
        context: {
          projectName: rah.activeProject?.name, projectGoals: rah.activeProject?.goals,
          memory, projectMemoryBlock,
        },
      }, {
        onDelta: (_c, full) => { finalText = full; },
        onDone: (i) => { finalText = i.text; },
        onError: (msg) => { setErrorMsg(msg); setState("error"); },
      });
      await rah.addCommand({
        prompt, agents: ["brain"], mode: rah.prefs.defaultMode, fileIds: [],
        projectId: rah.activeProject?.id, inputType: "voice",
        status: "done", resultSummary: finalText || "(empty response)",
      });
      setTurns((t) => [...t, { role: "assistant", text: finalText, ts: Date.now() }]);
      if (ttsSupported && rah.prefs.ttsEnabled && finalText) {
        setState("speaking");
        const u = new SpeechSynthesisUtterance(finalText);
        u.rate = rah.prefs.ttsRate || 1;
        u.pitch = voicePrefs.ttsPitch;
        u.volume = voicePrefs.ttsVolume;
        u.lang = voicePrefs.outputLang;
        const v = voices.find((x) => x.name === rah.prefs.ttsVoice);
        if (v) u.voice = v;
        u.onend = () => {
          if (sessionActiveRef.current) {
            setState("listening");
            try { recRef.current?.start(); } catch { /* */ }
          } else setState("idle");
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } else {
        setState(sessionActiveRef.current ? "listening" : "idle");
        if (sessionActiveRef.current) { try { recRef.current?.start(); } catch { /* */ } }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!ac.signal.aborted) { setErrorMsg(msg); setState("error"); }
    }
  }

  const diagnostics = useMemo(() => buildVoiceDiagnostics({
    sttSupported: supported,
    ttsSupported,
    micPermission: micPerm,
    inputLang, outputLang: voicePrefs.outputLang,
    engine: engineLabel(localAi.engine),
    bridgeOnline: bridgeSnap?.ui === "paired_online",
  }), [supported, ttsSupported, micPerm, inputLang, voicePrefs.outputLang, localAi.engine, bridgeSnap?.ui]);

  function previewVoice() {
    if (!ttsSupported) return;
    const u = new SpeechSynthesisUtterance("Raven online. Voice preview at your current settings.");
    u.rate = rah.prefs.ttsRate || 1;
    u.pitch = voicePrefs.ttsPitch;
    u.volume = voicePrefs.ttsVolume;
    u.lang = voicePrefs.outputLang;
    const v = voices.find((x) => x.name === rah.prefs.ttsVoice);
    if (v) u.voice = v;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function stopEverything() {
    stopRecognition();
    stopSpeaking();
    abortRef.current?.abort();
    sessionActiveRef.current = false;
    setState("idle");
    setInterim("");
  }

  async function saveSummaryToMemory() {
    if (!summarySuggestion) return;
    await rah.createProjectMemory(summarySuggestion.draft);
    toast.success("Voice session summary saved to Project Memory.");
    setSummarySuggestion(null);
  }

  const stateBadge = ({
    idle: { l: "Idle", c: "border-border text-muted-foreground" },
    requesting_mic: { l: "Requesting microphone…", c: "border-primary/60 text-primary animate-pulse" },
    listening: { l: "LISTENING", c: "border-primary text-primary pulse-gold" },
    transcribing: { l: "Transcribing…", c: "border-primary/60 text-primary" },
    thinking: { l: "Thinking…", c: "border-primary/60 text-primary animate-pulse" },
    speaking: { l: "Speaking…", c: "border-primary text-primary" },
    paused: { l: "Paused", c: "border-border text-muted-foreground" },
    error: { l: "Error", c: "border-destructive text-destructive" },
  } as const)[state];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Voice Assistant</h1>
        <p className="text-muted-foreground">Consent-first hands-free interface. Nothing listens until you press Start.</p>
      </header>

      {/* State + primary controls */}
      <div className="glass-panel gold-border p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 " + stateBadge.c}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />{stateBadge.l}
          </span>
          {sessionActiveRef.current && <span className="rounded-full border border-primary/60 text-primary px-2 py-1">SESSION MODE</span>}
          <span className="rounded-full border px-2 py-1">Mic: <b>{micPerm}</b></span>
          <span className="rounded-full border px-2 py-1">STT: <b>{supported ? "supported" : "unsupported"}</b></span>
          <span className="rounded-full border px-2 py-1">TTS: <b>{ttsSupported ? "supported" : "unsupported"}</b></span>
        </div>

        {errorMsg && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!sessionActiveRef.current && (
            <>
              <Button onMouseDown={() => void requestMicAndStart("ptt")} onMouseUp={stopRecognition} onMouseLeave={stopRecognition}
                variant="default" disabled={!supported}>
                <Mic className="h-4 w-4" /> Hold to talk
              </Button>
              <Button onClick={() => void requestMicAndStart("session")} variant="secondary" disabled={!supported}>
                <Radio className="h-4 w-4" /> Start session mode
              </Button>
            </>
          )}
          {sessionActiveRef.current && (
            <Button onClick={endSession} variant="destructive">
              <PhoneOff className="h-4 w-4" /> End session
            </Button>
          )}
          <Button onClick={stopEverything} variant="ghost" title="Stop mic + TTS immediately">
            <StopCircle className="h-4 w-4" /> Stop
          </Button>
          <Button onClick={previewVoice} variant="ghost" disabled={!ttsSupported}>
            <Volume2 className="h-4 w-4" /> Preview voice
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Press and hold <kbd className="border rounded px-1">Space</kbd> anywhere on this page to push-to-talk.
          Session mode keeps the mic open with a persistent LISTENING indicator — end it explicitly to stop.
        </p>

        {interim && (
          <div className="rounded-md border bg-background/40 p-2 text-sm italic text-muted-foreground">
            {interim}
          </div>
        )}
      </div>

      {/* Session settings */}
      <div className="glass-panel p-4 md:p-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="display text-lg">Session</h2>
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm">Wake phrase (“Raven” / “Hey Raven”)</label>
            <Switch checked={voicePrefs.wakePhraseEnabled} onCheckedChange={(v) => updateVoicePrefs({ wakePhraseEnabled: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm">Direct dictation (no wake phrase inside session)</label>
            <Switch checked={voicePrefs.directDictation} onCheckedChange={(v) => updateVoicePrefs({ directDictation: v })} />
          </div>
          <div className="text-xs text-muted-foreground">
            Wake phrase gates apply only inside session mode. Push-to-talk always sends what you say.
          </div>
        </div>
        <div className="space-y-3">
          <h2 className="display text-lg">Input</h2>
          <div className="flex flex-col gap-2">
            <Select value={inputLang} onValueChange={(v) => { setInputLang(v); void rah.updatePrefs({ voiceLang: v }); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LANGS.map((l) => <SelectItem key={l.v} value={l.v}>{l.l}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={micId || "default"} onValueChange={(v) => setMicId(v === "default" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Microphone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">System default microphone</SelectItem>
                {mics.map((m) => <SelectItem key={m.deviceId} value={m.deviceId}>{m.label || "Microphone"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* TTS settings */}
      <div className="glass-panel p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="display text-lg">Speech output</h2>
          <div className="flex items-center gap-2 text-xs">
            <label>Enable TTS on responses</label>
            <Switch checked={rah.prefs.ttsEnabled} onCheckedChange={(v) => void rah.updatePrefs({ ttsEnabled: v })} />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground">Voice</label>
            <Select value={rah.prefs.ttsVoice || "default"} onValueChange={(v) => void rah.updatePrefs({ ttsVoice: v === "default" ? undefined : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">System default</SelectItem>
                {voices.map((v) => <SelectItem key={v.name} value={v.name}>{v.name} — {v.lang}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Output language</label>
            <Select value={voicePrefs.outputLang} onValueChange={(v) => updateVoicePrefs({ outputLang: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LANGS.map((l) => <SelectItem key={l.v} value={l.v}>{l.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Rate ({(rah.prefs.ttsRate ?? 1).toFixed(2)})</label>
            <Slider min={0.5} max={2} step={0.05} value={[rah.prefs.ttsRate ?? 1]} onValueChange={([v]) => void rah.updatePrefs({ ttsRate: v })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Pitch ({voicePrefs.ttsPitch.toFixed(2)})</label>
            <Slider min={0} max={2} step={0.05} value={[voicePrefs.ttsPitch]} onValueChange={([v]) => updateVoicePrefs({ ttsPitch: v })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Volume ({voicePrefs.ttsVolume.toFixed(2)})</label>
            <Slider min={0} max={1} step={0.05} value={[voicePrefs.ttsVolume]} onValueChange={([v]) => updateVoicePrefs({ ttsVolume: v })} />
          </div>
        </div>
      </div>

      {/* Transcript timeline */}
      <div className="glass-panel p-4 md:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="display text-lg">This session</h2>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setTurns([]); setSummarySuggestion(null); }}>
              <Trash2 className="h-4 w-4" /> Clear
            </Button>
          </div>
        </div>
        {!turns.length && <p className="text-sm text-muted-foreground">Nothing yet. This transcript is in-memory only and disappears when you leave the page.</p>}
        <ul className="space-y-2">
          {turns.map((t, i) => (
            <li key={i} className={"rounded-md border p-2 text-sm " + (t.role === "user" ? "border-primary/40 bg-primary/5" : "bg-background/40")}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.role}</div>
              <div className="whitespace-pre-wrap">{t.text}</div>
            </li>
          ))}
        </ul>

        {summarySuggestion && (
          <div className="rounded-md border border-primary/50 bg-primary/5 p-3 text-sm space-y-2">
            <div className="font-semibold text-primary">Save summary to Memory?</div>
            <div className="text-xs text-muted-foreground">{summarySuggestion.draft.title}</div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveSummaryToMemory}><Save className="h-4 w-4" /> Save to Memory</Button>
              <Button size="sm" variant="ghost" onClick={() => setSummarySuggestion(null)}>Not now</Button>
            </div>
          </div>
        )}
      </div>

      {/* Diagnostics */}
      <details className="glass-panel p-4 md:p-5" open>
        <summary className="cursor-pointer display text-lg">Diagnostics</summary>
        <ul className="mt-3 text-sm space-y-1">
          <li>SpeechRecognition: <b>{String(diagnostics.sttSupported)}</b></li>
          <li>speechSynthesis: <b>{String(diagnostics.ttsSupported)}</b></li>
          <li>Microphone permission: <b>{diagnostics.micPermission}</b></li>
          <li>Input language: <b>{diagnostics.inputLang}</b></li>
          <li>Output language: <b>{diagnostics.outputLang}</b></li>
          <li>Active engine: <b>{diagnostics.engine}</b></li>
          <li>Bridge connected: <b>{String(diagnostics.bridgeOnline)}</b></li>
          <li>Background wake-word: <b>never</b> — {diagnostics.honestCapabilityStatement}</li>
        </ul>
      </details>

      <p className="text-xs text-muted-foreground">
        Privacy: no background listening, no audio recording is stored, no hidden uploads.
        Transcripts remain on this page until you explicitly send a command or save a summary.
      </p>
    </div>
  );
}

// silence unused imports in strict builds
void Play; void Square;