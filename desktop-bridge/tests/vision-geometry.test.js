import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_REGION_EDGE, DEFAULT_HISTORY_LIMIT,
  computeDisplayTransform, displayToImage, imageToDisplay,
  normalizeDrag, clampRegionToFrame, moveRegion, resizeRegion,
  hitTestRegion, hitTestHandle, sortRegionsStable, regionsAreDirty,
  createRegion, createHistory, historyPresent, historyPush,
  canUndo, canRedo, historyUndo, historyRedo, frameDuplicateStrength,
} from "../../src/lib/rah/visionGeometry.js";

test("computeDisplayTransform returns null for invalid input", () => {
  assert.equal(computeDisplayTransform({}), null);
  assert.equal(computeDisplayTransform({ displayWidth: 0, displayHeight: 100, sourceWidth: 10, sourceHeight: 10 }), null);
});

test("contain-fit letterboxes correctly and roundtrips coordinates", () => {
  // Source 1000x500, display 400x400 → contain scale = 0.4, drawn 400x200,
  // offsetY = 100 (letterboxed top/bottom).
  const t = computeDisplayTransform({ displayWidth: 400, displayHeight: 400, sourceWidth: 1000, sourceHeight: 500 });
  assert.ok(t);
  assert.equal(t.scale, 0.4);
  assert.equal(t.offsetX, 0);
  assert.equal(t.offsetY, 100);
  const imgPt = displayToImage(t, { x: 200, y: 200 });
  assert.deepEqual(imgPt, { x: 500, y: 250 });
  const back = imageToDisplay(t, imgPt);
  assert.deepEqual(back, { x: 200, y: 200 });
});

test("displayToImage clamps points outside the drawn area into source bounds", () => {
  const t = computeDisplayTransform({ displayWidth: 400, displayHeight: 400, sourceWidth: 1000, sourceHeight: 500 });
  // Point above the letterbox top → should clamp to y=0.
  const p = displayToImage(t, { x: -50, y: -50 });
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
  const p2 = displayToImage(t, { x: 9999, y: 9999 });
  assert.equal(p2.x, 1000);
  assert.equal(p2.y, 500);
});

test("normalizeDrag handles reverse and diagonal drags with positive dimensions", () => {
  const frame = { width: 800, height: 600 };
  const a = normalizeDrag({ start: { x: 500, y: 400 }, end: { x: 100, y: 50 }, frame });
  assert.equal(a.ok, true);
  assert.deepEqual(a.rect, { x: 100, y: 50, w: 400, h: 350 });
  const b = normalizeDrag({ start: { x: 100, y: 400 }, end: { x: 500, y: 50 }, frame });
  assert.equal(b.ok, true);
  assert.deepEqual(b.rect, { x: 100, y: 50, w: 400, h: 350 });
});

test("normalizeDrag rejects sub-minimum drags and out-of-bounds frames", () => {
  const frame = { width: 800, height: 600 };
  const tiny = normalizeDrag({ start: { x: 10, y: 10 }, end: { x: 11, y: 11 }, frame });
  assert.equal(tiny.ok, false);
  assert.equal(tiny.reason, "below_min_edge");
  const bad = normalizeDrag({ start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, frame: { width: 0, height: 100 } });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "frame_dimensions_invalid");
  const missing = normalizeDrag({});
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_input");
});

test("normalizeDrag clamps drags that start or end outside the frame", () => {
  const frame = { width: 800, height: 600 };
  const r = normalizeDrag({ start: { x: -100, y: -100 }, end: { x: 200, y: 200 }, frame });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rect, { x: 0, y: 0, w: 200, h: 200 });
  const r2 = normalizeDrag({ start: { x: 700, y: 500 }, end: { x: 9999, y: 9999 }, frame });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.rect, { x: 700, y: 500, w: 100, h: 100 });
});

test("clampRegionToFrame keeps regions inside bounds and enforces min edge", () => {
  const frame = { width: 100, height: 100 };
  const c = clampRegionToFrame({ x: -10, y: -10, w: 200, h: 200 }, frame);
  assert.deepEqual({ x: c.x, y: c.y, w: c.w, h: c.h }, { x: 0, y: 0, w: 100, h: 100 });
  const c2 = clampRegionToFrame({ x: 50, y: 50, w: 1, h: 1 }, frame);
  assert.equal(c2.w >= MIN_REGION_EDGE, true);
  assert.equal(c2.h >= MIN_REGION_EDGE, true);
  assert.equal(c2.x + c2.w <= frame.width, true);
  assert.equal(c2.y + c2.h <= frame.height, true);
});

test("moveRegion clamps at frame edges", () => {
  const frame = { width: 100, height: 100 };
  const r = { id: "a", x: 10, y: 10, w: 40, h: 40, label: null, createdAt: 1 };
  assert.deepEqual(moveRegion(r, { dx: -999, dy: -999 }, frame), { ...r, x: 0, y: 0 });
  assert.deepEqual(moveRegion(r, { dx: 999, dy: 999 }, frame), { ...r, x: 60, y: 60 });
});

