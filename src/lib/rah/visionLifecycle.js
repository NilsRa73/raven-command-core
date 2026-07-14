// Screen Vision v0.3 — deterministic pure helpers for session lifecycle,
// immutable result versioning, hash-result shaping, storage choice,
// confirmation dispatch gating, destination receipts, cross-artifact
// history filtering, and import-apply planning.
//
// All exports are pure: given the same input they return the same output,
// never throw on user input, and never fabricate hashes, timestamps, or
// destinations. The React UI is a thin renderer over these helpers.

// ─── Session lifecycle ────────────────────────────────────────────────

export const LIFECYCLE_STATUSES = Object.freeze(["active", "ended", "cancelled"]);

function clampStatus(s) {
  return LIFECYCLE_STATUSES.includes(s) ? s : "active";
}
function nowOr(n) { const v = Number(n); return Number.isFinite(v) ? v : Date.now(); }
function nonEmptyString(s) { const v = String(s ?? "").trim(); return v || null; }

/**
 * Explicit session start. Requires an explicit projectId choice (may be
 * `null` meaning "no project" but must be provided) plus consent + source.
 * Returns `{ ok, reason, session }`.
 */
export function startSession({ id, projectId, sourceLabel, displaySurface, consented, apiLabel, mode, question, now } = {}) {
  if (!id) return { ok: false, reason: "missing_id", session: null };
  if (projectId === undefined) return { ok: false, reason: "project_choice_required", session: null };
  if (!consented) return { ok: false, reason: "consent_required", session: null };
  if (!nonEmptyString(sourceLabel)) return { ok: false, reason: "source_required", session: null };
  const t = nowOr(now);
  return {
    ok: true, reason: null,
    session: {
      id: String(id),
      projectId: projectId ?? null,
      sourceLabel: String(sourceLabel).trim(),
      displaySurface: nonEmptyString(displaySurface),
      apiLabel: nonEmptyString(apiLabel) || "getDisplayMedia",
      mode: mode === "deep" ? "deep" : "fast",
      question: String(question ?? ""),
      consented: true,
      status: "active",
      startedAt: t,
      updatedAt: t,
      stoppedAt: null,
      captureCount: 0,
      evidenceIds: [],
    },
  };
}

/** Increment capture count. Only on REAL capture success. Never negative. */
export function incrementCaptureCount(session, { now } = {}) {
  if (!session) return session;
  if (session.status !== "active") return session; // capture only counts on active session
  const next = Math.max(0, Number(session.captureCount) || 0) + 1;
  return { ...session, captureCount: next, updatedAt: nowOr(now) };
}

export function endSession(session, { reason = "user_ended", now } = {}) {
  if (!session) return session;
  if (session.status !== "active") return session;
  return { ...session, status: "ended", stoppedAt: nowOr(now), updatedAt: nowOr(now), endReason: String(reason) };
}

export function cancelSession(session, { reason = "user_cancelled", now } = {}) {
  if (!session) return session;
  if (session.status !== "active") return session;
  return { ...session, status: "cancelled", stoppedAt: nowOr(now), updatedAt: nowOr(now), endReason: String(reason) };
}

/** True if the session is still live (blocks navigation without confirm). */
export function isSessionLive(session) {
  return !!(session && clampStatus(session.status) === "active");
}

// ─── Hash result shaping ──────────────────────────────────────────────

/**
 * Normalize the result of hashing a frame's exact bytes. Never fabricates.
 * If `hash` is missing/invalid, records `failureReason` and null values.
 */
export function shapeHashResult({ hash, algorithm, bytes, byteLength, failureReason, hashedAt } = {}) {
  const bl = Number.isFinite(byteLength) ? Math.max(0, byteLength | 0)
    : (bytes && Number.isFinite(bytes.byteLength) ? bytes.byteLength : null);
  const h = typeof hash === "string" && hash.length > 0 ? hash : null;
  const alg = h ? (algorithm || "sha256") : null;
  return {
    hash: h,
    algorithm: alg,
    byteLength: bl,
    hashedAt: h ? nowOr(hashedAt) : null,
    failureReason: h ? null : (nonEmptyString(failureReason) || "hash_unavailable"),
  };
}

// ─── Storage choice ───────────────────────────────────────────────────

/**
 * Evidence storage decision. Metadata-only by default; caller must
 * explicitly opt in to store the image bytes locally.
 */
export function chooseEvidenceStorage({ includeImage = false, hasImageBytes = false } = {}) {
  if (!includeImage) {
    return { storeImage: false, mode: "metadata_only", warning: "image_will_not_be_reopenable" };
  }
  if (!hasImageBytes) {
    return { storeImage: false, mode: "metadata_only", warning: "no_image_bytes_available" };
  }
  return { storeImage: true, mode: "image_bundled", warning: null };
}

