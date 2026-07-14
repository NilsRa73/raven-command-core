import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildContextPacket, deterministicHash } from "../../src/lib/rah/ravenMode.js";
import { createWorkflow, createStep } from "../../src/lib/rah/workflow.js";
import {
  runWorkflow, cancelRun, resumeAfterApproval,
} from "../../src/lib/rah/workflowExecutor.js";

// ── SHA-256 determinism ────────────────────────────────────────────────
test("deterministicHash is real SHA-256 (matches node:crypto)", () => {
  const cases = ["", "abc", "The quick brown fox jumps over the lazy dog", "🜛 raven ⚡"];
  for (const s of cases) {
    const nodeHex = createHash("sha256").update(s, "utf8").digest("hex");
    assert.equal(deterministicHash(s), nodeHex, `mismatch for input: ${JSON.stringify(s)}`);
  }
});

// ── Fast + Deep packet parity (no wall-clock leakage in hash) ──────────
function memList() {
  return [
    { id: "m1", projectId: "p", title: "Vision", content: "Ship v1", pinned: true,  archived: false, updatedAt: 10, type: "note" },
    { id: "m2", projectId: "p", title: "Blocker", content: "Auth broken", pinned: false, archived: false, updatedAt: 20, type: "blocker" },
    { id: "m3", projectId: "p", title: "Note",    content: "Old note", pinned: false, archived: false, updatedAt: 30, type: "note" },
  ];
}

test("Fast + Deep packets: stable hash regardless of now()", () => {
  for (const mode of ["fast", "deep"]) {
    const a = buildContextPacket(memList(), { mode, projectId: "p", now: 1 });
    const b = buildContextPacket(memList(), { mode, projectId: "p", now: 999999 });
    assert.equal(a.packetHash, b.packetHash, `hash unstable for ${mode}`);
    assert.equal(a.parityId,   b.parityId,   `parity unstable for ${mode}`);
    assert.equal(a.packetHash.length, 64, "SHA-256 hex length");
  }
});

// ── Preview / executor packet parity: identical text + hash ────────────
test("Preview and executor packets are byte-identical when built with the same project + memory", () => {
  const project = { name: "Raven", description: "AI OS", goals: "Ship Alpha" };
  const preview = buildContextPacket(memList(), {
    mode: "fast", projectId: "p", project, now: 1,
  });
  const executor = buildContextPacket(memList(), {
    mode: "fast", projectId: "p", project, now: 2,
  });
  assert.equal(preview.text, executor.text);
  assert.equal(preview.packetHash, executor.packetHash);
  assert.equal(preview.parityId, executor.parityId);
  assert.match(preview.text, /=== RAH PROJECT ===/);
  assert.match(preview.text, /Name: Raven/);
  assert.match(preview.text, /Goals: Ship Alpha/);
});

// ── project name/goals reach ai() via workflow executor ────────────────
function makeDeps(overrides = {}) {
  const runs = new Map(), wfs = new Map(), approvals = new Map();
  return {
    _runs: runs, _wfs: wfs, _approvals: approvals,
    loadRun: async (id) => structuredClone(runs.get(id) ?? null),
    saveRun: async (r) => runs.set(r.runId, structuredClone(r)),
    loadWorkflow: async (id) => structuredClone(wfs.get(id) ?? null),
    loadApproval: async (id) => structuredClone(approvals.get(id) ?? null),
    requestApproval: async () => ({ id: "a1", status: "pending" }),
    ai: overrides.ai ?? (async () => ({ text: "ok", provider: "P", model: "M", transport: "t", latencyMs: 1 })),
    memory: { save: async () => {} }, chronicle: { log: async () => {} },
    bridge: {
      status: async () => ({ status: "paired_online", capabilities: [] }),
      readFile: async () => ({ text: "" }),
      writeFile: async () => ({ ok: true }),
      copyFile: async () => ({ ok: true }),
      launchUrl: async () => ({ ok: true }),
      launchApp: async () => ({ ok: true }),
    },
    now: () => 1,
    rng: () => "r",
    buildContextExtra: overrides.buildContextExtra,
  };
}

test("workflow AI receives project name + goals in systemExtra", async () => {
  let seenExtra = "";
  const deps = makeDeps({
    ai: async ({ systemExtra }) => { seenExtra = systemExtra; return { text: "done", provider: "P", model: "M", transport: "t", latencyMs: 1 }; },
    buildContextExtra: () => {
      const packet = buildContextPacket(memList(), {
        mode: "fast", projectId: "p",
        project: { name: "Raven One", goals: "Ship" },
      });
      return { text: packet.text, meta: {
        mode: packet.mode, selectedCount: packet.items.length,
        selectedIds: packet.selectedIds, approxTokens: packet.approxTokens,
        packetHash: packet.packetHash, parityId: packet.parityId,
        projectId: "p", projectName: "Raven One",
      }};
    },
  });
  const wf = createWorkflow({ name: "w", projectId: "p", steps: [createStep("ai_prompt", { prompt: "go" })] });
  deps._wfs.set(wf.id, wf);
  deps._runs.set("rp", { runId: "rp", workflowId: wf.id, status: "queued", currentStepIndex: 0,
    events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, dryRun: false });
  await runWorkflow("rp", deps);
  assert.match(seenExtra, /Name: Raven One/);
  assert.match(seenExtra, /Goals: Ship/);
  const s = deps._runs.get("rp");
  const done = s.events.find((e) => e.type === "step.completed");
  assert.equal(done.metadata.packet.projectName, "Raven One");
});