test("resizeRegion respects minimum edge and clamps to frame", () => {
  const frame = { width: 200, height: 200 };
  const r = { id: "a", x: 50, y: 50, w: 100, h: 100, label: null, createdAt: 1 };
  const nw = resizeRegion(r, "nw", { dx: 40, dy: 40 }, frame);
  assert.deepEqual({ x: nw.x, y: nw.y, w: nw.w, h: nw.h }, { x: 90, y: 90, w: 60, h: 60 });
  const collapse = resizeRegion(r, "nw", { dx: 999, dy: 999 }, frame);
  assert.equal(collapse.w >= MIN_REGION_EDGE, true);
  assert.equal(collapse.h >= MIN_REGION_EDGE, true);
  const over = resizeRegion(r, "se", { dx: 9999, dy: 9999 }, frame);
  assert.equal(over.x + over.w <= frame.width, true);
  assert.equal(over.y + over.h <= frame.height, true);
});

test("hitTestRegion is inclusive-exclusive on right/bottom edges", () => {
  const r = { id: "a", x: 10, y: 10, w: 20, h: 20, label: null, createdAt: 1 };
  assert.equal(hitTestRegion(r, { x: 10, y: 10 }), true);
  assert.equal(hitTestRegion(r, { x: 29, y: 29 }), true);
  assert.equal(hitTestRegion(r, { x: 30, y: 30 }), false);
  assert.equal(hitTestRegion(r, { x: 5, y: 5 }), false);
});

test("hitTestHandle detects handles and body via display transform", () => {
  const t = computeDisplayTransform({ displayWidth: 200, displayHeight: 200, sourceWidth: 200, sourceHeight: 200 });
  const r = { id: "a", x: 50, y: 50, w: 100, h: 100, label: null, createdAt: 1 };
  assert.equal(hitTestHandle(r, t, { x: 50, y: 50 }), "nw");
  assert.equal(hitTestHandle(r, t, { x: 150, y: 150 }), "se");
  assert.equal(hitTestHandle(r, t, { x: 100, y: 100 }), "body");
  assert.equal(hitTestHandle(r, t, { x: 500, y: 500 }), null);
});

test("sortRegionsStable orders by createdAt then id and regionsAreDirty ignores order", () => {
  const a = [
    createRegion({ x: 0, y: 0, w: 10, h: 10, now: 2, regionId: "b" }),
    createRegion({ x: 0, y: 0, w: 10, h: 10, now: 1, regionId: "a" }),
  ];
  const sorted = sortRegionsStable(a);
  assert.deepEqual(sorted.map(r => r.id), ["a", "b"]);
  assert.equal(regionsAreDirty(a, sorted), false);
  const changed = sorted.map(r => ({ ...r, w: r.w + 1 }));
  assert.equal(regionsAreDirty(sorted, changed), true);
});

test("history push/undo/redo maintains present, clears redo on new push, and caps depth", () => {
  let h = createHistory([]);
  assert.equal(canUndo(h), false);
  const r1 = [createRegion({ x: 0, y: 0, w: 10, h: 10, now: 1, regionId: "a" })];
  h = historyPush(h, r1);
  assert.deepEqual(historyPresent(h).map(r => r.id), ["a"]);
  assert.equal(canUndo(h), true);
  // No-op push should coalesce.
  const h2 = historyPush(h, r1.slice());
  assert.equal(h2, h);
  const r2 = r1.concat([createRegion({ x: 20, y: 20, w: 10, h: 10, now: 2, regionId: "b" })]);
  h = historyPush(h, r2);
  h = historyUndo(h);
  assert.deepEqual(historyPresent(h).map(r => r.id), ["a"]);
  assert.equal(canRedo(h), true);
  h = historyRedo(h);
  assert.deepEqual(historyPresent(h).map(r => r.id), ["a", "b"]);
  // New push must clear redo.
  h = historyPush(h, []);
  assert.equal(canRedo(h), false);

  // Depth cap.
  let capped = createHistory([], { limit: 3 });
  for (let i = 0; i < 10; i++) {
    capped = historyPush(capped, [createRegion({ x: i, y: 0, w: 10, h: 10, now: i, regionId: `r${i}` })]);
  }
  assert.equal(capped.past.length, 3);
  assert.equal(capped.limit, 3);
  // Undo cannot pop past the last kept snapshot.
  const drained = historyUndo(historyUndo(historyUndo(capped)));
  assert.equal(canUndo(drained), false);
  assert.equal(historyPresent(drained).length >= 0, true);
});

test("history defaults to DEFAULT_HISTORY_LIMIT", () => {
  const h = createHistory();
  assert.equal(h.limit, DEFAULT_HISTORY_LIMIT);
});

test("frameDuplicateStrength prefers hash and labels weaker metadata match", () => {
  const a = { hash: "sha256:aa", width: 10, height: 10, sizeBytes: 100 };
  const b = { hash: "sha256:aa", width: 999, height: 999, sizeBytes: 999 };
  assert.deepEqual(frameDuplicateStrength(a, b), { duplicate: true, strength: "hash" });
  const c = { hash: "sha256:aa" };
  const d = { hash: "sha256:bb" };
  assert.deepEqual(frameDuplicateStrength(c, d), { duplicate: false, strength: "hash" });
  const e = { width: 10, height: 10, sizeBytes: 100 };
  const f = { width: 10, height: 10, sizeBytes: 100 };
  assert.deepEqual(frameDuplicateStrength(e, f), { duplicate: true, strength: "metadata" });
  const g = { width: 10, height: 10, sizeBytes: 100 };
  const h = { width: 10, height: 10, sizeBytes: 101 };
  assert.deepEqual(frameDuplicateStrength(g, h), { duplicate: false, strength: "none" });
  assert.deepEqual(frameDuplicateStrength(null, null), { duplicate: false, strength: "none" });
});