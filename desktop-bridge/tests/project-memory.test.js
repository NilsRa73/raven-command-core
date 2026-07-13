import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_TYPES,
  MEMORY_INJECTION_MARKER,
  MEMORY_INJECTION_END,
  NO_SILENT_SAVE,
  filterMemories,
  selectRelevantForPrompt,
  buildMemoryInjectionBlock,
  selectWelcomeSummary,
  bucketToday,
  bucketPinned,
  bucketByProject,
  makeMemorySuggestionFromCommand,
  memoryDiagnostics,
} from "../../src/lib/rah/projectMemory.js";

const now = 1_700_000_000_000; // fixed epoch for determinism
const day = 24 * 3600 * 1000;

function mk(overrides) {
  return {
    id: overrides.id ?? "id-" + Math.random().toString(36).slice(2, 8),
    projectId: overrides.projectId ?? null,
    title: overrides.title ?? "t",
    content: overrides.content ?? "",
    type: overrides.type ?? "note",
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? now,
    source: overrides.source ?? "user",
    archived: overrides.archived ?? false,
    pinned: overrides.pinned ?? false,
  };
}

test("MEMORY_TYPES covers all seven required types", () => {
  for (const t of ["note", "decision", "milestone", "blocker", "next_action", "daily_log", "fact"]) {
    assert.ok(MEMORY_TYPES.includes(t), "missing type " + t);
  }
});

