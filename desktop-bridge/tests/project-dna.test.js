import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectOverview,
  computeProjectHealth,
  buildProjectTimeline,
  deriveRoadmap,
  deterministicProjectProfile,
  buildProjectBriefContext,
  buildContinueProjectPreview,
  NO_SILENT_SAVE,
} from "../../src/lib/rah/projectDna.js";

const now = 1_700_000_000_000;
const day = 24 * 3600 * 1000;

const project = {
  id: "p1", name: "RAH OS", icon: "🜛", description: "OS layer",
  goals: "Ship shell", status: "active", priority: "high", tags: ["os"],
  createdAt: now - 10 * day, updatedAt: now - day,
};

const memory = [
  { id: "m1", projectId: "p1", title: "Ship first slice", type: "next_action", tags: ["ship"], updatedAt: now - 2 * day, pinned: true },
  { id: "m2", projectId: "p1", title: "Auth flaky",       type: "blocker",     tags: ["auth"], updatedAt: now - day },
  { id: "m3", projectId: "p1", title: "Renderer switch",  type: "decision",    tags: ["ux"],   updatedAt: now - 3 * day },
  { id: "m4", projectId: "p1", title: "Beta shipped",     type: "milestone",   tags: [],       updatedAt: now - 4 * day },
  { id: "m5", projectId: "p1", title: "Icons wrong",      type: "note",        tags: [],       updatedAt: now - 5 * day, archived: true },
  { id: "mg", projectId: null, title: "Global note",      type: "note",        tags: [],       updatedAt: now - 2 * day },
];

const commands = [
  { id: "c1", projectId: "p1", createdAt: now - day + 1000, prompt: "Draft release notes", status: "done", resultSummary: "…" },
  { id: "c2", projectId: "p1", createdAt: now - 20 * day,   prompt: "Old idea",           status: "done" },
  { id: "cX", projectId: "px", createdAt: now,              prompt: "Other project",      status: "done" },
];

const approvals = [
  { id: "a1", commandId: "c1", createdAt: now - 200, title: "Approve draft", reason: "…", status: "approved" },
  { id: "a2", commandId: "cX", createdAt: now - 100, title: "Foreign",       reason: "…", status: "pending" },
];

const files = [
  { id: "f1", projectId: "p1", name: "spec.md", mime: "text/markdown", size: 1234 },
  { id: "f2", projectId: "px", name: "other.txt", mime: "text/plain",  size: 10 },
];

test("overview uses only real data (no fabricated percentages)", () => {
  const o = buildProjectOverview({ project, memory, commands, approvals, files, now });
  assert.equal(o.name, "RAH OS");
  assert.equal(o.memoryCount, 4); // m1..m4 live, project-scoped (m5 archived, mg global)
  assert.equal(o.linkedFileCount, 1);
  assert.equal(o.recentCommandCount, 1);
  assert.equal(o.pendingApprovalCount, 0); // foreign pending approval doesn't leak
  assert.equal(o.nextAction.id, "m1");
  assert.equal(o.currentBlocker.id, "m2");
  assert.equal(o.lastMilestone.id, "m4");
  assert.ok(!("percentComplete" in o), "must not invent percentages");
});

test("project health uses real deterministic checks", () => {
  const h = computeProjectHealth({
    project, memory, commands, files,
    bridgeSnapshot: { ui: "paired_online" }, engine: "lmstudio", now,
  });
  const map = Object.fromEntries(h.checks.map((c) => [c.id, c]));
  assert.equal(map.goal.ok, true);
  assert.equal(map.next_action.ok, true);
  assert.equal(map.blocker.ok, false); // blocker exists → not ok
  assert.equal(map.activity.ok, true);
  assert.equal(map.memory.ok, true);
  assert.equal(map.files.ok, true);
  assert.equal(map.engine.ok, true);
  assert.ok(h.score > 0 && h.score < 100);
});

test("project health: local engine unreachable when bridge offline", () => {
  const h = computeProjectHealth({
    project, memory, commands, files,
    bridgeSnapshot: { ui: "offline" }, engine: "lmstudio", now,
  });
  const eng = h.checks.find((c) => c.id === "engine");
  assert.equal(eng.ok, false);
});

test("timeline merges memory + commands + linked approvals, newest first", () => {
  const t = buildProjectTimeline({ project, memory, commands, approvals });
  assert.ok(t.length >= 6);
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].ts >= t[i].ts, "sorted desc");
  const kinds = new Set(t.map((r) => r.kind));
  assert.ok(kinds.has("memory") && kinds.has("command") && kinds.has("approval"));
  assert.ok(!t.some((r) => r.title === "Other project"), "must not include foreign commands");
  assert.ok(!t.some((r) => r.title === "Foreign"),       "must not include foreign approvals");
  assert.ok(!t.some((r) => r.title === "Icons wrong"),   "must not include archived memory");
  assert.ok(!t.some((r) => r.title === "Global note"),   "must not include global memory");
});

test("roadmap: real records only, guidance when a bucket is empty", () => {
  const r = deriveRoadmap({ memory, projectId: "p1" });
  assert.ok(r.now.some((i) => i.title.startsWith("Blocker:")));
  assert.ok(r.now.some((i) => i.title === "Ship first slice"));
  assert.equal(r.guidance.now, null);

  const empty = deriveRoadmap({ memory: [], projectId: "p1" });
  assert.deepEqual(empty.now, []);
  assert.ok(empty.guidance.now && empty.guidance.now.includes("next_action"));
  assert.ok(empty.guidance.next);
  assert.ok(empty.guidance.later);
});

test("deterministic profile does not use AI and is stable", () => {
  const a = deterministicProjectProfile({ project, memory, files, commands });
  const b = deterministicProjectProfile({ project, memory, files, commands });
  assert.deepEqual(a, b);
  assert.equal(a.aiEnhanced, false);
  assert.ok(a.topTags.includes("os"));
  assert.equal(a.stances.blockers, 1);
  assert.equal(a.linkedFiles, 1);
  assert.equal(a.commandCount, 2);
});

test("brief context and continue-preview both flag no-silent-save", () => {
  const brief = buildProjectBriefContext({ project, memory, files, commands });
  assert.equal(brief.requiresExplicitConfirmToSave, true);
  assert.equal(brief.memoryRecords[0].pinned, true, "pinned records ranked first");
  const cont = buildContinueProjectPreview({ project, memory, commands, files });
  assert.equal(cont.sentAutomatically, false);
  assert.equal(cont.blocker, "Auth flaky");
  assert.equal(cont.nextAction, "Ship first slice");
});

test("NO_SILENT_SAVE contract exposes required flags", () => {
  assert.equal(NO_SILENT_SAVE.briefRequiresExplicitSave, true);
  assert.equal(NO_SILENT_SAVE.aiEnhancementRequiresExplicitClick, true);
  assert.equal(NO_SILENT_SAVE.continueProjectDoesNotSendAutomatically, true);
  assert.throws(() => { NO_SILENT_SAVE.briefRequiresExplicitSave = false; }, /read only|Cannot assign/);
});