// ─── Immutable result versioning ──────────────────────────────────────

/**
 * Create the initial result record capturing IMMUTABLE raw model output.
 * Subsequent user edits create new version records (see createResultVersion),
 * never mutating the raw text.
 */
export function createResult({
  id, sessionId, evidenceId, projectId, question, rawText, provider, model,
  transport, engine, latencyMs, variantSent, mode, frameHash, frameCapturedAt, now,
} = {}) {
  if (!id) return null;
  const t = nowOr(now);
  return {
    id: String(id),
    sessionId: sessionId ?? null,
    evidenceId: evidenceId ?? null,
    projectId: projectId ?? null,
    createdAt: t,
    updatedAt: t,
    question: String(question ?? ""),
    rawText: String(rawText ?? ""),
    provider: nonEmptyString(provider),
    model: nonEmptyString(model),
    transport: nonEmptyString(transport),
    engine: nonEmptyString(engine),
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    variantSent: variantSent === "redacted" ? "redacted" : "original",
    mode: mode === "deep" ? "deep" : "fast",
    frameHash: nonEmptyString(frameHash),
    frameCapturedAt: Number.isFinite(frameCapturedAt) ? frameCapturedAt : null,
    version: 1,
    previousVersionId: null,
  };
}

/**
 * Append a new version. Preserves rawText and provenance from the head
 * unchanged; only `editedText`, `editedBy`, and metadata bump.
 */
export function createResultVersion(prev, { id, editedText, editedBy, now } = {}) {
  if (!prev || !id) return null;
  const t = nowOr(now);
  return {
    ...prev,
    id: String(id),
    previousVersionId: prev.id,
    version: (Number(prev.version) || 1) + 1,
    createdAt: t,
    updatedAt: t,
    editedText: String(editedText ?? ""),
    editedBy: nonEmptyString(editedBy) || "user",
  };
}

/** Build an ordered version chain from a flat list. Head first (v1). */
export function buildResultChain(results, headId) {
  if (!Array.isArray(results) || !headId) return [];
  const byId = new Map(results.map((r) => [r.id, r]));
  const head = byId.get(headId);
  if (!head) return [];
  // Walk forward: find children where previousVersionId === current.id.
  const chain = [head];
  let cursor = head;
  const seen = new Set([head.id]);
  while (true) {
    const next = results.find((r) => r.previousVersionId === cursor.id && !seen.has(r.id));
    if (!next) break;
    chain.push(next); seen.add(next.id); cursor = next;
  }
  return chain;
}

// ─── Destination receipts ─────────────────────────────────────────────

export const SAVE_DESTINATIONS = Object.freeze([
  "project_memory", "chronicle", "evidence_version", "command_center",
  "workflow_proposal", "safe_action_proposal", "clipboard",
]);

export function shapeSaveReceipt({ destination, id, at, meta } = {}) {
  const dest = SAVE_DESTINATIONS.includes(destination) ? destination : null;
  if (!dest) return { ok: false, reason: "unknown_destination", receipt: null };
  return {
    ok: true, reason: null,
    receipt: {
      destination: dest,
      id: id ? String(id) : null,
      at: nowOr(at),
      meta: meta && typeof meta === "object" ? { ...meta } : null,
    },
  };
}

// ─── Confirmation dispatch gate ───────────────────────────────────────

/**
 * Enforces: UI-only allowlisted actions may only dispatch AFTER explicit
 * user confirmation. Workflow proposals are ALWAYS handed off inert
 * regardless of confirmation.
 */
export function canDispatchProposal({ proposal, confirmed } = {}) {
  if (!proposal || typeof proposal !== "object") return { ok: false, reason: "missing_proposal", action: "none" };
  const cls = proposal.sideEffectClass;
  if (cls === "denied") return { ok: false, reason: "denied_action", action: "none" };
  if (cls === "workflow_handoff") return { ok: true, reason: null, action: "handoff_inert" };
  if (cls === "ui_only") {
    if (!confirmed) return { ok: false, reason: "confirmation_required", action: "none" };
    return { ok: true, reason: null, action: "dispatch_ui_only" };
  }
  return { ok: false, reason: "unknown_side_effect_class", action: "none" };
}

// ─── Extended cross-artifact history filter ──────────────────────────

function tokenMatches(hay, needle) {
  if (!needle) return true;
  const q = String(needle).toLowerCase().trim();
  if (!q) return true;
  return String(hay || "").toLowerCase().includes(q);
}

