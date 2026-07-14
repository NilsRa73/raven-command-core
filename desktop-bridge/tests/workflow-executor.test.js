// Tests for the workflow executor. Uses in-memory fakes for every dep
// so the executor runs against real state machine + hash-chained event
// log logic without touching IndexedDB or the browser.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkflow, createStep, createRun,
  STEP_CATALOG,
} from "../../src/lib/rah/workflow.js";
import {
  runWorkflow, resumeAfterApproval, cancelRun, pauseRun,
  resumePausedRun,
  _internals,
} from "../../src/lib/rah/workflowExecutor.js";

function makeDeps(overrides = {}) {
  const runs = new Map();
  const workflows = new Map();
  const approvals = new Map();
  const memoryStore = [];
  const chronicleStore = [];
  const bridgeCalls = [];
  const aiCalls = [];
  let uidCounter = 1;
  const deps = {
    loadRun: async (id) => structuredClone(runs.get(id) ?? null),
    saveRun: async (r) => { runs.set(r.runId, structuredClone(r)); },
    loadWorkflow: async (id) => structuredClone(workflows.get(id) ?? null),
    loadApproval: async (id) => structuredClone(approvals.get(id) ?? null),
    requestApproval: async ({ step }) => {
      const a = { id: "ap_" + uidCounter++, status: "pending", createdAt: 0, title: "step " + step.id };
      approvals.set(a.id, a);
      return a;
    },
    ai: async ({ prompt, signal }) => {
      aiCalls.push({ prompt });
      if (signal?.aborted) throw new Error("aborted");
      return { text: "ai:" + prompt, provider: "TestProvider", model: "test-model", transport: "test", latencyMs: 1 };
    },
    memory: { save: async (m) => { memoryStore.push(m); } },
    chronicle: { log: async (c) => { chronicleStore.push(c); } },
    bridge: {
      status: async () => ({ status: "paired_online", capabilities: ["files.readText","files.copy","launch.url","launch.program"] }),
      readFile: async (p) => { bridgeCalls.push(["read", p]); return { text: "hello" }; },
      writeFile: async (p) => { bridgeCalls.push(["write", p]); return { ok: true }; },
      launchUrl: async (u) => { bridgeCalls.push(["url", u]); return { ok: true }; },
      launchApp: async (p) => { bridgeCalls.push(["app", p]); return { ok: true }; },
    },
    now: () => 1000,
    rng: () => "aaaa",
    ...overrides,
  };
  return { deps, runs, workflows, approvals, memoryStore, chronicleStore, bridgeCalls, aiCalls };
}

test("executor runs a simple AI-only workflow to completion", async () => {
  const wf = createWorkflow({
    name: "hi", steps: [createStep("ai_prompt", { prompt: "Say hi" })],
  });
  const { deps, runs, workflows, aiCalls } = makeDeps();
  workflows.set(wf.id, wf);
  const run = createRun(wf);
  run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  const finished = runs.get(run.runId);
  assert.equal(finished.status, "completed");
  assert.equal(aiCalls.length, 1);
  assert.equal(finished.provider, "TestProvider");
  assert.equal(finished.stepResults.length, 1);
  assert.equal(finished.stepResults[0].status, "ok");
});

test("side-effect step requests approval, pauses; approval resumes exactly once", async () => {
  const wf = createWorkflow({
    name: "mem",
    steps: [
      createStep("ai_prompt", { prompt: "seed" }),
      createStep("save_memory", { title: "note" }),
    ],
  });
  const { deps, runs, workflows, approvals, memoryStore } = makeDeps();
  workflows.set(wf.id, wf);
  const run = createRun(wf);
  run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  let cur = runs.get(run.runId);
  assert.equal(cur.status, "awaiting_approval");
  assert.equal(memoryStore.length, 0);
  const approvalId = Object.values(cur.stepApprovals)[0];
  approvals.get(approvalId).status = "approved";
  await resumeAfterApproval(run.runId, approvalId, deps);
  cur = runs.get(run.runId);
  assert.equal(cur.status, "completed");
  assert.equal(memoryStore.length, 1);
  // Second resume must be a no-op (exactly-once).
  await resumeAfterApproval(run.runId, approvalId, deps);
  assert.equal(memoryStore.length, 1);
});

test("approval rejection fails the run without executing side effects", async () => {
  const wf = createWorkflow({
    name: "reject", steps: [createStep("save_memory", { title: "x" })],
  });
  const { deps, runs, workflows, approvals, memoryStore } = makeDeps();
  workflows.set(wf.id, wf);
  const run = createRun(wf);
  run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  const approvalId = Object.values(runs.get(run.runId).stepApprovals)[0];
  approvals.get(approvalId).status = "rejected";
  await resumeAfterApproval(run.runId, approvalId, deps);
  const cur = runs.get(run.runId);
  assert.equal(cur.status, "failed");
  assert.equal(memoryStore.length, 0);
});

test("manual checkpoint pauses; cancel prevents remaining steps", async () => {
  const wf = createWorkflow({
    name: "chk",
    steps: [createStep("wait_manual", { note: "hi" }), createStep("ai_prompt", { prompt: "x" })],
  });
  const { deps, runs, workflows, aiCalls } = makeDeps();
  workflows.set(wf.id, wf);
  const run = createRun(wf);
  run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  assert.equal(runs.get(run.runId).status, "paused");
  await cancelRun(run.runId, deps);
  assert.equal(runs.get(run.runId).status, "cancelled");
  assert.equal(aiCalls.length, 0);
});

