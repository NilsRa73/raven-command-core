import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIFECYCLE_STATUSES, SAVE_DESTINATIONS,
  startSession, incrementCaptureCount, endSession, cancelSession, isSessionLive,
  shapeHashResult, chooseEvidenceStorage,
  createResult, createResultVersion, buildResultChain,
  shapeSaveReceipt, canDispatchProposal,
  filterVisionArtifacts, planImportApply, shouldConfirmVisionExit,
} from "../../src/lib/rah/visionLifecycle.js";

// ── Session lifecycle ─────────────────────────────────────────────────
test("startSession requires id, explicit project choice, consent, and source", () => {
  assert.equal(startSession({}).reason, "missing_id");
  assert.equal(startSession({ id: "s1" }).reason, "project_choice_required");
  assert.equal(startSession({ id: "s1", projectId: null }).reason, "consent_required");
  assert.equal(startSession({ id: "s1", projectId: null, consented: true }).reason, "source_required");
  const ok = startSession({ id: "s1", projectId: "p1", consented: true, sourceLabel: "Tab", now: 1000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.session.projectId, "p1");
  assert.equal(ok.session.status, "active");
  assert.equal(ok.session.captureCount, 0);
  assert.equal(ok.session.startedAt, 1000);
});

test("incrementCaptureCount only advances on active sessions", () => {
  const s = startSession({ id: "s1", projectId: null, consented: true, sourceLabel: "x" }).session;
  const after = incrementCaptureCount(incrementCaptureCount(s));
  assert.equal(after.captureCount, 2);
  const ended = endSession(after);
  const attempt = incrementCaptureCount(ended);
  assert.equal(attempt.captureCount, 2, "no capture on ended session");
});

test("endSession / cancelSession are terminal and idempotent", () => {
  const s = startSession({ id: "s1", projectId: null, consented: true, sourceLabel: "x" }).session;
  const ended = endSession(s, { now: 2000 });
  assert.equal(ended.status, "ended");
  assert.equal(ended.stoppedAt, 2000);
  const twice = endSession(ended);
  assert.equal(twice, ended, "idempotent — returns same object when already ended");
  const cancelled = cancelSession(startSession({ id: "s2", projectId: null, consented: true, sourceLabel: "x" }).session);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelSession(cancelled).status, "cancelled");
});

test("isSessionLive true only when active", () => {
  assert.equal(isSessionLive(null), false);
  const s = startSession({ id: "s", projectId: null, consented: true, sourceLabel: "x" }).session;
  assert.equal(isSessionLive(s), true);
  assert.equal(isSessionLive(endSession(s)), false);
});

// ── Hash result shaping ───────────────────────────────────────────────
test("shapeHashResult never fabricates hashes and records byte length + failure reasons", () => {
  const ok = shapeHashResult({ hash: "sha256:" + "a".repeat(64), bytes: new Uint8Array(10), hashedAt: 5 });
  assert.equal(ok.algorithm, "sha256");
  assert.equal(ok.byteLength, 10);
  assert.equal(ok.hashedAt, 5);
  assert.equal(ok.failureReason, null);
  const gap = shapeHashResult({ failureReason: "decode_failed", byteLength: 42 });
  assert.equal(gap.hash, null);
  assert.equal(gap.algorithm, null);
  assert.equal(gap.byteLength, 42);
  assert.equal(gap.hashedAt, null);
  assert.equal(gap.failureReason, "decode_failed");
  const defaulted = shapeHashResult({});
  assert.equal(defaulted.failureReason, "hash_unavailable");
});

// ── Storage choice ────────────────────────────────────────────────────
test("chooseEvidenceStorage defaults to metadata_only", () => {
  assert.deepEqual(chooseEvidenceStorage(), { storeImage: false, mode: "metadata_only", warning: "image_will_not_be_reopenable" });
  assert.equal(chooseEvidenceStorage({ includeImage: true }).warning, "no_image_bytes_available");
  assert.deepEqual(chooseEvidenceStorage({ includeImage: true, hasImageBytes: true }), { storeImage: true, mode: "image_bundled", warning: null });
});

// ── Immutable result versioning ───────────────────────────────────────
test("createResult stores raw output and defaults; createResultVersion appends immutably", () => {
  const head = createResult({ id: "r1", rawText: "hello world", question: "q?", provider: "openai", model: "gpt", latencyMs: 12, now: 100 });
  assert.equal(head.version, 1);
  assert.equal(head.previousVersionId, null);
  assert.equal(head.rawText, "hello world");
  const v2 = createResultVersion(head, { id: "r2", editedText: "hello there", now: 200 });
  assert.equal(v2.version, 2);
  assert.equal(v2.previousVersionId, "r1");
  assert.equal(v2.rawText, "hello world", "raw output preserved across versions");
  assert.equal(v2.editedText, "hello there");
  assert.equal(v2.createdAt, 200);
  const v3 = createResultVersion(v2, { id: "r3", editedText: "again", now: 300 });
  const chain = buildResultChain([v3, head, v2], "r1");
  assert.deepEqual(chain.map((r) => r.id), ["r1", "r2", "r3"]);
});

test("createResult returns null when id is missing", () => {
  assert.equal(createResult({ rawText: "x" }), null);
  assert.equal(createResultVersion(null, { id: "r2" }), null);
});

// ── Destination receipts ──────────────────────────────────────────────
test("shapeSaveReceipt validates destination and stamps timestamp", () => {
  assert.equal(shapeSaveReceipt({ destination: "bogus" }).reason, "unknown_destination");
  const r = shapeSaveReceipt({ destination: "project_memory", id: "m1", at: 42 });
  assert.equal(r.ok, true);
  assert.equal(r.receipt.destination, "project_memory");
  assert.equal(r.receipt.at, 42);
  assert.ok(SAVE_DESTINATIONS.includes("chronicle"));
});

