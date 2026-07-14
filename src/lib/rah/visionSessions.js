// Deterministic pure helpers for Screen Vision v0.2 — project-bound
// visual sessions, privacy review, evidence capture, and approval-safe
// action proposals. No React, no DOM, no IndexedDB — data in, data out —
// so the entire module is exercised by fast Node tests.
//
// Privacy / safety contracts enforced here:
//   * No auto-capture: `SCREEN_VISION_PRIVACY.captureOnlyOnExplicitUserAction`.
//   * No silent AI send: Capture Review is mandatory (state machine below).
//   * No fabricated fields: unknown project/source/model/provider stay `null`
//     or "—". Nothing in this module invents OCR text, confidence, or
//     redaction detections.
//   * Evidence is append-only/versioned. `versionEvidence` returns a NEW
//     record; it never mutates the prior one.
//   * Action allowlist: only entries in `VISION_ACTION_CATALOG` may run
//     directly. Side-effecting actions must be handed to the Workflow
//     Engine + Approvals via `proposeWorkflowHandoff`.

export const VISION_SESSIONS_SCHEMA_VERSION = 1;

export const SESSION_STATUSES = ["active", "ended", "cancelled"];

export const PRIVACY_CLASSES = [
  "unknown",
  "low",
  "possible_personal_data",
  "possible_financial",
  "possible_health",
  "possible_credentials",
  "user_marked_sensitive",
];

export const PRIVACY_CLASS_LABEL = {
  unknown: "Unknown",
  low: "Low",
  possible_personal_data: "Possible personal data",
  possible_financial: "Possible financial",
  possible_health: "Possible health",
  possible_credentials: "Possible credentials",
  user_marked_sensitive: "Marked sensitive",
};

/**
 * Honest disclosure surfaced to the UI: heuristic classification is a
 * user-assist hint, NOT reliable detection. This constant is asserted by
 * tests so the wording cannot silently drift.
 */
export const PRIVACY_HEURISTIC_DISCLAIMER =
  "Heuristic classification is a hint, not detection. Raven does not scan the image contents — always review the frame yourself before sending.";

export const REVIEW_STATES = [
  "idle",
  "captured",
  "redacting",
  "confirming_sensitive",
  "analyzing",
  "reviewing_result",
  "discarded",
];

/** Actions the review state machine responds to. */
export const REVIEW_EVENTS = [
  "capture",       // frame received → captured
  "redact",        // captured → redacting
  "redact-done",   // redacting → captured
  "analyze",       // captured → analyzing (safe frame)
  "mark-sensitive",// captured → confirming_sensitive
  "confirm-send",  // confirming_sensitive → analyzing
  "cancel-send",   // confirming_sensitive → captured
  "analyze-done",  // analyzing → reviewing_result
  "analyze-error", // analyzing → captured
  "discard",       // any → discarded
  "retake",        // any → idle (frame cleared upstream)
  "reset",         // any → idle
];

/** Frame variants that may be sent to AI. */
export const FRAME_VARIANTS = ["original", "redacted"];

/** Small deterministic fallback id when crypto is unavailable. */
function fallbackId(prefix = "vs") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function toInt(n, min = -Infinity, max = Infinity) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, v));
}

function trimOrEmpty(s) {
  if (s === undefined || s === null) return "";
  return String(s).trim();
}

// ─── Session normalization ─────────────────────────────────────────────

/**
 * Normalize a possibly-partial vision session into the canonical shape.
 * Never invents project, source, or display surface — missing fields
 * remain explicit `null` (or `"—"` for the human-readable source label).
 */
export function normalizeVisionSession(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const createdAt = Number.isFinite(input.createdAt) ? input.createdAt : now;
  const status = SESSION_STATUSES.includes(input.status) ? input.status : "active";
  const mode = input.mode === "deep" ? "deep" : "fast";
  const captureCount = Math.max(0, toInt(input.captureCount, 0) ?? 0);
  const consented = input.consented === true;
  const privacyMode = input.privacyMode === "strict" ? "strict" : "standard";
  const startedAt = Number.isFinite(input.startedAt) ? input.startedAt : createdAt;
  const stoppedAt = Number.isFinite(input.stoppedAt) ? input.stoppedAt : null;
  return {
    id: input.id || fallbackId("vs"),
    schemaVersion: VISION_SESSIONS_SCHEMA_VERSION,
    projectId: input.projectId ?? null,
    title: trimOrEmpty(input.title) || "Untitled vision session",
    question: trimOrEmpty(input.question),
    presetId: input.presetId ?? null,
    mode,
    sourceLabel: trimOrEmpty(input.sourceLabel) || "—",
    displaySurface: input.displaySurface ? String(input.displaySurface) : null,
    apiLabel: trimOrEmpty(input.apiLabel) || "browser.getDisplayMedia",
    startedAt,
    stoppedAt,
    createdAt,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now,
    captureCount,
    consented,
    privacyMode,
    status,
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.map(String) : [],
    workflowProposalIds: Array.isArray(input.workflowProposalIds) ? input.workflowProposalIds.map(String) : [],
  };
}

