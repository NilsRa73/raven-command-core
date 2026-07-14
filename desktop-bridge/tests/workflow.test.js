import test from "node:test";
import assert from "node:assert/strict";
import {
  STEP_CATALOG, EXECUTION_PROFILES,
  createWorkflow, createStep, createRun,
  validateWorkflow, planDryRun, selectRunContext,
  canTransition, transitionRun, availableControls,
  appendEvent, verifyEventChain,
  exportWorkflowJson, importWorkflowJson,
} from "../../src/lib/rah/workflow.js";

test("validateWorkflow rejects empty workflow", () => {
  const v = validateWorkflow(createWorkflow({ name: "", steps: [] }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /name/i.test(e)));
  assert.ok(v.errors.some((e) => /step/i.test(e)));
});

test("validateWorkflow accepts a well-formed workflow", () => {
  const wf = createWorkflow({
    name: "Refactor",
    executionProfile: "fast",
    steps: [createStep("ai_prompt", { prompt: "Summarize state" })],
  });
  const v = validateWorkflow(wf);
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("validateWorkflow enforces https for launch.url and per-type required fields", () => {
  const wf = createWorkflow({
    name: "Open",
    steps: [
      createStep("bridge_launch_url", { url: "http://example.com" }),
      createStep("bridge_read_file", { path: "" }),
    ],
  });
  const v = validateWorkflow(wf);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /https/i.test(e)));
  assert.ok(v.errors.some((e) => /path/i.test(e)));
});

test("EXECUTION_PROFILES and STEP_CATALOG are stable", () => {
  assert.deepEqual(EXECUTION_PROFILES, ["fast", "deep"]);
  assert.equal(STEP_CATALOG.bridge_write_file.requiresApproval, true);
  assert.equal(STEP_CATALOG.bridge_launch_app.risk, "high");
});

test("state machine transitions & controls", () => {
  assert.ok(canTransition("draft", "queued"));
  assert.ok(!canTransition("completed", "running"));
  const wf = createWorkflow({ name: "x", steps: [createStep("ai_prompt", { prompt: "hi" })] });
  const run = createRun(wf);
  const queued = transitionRun(run, "queued");
  const running = transitionRun(queued, "running");
  assert.equal(running.status, "running");
  assert.ok(running.startedAt);
  assert.deepEqual(availableControls("running"), ["pause", "cancel"]);
  assert.throws(() => transitionRun(running, "draft"));
});

test("planDryRun marks bridge steps blocked when bridge offline", () => {
  const wf = createWorkflow({
    name: "Bridge",
    steps: [
      createStep("ai_prompt", { prompt: "ok" }),
      createStep("bridge_read_file", { path: "C:/x.txt" }),
    ],
  });
  const plan = planDryRun(wf, { bridge: { status: "unpaired", capabilities: [] } });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.steps[0].blocked, false);
  assert.equal(plan.steps[1].blocked, true);
  assert.match(plan.steps[1].blockedReason, /Bridge offline/);
});

test("planDryRun respects paired-online capability list", () => {
  const wf = createWorkflow({ name: "B", steps: [createStep("bridge_write_file", { path: "C:/a.txt" })] });
  const okPlan = planDryRun(wf, { bridge: { status: "paired_online", capabilities: ["files.rename"] } });
  assert.equal(okPlan.steps[0].blocked, false);
  const missing = planDryRun(wf, { bridge: { status: "paired_online", capabilities: ["files.readText"] } });
  assert.equal(missing.steps[0].blocked, true);
});

test("selectRunContext fast keeps <=3 pinned; deep expands", () => {
  const wf = createWorkflow({ name: "N", projectId: "p1", executionProfile: "fast", steps: [createStep("ai_prompt", { prompt: "x" })] });
  const mem = [
    { id: "1", projectId: "p1", pinned: true,  archived: false, content: "a" },
    { id: "2", projectId: "p1", pinned: true,  archived: false, content: "b" },
    { id: "3", projectId: "p1", pinned: true,  archived: false, content: "c" },
    { id: "4", projectId: "p1", pinned: true,  archived: false, content: "d" },
    { id: "5", projectId: "p1", pinned: false, archived: false, content: "e" },
  ];
  const fast = selectRunContext(wf, { projects: [{ id: "p1", name: "P" }], projectMemory: mem });
  assert.equal(fast.profile, "fast");
  assert.equal(fast.memory.length, 3);
  const deep = selectRunContext({ ...wf, executionProfile: "deep" }, { projects: [{ id: "p1", name: "P" }], projectMemory: mem });
  assert.equal(deep.profile, "deep");
  assert.equal(deep.memory.length, 5);
  assert.equal(deep.includeFullDna, true);
});

test("appendEvent + verifyEventChain: chain intact and tamper-evident", async () => {
  let events = [];
  events = await appendEvent(events, { runId: "r1", workflowId: "w1", type: "run.created", nextState: "draft" });
  events = await appendEvent(events, { runId: "r1", workflowId: "w1", type: "run.queued", prevState: "draft", nextState: "queued" });
  events = await appendEvent(events, { runId: "r1", workflowId: "w1", type: "run.started", prevState: "queued", nextState: "running" });
  const v = await verifyEventChain(events);
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  // Tamper: change type of middle event
  const tampered = events.map((e, i) => (i === 1 ? { ...e, type: "run.hacked" } : e));
  const t = await verifyEventChain(tampered);
  assert.equal(t.ok, false);
  assert.ok(t.problems.some((p) => /hash/i.test(p.error)));
});

test("import/export roundtrip preserves steps", () => {
  const wf = createWorkflow({ name: "Round", steps: [createStep("ai_prompt", { prompt: "hi" })] });
  const json = exportWorkflowJson(wf);
  const back = importWorkflowJson(json);
  assert.equal(back.name, "Round");
  assert.equal(back.steps.length, 1);
  assert.equal(back.steps[0].type, "ai_prompt");
});

test("importWorkflowJson rejects invalid payloads", () => {
  assert.throws(() => importWorkflowJson(JSON.stringify({})));
  assert.throws(() => importWorkflowJson(JSON.stringify({ ravenWorkflow: 1, workflow: { name: "", steps: [] } })));
});
