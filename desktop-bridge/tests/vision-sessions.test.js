import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISION_SESSIONS_SCHEMA_VERSION, SESSION_STATUSES, PRIVACY_CLASSES,
  PRIVACY_HEURISTIC_DISCLAIMER, REVIEW_STATES, FRAME_VARIANTS,
  VISION_ACTION_CATALOG, VISION_NO_FABRICATION, CONFIDENCE_MIN_FOR_AUTO,
  normalizeVisionSession, resolveProjectForSession, shapeFrameMetadata,
  classifyPrivacy, classIsSensitive,
  validateRedactionRegion, validateRedactionRegions, selectFrameVariant,
  areFramesDuplicate, nextReviewState,
  shapeEvidenceRecord, versionEvidence,
  classifyActionSideEffect, isLowConfidence,
  proposeSafeAction, proposeWorkflowHandoff, buildConfirmationPayload,
  computeSessionStatistics, filterVisionHistory,
  exportVisionHistoryJson, exportVisionHistoryMarkdown,
  shouldConfirmVisionDiscard, validateImportPayload, mergeVisionImport,
  detectAmbiguity, shapeRuntimeMetadata,
} from "../../src/lib/rah/visionSessions.js";

// ── Session normalization ─────────────────────────────────────────────
test("normalizeVisionSession fills defaults without fabricating source/project", () => {
  const s = normalizeVisionSession({ id: "s1", now: 1000, createdAt: 900 });
  assert.equal(s.id, "s1");
  assert.equal(s.projectId, null);
  assert.equal(s.sourceLabel, "—");
  assert.equal(s.displaySurface, null);
  assert.equal(s.title, "Untitled vision session");
  assert.equal(s.status, "active");
  assert.equal(s.mode, "fast");
  assert.equal(s.captureCount, 0);
  assert.equal(s.consented, false);
  assert.equal(s.schemaVersion, VISION_SESSIONS_SCHEMA_VERSION);
});

test("normalizeVisionSession preserves supplied fields and clamps status/mode", () => {
  const s = normalizeVisionSession({ id: "s2", projectId: "p1", mode: "deep", status: "ended", captureCount: 3, consented: true, sourceLabel: "  Window: Facebook  ", displaySurface: "window" });
  assert.equal(s.projectId, "p1");
  assert.equal(s.mode, "deep");
  assert.equal(s.status, "ended");
  assert.equal(s.captureCount, 3);
  assert.equal(s.sourceLabel, "Window: Facebook");
  assert.equal(s.displaySurface, "window");
  const bad = normalizeVisionSession({ mode: "hyper", status: "wat" });
  assert.equal(bad.mode, "fast");
  assert.equal(bad.status, "active");
});

// ── Project/profile resolution ────────────────────────────────────────
test("resolveProjectForSession prefers requested, then active, then null with fallback flag", () => {
  const projects = [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }];
  assert.deepEqual(resolveProjectForSession({ requestedProjectId: "p1", projects }), { projectId: "p1", projectName: "One", fallback: false });
  assert.deepEqual(resolveProjectForSession({ requestedProjectId: "missing", projects, activeProjectId: "p2" }), { projectId: "p2", projectName: "Two", fallback: true });
  assert.deepEqual(resolveProjectForSession({ requestedProjectId: "missing", projects }), { projectId: null, projectName: "", fallback: true });
  assert.deepEqual(resolveProjectForSession({ projects }), { projectId: null, projectName: "", fallback: false });
});

// ── Frame metadata ────────────────────────────────────────────────────
test("shapeFrameMetadata never invents fields", () => {
  const f = shapeFrameMetadata({ width: 800, height: 600, sizeBytes: 12345, capturedAt: 1, captureMethod: "image-capture" });
  assert.equal(f.width, 800);
  assert.equal(f.captureMethod, "image-capture");
  assert.equal(f.hash, null);
  const bad = shapeFrameMetadata({ captureMethod: "bogus" });
  assert.equal(bad.captureMethod, "unknown");
  assert.equal(bad.capturedAt, null);
  assert.equal(bad.width, 0);
});

// ── Privacy classification ────────────────────────────────────────────
test("classifyPrivacy: user marker short-circuits", () => {
  const r = classifyPrivacy({ userMarkedSensitive: true, question: "check balance" });
  assert.equal(r.class, "user_marked_sensitive");
  assert.match(r.disclaimer, /Heuristic/);
});

