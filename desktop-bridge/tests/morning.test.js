import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWelcomeBack, greetingPhase, dayKey, formatEta } from "../../src/lib/rah/morning.js";

test("greetingPhase buckets by hour", () => {
  assert.equal(greetingPhase(new Date("2026-07-13T06:00:00").getTime()).phase, "morning");
  assert.equal(greetingPhase(new Date("2026-07-13T13:00:00").getTime()).phase, "afternoon");
  assert.equal(greetingPhase(new Date("2026-07-13T19:00:00").getTime()).phase, "evening");
  assert.equal(greetingPhase(new Date("2026-07-13T02:00:00").getTime()).phase, "night");
});

test("dayKey is stable YYYY-MM-DD", () => {
  const s = dayKey(new Date("2026-07-13T09:00:00").getTime());
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
});

test("buildWelcomeBack prefers project fields, then memory", () => {
  const now = new Date("2026-07-13T09:00:00").getTime();
  const project = { id: "p1", name: "Raven", icon: "✦", currentTask: "Ship palette", nextTask: "Wire cluster", blocker: "", estimatedCompletionAt: now + 86400000 };
  const w = buildWelcomeBack({
    now, lastSeenDay: "2026-07-12", userName: "Nils",
    activeProject: project, projects: [project],
    projectMemory: [
      { id: "m1", projectId: "p1", type: "next_action", title: "Fallback next", updatedAt: 1 },
      { id: "m2", projectId: "p1", type: "blocker", title: "From memory", updatedAt: 1 },
    ],
    commands: [], approvals: [],
  });
  assert.equal(w.currentTask, "Ship palette");
  assert.equal(w.nextTask, "Wire cluster");
  assert.equal(w.blocker, "From memory"); // project.blocker was empty → falls back
  assert.equal(w.isFirstVisitToday, true);
  assert.equal(w.recentProjects.length, 1);
});

test("formatEta labels are honest", () => {
  const now = new Date("2026-07-13T12:00:00").getTime();
  assert.equal(formatEta(now, now), "due today");
  assert.equal(formatEta(now + 86400000, now), "due tomorrow");
  assert.equal(formatEta(now + 3 * 86400000, now), "due in 3 days");
  assert.equal(formatEta(now - 2 * 86400000, now), "overdue by 2 days");
  assert.equal(formatEta(null, now), null);
});
