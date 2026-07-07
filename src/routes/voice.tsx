import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Square, Play, Pause, Save, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createRecognizer, isSpeechSupported, listMicrophones, queryPermission } from "@/lib/rah/speech";
import { getDB, uid } from "@/lib/rah/db";
import { useRah } from "@/lib/rah/context";

export const Route = createFileRoute("/voice")({
  head: () => ({ meta: [{ title: "Voice Assistant — RAH Listen Key" }, { name: "description", content: "Real browser voice input, transcription and audio recording." }] }),
  component: VoicePage,
});

const LANGS = [
  { v: "en-US", l: "English (US)" },
  { v: "en-GB", l: "English (UK)" },
  { v: "nb-NO", l: "Norsk" },
  { v: "bn-BD", l: "বাংলা" },
];

function VoicePage() {
  const rah = useRah();
  const [supported] = useState(() => isSpeechSupported());
  const [state, setState] = useState<"idle" | "listening" | "error">("idle");
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");
  const [lang, setLang] = useState(rah.prefs.voiceLang);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState<string>("");
  const [micPerm, setMicPerm] = useState<string>("unknown");
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    queryPermission("microphone" as any).then((s) => setMicPerm(s));
    listMicrophones().then(setMics);
  }, []);

  function start() {
    if (!supported) { toast.error("Browser speech recognition is not available."); return; }
    const r = createRecognizer(lang); if (!r) return;
    recRef.current = r;
    r.onresult = (e: any) => {
      let i = "", f = "";
      for (let idx = e.resultIndex; idx < e.results.length; idx++) {
        const res = e.results[idx];
        if (res.isFinal) f += res[0].transcript; else i += res[0].transcript;
      }
      if (f) setTranscript((t) => (t ? t + " " : "") + f.trim());
      setInterim(i);
    };
    r.onerror = (e: any) => { setState("error"); toast.error("Voice error: " + (e?.error ?? "")); };
    r.onend = () => setState("idle");
    try { r.start(); setState("listening"); } catch {}
  }
  function stop() { try { recRef.current?.stop(); } catch {}; setState("idle"); setInterim(""); }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: mic ? { deviceId: { exact: mic } } : true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr; chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start(); setRecording(true);
    } catch (e: any) {
      toast.error("Microphone access denied or unavailable.");
    }
  }
  function stopRec() { mediaRef.current?.stop(); setRecording(false); }

  async function saveRecording() {
    if (!audioBlob) return;
    const db = await getDB();
    await db.put("files", {
      id: uid(), name: `voice-${new Date().toISOString()}.webm`, mime: audioBlob.type,
      size: audioBlob.size, createdAt: Date.now(), blob: audioBlob,
      projectId: rah.activeProject?.id, tags: ["voice"], folder: "voice", favorite: false,
    });
    toast.success("Recording saved to Files.");
  }

  const full = interim ? `${transcript}${transcript ? " " : ""}${interim}` : transcript;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Voice Assistant</h1>
        <p className="text-muted-foreground">Browser voice input, transcription and microphone recording. Nothing runs without your explicit action.</p>
      </header>

      <div className="glass-panel p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <span className="rounded-full border px-2 py-1">Mic permission: <b>{micPerm}</b></span>
          <span className="rounded-full border px-2 py-1">Recognition: <b>{supported ? "supported" : "unsupported"}</b></span>
          <span className={"rounded-full border px-2 py-1 " + (state === "listening" ? "border-primary text-primary pulse-gold" : "")}>
            State: <b>{state}</b>
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGS.map((l) => <SelectItem key={l.v} value={l.v}>{l.l}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={mic || "default"} onValueChange={(v) => setMic(v === "default" ? "" : v)}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Microphone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System default microphone</SelectItem>
              {mics.map((m) => <SelectItem key={m.deviceId} value={m.deviceId}>{m.label || "Microphone"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <textarea
          value={full}
          onChange={(e) => setTranscript(e.target.value)}
          rows={6}
          className="w-full rounded-md border bg-background/60 p-3 text-sm"
          placeholder="Live transcription will appear here. You can edit before saving or sending."
          aria-label="Live transcript"
        />

        <div className="flex flex-wrap gap-2">
          <Button onClick={state === "listening" ? stop : start} variant={state === "listening" ? "destructive" : "default"}>
            {state === "listening" ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {state === "listening" ? "Stop" : "Start listening"}
          </Button>
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(full).then(() => toast.success("Copied"))}>Copy</Button>
          <Button variant="ghost" onClick={() => { setTranscript(""); setInterim(""); }}><Trash2 className="h-4 w-4" /> Clear</Button>
          <Button
            variant="secondary"
            onClick={async () => {
              if (!full.trim()) return;
              await rah.addCommand({
                prompt: full.trim(), agents: ["brain"], mode: rah.prefs.defaultMode,
                fileIds: [], projectId: rah.activeProject?.id, inputType: "voice",
                status: rah.prefs.approvalMode === "advisory" ? "done" : "awaiting_approval",
                resultSummary: rah.prefs.provider ? "Awaiting provider response." : "Local demonstration — configure a provider in Settings.",
                demo: !rah.prefs.provider,
              });
              toast.success("Transcript saved as command.");
              setTranscript(""); setInterim("");
            }}
          >
            <Save className="h-4 w-4" /> Save transcript as command
          </Button>
        </div>
      </div>

      <div className="glass-panel p-4 md:p-5 space-y-3">
        <h2 className="display text-lg">Microphone recording</h2>
        <p className="text-sm text-muted-foreground">Record audio locally in your browser. Files are stored on this device and never uploaded without your action.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={recording ? stopRec : startRec} variant={recording ? "destructive" : "default"}>
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {recording ? "Stop recording" : "Record"}
          </Button>
          {audioUrl && (
            <>
              <Button variant="secondary" onClick={() => audioRef.current?.play()}><Play className="h-4 w-4" />Play</Button>
              <Button variant="secondary" onClick={() => audioRef.current?.pause()}><Pause className="h-4 w-4" />Pause</Button>
              <Button variant="secondary" onClick={saveRecording}><Save className="h-4 w-4" />Save to Files</Button>
              <Button variant="ghost" asChild><a href={audioUrl} download="recording.webm"><Download className="h-4 w-4" />Download</a></Button>
            </>
          )}
        </div>
        {audioUrl && <audio ref={audioRef} src={audioUrl} controls className="w-full" />}
      </div>

      <p className="text-xs text-muted-foreground">
        RAH Listen Key can only access audio you record, upload, or explicitly share through browser permissions. It cannot secretly hear system audio or other applications.
      </p>
    </div>
  );
}