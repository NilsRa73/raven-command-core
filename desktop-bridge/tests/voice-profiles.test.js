import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GLOBAL_PROFILE_ID,
  VOICE_PROFILES_SCHEMA_VERSION,
  ALLOWED_COMMAND_CATEGORIES,
  DEFAULT_CONFIDENCE_THRESHOLD,
  normalizeProfile, normalizeLocale, normalizeWakePhrase,
  buildGlobalDefaultProfile, resolveProfileForProject,
  matchWakePhrase,
  buildTranscriptReview, segmentTranscript, isDuplicateTranscript,
  proposeVoiceCommand, classifySideEffect, buildConfirmationView,
  buildReadinessSummary, summarizeSession,
  filterVoiceHistory, shapeHistoryForExport,
  isProfileDraftDirty, isReviewDraftDirty,
  shapeProfileForExport, validateProfileImport, planProfileMerge,
  buildCleanupPrompt, isCleanupSuspicious,
  VOICE_COMMAND_CATALOG,
} from "../../src/lib/rah/voiceProfiles.js";

// ─── Normalization ────────────────────────────────────────────────────

test("normalizeProfile fills defaults but never invents projectId", () => {
  const p = normalizeProfile({ now: 100 });
  assert.equal(p.projectId, null);
  assert.equal(p.wakePhrase, "raven");
  assert.equal(p.locale, "en-US");
  assert.equal(p.pushToTalk, true);
  assert.equal(p.continuousListening, false);
  assert.equal(p.enabled, true);
  assert.equal(p.schemaVersion, VOICE_PROFILES_SCHEMA_VERSION);
});

test("normalizeLocale accepts bcp-47-ish tokens; rejects junk to en-US", () => {
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("en_US"), "en-US");
  assert.equal(normalizeLocale("nb-no"), "nb-NO");
  assert.equal(normalizeLocale("###"), "en-US");
  assert.equal(normalizeLocale(""), "en-US");
});

test("normalizeWakePhrase lowercases, strips punctuation, collapses spaces", () => {
  assert.equal(normalizeWakePhrase("  Hey, Raven!!  "), "hey raven");
  assert.equal(normalizeWakePhrase(null), "");
});

test("alternatePhrases are de-duplicated and cannot equal the main phrase", () => {
  const p = normalizeProfile({
    wakePhrase: "raven",
    alternatePhrases: ["raven", "hey raven", "hey raven", "greetings raven"],
  });
  assert.deepEqual(p.alternatePhrases, ["hey raven", "greetings raven"]);
});

test("allowedCommandCategories filters unknown categories", () => {
  const p = normalizeProfile({ allowedCommandCategories: ["navigation", "launch_arbitrary_app"] });
  assert.deepEqual(p.allowedCommandCategories, ["navigation"]);
});

// ─── Fallback ─────────────────────────────────────────────────────────

test("resolveProfileForProject: exact project hit", () => {
  const g = buildGlobalDefaultProfile(1);
  const a = normalizeProfile({ id: "a", projectId: "p1", name: "P1", now: 2 });
  const res = resolveProfileForProject("p1", [g, a]);
  assert.equal(res.matchedBy, "project");
  assert.equal(res.profile.id, "a");
  assert.equal(res.fallback, false);
});

test("resolveProfileForProject: unknown project falls back visibly", () => {
  const g = buildGlobalDefaultProfile(1);
  const res = resolveProfileForProject("nope", [], g);
  assert.equal(res.matchedBy, "global_fallback");
  assert.equal(res.fallback, true);
  assert.equal(res.profile.id, GLOBAL_PROFILE_ID);
});

test("resolveProfileForProject: disabled project profile is ignored", () => {
  const g = buildGlobalDefaultProfile(1);
  const a = normalizeProfile({ id: "a", projectId: "p1", enabled: false });
  const res = resolveProfileForProject("p1", [a], g);
  assert.equal(res.matchedBy, "global_fallback");
});

// ─── Wake matching ────────────────────────────────────────────────────

test("matchWakePhrase: exact and prefix", () => {
  const p = buildGlobalDefaultProfile();
  assert.equal(matchWakePhrase("raven", p).method, "exact");
  const r = matchWakePhrase("hey raven summarize today", p);
  assert.equal(r.matched, true);
  assert.equal(r.method, "prefix");
  assert.equal(r.command, "summarize today");
});

test("matchWakePhrase: no configured phrases fails closed", () => {
  const p = normalizeProfile({ wakePhrase: "", alternatePhrases: [] });
  // normalizeProfile enforces default "raven"; force empty for the test
  p.wakePhrase = ""; p.alternatePhrases = [];
  const r = matchWakePhrase("hey raven", p);
  assert.equal(r.matched, false);
  assert.equal(r.reason, "no_phrases_configured");
});

