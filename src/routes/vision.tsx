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
  proposeSafeAction, proposeWorkflowHandoff, buildConfirmationPayload,
  VISION_ACTION_CATALOG,
  type RedactionRegion,
} from "@/lib/rah/visionSessions";
import { hashFrameBytes } from "@/lib/rah/visionHash";
import { getDB, uid, type Project, type VisionResultRecord } from "@/lib/rah/db";
import {
  startSession as lifecycleStartSession,
  incrementCaptureCount as lifecycleIncrementCapture,
  endSession as lifecycleEndSession,
  cancelSession as lifecycleCancelSession,
  isSessionLive,
  createResult as lifecycleCreateResult,
  createResultVersion as lifecycleCreateResultVersion,
  canDispatchProposal,
  shapeSaveReceipt,
  type LifecycleSession,
  type VisionResult,
} from "@/lib/rah/visionLifecycle";
import {
  createPointerState, reducePointer, canUndo as canUndoState, canRedo as canRedoState,
  draftDrawRect, shortcutsAreSuppressed,
} from "@/lib/rah/visionPointer";
import {
  computeDisplayTransform, imageToDisplay, type Region,
} from "@/lib/rah/visionGeometry";

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
  /** SHA-256 of the exact JPEG bytes for this frame; null on hash failure. */
  hash: string | null;
  /** Explicit failure reason when `hash` is null (never fabricated). */
  hashFailureReason: string | null;
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
    const { hash, failureReason } = await hashBlobSafe(blob);
    return { dataUrl, width, height, sizeBytes: blob.size, capturedAt: Date.now(), hash, hashFailureReason: failureReason };
  } finally {
    try { bmp.close(); } catch { /* older browsers */ }
  }
}

async function hashBlobSafe(blob: Blob): Promise<{ hash: string | null; failureReason: string | null }> {
  try {
    const buf = await blob.arrayBuffer();
    const { hash } = await hashFrameBytes(new Uint8Array(buf));
    if (hash) return { hash, failureReason: null };
    return { hash: null, failureReason: "hash_unavailable" };
  } catch (err) {
    return { hash: null, failureReason: (err as Error)?.message || "hash_error" };
  }
}

