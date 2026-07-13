import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MonitorPlay, Square, Camera, Send, Copy, Trash2,
  RotateCcw, ShieldCheck, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/rah/Markdown";
import { queuePendingImage } from "@/lib/rah/images";
import {
  MAX_ANALYZE_EDGE, PRIVACY_NOTE, SCREEN_VISION_PRESETS,
  buildScreenVisionRuntimeLine, computeCaptureSize, sharingStateLabel,
  type SharingState,
} from "@/lib/rah/screenVision";

export const Route = createFileRoute("/vision")({
  head: () => ({
    meta: [
      { title: "Raven Screen Vision — Share, capture, analyze" },
      { name: "description", content: "Consent-first screen sharing for Raven. Nothing is captured or uploaded unless you press Analyze." },
    ],
  }),
  component: VisionPage,
});

type AnalysisState = "idle" | "capturing" | "streaming" | "done" | "error";

interface CapturedFrame {
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  capturedAt: number;
}

interface AnalysisResult {
  question: string;
  frame: CapturedFrame;
  state: AnalysisState;
  text: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  error?: string;
  runtimeLine: string;
  startedAt: number;
}

function browserSupportsDisplayMedia(): boolean {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getDisplayMedia === "function";
}

async function captureCurrentFrame(
  video: HTMLVideoElement, maxEdge = MAX_ANALYZE_EDGE,
): Promise<CapturedFrame> {
  const srcW = video.videoWidth, srcH = video.videoHeight;
  const { width, height } = computeCaptureSize(srcW, srcH, maxEdge);
  if (width === 0 || height === 0) throw new Error("No video frame available yet.");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable.");
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Frame encode failed."))),
      "image/jpeg", 0.85,
    ),
  );
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Frame read failed."));
    r.readAsDataURL(blob);
  });
  return { dataUrl, width, height, sizeBytes: blob.size, capturedAt: Date.now() };
}

function VisionPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [supported] = useState<boolean>(() => browserSupportsDisplayMedia());
  const [sharing, setSharing] = useState<SharingState>(supported ? "idle" : "unsupported");
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [question, setQuestion] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // Cleanup on unmount: stop any active tracks + abort any in-flight request.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const stopSharing = useCallback((reason: SharingState = "idle") => {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSourceLabel("");
    setSharing(reason);
  }, []);

  const startSharing = useCallback(async () => {
    if (!supported) { setSharing("unsupported"); return; }
    setSharing("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stopSharing("error");
        toast.error("No video track was provided by the browser.");
        return;
      }
      const settings = track.getSettings?.() ?? {};
      const label = track.label
        || (settings.displaySurface ? String(settings.displaySurface) : "selected screen source");
      setSourceLabel(label);
      track.addEventListener("ended", () => {
        // User clicked "Stop sharing" in the browser chrome, or the source closed.
        stopSharing("ended");
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* autoplay policy is fine */ }
      }
      setSharing("active");
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setSharing("denied");
        toast.error("Screen sharing was denied. Click 'Share screen with Raven' to try again.");
      } else {
        setSharing("error");
        toast.error("Could not start screen sharing. " + (err instanceof Error ? err.message : String(err)));
      }
    }
  }, [supported, stopSharing]);

  const clearAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAnalysis(null);
  }, []);

  const analyzeNow = useCallback(async (userQuestion: string) => {
    if (sharing !== "active" || !videoRef.current) {
      toast.error("Start screen sharing first.");
      return;
    }
    const trimmed = (userQuestion || "").trim() || "Describe what's on this screen and tell me what to do next.";
    let frame: CapturedFrame;
    setAnalysis({
      question: trimmed,
      frame: { dataUrl: "", width: 0, height: 0, sizeBytes: 0, capturedAt: Date.now() },
      state: "capturing", text: "",
      runtimeLine: buildScreenVisionRuntimeLine({ sourceLabel: sourceLabel || undefined }),
      startedAt: Date.now(),
    });
    try {
      frame = await captureCurrentFrame(videoRef.current);
    } catch (err) {
      setAnalysis((a) => a ? { ...a, state: "error", error: err instanceof Error ? err.message : String(err) } : a);
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const started = Date.now();

    setAnalysis({
      question: trimmed, frame, state: "streaming", text: "",
      runtimeLine: buildScreenVisionRuntimeLine({ sourceLabel: sourceLabel || undefined, capturedAt: frame.capturedAt }),
      startedAt: started,
    });

    try {
      const res = await fetch("/api/rah-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          prompt: trimmed,
          agents: ["brain"],
          mode: "fast",
          images: [{ name: "screen-capture.jpg", mime: "image/jpeg", dataUrl: frame.dataUrl }],
          context: {
            screenVision: true,
            sourceLabel,
            capturedAt: frame.capturedAt,
            frame: { width: frame.width, height: frame.height, sizeBytes: frame.sizeBytes },
          },
        }),
      });
      if (!res.ok || !res.body) {
        let msg = res.statusText || "Vision request failed.";
        try { const j = await res.json() as { message?: string }; if (j.message) msg = j.message; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
      let provider: string | undefined; let model: string | undefined; let latencyMs: number | undefined;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          try {
            const ev = JSON.parse(t) as
              | { type: "start"; provider: string; model: string }
              | { type: "delta"; text: string }
              | { type: "done"; text: string; model: string; provider: string; latencyMs: number }
              | { type: "vision"; imageCount: number }
              | { type: "error"; message: string };
            if (ev.type === "start") {
              provider = ev.provider; model = ev.model;
              setAnalysis((a) => a ? {
                ...a, provider, model,
                runtimeLine: buildScreenVisionRuntimeLine({ provider, model, sourceLabel: sourceLabel || undefined, capturedAt: frame.capturedAt }),
              } : a);
            } else if (ev.type === "delta") {
              full += ev.text;
              const snapshot = full;
              setAnalysis((a) => a ? { ...a, state: "streaming", text: snapshot } : a);
            } else if (ev.type === "done") {
              provider = ev.provider ?? provider; model = ev.model ?? model; latencyMs = ev.latencyMs;
              const finalText = ev.text || full;
              setAnalysis((a) => a ? {
                ...a, state: "done", text: finalText, provider, model, latencyMs,
                runtimeLine: buildScreenVisionRuntimeLine({ provider, model, latencyMs, sourceLabel: sourceLabel || undefined, capturedAt: frame.capturedAt }),
              } : a);
            } else if (ev.type === "error") {
              throw new Error(ev.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message) throw parseErr;
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      setAnalysis((a) => a ? { ...a, state: "error", error: message } : a);
      toast.error("Vision analysis failed: " + message);
    }
  }, [sharing, sourceLabel]);

  const sendAnswerToCommandCenter = useCallback(() => {
    if (!analysis?.frame.dataUrl) { toast.error("No captured frame to send."); return; }
    queuePendingImage({
      name: `screen-${new Date(analysis.frame.capturedAt).toISOString().slice(11, 19)}.jpg`,
      mime: "image/jpeg",
      dataUrl: analysis.frame.dataUrl,
      width: analysis.frame.width,
      height: analysis.frame.height,
      sizeBytes: analysis.frame.sizeBytes,
    });
    toast.success("Snapshot queued — opening Command Center…");
    void navigate({ to: "/" });
  }, [analysis, navigate]);

  const statusLabel = useMemo(() => sharingStateLabel(sharing), [sharing]);
  const streaming = analysis?.state === "streaming" || analysis?.state === "capturing";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl md:text-4xl gold-text">Raven Screen Vision</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Share your screen once, then ask Raven what to do. Nothing is captured, uploaded, or saved unless you press <strong>Analyze</strong>.
          </p>
        </div>
        <Link to="/" className="text-xs text-primary hover:underline">← Back to Command Center</Link>
      </header>

      <section
        className={
          "glass-panel gold-border p-4 md:p-6 space-y-4 " +
          (sharing === "active" ? "ring-2 ring-primary/60" : "")
        }
        aria-labelledby="rah-vision-primary"
      >
        <div className="flex flex-wrap items-center gap-3">
          {sharing !== "active" ? (
            <Button
              size="lg"
              type="button"
              onClick={() => void startSharing()}
              disabled={!supported || sharing === "requesting"}
              className="h-12 px-6 text-base"
              id="rah-vision-primary"
            >
              <MonitorPlay className="h-5 w-5" />
              {sharing === "requesting" ? "Requesting permission…" : "Share screen with Raven"}
            </Button>
          ) : (
            <>
              <span
                className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary/15 px-4 py-2 text-sm font-semibold text-primary pulse-gold"
                role="status"
                aria-live="polite"
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                {statusLabel}
              </span>
              <Button
                type="button" variant="destructive" size="lg"
                onClick={() => stopSharing("idle")}
                className="h-12 px-5"
              >
                <Square className="h-4 w-4" /> Stop sharing
              </Button>
            </>
          )}
          {sharing === "active" && sourceLabel && (
            <span className="text-xs text-muted-foreground truncate max-w-[40ch]" title={sourceLabel}>
              Sharing: <span className="text-foreground">{sourceLabel}</span>
            </span>
          )}
        </div>

        {!supported && (
          <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive">
            Your browser doesn't support screen sharing (<code>getDisplayMedia</code>). Try the latest Chrome, Edge, or Firefox on desktop.
          </div>
        )}
        {sharing === "denied" && (
          <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm">
            Screen sharing permission was denied. Click <strong>Share screen with Raven</strong> again and pick a screen, window, or tab in the browser prompt.
          </div>
        )}
        {sharing === "ended" && (
          <div className="rounded-md border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            Screen sharing ended. Click <strong>Share screen with Raven</strong> to start again.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-md overflow-hidden border border-border/60 bg-black/60 aspect-video grid place-items-center">
            {sharing === "active" ? (
              <video
                ref={videoRef}
                autoPlay muted playsInline
                className="w-full h-full object-contain"
                aria-label="Live preview of your shared screen"
              />
            ) : (
              <div className="text-center p-6 text-sm text-muted-foreground">
                <MonitorPlay className="h-8 w-8 mx-auto mb-2 opacity-60" />
                Live preview will appear here after you approve the browser prompt.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label htmlFor="rah-vision-question" className="text-sm font-medium">
              Ask Raven about the screen
            </label>
            <textarea
              id="rah-vision-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="e.g. What should I click next to finish setup?"
              className="w-full rounded-md border border-border/70 bg-background/40 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex flex-wrap gap-2">
              {SCREEN_VISION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setQuestion(p.question)}
                  className="rounded-full border border-border/70 px-3 py-1 text-xs hover:border-primary hover:text-primary"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                onClick={() => void analyzeNow(question)}
                disabled={sharing !== "active" || streaming}
                className="min-w-40"
              >
                <Camera className="h-4 w-4" /> Capture & Analyze
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void analyzeNow(question)}
                disabled={sharing !== "active" || streaming || !question.trim()}
              >
                <MessageSquare className="h-4 w-4" /> Ask about current screen
              </Button>
              {analysis && (
                <>
                  <Button
                    type="button" variant="ghost"
                    onClick={() => void analyzeNow(analysis.question)}
                    disabled={sharing !== "active" || streaming}
                  >
                    <RotateCcw className="h-4 w-4" /> Retake
                  </Button>
                  <Button type="button" variant="ghost" onClick={clearAnalysis}>
                    <Trash2 className="h-4 w-4" /> Clear result
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs text-primary">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{PRIVACY_NOTE}</span>
            </div>
          </div>
        </div>
      </section>

      {analysis && (
        <section className="glass-panel gold-border p-4 md:p-5 space-y-3" aria-live="polite">
          <div
            className="rounded border border-primary/40 bg-primary/5 px-3 py-2 text-[11px] text-primary"
            data-testid="rah-screen-vision-runtime"
            title="Runtime metadata from Raven Command app state (not from the model)."
          >
            {analysis.runtimeLine}
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              {analysis.frame.dataUrl ? (
                <img
                  src={analysis.frame.dataUrl}
                  alt="Captured screen frame sent to Raven for analysis"
                  className="w-full rounded-md border border-border/60"
                />
              ) : (
                <div className="aspect-video rounded-md border border-border/60 bg-background/40 grid place-items-center text-xs text-muted-foreground">
                  Capturing…
                </div>
              )}
              <div className="text-[11px] text-muted-foreground">
                {analysis.frame.width > 0
                  ? `${analysis.frame.width}×${analysis.frame.height} · ${Math.round(analysis.frame.sizeBytes / 1024)} KB · JPEG`
                  : "—"}
              </div>
            </div>
            <div className="space-y-3 min-w-0">
              <div className="text-xs text-muted-foreground">
                <span className="uppercase tracking-widest">Question</span>
                <div className="mt-1 text-sm text-foreground">{analysis.question}</div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 p-3 min-h-[80px] max-h-[55vh] overflow-auto">
                {analysis.state === "capturing" && (
                  <div className="text-sm text-muted-foreground">Capturing frame…</div>
                )}
                {analysis.state === "streaming" && !analysis.text && (
                  <div className="text-sm text-muted-foreground">Analyzing screen…</div>
                )}
                {analysis.state === "error" ? (
                  <div className="text-sm text-destructive">
                    <strong>Vision failed:</strong> {analysis.error ?? "Unknown error."}
                  </div>
                ) : analysis.text ? (
                  <Markdown>{analysis.text}</Markdown>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button" size="sm" variant="secondary"
                  disabled={!analysis.text}
                  onClick={async () => {
                    await navigator.clipboard.writeText(analysis.text);
                    toast.success("Answer copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy answer
                </Button>
                <Button
                  type="button" size="sm" variant="secondary"
                  disabled={!analysis.frame.dataUrl}
                  onClick={sendAnswerToCommandCenter}
                >
                  <Send className="h-3.5 w-3.5" /> Send to Command Center
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}