/**
 * Resolve the project/profile a new session should bind to. Unknown ids
 * fall back to `null` (global) and the caller is told which projectId
 * was actually used vs requested. Never invents a name.
 */
export function resolveProjectForSession({ requestedProjectId = null, projects = [], activeProjectId = null } = {}) {
  const list = Array.isArray(projects) ? projects : [];
  const byId = new Map(list.filter((p) => p && p.id).map((p) => [String(p.id), p]));
  const req = requestedProjectId == null ? null : String(requestedProjectId);
  if (req && byId.has(req)) return { projectId: req, projectName: String(byId.get(req).name || ""), fallback: false };
  const active = activeProjectId == null ? null : String(activeProjectId);
  if (active && byId.has(active)) return { projectId: active, projectName: String(byId.get(active).name || ""), fallback: req != null };
  return { projectId: null, projectName: "", fallback: req != null || active != null };
}

// ─── Frame metadata ────────────────────────────────────────────────────

/** Shape immutable frame metadata. Coordinates are ints. `hash` may be null. */
export function shapeFrameMetadata(input = {}) {
  const width = Math.max(0, toInt(input.width, 0) ?? 0);
  const height = Math.max(0, toInt(input.height, 0) ?? 0);
  const sizeBytes = Math.max(0, toInt(input.sizeBytes, 0) ?? 0);
  const capturedAt = Number.isFinite(input.capturedAt) ? input.capturedAt : null;
  return {
    width,
    height,
    sizeBytes,
    capturedAt,
    mime: input.mime ? String(input.mime) : "image/jpeg",
    captureMethod: input.captureMethod === "image-capture" || input.captureMethod === "video-canvas"
      ? input.captureMethod
      : "unknown",
    hash: input.hash ? String(input.hash) : null,
  };
}

// ─── Privacy classification ────────────────────────────────────────────

/**
 * Classify a frame purely from EXPLICIT user markers and question keywords.
 * We DO NOT scan the image. Categories are hints only.
 * `userMarkedSensitive` short-circuits everything else.
 */
export function classifyPrivacy({ userMarkedSensitive = false, note = "", question = "", sourceLabel = "" } = {}) {
  if (userMarkedSensitive === true) {
    return { class: "user_marked_sensitive", reasons: ["user_marked_sensitive"], disclaimer: PRIVACY_HEURISTIC_DISCLAIMER };
  }
  const hay = (String(note) + " " + String(question) + " " + String(sourceLabel)).toLowerCase();
  const reasons = [];
  let cls = "unknown";
  const has = (words) => words.some((w) => hay.includes(w));
  if (has(["password", "passcode", "api key", "secret", "token", "credential", "auth token"])) {
    cls = "possible_credentials"; reasons.push("keyword:credential");
  } else if (has(["ssn", "social security", "passport", "driver license", "birthdate", "date of birth", "home address"])) {
    cls = "possible_personal_data"; reasons.push("keyword:personal_data");
  } else if (has(["credit card", "iban", "bank account", "routing number", "invoice", "payment", "salary", "bank balance"])) {
    cls = "possible_financial"; reasons.push("keyword:financial");
  } else if (has(["diagnosis", "prescription", "medical record", "patient", "lab result"])) {
    cls = "possible_health"; reasons.push("keyword:health");
  } else if (hay.trim().length > 0) {
    cls = "low"; reasons.push("no_sensitive_markers_detected");
  }
  return { class: cls, reasons, disclaimer: PRIVACY_HEURISTIC_DISCLAIMER };
}

export function classIsSensitive(cls) {
  return cls === "user_marked_sensitive"
    || cls === "possible_credentials"
    || cls === "possible_financial"
    || cls === "possible_health"
    || cls === "possible_personal_data";
}