test("matchWakePhrase: below threshold reports score + reason", () => {
  const p = normalizeProfile({ wakePhrase: "aurora", wakeConfidenceThreshold: 0.9 });
  const r = matchWakePhrase("aurora borealis show me", p);
  // prefix match returns 0.95 so bump threshold above:
  p.wakeConfidenceThreshold = 0.99;
  const r2 = matchWakePhrase("aurora borealis show me", p);
  assert.equal(r2.matched, false);
  assert.equal(r2.reason, "below_threshold");
  assert.equal(r2.threshold, 0.99);
  assert.ok(r2.score < r2.threshold);
  assert.equal(r.matched, true); // 0.9 threshold is met by prefix (0.95)
});

test("matchWakePhrase: empty transcript short-circuits", () => {
  const p = buildGlobalDefaultProfile();
  const r = matchWakePhrase("   ", p);
  assert.equal(r.matched, false);
  assert.equal(r.reason, "empty_transcript");
});

// ─── Transcript shaping ───────────────────────────────────────────────

test("buildTranscriptReview shapes fields and normalizes text", () => {
  const rev = buildTranscriptReview({ raw: "  Open  chronicle.  ", now: 5, projectId: "p1", profileId: "a", confidence: 0.7 });
  assert.equal(rev.status, "review");
  assert.equal(rev.normalizedText, "Open chronicle.");
  assert.equal(rev.projectId, "p1");
  assert.equal(rev.confidence, 0.7);
  assert.deepEqual(rev.segments, ["Open chronicle."]);
});

test("segmentTranscript splits on . ! ? and newlines", () => {
  assert.deepEqual(segmentTranscript("hi there. how are you? fine!\nnext"),
    ["hi there.", "how are you?", "fine!", "next"]);
  assert.deepEqual(segmentTranscript(""), []);
});

test("isDuplicateTranscript detects same normalized text within window", () => {
  const now = 1000;
  const hist = [{ rawText: "Open Chronicle", createdAt: now - 1000 }];
  assert.equal(isDuplicateTranscript({ rawText: "open  chronicle" }, hist, 5000, now), true);
  assert.equal(isDuplicateTranscript({ rawText: "open chronicle" }, hist, 500, now), false);
});

// ─── Intent proposal ─────────────────────────────────────────────────

test("proposeVoiceCommand: exact allowlisted navigation match is ready", () => {
  const p = buildGlobalDefaultProfile();
  const r = proposeVoiceCommand({ transcript: "open chronicle", profile: p });
  assert.equal(r.status, "ready");
  assert.equal(r.top.commandId, "nav.chronicle");
  assert.equal(r.top.sideEffect, "ui_only");
  assert.equal(r.top.requiresConfirmation, true);
});

test("proposeVoiceCommand: unknown text is no_match, never invents an action", () => {
  const p = buildGlobalDefaultProfile();
  const r = proposeVoiceCommand({ transcript: "please rewrite the linux kernel", profile: p });
  assert.equal(r.status, "no_match");
  assert.equal(r.top, null);
});

test("proposeVoiceCommand: low STT confidence blocks even a good match", () => {
  const p = buildGlobalDefaultProfile();
  const r = proposeVoiceCommand({ transcript: "open chronicle", profile: p, confidence: 0.1 });
  assert.equal(r.status, "low_confidence");
  assert.equal(r.confidenceOk, false);
});

test("proposeVoiceCommand: disallowed categories are pruned (fail-closed)", () => {
  const p = normalizeProfile({ allowedCommandCategories: ["navigation"] });
  const r = proposeVoiceCommand({ transcript: "start focus", profile: p });
  assert.equal(r.status, "no_match");
});

test("catalog contains ONLY allowlisted safe categories — no launch_program, no bridge_write_file", () => {
  for (const entry of VOICE_COMMAND_CATALOG) {
    assert.ok(ALLOWED_COMMAND_CATEGORIES.includes(entry.category), `bad category: ${entry.category}`);
    assert.notEqual(entry.action?.type, "spawn");
    assert.notEqual(entry.action?.type, "bridge_launch_program");
  }
});

test("workflow proposals are classified requires_approval", () => {
  const entry = VOICE_COMMAND_CATALOG.find((e) => e.id === "workflow.propose");
  assert.equal(classifySideEffect(entry), "requires_approval");
});

test("buildConfirmationView carries exact action string", () => {
  const p = buildGlobalDefaultProfile();
  const r = proposeVoiceCommand({ transcript: "open home", profile: p });
  const v = buildConfirmationView(r.top);
  assert.equal(v.commandId, "nav.home");
  assert.equal(v.requiresApproval, false);
  assert.match(v.exactAction, /navigate/);
});

// ─── Readiness ────────────────────────────────────────────────────────

test("buildReadinessSummary is honest about unsupported browsers", () => {
  const r = buildReadinessSummary({ sttSupported: false, micPermission: "unknown" });
  assert.equal(r.canStart, false);
  assert.equal(r.level, "unsupported");
  assert.match(r.honestCapabilityStatement, /unavailable/);
});

test("buildReadinessSummary reports permission_not_requested distinct from denied", () => {
  const a = buildReadinessSummary({ sttSupported: true, micPermission: "prompt" });
  assert.equal(a.level, "permission_not_requested");
  const b = buildReadinessSummary({ sttSupported: true, micPermission: "denied" });
  assert.equal(b.canStart, false);
  assert.ok(b.blockers.some((s) => /denied/i.test(s)));
});

