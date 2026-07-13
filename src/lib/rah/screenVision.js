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
    case "ended":      return "Sharing ended";
    case "denied":     return "Permission denied";
    case "unsupported":return "Screen sharing not supported in this browser";
    case "error":      return "Screen sharing error";
    default:           return "Not sharing";
  }
}

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