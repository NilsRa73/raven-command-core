import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  MAX_ANALYZE_EDGE,
  PRIVACY_NOTE,
  SCREEN_VISION_PRESETS,
  SCREEN_VISION_PRIVACY,
  NO_FRAME_RECOVERY_HINT,
  PREVIEW_UNAVAILABLE_LABEL,
  buildScreenVisionRuntimeLine,
  computeCaptureSize,
  presetById,
  sharingStateLabel,
  isCaptureReady,
  nextReadiness,
  computeSamplePoints,
  analyzeSamples,
  isLikelyBlankFrame,
  estimateFps,
  pickCaptureMethod,
  readinessFromSignals,
  formatDiagnostics,
} from "../../src/lib/rah/screenVision.js";

test("computeCaptureSize: passthrough when within max edge", () => {
  const r = computeCaptureSize(1200, 800, 1600);
  assert.deepEqual(r, { width: 1200, height: 800, scale: 1 });
});

test("computeCaptureSize: scales down keeping aspect ratio, longest edge = maxEdge", () => {
  const r = computeCaptureSize(3840, 2160, 1600);
  assert.equal(r.width, 1600);
  assert.equal(r.height, 900);
  assert.ok(r.scale > 0 && r.scale < 1);
});

test("computeCaptureSize: portrait source scales by height", () => {
  const r = computeCaptureSize(1080, 3200, 1600);
  assert.equal(r.height, 1600);
  assert.equal(r.width, Math.round(1080 * (1600 / 3200)));
});

test("computeCaptureSize: invalid inputs return zero size (no capture)", () => {
  assert.deepEqual(computeCaptureSize(0, 0), { width: 0, height: 0, scale: 0 });
  assert.deepEqual(computeCaptureSize(-10, 100), { width: 0, height: 0, scale: 0 });
});

test("computeCaptureSize: default max edge is a reasonable readable size", () => {
  assert.ok(MAX_ANALYZE_EDGE >= 1024 && MAX_ANALYZE_EDGE <= 2048);
});

test("sharingStateLabel: ACTIVE state shows a loud persistent indicator", () => {
  assert.equal(sharingStateLabel("active"), "SCREEN SHARING ACTIVE");
});

test("sharingStateLabel: idle / ended / denied / unsupported map to distinct human strings", () => {
  const labels = new Set([
    sharingStateLabel("idle"),
    sharingStateLabel("ended"),
    sharingStateLabel("denied"),
    sharingStateLabel("unsupported"),
    sharingStateLabel("error"),
  ]);
  assert.equal(labels.size, 5);
  for (const l of labels) assert.ok(l && typeof l === "string");
});

test("presets: at least 4, unique ids, non-empty questions", () => {
  assert.ok(SCREEN_VISION_PRESETS.length >= 4);
  const ids = new Set(SCREEN_VISION_PRESETS.map((p) => p.id));
  assert.equal(ids.size, SCREEN_VISION_PRESETS.length);
  for (const p of SCREEN_VISION_PRESETS) {
    assert.ok(p.label && p.question && p.question.length > 10);
  }
  assert.ok(presetById(SCREEN_VISION_PRESETS[0].id));
  assert.equal(presetById("does-not-exist"), null);
});

test("privacy note explicitly names the Analyze-only capture behavior", () => {
  assert.match(PRIVACY_NOTE, /only when you press Analyze/i);
  assert.match(PRIVACY_NOTE, /not saved/i);
});

test("privacy contract: no auto-start, no background, no continuous, no persistence, no bridge", () => {
  assert.equal(SCREEN_VISION_PRIVACY.autoStartOnMount, false);
  assert.equal(SCREEN_VISION_PRIVACY.backgroundCapture, false);
  assert.equal(SCREEN_VISION_PRIVACY.continuousFrameUpload, false);
  assert.equal(SCREEN_VISION_PRIVACY.persistFramesToStorage, false);
  assert.equal(SCREEN_VISION_PRIVACY.sendFramesToBridge, false);
  assert.equal(SCREEN_VISION_PRIVACY.captureOnlyOnExplicitUserAction, true);
});