test("dry run: no bridge / memory / AI side effects, all steps skipped", async () => {
  const wf = createWorkflow({
    name: "d",
    steps: [
      createStep("ai_prompt", { prompt: "x" }),
      createStep("save_memory", { title: "y" }),
      createStep("bridge_read_file", { path: "C:/x.txt" }),
    ],
  });
  const { deps, runs, workflows, aiCalls, memoryStore, bridgeCalls } = makeDeps();
  workflows.set(wf.id, wf);
  const run = createRun(wf, { dryRun: true });
  run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  assert.equal(runs.get(run.runId).status, "completed");
  assert.equal(aiCalls.length, 0);
  assert.equal(memoryStore.length, 0);
  assert.equal(bridgeCalls.length, 0);
});

test("bridge write uses files.copy capability (not files.rename)", () => {
  assert.equal(STEP_CATALOG.bridge_write_file.requiresBridgeCapability, "files.copy");
});

test("assertBridgeCapability throws when bridge offline", () => {
  assert.throws(() => _internals.assertBridgeCapability({ status: "offline" }, "files.readText"), /offline/);
  assert.throws(() => _internals.assertBridgeCapability({ status: "paired_online", capabilities: ["files.readText"] }, "launch.url"), /missing capability/);
});

test("pause during running is honored; AI abort transitions to cancelled on cancel", async () => {
  const wf = createWorkflow({ name: "p", steps: [createStep("ai_prompt", { prompt: "long" })] });
  const { deps, runs, workflows } = makeDeps({
    ai: async ({ signal }) => {
      // Wait until aborted.
      await new Promise((res, rej) => {
        signal.addEventListener("abort", () => rej(new Error("aborted")));
      });
      return { text: "" };
    },
  });
  workflows.set(wf.id, wf);
  const run = createRun(wf); run.status = "queued";
  runs.set(run.runId, run);
  const p = runWorkflow(run.runId, deps);
  await new Promise((r) => setTimeout(r, 10));
  await cancelRun(run.runId, deps);
  await p;
  assert.equal(runs.get(run.runId).status, "cancelled");
});

test("empty bridge capability list denies by default", () => {
  assert.throws(
    () => _internals.assertBridgeCapability({ status: "paired_online", capabilities: [] }, "files.readText"),
    /denied by default/,
  );
  assert.throws(
    () => _internals.assertBridgeCapability({ status: "paired_online" }, "files.readText"),
    /denied by default/,
  );
});

test("pause during running lands in paused, not cancelled", async () => {
  const wf = createWorkflow({ name: "p", steps: [createStep("ai_prompt", { prompt: "long" }), createStep("ai_prompt", { prompt: "next" })] });
  const aiSeen = [];
  const { deps, runs, workflows } = makeDeps({
    ai: async ({ prompt, signal }) => {
      aiSeen.push(prompt);
      if (prompt === "long") {
        await new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
      }
      return { text: "ok", provider: "T", model: "m", transport: "t", latencyMs: 1 };
    },
  });
  workflows.set(wf.id, wf);
  const run = createRun(wf); run.status = "queued";
  runs.set(run.runId, run);
  const p = runWorkflow(run.runId, deps);
  await new Promise((r) => setTimeout(r, 5));
  await pauseRun(run.runId, deps);
  await p;
  assert.equal(runs.get(run.runId).status, "paused");
  assert.equal(aiSeen.length, 1);
});

test("manual checkpoint resume advances past the checkpoint", async () => {
  const wf = createWorkflow({
    name: "resume",
    steps: [createStep("wait_manual", { note: "hi" }), createStep("ai_prompt", { prompt: "after" })],
  });
  const { deps, runs, workflows, aiCalls } = makeDeps();
  workflows.set(wf.id, wf);
  const run = createRun(wf); run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  assert.equal(runs.get(run.runId).status, "paused");
  assert.equal(runs.get(run.runId).currentStepIndex, 1);
  await resumePausedRun(run.runId, deps);
  assert.equal(runs.get(run.runId).status, "completed");
  assert.equal(aiCalls.length, 1);
});

test("cancel while awaiting_approval prevents remaining steps", async () => {
  const wf = createWorkflow({
    name: "cancel-await",
    steps: [createStep("save_memory", { title: "x" }), createStep("ai_prompt", { prompt: "y" })],
  });
  const { deps, runs, workflows, memoryStore, aiCalls, approvals } = makeDeps();
  workflows.set(wf.id, wf);
  const run = createRun(wf); run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  const cur = runs.get(run.runId);
  assert.equal(cur.status, "awaiting_approval");
  await cancelRun(run.runId, deps);
  // If the approval is then approved out-of-band, resume must be a no-op.
  const approvalId = Object.values(cur.stepApprovals)[0];
  approvals.get(approvalId).status = "approved";
  await resumeAfterApproval(run.runId, approvalId, deps);
  assert.equal(runs.get(run.runId).status, "cancelled");
  assert.equal(memoryStore.length, 0);
  assert.equal(aiCalls.length, 0);
});

test("buildContextExtra output is passed as systemExtra to ai()", async () => {
  const wf = createWorkflow({ name: "ctx", steps: [createStep("ai_prompt", { prompt: "go" })] });
  const seen = [];
  const { deps, runs, workflows } = makeDeps({
    ai: async ({ systemExtra, prompt }) => {
      seen.push({ systemExtra, prompt });
      return { text: "ok", provider: "T", model: "m", transport: "t", latencyMs: 1 };
    },
    buildContextExtra: (w) => `CTX(${w.id}:${w.executionProfile})`,
  });
  workflows.set(wf.id, wf);
  const run = createRun(wf); run.status = "queued";
  runs.set(run.runId, run);
  await runWorkflow(run.runId, deps);
  assert.equal(seen.length, 1);
  assert.match(seen[0].systemExtra, /^CTX\(/);
});