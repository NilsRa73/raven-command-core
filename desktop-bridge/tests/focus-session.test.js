import assert from "node:assert/strict";
import { test } from "node:test";

import {
  newFocusDraft, isFocusDraftDirty, start, pause, resume, complete, cancel,
  reset, logInterruption, computeTiming, restoreAfterReload, formatDuration,
  buildCompletionDraft, filterHistory, shapeHistoryForExport,
  FOCUS_COMMANDS, rankCommands, shouldSuppressShortcut, isActive,
} from "../../src/lib/rah/focusSession.js";

test("newFocusDraft: clean draft is not dirty", () => {
  const d = newFocusDraft({ projectId: "p1", now: 1 });
  assert.equal(d.status, "draft");
  assert.equal(isFocusDraftDirty(d, "p1"), false);
});

test("dirty detection triggers on title, mode, duration, notes, agents", () => {
  const d = newFocusDraft({ projectId: null, now: 1 });
  assert.equal(isFocusDraftDirty({ ...d, title: "x" }, null), true);
  assert.equal(isFocusDraftDirty({ ...d, mode: "deep" }, null), true);
  assert.equal(isFocusDraftDirty({ ...d, plannedDurationMs: 60000 }, null), true);
  assert.equal(isFocusDraftDirty({ ...d, notes: "hi" }, null), true);
  assert.equal(isFocusDraftDirty({ ...d, agents: ["a"] }, null), true);
});

test("start requires title and refuses non-draft input", () => {
  const d = newFocusDraft({ projectId: null, now: 1 });
  assert.throws(() => start(d, 10));
  const d2 = { ...d, title: "Ship it" };
  const s = start(d2, 10);
  assert.equal(s.status, "running");
  assert.equal(s.startedAt, 10);
  assert.throws(() => start(s, 20));
});

test("pause/resume math accumulates paused time honestly", () => {
  const s = start({ ...newFocusDraft({ now: 0 }), title: "t" }, 0);
  const p = pause(s, 5_000);
  assert.equal(p.status, "paused");
  const r = resume(p, 8_000);
  assert.equal(r.status, "running");
  assert.equal(r.accumulatedPausedMs, 3_000);
  const t = computeTiming(r, 10_000);
  assert.equal(t.elapsedMs, 10_000 - 0 - 3_000);
});

test("computeTiming clamps and marks invalid on backward clock", () => {
  const s = start({ ...newFocusDraft({ now: 100 }), title: "t" }, 100);
  const t = computeTiming(s, 50); // now before start
  assert.equal(t.status, "invalid");
  assert.equal(t.elapsedMs, 0);
  assert.equal(t.warning, "clock moved backward");
});

test("complete rolls in pending paused time and freezes timing", () => {
  const s = start({ ...newFocusDraft({ now: 0 }), title: "t", plannedDurationMs: 10_000 }, 0);
  const p = pause(s, 4_000);
  const c = complete(p, 9_000);
  assert.equal(c.status, "completed");
  assert.equal(c.accumulatedPausedMs, 5_000);
  const t = computeTiming(c, 999_999);
  assert.equal(t.elapsedMs, 9_000 - 5_000); // 4s of real work
  assert.equal(t.remainingMs, 10_000 - 4_000);
});

test("cancel path is symmetric with complete", () => {
  const s = start({ ...newFocusDraft({ now: 0 }), title: "t" }, 0);
  const c = cancel(s, 3_000);
  assert.equal(c.status, "cancelled");
  assert.equal(c.cancelledAt, 3_000);
});

test("reset returns to a fresh draft with same config", () => {
  const s = start({ ...newFocusDraft({ now: 0 }), title: "t", mode: "deep" }, 0);
  const d = reset(s, 100);
  assert.equal(d.status, "draft");
  assert.equal(d.mode, "deep");
  assert.equal(d.title, "t");
});

test("logInterruption appends deterministically", () => {
  const s = start({ ...newFocusDraft({ now: 0 }), title: "t" }, 0);
  const a = logInterruption(s, "phone", 1_000);
  const b = logInterruption(a, "  door  ", 2_000);
  assert.deepEqual(b.interruptions, [
    { ts: 1_000, note: "phone" },
    { ts: 2_000, note: "door" },
  ]);
});

test("restoreAfterReload pauses running sessions when clock is inconsistent", () => {
  const s = start({ ...newFocusDraft({ now: 100 }), title: "t" }, 100);
  const r = restoreAfterReload(s, 50);
  assert.equal(r.status, "paused");
  assert.ok(Number.isFinite(r.pausedAt));
});

test("formatDuration: MM:SS and HH:MM:SS", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(3_723_000), "1:02:03");
  assert.equal(formatDuration(NaN), "—");
  assert.equal(formatDuration(-1_500), "-0:01");
});

test("buildCompletionDraft captures elapsed and interruption count", () => {
  const s = start({ ...newFocusDraft({ now: 0 }), title: "Ship it" }, 0);
  const i = logInterruption(s, "call", 1_000);
  const c = complete(i, 5_000);
  const draft = buildCompletionDraft(c, 5_000);
  assert.equal(draft.title, "Ship it");
  assert.equal(draft.elapsedMs, 5_000);
  assert.equal(draft.interruptionCount, 1);
  assert.equal(draft.status, "completed");
});

test("filterHistory: project + status + newest-first", () => {
  const rows = [
    { id: "a", projectId: "p1", status: "completed", createdAt: 1 },
    { id: "b", projectId: "p2", status: "completed", createdAt: 2 },
    { id: "c", projectId: "p1", status: "cancelled", createdAt: 3 },
  ];
  const out = filterHistory(rows, { projectId: "p1" });
  assert.deepEqual(out.map((r) => r.id), ["c", "a"]);
  const out2 = filterHistory(rows, { status: "completed" });
  assert.deepEqual(out2.map((r) => r.id), ["b", "a"]);
});

test("shapeHistoryForExport carries the manifest key", () => {
  const rec = complete(start({ ...newFocusDraft({ now: 0 }), title: "t" }, 0), 1_000);
  const shaped = shapeHistoryForExport([rec], { now: 999, projectName: "P" });
  assert.equal(shaped.kind, "raven-focus-history/v1");
  assert.equal(shaped.count, 1);
  assert.equal(shaped.projectName, "P");
});

test("rankCommands: exact > prefix > contains > fuzzy; stable ties", () => {
  const ranked = rankCommands(FOCUS_COMMANDS, "start");
  assert.equal(ranked[0].id, "focus:start");
  const fuzzy = rankCommands(FOCUS_COMMANDS, "cmp");
  assert.ok(fuzzy.find((c) => c.id === "focus:complete"));
});

test("shouldSuppressShortcut: input/textarea/contentEditable suppressed", () => {
  assert.equal(shouldSuppressShortcut({ tagName: "INPUT" }), true);
  assert.equal(shouldSuppressShortcut({ tagName: "TEXTAREA" }), true);
  assert.equal(shouldSuppressShortcut({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(shouldSuppressShortcut({ tagName: "DIV" }), false);
  assert.equal(shouldSuppressShortcut({ tagName: "INPUT" }, { key: "Escape", escapeAllowed: true }), false);
});

test("isActive covers running/paused only", () => {
  const s = start({ ...newFocusDraft({ now: 0 }), title: "t" }, 0);
  assert.equal(isActive(s), true);
  assert.equal(isActive(pause(s, 1)), true);
  assert.equal(isActive(complete(s, 1)), false);
  assert.equal(isActive(null), false);
});