test("runtime line: app-generated, names Screen Vision, includes provider/model/latency", () => {
  const line = buildScreenVisionRuntimeLine({
    provider: "Lovable AI Gateway",
    model: "google/gemini-2.5-flash",
    latencyMs: 1234,
    capturedAt: 0,
    sourceLabel: "browser screen share (user-consented)",
  });
  assert.match(line, /RAH Screen Vision/);
  assert.match(line, /Source: browser screen share/);
  assert.match(line, /Capture: single frame, one-shot analysis/);
  assert.match(line, /Provider: Lovable AI Gateway/);
  assert.match(line, /Model: google\/gemini-2\.5-flash/);
  assert.match(line, /Latency: 1\.23s/);
  assert.match(line, /Captured at: 1970-01-01T00:00:00\.000Z/);
});

test("runtime line: works with unknown provider/model (no invented values)", () => {
  const line = buildScreenVisionRuntimeLine({});
  assert.match(line, /RAH Screen Vision/);
  assert.doesNotMatch(line, /Provider:/);
  assert.doesNotMatch(line, /Model:/);
  assert.doesNotMatch(line, /Latency:/);
});

// Static check: the Screen Vision page must not fire capture at mount.
// This scans the source for accidental auto-capture patterns without
// booting a browser. It's a cheap regression guard for Phase 1.
const __dirname = dirname(fileURLToPath(import.meta.url));
const visionSource = readFileSync(
  resolve(__dirname, "../../src/routes/vision.tsx"),
  "utf8",
);

test("vision page: does not auto-request getDisplayMedia on mount", () => {
  // getDisplayMedia() must only be reachable via a user-click handler,
  // never scheduled from a useEffect body / setTimeout at mount.
  assert.ok(visionSource.includes("getDisplayMedia"));
  const badPatterns = [
    /useEffect\([^)]*getDisplayMedia/s,
    /setTimeout\([^)]*getDisplayMedia/s,
    /requestAnimationFrame\([^)]*getDisplayMedia/s,
  ];
  for (const re of badPatterns) {
    assert.doesNotMatch(visionSource, re, `auto-capture pattern detected: ${re}`);
  }
});

test("vision page: renders the privacy note verbatim", () => {
  assert.ok(
    visionSource.includes("PRIVACY_NOTE") || visionSource.includes(PRIVACY_NOTE),
    "Screen Vision page must render the shared PRIVACY_NOTE",
  );
});

test("readiness: isCaptureReady only true for 'ready'", () => {
  assert.equal(isCaptureReady("ready"), true);
  for (const s of ["idle","requesting","stream-connected","waiting-frame","capturing","analyzing","ended","denied","unsupported","error","active"]) {
    assert.equal(isCaptureReady(s), false, "must not be ready: " + s);
  }
});

test("readiness: canonical happy-path transitions", () => {
  let s = "idle";
  s = nextReadiness(s, "request");     assert.equal(s, "requesting");
  s = nextReadiness(s, "grant");       assert.equal(s, "stream-connected");
  s = nextReadiness(s, "metadata");    assert.equal(s, "waiting-frame");
  s = nextReadiness(s, "frame");       assert.equal(s, "ready");
  s = nextReadiness(s, "capture-start"); assert.equal(s, "capturing");
  s = nextReadiness(s, "capture-done");  assert.equal(s, "analyzing");
  s = nextReadiness(s, "analyze-done");  assert.equal(s, "ready");
});

test("readiness: terminal events", () => {
  assert.equal(nextReadiness("waiting-frame", "deny"),  "denied");
  assert.equal(nextReadiness("ready",         "end"),   "ended");
  assert.equal(nextReadiness("ready",         "error"), "error");
  assert.equal(nextReadiness("error",         "reset"), "idle");
  assert.equal(nextReadiness("idle",          "unsupported"), "unsupported");
});

