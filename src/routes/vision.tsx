import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MonitorPlay, Square, Camera, Send, Copy, Trash2,
  RotateCcw, ShieldCheck, MessageSquare, ShieldAlert, Save, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/rah/Markdown";
import { queuePendingImage } from "@/lib/rah/images";
import {
  MAX_ANALYZE_EDGE, PRIVACY_NOTE, SCREEN_VISION_PRESETS, NO_FRAME_RECOVERY_HINT,
  buildScreenVisionRuntimeLine, computeCaptureSize, sharingStateLabel,
  isCaptureReady, computeSamplePoints, analyzeSamples, isLikelyBlankFrame,
  estimateFps, pickCaptureMethod, readinessFromSignals, formatDiagnostics,
  PREVIEW_UNAVAILABLE_LABEL,
  type SharingState,
  type ScreenVisionDiagnostics,
} from "@/lib/rah/screenVision";
import {
  classifyPrivacy, classIsSensitive, selectFrameVariant,
  validateRedactionRegions, nextReviewState, shapeEvidenceRecord,
  PRIVACY_HEURISTIC_DISCLAIMER, PRIVACY_CLASS_LABEL,
  type RedactionRegion,
} from "@/lib/rah/visionSessions";
import { getDB, uid } from "@/lib/rah/db";

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

type ReviewStage = "idle" | "captured" | "confirming_sensitive" | "analyzing" | "reviewing_result";

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

function browserSupportsImageCapture(): boolean {
  return typeof window !== "undefined"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    && typeof (window as any).ImageCapture === "function";
}

async function tryGrabFrame(track: MediaStreamTrack): Promise<ImageBitmap | null> {
  if (!browserSupportsImageCapture()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const IC: any = (window as any).ImageCapture;
    const cap = new IC(track);
    const bmp: ImageBitmap = await cap.grabFrame();
    if (!bmp || !bmp.width || !bmp.height) return null;
    return bmp;
  } catch {
    return null;
  }
}

// Wait until the <video> element actually has a drawable frame.
// Prefers requestVideoFrameCallback when available; falls back to rAF polling.
// Rejects on timeout or abort with a clear message.
function waitForVideoFrame(
  video: HTMLVideoElement,
  timeoutMs = 5000,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Aborted waiting for first video frame.")); return; }
    const ready = () =>
      video.readyState >= 2 /* HAVE_CURRENT_DATA */
      && video.videoWidth > 0
      && video.videoHeight > 0;
    if (ready()) { cleanup(); resolve(); return; }

    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error("Timed out waiting for the first video frame. " + NO_FRAME_RECOVERY_HINT));
    }, Math.max(500, timeoutMs));

    const onAbort = () => {
      if (done) return;
      cleanup();
      reject(new Error("Aborted waiting for first video frame."));
    };
    signal?.addEventListener("abort", onAbort);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rvfc = (video as any).requestVideoFrameCallback?.bind(video) as
      | ((cb: (now: number, meta: unknown) => void) => number) | undefined;

    let rafId = 0;
    const tick = () => {
      if (done) return;
      if (ready()) { cleanup(); resolve(); return; }
      rafId = requestAnimationFrame(tick);
    };
    if (rvfc) {
      const spin = () => { if (done) return; if (ready()) { cleanup(); resolve(); return; } rvfc(spin); };
      rvfc(spin);
      // also poll rAF as a safety net in case rvfc stalls
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = requestAnimationFrame(tick);
    }

    function cleanup() {
      done = true;
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
      signal?.removeEventListener("abort", onAbort);
    }
  });
}

function sampleFrameStats(
  ctx: CanvasRenderingContext2D, width: number, height: number,
) {
  const pts = computeSamplePoints(width, height);
  const samples = pts.map(({ x, y }) => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  });
  return analyzeSamples(samples);
}

async function encodeCanvasJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Frame encode failed."))),
      "image/jpeg", 0.85,
    ),
  );
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Frame read failed."));
    r.readAsDataURL(blob);
  });
}