// ─── Session + history ───────────────────────────────────────────────

test("summarizeSession counts turns and statuses honestly", () => {
  const s = summarizeSession({
    turns: [{ role: "user", text: "a", ts: 1 }, { role: "assistant", text: "b", ts: 2 }],
    transcripts: [{ status: "proposed" }, { status: "confirmed" }, { status: "saved" }, { status: "discarded" }],
  });
  assert.deepEqual(s, { userTurns: 1, assistantTurns: 1, transcripts: 4, proposed: 1, confirmed: 1, saved: 1 });
});

test("filterVoiceHistory: project + status + text query", () => {
  const rows = [
    { id: "1", projectId: "p1", status: "saved", rawText: "hello world", createdAt: 100 },
    { id: "2", projectId: "p2", status: "saved", rawText: "hello world", createdAt: 100 },
    { id: "3", projectId: "p1", status: "proposed", rawText: "start focus", createdAt: 200 },
  ];
  assert.deepEqual(filterVoiceHistory(rows, { projectId: "p1" }).map((r) => r.id), ["1", "3"]);
  assert.deepEqual(filterVoiceHistory(rows, { status: "proposed" }).map((r) => r.id), ["3"]);
  assert.deepEqual(filterVoiceHistory(rows, { q: "focus" }).map((r) => r.id), ["3"]);
  assert.deepEqual(filterVoiceHistory(rows, { since: 150 }).map((r) => r.id), ["3"]);
});

test("shapeHistoryForExport includes ISO timestamps and does not add secrets", () => {
  const rows = [{ id: "1", createdAt: 0, rawText: "a" }];
  const out = shapeHistoryForExport(rows);
  assert.equal(out[0].createdAtIso, new Date(0).toISOString());
  assert.equal(out[0].rawText, "a");
  assert.ok(!("apiKey" in out[0]));
});

// ─── Draft guards ────────────────────────────────────────────────────

test("isProfileDraftDirty: no baseline means dirty", () => {
  const d = normalizeProfile({ id: "a" });
  assert.equal(isProfileDraftDirty(d, null), true);
});

test("isProfileDraftDirty: identical draft is not dirty", () => {
  const d = normalizeProfile({ id: "a", now: 1 });
  assert.equal(isProfileDraftDirty(d, d), false);
});

test("isProfileDraftDirty: single field change flips dirty", () => {
  const a = normalizeProfile({ id: "a", wakePhrase: "raven", now: 1 });
  const b = { ...a, wakePhrase: "aurora" };
  assert.equal(isProfileDraftDirty(b, a), true);
});

test("isReviewDraftDirty: edited text triggers dirty", () => {
  assert.equal(isReviewDraftDirty({ status: "review", editedText: "fixed" }), true);
  assert.equal(isReviewDraftDirty({ status: "saved", editedText: "fixed" }), false);
});

// ─── Import / merge ──────────────────────────────────────────────────

test("validateProfileImport: rejects wrong schema version", () => {
  const bad = { schemaVersion: 999, profile: {} };
  const r = validateProfileImport(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /unsupported_schema_version/);
});

test("validateProfileImport: accepts single profile payload", () => {
  const payload = shapeProfileForExport(normalizeProfile({ id: "a" }));
  const r = validateProfileImport(payload);
  assert.equal(r.ok, true);
  assert.equal(r.profiles.length, 1);
});

test("planProfileMerge: duplicate ID with no decision is conflict, not silent overwrite", () => {
  const existing = [normalizeProfile({ id: "a", name: "old" })];
  const incoming = [normalizeProfile({ id: "a", name: "new" })];
  const plan = planProfileMerge({ incoming, existing });
  assert.equal(plan.hasConflicts, true);
  assert.deepEqual(plan.conflictIds, ["a"]);
});

test("planProfileMerge: explicit replace/skip decisions are honored", () => {
  const existing = [normalizeProfile({ id: "a", name: "old" }), normalizeProfile({ id: "b" })];
  const incoming = [normalizeProfile({ id: "a", name: "new" }), normalizeProfile({ id: "b" }), normalizeProfile({ id: "c" })];
  const plan = planProfileMerge({ incoming, existing, decisions: { a: "replace", b: "skip" } });
  assert.deepEqual(plan.ops.map((o) => o.op), ["replace", "skip", "insert"]);
  assert.equal(plan.hasConflicts, false);
});

// ─── Cleanup guardrail ───────────────────────────────────────────────

test("buildCleanupPrompt encodes the no-invention rule", () => {
  const p = buildCleanupPrompt("hello world");
  assert.match(p, /Do NOT add facts/);
  assert.match(p, /punctuation/i);
});

test("isCleanupSuspicious flags large expansions and empty results", () => {
  assert.equal(isCleanupSuspicious("hello", "hello."), false);
  assert.equal(isCleanupSuspicious("hello", ""), true);
  assert.equal(isCleanupSuspicious("hello", "hello world of raven and long invented followup"), true);
});