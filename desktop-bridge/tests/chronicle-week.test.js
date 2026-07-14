import { test } from "node:test";
import assert from "node:assert/strict";

import { buildChronicleEntries, filterEntries } from "../../src/lib/rah/chronicle.js";
import {
  weekBoundsFromDate, shiftWeek, isoWeek, entriesInWeek, aggregateWeek,
  buildWeeklyDraft, findExistingWeeklySummary, buildSaveableWeeklySummary,
  buildExportMetadata, exportFilteredChronicleJson, exportFilteredChronicleMarkdown,
  exportWeeklyDraftJson, exportWeeklyDraftMarkdown, weeklySummaryTitle,
} from "../../src/lib/rah/chronicleWeek.js";

// A local Wednesday: 2024-06-12 10:00 local time.
const T = new Date(2024, 5, 12, 10, 0, 0, 0).getTime();

function fx() {
  return {
    commands: [
      { id: "c1", createdAt: T, prompt: "Ship X", status: "done", projectId: "P1", resultSummary: "OK" },
      { id: "c2", createdAt: T - 60_000, prompt: "Broke", status: "error", projectId: "P1" },
      { id: "c3", createdAt: T - 120_000, prompt: "Loose", status: "done" }, // unassigned
      { id: "cOld", createdAt: T - 15 * 86_400_000, prompt: "Old", status: "done", projectId: "P1" },
    ],
    projectMemory: [
      { id: "m1", updatedAt: T, title: "Chose SQLite", type: "decision", projectId: "P1", archived: false },
      { id: "m2", updatedAt: T, title: "Blocked on API", type: "blocker", projectId: "P1", archived: false },
      { id: "m3", updatedAt: T, title: "Global note", type: "note", projectId: null, archived: false },
      { id: "m4", updatedAt: T, title: "Ship next", type: "next_action", projectId: "P1", archived: false },
      { id: "mArch", updatedAt: T, title: "Old", type: "note", projectId: "P1", archived: true },
    ],
    approvals: [
      { id: "a1", createdAt: T - 30_000, title: "Run script", reason: "test", status: "approved", commandId: "c1" },
      { id: "aP", createdAt: T, title: "Pending", reason: "…", status: "pending" },
    ],
    workflowRuns: [
      { runId: "r1", workflowId: "wf1", workflowName: "Nightly", createdAt: T, finishedAt: T, status: "completed", projectId: "P1" },
      { runId: "r2", workflowId: "wf2", workflowName: "Broken", createdAt: T, finishedAt: T, status: "failed", projectId: "P1", errorMessage: "boom" },
      { runId: "rDraft", workflowId: "wf3", createdAt: T, status: "draft", projectId: "P1" },
    ],
  };
}

test("buildChronicleEntries attaches projectId and source", () => {
  const list = buildChronicleEntries(fx());
  const c1 = list.find((e) => e.id === "cmd:c1");
  assert.equal(c1.projectId, "P1");
  assert.equal(c1.source, "command");
  const c3 = list.find((e) => e.id === "cmd:c3");
  assert.equal(c3.projectId, null);
  const app = list.find((e) => e.id === "app:a1");
  assert.equal(app.projectId, "P1", "approval inherits projectId from linked command");
  assert.ok(list.find((e) => e.id === "run:r1"));
  assert.ok(!list.find((e) => e.id === "run:rDraft"), "draft runs excluded");
});

test("filterEntries: projectId scoping (all / null / specific)", () => {
  const list = buildChronicleEntries(fx());
  const all = filterEntries(list, {});
  assert.ok(all.length > 0);
  const unassigned = filterEntries(list, { projectId: null });
  assert.ok(unassigned.every((e) => (e.projectId ?? null) === null));
  assert.ok(unassigned.some((e) => e.id === "cmd:c3"));
  assert.ok(!unassigned.some((e) => e.id === "cmd:c1"), "P1 entry excluded from unassigned");
  const p1 = filterEntries(list, { projectId: "P1" });
  assert.ok(p1.every((e) => e.projectId === "P1"));
});

test("filterEntries: composes q + sources + kinds + date range", () => {
  const list = buildChronicleEntries(fx());
  const composed = filterEntries(list, {
    q: "ship", kinds: new Set(["command"]),
    sources: new Set(["command"]), from: T - 5_000, to: T + 5_000,
  });
  assert.ok(composed.length >= 1);
  assert.ok(composed.every((e) => e.source === "command" && e.kind === "command"));
  assert.ok(composed.every((e) => e.ts >= T - 5_000 && e.ts <= T + 5_000));
});

test("weekBoundsFromDate: Mon–Sun local, endMs is 23:59:59.999", () => {
  const b = weekBoundsFromDate(new Date(2024, 5, 12)); // Wednesday
  assert.equal(b.startDate.getDay(), 1); // Monday
  assert.equal(b.endDate.getDay(), 0);   // Sunday
  assert.equal(new Date(b.endMs).getHours(), 23);
  assert.equal(new Date(b.endMs).getMinutes(), 59);
});

test("shiftWeek moves seven days without silent day-shifts", () => {
  const b = weekBoundsFromDate(new Date(2024, 5, 12));
  const prev = shiftWeek(b, -1);
  const diffDays = Math.round((b.startMs - prev.startMs) / 86400000);
  assert.equal(diffDays, 7);
});