test("classifyPrivacy: keyword heuristics", () => {
  assert.equal(classifyPrivacy({ question: "Is my password visible?" }).class, "possible_credentials");
  assert.equal(classifyPrivacy({ note: "My credit card is on screen" }).class, "possible_financial");
  assert.equal(classifyPrivacy({ question: "prescription visible" }).class, "possible_health");
  assert.equal(classifyPrivacy({ note: "SSN shown" }).class, "possible_personal_data");
  assert.equal(classifyPrivacy({ question: "What does this button do?" }).class, "low");
  assert.equal(classifyPrivacy({}).class, "unknown");
});

test("classIsSensitive matches every non-low/unknown category", () => {
  for (const c of PRIVACY_CLASSES) {
    const should = c !== "low" && c !== "unknown";
    assert.equal(classIsSensitive(c), should, `class ${c}`);
  }
});

test("privacy heuristic disclaimer is honest and locked", () => {
  assert.match(PRIVACY_HEURISTIC_DISCLAIMER, /not detection/i);
  assert.match(PRIVACY_HEURISTIC_DISCLAIMER, /does not scan/i);
});

// ── Redaction validation ──────────────────────────────────────────────
test("validateRedactionRegion rejects zero-area, non-numeric, out-of-bounds", () => {
  const frame = { width: 100, height: 100 };
  assert.equal(validateRedactionRegion(null, frame).ok, false);
  assert.equal(validateRedactionRegion({ x: 0, y: 0, w: 0, h: 10 }, frame).reason, "zero_area");
  assert.equal(validateRedactionRegion({ x: "a", y: 0, w: 5, h: 5 }, frame).reason, "coords_not_numeric");
  assert.equal(validateRedactionRegion({ x: 200, y: 200, w: 10, h: 10 }, frame).reason, "out_of_bounds");
  assert.equal(validateRedactionRegion({ x: 10, y: 10, w: 10, h: 10 }, { width: 0, height: 0 }).reason, "frame_dimensions_invalid");
});

test("validateRedactionRegion clamps and preserves id/label", () => {
  const r = validateRedactionRegion({ id: "r1", label: "email", x: -5, y: -5, w: 200, h: 200 }, { width: 100, height: 100 });
  assert.ok(r.ok);
  assert.equal(r.region.id, "r1");
  assert.equal(r.region.label, "email");
  assert.equal(r.region.x, 0);
  assert.equal(r.region.y, 0);
  assert.ok(r.region.w > 0 && r.region.h > 0);
});

test("validateRedactionRegions splits accepted/rejected", () => {
  const res = validateRedactionRegions([
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 0, y: 0, w: 0, h: 0 },
  ], { width: 50, height: 50 });
  assert.equal(res.accepted.length, 1);
  assert.equal(res.rejected.length, 1);
  assert.equal(res.rejected[0].reason, "zero_area");
});

// ── Frame variant selection ───────────────────────────────────────────
test("selectFrameVariant defaults to redacted when regions exist", () => {
  const r = selectFrameVariant({ regions: [{ x: 0, y: 0, w: 5, h: 5 }] });
  assert.equal(r.defaultVariant, "redacted");
  assert.equal(r.variant, "redacted");
  assert.equal(r.requiresSecondConfirmation, false);
});

test("selectFrameVariant requires second confirmation for sensitive+original", () => {
  const r = selectFrameVariant({ regions: [{}], privacyClass: "user_marked_sensitive", userChoice: "original" });
  assert.equal(r.variant, "original");
  assert.equal(r.requiresSecondConfirmation, true);
  const ok = selectFrameVariant({ regions: [], privacyClass: "low" });
  assert.equal(ok.variant, "original");
  assert.equal(ok.requiresSecondConfirmation, false);
});

// ── Duplicate frames ──────────────────────────────────────────────────
test("areFramesDuplicate uses hash when available, dims+size otherwise", () => {
  const a = { width: 100, height: 100, sizeBytes: 10, hash: "abc" };
  const b = { width: 100, height: 100, sizeBytes: 10, hash: "abc" };
  const c = { width: 100, height: 100, sizeBytes: 10, hash: "zzz" };
  const d = { width: 100, height: 100, sizeBytes: 11 };
  assert.equal(areFramesDuplicate(a, b), true);
  assert.equal(areFramesDuplicate(a, c), false);
  assert.equal(areFramesDuplicate(a, d), false);
  assert.equal(areFramesDuplicate(null, a), false);
});