export function filterVisionArtifacts({ sessions = [], evidence = [], results = [] } = {}, opts = {}) {
  const {
    q, projectId, status, privacyClass, source, since, until,
  } = opts || {};
  const inRange = (t) => {
    if (!Number.isFinite(t)) return true;
    if (Number.isFinite(since) && t < since) return false;
    if (Number.isFinite(until) && t > until) return false;
    return true;
  };

  const filteredSessions = sessions.filter((s) => {
    if (!s) return false;
    if (projectId != null && s.projectId !== projectId) return false;
    if (status && s.status !== status) return false;
    if (source && !tokenMatches(s.sourceLabel, source)) return false;
    if (!inRange(Number(s.startedAt) || 0)) return false;
    if (q && !(tokenMatches(s.title, q) || tokenMatches(s.question, q) || tokenMatches(s.sourceLabel, q))) return false;
    return true;
  });

  const sessionIdSet = new Set(filteredSessions.map((s) => s.id));

  const filteredEvidence = evidence.filter((e) => {
    if (!e) return false;
    if (e.sessionId && !sessionIdSet.has(e.sessionId)) return false;
    if (projectId != null && (e.projectId ?? null) !== projectId) return false;
    if (privacyClass && (e.privacy?.class || "unknown") !== privacyClass) return false;
    if (!inRange(Number(e.createdAt) || 0)) return false;
    if (q && !(tokenMatches(e.notes, q) || tokenMatches(e.sourceLabel, q))) return false;
    return true;
  });

  const evidenceIdSet = new Set(filteredEvidence.map((e) => e.id));

  const filteredResults = results.filter((r) => {
    if (!r) return false;
    if (r.sessionId && !sessionIdSet.has(r.sessionId)) return false;
    if (r.evidenceId && !evidenceIdSet.has(r.evidenceId)) return false;
    if (projectId != null && (r.projectId ?? null) !== projectId) return false;
    if (!inRange(Number(r.createdAt) || 0)) return false;
    if (q && !(tokenMatches(r.question, q) || tokenMatches(r.rawText, q) || tokenMatches(r.editedText, q))) return false;
    return true;
  });

  return { sessions: filteredSessions, evidence: filteredEvidence, results: filteredResults };
}

// ─── Import apply planner ─────────────────────────────────────────────

/**
 * Plan how to apply an import. Detects duplicate ids and hash collisions.
 * For each incoming item marks: create | replace | skip. Never mutates.
 * `conflictActions` lets the UI override per-id: { [id]: "replace"|"skip" }.
 */
export function planImportApply({ existing = {}, incoming = {}, conflictActions = {} } = {}) {
  const existingSessions = new Map((existing.sessions || []).map((s) => [s.id, s]));
  const existingEvidence = new Map((existing.evidence || []).map((e) => [e.id, e]));
  const existingHashes = new Map();
  for (const e of (existing.evidence || [])) {
    const h = e?.frame?.hash;
    if (h) existingHashes.set(String(h).toLowerCase().replace(/^sha256:/, ""), e.id);
  }

  const plan = { sessions: [], evidence: [], conflicts: [] };

  for (const s of (incoming.sessions || [])) {
    if (!s || !s.id) { plan.sessions.push({ id: null, action: "skip", reason: "missing_id" }); continue; }
    const conflict = existingSessions.has(s.id);
    const action = conflict ? (conflictActions[s.id] === "replace" ? "replace" : "skip") : "create";
    if (conflict) plan.conflicts.push({ kind: "session", id: s.id, reason: "duplicate_id" });
    plan.sessions.push({ id: s.id, action, reason: conflict ? "duplicate_id" : null });
  }
  for (const e of (incoming.evidence || [])) {
    if (!e || !e.id) { plan.evidence.push({ id: null, action: "skip", reason: "missing_id" }); continue; }
    const dupId = existingEvidence.has(e.id);
    const incomingHash = e?.frame?.hash ? String(e.frame.hash).toLowerCase().replace(/^sha256:/, "") : null;
    const hashClash = incomingHash && existingHashes.has(incomingHash) && existingHashes.get(incomingHash) !== e.id;
    const conflict = dupId || hashClash;
    const reason = dupId ? "duplicate_id" : (hashClash ? "hash_collision" : null);
    const action = conflict ? (conflictActions[e.id] === "replace" ? "replace" : "skip") : "create";
    if (conflict) plan.conflicts.push({ kind: "evidence", id: e.id, reason });
    plan.evidence.push({ id: e.id, action, reason });
  }
  return plan;
}

// ─── Discard/unload guard ─────────────────────────────────────────────

/**
 * Combined navigation guard: prompt on unload/switch if a live session
 * exists or the review has unsaved drafts.
 */
export function shouldConfirmVisionExit({ session, resultDraftDirty, regionsDirty, evidenceNotesDirty } = {}) {
  if (isSessionLive(session)) return true;
  if (resultDraftDirty || regionsDirty || evidenceNotesDirty) return true;
  return false;
}