test("isoWeek handles year crossover (2023-12-31 = 2023-W52, 2024-01-01 = 2024-W01)", () => {
  assert.equal(isoWeek(new Date(2023, 11, 31)).label, "2023-W52");
  assert.equal(isoWeek(new Date(2024, 0, 1)).label, "2024-W01");
  // 2020-12-31 is a Thursday → ISO 2020-W53
  assert.equal(isoWeek(new Date(2020, 11, 31)).label, "2020-W53");
});

test("aggregateWeek scopes to week + project and omits missing sections truthfully", () => {
  const list = buildChronicleEntries(fx());
  const b = weekBoundsFromDate(T);
  const p1 = aggregateWeek({ entries: list, memory: fx().projectMemory, bounds: b, projectScope: "P1" });
  assert.ok(p1.completedCommands.some((e) => e.id === "cmd:c1"));
  assert.ok(!p1.completedCommands.some((e) => e.id === "cmd:c3"));
  assert.equal(p1.decisions.length, 1);
  assert.equal(p1.blockers.length, 1);
  assert.equal(p1.milestones.length, 0);
});

test("buildWeeklyDraft never fabricates; missing sections render 'No recorded items'", () => {
  const b = weekBoundsFromDate(new Date(2024, 5, 12));
  const draft = buildWeeklyDraft({ project: { id: "P1", name: "Raven" }, projectScope: "P1", entries: [], memory: [], bounds: b });
  assert.ok(draft.meta.requiresExplicitSave === true);
  assert.ok(draft.text.includes("No recorded items"));
  assert.ok(draft.text.includes("No activity recorded"));
  assert.equal(draft.evidence.length, 0);
});

test("buildWeeklyDraft evidence lists exact ids/timestamps/types/projects", () => {
  const list = buildChronicleEntries(fx());
  const b = weekBoundsFromDate(T);
  const d = buildWeeklyDraft({ project: { id: "P1", name: "Raven" }, projectScope: "P1", entries: list, memory: fx().projectMemory, bounds: b });
  const ids = new Set(d.evidence.map((e) => `${e.kind}:${e.id}`));
  assert.ok(ids.has("command:c1"));
  assert.ok(ids.has("workflow:r1"));
  assert.ok(ids.has("memory:m1"));
  assert.ok(!ids.has("command:c3"), "unassigned command not attributed to P1");
  assert.ok(d.evidence.every((e) => Number.isFinite(e.ts)));
});

test("duplicate-save guard: findExistingWeeklySummary matches on projectId + weekLabel tag", () => {
  const b = weekBoundsFromDate(T);
  const draft = buildWeeklyDraft({ project: { id: "P1", name: "Raven" }, projectScope: "P1", entries: [], memory: [], bounds: b });
  const saved = buildSaveableWeeklySummary(draft);
  const memList = [{ ...saved, id: "mSaved", updatedAt: T, createdAt: T }];
  const found = findExistingWeeklySummary(memList, "P1", draft.meta.weekLabel);
  assert.ok(found);
  const notFound = findExistingWeeklySummary(memList, "P2", draft.meta.weekLabel);
  assert.equal(notFound, null);
});

test("buildSaveableWeeklySummary embeds evidence ids and versionSuffix", () => {
  const b = weekBoundsFromDate(T);
  const d = buildWeeklyDraft({ project: { id: "P1", name: "Raven" }, projectScope: "P1", entries: buildChronicleEntries(fx()), memory: fx().projectMemory, bounds: b });
  const rec = buildSaveableWeeklySummary(d, { versionSuffix: "v2" });
  assert.ok(rec.title.endsWith("(v2)"));
  assert.ok(rec.tags.includes("weekly-summary"));
  assert.ok(rec.tags.includes(d.meta.weekLabel));
  assert.ok(rec.content.includes("command:c1"));
  assert.equal(rec.projectId, "P1");
});

test("export helpers include filter metadata and evidence", () => {
  const list = buildChronicleEntries(fx());
  const b = weekBoundsFromDate(T);
  const meta = buildExportMetadata({ filter: { q: "ship", kinds: ["command"], sources: ["command"] }, bounds: b, projectScope: "P1", projects: [{ id: "P1", name: "Raven" }] });
  const j = exportFilteredChronicleJson(list, meta);
  const parsed = JSON.parse(j);
  assert.equal(parsed.projectName, "Raven");
  assert.equal(parsed.filter.q, "ship");
  assert.ok(parsed.weekBounds.endMs > parsed.weekBounds.startMs);
  const md = exportFilteredChronicleMarkdown(list, meta);
  assert.ok(md.includes("- Project: Raven"));
  assert.ok(md.includes("- Search: `ship`"));
  const d = buildWeeklyDraft({ project: { id: "P1", name: "Raven" }, projectScope: "P1", entries: list, memory: fx().projectMemory, bounds: b });
  const dj = JSON.parse(exportWeeklyDraftJson(d));
  assert.equal(dj.kind, "raven-weekly-summary/v1");
  assert.ok(Array.isArray(dj.evidence) && dj.evidence.length > 0);
  const dmd = exportWeeklyDraftMarkdown(d);
  assert.ok(dmd.includes("### Evidence"));
});

test("weeklySummaryTitle stable format", () => {
  assert.equal(weeklySummaryTitle("Raven", "2024-W24"), "Weekly summary — Raven — 2024-W24");
});