// ── Review state machine ─────────────────────────────────────────────
test("nextReviewState enforces Capture Review before analyze", () => {
  assert.equal(nextReviewState("idle", "analyze"), "idle"); // cannot skip
  assert.equal(nextReviewState("idle", "capture"), "captured");
  assert.equal(nextReviewState("captured", "analyze"), "analyzing");
  assert.equal(nextReviewState("captured", "mark-sensitive"), "confirming_sensitive");
  assert.equal(nextReviewState("confirming_sensitive", "confirm-send"), "analyzing");
  assert.equal(nextReviewState("confirming_sensitive", "cancel-send"), "captured");
  assert.equal(nextReviewState("analyzing", "analyze-done"), "reviewing_result");
  assert.equal(nextReviewState("reviewing_result", "discard"), "discarded");
  assert.equal(nextReviewState("anything", "reset"), "idle");
  assert.equal(nextReviewState("captured", "unknown-event"), "captured");
});

// ── Evidence immutability ─────────────────────────────────────────────
test("shapeEvidenceRecord defaults and version=1", () => {
  const e = shapeEvidenceRecord({ sessionId: "s1", projectId: "p1", frame: { width: 100, height: 100, sizeBytes: 10 } });
  assert.equal(e.version, 1);
  assert.equal(e.previousVersionId, null);
  assert.equal(e.privacy.class, "unknown");
  assert.equal(e.sourceLabel, "—");
  assert.equal(e.schemaVersion, VISION_SESSIONS_SCHEMA_VERSION);
});

test("versionEvidence returns NEW record, previous untouched", () => {
  const v1 = shapeEvidenceRecord({ id: "e1", notes: "orig", frame: { width: 10, height: 10, sizeBytes: 1 } });
  const v2 = versionEvidence(v1, { notes: "edited" }, { now: 5, id: "e2" });
  assert.equal(v1.notes, "orig", "prior record must not mutate");
  assert.equal(v1.version, 1);
  assert.equal(v2.notes, "edited");
  assert.equal(v2.version, 2);
  assert.equal(v2.previousVersionId, "e1");
  assert.notEqual(v1.id, v2.id);
  // Frame is immutable across versions.
  assert.deepEqual(v2.frame, v1.frame);
});

// ── Action allowlist / side effects ───────────────────────────────────
test("classifyActionSideEffect denies anything outside the catalog", () => {
  const bad = classifyActionSideEffect("run_shell");
  assert.equal(bad.allowed, false);
  assert.equal(bad.sideEffectClass, "denied");
  const good = classifyActionSideEffect("navigate");
  assert.equal(good.allowed, true);
  assert.equal(good.sideEffectClass, "ui_only");
});

test("catalog contains only UI-safe intents", () => {
  for (const entry of VISION_ACTION_CATALOG) {
    assert.equal(entry.sideEffectClass, "ui_only");
  }
});

test("isLowConfidence uses CONFIDENCE_MIN_FOR_AUTO", () => {
  assert.equal(isLowConfidence(CONFIDENCE_MIN_FOR_AUTO), false);
  assert.equal(isLowConfidence(CONFIDENCE_MIN_FOR_AUTO - 0.01), true);
  assert.equal(isLowConfidence(NaN), true);
});

test("proposeSafeAction fails closed for not-in-catalog / ambiguous / low confidence", () => {
  const denied = proposeSafeAction({ intentId: "spawn_shell", confidence: 0.9 });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "not_in_catalog");
  const ambiguous = proposeSafeAction({ intentId: "navigate", confidence: 0.9, ambiguous: true });
  assert.equal(ambiguous.reason, "ambiguous");
  const lowConf = proposeSafeAction({ intentId: "navigate", confidence: 0.2 });
  assert.equal(lowConf.reason, "low_confidence");
  const ok = proposeSafeAction({ intentId: "navigate", confidence: 0.9, params: { to: "/" }, evidenceId: "e1" });
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.confirmed, false);
  assert.equal(ok.proposal.sideEffectClass, "ui_only");
});

