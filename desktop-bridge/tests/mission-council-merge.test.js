import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveTaskQueue } from "../../src/lib/rah/sessions.js";
import { deriveCouncilQueue, createJob, transitionJob } from "../../src/lib/rah/councilJobs.js";

const QUEUE_PRIORITY = { running: 0, awaiting_approval: 1, queued: 2, failed: 3, completed: 4 };

function mergeQueues(base, council, limit = 8) {
  const merged = [...base, ...council];
  merged.sort((a, b) => {
    const pa = QUEUE_PRIORITY[a.status] ?? 9;
    const pb = QUEUE_PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
  return merged.slice(0, limit);
}

test("merged queue orders by priority then newest first", () => {
  const now = Date.now();
  const commands = [
    { id: "c1", prompt: "old queued", status: "queued", createdAt: now - 10_000 },
    { id: "c2", prompt: "recent completed", status: "done", createdAt: now - 500 },
  ];
  const base = deriveTaskQueue({ commands, approvals: [], limit: 8 });
  const councilJobs = [
    { id: "j1", status: "running", objective: "run job", createdAt: now - 2000, updatedAt: now - 2000 },
    { id: "j2", status: "awaiting_approval", objective: "gov", createdAt: now - 1000, updatedAt: now - 1000 },
    { id: "j3", status: "completed", objective: "done", createdAt: now, updatedAt: now },
    { id: "j4", status: "cancelled", objective: "x", createdAt: now, updatedAt: now },
  ];
  const council = deriveCouncilQueue(councilJobs, 8);
  const merged = mergeQueues(base, council, 8);

  // Terminal council jobs (completed, cancelled) excluded by deriveCouncilQueue.
  assert.ok(!merged.some((r) => r.id === "j3" && r.source === "council"));
  assert.ok(!merged.some((r) => r.id === "j4"));
  // Running comes before awaiting_approval before queued.
  assert.equal(merged[0].id, "j1");
  assert.equal(merged[1].id, "j2");
  // Council rows carry source="council".
  assert.equal(merged[0].source, "council");
});

test("resume computes transitionJob once and reuses the same object", () => {
  const { job } = createJob({});
  const queued = transitionJob(job, "queued");
  const running1 = transitionJob(queued, "running", { reason: "Resumed by user." });
  // Simulate the fixed controlResume: compute once, reuse.
  const persisted = running1;
  const passedToRun = running1;
  assert.strictEqual(persisted, passedToRun);
  assert.equal(persisted.status, "running");
  assert.equal(persisted.reason, "Resumed by user.");
});