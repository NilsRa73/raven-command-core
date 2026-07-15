import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCouncilPrompt,
  parseAiSynthesisResponse,
  mergeAiSynthesis,
  buildCouncilMemoryPayload,
  councilApprovalDescriptor,
  decideFinalization,
  synthesizeProjectReview,
  createJob,
} from "../../src/lib/rah/councilJobs.js";

test("buildCouncilPrompt grounds in the packet and forbids external facts", () => {
  const p = buildCouncilPrompt({
    projectName: "Raven",
    orchestratorText: "Active project: Raven.",
    researcherText: "Findings are local-only.",
    designerText: "",
    builderText: "Tasks:\n- Ship Council",
    testerText: "Acceptance:\n- All good",
    governanceText: "Save memory + checkpoint.",
  });
  assert.match(p, /Raven/);
  assert.match(p, /Ship Council/);
  assert.match(p, /Do NOT invent/);
  assert.match(p, /Return STRICT JSON/);
  assert.match(p, /LOCAL Raven data only/);
});

test("parseAiSynthesisResponse: valid JSON with all 6 roles", () => {
  const r = parseAiSynthesisResponse(JSON.stringify({
    orchestrator: "a", researcher: "b", designer: "c",
    builder: "d", tester: "e", memory_governance: "f",
  }));
  assert.equal(r.ok, true);
  assert.equal(r.findings.builder, "d");
});

test("parseAiSynthesisResponse: strips ``` fences", () => {
  const wrapped = "```json\n" + JSON.stringify({
    orchestrator: "a", researcher: "b", designer: "c",
    builder: "d", tester: "e", memory_governance: "f",
  }) + "\n```";
  const r = parseAiSynthesisResponse(wrapped);
  assert.equal(r.ok, true);
});

test("parseAiSynthesisResponse: missing role fails", () => {
  const r = parseAiSynthesisResponse(JSON.stringify({
    orchestrator: "a", researcher: "b", designer: "c",
    builder: "d", tester: "e",
  }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /memory_governance/);
});

test("parseAiSynthesisResponse: empty / garbage falls back", () => {
  assert.equal(parseAiSynthesisResponse("").ok, false);
  assert.equal(parseAiSynthesisResponse("just some prose").ok, false);
  assert.equal(parseAiSynthesisResponse("{oops").ok, false);
  assert.equal(parseAiSynthesisResponse(JSON.stringify([1, 2])).ok, false);
});

test("mergeAiSynthesis preserves deterministic value when AI field is empty", () => {
  const det = synthesizeProjectReview({
    project: { name: "X", currentTask: "T1" },
    checkpoints: [{ id: "c1", sessionId: "s1", createdAt: 1, note: "n", nextAction: "Do X" }],
  });
  const merged = mergeAiSynthesis(det, {
    orchestrator: "improved orch",
    researcher: "",         // empty → keep deterministic
    designer: "improved des",
    builder: "improved build",
    tester: "improved test",
    memory_governance: "improved gov",
  });
  assert.equal(merged.outputByStepOrder[1], "improved orch");
  assert.equal(merged.outputByStepOrder[2], det.outputByStepOrder[2]); // preserved
  assert.match(merged.outputByStepOrder[4], /improved build/);
  assert.equal(merged.deterministic, false);
});

test("councilApprovalDescriptor produces a low-risk descriptor with clear effect", () => {
  const { job } = createJob({ objective: "Weekly review" });
  const d = councilApprovalDescriptor(job);
  assert.equal(d.risk, "low");
  assert.match(d.title, /Council/i);
  assert.match(d.expectedResult, /Project Memory/);
  assert.ok(d.tools.includes("projectMemory.write"));
  assert.ok(d.tools.includes("checkpoints.write"));
});

test("buildCouncilMemoryPayload uses stable idempotency source key", () => {
  const { job } = createJob({ objective: "Rev" });
  const synth = synthesizeProjectReview({ project: { name: "Y" } });
  const payload = buildCouncilMemoryPayload(job, synth, "deterministic");
  assert.equal(payload.source, `council:${job.id}`);
  assert.match(payload.content, /Provider: deterministic/);
  assert.ok(Array.isArray(payload.tags));
  assert.ok(payload.tags.includes("council"));
});

test("decideFinalization: pending → noop", () => {
  const job = { status: "awaiting_approval", approvalIds: ["a1"] };
  assert.equal(decideFinalization({ job, approval: { status: "pending" }, memoryAlreadyExists: false }), "noop");
});
test("decideFinalization: approved & no memory → complete", () => {
  const job = { status: "awaiting_approval", approvalIds: ["a1"] };
  assert.equal(decideFinalization({ job, approval: { status: "approved" }, memoryAlreadyExists: false }), "complete");
});
test("decideFinalization: approved but memory already exists → noop (idempotent)", () => {
  const job = { status: "awaiting_approval", approvalIds: ["a1"] };
  assert.equal(decideFinalization({ job, approval: { status: "approved" }, memoryAlreadyExists: true }), "noop");
});
test("decideFinalization: rejected → reject", () => {
  const job = { status: "awaiting_approval", approvalIds: ["a1"] };
  assert.equal(decideFinalization({ job, approval: { status: "rejected" }, memoryAlreadyExists: false }), "reject");
});
test("decideFinalization: cancelled approval → reject (do not write memory)", () => {
  const job = { status: "awaiting_approval", approvalIds: ["a1"] };
  assert.equal(decideFinalization({ job, approval: { status: "cancelled" }, memoryAlreadyExists: false }), "reject");
});
test("decideFinalization: job not awaiting → noop even if approved", () => {
  const job = { status: "completed", approvalIds: ["a1"] };
  assert.equal(decideFinalization({ job, approval: { status: "approved" }, memoryAlreadyExists: false }), "noop");
});
test("decideFinalization: no approval → noop", () => {
  const job = { status: "awaiting_approval", approvalIds: [] };
  assert.equal(decideFinalization({ job, approval: null, memoryAlreadyExists: false }), "noop");
});