test("proposeWorkflowHandoff requires title and steps, stays inert", () => {
  assert.equal(proposeWorkflowHandoff({ title: "", steps: [{}] }).reason, "title_required");
  assert.equal(proposeWorkflowHandoff({ title: "t", steps: [] }).reason, "steps_required");
  const ok = proposeWorkflowHandoff({ title: "Backup", steps: [{ action: "bridge_read_file" }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.dispatched, false);
  assert.equal(ok.proposal.sideEffectClass, "workflow_handoff");
});

// ── Confirmation payload ─────────────────────────────────────────────
test("buildConfirmationPayload requires proposal and shapes dispatch by kind", () => {
  assert.equal(buildConfirmationPayload({}).ok, false);
  const safeProp = proposeSafeAction({ intentId: "navigate", confidence: 0.9, params: { to: "/x" }, evidenceId: "e1" }).proposal;
  const c1 = buildConfirmationPayload({ proposal: safeProp, evidence: { frame: { capturedAt: 42, hash: "h" } } });
  assert.equal(c1.ok, true);
  assert.equal(c1.payload.dispatch.type, "ui_only");
  assert.equal(c1.payload.frameCapturedAt, 42);
  assert.equal(c1.payload.frameHash, "h");
  const wf = proposeWorkflowHandoff({ title: "T", steps: [{ a: 1 }] }).proposal;
  const c2 = buildConfirmationPayload({ proposal: wf, approvalStatus: "pending" });
  assert.equal(c2.payload.dispatch.type, "workflow_handoff");
  assert.equal(c2.payload.approvalStatus, "pending");
});

// ── Statistics / filtering / export ──────────────────────────────────
test("computeSessionStatistics tallies sessions and sensitive evidence", () => {
  const sessions = [
    normalizeVisionSession({ status: "active", captureCount: 2 }),
    normalizeVisionSession({ status: "ended", captureCount: 1 }),
    normalizeVisionSession({ status: "cancelled" }),
  ];
  const evidence = [
    shapeEvidenceRecord({ privacy: { class: "user_marked_sensitive", reasons: [] } }),
    shapeEvidenceRecord({ privacy: { class: "low", reasons: [] } }),
  ];
  const s = computeSessionStatistics(sessions, evidence);
  assert.equal(s.sessions, 3);
  assert.equal(s.active, 1);
  assert.equal(s.ended, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.totalCaptures, 3);
  assert.equal(s.evidenceCount, 2);
  assert.equal(s.sensitiveCount, 1);
});

test("filterVisionHistory filters by project/status/query", () => {
  const list = [
    normalizeVisionSession({ id: "a", projectId: "p1", title: "Login flow", status: "active" }),
    normalizeVisionSession({ id: "b", projectId: "p2", title: "Facebook feed", status: "ended" }),
    normalizeVisionSession({ id: "c", projectId: null, title: "Random", status: "cancelled" }),
  ];
  assert.equal(filterVisionHistory(list, { projectId: "p1" }).length, 1);
  assert.equal(filterVisionHistory(list, { status: "ended" }).length, 1);
  assert.equal(filterVisionHistory(list, { q: "facebook" }).length, 1);
  assert.equal(filterVisionHistory(list, { projectId: null }).length, 1);
});

test("exportVisionHistoryJson is round-trip parseable", () => {
  const json = exportVisionHistoryJson({ sessions: [normalizeVisionSession({ id: "a" })], evidence: [] });
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, VISION_SESSIONS_SCHEMA_VERSION);
  assert.equal(parsed.sessions[0].id, "a");
});

test("exportVisionHistoryMarkdown never embeds image data", () => {
  const md = exportVisionHistoryMarkdown({
    sessions: [normalizeVisionSession({ id: "a" })],
    evidence: [shapeEvidenceRecord({ id: "e", frame: { width: 1, height: 1, sizeBytes: 1 } })],
  });
  assert.doesNotMatch(md, /data:image/);
  assert.doesNotMatch(md, /base64/);
  assert.match(md, /NEVER embedded/);
});

// ── Draft guard ──────────────────────────────────────────────────────
test("shouldConfirmVisionDiscard fires only when meaningful state is dirty", () => {
  assert.equal(shouldConfirmVisionDiscard({}), false);
  assert.equal(shouldConfirmVisionDiscard({ hasCapturedFrame: true }), false);
  assert.equal(shouldConfirmVisionDiscard({ hasCapturedFrame: true, regionsDirty: true }), true);
  assert.equal(shouldConfirmVisionDiscard({ reviewState: "confirming_sensitive" }), true);
  assert.equal(shouldConfirmVisionDiscard({ reviewState: "analyzing" }), true);
  assert.equal(shouldConfirmVisionDiscard({ reviewState: "captured", resultDraftDirty: true }), true);
  assert.equal(shouldConfirmVisionDiscard({ reviewState: "reviewing_result", evidenceNotesDirty: true }), true);
});

// ── Import / merge ───────────────────────────────────────────────────
test("validateImportPayload rejects wrong shape and unsupported version", () => {
  assert.equal(validateImportPayload(null).reason, "not_object");
  assert.equal(validateImportPayload({ schemaVersion: 99, sessions: [], evidence: [] }).reason, "schema_version_unsupported");
  assert.equal(validateImportPayload({ schemaVersion: 1 }).reason, "missing_arrays");
  const ok = validateImportPayload({ schemaVersion: 1, sessions: [], evidence: [] });
  assert.equal(ok.ok, true);
});

test("mergeVisionImport skips duplicates by default, replaces on request", () => {
  const existing = { sessions: [{ id: "a" }], evidence: [{ id: "e1" }] };
  const incoming = { sessions: [{ id: "a", note: "new" }, { id: "b" }], evidence: [{ id: "e1", note: "new" }, { id: "e2" }] };
  const skip = mergeVisionImport({ existing, incoming, strategy: "skip" });
  assert.equal(skip.merged.sessions.length, 2);
  assert.equal(skip.skipped.sessions[0].reason, "duplicate");
  const rep = mergeVisionImport({ existing, incoming, strategy: "replace" });
  assert.deepEqual(rep.replaced.sessions, ["a"]);
  assert.equal(rep.merged.sessions.find((s) => s.id === "a").note, "new");
  // missing id path
  const noid = mergeVisionImport({ existing: { sessions: [], evidence: [] }, incoming: { sessions: [{}], evidence: [{}] } });
  assert.equal(noid.skipped.sessions[0].reason, "missing_id");
});

// ── Ambiguity / runtime metadata / contracts ─────────────────────────
test("detectAmbiguity flags short question, missing evidence, explicit flag", () => {
  assert.equal(detectAmbiguity({ question: "hi", evidenceId: "e" }), true);
  assert.equal(detectAmbiguity({ question: "what next", evidenceId: null }), true);
  assert.equal(detectAmbiguity({ question: "what next", evidenceId: "e", extra: true }), true);
  assert.equal(detectAmbiguity({ question: "what next", evidenceId: "e" }), false);
});

test("shapeRuntimeMetadata never invents provider/model", () => {
  const r = shapeRuntimeMetadata({});
  assert.equal(r.provider, null);
  assert.equal(r.model, null);
  assert.equal(r.transport, null);
  assert.equal(r.latencyMs, null);
  const r2 = shapeRuntimeMetadata({ provider: "P", model: "M", transport: "bridge", latencyMs: 123 });
  assert.equal(r2.provider, "P");
  assert.equal(r2.latencyMs, 123);
});

test("no-fabrication contracts are locked", () => {
  assert.equal(VISION_NO_FABRICATION.moduleDoesNotScanImages, true);
  assert.equal(VISION_NO_FABRICATION.moduleClaimsOcrDetection, false);
  assert.equal(VISION_NO_FABRICATION.moduleAutoRedactsSensitive, false);
  assert.equal(VISION_NO_FABRICATION.moduleAutoDispatchesActions, false);
  assert.equal(VISION_NO_FABRICATION.moduleAllowsSideEffectsWithoutApproval, false);
  assert.equal(VISION_NO_FABRICATION.captureReviewIsMandatory, true);
  assert.equal(VISION_NO_FABRICATION.evidenceIsAppendOnly, true);
});

test("REVIEW_STATES / SESSION_STATUSES / FRAME_VARIANTS exposed for UI", () => {
  assert.ok(REVIEW_STATES.includes("captured"));
  assert.ok(SESSION_STATUSES.includes("active"));
  assert.deepEqual([...FRAME_VARIANTS], ["original", "redacted"]);
  assert.ok(PRIVACY_CLASSES.includes("user_marked_sensitive"));
});

test("capability fail-closed: unknown intent + workflow handoff without title both refuse", () => {
  assert.equal(classifyActionSideEffect("").sideEffectClass, "denied");
  assert.equal(proposeWorkflowHandoff({ steps: [{}] }).ok, false);
});

test("no-silent-save: proposals arrive not confirmed / not dispatched", () => {
  const p = proposeSafeAction({ intentId: "focus_command_bar", confidence: 0.95, evidenceId: "e1" }).proposal;
  assert.equal(p.confirmed, false);
  const wh = proposeWorkflowHandoff({ title: "X", steps: [{}] }).proposal;
  assert.equal(wh.dispatched, false);
});