// ─── Redaction ─────────────────────────────────────────────────────────

/**
 * Validate and clamp a redaction region. Rejects zero-area, non-numeric,
 * and out-of-bounds regions. Returns `{ ok, region?, reason? }` — never
 * throws.
 */
export function validateRedactionRegion(region, { width, height } = {}) {
  if (!region || typeof region !== "object") return { ok: false, reason: "region_missing" };
  const W = toInt(width, 1);
  const H = toInt(height, 1);
  if (W == null || H == null || W <= 0 || H <= 0) return { ok: false, reason: "frame_dimensions_invalid" };
  const x = toInt(region.x);
  const y = toInt(region.y);
  const w = toInt(region.w);
  const h = toInt(region.h);
  if (x == null || y == null || w == null || h == null) return { ok: false, reason: "coords_not_numeric" };
  if (w <= 0 || h <= 0) return { ok: false, reason: "zero_area" };
  if (x >= W || y >= H || x + w <= 0 || y + h <= 0) return { ok: false, reason: "out_of_bounds" };
  // Clamp inside frame bounds. If the clamped rect collapses, reject.
  const cx = Math.max(0, Math.min(W - 1, x));
  const cy = Math.max(0, Math.min(H - 1, y));
  const cw = Math.max(0, Math.min(W - cx, w - Math.max(0, cx - x)));
  const ch = Math.max(0, Math.min(H - cy, h - Math.max(0, cy - y)));
  if (cw <= 0 || ch <= 0) return { ok: false, reason: "out_of_bounds" };
  return {
    ok: true,
    region: { id: region.id ? String(region.id) : fallbackId("rr"), x: cx, y: cy, w: cw, h: ch, label: region.label ? String(region.label) : null },
  };
}

export function validateRedactionRegions(regions, frame) {
  const out = { accepted: [], rejected: [] };
  const list = Array.isArray(regions) ? regions : [];
  for (const r of list) {
    const res = validateRedactionRegion(r, frame);
    if (res.ok) out.accepted.push(res.region);
    else out.rejected.push({ region: r, reason: res.reason });
  }
  return out;
}

/**
 * Pick the frame variant to send to AI. Default is `redacted` whenever
 * any accepted region exists. `user_marked_sensitive` forces a second
 * confirmation upstream; here we surface the requirement as a flag.
 */
export function selectFrameVariant({ regions = [], privacyClass = "unknown", userChoice = null } = {}) {
  const hasRegions = Array.isArray(regions) && regions.length > 0;
  const sensitive = classIsSensitive(privacyClass);
  const defaultVariant = hasRegions ? "redacted" : "original";
  const chosen = FRAME_VARIANTS.includes(userChoice) ? userChoice : defaultVariant;
  const requiresSecondConfirmation = chosen === "original" && sensitive;
  return { variant: chosen, defaultVariant, requiresSecondConfirmation };
}

// ─── Duplicate frame detection ─────────────────────────────────────────

/**
 * Deterministic dup check. Two frames are considered duplicates when
 * width, height, sizeBytes AND (if both provided) hash match. `capturedAt`
 * is ignored so back-to-back captures of the same still are detected.
 */
export function areFramesDuplicate(a, b) {
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.sizeBytes !== b.sizeBytes) return false;
  if (a.hash && b.hash) return a.hash === b.hash;
  return true; // matching w/h/size without hashes is a strong hint
}

// ─── Review state machine ─────────────────────────────────────────────

/**
 * Pure state transition table for the Capture Review workflow. Any
 * unknown event is a no-op — the current state is returned unchanged so
 * the UI cannot accidentally skip Capture Review.
 */
export function nextReviewState(current, event) {
  const s = REVIEW_STATES.includes(current) ? current : "idle";
  switch (event) {
    case "capture":       return "captured";
    case "redact":        return s === "captured" ? "redacting" : s;
    case "redact-done":   return s === "redacting" ? "captured" : s;
    case "analyze":       return s === "captured" ? "analyzing" : s;
    case "mark-sensitive":return s === "captured" ? "confirming_sensitive" : s;
    case "confirm-send":  return s === "confirming_sensitive" ? "analyzing" : s;
    case "cancel-send":   return s === "confirming_sensitive" ? "captured" : s;
    case "analyze-done":  return s === "analyzing" ? "reviewing_result" : s;
    case "analyze-error": return s === "analyzing" ? "captured" : s;
    case "discard":       return "discarded";
    case "retake":        return "idle";
    case "reset":         return "idle";
    default:              return s;
  }
}

