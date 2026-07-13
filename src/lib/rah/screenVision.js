// Pure helpers for Raven Screen Vision (Phase 1).
//
// This module intentionally has NO side effects at import time — no timers,
// no navigator access, no MediaStream calls. The Screen Vision page owns
// all user-gated capture. These helpers exist so we can unit-test the
// pieces that don't touch the browser (size math, labels, runtime line).

export const MAX_ANALYZE_EDGE = 1600;

export const PRIVACY_NOTE =
  "Frames are analyzed only when you press Analyze. Nothing is captured in the background, nothing is uploaded automatically, and screenshots are not saved anywhere unless you explicitly save them.";

export const SCREEN_VISION_PRESETS = [
  { id: "next",   label: "What should I click next?",           question: "Look at this screenshot of my screen and tell me clearly what I should click, tap, or do next. Be concise and specific." },
  { id: "error",  label: "Find the error",                       question: "Scan this screenshot for any error message, warning, or failed state. Quote the exact text you see and explain what it likely means in plain language." },
  { id: "window", label: "Explain this window",                  question: "Explain what this window/app is, what its main sections do, and which controls are important. Speak to a non-technical user." },
  { id: "setup",  label: "Check whether setup is correct",       question: "Review this screen and tell me whether the setup looks correct. Call out anything that is missing, wrong, or should be double-checked before continuing." },
];

export function presetById(id) {
  return SCREEN_VISION_PRESETS.find((p) => p.id === id) || null;
}

// Compute the target capture size so the longest edge fits `maxEdge`.
// Returns integer width/height >= 1 and the applied scale factor (<= 1).
export function computeCaptureSize(sourceW, sourceH, maxEdge = MAX_ANALYZE_EDGE) {
  const w = Number(sourceW) || 0;
  const h = Number(sourceH) || 0;
  if (w <= 0 || h <= 0) return { width: 0, height: 0, scale: 0 };
  const longest = Math.max(w, h);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

// State labels shown in the sharing indicator + status strip.
// Keep the ACTIVE label loud and unambiguous.
export function sharingStateLabel(state) {
  switch (state) {
    case "idle":       return "Not sharing";
    case "requesting": return "Waiting for browser permission…";
    case "active":     return "SCREEN SHARING ACTIVE";
    case "stream-connected": return "Stream connected — waiting for first frame…";
    case "waiting-frame":    return "Waiting for first frame…";
    case "ready":            return "SCREEN SHARING ACTIVE";
    case "capturing":        return "Capturing frame…";
    case "analyzing":        return "Analyzing screen…";
    case "ended":      return "Sharing ended";
    case "denied":     return "Permission denied";
    case "unsupported":return "Screen sharing not supported in this browser";
    case "error":      return "Screen sharing error";
    default:           return "Not sharing";
  }
}

// A capture must ONLY be allowed once the video pipeline has a drawable frame.
// This is the single source of truth so buttons and effects agree.
export function isCaptureReady(state) {
  return state === "ready";
}

// Explicit readiness transition table. Kept pure so it's easy to unit-test.
// Events: "request", "grant", "metadata", "frame", "deny", "end", "unsupported",
//         "error", "reset", "capture-start", "capture-done", "analyze-start",
//         "analyze-done".
export function nextReadiness(current, event) {
  switch (event) {
    case "request":     return "requesting";
    case "grant":       return "stream-connected";
    case "metadata":    return current === "stream-connected" ? "waiting-frame" : current;
    case "frame":       return (current === "waiting-frame" || current === "stream-connected") ? "ready" : current;
    case "capture-start": return current === "ready" ? "capturing" : current;
    case "capture-done":  return current === "capturing" ? "analyzing" : current;
    case "analyze-done":  return current === "analyzing" ? "ready" : current;
    case "deny":        return "denied";
    case "unsupported": return "unsupported";
    case "end":         return "ended";
    case "error":       return "error";
    case "reset":       return "idle";
    default:            return current;
  }
}

// Pixel-sample coordinates for black-frame detection. Corners, edges, center.
// Returns integer pixel positions guaranteed to be inside the canvas.
export function computeSamplePoints(width, height) {
  const w = Math.max(1, Math.floor(Number(width) || 0));
  const h = Math.max(1, Math.floor(Number(height) || 0));
  const xs = [0, Math.floor(w / 2), w - 1, Math.floor(w / 4), Math.floor((3 * w) / 4)];
  const ys = [0, Math.floor(h / 2), h - 1, Math.floor(h / 4), Math.floor((3 * h) / 4)];
  const pts = [];
  for (const x of xs) for (const y of ys) pts.push({ x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, y)) });
  return pts;
}

