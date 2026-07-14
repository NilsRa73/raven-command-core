import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkflow, createStep, planDryRun,
} from "../../src/lib/rah/workflow.js";
import { buildContextPacket, deterministicHash } from "../../src/lib/rah/ravenMode.js";
import { runWorkflow, retryRun, cancelRun } from "../../src/lib/rah/workflowExecutor.js";

// -- planDryRun fail-closed edge cases --------------------------------------
test("planDryRun fails closed on missing/unknown/empty caps and permits only explicit ones", () => {
  const wf = createWorkflow({ name: "x", steps: [
    createStep("bridge_read_file", { path: "C:/a.txt" }),
  ]});
  // missing ctx.bridge entirely
  const p0 = planDryRun(wf);
  assert.equal(p0.steps[0].blocked, true);

  // unknown status
  const p1 = planDryRun(wf, { bridge: { status: "unknown", capabilities: [] } });
  assert.equal(p1.steps[0].blocked, true);

  // paired but empty
  const p2 = planDryRun(wf, { bridge: { status: "paired_online", capabilities: [] } });
  assert.equal(p2.steps[0].blocked, true);
  assert.match(p2.steps[0].blockedReason, /denied by default/);

  // paired with wrong cap
  const p3 = planDryRun(wf, { bridge: { status: "paired_online", capabilities: ["launch.url"] } });
  assert.equal(p3.steps[0].blocked, true);
  assert.match(p3.steps[0].blockedReason, /missing capability/);

  // paired with matching cap only
  const p4 = planDryRun(wf, { bridge: { status: "paired_online", capabilities: ["files.readText"] } });
  assert.equal(p4.steps[0].blocked, false);
});

// -- deterministic packet parity -------------------------------------------
test("buildContextPacket returns stable parityId/packetHash and matches input", () => {
  const list = [
    { id: "m1", projectId: "p", title: "T1", content: "hello", pinned: true, archived: false, updatedAt: 1 },
    { id: "m2", projectId: "p", title: "T2", content: "world", pinned: false, archived: false, updatedAt: 2, type: "blocker" },
  ];
  const a = buildContextPacket(list, { mode: "fast", projectId: "p", now: 111 });
  const b = buildContextPacket(list, { mode: "fast", projectId: "p", now: 999 });
  assert.equal(a.packetHash, b.packetHash);
  assert.equal(a.parityId, b.parityId);
  assert.deepEqual(a.selectedIds, ["m1", "m2"]);
  assert.equal(deterministicHash("abc"), deterministicHash("abc"));
  assert.notEqual(deterministicHash("abc"), deterministicHash("abd"));
});

// -- retry preserves prior successful step results -------------------------
function depsFactory(behavior) {
  const runs = new Map(), wfs = new Map();
  return {
    _runs: runs, _wfs: wfs,
    loadRun: async (id) => structuredClone(runs.get(id) ?? null),
    saveRun: async (r) => runs.set(r.runId, structuredClone(r)),
    loadWorkflow: async (id) => structuredClone(wfs.get(id) ?? null),
    loadApproval: async () => null,
    requestApproval: async () => ({ id: "a1", status: "pending" }),
    ai: behavior.ai,
    memory: { save: async () => {} }, chronicle: { log: async () => {} },
    bridge: { status: async () => ({ status: "unknown", capabilities: [] }),
      readFile: async () => ({ text: "" }), writeFile: async () => ({ ok: true }),
      launchUrl: async () => ({ ok: true }), launchApp: async () => ({ ok: true }) },
    now: () => 1, rng: () => "r",
  };
}

test("retry resets only the failed step; prior successful results preserved", async () => {
  let attempts = 0;
  const deps = depsFactory({
    ai: async ({ prompt }) => {
      attempts++;
      if (prompt === "second" && attempts < 3) throw new Error("boom");
      return { text: "ok:" + prompt, provider: "P", model: "M", transport: "t", latencyMs: 1 };
    },
  });
  const wf = createWorkflow({ name: "w", steps: [
    createStep("ai_prompt", { prompt: "first" }),
    createStep("ai_prompt", { prompt: "second" }),
  ]});
  deps._wfs.set(wf.id, wf);
  const run = { runId: "r", workflowId: wf.id, status: "queued", currentStepIndex: 0,
    events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, updatedAt: 1, dryRun: false };
  deps._runs.set(run.runId, run);

  await runWorkflow(run.runId, deps);
  let s = deps._runs.get("r");
  assert.equal(s.status, "failed");
  assert.equal(s.stepResults[0].status, "ok");
  assert.equal(s.stepResults[0].output, "ok:first");
  assert.equal(s.stepResults[1].status, "failed");

  await retryRun("r", deps);
  s = deps._runs.get("r");
  assert.equal(s.status, "completed");
  // First step's original output preserved
  assert.equal(s.stepResults[0].output, "ok:first");
  assert.equal(s.stepResults[1].status, "ok");
  assert.equal(s.failureReason ?? null, null);
});

// -- cancel writes exactly one terminal cancellation event ------------------
test("cancelRun writes exactly one terminal run.cancelled event with reason", async () => {
  const deps = depsFactory({ ai: async () => ({ text: "ok" }) });
  const wf = createWorkflow({ name: "w", steps: [createStep("ai_prompt", { prompt: "x" })] });
  deps._wfs.set(wf.id, wf);
  const run = { runId: "r2", workflowId: wf.id, status: "queued", currentStepIndex: 0,
    events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, updatedAt: 1, dryRun: false };
  deps._runs.set(run.runId, run);
  await cancelRun("r2", deps, { reason: "emergency_stop" });
  // Cancelling again must be a no-op (terminal).
  await cancelRun("r2", deps, { reason: "emergency_stop" });
  const s = deps._runs.get("r2");
  assert.equal(s.status, "cancelled");
  assert.equal(s.failureReason, "emergency_stop");
  const cancels = s.events.filter((e) => e.type === "run.cancelled");
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].metadata.reason, "emergency_stop");
});

// -- {text,meta} packet flows to ai() and matches metadata ------------------
test("executor passes exact packet text to ai() and logs matching parity meta", async () => {
  const deps = depsFactory({ ai: async () => ({ text: "ok", provider: "P", model: "M", transport: "t", latencyMs: 1 }) });
  const wf = createWorkflow({ name: "w", steps: [createStep("ai_prompt", { prompt: "hi" })] });
  deps._wfs.set(wf.id, wf);
  const run = { runId: "r3", workflowId: wf.id, status: "queued", currentStepIndex: 0,
    events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, dryRun: false };
  deps._runs.set(run.runId, run);

  const meta = { mode: "fast", selectedCount: 1, selectedIds: ["x"], approxTokens: 5,
    packetHash: "deadbeef", parityId: "pkt_fast_1_deadbeef" };
  deps.buildContextExtra = () => ({ text: "PACKET-BODY", meta });

  let seenExtra = "";
  const orig = deps.ai;
  deps.ai = async (args) => { seenExtra = args.systemExtra; return orig(args); };
  await runWorkflow("r3", deps);

  assert.equal(seenExtra, "PACKET-BODY");
  const s = deps._runs.get("r3");
  const done = s.events.find((e) => e.type === "step.completed");
  assert.equal(done.metadata.packet.parityId, meta.parityId);
  assert.equal(done.metadata.packet.packetHash, meta.packetHash);
});