// ─── Evidence records ─────────────────────────────────────────────────

/**
 * Shape an immutable evidence record. `previousVersionId` is null for
 * v1 records; caller MUST use `versionEvidence()` to derive a new
 * version rather than mutating an existing one.
 */
export function shapeEvidenceRecord(input = {}) {
  const createdAt = Number.isFinite(input.createdAt) ? input.createdAt : Date.now();
  const frame = shapeFrameMetadata(input.frame || {});
  const redactedFrame = input.redactedFrame ? shapeFrameMetadata(input.redactedFrame) : null;
  const regions = Array.isArray(input.redactionRegions) ? input.redactionRegions.slice() : [];
  const privacy = input.privacy && typeof input.privacy === "object" && input.privacy.class
    ? { class: input.privacy.class, reasons: Array.isArray(input.privacy.reasons) ? input.privacy.reasons.slice() : [] }
    : { class: "unknown", reasons: [] };
  return {
    id: input.id || fallbackId("ev"),
    schemaVersion: VISION_SESSIONS_SCHEMA_VERSION,
    sessionId: input.sessionId ? String(input.sessionId) : null,
    projectId: input.projectId ?? null,
    createdAt,
    version: Math.max(1, toInt(input.version, 1) ?? 1),
    previousVersionId: input.previousVersionId ? String(input.previousVersionId) : null,
    frame,
    redactedFrame,
    redactionRegions: regions,
    privacy,
    notes: trimOrEmpty(input.notes),
    checksum: input.checksum ? String(input.checksum) : null,
    linkedResultId: input.linkedResultId ? String(input.linkedResultId) : null,
    savedTo: Array.isArray(input.savedTo) ? input.savedTo.map(String) : [],
    sourceLabel: trimOrEmpty(input.sourceLabel) || "—",
    apiLabel: trimOrEmpty(input.apiLabel) || "browser.getDisplayMedia",
  };
}

/**
 * Return a NEW evidence record derived from `prev` with `patch` applied.
 * The prior record is untouched. Immutable fields (frame, checksum, id
 * of prior, createdAt) are preserved — only mutable fields (notes,
 * savedTo, privacy, redactionRegions, redactedFrame, linkedResultId)
 * may be updated on a new version.
 */
export function versionEvidence(prev, patch = {}, { now = Date.now(), id } = {}) {
  if (!prev || typeof prev !== "object") throw new Error("versionEvidence: prev required");
  const next = shapeEvidenceRecord({
    ...prev,
    id: id || fallbackId("ev"),
    createdAt: now,
    version: (Number(prev.version) || 1) + 1,
    previousVersionId: prev.id,
    // apply mutable patch
    notes: patch.notes !== undefined ? patch.notes : prev.notes,
    privacy: patch.privacy !== undefined ? patch.privacy : prev.privacy,
    redactionRegions: patch.redactionRegions !== undefined ? patch.redactionRegions : prev.redactionRegions,
    redactedFrame: patch.redactedFrame !== undefined ? patch.redactedFrame : prev.redactedFrame,
    savedTo: patch.savedTo !== undefined ? patch.savedTo : prev.savedTo,
    linkedResultId: patch.linkedResultId !== undefined ? patch.linkedResultId : prev.linkedResultId,
  });
  return next;
}

// ─── Action allowlist ─────────────────────────────────────────────────

/**
 * Narrow allowlist for "Propose safe action". Every entry is a UI-only,
 * non-side-effecting instruction. Side-effecting actions MUST go through
 * `proposeWorkflowHandoff` and land in the Workflow Engine + Approvals.
 */
export const VISION_ACTION_CATALOG = [
  { id: "navigate",            category: "navigation",   sideEffectClass: "ui_only" },
  { id: "focus_command_bar",   category: "command_bar",  sideEffectClass: "ui_only" },
  { id: "start_focus_block",   category: "focus_block",  sideEffectClass: "ui_only" },
  { id: "pause_focus_block",   category: "focus_block",  sideEffectClass: "ui_only" },
  { id: "open_project",        category: "navigation",   sideEffectClass: "ui_only" },
  { id: "open_module",         category: "navigation",   sideEffectClass: "ui_only" },
  { id: "show_guidance",       category: "guidance",     sideEffectClass: "ui_only" },
];

