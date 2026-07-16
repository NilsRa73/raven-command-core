import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRoutine, isRoutineForDay, isRoutineDueNow,
  routinesDueToday, routineLabel, WEEKDAYS,
} from "../../src/lib/rah/routines.js";

test("normalizeRoutine rejects malformed time", () => {
  assert.throws(() => normalizeRoutine({ time: "9am" }));
  assert.throws(() => normalizeRoutine({ time: "25:00" }));
});

test("normalizeRoutine fills defaults + trims fields", () => {
  const r = normalizeRoutine({ time: "17:00", name: "x".repeat(200), action: "y" }, 1000);
  assert.equal(r.time, "17:00");
  assert.equal(r.name.length, 120);
  assert.equal(r.enabled, true);
  assert.equal(r.days.length, 0);
  assert.equal(r.createdAt, 1000);
});

test("isRoutineForDay respects weekday filter", () => {
  const r = normalizeRoutine({ time: "10:00", days: ["mon"], action: "a" });
  const mon = new Date(2024, 0, 1, 12, 0, 0);
  const tue = new Date(2024, 0, 2, 12, 0, 0);
  assert.equal(WEEKDAYS[mon.getDay()], "mon");
  assert.equal(isRoutineForDay(r, mon), true);
  assert.equal(isRoutineForDay(r, tue), false);
});

test("isRoutineDueNow flips after scheduled time and blocks after run", () => {
  const r = normalizeRoutine({ time: "10:00", action: "a" });
  const before = new Date(2024, 0, 1, 9, 30, 0);
  const after = new Date(2024, 0, 1, 10, 30, 0);
  assert.equal(isRoutineDueNow(r, before), false);
  assert.equal(isRoutineDueNow(r, after), true);
  const done = { ...r, lastRunTs: new Date(2024, 0, 1, 10, 15, 0).getTime() };
  assert.equal(isRoutineDueNow(done, after), false);
});

test("disabled routines are never due and label formats time+room", () => {
  const r = normalizeRoutine({ time: "17:00", room: "Living Room", action: "a", enabled: false });
  assert.equal(isRoutineForDay(r, new Date(2024, 0, 1, 18, 0, 0)), false);
  assert.equal(routineLabel(r), "17:00 · Living Room");
  assert.equal(routinesDueToday([r], new Date(2024, 0, 1)).length, 0);
});