import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ROADMAP_STATUSES, ROADMAP_COLUMNS, UNASSIGNED_COLUMN,
  normalizeMilestone, groupByColumn, moveMilestone, reorderWithinColumn,
  isRoadmapDirty, validateRoadmap, exportRoadmapJson, exportRoadmapMarkdown,
  NO_SILENT_SAVE,
} from "../../src/lib/rah/roadmap.js";

const now = 1_700_000_000_000;

function m(id, patch = {}) {
  return {
    id, projectId: "p1", title: "Milestone " + id, description: "", status: "backlog",
    priority: "normal", targetDate: null, owner: null, dependencies: [], evidenceIds: [],
    order: 0, createdAt: now, updatedAt: now, source: "user", ...patch,
  };
}

test("normalizeMilestone: unknown status becomes empty and rawStatus captured", () => {
  const n = normalizeMilestone({ id: "x", status: "reviewed" });
  assert.equal(n.status, "");
  assert.equal(n.rawStatus, "reviewed");
});

test("normalizeMilestone: invalid date is dropped to null", () => {
  const n = normalizeMilestone({ id: "x", targetDate: "not-a-date" });
  assert.equal(n.targetDate, null);
});

test("groupByColumn: all five columns present + unassigned; unknowns land in unassigned", () => {
  const list = [m("a"), m("b", { status: "in_progress" }), m("c", { status: "reviewed" })];
  const g = groupByColumn(list, { projectId: "p1" });
  for (const c of ROADMAP_COLUMNS) assert.ok(Array.isArray(g[c]));
  assert.equal(g.backlog.length, 1);
  assert.equal(g.in_progress.length, 1);
  assert.equal(g[UNASSIGNED_COLUMN].length, 1);
  assert.equal(g[UNASSIGNED_COLUMN][0].id, "c");
});

test("moveMilestone: cross-column move recomputes order densely", () => {
  const list = [m("a", { order: 0 }), m("b", { order: 1 }), m("c", { status: "done", order: 0 })];
  const next = moveMilestone(list, "a", "done", 0);
  const g = groupByColumn(next);
  assert.deepEqual(g.done.map((x) => x.id), ["a", "c"]);
  assert.deepEqual(g.done.map((x) => x.order), [0, 1]);
  assert.equal(g.backlog.length, 1);
  assert.equal(g.backlog[0].id, "b");
  assert.equal(g.backlog[0].order, 0);
});

test("reorderWithinColumn: keyboard move up/down respects bounds", () => {
  const list = [m("a", { order: 0 }), m("b", { order: 1 }), m("c", { order: 2 })];
  const next = reorderWithinColumn(list, "b", -1);
  const g = groupByColumn(next);
  assert.deepEqual(g.backlog.map((x) => x.id), ["b", "a", "c"]);

  const bounded = reorderWithinColumn(list, "a", -1); // can't go up from top
  const g2 = groupByColumn(bounded);
  assert.deepEqual(g2.backlog.map((x) => x.id), ["a", "b", "c"]);
});

test("isRoadmapDirty: detects order, status, and field changes", () => {
  const saved = [m("a"), m("b", { order: 1 })];
  assert.equal(isRoadmapDirty(saved, saved), false);
  assert.equal(isRoadmapDirty(saved, [m("a", { title: "changed" }), m("b", { order: 1 })]), true);
  assert.equal(isRoadmapDirty(saved, [m("a"), m("b", { order: 2 })]), true);
  assert.equal(isRoadmapDirty(saved, [m("a"), m("b", { order: 1, status: "done" })]), true);
});

test("validateRoadmap: empty title, duplicate id, missing/self/circular deps", () => {
  const list = [
    m("a", { title: "" }),
    m("a", { title: "dup" }),
    m("b", { dependencies: ["b"] }),
    m("c", { dependencies: ["ghost"] }),
    m("d", { dependencies: ["e"] }),
    m("e", { dependencies: ["d"] }),
    m("f", { status: "reviewed" }),
  ];
  const v = validateRoadmap(list);
  assert.equal(v.valid, false);
  const codes = v.errors.map((e) => e.code);
  assert.ok(codes.includes("empty_title"));
  assert.ok(codes.includes("duplicate_id"));
  assert.ok(codes.includes("self_dependency"));
  assert.ok(codes.includes("missing_dependency"));
  assert.ok(codes.includes("circular_dependency"));
  assert.ok(codes.includes("invalid_status"));
});

test("validateRoadmap: clean roadmap is valid", () => {
  const list = [m("a"), m("b", { status: "planned", dependencies: ["a"] })];
  assert.equal(validateRoadmap(list).valid, true);
});

test("exportRoadmapJson/Markdown: contain project + validation metadata", () => {
  const list = [m("a"), m("b", { status: "done" })];
  const project = { id: "p1", name: "RAH OS" };
  const j = exportRoadmapJson({ project, milestones: list, exportedAt: now });
  assert.equal(j.kind, "raven-roadmap/v1");
  assert.equal(j.project.name, "RAH OS");
  assert.equal(j.columns.length, ROADMAP_COLUMNS.length);
  assert.equal(j.validation.valid, true);
  const md = exportRoadmapMarkdown({ project, milestones: list, exportedAt: now });
  assert.ok(md.includes("# Roadmap — RAH OS"));
  assert.ok(md.includes("## Backlog"));
  assert.ok(md.includes("## Done"));
});

test("NO_SILENT_SAVE contract is frozen", () => {
  assert.equal(NO_SILENT_SAVE.roadmapRequiresExplicitSave, true);
  assert.equal(NO_SILENT_SAVE.dragUpdatesInMemoryDraftOnly, true);
  assert.throws(() => { NO_SILENT_SAVE.roadmapRequiresExplicitSave = false; });
});

test("ROADMAP_STATUSES contains the five required columns", () => {
  for (const s of ["backlog", "planned", "in_progress", "blocked", "done"]) {
    assert.ok(ROADMAP_STATUSES.includes(s));
  }
});