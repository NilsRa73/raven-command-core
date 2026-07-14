// Follow-up hardening: honest Copy File semantics (source + dest required)
// and Fast Mode retaining a bounded amount of recent Supporting memory.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkflow, createStep, validateWorkflow, planDryRun, STEP_CATALOG,
} from "../../src/lib/rah/workflow.js";
import { runWorkflow, resumeAfterApproval, _internals } from "../../src/lib/rah/workflowExecutor.js";
import { buildContextPacket, selectContextForMode } from "../../src/lib/rah/ravenMode.js";

test("Copy File step: label is 'Copy File (Bridge)' and capability is files.copy", () => {
  assert.equal(STEP_CATALOG.bridge_write_file.label, "Copy File (Bridge)");
  assert.equal(STEP_CATALOG.bridge_write_file.requiresBridgeCapability, "files.copy");
});

test("validateWorkflow rejects Copy File missing source or with same-path source/dest", () => {
  const missingSrc = createWorkflow({
    name: "x", steps: [createStep("bridge_write_file", { dest: "C:/b.txt" })],
  });
  const v1 = validateWorkflow(missingSrc);
  assert.equal(v1.ok, false);
  assert.ok(v1.errors.some((e) => /source path required/i.test(e)));

  const same = createWorkflow({
    name: "y", steps: [createStep("bridge_write_file", { source: "C:/a", dest: "C:/a" })],
  });
  const v2 = validateWorkflow(same);
  assert.equal(v2.ok, false);
  assert.ok(v2.errors.some((e) => /must differ/i.test(e)));

  const good = createWorkflow({
    name: "z", steps: [createStep("bridge_write_file", { source: "C:/a", dest: "C:/b" })],
  });
  assert.equal(validateWorkflow(good).ok, true);
});

test("planDryRun preview shows source -> dest and highlights missing source", () => {
  const wf = createWorkflow({
    name: "p", steps: [createStep("bridge_write_file", { dest: "C:/b.txt" })],
  });
  const plan = planDryRun(wf, { bridge: { status: "paired_online", capabilities: ["files.copy"] } });
  assert.match(plan.steps[0].preview, /source missing/);
  assert.match(plan.steps[0].preview, /C:\/b\.txt/);
});

test("executor refuses Copy File with identical source and destination", async () => {
  const wf = createWorkflow({
    name: "e",
    steps: [createStep("bridge_write_file", { source: "C:/a", dest: "C:/a" })],
  });
  const runs = new Map();
  const workflows = new Map([[wf.id, wf]]);
  const run = {
    runId: "r1", workflowId: wf.id, status: "queued", currentStepIndex: 0,
    stepResults: [], events: [], stepApprovals: {}, dryRun: false,
    createdAt: 0,
  };
  runs.set(run.runId, run);
  const deps = {
    loadRun: async (id) => runs.get(id),
    saveRun: async (r) => { runs.set(r.runId, structuredClone(r)); },
    loadWorkflow: async (id) => workflows.get(id),
    requestApproval: async ({ step }) => ({
      id: "ap_" + step.id, status: "approved", createdAt: 0, title: "t",
    }),
    loadApproval: async () => ({ id: "ap", status: "approved" }),
    ai: async () => ({ text: "" }),
    memory: { save: async () => {} },
    chronicle: { log: async () => {} },
    bridge: {
      status: async () => ({ status: "paired_online", capabilities: ["files.copy"] }),
      readFile: async () => ({ text: "" }),
      copyFile: async () => ({ ok: true }),
      writeFile: async () => ({ ok: true }),
      launchUrl: async () => ({ ok: true }),
      launchApp: async () => ({ ok: true }),
    },
    now: () => 1, rng: () => "aaaa",
  };
  await runWorkflow(run.runId, deps);
  let cur = runs.get(run.runId);
  if (cur.status === "awaiting_approval") {
    const approvalId = Object.values(cur.stepApprovals)[0];
    await resumeAfterApproval(run.runId, approvalId, deps);
    cur = runs.get(run.runId);
  }
  const finished = cur;
  assert.equal(finished.status, "failed");
  assert.match(String(finished.failureReason || ""), /source and destination must differ/i);
});

test("Fast Mode includes a bounded number of recent Supporting memories", () => {
  const now = Date.now();
  const day = 86_400_000;
  const memory = [
    { id: "c1", pinned: true,          type: "note",        content: "Critical rule",       updatedAt: now, archived: false, projectId: null },
    { id: "a1", pinned: false,         type: "blocker",     content: "Active task",         updatedAt: now, archived: false, projectId: null },
    { id: "s1", pinned: false,         type: "note",        content: "Recent decision A",   updatedAt: now, tags: ["decision"], archived: false, projectId: null },
    { id: "s2", pinned: false,         type: "note",        content: "Recent decision B",   updatedAt: now - day, tags: ["decision"], archived: false, projectId: null },
    { id: "s3", pinned: false,         type: "note",        content: "Old note",            updatedAt: now - 400 * day, archived: false, projectId: null },
  ];
  const fast = selectContextForMode(memory, { mode: "fast", now, query: "decision" });
  const ids = fast.map((r) => r.rec.id);
  assert.ok(ids.includes("c1"), "critical present");
  assert.ok(ids.includes("a1"), "active present");
  const supportingIds = ids.filter((id) => id.startsWith("s"));
  assert.ok(supportingIds.length >= 1 && supportingIds.length <= 2,
    `expected 1-2 supporting in Fast, got ${supportingIds.length}`);

  const deep = selectContextForMode(memory, { mode: "deep", now, query: "decision" });
  const deepSupporting = deep.map((r) => r.rec.id).filter((id) => id.startsWith("s")).length;
  assert.ok(deepSupporting >= supportingIds.length, "deep >= fast supporting");
});

test("buildContextPacket header describes fast composition honestly", () => {
  const memory = [
    { id: "c1", pinned: true, type: "note", content: "x", updatedAt: Date.now(), archived: false, projectId: null },
  ];
  const pkt = buildContextPacket(memory, { mode: "fast" });
  const blob = typeof pkt === "string" ? pkt : (pkt?.text ?? JSON.stringify(pkt));
  assert.match(blob, /critical \+ active \+ up to \d+ recent supporting/i);
});

test("assertBridgeCapability denies empty capability list", () => {
  assert.throws(
    () => _internals.assertBridgeCapability({ status: "paired_online", capabilities: [] }, "files.copy"),
    /missing capability|denied by default|unknown/i,
  );
});
