import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildChronicleEntries, groupByDay, filterEntries,
  buildDailySummaryDraft, exportChronicleJson, exportChronicleMarkdown,
} from "../../src/lib/rah/chronicle.js";

const T = 1_700_000_000_000; // fixed base time

function fixtures() {
  return {
    commands: [
      { id: "c1", createdAt: T, prompt: "Summarize progress", status: "done", resultSummary: "OK" },
      { id: "c2", createdAt: T - 3_600_000, prompt: "Broken", status: "error" },
    ],
    projectMemory: [
      { id: "m1", updatedAt: T - 60_000, title: "Shipped bridge", content: "v0.2.1", type: "milestone", archived: false },
      { id: "m2", updatedAt: T - 120_000, title: "Old note", content: "…", type: "note", archived: true },
      { id: "m3", updatedAt: T - 90_000, title: "Blocked on X", content: "…", type: "blocker", archived: false },
    ],
    approvals: [
      { id: "a1", createdAt: T - 30_000, title: "Run script", reason: "test", status: "approved" },
      { id: "a2", createdAt: T - 20_000, title: "Pending", reason: "…", status: "pending" },
    ],
  };
}

test("buildChronicleEntries: merges + sorts desc + drops archived + pending", () => {
  const list = buildChronicleEntries(fixtures());
  const ids = list.map((e) => e.id);
  assert.ok(!ids.includes("mem:m2"), "archived memory excluded");
  assert.ok(!ids.includes("app:a2"), "pending approvals excluded");
  // descending
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].ts >= list[i].ts);
});

test("filterEntries: query + kinds", () => {
  const list = buildChronicleEntries(fixtures());
  const cmdsOnly = filterEntries(list, { kinds: new Set(["command"]) });
  assert.ok(cmdsOnly.every((e) => e.kind === "command"));
  const q = filterEntries(list, { q: "bridge" });
  assert.ok(q.some((e) => e.title.toLowerCase().includes("bridge")));
});

test("groupByDay: buckets by local date", () => {
  const list = buildChronicleEntries(fixtures());
  const groups = groupByDay(list);
  assert.ok(groups.length >= 1);
  for (const g of groups) assert.ok(g.day.match(/^\d{4}-\d{2}-\d{2}$/));
});

test("buildDailySummaryDraft: counts only that day, requires explicit save", () => {
  const list = buildChronicleEntries(fixtures());
  const draft = buildDailySummaryDraft(list, { now: T });
  assert.equal(draft.requiresExplicitSave, true);
  assert.ok(draft.text.startsWith("# Chronicle — "));
  assert.ok(draft.counts.commands >= 1);
});

test("buildDailySummaryDraft: empty day reports no activity, does not fabricate", () => {
  const draft = buildDailySummaryDraft([], { now: T });
  assert.ok(draft.text.includes("No activity recorded"));
  assert.equal(draft.counts.commands, 0);
});

test("exports produce non-empty strings", () => {
  const list = buildChronicleEntries(fixtures());
  assert.ok(exportChronicleJson(list).includes("entries"));
  assert.ok(exportChronicleMarkdown(list).startsWith("# Raven Chronicle export"));
});