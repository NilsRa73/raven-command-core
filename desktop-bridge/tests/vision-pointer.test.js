import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPointerState, reducePointer, canUndo, canRedo, draftDrawRect,
  shortcutsAreSuppressed, KEY_NUDGE_LARGE,
} from "../../src/lib/rah/visionPointer.js";
import { computeDisplayTransform } from "../../src/lib/rah/visionGeometry.js";

const frame = { width: 1000, height: 800 };
const transform = computeDisplayTransform({ displayWidth: 500, displayHeight: 400, sourceWidth: 1000, sourceHeight: 800 });

test("createPointerState starts idle with no selection", () => {
  const s = createPointerState();
  assert.equal(s.mode, "idle");
  assert.equal(s.selectedId, null);
  assert.deepEqual(s.regions, []);
  assert.equal(s.dirty, false);
});

test("drag on empty canvas creates a normalized region + selects it", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  assert.equal(s.mode, "drawing");
  s = reducePointer(s, { type: "pointer-move", point: { x: 150, y: 120 }, transform, frame });
  const draft = draftDrawRect(s, frame);
  assert.ok(draft && draft.w > 0 && draft.h > 0);
  s = reducePointer(s, { type: "pointer-up", point: { x: 150, y: 120 }, transform, frame });
  assert.equal(s.regions.length, 1);
  assert.equal(s.mode, "idle");
  assert.equal(s.selectedId, s.regions[0].id);
  assert.equal(s.dirty, true);
});

test("draws are rejected when below min edge (no region added)", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 100, y: 100 }, transform, frame });
  s = reducePointer(s, { type: "pointer-up", point: { x: 100, y: 100 }, transform, frame });
  assert.equal(s.regions.length, 0);
  assert.equal(s.mode, "idle");
});

test("arrow key nudges selected region in source pixels", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  s = reducePointer(s, { type: "pointer-up", point: { x: 200, y: 200 }, transform, frame });
  const before = s.regions[0];
  s = reducePointer(s, { type: "key", key: "ArrowRight", shift: false, frame });
  const after = s.regions[0];
  assert.equal(after.x, before.x + 1);
  assert.equal(after.y, before.y);
});

test("Shift+arrow resizes selected region via east/south handles", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  s = reducePointer(s, { type: "pointer-up", point: { x: 200, y: 200 }, transform, frame });
  const before = s.regions[0];
  s = reducePointer(s, { type: "key", key: "ArrowRight", shift: true, frame });
  assert.equal(s.regions[0].w, before.w + KEY_NUDGE_LARGE);
});

test("Delete removes selected region and clears selection", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  s = reducePointer(s, { type: "pointer-up", point: { x: 200, y: 200 }, transform, frame });
  s = reducePointer(s, { type: "key", key: "Delete", frame });
  assert.equal(s.regions.length, 0);
  assert.equal(s.selectedId, null);
});

test("undo/redo walk history without mutating dirty=false", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  s = reducePointer(s, { type: "pointer-up", point: { x: 200, y: 200 }, transform, frame });
  assert.equal(canUndo(s), true);
  s = reducePointer(s, { type: "undo" });
  assert.equal(s.regions.length, 0);
  assert.equal(canRedo(s), true);
  s = reducePointer(s, { type: "redo" });
  assert.equal(s.regions.length, 1);
});

test("clear-all wipes regions and is a no-op when already empty", () => {
  let s = createPointerState();
  const first = s;
  s = reducePointer(s, { type: "clear-all" });
  assert.strictEqual(s, first);
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  s = reducePointer(s, { type: "pointer-up", point: { x: 200, y: 200 }, transform, frame });
  s = reducePointer(s, { type: "clear-all" });
  assert.equal(s.regions.length, 0);
});

test("relabel updates label without changing geometry or count", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  s = reducePointer(s, { type: "pointer-up", point: { x: 200, y: 200 }, transform, frame });
  const id = s.regions[0].id;
  const before = { ...s.regions[0] };
  s = reducePointer(s, { type: "relabel", id, label: "email" });
  assert.equal(s.regions[0].label, "email");
  assert.equal(s.regions[0].x, before.x);
  assert.equal(s.regions[0].w, before.w);
});

test("shortcutsAreSuppressed detects text inputs and contenteditable", () => {
  assert.equal(shortcutsAreSuppressed({ tagName: "INPUT" }), true);
  assert.equal(shortcutsAreSuppressed({ tagName: "TEXTAREA" }), true);
  assert.equal(shortcutsAreSuppressed({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(shortcutsAreSuppressed({ tagName: "DIV" }), false);
  assert.equal(shortcutsAreSuppressed(null), false);
});

test("pointer-cancel discards in-flight drag without persisting", () => {
  let s = createPointerState();
  s = reducePointer(s, { type: "pointer-down", point: { x: 50, y: 50 }, transform, frame });
  s = reducePointer(s, { type: "pointer-move", point: { x: 200, y: 200 }, transform, frame });
  s = reducePointer(s, { type: "pointer-cancel" });
  assert.equal(s.mode, "idle");
  assert.equal(s.regions.length, 0);
});