test("readiness: 'frame' does nothing before stream is connected", () => {
  assert.equal(nextReadiness("idle", "frame"), "idle");
  assert.equal(nextReadiness("requesting", "frame"), "requesting");
});

test("sample points: inside bounds and includes corners + center", () => {
  const pts = computeSamplePoints(100, 60);
  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x < 100, "x in bounds: " + p.x);
    assert.ok(p.y >= 0 && p.y < 60,  "y in bounds: " + p.y);
  }
  const has = (x, y) => pts.some((p) => p.x === x && p.y === y);
  assert.ok(has(0, 0),   "top-left");
  assert.ok(has(99, 59), "bottom-right");
  assert.ok(has(50, 30), "center");
});

test("analyzeSamples: pure black frame -> zeros", () => {
  const s = analyzeSamples(Array.from({length: 25}, () => ({r:0,g:0,b:0})));
  assert.equal(s.count, 25);
  assert.equal(s.avgLuma, 0);
  assert.equal(s.maxLuma, 0);
  assert.equal(s.nonBlackRatio, 0);
});

test("analyzeSamples: bright frame -> high luma, high non-black ratio", () => {
  const s = analyzeSamples(Array.from({length: 25}, () => ({r:200,g:200,b:200})));
  assert.ok(s.avgLuma > 150);
  assert.ok(s.maxLuma > 150);
  assert.equal(s.nonBlackRatio, 1);
});

test("isLikelyBlankFrame: flags black, allows content, treats empty as blank", () => {
  assert.equal(isLikelyBlankFrame(analyzeSamples([{r:0,g:0,b:0},{r:1,g:1,b:1}])), true);
  assert.equal(isLikelyBlankFrame(analyzeSamples([{r:0,g:0,b:0},{r:180,g:180,b:180}])), false);
  assert.equal(isLikelyBlankFrame(analyzeSamples([])), true);
  assert.equal(isLikelyBlankFrame(null), true);
});

test("estimateFps: needs 2+ samples, returns per-second rate", () => {
  assert.equal(estimateFps([]), 0);
  assert.equal(estimateFps([100]), 0);
  // 6 samples spanning 500ms => 5 intervals / 0.5s = 10 fps
  const ts = [0, 100, 200, 300, 400, 500];
  const fps = estimateFps(ts);
  assert.ok(fps > 9.5 && fps < 10.5, "fps ~10 got " + fps);
});

test("recovery hint text is user-actionable and mentions the fix", () => {
  assert.match(NO_FRAME_RECOVERY_HINT, /Entire Screen/i);
  assert.match(NO_FRAME_RECOVERY_HINT, /share again/i);
});

test("vision page: gates Capture & Analyze on isCaptureReady, not raw 'active'", () => {
  // Capture buttons must be disabled unless the pipeline says 'ready'.
  assert.ok(visionSource.includes("isCaptureReady"), "must import/use isCaptureReady");
  assert.ok(visionSource.includes("disabled={!ready"), "capture buttons must use ready gate");
});

test("vision page: waits for a real first frame before enabling capture", () => {
  assert.ok(visionSource.includes("waitForVideoFrame"), "must call waitForVideoFrame");
  assert.ok(visionSource.includes("loadedmetadata"), "must wait for loadedmetadata");
});

test("vision page: renders the recovery hint text when no frame arrives", () => {
  assert.ok(
    visionSource.includes("NO_FRAME_RECOVERY_HINT") || visionSource.includes(NO_FRAME_RECOVERY_HINT),
    "Screen Vision page must render the shared no-frame recovery hint",
  );
});

test("pickCaptureMethod: prefers image-capture when available and ok", () => {
  assert.equal(
    pickCaptureMethod({ imageCaptureAvailable: true, imageCaptureLastOk: true, videoHasFrame: true }),
    "image-capture",
  );
});

