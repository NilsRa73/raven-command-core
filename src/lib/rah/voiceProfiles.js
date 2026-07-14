// Deterministic pure helpers for Voice v0.2 — per-project voice profiles,
// wake-phrase tuning, transcript review, and approval-safe voice command
// intent proposals. No React, no DOM, no IndexedDB — data in, data out —
// so the entire module is exercised by Node tests.
//
// Privacy / safety contracts enforced here:
//   * No hidden defaults: unknown-project lookups fall back to a global
//     profile and expose that fallback in `resolveProfileForProject`.
//   * No silent execution: `proposeVoiceCommand` returns an inert proposal
//     that the UI must confirm before dispatch.
//   * No silent persistence: draft dirty detection surfaces every edit.
//   * Command allowlist: only entries in `VOICE_COMMAND_CATALOG` may be
//     proposed. Bridge/file/URL/launch actions are NOT in the catalog and
//     must go through the existing Workflow Engine + approvals.

// ─── Constants ─────────────────────────────────────────────────────────

export const GLOBAL_PROFILE_ID = "__global__";
export const VOICE_PROFILES_SCHEMA_VERSION = 1;

export const CONFIDENCE_BOUNDS = { min: 0, max: 1 };
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
export const LOW_CONFIDENCE_THRESHOLD = 0.45;

export const ALLOWED_COMMAND_CATEGORIES = [
  "navigation",
  "focus_block",
  "command_bar",
  "mode_toggle",
  "workflow_proposal",
];

/** Deterministic id fallback so tests do not depend on crypto. */
function fallbackId(prefix = "vp") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return DEFAULT_CONFIDENCE_THRESHOLD;
  return Math.max(CONFIDENCE_BOUNDS.min, Math.min(CONFIDENCE_BOUNDS.max, n));
}

// ─── Profile normalization ─────────────────────────────────────────────

/**
 * Normalize a possibly-partial profile record into the canonical shape.
 * Never invents a project, language, wake phrase, or device — missing
 * fields become explicit nulls or documented defaults.
 */
export function normalizeProfile(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : (Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now());
  const createdAt = Number.isFinite(input.createdAt) ? input.createdAt : now;
  const wakePhrase = normalizeWakePhrase(input.wakePhrase);
  const alternates = Array.isArray(input.alternatePhrases)
    ? input.alternatePhrases.map(normalizeWakePhrase).filter((p) => p.length > 0)
    : [];
  // De-duplicate alternates while preserving order.
  const seen = new Set(wakePhrase ? [wakePhrase] : []);
  const alternatePhrases = [];
  for (const p of alternates) {
    if (seen.has(p)) continue;
    seen.add(p);
    alternatePhrases.push(p);
  }
  const allowedCategories = Array.isArray(input.allowedCommandCategories)
    ? input.allowedCommandCategories.filter((c) => ALLOWED_COMMAND_CATEGORIES.includes(c))
    : [...ALLOWED_COMMAND_CATEGORIES];
  return {
    id: input.id || fallbackId("vp"),
    schemaVersion: VOICE_PROFILES_SCHEMA_VERSION,
    projectId: input.projectId ?? null,
    name: (input.name && String(input.name).trim()) || (input.projectId ? "Project profile" : "Global default"),
    locale: normalizeLocale(input.locale),
    wakePhrase: wakePhrase || "raven",
    alternatePhrases,
    wakeConfidenceThreshold: clamp01(input.wakeConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD),
    pushToTalk: input.pushToTalk !== false,
    continuousListening: input.continuousListening === true,
    autoStopSilenceMs: Number.isFinite(input.autoStopSilenceMs) && input.autoStopSilenceMs >= 0
      ? Math.floor(input.autoStopSilenceMs)
      : 2500,
    preferredInputDeviceId: input.preferredInputDeviceId ? String(input.preferredInputDeviceId) : null,
    preferredInputDeviceLabel: input.preferredInputDeviceLabel ? String(input.preferredInputDeviceLabel) : null,
    defaultMode: input.defaultMode === "deep" ? "deep" : "fast",
    allowedCommandCategories: allowedCategories,
    enabled: input.enabled !== false,
    source: input.source ? String(input.source) : "user",
    createdAt,
    updatedAt: now,
  };
}