// Given an array of {r,g,b} samples, compute luminance stats.
// Uses BT.601 luma coefficients. Pure math — safe to test in Node.
export function analyzeSamples(samples) {
  const arr = Array.isArray(samples) ? samples : [];
  if (arr.length === 0) return { avgLuma: 0, maxLuma: 0, nonBlackRatio: 0, count: 0 };
  let sum = 0, max = 0, nonBlack = 0;
  for (const s of arr) {
    const r = Number(s?.r) || 0, g = Number(s?.g) || 0, b = Number(s?.b) || 0;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += y;
    if (y > max) max = y;
    if (y > 10) nonBlack++;
  }
  return { avgLuma: sum / arr.length, maxLuma: max, nonBlackRatio: nonBlack / arr.length, count: arr.length };
}

// Decide whether a captured frame is "effectively blank/black" and should
// be retried. Conservative — only flags obviously-empty frames.
export function isLikelyBlankFrame(stats, opts = {}) {
  const maxLumaFloor = Number(opts.maxLumaFloor ?? 8);
  const nonBlackRatioFloor = Number(opts.nonBlackRatioFloor ?? 0.02);
  if (!stats || typeof stats !== "object") return true;
  if (!Number(stats.count)) return true;
  return Number(stats.maxLuma) <= maxLumaFloor && Number(stats.nonBlackRatio) <= nonBlackRatioFloor;
}

// Estimate frames-per-second from an array of frame timestamps (ms).
// Returns 0 when there are fewer than two samples.
export function estimateFps(timestamps) {
  const arr = Array.isArray(timestamps) ? timestamps.filter((n) => Number.isFinite(n)) : [];
  if (arr.length < 2) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const span = sorted[sorted.length - 1] - sorted[0];
  if (span <= 0) return 0;
  return ((sorted.length - 1) * 1000) / span;
}

// Human message shown when the stream is connected but no frame arrives.
export const NO_FRAME_RECOVERY_HINT =
  "Try selecting Entire Screen or a different window, then share again.";

// The runtime line rendered ABOVE the vision answer. This text is produced
// by the app, never by the model — it is proof-of-runtime for the user so
// the model cannot misrepresent what was captured or where it came from.
export function buildScreenVisionRuntimeLine({
  provider, model, latencyMs, capturedAt, sourceLabel,
} = {}) {
  const parts = [
    "RAH Screen Vision",
    "Source: " + (sourceLabel || "browser screen share (user-consented)"),
    "Capture: single frame, one-shot analysis",
  ];
  if (provider) parts.push("Provider: " + provider);
  if (model)    parts.push("Model: " + model);
  if (typeof latencyMs === "number" && isFinite(latencyMs)) {
    parts.push("Latency: " + (latencyMs / 1000).toFixed(2) + "s");
  }
  if (capturedAt !== undefined && capturedAt !== null && capturedAt !== "") {
    const iso = typeof capturedAt === "number" ? new Date(capturedAt).toISOString() : String(capturedAt);
    parts.push("Captured at: " + iso);
  }
  return parts.join(" · ");
}

// Explicit privacy-behavior descriptor consumed by tests to lock behavior.
// If any of these flip, the tests fail and force a review.
export const SCREEN_VISION_PRIVACY = Object.freeze({
  autoStartOnMount: false,
  backgroundCapture: false,
  continuousFrameUpload: false,
  persistFramesToStorage: false,
  sendFramesToBridge: false,
  captureOnlyOnExplicitUserAction: true,
});