test("pickCaptureMethod: falls back to video-canvas when ImageCapture has failed", () => {
  assert.equal(
    pickCaptureMethod({ imageCaptureAvailable: true, imageCaptureLastOk: false, videoHasFrame: true }),
    "video-canvas",
  );
});

test("pickCaptureMethod: uses image-capture even with no video frame when available", () => {
  assert.equal(
    pickCaptureMethod({ imageCaptureAvailable: true, imageCaptureLastOk: true, videoHasFrame: false }),
    "image-capture",
  );
});

test("pickCaptureMethod: returns 'none' when nothing is viable", () => {
  assert.equal(
    pickCaptureMethod({ imageCaptureAvailable: false, imageCaptureLastOk: false, videoHasFrame: false }),
    "none",
  );
});

test("readinessFromSignals: ready when ImageCapture works even if video is dead", () => {
  assert.equal(readinessFromSignals({ videoReady: false, imageCaptureReady: true }), true);
  assert.equal(readinessFromSignals({ videoReady: true,  imageCaptureReady: false }), true);
  assert.equal(readinessFromSignals({ videoReady: false, imageCaptureReady: false }), false);
});

test("formatDiagnostics: includes labeled runtime fields and omits missing ones", () => {
  const out = formatDiagnostics({
    userAgent: "Mozilla/5.0",
    supportsGetDisplayMedia: true,
    supportsImageCapture: true,
    videoReadyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    trackReadyState: "live",
    trackMuted: false,
    displaySurface: "browser",
    imageCaptureLastOk: true,
    previewAvailable: false,
    captureMethod: "image-capture",
  });
  assert.match(out, /^RAH Screen Vision diagnostics/);
  assert.match(out, /browser: Mozilla\/5\.0/);
  assert.match(out, /supportsImageCapture: true/);
  assert.match(out, /video\.videoWidth: 1920/);
  assert.match(out, /track\.readyState: live/);
  assert.match(out, /displaySurface: browser/);
  assert.match(out, /captureMethod: image-capture/);
  assert.doesNotMatch(out, /trackLabel/);
  assert.doesNotMatch(out, /videoLastError/);
});

test("PREVIEW_UNAVAILABLE_LABEL is user-actionable", () => {
  assert.match(PREVIEW_UNAVAILABLE_LABEL, /Capture ready/);
  assert.match(PREVIEW_UNAVAILABLE_LABEL, /live preview unavailable/i);
});

test("vision page: uses ImageCapture.grabFrame as a fallback path", () => {
  assert.ok(visionSource.includes("ImageCapture"), "must reference ImageCapture");
  assert.ok(visionSource.includes("grabFrame"), "must call grabFrame()");
});

test("vision page: readiness gate accepts ImageCapture-only path", () => {
  assert.ok(
    visionSource.includes("readinessFromSignals"),
    "must combine ImageCapture + video signals via readinessFromSignals",
  );
});

test("vision page: renders a diagnostics section with a Copy button", () => {
  assert.ok(visionSource.includes("formatDiagnostics"), "diagnostics panel must render formatDiagnostics()");
  assert.match(visionSource, /Copy diagnostics/, "diagnostics panel must have a Copy diagnostics button");
});

test("vision page: keeps the video element laid out (no display:none/hidden after stream)", () => {
  // After stream assignment, hiding uses opacity, never `hidden` / display:none.
  assert.ok(
    visionSource.includes("opacity-0"),
    "must use opacity-based hiding so the video keeps decoding",
  );
});

test("vision page: still has no auto-capture on mount (regression guard)", () => {
  const bad = [
    /useEffect\([^)]*grabFrame/s,
    /useEffect\([^)]*getDisplayMedia/s,
  ];
  for (const re of bad) assert.doesNotMatch(visionSource, re, "auto-capture pattern: " + re);
});