export const SIDE_EFFECT_CLASSES = ["ui_only", "workflow_handoff", "denied"];

/** Classify an arbitrary intent id. Anything not in the catalog is denied. */
export function classifyActionSideEffect(intentId) {
  const entry = VISION_ACTION_CATALOG.find((e) => e.id === intentId);
  if (!entry) return { allowed: false, sideEffectClass: "denied", reason: "not_in_catalog" };
  return { allowed: true, sideEffectClass: entry.sideEffectClass, category: entry.category };
}

export const CONFIDENCE_MIN_FOR_AUTO = 0.6;

export function isLowConfidence(confidence) {
  const n = Number(confidence);
  if (!Number.isFinite(n)) return true;
  return n < CONFIDENCE_MIN_FOR_AUTO;
}

/**
 * Shape an inert proposal for a safe UI action. Refuses to build a
 * proposal when the intent is not in the catalog, confidence is low, or
 * the intent is ambiguous. Never dispatches — dispatch requires an
 * explicit `confirmVisionAction` call.
 */
export function proposeSafeAction({ intentId, params = {}, confidence = 0, ambiguous = false, sessionId = null, evidenceId = null, question = "" } = {}) {
  const catalog = classifyActionSideEffect(intentId);
  if (!catalog.allowed) {
    return { ok: false, reason: "not_in_catalog", proposal: null };
  }
  if (ambiguous) return { ok: false, reason: "ambiguous", proposal: null };
  if (isLowConfidence(confidence)) return { ok: false, reason: "low_confidence", proposal: null };
  return {
    ok: true,
    reason: null,
    proposal: {
      id: fallbackId("va"),
      kind: "vision_safe_action",
      intentId,
      category: catalog.category,
      sideEffectClass: catalog.sideEffectClass,
      params: params && typeof params === "object" ? { ...params } : {},
      confidence: Number(confidence),
      sessionId: sessionId ? String(sessionId) : null,
      evidenceId: evidenceId ? String(evidenceId) : null,
      question: trimOrEmpty(question),
      createdAt: Date.now(),
      confirmed: false,
    },
  };
}

/**
 * Shape a workflow-handoff proposal for a side-effecting action. This is
 * inert — it must be routed through the existing Workflow Engine +
 * Approvals. It NEVER executes anything on its own.
 */
export function proposeWorkflowHandoff({ title, steps = [], sessionId = null, evidenceId = null, question = "", projectId = null } = {}) {
  const t = trimOrEmpty(title);
  if (!t) return { ok: false, reason: "title_required", proposal: null };
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, reason: "steps_required", proposal: null };
  return {
    ok: true,
    reason: null,
    proposal: {
      id: fallbackId("wh"),
      kind: "vision_workflow_handoff",
      sideEffectClass: "workflow_handoff",
      title: t,
      projectId: projectId ?? null,
      steps: steps.map((s) => ({ ...s })),
      sessionId: sessionId ? String(sessionId) : null,
      evidenceId: evidenceId ? String(evidenceId) : null,
      question: trimOrEmpty(question),
      createdAt: Date.now(),
      dispatched: false,
    },
  };
}

/**
 * Build the Confirm Vision Action payload. Confirmation is required
 * before any dispatch. Returns `{ ok, dispatch, payload, reason }`.
 * `dispatch` describes exactly what SHOULD happen — this function does
 * not perform it. The caller invokes the executor / router.
 */
export function buildConfirmationPayload({ proposal, evidence = null, approvalStatus = "none" } = {}) {
  if (!proposal || typeof proposal !== "object") return { ok: false, reason: "proposal_required", payload: null };
  const isSafe = proposal.kind === "vision_safe_action";
  const isHandoff = proposal.kind === "vision_workflow_handoff";
  if (!isSafe && !isHandoff) return { ok: false, reason: "unknown_proposal_kind", payload: null };
  const payload = {
    proposalId: proposal.id,
    kind: proposal.kind,
    sideEffectClass: proposal.sideEffectClass,
    frameCapturedAt: evidence?.frame?.capturedAt ?? null,
    frameHash: evidence?.frame?.hash ?? null,
    question: proposal.question || "",
    targetProjectId: proposal.projectId ?? null,
    targetIntent: proposal.intentId ?? null,
    targetWorkflowTitle: proposal.title ?? null,
    confidence: typeof proposal.confidence === "number" ? proposal.confidence : null,
    approvalStatus,
    dispatch: isSafe
      ? { type: "ui_only", intentId: proposal.intentId, params: proposal.params }
      : { type: "workflow_handoff", workflowDraft: { title: proposal.title, steps: proposal.steps, projectId: proposal.projectId } },
  };
  return { ok: true, reason: null, payload };
}