// ── Confirmation dispatch gate ────────────────────────────────────────
test("canDispatchProposal blocks unconfirmed ui_only and denied; hands off workflows inert", () => {
  assert.equal(canDispatchProposal({ proposal: null }).reason, "missing_proposal");
  assert.equal(canDispatchProposal({ proposal: { sideEffectClass: "denied" } }).reason, "denied_action");
  assert.equal(canDispatchProposal({ proposal: { sideEffectClass: "ui_only" } }).reason, "confirmation_required");
  assert.equal(canDispatchProposal({ proposal: { sideEffectClass: "ui_only" }, confirmed: true }).action, "dispatch_ui_only");
  assert.equal(canDispatchProposal({ proposal: { sideEffectClass: "workflow_handoff" } }).action, "handoff_inert");
  assert.equal(canDispatchProposal({ proposal: { sideEffectClass: "workflow_handoff" }, confirmed: true }).action, "handoff_inert");
});

// ── Cross-artifact history filter ─────────────────────────────────────
test("filterVisionArtifacts filters sessions/evidence/results by all criteria", () => {
  const sessions = [
    { id: "s1", projectId: "p1", title: "Design", question: "help me", sourceLabel: "Chrome", status: "active", startedAt: 100 },
    { id: "s2", projectId: "p2", title: "Debug", question: "why blank", sourceLabel: "Firefox", status: "ended", startedAt: 200 },
  ];
  const evidence = [
    { id: "e1", sessionId: "s1", projectId: "p1", createdAt: 110, privacy: { class: "public" }, notes: "clean" },
    { id: "e2", sessionId: "s2", projectId: "p2", createdAt: 210, privacy: { class: "sensitive_user_marked" }, notes: "email" },
  ];
  const results = [
    { id: "r1", sessionId: "s1", evidenceId: "e1", projectId: "p1", createdAt: 120, question: "help me", rawText: "click" },
    { id: "r2", sessionId: "s2", evidenceId: "e2", projectId: "p2", createdAt: 220, question: "why", rawText: "network" },
  ];
  const p1 = filterVisionArtifacts({ sessions, evidence, results }, { projectId: "p1" });
  assert.equal(p1.sessions.length, 1);
  assert.equal(p1.evidence.length, 1);
  assert.equal(p1.results.length, 1);
  const sens = filterVisionArtifacts({ sessions, evidence, results }, { privacyClass: "sensitive_user_marked" });
  assert.equal(sens.evidence[0].id, "e2");
  const search = filterVisionArtifacts({ sessions, evidence, results }, { q: "network" });
  assert.equal(search.results.length, 1);
  const range = filterVisionArtifacts({ sessions, evidence, results }, { since: 200 });
  assert.equal(range.sessions.length, 1);
  assert.equal(range.sessions[0].id, "s2");
});

// ── Import apply planner ──────────────────────────────────────────────
test("planImportApply detects duplicate ids and hash collisions; honors per-id overrides", () => {
  const existing = {
    sessions: [{ id: "s1" }],
    evidence: [{ id: "e1", frame: { hash: "sha256:" + "a".repeat(64) } }],
  };
  const incoming = {
    sessions: [{ id: "s1" }, { id: "s2" }, { id: null }],
    evidence: [
      { id: "e1", frame: { hash: "sha256:" + "b".repeat(64) } },        // dup id
      { id: "e2", frame: { hash: "sha256:" + "a".repeat(64) } },        // hash collision with e1
      { id: "e3", frame: { hash: "sha256:" + "c".repeat(64) } },        // clean create
    ],
  };
  const plan = planImportApply({ existing, incoming, conflictActions: { s1: "replace" } });
  assert.equal(plan.sessions.find((p) => p.id === "s1").action, "replace");
  assert.equal(plan.sessions.find((p) => p.id === "s2").action, "create");
  assert.equal(plan.sessions.find((p) => p.id === null).action, "skip");
  assert.equal(plan.evidence.find((p) => p.id === "e1").reason, "duplicate_id");
  assert.equal(plan.evidence.find((p) => p.id === "e1").action, "skip");
  assert.equal(plan.evidence.find((p) => p.id === "e2").reason, "hash_collision");
  assert.equal(plan.evidence.find((p) => p.id === "e3").action, "create");
  assert.ok(plan.conflicts.some((c) => c.kind === "evidence" && c.id === "e2"));
});

// ── Exit guard ────────────────────────────────────────────────────────
test("shouldConfirmVisionExit prompts on live session or dirty drafts", () => {
  assert.equal(shouldConfirmVisionExit({}), false);
  const s = startSession({ id: "s", projectId: null, consented: true, sourceLabel: "x" }).session;
  assert.equal(shouldConfirmVisionExit({ session: s }), true);
  assert.equal(shouldConfirmVisionExit({ session: endSession(s), resultDraftDirty: true }), true);
  assert.equal(shouldConfirmVisionExit({ regionsDirty: true }), true);
  assert.equal(shouldConfirmVisionExit({ evidenceNotesDirty: true }), true);
});

// ── Constants ─────────────────────────────────────────────────────────
test("LIFECYCLE_STATUSES is the canonical trio and immutable", () => {
  assert.deepEqual([...LIFECYCLE_STATUSES], ["active", "ended", "cancelled"]);
  assert.throws(() => { LIFECYCLE_STATUSES.push("nope"); });
});