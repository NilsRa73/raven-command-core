import test from "node:test";
import assert from "node:assert/strict";
import { planDryRun, createWorkflow, createStep } from "../../src/lib/rah/workflow.js";
import { runWorkflow, retryRun } from "../../src/lib/rah/workflowExecutor.js";

// ---- 1. planDryRun deny-by-default on empty capabilities -----------------
test("planDryRun blocks bridge steps when capabilities are unknown/empty", () => {
  const wf = createWorkflow({
    name: "x", steps: [createStep("bridge_launch_url", { url: "https://example.com" })],
  });
  // Bridge online but no capabilities reported → must be blocked.
  const plan1 = planDryRun(wf, { bridge: { status: "paired_online", capabilities: [] } });
  assert.equal(plan1.steps[0].blocked, true);
  assert.match(plan1.steps[0].blockedReason, /denied by default|unknown/);

  // Missing key entirely → also blocked.
  const plan2 = planDryRun(wf, { bridge: { status: "paired_online" } });
  assert.equal(plan2.steps[0].blocked, true);

  // Explicit capability granted → not blocked.
  const plan3 = planDryRun(wf, { bridge: { status: "paired_online", capabilities: ["launch.url"] } });
  assert.equal(plan3.steps[0].blocked, false);
});

// ---- 2. retryRun resets the failed step's stepResult ---------------------
function baseDeps() {
  const runs = new Map(), wfs = new Map();
  let fail = true;
  return {
    _runs: runs, _wfs: wfs, setFail(v) { fail = v; },
    loadRun: async (id) => structuredClone(runs.get(id) ?? null),
    saveRun: async (r) => runs.set(r.runId, structuredClone(r)),
    loadWorkflow: async (id) => structuredClone(wfs.get(id) ?? null),
    loadApproval: async () => null,
    requestApproval: async () => ({ id: "a1", status: "pending" }),
    ai: async ({ prompt }) => {
      if (fail) throw new Error("boom");
      return { text: "ok:" + prompt, provider: "P", model: "M", transport: "t", latencyMs: 1 };
    },
    memory: { save: async () => {} }, chronicle: { log: async () => {} },
    bridge: { status: async () => ({ status: "unknown", capabilities: [] }),
      readFile: async () => ({ text: "" }), writeFile: async () => ({ ok: true }),
      launchUrl: async () => ({ ok: true }), launchApp: async () => ({ ok: true }) },
    now: () => 1, rng: () => "r",
  };
}

test("retryRun clears the failed step result so it can re-run", async () => {
  const deps = baseDeps();
  const wf = createWorkflow({ name: "w", steps: [createStep("ai_prompt", { prompt: "hi" })] });
  deps._wfs.set(wf.id, wf);
  const run = { runId: "run1", workflowId: wf.id, status: "queued", currentStepIndex: 0,
    events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, updatedAt: 1, dryRun: false };
  deps._runs.set(run.runId, run);

  await runWorkflow(run.runId, deps);
  let stored = deps._runs.get("run1");
  assert.equal(stored.status, "failed");
  assert.equal(stored.stepResults[0].status, "failed");

  // Now retry — should reset the failed step, then complete on second attempt.
  deps.setFail(false);
  await retryRun("run1", deps);
  stored = deps._runs.get("run1");
  assert.equal(stored.status, "completed", "retry should complete when underlying failure is gone");
  assert.equal(stored.stepResults[0].status, "ok");
  assert.equal(stored.failureReason ?? null, null);
});

// ---- 3. buildContextExtra can return {text, meta} and is logged ----------
test("executor accepts {text,meta} from buildContextExtra and logs packet meta", async () => {
  const deps = baseDeps();
  deps.buildContextExtra = () => ({
    text: "CTX-BLOCK",
    meta: { mode: "deep", selectedCount: 3, selectedIds: ["a", "b", "c"], approxTokens: 42 },
  });
  deps.setFail(false);
  const wf = createWorkflow({ name: "w", steps: [createStep("ai_prompt", { prompt: "hi" })] });
  deps._wfs.set(wf.id, wf);
  const run = { runId: "run2", workflowId: wf.id, status: "queued", currentStepIndex: 0,
    events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, updatedAt: 1, dryRun: false };
  deps._runs.set(run.runId, run);

  let seenExtra = null;
  const origAi = deps.ai;
  deps.ai = async (args) => { seenExtra = args.systemExtra; return origAi(args); };

  await runWorkflow(run.runId, deps);
  assert.equal(seenExtra, "CTX-BLOCK");
  const stored = deps._runs.get("run2");
  const completed = stored.events.find((e) => e.type === "step.completed");
  assert.ok(completed?.metadata?.packet, "packet meta should be logged on step.completed");
  assert.equal(completed.metadata.packet.selectedCount, 3);
  assert.equal(completed.metadata.packet.mode, "deep");
});
