import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COUNCIL_ROLES, JOB_STATUSES, TRANSITIONS,
  canTransition, assertTransition,
  createJob, projectReviewSteps,
  transitionJob, transitionStep,
  synthesizeProjectReview, deriveCouncilQueue, seedCouncilJobsIfEmpty,
} from "../../src/lib/rah/councilJobs.js";

test("6 canonical council roles", () => {
  assert.equal(COUNCIL_ROLES.length, 6);
  assert.deepEqual(new Set(COUNCIL_ROLES), new Set([
    "orchestrator", "researcher", "designer", "builder", "tester", "memory_governance",
  ]));
});

test("9 canonical job statuses", () => {
  assert.equal(JOB_STATUSES.length, 9);
});

test("completed and cancelled are terminal (no outgoing transitions)", () => {
  assert.deepEqual(TRANSITIONS.completed, []);
  assert.deepEqual(TRANSITIONS.cancelled, []);
});

test("canTransition: legal transitions accepted", () => {
  assert.ok(canTransition("draft", "queued"));
  assert.ok(canTransition("queued", "running"));
  assert.ok(canTransition("running", "awaiting_approval"));
  assert.ok(canTransition("awaiting_approval", "running"));
  assert.ok(canTransition("failed", "queued"));       // retry
  assert.ok(canTransition("blocked", "running"));     // resume
});

test("canTransition: illegal transitions rejected", () => {
  assert.equal(canTransition("draft", "running"), false);
  assert.equal(canTransition("completed", "running"), false);
  assert.equal(canTransition("cancelled", "queued"), false);
  assert.equal(canTransition("running", "draft"), false);
});

test("assertTransition throws on illegal move", () => {
  assert.throws(() => assertTransition("completed", "running"), /Illegal council transition/);
});

test("createJob(project_review) yields 6 ordered steps for the six roles", () => {
  const { job, steps } = createJob({ objective: "Test review" });
  assert.equal(job.status, "draft");
  assert.equal(steps.length, 6);
  assert.deepEqual(steps.map((s) => s.order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(steps.map((s) => s.role), [
    "orchestrator", "researcher", "designer", "builder", "tester", "memory_governance",
  ]);
  // Governance step is the only one requiring approval by default.
  const gov = steps.find((s) => s.role === "memory_governance");
  assert.ok(gov.requiresApproval, "governance step must require approval");
  assert.equal(steps.filter((s) => s.requiresApproval).length, 1);
});

test("projectReviewSteps builds a linear dependency chain", () => {
  const steps = projectReviewSteps("job1");
  for (let i = 1; i < steps.length; i++) {
    assert.deepEqual(steps[i].dependencies, [steps[i - 1].id]);
  }
});

test("transitionJob preserves id/createdAt and bumps updatedAt", async () => {
  const { job } = createJob({});
  await new Promise((r) => setTimeout(r, 2));
  const next = transitionJob(job, "queued", { reason: "go" });
  assert.equal(next.id, job.id);
  assert.equal(next.createdAt, job.createdAt);
  assert.equal(next.status, "queued");
  assert.equal(next.reason, "go");
  assert.ok(next.updatedAt >= job.updatedAt);
});

test("transitionStep validates and applies patch", () => {
  const { steps } = createJob({});
  const s = steps[0];
  const running = transitionStep(s, "queued");
  assert.equal(running.status, "queued");
  assert.throws(() => transitionStep(s, "completed"), /Illegal/);
});

test("synthesizeProjectReview is deterministic and grounds only in local data", () => {
  const ctx = {
    project: { name: "Raven", description: "Ops", status: "active", currentTask: "T1" },
    sessions: [{ id: "s1", title: "Sprint", objective: "Ship", status: "active" }],
    checkpoints: [{ id: "c1", sessionId: "s1", createdAt: 1, note: "Milestone 1", nextAction: "Do X" }],
    memory: [
      { id: "m1", title: "Pinned insight", pinned: true, archived: false, type: "fact" },
      { id: "m2", title: "Blocker note", pinned: false, archived: false, type: "blocker" },
    ],
    decisions: [{ id: "d1", title: "Adopt X" }],
    commands: [{ id: "cmd1", prompt: "hello", status: "done" }],
    roadmap: [{ id: "r1", title: "Ship Council", status: "in_progress" }],
  };
  const a = synthesizeProjectReview(ctx);
  const b = synthesizeProjectReview(ctx);
  // Deterministic across calls (ignoring the memory_governance date stamp)
  assert.equal(a.outputByStepOrder[1], b.outputByStepOrder[1]);
  assert.equal(a.outputByStepOrder[2], b.outputByStepOrder[2]);
  assert.equal(a.outputByStepOrder[3], b.outputByStepOrder[3]);
  assert.equal(a.outputByStepOrder[4], b.outputByStepOrder[4]);
  assert.equal(a.outputByStepOrder[5], b.outputByStepOrder[5]);
  assert.ok(a.deterministic);
  // Researcher must never claim external sources.
  assert.match(a.outputByStepOrder[2], /local-only|nothing external/i);
  // Builder should include the checkpoint next action.
  assert.match(a.outputByStepOrder[4], /Do X/);
});

test("synthesizeProjectReview handles empty context safely", () => {
  const out = synthesizeProjectReview({});
  assert.ok(out.outputByStepOrder[1].includes("(no active project)"));
  assert.ok(out.deterministic);
});

test("deriveCouncilQueue excludes terminal jobs and orders by priority", () => {
  const now = Date.now();
  const jobs = [
    { id: "a", status: "completed", objective: "done", createdAt: now, updatedAt: now },
    { id: "b", status: "running",   objective: "run",  createdAt: now, updatedAt: now },
    { id: "c", status: "queued",    objective: "q",    createdAt: now, updatedAt: now - 1 },
    { id: "d", status: "awaiting_approval", objective: "wait", createdAt: now, updatedAt: now },
    { id: "e", status: "cancelled", objective: "x",    createdAt: now, updatedAt: now },
    { id: "f", status: "failed",    objective: "boom", createdAt: now, updatedAt: now },
  ];
  const q = deriveCouncilQueue(jobs);
  assert.ok(!q.some((r) => r.id === "a" || r.id === "e"));
  assert.equal(q[0].id, "b");
  assert.equal(q[1].id, "d");
  assert.ok(q.every((r) => r.source === "council"));
});

test("seedCouncilJobsIfEmpty returns null when store already has jobs", () => {
  assert.equal(seedCouncilJobsIfEmpty([{ id: "x" }]), null);
  const seeded = seedCouncilJobsIfEmpty([]);
  assert.ok(seeded);
  assert.equal(seeded.steps.length, 6);
});

test("pause → resume round-trip is legal", () => {
  const { job } = createJob({});
  const running = transitionJob(transitionJob(job, "queued"), "running");
  const blocked = transitionJob(running, "blocked", { reason: "user paused" });
  const resumed = transitionJob(blocked, "running");
  assert.equal(resumed.status, "running");
});

test("retry from failed clears back to queued", () => {
  const { job } = createJob({});
  const running = transitionJob(transitionJob(job, "queued"), "running");
  const failed = transitionJob(running, "failed", { reason: "boom" });
  const retried = transitionJob(failed, "queued");
  assert.equal(retried.status, "queued");
});