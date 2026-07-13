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
  buildScreenVisionRuntimeLine,
  computeCaptureSize,
  presetById,
  sharingStateLabel,
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