// ── Emergency stop: idempotent, single terminal event ──────────────────
test("cancelRun on awaiting_approval → cancelled with exactly one terminal event", async () => {
  const deps = makeDeps();
  const wf = createWorkflow({ name: "w", steps: [createStep("ai_prompt", { prompt: "x" })] });
  deps._wfs.set(wf.id, wf);
  deps._runs.set("r", { runId: "r", workflowId: wf.id, status: "awaiting_approval",
    currentStepIndex: 0, events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, dryRun: false });
  await cancelRun("r", deps, { reason: "emergency" });
  await cancelRun("r", deps, { reason: "emergency" }); // idempotent
  await cancelRun("r", deps, { reason: "emergency" }); // still idempotent
  const s = deps._runs.get("r");
  assert.equal(s.status, "cancelled");
  const term = s.events.filter((e) => e.type === "run.cancelled");
  assert.equal(term.length, 1);
  assert.equal(term[0].metadata.reason, "emergency");
  assert.equal(s.failureReason, "emergency");
});

test("cancelRun works on queued runs (Emergency Stop covers queued)", async () => {
  const deps = makeDeps();
  deps._wfs.set("w1", createWorkflow({ id: "w1", name: "w", steps: [createStep("ai_prompt", { prompt: "x" })] }));
  deps._runs.set("rq", { runId: "rq", workflowId: "w1", status: "queued",
    currentStepIndex: 0, events: [], stepResults: [], approvalIds: [], stepApprovals: {}, createdAt: 1, dryRun: false });
  await cancelRun("rq", deps, { reason: "emergency" });
  assert.equal(deps._runs.get("rq").status, "cancelled");
});

// ── Approval lifecycle: rejected/cancelled/stale never resume ──────────
test("resumeAfterApproval is a no-op for cancelled/rejected/stale approvals", async () => {
  let aiCalls = 0;
  const deps = makeDeps({ ai: async () => { aiCalls++; return { text: "ok" }; } });
  const wf = createWorkflow({ name: "w", steps: [createStep("bridge_launch_url", { url: "https://x.example" })] });
  deps._wfs.set(wf.id, wf);
  const baseRun = { runId: "ar", workflowId: wf.id, status: "awaiting_approval",
    currentStepIndex: 0, events: [], stepResults: [], approvalIds: ["a-rej"], stepApprovals: { [wf.steps[0].id]: "a-rej" }, createdAt: 1, dryRun: false };

  // Rejected — must not run
  deps._runs.set("ar", structuredClone(baseRun));
  deps._approvals.set("a-rej", { id: "a-rej", status: "rejected" });
  await resumeAfterApproval("ar", "a-rej", deps);
  assert.equal(deps._runs.get("ar").status, "failed");
  assert.equal(aiCalls, 0);

  // Cancelled — must not run
  deps._runs.set("ac", { ...structuredClone(baseRun), runId: "ac" });
  deps._approvals.set("a-can", { id: "a-can", status: "cancelled" });
  await resumeAfterApproval("ac", "a-can", deps);
  assert.equal(deps._runs.get("ac").status, "cancelled");
  assert.equal(aiCalls, 0);

  // Stale — approval belongs to a terminal run
  deps._runs.set("at", { ...structuredClone(baseRun), runId: "at", status: "cancelled" });
  deps._approvals.set("a-ok", { id: "a-ok", status: "approved" });
  await resumeAfterApproval("at", "a-ok", deps);
  assert.equal(deps._runs.get("at").status, "cancelled");
  assert.equal(aiCalls, 0);
});

// ── Cancelled approval flowing through Emergency Stop path ─────────────
test("cancelled approval leaves run in cancelled + does not resume", async () => {
  const deps = makeDeps();
  const wf = createWorkflow({ name: "w", steps: [createStep("bridge_launch_url", { url: "https://x.example" })] });
  deps._wfs.set(wf.id, wf);
  deps._runs.set("rr", { runId: "rr", workflowId: wf.id, status: "awaiting_approval",
    currentStepIndex: 0, events: [], stepResults: [], approvalIds: ["p1"], stepApprovals: { [wf.steps[0].id]: "p1" }, createdAt: 1, dryRun: false });
  deps._approvals.set("p1", { id: "p1", status: "cancelled" });
  await resumeAfterApproval("rr", "p1", deps);
  const s = deps._runs.get("rr");
  assert.equal(s.status, "cancelled");
  assert.ok(s.events.some((e) => e.type === "run.cancelled"));
});