export function normalizeLocale(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "en-US";
  // Accept BCP-47-ish tokens like "en", "en-US", "nb-NO".
  const m = raw.match(/^([a-zA-Z]{2,3})(?:[-_]([a-zA-Z]{2,4}))?$/);
  if (!m) return "en-US";
  const lang = m[1].toLowerCase();
  const region = m[2] ? m[2].toUpperCase() : null;
  return region ? `${lang}-${region}` : lang;
}

export function normalizeWakePhrase(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidProfile(input) {
  if (!input || typeof input !== "object") return false;
  if (!input.id || typeof input.id !== "string") return false;
  if (input.wakePhrase && typeof input.wakePhrase !== "string") return false;
  return true;
}

/** Build the always-present global default profile. Deterministic id. */
export function buildGlobalDefaultProfile(now = Date.now()) {
  return normalizeProfile({
    id: GLOBAL_PROFILE_ID,
    projectId: null,
    name: "Global default",
    locale: "en-US",
    wakePhrase: "raven",
    alternatePhrases: ["hey raven"],
    wakeConfidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    pushToTalk: true,
    continuousListening: false,
    autoStopSilenceMs: 2500,
    defaultMode: "fast",
    enabled: true,
    source: "default",
    createdAt: now,
    updatedAt: now,
  });
}

// ─── Project profile resolution ───────────────────────────────────────

/**
 * Deterministic project → profile lookup. Never silently invents a match.
 * Returns `{ profile, matchedBy: "project"|"global_fallback"|"none", fallback: boolean }`.
 */
export function resolveProfileForProject(projectId, profiles = [], globalDefault = buildGlobalDefaultProfile()) {
  const list = Array.isArray(profiles) ? profiles.filter(isValidProfile) : [];
  const enabled = list.filter((p) => p.enabled !== false);
  const projectHit = projectId
    ? enabled.find((p) => p.projectId === projectId)
    : null;
  if (projectHit) return { profile: projectHit, matchedBy: "project", fallback: false };
  const globalHit = enabled.find((p) => p.projectId == null && p.id !== GLOBAL_PROFILE_ID);
  if (globalHit) return { profile: globalHit, matchedBy: "global_fallback", fallback: true };
  if (globalDefault) return { profile: globalDefault, matchedBy: "global_fallback", fallback: true };
  return { profile: null, matchedBy: "none", fallback: true };
}

// ─── Wake phrase matching ─────────────────────────────────────────────

/**
 * Deterministic exact / prefix / token-similarity wake match. Returns a
 * scored result the UI renders verbatim in the tester ("this is exactly
 * why it matched or failed"). No hidden heuristics.
 */
export function matchWakePhrase(transcript, profile) {
  const raw = String(transcript ?? "");
  const normalized = normalizeWakePhrase(raw);
  const threshold = clamp01(profile?.wakeConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);
  if (!normalized) {
    return { matched: false, reason: "empty_transcript", score: 0, threshold, phrase: null, method: "none", command: "" };
  }
  const phrases = [profile?.wakePhrase, ...(profile?.alternatePhrases ?? [])]
    .map((p) => normalizeWakePhrase(p))
    .filter((p) => p.length > 0);
  if (phrases.length === 0) {
    return { matched: false, reason: "no_phrases_configured", score: 0, threshold, phrase: null, method: "none", command: "" };
  }
  let best = { score: 0, phrase: null, method: "none", command: "" };
  for (const phrase of phrases) {
    // Exact utterance == the phrase itself
    if (normalized === phrase) {
      const cand = { score: 1, phrase, method: "exact", command: "" };
      if (cand.score > best.score) best = cand;
      continue;
    }
    if (normalized.startsWith(phrase + " ")) {
      const cand = { score: 0.95, phrase, method: "prefix", command: normalized.slice(phrase.length + 1) };
      if (cand.score > best.score) best = cand;
      continue;
    }
    // Token similarity across the first token window matching the phrase length.
    const phraseTokens = phrase.split(" ");
    const utterTokens = normalized.split(" ");
    const window = utterTokens.slice(0, phraseTokens.length).join(" ");
    const sim = tokenSimilarity(window, phrase);
    if (sim > best.score) {
      best = {
        score: sim,
        phrase,
        method: "similarity",
        command: utterTokens.slice(phraseTokens.length).join(" "),
      };
    }
  }
  const matched = best.score >= threshold && best.phrase != null;
  return {
    matched,
    reason: matched ? "match" : (best.phrase ? "below_threshold" : "no_match"),
    score: Number(best.score.toFixed(4)),
    threshold,
    phrase: best.phrase,
    method: best.method,
    command: best.command,
    normalizedTranscript: normalized,
  };
}

/** Very small deterministic token similarity: 2×|A∩B| / (|A|+|B|). */
function tokenSimilarity(a, b) {
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter += 1;
  return (2 * inter) / (at.size + bt.size);
}

// ─── Transcript shaping ───────────────────────────────────────────────

/**
 * Turn a raw speech-recognition result into the review record shape.
 * Never sends anywhere — the UI decides what happens next.
 */
export function buildTranscriptReview(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const raw = String(input.raw ?? "");
  const normalized = normalizeTranscript(raw);
  const segments = segmentTranscript(raw);
  return {
    id: input.id || fallbackId("vt"),
    schemaVersion: VOICE_PROFILES_SCHEMA_VERSION,
    createdAt: now,
    projectId: input.projectId ?? null,
    profileId: input.profileId ?? null,
    sourceApi: input.sourceApi || "browser.SpeechRecognition",
    locale: input.locale ? normalizeLocale(input.locale) : null,
    confidence: Number.isFinite(input.confidence) ? clamp01(input.confidence) : null,
    rawText: raw,
    normalizedText: normalized,
    editedText: null,
    segments,
    wakeMatch: input.wakeMatch ?? null,
    // review lifecycle
    status: "review",  // review | discarded | saved | prompt_sent | proposed | confirmed
    saveDestination: null,
    proposalId: null,
    confirmationId: null,
  };
}

export function normalizeTranscript(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Deterministic sentence-ish segmentation. Splits on ., !, ? and hard
 * line breaks. Empty input returns an empty array.
 */
export function segmentTranscript(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const parts = s.split(/(?<=[.!?])\s+|\n+/g)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts;
}

/** Detect a near-duplicate against a small recent history window. */
export function isDuplicateTranscript(candidate, history = [], windowMs = 5 * 60_000, now = Date.now()) {
  const norm = normalizeTranscript(candidate?.rawText ?? candidate).toLowerCase();
  if (!norm) return false;
  for (const prev of history) {
    if (!prev) continue;
    const prevAt = Number.isFinite(prev.createdAt) ? prev.createdAt : 0;
    if (now - prevAt > windowMs) continue;
    const prevNorm = normalizeTranscript(prev.rawText ?? prev).toLowerCase();
    if (prevNorm && prevNorm === norm) return true;
  }
  return false;
}

// ─── Voice command catalog + intent proposal ──────────────────────────

/**
 * The ONLY commands the voice pipeline may propose. Side-effecting entries
 * that touch the desktop, filesystem, or network are deliberately absent —
 * they must go through the Workflow Engine + approvals.
 */
export const VOICE_COMMAND_CATALOG = [
  { id: "nav.home",         category: "navigation",        title: "Open Raven Home",       action: { type: "navigate", to: "/" },            phrases: ["open home", "go home", "raven home", "dashboard"], sideEffect: "ui_only" },
  { id: "nav.projects",     category: "navigation",        title: "Open Projects",         action: { type: "navigate", to: "/projects" },    phrases: ["open projects", "show projects"], sideEffect: "ui_only" },
  { id: "nav.chronicle",    category: "navigation",        title: "Open Chronicle",        action: { type: "navigate", to: "/chronicle" },   phrases: ["open chronicle", "show chronicle", "timeline"], sideEffect: "ui_only" },
  { id: "nav.memory",       category: "navigation",        title: "Open Project Memory",   action: { type: "navigate", to: "/memory" },      phrases: ["open memory", "project memory"], sideEffect: "ui_only" },
  { id: "nav.automations",  category: "navigation",        title: "Open Automations",      action: { type: "navigate", to: "/automations" }, phrases: ["open automations", "workflows"], sideEffect: "ui_only" },
  { id: "nav.devices",      category: "navigation",        title: "Open Device Center",    action: { type: "navigate", to: "/devices" },     phrases: ["open devices", "device center"], sideEffect: "ui_only" },
  { id: "focus.start",      category: "focus_block",       title: "Start focus block",     action: { type: "event", event: "rah:focus:start" },    phrases: ["start focus", "start focus block", "begin focus"], sideEffect: "ui_only" },
  { id: "focus.pause",      category: "focus_block",       title: "Pause / resume focus",  action: { type: "event", event: "rah:focus:pause" },    phrases: ["pause focus", "resume focus"], sideEffect: "ui_only" },
  { id: "focus.complete",   category: "focus_block",       title: "Complete focus block",  action: { type: "event", event: "rah:focus:complete" }, phrases: ["complete focus", "finish focus", "end focus"], sideEffect: "ui_only" },
  { id: "focus.cancel",     category: "focus_block",       title: "Cancel focus block",    action: { type: "event", event: "rah:focus:cancel" },   phrases: ["cancel focus", "abort focus"], sideEffect: "ui_only" },
  { id: "cmd.focus_bar",    category: "command_bar",       title: "Focus command bar",     action: { type: "event", event: "rah:command_bar:focus" }, phrases: ["focus command bar", "focus command", "focus the prompt"], sideEffect: "ui_only" },
  { id: "mode.fast",        category: "mode_toggle",       title: "Switch to Fast mode",   action: { type: "event", event: "rah:mode:set", payload: { mode: "fast" } }, phrases: ["fast mode", "switch to fast"], sideEffect: "ui_only" },
  { id: "mode.deep",        category: "mode_toggle",       title: "Switch to Deep mode",   action: { type: "event", event: "rah:mode:set", payload: { mode: "deep" } }, phrases: ["deep mode", "switch to deep"], sideEffect: "ui_only" },
  { id: "workflow.propose", category: "workflow_proposal", title: "Propose workflow run",  action: { type: "propose_workflow" }, phrases: ["run workflow", "start workflow", "propose workflow"], sideEffect: "requires_approval" },
];

/** Classify the side-effect of a catalog entry so the UI can label it. */
export function classifySideEffect(entry) {
  if (!entry) return "unknown";
  if (entry.sideEffect === "requires_approval") return "requires_approval";
  return "ui_only";
}

/**
 * Deterministically rank catalog matches against a transcript. Returns an
 * inert proposal object — the UI must confirm before dispatch.
 * @param {object} input
 * @param {string} input.transcript      Raw transcript from the browser.
 * @param {object} input.profile         Resolved voice profile.
 * @param {number|null} [input.confidence]  STT-provided confidence, if any.
 * @param {typeof VOICE_COMMAND_CATALOG} [input.catalog]  Override for tests.
 */
export function proposeVoiceCommand(input) {
  const catalog = input?.catalog ?? VOICE_COMMAND_CATALOG;
  const profile = input?.profile ?? buildGlobalDefaultProfile();
  const allowed = new Set(profile.allowedCommandCategories ?? ALLOWED_COMMAND_CATEGORIES);
  const sttConfidence = Number.isFinite(input?.confidence) ? clamp01(input.confidence) : null;
  const norm = normalizeTranscript(input?.transcript ?? "");
  if (!norm) {
    return { status: "empty", reason: "empty_transcript", top: null, alternatives: [], confidenceOk: false };
  }
  const scored = catalog
    .filter((entry) => allowed.has(entry.category))
    .map((entry) => {
      let best = 0;
      for (const p of entry.phrases) {
        const target = normalizeWakePhrase(p);
        if (!target) continue;
        if (norm === target) { best = Math.max(best, 1); continue; }
        if (norm.startsWith(target + " ") || norm.endsWith(" " + target) || norm.includes(" " + target + " ")) {
          best = Math.max(best, 0.9);
          continue;
        }
        best = Math.max(best, tokenSimilarity(norm, target));
      }
      return { entry, score: Number(best.toFixed(4)) };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0] ?? null;
  const alternatives = scored.slice(1, 4).filter((s) => s.score > 0);
  // No-match floor: anything below LOW_CONFIDENCE_THRESHOLD is treated as
  // "we cannot honestly identify a command". This prevents accidental
  // dispatch of a barely-related utterance.
  if (!top || top.score < LOW_CONFIDENCE_THRESHOLD) {
    return { status: "no_match", reason: "no_catalog_match", top: null, alternatives: [], confidenceOk: false };
  }
  const proposalThreshold = clamp01(profile.wakeConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);
  const meetsIntent = top.score >= proposalThreshold;
  const sttOk = sttConfidence == null || sttConfidence >= LOW_CONFIDENCE_THRESHOLD;
  const near = scored.filter((s) => s.score >= top.score - 0.1);
  const ambiguous = near.length > 1;
  const status = !meetsIntent || !sttOk
    ? "low_confidence"
    : ambiguous
      ? "ambiguous"
      : "ready";
  return {
    status,
    reason: status === "ready" ? "ok" : (status === "ambiguous" ? "multiple_close_matches" : "below_threshold"),
    top: shapeProposal(top, profile, norm, sttConfidence),
    alternatives: alternatives.map((s) => shapeProposal(s, profile, norm, sttConfidence)),
    confidenceOk: meetsIntent && sttOk,
    intentScore: top.score,
    intentThreshold: proposalThreshold,
    sttConfidence,
  };
}

function shapeProposal({ entry, score }, profile, normalizedTranscript, sttConfidence) {
  return {
    id: fallbackId("vp"),
    commandId: entry.id,
    category: entry.category,
    title: entry.title,
    action: entry.action,
    sideEffect: classifySideEffect(entry),
    intentScore: score,
    sttConfidence,
    normalizedTranscript,
    profileId: profile?.id ?? null,
    projectId: profile?.projectId ?? null,
    requiresConfirmation: true,
  };
}

/**
 * Build the mandatory confirmation view-model. Never dispatches — the UI
 * calls this to present the exact action + rationale for a human click.
 */
export function buildConfirmationView(proposal, opts = {}) {
  if (!proposal) return null;
  const catalog = opts.catalog ?? VOICE_COMMAND_CATALOG;
  const entry = catalog.find((e) => e.id === proposal.commandId);
  return {
    proposalId: proposal.id,
    commandId: proposal.commandId,
    title: entry?.title ?? proposal.title,
    category: proposal.category,
    normalizedTranscript: proposal.normalizedTranscript,
    action: proposal.action,
    sideEffect: proposal.sideEffect,
    requiresApproval: proposal.sideEffect === "requires_approval",
    projectId: proposal.projectId ?? null,
    profileId: proposal.profileId ?? null,
    intentScore: proposal.intentScore,
    sttConfidence: proposal.sttConfidence,
    exactAction: describeExactAction(proposal.action),
  };
}

function describeExactAction(action) {
  if (!action || typeof action !== "object") return "no-op";
  if (action.type === "navigate") return `navigate → ${action.to}`;
  if (action.type === "event") return `dispatch window event ${action.event}${action.payload ? " " + JSON.stringify(action.payload) : ""}`;
  if (action.type === "propose_workflow") return "hand to Workflow Engine (approval-gated)";
  return String(action.type ?? "unknown");
}

// ─── Consent / readiness ──────────────────────────────────────────────

/**
 * Build an honest capability + consent summary from browser probes.
 * Never claims capability the caller did not verify.
 */
export function buildReadinessSummary(input = {}) {
  const stt = input.sttSupported === true;
  const tts = input.ttsSupported === true;
  const perm = String(input.micPermission ?? "unknown");
  const bridge = input.bridgeOnline === true;
  let level = "unsupported";
  const blockers = [];
  if (!stt) blockers.push("SpeechRecognition not supported by this browser");
  if (perm === "denied") blockers.push("Microphone permission denied");
  if (stt && perm === "granted") level = "ready";
  else if (stt && perm === "prompt") level = "permission_not_requested";
  else if (stt && perm === "unknown") level = "permission_unknown";
  return {
    sttSupported: stt,
    ttsSupported: tts,
    micPermission: perm,
    bridgeOnline: bridge,
    level,
    blockers,
    canStart: level === "ready",
    honestCapabilityStatement: stt
      ? "Voice uses the browser Web Speech API only. No background listening, no native wake word."
      : "This browser does not expose SpeechRecognition. Voice input is unavailable.",
  };
}

// ─── Session stats + history ──────────────────────────────────────────

/** Aggregate a session's turn/transcript history for the summary card. */
export function summarizeSession(session) {
  const turns = Array.isArray(session?.turns) ? session.turns : [];
  const transcripts = Array.isArray(session?.transcripts) ? session.transcripts : [];
  const userTurns = turns.filter((t) => t.role === "user").length;
  const assistantTurns = turns.filter((t) => t.role === "assistant").length;
  const proposed = transcripts.filter((t) => t.status === "proposed").length;
  const confirmed = transcripts.filter((t) => t.status === "confirmed").length;
  const saved = transcripts.filter((t) => t.status === "saved").length;
  return { userTurns, assistantTurns, transcripts: transcripts.length, proposed, confirmed, saved };
}

/** Filter session/transcript history for the history view. */
export function filterVoiceHistory(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    if (filters.projectId != null && row.projectId !== filters.projectId) return false;
    if (filters.profileId != null && row.profileId !== filters.profileId) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (Number.isFinite(filters.since) && Number.isFinite(row.createdAt) && row.createdAt < filters.since) return false;
    if (Number.isFinite(filters.until) && Number.isFinite(row.createdAt) && row.createdAt > filters.until) return false;
    if (filters.q) {
      const q = String(filters.q).toLowerCase();
      const hay = ((row.editedText || row.normalizedText || row.rawText || "") + " " + (row.commandId ?? "")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Shape the history for JSON / MD export. Deterministic, no secrets. */
export function shapeHistoryForExport(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    createdAtIso: Number.isFinite(r.createdAt) ? new Date(r.createdAt).toISOString() : null,
    projectId: r.projectId ?? null,
    profileId: r.profileId ?? null,
    sourceApi: r.sourceApi ?? null,
    locale: r.locale ?? null,
    confidence: r.confidence ?? null,
    rawText: r.rawText ?? "",
    normalizedText: r.normalizedText ?? "",
    editedText: r.editedText ?? null,
    wakeMatch: r.wakeMatch ?? null,
    status: r.status ?? null,
    saveDestination: r.saveDestination ?? null,
    proposalId: r.proposalId ?? null,
    confirmationId: r.confirmationId ?? null,
  }));
}

// ─── Draft dirty detection ────────────────────────────────────────────

const PROFILE_DIRTY_FIELDS = [
  "name", "projectId", "locale", "wakePhrase", "alternatePhrases",
  "wakeConfidenceThreshold", "pushToTalk", "continuousListening",
  "autoStopSilenceMs", "preferredInputDeviceId", "preferredInputDeviceLabel",
  "defaultMode", "allowedCommandCategories", "enabled",
];

export function isProfileDraftDirty(draft, baseline) {
  if (!draft) return false;
  if (!baseline) return true;
  for (const field of PROFILE_DIRTY_FIELDS) {
    const a = draft[field];
    const b = baseline[field];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return true;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
      continue;
    }
    if ((a ?? null) !== (b ?? null)) return true;
  }
  return false;
}

export function isReviewDraftDirty(draft) {
  if (!draft) return false;
  if (draft.status && draft.status !== "review") return false;
  if (typeof draft.editedText === "string" && draft.editedText.length > 0) return true;
  if (draft.rawText && draft.status === "review") return true;
  return false;
}

// ─── Import / export ──────────────────────────────────────────────────

export function shapeProfileForExport(profile) {
  return {
    schemaVersion: VOICE_PROFILES_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile: normalizeProfile(profile),
  };
}

/**
 * Validate an imported payload. Returns `{ ok, error, profiles }`.
 * The caller decides replace/skip per profile; we NEVER auto-overwrite.
 */
export function validateProfileImport(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "invalid_payload", profiles: [] };
  if (payload.schemaVersion !== VOICE_PROFILES_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported_schema_version:${payload.schemaVersion}`, profiles: [] };
  }
  const items = payload.profile ? [payload.profile] : (Array.isArray(payload.profiles) ? payload.profiles : []);
  const normalized = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    normalized.push(normalizeProfile(raw));
  }
  if (!normalized.length) return { ok: false, error: "no_profiles", profiles: [] };
  return { ok: true, error: null, profiles: normalized };
}

/**
 * Deterministic merge decision. Never silently overwrites; each existing
 * profile with the same id is reported and requires the caller to pass a
 * per-id decision.
 */
export function planProfileMerge({ incoming, existing = [], decisions = {} }) {
  const byId = new Map(existing.filter(isValidProfile).map((p) => [p.id, p]));
  const ops = [];
  for (const p of incoming) {
    if (!byId.has(p.id)) { ops.push({ op: "insert", profile: p }); continue; }
    const dec = decisions[p.id];
    if (dec === "replace") ops.push({ op: "replace", profile: p, previous: byId.get(p.id) });
    else if (dec === "skip") ops.push({ op: "skip", profile: p, previous: byId.get(p.id) });
    else ops.push({ op: "conflict", profile: p, previous: byId.get(p.id) });
  }
  return {
    ops,
    hasConflicts: ops.some((o) => o.op === "conflict"),
    conflictIds: ops.filter((o) => o.op === "conflict").map((o) => o.profile.id),
  };
}

// ─── AI cleanup safety ────────────────────────────────────────────────

/** Build the prompt for user-triggered transcript cleanup. The cleanup
 *  path may correct punctuation / obvious ASR errors only. This helper
 *  encodes the safety constraints in the prompt so the model cannot
 *  fabricate actions, names, decisions, or next steps. */
export function buildCleanupPrompt(rawText) {
  const safe = String(rawText ?? "").slice(0, 4000);
  return [
    "You clean up a voice transcript.",
    "Rules:",
    "- Fix punctuation and obvious transcription errors ONLY.",
    "- Do NOT add facts, actions, names, decisions, progress, blockers, or next steps.",
    "- Do NOT summarize, translate, or infer intent.",
    "- If you are unsure, leave the text unchanged.",
    "- Return the cleaned transcript as plain text with no commentary.",
    "",
    "Transcript:",
    safe,
  ].join("\n");
}

export function isCleanupSuspicious(before, after) {
  const a = normalizeTranscript(before);
  const b = normalizeTranscript(after);
  if (!a || !b) return true;
  // Length ratio guard: cleanup should not > 1.5x or < 0.5x the original.
  const ratio = b.length / Math.max(1, a.length);
  if (ratio > 1.5 || ratio < 0.5) return true;
  return false;
}