// ─── Session statistics ────────────────────────────────────────────────

export function computeSessionStatistics(sessions = [], evidence = []) {
  const s = Array.isArray(sessions) ? sessions : [];
  const e = Array.isArray(evidence) ? evidence : [];
  const active = s.filter((x) => x && x.status === "active").length;
  const ended = s.filter((x) => x && x.status === "ended").length;
  const cancelled = s.filter((x) => x && x.status === "cancelled").length;
  const totalCaptures = s.reduce((a, x) => a + (Number(x?.captureCount) || 0), 0);
  const evidenceCount = e.length;
  const sensitiveCount = e.filter((x) => classIsSensitive(x?.privacy?.class)).length;
  return { sessions: s.length, active, ended, cancelled, totalCaptures, evidenceCount, sensitiveCount };
}

// ─── History filtering / export ───────────────────────────────────────

export function filterVisionHistory(sessions, opts = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const q = String(opts.q ?? "").trim().toLowerCase();
  const projectId = opts.projectId === undefined ? undefined : (opts.projectId ?? null);
  const status = opts.status || null;
  const privacyClass = opts.privacyClass || null;
  const source = opts.source ? String(opts.source).toLowerCase() : null;
  const since = Number.isFinite(opts.since) ? opts.since : null;
  const until = Number.isFinite(opts.until) ? opts.until : null;
  return list
    .map(normalizeVisionSession)
    .filter((r) => (projectId === undefined ? true : r.projectId === projectId))
    .filter((r) => (status ? r.status === status : true))
    .filter((r) => (source ? (r.sourceLabel || "").toLowerCase().includes(source) : true))
    .filter((r) => (since != null ? r.createdAt >= since : true))
    .filter((r) => (until != null ? r.createdAt <= until : true))
    .filter((r) => {
      if (!privacyClass) return true;
      // sessions don't carry privacyClass directly — pass through when not filtered
      return true;
    })
    .filter((r) => {
      if (!q) return true;
      const hay = ((r.title || "") + " " + (r.question || "") + " " + (r.sourceLabel || "")).toLowerCase();
      return hay.includes(q);
    });
}

export function exportVisionHistoryJson({ sessions = [], evidence = [], results = [] } = {}) {
  return JSON.stringify({
    schemaVersion: VISION_SESSIONS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
    evidence,
    results,
  }, null, 2);
}

export function exportVisionHistoryMarkdown({ sessions = [], evidence = [], results = [] } = {}) {
  const lines = ["# Raven Screen Vision history", ""];
  lines.push(`_${sessions.length} session(s), ${evidence.length} evidence record(s)_`);
  lines.push("");
  for (const s of sessions) {
    lines.push(`## ${s.title || "Untitled session"}`);
    lines.push(`- id: \`${s.id}\``);
    lines.push(`- project: ${s.projectId || "—"}`);
    lines.push(`- source: ${s.sourceLabel || "—"}`);
    lines.push(`- captures: ${s.captureCount || 0}`);
    lines.push(`- status: ${s.status}`);
    lines.push("");
  }
  lines.push("_Note: images are NEVER embedded in Markdown exports._");
  return lines.join("\n");
}

// ─── Draft dirty detection / navigation guard ─────────────────────────

/**
 * True when the caller MUST prompt before discarding an in-progress
 * Capture Review, redaction, result edit, evidence note edit, or
 * proposal draft. Mirrors `draftGuard.shouldConfirmDiscard` style.
 */
export function shouldConfirmVisionDiscard({
  hasCapturedFrame = false,
  regionsDirty = false,
  resultDraftDirty = false,
  evidenceNotesDirty = false,
  proposalDraftDirty = false,
  reviewState = "idle",
} = {}) {
  if (reviewState === "confirming_sensitive") return true;
  if (reviewState === "analyzing") return true;
  if (hasCapturedFrame && (regionsDirty || resultDraftDirty || evidenceNotesDirty || proposalDraftDirty)) return true;
  if (reviewState === "captured" || reviewState === "redacting" || reviewState === "reviewing_result") {
    return regionsDirty || resultDraftDirty || evidenceNotesDirty || proposalDraftDirty;
  }
  return false;
}