// Capture via ImageCapture.grabFrame(): draw the bitmap to a canvas, close
// the bitmap, encode JPEG. Returns null if ImageCapture is not viable.
async function captureViaImageCapture(
  track: MediaStreamTrack, maxEdge = MAX_ANALYZE_EDGE,
): Promise<CapturedFrame | null> {
  const bmp = await tryGrabFrame(track);
  if (!bmp) return null;
  try {
    const { width, height } = computeCaptureSize(bmp.width, bmp.height, maxEdge);
    if (width === 0 || height === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, width, height);
    const stats = sampleFrameStats(ctx, width, height);
    if (isLikelyBlankFrame(stats)) return null;
    const blob = await encodeCanvasJpeg(canvas);
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, width, height, sizeBytes: blob.size, capturedAt: Date.now() };
  } finally {
    try { bmp.close(); } catch { /* older browsers */ }
  }
}

async function captureCurrentFrame(
  video: HTMLVideoElement, maxEdge = MAX_ANALYZE_EDGE,
): Promise<CapturedFrame> {
  // Ensure a fresh, drawable frame right before capture — protects against
  // minimized/hidden/backgrounded tabs returning a stale/black frame.
  await waitForVideoFrame(video, 4000);
  const srcW = video.videoWidth, srcH = video.videoHeight;
  const { width, height } = computeCaptureSize(srcW, srcH, maxEdge);
  if (width === 0 || height === 0) throw new Error("No video frame available yet.");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable.");
  // Draw with up to a few retries if the first frame comes back blank.
  let stats = { avgLuma: 0, maxLuma: 0, nonBlackRatio: 0, count: 0 };
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    ctx.drawImage(video, 0, 0, width, height);
    stats = sampleFrameStats(ctx, width, height);
    if (!isLikelyBlankFrame(stats)) break;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 120));
      try { await waitForVideoFrame(video, 1500); } catch { /* fall through */ }
    }
  }
  if (isLikelyBlankFrame(stats)) {
    throw new Error(
      "Captured frame appears blank. " + NO_FRAME_RECOVERY_HINT,
    );
  }
  const blob = await encodeCanvasJpeg(canvas);
  const dataUrl = await blobToDataUrl(blob);
  return { dataUrl, width, height, sizeBytes: blob.size, capturedAt: Date.now() };
}

function VisionPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const readyAbortRef = useRef<AbortController | null>(null);
  const fpsRef = useRef<number[]>([]);
  const fpsRvfcRef = useRef<number | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [supported] = useState<boolean>(() => browserSupportsDisplayMedia());
  const [sharing, setSharing] = useState<SharingState>(supported ? "idle" : "unsupported");
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [question, setQuestion] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [resolution, setResolution] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [fps, setFps] = useState<number>(0);
  const [noFrameHint, setNoFrameHint] = useState<string>("");
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [imageCaptureReady, setImageCaptureReady] = useState<boolean>(false);
  const [imageCaptureLastOk, setImageCaptureLastOk] = useState<boolean>(true);
  const [imageCaptureLastError, setImageCaptureLastError] = useState<string>("");
  const [videoLastError, setVideoLastError] = useState<string>("");
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);

  // Screen Vision v0.2 additions ----------------------------------------
  const [reviewStage, setReviewStage] = useState<ReviewStage>("idle");
  const [pendingFrame, setPendingFrame] = useState<CapturedFrame | null>(null);
  const [userMarkedSensitive, setUserMarkedSensitive] = useState(false);
  const [privacyNote, setPrivacyNote] = useState("");
  const [regions, setRegions] = useState<RedactionRegion[]>([]);
  const [showRedactionPanel, setShowRedactionPanel] = useState(false);
  const [previewRedacted, setPreviewRedacted] = useState(true);
  const [redactedDataUrl, setRedactedDataUrl] = useState<string>("");
  const [savedEvidenceId, setSavedEvidenceId] = useState<string | null>(null);
  const [regionDraft, setRegionDraft] = useState<{ x: string; y: string; w: string; h: string; label: string }>({ x: "", y: "", w: "", h: "", label: "" });

  const privacy = useMemo(() =>
    classifyPrivacy({
      userMarkedSensitive,
      note: privacyNote,
      question,
      sourceLabel,
    }), [userMarkedSensitive, privacyNote, question, sourceLabel]);

  const variantChoice = useMemo(() => selectFrameVariant({
    regions,
    privacyClass: privacy.class,
    userChoice: previewRedacted && regions.length > 0 ? "redacted" : "original",
  }), [regions, privacy.class, previewRedacted]);

  const advanceReview = useCallback((event: Parameters<typeof nextReviewState>[1]) => {
    setReviewStage((s) => nextReviewState(s, event) as ReviewStage);
  }, []);

  // Build a redacted preview by drawing black rectangles over accepted regions.
  useEffect(() => {
    if (!pendingFrame || regions.length === 0) { setRedactedDataUrl(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const img = new Image();
        img.src = pendingFrame.dataUrl;
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("preview_load_failed")); });
        const canvas = document.createElement("canvas");
        canvas.width = pendingFrame.width;
        canvas.height = pendingFrame.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#000";
        for (const r of regions) ctx.fillRect(r.x, r.y, r.w, r.h);
        const url = canvas.toDataURL("image/jpeg", 0.85);
        if (!cancelled) setRedactedDataUrl(url);
      } catch { /* ignore preview failures */ }
    })();
    return () => { cancelled = true; };
  }, [pendingFrame, regions]);

  // Cleanup on unmount: stop any active tracks + abort any in-flight request.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      readyAbortRef.current?.abort();
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const stopSharing = useCallback((reason: SharingState = "idle") => {
    readyAbortRef.current?.abort();
    readyAbortRef.current = null;
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSourceLabel("");
    setResolution({ w: 0, h: 0 });
    setFps(0);
    fpsRef.current = [];
    setNoFrameHint("");
    setVideoReady(false);
    setImageCaptureReady(false);
    setImageCaptureLastOk(true);
    setImageCaptureLastError("");
    setVideoLastError("");
    setShowDiagnostics(false);
    setSharing(reason);
  }, []);

  const startSharing = useCallback(async () => {
    if (!supported) { setSharing("unsupported"); return; }
    setSharing("requesting");
    setNoFrameHint("");
    setVideoReady(false);
    setImageCaptureReady(false);
    setImageCaptureLastOk(true);
    setImageCaptureLastError("");
    setVideoLastError("");
    setShowDiagnostics(false);
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
      trackRef.current = track;
      const settings = track.getSettings?.() ?? {};
      const label = track.label
        || (settings.displaySurface ? String(settings.displaySurface) : "selected screen source");
      setSourceLabel(label);
      track.addEventListener("ended", () => {
        stopSharing("ended");
      });
      const v = videoRef.current;
      if (!v) { stopSharing("error"); return; }
      setSharing("stream-connected");
      v.srcObject = stream;

      // Wait for metadata so width/height are known.
      await new Promise<void>((resolve) => {
        if (v.readyState >= 1 && v.videoWidth > 0) return resolve();
        const onMeta = () => { v.removeEventListener("loadedmetadata", onMeta); resolve(); };
        v.addEventListener("loadedmetadata", onMeta);
      });
      try { await v.play(); } catch { /* autoplay policy — playsInline handles it */ }
      setSharing("waiting-frame");
      setResolution({ w: v.videoWidth, h: v.videoHeight });

      readyAbortRef.current?.abort();
      const ctl = new AbortController();
      readyAbortRef.current = ctl;

      // Dual readiness: whichever path yields a real frame first wins. We
      // do NOT fail the session just because <video> stays black — Chromium
      // often decodes into ImageCapture even when the preview cannot paint.
      let done = false;
      const kickFpsLoop = () => {
        fpsRef.current = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rvfc = (v as any).requestVideoFrameCallback?.bind(v);
        const push = (t: number) => {
          const arr = fpsRef.current;
          arr.push(t);
          if (arr.length > 30) arr.shift();
          if (arr.length % 5 === 0) setFps(estimateFps(arr));
        };
        if (rvfc) {
          const loop = (now: number) => {
            if (!streamRef.current) return;
            push(now);
            fpsRvfcRef.current = rvfc(loop);
          };
          fpsRvfcRef.current = rvfc(loop);
        } else {
          const loop = () => {
            if (!streamRef.current) return;
            push(performance.now());
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        }
      };

      // Path A: HTMLVideoElement first-frame.
      const videoPath = (async () => {
        try {
          await waitForVideoFrame(v, 5000, ctl.signal);
          if (done || ctl.signal.aborted) return;
          setVideoReady(true);
          setResolution({ w: v.videoWidth, h: v.videoHeight });
          if (!done) { done = true; setSharing("ready"); kickFpsLoop(); }
        } catch (err) {
          if ((err as { name?: string })?.name !== "AbortError") {
            setVideoLastError((err as Error)?.message || "video frame timeout");
          }
        }
      })();

      // Path B: ImageCapture (Chromium). Poll grabFrame() a few times.
      const imagePath = (async () => {
        if (!browserSupportsImageCapture()) {
          setImageCaptureLastOk(false);
          setImageCaptureLastError("ImageCapture not supported in this browser");
          return;
        }
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !ctl.signal.aborted && !done) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const IC: any = (window as any).ImageCapture;
            const cap = new IC(track);
            const bmp: ImageBitmap = await cap.grabFrame();
            if (bmp && bmp.width > 0 && bmp.height > 0) {
              try { bmp.close(); } catch { /* older browsers */ }
              setImageCaptureReady(true);
              setImageCaptureLastOk(true);
              setImageCaptureLastError("");
              if (v.videoWidth > 0) setResolution({ w: v.videoWidth, h: v.videoHeight });
              else setResolution({ w: bmp.width, h: bmp.height });
              if (!done) { done = true; setSharing("ready"); kickFpsLoop(); }
              return;
            }
          } catch (err) {
            setImageCaptureLastOk(false);
            setImageCaptureLastError((err as Error)?.message || String(err));
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      })();

      await Promise.race([videoPath, imagePath]);
      // Let both settle so late signals still land.
      await Promise.allSettled([videoPath, imagePath]);
      if (!done && !ctl.signal.aborted) {
        setNoFrameHint(NO_FRAME_RECOVERY_HINT);
        setSharing("error");
        setShowDiagnostics(true);
        toast.error("Screen sharing started but no frame arrived. " + NO_FRAME_RECOVERY_HINT);
      }
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setSharing("denied");
        toast.error("Screen sharing was denied. Click 'Share screen with Raven' to try again.");
      } else {
        setSharing("error");
        setShowDiagnostics(true);
        toast.error("Could not start screen sharing. " + (err instanceof Error ? err.message : String(err)));
      }
    }
  }, [supported, stopSharing]);

  const clearAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAnalysis(null);
    setPendingFrame(null);
    setRegions([]);
    setUserMarkedSensitive(false);
    setPrivacyNote("");
    setRedactedDataUrl("");
    setSavedEvidenceId(null);
    setReviewStage("idle");
  }, []);

  // Capture ONLY — no AI. This is Step 1 of the mandatory Capture Review.
  const captureNow = useCallback(async () => {
    if (!isCaptureReady(sharing) || !videoRef.current) {
      toast.error("Start screen sharing first.");
      return;
    }
    setSharing("capturing");
    try {
      const method = pickCaptureMethod({
        imageCaptureAvailable: browserSupportsImageCapture() && !!trackRef.current,
        imageCaptureLastOk,
        videoHasFrame: videoReady,
      });
      let captured: CapturedFrame | null = null;
      if (method === "image-capture" && trackRef.current) {
        try { captured = await captureViaImageCapture(trackRef.current); } catch { /* fall through */ }
      }
      if (!captured) captured = await captureCurrentFrame(videoRef.current);
      setPendingFrame(captured);
      setRegions([]);
      setUserMarkedSensitive(false);
      setPrivacyNote("");
      setRedactedDataUrl("");
      setSavedEvidenceId(null);
      setAnalysis(null);
      advanceReview("capture");
      setSharing("ready");
    } catch (err) {
      toast.error("Capture failed: " + (err instanceof Error ? err.message : String(err)));
      setSharing("ready");
    }
  }, [sharing, imageCaptureLastOk, videoReady, advanceReview]);

  // Send the reviewed frame to AI. Enforces the sensitive-confirmation gate.
  const analyzeReviewed = useCallback(async (opts: { forceOriginal?: boolean } = {}) => {
    if (!pendingFrame) { toast.error("Capture a frame first."); return; }
    const trimmed = (question || "").trim() || "Describe what's on this screen and tell me what to do next.";
    // Pick variant honoring current toggle + sensitivity gate.
    const chosen = selectFrameVariant({
      regions,
      privacyClass: privacy.class,
      userChoice: opts.forceOriginal ? "original" : (regions.length > 0 && previewRedacted ? "redacted" : "original"),
    });
    if (chosen.requiresSecondConfirmation && !opts.forceOriginal) {
      advanceReview("mark-sensitive");
      return; // UI shows confirmation modal / block
    }
    const useDataUrl = chosen.variant === "redacted" && redactedDataUrl ? redactedDataUrl : pendingFrame.dataUrl;
    advanceReview("analyze");
    setSharing("analyzing");
    setAnalysis({
      question: trimmed, frame: pendingFrame, state: "streaming", text: "",
      runtimeLine: buildScreenVisionRuntimeLine({ sourceLabel: sourceLabel || undefined, capturedAt: pendingFrame.capturedAt }),
      startedAt: Date.now(),
    });
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/rah-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          prompt: trimmed,
          agents: ["brain"],
          mode: "fast",
          images: [{ name: `screen-${chosen.variant}.jpg`, mime: "image/jpeg", dataUrl: useDataUrl }],
          context: { screenVision: true, sourceLabel, variant: chosen.variant, privacyClass: privacy.class,
            capturedAt: pendingFrame.capturedAt, frame: { width: pendingFrame.width, height: pendingFrame.height, sizeBytes: pendingFrame.sizeBytes } },
        }),
      });
      if (!res.ok || !res.body) throw new Error(res.statusText || "Vision request failed.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", full = "";
      let provider: string | undefined, model: string | undefined, latencyMs: number | undefined;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          try {
            const ev = JSON.parse(t) as { type: string; text?: string; provider?: string; model?: string; latencyMs?: number; message?: string };
            if (ev.type === "start") { provider = ev.provider; model = ev.model; }
            else if (ev.type === "delta" && ev.text) { full += ev.text; const snap = full; setAnalysis((a) => a ? { ...a, text: snap } : a); }
            else if (ev.type === "done") { provider = ev.provider ?? provider; model = ev.model ?? model; latencyMs = ev.latencyMs; if (ev.text) full = ev.text; }
            else if (ev.type === "error") throw new Error(ev.message || "Vision failed");
          } catch (parseErr) { if (parseErr instanceof Error && parseErr.message) throw parseErr; }
        }
      }
      setAnalysis((a) => a ? {
        ...a, state: "done", text: full, provider, model, latencyMs,
        runtimeLine: buildScreenVisionRuntimeLine({ provider, model, latencyMs, sourceLabel: sourceLabel || undefined, capturedAt: pendingFrame.capturedAt }),
      } : a);
      advanceReview("analyze-done");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setAnalysis((a) => a ? { ...a, state: "error", error: msg } : a);
      toast.error("Vision analysis failed: " + msg);
      advanceReview("analyze-error");
    } finally {
      setSharing((s) => (s === "analyzing" || s === "capturing") ? "ready" : s);
    }
  }, [pendingFrame, question, regions, privacy.class, previewRedacted, redactedDataUrl, sourceLabel, advanceReview]);

  // Save current pending frame + AI result as an append-only evidence record.
  const saveEvidence = useCallback(async () => {
    if (!pendingFrame) { toast.error("No captured frame to save."); return; }
    try {
      const rec = shapeEvidenceRecord({
        id: uid(),
        sessionId: null,
        projectId: null,
        createdAt: Date.now(),
        frame: { width: pendingFrame.width, height: pendingFrame.height, sizeBytes: pendingFrame.sizeBytes, capturedAt: pendingFrame.capturedAt, mime: "image/jpeg", captureMethod: "video-canvas", hash: null },
        redactedFrame: regions.length > 0 && redactedDataUrl ? { width: pendingFrame.width, height: pendingFrame.height, sizeBytes: Math.round(redactedDataUrl.length * 0.75), capturedAt: pendingFrame.capturedAt, mime: "image/jpeg", captureMethod: "video-canvas", hash: null } : null,
        redactionRegions: regions,
        privacy: { class: privacy.class, reasons: privacy.reasons },
        notes: privacyNote,
        sourceLabel,
        linkedResultId: null,
      });
      const db = await getDB();
      await db.put("visionEvidence", rec);
      setSavedEvidenceId(rec.id);
      toast.success("Evidence saved locally (append-only)");
    } catch (err) {
      toast.error("Failed to save evidence: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [pendingFrame, regions, redactedDataUrl, privacy, privacyNote, sourceLabel]);

  const addRegionFromDraft = useCallback(() => {
    if (!pendingFrame) return;
    const raw = { x: Number(regionDraft.x), y: Number(regionDraft.y), w: Number(regionDraft.w), h: Number(regionDraft.h), label: regionDraft.label || null };
    const res = validateRedactionRegions([raw], { width: pendingFrame.width, height: pendingFrame.height });
    if (res.rejected.length > 0) {
      toast.error("Region rejected: " + res.rejected[0].reason);
      return;
    }
    setRegions((r) => [...r, ...res.accepted]);
    setRegionDraft({ x: "", y: "", w: "", h: "", label: "" });
  }, [pendingFrame, regionDraft]);

  const analyzeNow = useCallback(async (userQuestion: string) => {
    if (!isCaptureReady(sharing) || !videoRef.current) {
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
    setSharing("capturing");
    try {
      const method = pickCaptureMethod({
        imageCaptureAvailable: browserSupportsImageCapture() && !!trackRef.current,
        imageCaptureLastOk,
        videoHasFrame: videoReady,
      });
      let captured: CapturedFrame | null = null;
      if (method === "image-capture" && trackRef.current) {
        try {
          captured = await captureViaImageCapture(trackRef.current);
          if (captured) {
            setImageCaptureLastOk(true);
            setImageCaptureLastError("");
          }
        } catch (err) {
          setImageCaptureLastOk(false);
          setImageCaptureLastError((err as Error)?.message || String(err));
        }
      }
      if (!captured) {
        captured = await captureCurrentFrame(videoRef.current);
      }
      frame = captured;
    } catch (err) {
      setAnalysis((a) => a ? { ...a, state: "error", error: err instanceof Error ? err.message : String(err) } : a);
      setSharing("ready");
      setShowDiagnostics(true);
      return;
    }
    setSharing("analyzing");

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
    } finally {
      setSharing((s) => (s === "analyzing" || s === "capturing") ? "ready" : s);
    }
  }, [sharing, sourceLabel, imageCaptureLastOk, videoReady]);

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
  const ready = isCaptureReady(sharing) || readinessFromSignals({ videoReady, imageCaptureReady });
  const active = ready || sharing === "waiting-frame" || sharing === "stream-connected"
    || sharing === "capturing" || sharing === "analyzing";
  const previewAvailable = videoReady;

  const diagnostics: ScreenVisionDiagnostics = useMemo(() => {
    const v = videoRef.current;
    const t = trackRef.current;
    const settings = t?.getSettings?.() ?? {};
    return {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      supportsGetDisplayMedia: supported,
      supportsImageCapture: browserSupportsImageCapture(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supportsVideoFrameCallback: !!(v && typeof (v as any).requestVideoFrameCallback === "function"),
      videoReadyState: v?.readyState,
      videoWidth: v?.videoWidth,
      videoHeight: v?.videoHeight,
      videoPaused: v?.paused,
      videoEnded: v?.ended,
      trackReadyState: t?.readyState,
      trackMuted: t?.muted,
      trackLabel: t?.label,
      displaySurface: (settings as { displaySurface?: string }).displaySurface,
      imageCaptureLastOk,
      imageCaptureLastError: imageCaptureLastError || undefined,
      videoLastError: videoLastError || undefined,
      previewAvailable,
      captureMethod: pickCaptureMethod({
        imageCaptureAvailable: browserSupportsImageCapture() && !!t,
        imageCaptureLastOk,
        videoHasFrame: videoReady,
      }),
    };
  }, [sharing, supported, imageCaptureLastOk, imageCaptureLastError, videoLastError, previewAvailable, videoReady]);

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
          {!active ? (
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
                className={
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold pulse-gold " +
                  (ready
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-yellow-500/60 bg-yellow-500/10 text-yellow-500")
                }
                role="status"
                aria-live="polite"
              >
                <span className={"inline-block h-2.5 w-2.5 rounded-full animate-pulse " + (ready ? "bg-primary" : "bg-yellow-500")} />
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
          {active && sourceLabel && (
            <span className="text-xs text-muted-foreground truncate max-w-[60ch]" title={sourceLabel}>
              Sharing: <span className="text-foreground">{sourceLabel}</span>
              {resolution.w > 0 && (
                <span className="ml-2 text-muted-foreground/80">
                  · {resolution.w}×{resolution.h}
                  {ready && fps > 0 ? <> · ~{fps.toFixed(0)} fps</> : null}
                  · {ready ? "frame ready" : "waiting for first frame"}
                </span>
              )}
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
        {sharing === "error" && noFrameHint && (
          <div className="rounded-md border border-yellow-500/60 bg-yellow-500/10 p-3 text-sm">
            <strong>Preview connected but no frame arrived.</strong> {NO_FRAME_RECOVERY_HINT}
          </div>
        )}
        {ready && !previewAvailable && (
          <div className="rounded-md border border-primary/60 bg-primary/10 p-3 text-sm text-primary">
            {PREVIEW_UNAVAILABLE_LABEL}. Capture &amp; Analyze still works via the browser's ImageCapture path.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="relative rounded-md overflow-hidden border border-border/60 bg-black/60 aspect-video grid place-items-center">
            <video
              ref={videoRef}
              autoPlay muted playsInline
              className={
                "w-full h-full object-contain " +
                (active ? (previewAvailable ? "" : "opacity-0 pointer-events-none") : "hidden")
              }
              aria-label="Live preview of your shared screen"
            />
            {!active && (
              <div className="text-center p-6 text-sm text-muted-foreground">
                <MonitorPlay className="h-8 w-8 mx-auto mb-2 opacity-60" />
                Live preview will appear here after you approve the browser prompt.
              </div>
            )}
            {active && !ready && (
              <div className="absolute text-xs text-yellow-500 bg-black/50 rounded px-2 py-1">
                Waiting for first frame…
              </div>
            )}
            {active && ready && !previewAvailable && (
              <div className="absolute text-xs text-primary bg-black/70 rounded px-2 py-1 text-center max-w-[80%]">
                Live preview unavailable — capture still works.
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
                onClick={() => void captureNow()}
                disabled={!ready || streaming}
                className="min-w-40"
              >
                <Camera className="h-4 w-4" /> Capture frame
              </Button>
              {analysis && (
                <>
                  <Button
                    type="button" variant="ghost"
                    onClick={() => void captureNow()}
                    disabled={!ready || streaming}
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
              <span>
                {PRIVACY_NOTE}
                <br />
                <em className="opacity-80">{PRIVACY_HEURISTIC_DISCLAIMER}</em>
              </span>
            </div>
          </div>
        </div>
      </section>

      {pendingFrame && reviewStage !== "idle" && (
        <section className="glass-panel gold-border p-4 md:p-5 space-y-4" aria-labelledby="rah-vision-review">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 id="rah-vision-review" className="display text-xl gold-text">Capture Review</h2>
            <span className={"text-xs rounded-full border px-3 py-1 " + (classIsSensitive(privacy.class) ? "border-destructive text-destructive" : "border-primary/60 text-primary")}>
              Privacy: {PRIVACY_CLASS_LABEL[privacy.class] || privacy.class}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              <img
                src={regions.length > 0 && previewRedacted && redactedDataUrl ? redactedDataUrl : pendingFrame.dataUrl}
                alt="Captured frame under review"
                className="w-full rounded-md border border-border/60"
              />
              <div className="text-[11px] text-muted-foreground">
                {pendingFrame.width}×{pendingFrame.height} · {Math.round(pendingFrame.sizeBytes / 1024)} KB · JPEG
                {" · captured "}
                {new Date(pendingFrame.capturedAt).toLocaleTimeString()}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Source: <span className="text-foreground">{sourceLabel || "—"}</span>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted-foreground uppercase tracking-widest">Question</div>
              <div className="text-foreground">{(question || "").trim() || "Describe what's on this screen and tell me what to do next."}</div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" type="button" onClick={() => void analyzeReviewed()} disabled={reviewStage !== "captured"}>
                  <MessageSquare className="h-4 w-4" /> Analyze
                </Button>
                <Button size="sm" type="button" variant="secondary" onClick={() => setShowRedactionPanel((v) => !v)} disabled={reviewStage !== "captured"}>
                  {previewRedacted ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  {showRedactionPanel ? "Hide redaction" : "Redact regions"}
                </Button>
                <Button size="sm" type="button" variant="secondary" onClick={() => void saveEvidence()} disabled={reviewStage !== "captured"}>
                  <Save className="h-4 w-4" /> Save evidence
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => void captureNow()}>
                  <RotateCcw className="h-4 w-4" /> Retake
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={clearAnalysis}>
                  <Trash2 className="h-4 w-4" /> Discard
                </Button>
              </div>

              <label className="flex items-center gap-2 text-xs pt-2">
                <input type="checkbox" checked={userMarkedSensitive} onChange={(e) => setUserMarkedSensitive(e.target.checked)} />
                <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                Mark this frame as sensitive
              </label>
              <textarea
                value={privacyNote}
                onChange={(e) => setPrivacyNote(e.target.value)}
                rows={2}
                placeholder="Optional privacy note (e.g. 'contains email addresses')"
                className="w-full rounded-md border border-border/70 bg-background/40 p-2 text-xs"
              />
              {savedEvidenceId && (
                <div className="text-[11px] text-primary">Saved as evidence <code>{savedEvidenceId}</code></div>
              )}

              {showRedactionPanel && (
                <div className="space-y-2 rounded-md border border-border/60 p-3">
                  <div className="text-xs text-muted-foreground">Add rectangular redaction regions (pixel coords, 0,0 = top-left). Preview draws opaque black over each region.</div>
                  <div className="flex flex-wrap gap-2 items-end">
                    {(["x","y","w","h"] as const).map((k) => (
                      <label key={k} className="text-[11px]">
                        {k}
                        <input
                          className="block w-16 rounded border border-border/70 bg-background/40 p-1 text-xs"
                          value={regionDraft[k]}
                          onChange={(e) => setRegionDraft({ ...regionDraft, [k]: e.target.value })}
                        />
                      </label>
                    ))}
                    <label className="text-[11px]">
                      label
                      <input
                        className="block w-32 rounded border border-border/70 bg-background/40 p-1 text-xs"
                        value={regionDraft.label}
                        onChange={(e) => setRegionDraft({ ...regionDraft, label: e.target.value })}
                      />
                    </label>
                    <Button size="sm" type="button" variant="secondary" onClick={addRegionFromDraft}>Add region</Button>
                    <label className="text-[11px] flex items-center gap-1 ml-auto">
                      <input type="checkbox" checked={previewRedacted} onChange={(e) => setPreviewRedacted(e.target.checked)} />
                      Send redacted variant to AI
                    </label>
                  </div>
                  {regions.length > 0 && (
                    <ul className="text-[11px] space-y-1">
                      {regions.map((r, i) => (
                        <li key={r.id} className="flex items-center gap-2">
                          <span>#{i + 1} · {r.label || "region"} · {r.x},{r.y} {r.w}×{r.h}</span>
                          <button type="button" className="text-destructive underline" onClick={() => setRegions((rs) => rs.filter((x) => x.id !== r.id))}>remove</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="text-[11px] text-muted-foreground">Variant that will be sent: <strong>{variantChoice.variant}</strong>{variantChoice.requiresSecondConfirmation && " (requires second confirmation)"}</div>
                </div>
              )}
            </div>
          </div>

          {reviewStage === "confirming_sensitive" && (
            <div className="rounded-md border border-destructive/70 bg-destructive/10 p-3 text-sm space-y-2" role="alertdialog">
              <div className="flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                <div>
                  <strong>Confirm sending original (unredacted) frame</strong>
                  <div className="text-xs opacity-90">This frame is marked sensitive. Sending the ORIGINAL image will transmit the full unredacted screenshot to the AI provider. Redact regions or send the redacted variant instead if possible.</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" type="button" onClick={() => void analyzeReviewed({ forceOriginal: true })}>
                  Send original anyway
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => advanceReview("cancel-send")}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

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

      {(sharing === "error" || showDiagnostics) && (
        <section className="glass-panel border border-yellow-500/40 p-4 space-y-2" aria-label="Screen Vision diagnostics">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-yellow-500">Diagnostics</h2>
            <div className="flex gap-2">
              <Button
                type="button" size="sm" variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(formatDiagnostics(diagnostics));
                    toast.success("Diagnostics copied");
                  } catch {
                    toast.error("Could not copy diagnostics");
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy diagnostics
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowDiagnostics(false)}>
                Hide
              </Button>
            </div>
          </div>
          <pre className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground bg-background/40 rounded p-2 border border-border/60 max-h-64 overflow-auto">
{formatDiagnostics(diagnostics)}
          </pre>
        </section>
      )}
    </div>
  );
}