async function hashDataUrlSafe(dataUrl: string): Promise<{ hash: string | null; failureReason: string | null }> {
  try {
    const { hash } = await hashFrameBytes(dataUrl);
    if (hash) return { hash, failureReason: null };
    return { hash: null, failureReason: "hash_unavailable" };
  } catch (err) {
    return { hash: null, failureReason: (err as Error)?.message || "hash_error" };
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
  const { hash, failureReason } = await hashBlobSafe(blob);
  return { dataUrl, width, height, sizeBytes: blob.size, capturedAt: Date.now(), hash, hashFailureReason: failureReason };
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

  // Vision Session lifecycle state (explicit start/end/cancel).
  const [projects, setProjects] = useState<Project[]>([]);
  // undefined = not chosen; null = explicitly "no project"; string = project id.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null | undefined>(undefined);
  const [sessionTitle, setSessionTitle] = useState<string>("");
  const [sessionMode, setSessionMode] = useState<"fast" | "deep">("fast");
  const [activeSession, setActiveSession] = useState<LifecycleSession | null>(null);

  // Immutable Result Review state.
  const [savedResults, setSavedResults] = useState<VisionResult[]>([]);
  const [resultDraftText, setResultDraftText] = useState<string>("");
  const [resultDraftDirty, setResultDraftDirty] = useState<boolean>(false);
  const [savedResultId, setSavedResultId] = useState<string | null>(null);
  const [saveReceipt, setSaveReceipt] = useState<{ destination: string; id: string | null; at: number } | null>(null);

  // Confirm Vision Action state.
  type ProposalKind = "vision_safe_action" | "vision_workflow_handoff";
  interface Proposal {
    id: string;
    kind: ProposalKind;
    sideEffectClass: "ui_only" | "workflow_handoff" | "denied";
    intentId?: string;
    title?: string;
    steps?: unknown[];
    projectId?: string | null;
    params?: Record<string, unknown>;
    confidence?: number;
    question?: string;
  }
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalIntentId, setProposalIntentId] = useState<string>(VISION_ACTION_CATALOG[0]?.id || "show_guidance");
  const [dispatchReceipt, setDispatchReceipt] = useState<{ destination: string; id: string | null; at: number } | null>(null);

  // Load projects once (used by session start selector).
  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        const list = await db.getAll("projects");
        setProjects((list as Project[]).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      } catch { /* IndexedDB unavailable in this environment */ }
    })();
  }, []);

  // Pointer/keyboard reducer state for drag-to-redact overlay.
  const [pointer, setPointer] = useState(() => createPointerState([]));
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const transform = useMemo(() => {
    if (!pendingFrame || displaySize.w === 0 || displaySize.h === 0) return null;
    return computeDisplayTransform({
      displayWidth: displaySize.w,
      displayHeight: displaySize.h,
      sourceWidth: pendingFrame.width,
      sourceHeight: pendingFrame.height,
    });
  }, [pendingFrame, displaySize]);

  const pointerFrame = useMemo(
    () => (pendingFrame ? { width: pendingFrame.width, height: pendingFrame.height } : null),
    [pendingFrame],
  );

  // Sync reducer regions -> committed `regions` (source of truth for save).
  useEffect(() => {
    setRegions(pointer.regions as unknown as RedactionRegion[]);
  }, [pointer.regions]);

  // Reset overlay when the frame changes.
  useEffect(() => {
    setPointer(createPointerState([]));
  }, [pendingFrame?.capturedAt]);

  // Track display size for accurate coordinate math on resize.
  useEffect(() => {
    if (!showRedactionPanel) return;
    const el = overlayRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setDisplaySize({ w: rect.width, h: rect.height });
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    setDisplaySize({ w: rect.width, h: rect.height });
    return () => obs.disconnect();
  }, [showRedactionPanel, pendingFrame?.capturedAt]);

  // Global keyboard shortcuts for the overlay (arrow nudge, delete,
  // undo/redo). Suppressed while typing in inputs/textareas.
  useEffect(() => {
    if (!showRedactionPanel || !pointerFrame) return;
    const onKey = (e: KeyboardEvent) => {
      if (shortcutsAreSuppressed(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        setPointer((s) => reducePointer(s, e.shiftKey ? { type: "redo" } : { type: "undo" }));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        setPointer((s) => reducePointer(s, { type: "redo" }));
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"].includes(e.key)) {
        if (!pointer.selectedId) return;
        e.preventDefault();
        setPointer((s) => reducePointer(s, { type: "key", key: e.key, shift: e.shiftKey, frame: pointerFrame }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showRedactionPanel, pointerFrame, pointer.selectedId]);

  // Warn on tab close / navigation while a review draft or dirty
  // redaction stack is unsaved.
  useEffect(() => {
    const hasUnsaved =
      (!!pendingFrame && (pointer.dirty || (privacyNote && !savedEvidenceId))) ||
      resultDraftDirty ||
      isSessionLive(activeSession);
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingFrame, pointer.dirty, privacyNote, savedEvidenceId, resultDraftDirty, activeSession]);

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
    setPointer(createPointerState([]));
    setUserMarkedSensitive(false);
    setPrivacyNote("");
    setRedactedDataUrl("");
    setSavedEvidenceId(null);
    setReviewStage("idle");
    setResultDraftText("");
    setResultDraftDirty(false);
    setSavedResultId(null);
    setSaveReceipt(null);
    setProposal(null);
    setDispatchReceipt(null);
  }, []);

  // ─── Explicit Vision Session lifecycle ───────────────────────────────
  const startVisionSession = useCallback(() => {
    if (selectedProjectId === undefined) {
      toast.error("Choose a project (or 'No project') before starting.");
      return;
    }
    if (!isCaptureReady(sharing)) {
      toast.error("Share your screen first — the session records the actual source.");
      return;
    }
    const track = trackRef.current;
    const settings = track?.getSettings?.() ?? {};
    const displaySurface = (settings as { displaySurface?: string }).displaySurface || null;
    const res = lifecycleStartSession({
      id: uid(),
      projectId: selectedProjectId ?? null,
      sourceLabel: sourceLabel || "selected screen source",
      displaySurface,
      consented: true,
      apiLabel: "browser.getDisplayMedia",
      mode: sessionMode,
      question: (question || "").trim(),
    });
    if (!res.ok || !res.session) {
      toast.error("Could not start session: " + (res.reason || "unknown"));
      return;
    }
    // Persist immediately so the session exists in history even before capture.
    (async () => {
      try {
        const db = await getDB();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.put("visionSessions" as any, {
          ...res.session,
          title: sessionTitle.trim() || "Untitled vision session",
          presetId: null,
          privacyMode: "standard",
          workflowProposalIds: [],
          schemaVersion: 1,
          createdAt: res.session!.startedAt,
        } as never);
      } catch (err) {
        toast.error("Session start failed to persist: " + (err as Error).message);
      }
    })();
    setActiveSession(res.session);
    toast.success("Vision session started");
  }, [selectedProjectId, sharing, sourceLabel, sessionMode, question, sessionTitle]);

  const persistSession = useCallback(async (s: LifecycleSession) => {
    try {
      const db = await getDB();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.put("visionSessions" as any, {
        ...s,
        title: sessionTitle.trim() || "Untitled vision session",
        presetId: null,
        privacyMode: "standard",
        workflowProposalIds: [],
        schemaVersion: 1,
        createdAt: s.startedAt,
      } as never);
    } catch { /* ignore */ }
  }, [sessionTitle]);

  const endVisionSession = useCallback(async () => {
    if (!activeSession) return;
    const next = lifecycleEndSession(activeSession, { reason: "user_ended" });
    if (next) { setActiveSession(next); await persistSession(next); toast.success("Vision session ended"); }
  }, [activeSession, persistSession]);

  const cancelVisionSession = useCallback(async () => {
    if (!activeSession) return;
    const next = lifecycleCancelSession(activeSession, { reason: "user_cancelled" });
    if (next) { setActiveSession(next); await persistSession(next); toast("Vision session cancelled"); }
  }, [activeSession, persistSession]);

  // Capture ONLY — no AI. This is Step 1 of the mandatory Capture Review.
  const captureNow = useCallback(async () => {
    if (!isCaptureReady(sharing) || !videoRef.current) {
      toast.error("Start screen sharing first.");
      return;
    }
    if (!activeSession || !isSessionLive(activeSession)) {
      toast.error("Start a Vision Session before capturing.");
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
      // Increment capture count against the active session and persist.
      const bumped = lifecycleIncrementCapture(activeSession);
      if (bumped) { setActiveSession(bumped); void persistSession(bumped); }
      advanceReview("capture");
      setSharing("ready");
    } catch (err) {
      toast.error("Capture failed: " + (err instanceof Error ? err.message : String(err)));
      setSharing("ready");
    }
  }, [sharing, imageCaptureLastOk, videoReady, advanceReview, activeSession, persistSession]);

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
      // Hash the redacted derivative bytes (if any) at save time.
      const redactedHash = regions.length > 0 && redactedDataUrl
        ? await hashDataUrlSafe(redactedDataUrl)
        : { hash: null, failureReason: null };
      const rec = shapeEvidenceRecord({
        id: uid(),
        sessionId: activeSession?.id ?? null,
        projectId: activeSession?.projectId ?? null,
        createdAt: Date.now(),
        frame: { width: pendingFrame.width, height: pendingFrame.height, sizeBytes: pendingFrame.sizeBytes, capturedAt: pendingFrame.capturedAt, mime: "image/jpeg", captureMethod: "video-canvas", hash: pendingFrame.hash },
        redactedFrame: regions.length > 0 && redactedDataUrl
          ? { width: pendingFrame.width, height: pendingFrame.height, sizeBytes: Math.round(redactedDataUrl.length * 0.75), capturedAt: pendingFrame.capturedAt, mime: "image/jpeg", captureMethod: "video-canvas", hash: redactedHash.hash }
          : null,
        redactionRegions: regions,
        privacy: { class: privacy.class, reasons: privacy.reasons },
        notes: privacyNote,
        sourceLabel,
        linkedResultId: null,
      });
      const db = await getDB();
      await db.put("visionEvidence", rec);
      setSavedEvidenceId(rec.id);
      // Surface hash provenance honestly.
      const hashLabel = pendingFrame.hash
        ? `sha256 ${pendingFrame.hash.slice(0, 16)}…`
        : `no integrity hash (${pendingFrame.hashFailureReason || "unknown"})`;
      toast.success(`Evidence saved (${hashLabel})`);
    } catch (err) {
      toast.error("Failed to save evidence: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [pendingFrame, regions, redactedDataUrl, privacy, privacyNote, sourceLabel, activeSession]);

  // ─── Immutable Result Review — explicit save (create v1) or version ─
  useEffect(() => {
    // Seed the editable draft with the raw text once analysis completes.
    // Never mutates analysis.text. User edits do not overwrite the raw.
    if (analysis?.state === "done" && !resultDraftDirty && !savedResultId) {
      setResultDraftText(analysis.text || "");
    }
  }, [analysis?.state, analysis?.text, resultDraftDirty, savedResultId]);

  const saveResult = useCallback(async () => {
    if (!analysis || analysis.state !== "done" || !analysis.text) {
      toast.error("No completed analysis to save.");
      return;
    }
    try {
      const db = await getDB();
      const chosenVariant = (regions.length > 0 && previewRedacted) ? "redacted" : "original";
      // First save → createResult; subsequent saves → createResultVersion.
      let rec: VisionResult | null;
      const head = savedResults.find((r) => r.id === savedResultId) || null;
      if (!head) {
        rec = lifecycleCreateResult({
          id: uid(),
          sessionId: activeSession?.id ?? null,
          evidenceId: savedEvidenceId ?? null,
          projectId: activeSession?.projectId ?? null,
          question: analysis.question,
          rawText: analysis.text,
          provider: analysis.provider ?? null,
          model: analysis.model ?? null,
          transport: null,
          engine: null,
          latencyMs: analysis.latencyMs ?? null,
          variantSent: chosenVariant,
          mode: sessionMode,
          frameHash: analysis.frame.hash,
          frameCapturedAt: analysis.frame.capturedAt,
        });
      } else {
        rec = lifecycleCreateResultVersion(head, {
          id: uid(),
          editedText: resultDraftText,
          editedBy: "user",
        });
      }
      if (!rec) { toast.error("Save produced no record."); return; }
      // Persist as VisionResultRecord shape (superset of VisionResult; carry editedText forward if present).
      const persisted: VisionResultRecord = {
        id: rec.id,
        sessionId: rec.sessionId,
        evidenceId: rec.evidenceId,
        projectId: rec.projectId,
        createdAt: rec.createdAt,
        question: rec.question,
        variantSent: rec.variantSent,
        text: rec.rawText,
        provider: rec.provider,
        model: rec.model,
        transport: rec.transport,
        engine: rec.engine,
        latencyMs: rec.latencyMs,
        frameHash: rec.frameHash,
        frameCapturedAt: rec.frameCapturedAt,
        mode: rec.mode,
        edited: !!(rec as unknown as { editedText?: string }).editedText,
        editedText: (rec as unknown as { editedText?: string }).editedText,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.put("visionResults" as any, persisted as never);
      setSavedResults((prev) => [...prev, rec!]);
      setSavedResultId(rec.id);
      setResultDraftDirty(false);
      const receipt = shapeSaveReceipt({ destination: "evidence_version", id: rec.id, at: Date.now() });
      if (receipt.ok && receipt.receipt) setSaveReceipt({ destination: receipt.receipt.destination, id: receipt.receipt.id, at: receipt.receipt.at });
      toast.success(head ? `Saved as version v${rec.version}` : "Result saved (v1)");
    } catch (err) {
      toast.error("Save result failed: " + (err as Error).message);
    }
  }, [analysis, regions, previewRedacted, savedResults, savedResultId, activeSession, savedEvidenceId, sessionMode, resultDraftText]);

  const discardResultEdits = useCallback(() => {
    setResultDraftText(analysis?.text || "");
    setResultDraftDirty(false);
  }, [analysis?.text]);

  const copyResultDraft = useCallback(async () => {
    try { await navigator.clipboard.writeText(resultDraftText); toast.success("Copied"); }
    catch { toast.error("Copy failed"); }
  }, [resultDraftText]);

  // ─── Confirm Vision Action — inert proposals + gated dispatch ────────
  const buildSafeActionProposal = useCallback(() => {
    const q = (analysis?.question || question || "").trim();
    const res = proposeSafeAction({
      intentId: proposalIntentId,
      params: {},
      confidence: 0.8,
      ambiguous: false,
      sessionId: activeSession?.id ?? null,
      evidenceId: savedEvidenceId ?? null,
      question: q,
    });
    if (!res.ok || !res.proposal) { toast.error("Proposal rejected: " + (res.reason || "unknown")); return; }
    setProposal(res.proposal as Proposal);
    setDispatchReceipt(null);
  }, [analysis?.question, question, proposalIntentId, activeSession, savedEvidenceId]);

  const buildWorkflowProposal = useCallback(() => {
    const q = (analysis?.question || question || "").trim();
    const title = sessionTitle.trim() || `Vision follow-up · ${new Date().toLocaleString()}`;
    const res = proposeWorkflowHandoff({
      title,
      steps: [{ id: "step-1", action: "review_vision_evidence", params: { evidenceId: savedEvidenceId ?? null } }],
      sessionId: activeSession?.id ?? null,
      evidenceId: savedEvidenceId ?? null,
      question: q,
      projectId: activeSession?.projectId ?? null,
    });
    if (!res.ok || !res.proposal) { toast.error("Workflow proposal rejected: " + (res.reason || "unknown")); return; }
    setProposal(res.proposal as Proposal);
    setDispatchReceipt(null);
  }, [analysis?.question, question, sessionTitle, activeSession, savedEvidenceId]);

  const confirmationPayload = useMemo(() => {
    if (!proposal) return null;
    const r = buildConfirmationPayload({ proposal, evidence: null, approvalStatus: "none" });
    return r.ok ? r.payload : null;
  }, [proposal]);

  const confirmDispatch = useCallback(() => {
    if (!proposal) return;
    const gate = canDispatchProposal({ proposal: { sideEffectClass: proposal.sideEffectClass }, confirmed: true });
    if (!gate.ok) { toast.error("Dispatch blocked: " + gate.reason); return; }
    if (gate.action === "dispatch_ui_only") {
      // UI-only action: navigate hint. We do not perform any side-effect here.
      const dest = shapeSaveReceipt({ destination: "safe_action_proposal", id: proposal.id, at: Date.now() });
      if (dest.ok && dest.receipt) setDispatchReceipt({ destination: dest.receipt.destination, id: dest.receipt.id, at: dest.receipt.at });
      toast.success("Safe action dispatched (UI-only)");
    } else if (gate.action === "handoff_inert") {
      // Workflow handoff: route inert draft to Automations builder.
      const dest = shapeSaveReceipt({ destination: "workflow_proposal", id: proposal.id, at: Date.now() });
      if (dest.ok && dest.receipt) setDispatchReceipt({ destination: dest.receipt.destination, id: dest.receipt.id, at: dest.receipt.at });
      toast("Workflow draft handed off (inert). Open Automations to review.");
      void navigate({ to: "/automations" });
    }
  }, [proposal, navigate]);

  const addRegionFromDraft = useCallback(() => {
    if (!pendingFrame) return;
    const raw = { x: Number(regionDraft.x), y: Number(regionDraft.y), w: Number(regionDraft.w), h: Number(regionDraft.h), label: regionDraft.label || null };
    const res = validateRedactionRegions([raw], { width: pendingFrame.width, height: pendingFrame.height });
    if (res.rejected.length > 0) {
      toast.error("Region rejected: " + res.rejected[0].reason);
      return;
    }
    setPointer((s) => reducePointer(s, { type: "set-regions", regions: [...s.regions, ...(res.accepted as unknown as Region[])], frame: { width: pendingFrame.width, height: pendingFrame.height } }));
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
      frame: { dataUrl: "", width: 0, height: 0, sizeBytes: 0, capturedAt: Date.now(), hash: null, hashFailureReason: "not_captured" },
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
                disabled={!ready || streaming || !isSessionLive(activeSession)}
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

      <section className="glass-panel border border-border/60 p-4 md:p-5 space-y-3" aria-labelledby="rah-vision-session">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 id="rah-vision-session" className="display text-xl">Vision Session</h2>
          {activeSession && (
            <span className={"text-[11px] rounded-full border px-3 py-1 " + (isSessionLive(activeSession) ? "border-primary text-primary" : "border-border/60 text-muted-foreground")}>
              {activeSession.status} · captures {activeSession.captureCount}
            </span>
          )}
        </div>
        {!activeSession ? (
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] items-end">
            <label className="text-xs space-y-1">
              <span className="uppercase tracking-widest text-muted-foreground">Project</span>
              <select
                className="w-full rounded-md border border-border/70 bg-background/40 p-2 text-sm"
                value={selectedProjectId === undefined ? "" : (selectedProjectId ?? "__none__")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") setSelectedProjectId(undefined);
                  else if (v === "__none__") setSelectedProjectId(null);
                  else setSelectedProjectId(v);
                }}
              >
                <option value="">— choose —</option>
                <option value="__none__">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-xs space-y-1">
              <span className="uppercase tracking-widest text-muted-foreground">Session title</span>
              <input
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                placeholder="Untitled vision session"
                className="w-full rounded-md border border-border/70 bg-background/40 p-2 text-sm"
              />
            </label>
            <label className="text-xs space-y-1">
              <span className="uppercase tracking-widest text-muted-foreground">Mode</span>
              <select
                className="rounded-md border border-border/70 bg-background/40 p-2 text-sm"
                value={sessionMode}
                onChange={(e) => setSessionMode(e.target.value === "deep" ? "deep" : "fast")}
              >
                <option value="fast">Fast</option>
                <option value="deep">Deep</option>
              </select>
            </label>
            <Button type="button" onClick={startVisionSession} disabled={!active || selectedProjectId === undefined}>
              Start Vision Session
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              <strong className="text-foreground">{sessionTitle.trim() || "Untitled vision session"}</strong>
              {" · "}
              {activeSession.projectId
                ? (projects.find((p) => p.id === activeSession.projectId)?.name || activeSession.projectId)
                : "No project"}
              {" · mode "}{activeSession.mode}
            </span>
            {isSessionLive(activeSession) ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => void endVisionSession()}>End session</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void cancelVisionSession()}>Cancel session</Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => { setActiveSession(null); setSelectedProjectId(undefined); setSessionTitle(""); }}>
                Start new session
              </Button>
            )}
          </div>
        )}
        {!activeSession && (
          <p className="text-[11px] text-muted-foreground">
            Captures, evidence, and results are bound to the active session. Choose <em>No project</em> if this vision run isn't tied to a specific project.
          </p>
        )}
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
                  <div className="text-xs text-muted-foreground">
                    Drag on the preview to draw a redaction rectangle. Click a
                    region to select it, then use arrow keys to nudge
                    (Shift+arrow to resize) or <kbd className="rounded border border-border/60 px-1 text-[10px]">Delete</kbd> to remove.
                    Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes. Numeric entry below is a keyboard-only fallback.
                  </div>
                  <div
                    ref={overlayRef}
                    tabIndex={0}
                    role="application"
                    aria-label="Drag to draw redaction regions on the captured frame"
                    className="relative overflow-hidden rounded border border-border/70 bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/60"
                    style={{ aspectRatio: `${pendingFrame.width} / ${pendingFrame.height}` }}
                    onPointerDown={(e) => {
                      if (!transform || !pointerFrame) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      setPointer((s) => reducePointer(s, {
                        type: "pointer-down",
                        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
                        transform, frame: pointerFrame,
                      }));
                    }}
                    onPointerMove={(e) => {
                      if (!transform || !pointerFrame) return;
                      if (pointer.mode === "idle") return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPointer((s) => reducePointer(s, {
                        type: "pointer-move",
                        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
                        transform, frame: pointerFrame,
                      }));
                    }}
                    onPointerUp={(e) => {
                      if (!transform || !pointerFrame) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPointer((s) => reducePointer(s, {
                        type: "pointer-up",
                        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
                        transform, frame: pointerFrame,
                      }));
                    }}
                    onPointerCancel={() => setPointer((s) => reducePointer(s, { type: "pointer-cancel" }))}
                  >
                    <img
                      ref={previewImgRef}
                      src={pendingFrame.dataUrl}
                      alt="Captured frame for redaction editing"
                      className="pointer-events-none absolute inset-0 h-full w-full object-contain select-none"
                      draggable={false}
                    />
                    {transform && pointer.regions.map((r: Region) => {
                      const tl = imageToDisplay(transform, { x: r.x, y: r.y });
                      const br = imageToDisplay(transform, { x: r.x + r.w, y: r.y + r.h });
                      if (!tl || !br) return null;
                      const selected = pointer.selectedId === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onPointerDown={(e) => { e.stopPropagation(); setPointer((s) => reducePointer(s, { type: "select", id: r.id })); }}
                          className={"absolute border-2 " + (selected ? "border-primary bg-primary/25" : "border-white/70 bg-black/50 hover:border-primary/70")}
                          style={{ left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y }}
                          aria-label={`Redaction region ${r.label || r.id} at ${r.x},${r.y} size ${r.w}×${r.h}${selected ? " (selected)" : ""}`}
                        />
                      );
                    })}
                    {transform && (() => {
                      const draft = draftDrawRect(pointer, pointerFrame!);
                      if (!draft) return null;
                      const tl = imageToDisplay(transform, { x: draft.x, y: draft.y });
                      const br = imageToDisplay(transform, { x: draft.x + draft.w, y: draft.y + draft.h });
                      if (!tl || !br) return null;
                      return (
                        <div className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10" style={{ left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y }} />
                      );
                    })()}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <Button size="sm" type="button" variant="ghost" disabled={!canUndoState(pointer)} onClick={() => setPointer((s) => reducePointer(s, { type: "undo" }))}>Undo</Button>
                    <Button size="sm" type="button" variant="ghost" disabled={!canRedoState(pointer)} onClick={() => setPointer((s) => reducePointer(s, { type: "redo" }))}>Redo</Button>
                    <Button size="sm" type="button" variant="ghost" disabled={pointer.regions.length === 0} onClick={() => setPointer((s) => reducePointer(s, { type: "clear-all" }))}>Clear all</Button>
                    <span className="text-muted-foreground ml-auto">{pointer.regions.length} region{pointer.regions.length === 1 ? "" : "s"} · {pointer.dirty ? "unsaved edits" : "saved"}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">Numeric fallback (keyboard-only entry):</div>
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
                          <button type="button" className="text-primary underline" onClick={() => setPointer((s) => reducePointer(s, { type: "select", id: r.id }))}>select</button>
                          <button type="button" className="text-destructive underline" onClick={() => setPointer((s) => reducePointer(s, { type: "remove", id: r.id }))}>remove</button>
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