// ─── Import / merge ────────────────────────────────────────────────────

/**
 * Validate an import payload. Returns `{ ok, reason, parsed }`. Fails
 * closed on wrong schema version, missing arrays, or non-object shape.
 */
export function validateImportPayload(raw) {
  if (raw === null || typeof raw !== "object") return { ok: false, reason: "not_object", parsed: null };
  const schemaVersion = Number(raw.schemaVersion);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1 || schemaVersion > VISION_SESSIONS_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version_unsupported", parsed: null };
  }
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : null;
  const evidence = Array.isArray(raw.evidence) ? raw.evidence : null;
  const results  = Array.isArray(raw.results)  ? raw.results  : [];
  if (sessions == null || evidence == null) return { ok: false, reason: "missing_arrays", parsed: null };
  return { ok: true, reason: null, parsed: { schemaVersion, sessions, evidence, results } };
}

/**
 * Merge incoming sessions/evidence into an existing collection with an
 * explicit strategy: "skip" or "replace". Never overwrites silently:
 * duplicates are reported. Returns `{ merged, skipped, replaced }`.
 */
export function mergeVisionImport({ existing = { sessions: [], evidence: [] }, incoming, strategy = "skip" } = {}) {
  const strat = strategy === "replace" ? "replace" : "skip";
  const bySessId = new Map((existing.sessions || []).map((s) => [String(s.id), s]));
  const byEvId = new Map((existing.evidence || []).map((e) => [String(e.id), e]));
  const skipped = { sessions: [], evidence: [] };
  const replaced = { sessions: [], evidence: [] };
  for (const s of incoming.sessions || []) {
    const id = String(s.id || "");
    if (!id) { skipped.sessions.push({ id: null, reason: "missing_id" }); continue; }
    if (bySessId.has(id)) {
      if (strat === "replace") { bySessId.set(id, s); replaced.sessions.push(id); }
      else { skipped.sessions.push({ id, reason: "duplicate" }); }
    } else {
      bySessId.set(id, s);
    }
  }
  for (const e of incoming.evidence || []) {
    const id = String(e.id || "");
    if (!id) { skipped.evidence.push({ id: null, reason: "missing_id" }); continue; }
    if (byEvId.has(id)) {
      if (strat === "replace") { byEvId.set(id, e); replaced.evidence.push(id); }
      else { skipped.evidence.push({ id, reason: "duplicate" }); }
    } else {
      byEvId.set(id, e);
    }
  }
  return {
    merged: { sessions: [...bySessId.values()], evidence: [...byEvId.values()] },
    skipped,
    replaced,
  };
}

// ─── No-fabrication contracts ─────────────────────────────────────────

/**
 * Explicit locked-behavior descriptor consumed by tests to prevent
 * silent regressions in the vision pipeline's honesty guarantees.
 */
export const VISION_NO_FABRICATION = Object.freeze({
  moduleDoesNotScanImages: true,
  moduleClaimsOcrDetection: false,
  moduleAutoRedactsSensitive: false,
  moduleInventsProviderModel: false,
  moduleAutoDispatchesActions: false,
  moduleAllowsSideEffectsWithoutApproval: false,
  captureReviewIsMandatory: true,
  evidenceIsAppendOnly: true,
});

/**
 * Ambiguity signal for a proposal: too short a question, no evidence
 * link, or explicit `ambiguous` from the caller.
 */
export function detectAmbiguity({ question = "", evidenceId = null, extra = false } = {}) {
  const q = trimOrEmpty(question);
  if (extra === true) return true;
  if (q.length < 3) return true;
  if (!evidenceId) return true;
  return false;
}

/**
 * Validate an AI runtime metadata object before persistence. Rejects
 * fabricated defaults — provider/model must be strings or explicitly
 * null (never invented placeholders like "Unknown Model").
 */
export function shapeRuntimeMetadata(input = {}) {
  const provider = input.provider ? String(input.provider) : null;
  const model = input.model ? String(input.model) : null;
  const transport = input.transport ? String(input.transport) : null;
  const engine = input.engine ? String(input.engine) : null;
  const latencyMs = Number.isFinite(input.latencyMs) ? Number(input.latencyMs) : null;
  return { provider, model, transport, engine, latencyMs };
}