test("filterMemories excludes archived by default and honours query/type/project", () => {
  const list = [
    mk({ id: "1", title: "Fix bridge", type: "blocker", projectId: "p1" }),
    mk({ id: "2", title: "Ship v0.2.1", type: "milestone", projectId: "p1" }),
    mk({ id: "3", title: "Old bug", type: "blocker", projectId: "p1", archived: true }),
    mk({ id: "4", title: "Random", type: "note", projectId: "p2" }),
  ];
  const all = filterMemories(list, {});
  assert.equal(all.length, 3, "archived excluded by default");
  assert.equal(filterMemories(list, { includeArchived: true }).length, 4);
  assert.deepEqual(filterMemories(list, { types: ["blocker"] }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterMemories(list, { projectId: "p2" }).map((r) => r.id), ["4"]);
  assert.deepEqual(filterMemories(list, { q: "bridge" }).map((r) => r.id), ["1"]);
});

test("selectRelevantForPrompt: pinned first, then recent, archived excluded, capped, scoped", () => {
  const list = [
    mk({ id: "a", pinned: true, updatedAt: now - 5 * day, projectId: "p1" }),
    mk({ id: "b", pinned: false, updatedAt: now - 1 * day, projectId: "p1" }),
    mk({ id: "c", pinned: false, updatedAt: now - 2 * day, projectId: "p1" }),
    mk({ id: "d", pinned: false, updatedAt: now - 3 * day, projectId: "other" }),
    mk({ id: "e", pinned: true, updatedAt: now, projectId: "p1", archived: true }),
    mk({ id: "g", pinned: false, updatedAt: now, projectId: null }),
  ];
  const picked = selectRelevantForPrompt(list, { projectId: "p1", limit: 4 });
  assert.deepEqual(picked.map((r) => r.id), ["a", "g", "b", "c"]);
  assert.ok(!picked.some((r) => r.id === "e"), "archived pinned excluded");
  assert.ok(!picked.some((r) => r.id === "d"), "other project excluded");
});

test("buildMemoryInjectionBlock returns marker, list, END, excludes archived, empty when none", () => {
  assert.equal(buildMemoryInjectionBlock([]), "");
  const block = buildMemoryInjectionBlock([
    mk({ id: "1", title: "LM Studio via Bridge", type: "fact", pinned: true }),
    mk({ id: "2", title: "Archived thing", archived: true }),
  ], { projectName: "Raven Command" });
  assert.ok(block.startsWith(MEMORY_INJECTION_MARKER));
  assert.ok(block.endsWith(MEMORY_INJECTION_END));
  assert.match(block, /Raven Command/);
  assert.match(block, /LM Studio via Bridge/);
  assert.doesNotMatch(block, /Archived thing/);
});

test("buildMemoryInjectionBlock output is deterministic for identical input", () => {
  const inp = [mk({ id: "1", title: "A", updatedAt: 10 }), mk({ id: "2", title: "B", updatedAt: 20 })];
  assert.equal(buildMemoryInjectionBlock(inp), buildMemoryInjectionBlock(inp));
});

test("selectWelcomeSummary picks newest per type and excludes archived", () => {
  const list = [
    mk({ id: "m1", type: "milestone", updatedAt: now - 3 * day, title: "Old ship" }),
    mk({ id: "m2", type: "milestone", updatedAt: now - 1 * day, title: "Latest ship" }),
    mk({ id: "b1", type: "blocker", updatedAt: now - 2 * day, title: "Blocker A" }),
    mk({ id: "b2", type: "blocker", updatedAt: now, title: "Blocker archived", archived: true }),
    mk({ id: "n1", type: "next_action", updatedAt: now, title: "Do memory sprint" }),
  ];
  const s = selectWelcomeSummary(list, { projectId: null });
  assert.equal(s.lastMilestone?.id, "m2");
  assert.equal(s.currentBlocker?.id, "b1");
  assert.equal(s.nextAction?.id, "n1");
});

test("bucketToday only includes today's non-archived items", () => {
  const list = [
    mk({ id: "1", updatedAt: now }),
    mk({ id: "2", updatedAt: now - 2 * day }),
    mk({ id: "3", updatedAt: now, archived: true }),
  ];
  const t = bucketToday(list, now);
  assert.deepEqual(t.map((r) => r.id).sort(), ["1"]);
});

test("bucketPinned + bucketByProject respect archived exclusion", () => {
  const list = [
    mk({ id: "1", pinned: true, projectId: "p1" }),
    mk({ id: "2", pinned: true, projectId: "p1", archived: true }),
    mk({ id: "3", pinned: false, projectId: "p2" }),
  ];
  assert.deepEqual(bucketPinned(list).map((r) => r.id), ["1"]);
  const grouped = bucketByProject(list);
  assert.equal(grouped.get("p1")?.length, 1);
  assert.equal(grouped.get("p2")?.length, 1);
  assert.ok(!grouped.has("__archived__"));
});

test("makeMemorySuggestionFromCommand: returns editable draft, NEVER auto-saves", () => {
  const cmd = { prompt: "We chose LM Studio as default engine", resultSummary: "OK.", status: "done", agents: ["brain"] };
  const s = makeMemorySuggestionFromCommand(cmd, { projectId: "raven" });
  assert.ok(s?._suggestion === true, "carries suggestion marker for UI");
  assert.equal(s.draft.projectId, "raven");
  assert.equal(s.draft.type, "decision");
  assert.equal(s.draft.pinned, false);
  assert.equal(s.draft.archived, false);
  assert.equal(NO_SILENT_SAVE.suggestionsRequireExplicitConfirm, true);
  // Non-done commands must not yield a suggestion.
  assert.equal(makeMemorySuggestionFromCommand({ ...cmd, status: "error" }), null);
  assert.equal(makeMemorySuggestionFromCommand({ prompt: "", status: "done" }), null);
});

test("memoryDiagnostics returns counts only, never content", () => {
  const list = [
    mk({ id: "1", type: "milestone", pinned: true }),
    mk({ id: "2", type: "blocker", projectId: null }),
    mk({ id: "3", type: "note", archived: true, projectId: "p1" }),
  ];
  const d = memoryDiagnostics(list);
  assert.equal(d.total, 3);
  assert.equal(d.pinned, 1);
  assert.equal(d.archived, 1);
  assert.equal(d.global, 2);
  assert.equal(d.byType.milestone, 1);
  const s = JSON.stringify(d);
  assert.doesNotMatch(s, /title|content/i);
});
