// Native companion v0.3 — deterministic pure helpers for the Tauri updater
// UX layer. NO Tauri/Rust/DOM imports here. React and the Tauri IPC layer
// render the results of these helpers; they never embed policy logic.
//
// Contracts:
//   - No fabrication: every state is derived from explicit input. If a
//     value is unknown, the helper reports `unknown` — never invents a
//     version, checksum, timestamp, or signature.
//   - Fail-closed: missing endpoint / public key / signing metadata /
//     unknown platform-arch => update actions are disabled with an
//     explicit `blockers` list.
//   - No implicit downgrade: rollback is only allowed against an
//     explicit, locally-available, verified prior package that the
//     caller opts in to.

/** @typedef {"unsupported"|"not_configured"|"idle"|"checking"|"update_available"|"downloading"|"downloaded"|"awaiting_restart"|"up_to_date"|"failed"|"rollback_unavailable"} UpdaterState */

export const UPDATER_STATES = /** @type {const} */ ([
  "unsupported",
  "not_configured",
  "idle",
  "checking",
  "update_available",
  "downloading",
  "downloaded",
  "awaiting_restart",
  "up_to_date",
  "failed",
  "rollback_unavailable",
]);

// Allowed transitions. Any transition not listed is illegal and throws.
const TRANSITIONS = {
  unsupported:          [],
  not_configured:       ["not_configured"],
  idle:                 ["checking", "not_configured", "failed"],
  checking:             ["update_available", "up_to_date", "failed", "idle"],
  update_available:     ["downloading", "idle", "failed"],
  downloading:          ["downloaded", "failed", "idle"],
  downloaded:           ["awaiting_restart", "failed", "idle"],
  awaiting_restart:     ["idle", "failed"],
  up_to_date:           ["checking", "idle"],
  failed:               ["idle", "checking"],
  rollback_unavailable: ["idle", "checking"],
};

export function canTransition(from, to) {
  if (!UPDATER_STATES.includes(from)) return false;
  if (!UPDATER_STATES.includes(to)) return false;
  const list = TRANSITIONS[from] || [];
  return list.includes(to);
}

export function nextUpdaterState(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`illegal updater transition: ${from} -> ${to}`);
  }
  return to;
}

// ─── Semantic version comparison ────────────────────────────────────────
// Strict semver core: MAJOR.MINOR.PATCH with optional -prerelease. Build
// metadata (+xxx) is ignored per SemVer 2.0. Returns null for invalid.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(v) {
  if (typeof v !== "string") return null;
  const m = SEMVER_RE.exec(v.trim());
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null;
  const pre = m[4] ? m[4].split(".") : [];
  return { major, minor, patch, pre, raw: v.trim() };
}

/** Returns -1 if a<b, 0 if equal (ignoring build), 1 if a>b, or null if either invalid. */
export function compareSemver(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  if (!A || !B) return null;
  for (const k of /** @type {const} */ (["major", "minor", "patch"])) {
    if (A[k] !== B[k]) return A[k] < B[k] ? -1 : 1;
  }
  // Prerelease: no prerelease > any prerelease.
  if (A.pre.length === 0 && B.pre.length === 0) return 0;
  if (A.pre.length === 0) return 1;
  if (B.pre.length === 0) return -1;
  const n = Math.max(A.pre.length, B.pre.length);
  for (let i = 0; i < n; i++) {
    const x = A.pre[i], y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x) ? Number(x) : null;
    const yn = /^\d+$/.test(y) ? Number(y) : null;
    if (xn !== null && yn !== null) {
      if (xn !== yn) return xn < yn ? -1 : 1;
    } else if (xn !== null) { return -1; }
    else if (yn !== null) { return 1; }
    else if (x !== y) { return x < y ? -1 : 1; }
  }
  return 0;
}

export function isNewerVersion(candidate, current) {
  const cmp = compareSemver(candidate, current);
  return cmp === 1;
}

/** Meets minimum: candidate >= min. Returns false on invalid input (fail-closed). */
export function meetsMinimum(candidate, min) {
  const cmp = compareSemver(candidate, min);
  return cmp === 0 || cmp === 1;
}

// ─── Channels ───────────────────────────────────────────────────────────

export const RELEASE_CHANNELS = /** @type {const} */ (["stable", "beta", "dev"]);

export function selectReleaseChannel(prefs, options = {}) {
  const requested = prefs?.channel ?? "stable";
  const allowed = new Set(options.allowed ?? RELEASE_CHANNELS);
  if (!allowed.has(requested)) return { channel: "stable", reason: "unknown_channel_fell_back_to_stable" };
  // Dev/beta require explicit opt-in per session; otherwise honor prefs.
  if (requested !== "stable" && options.forceStable) {
    return { channel: "stable", reason: "forced_stable_by_policy" };
  }
  return { channel: requested, reason: "user_preference" };
}

// ─── Platform / architecture ────────────────────────────────────────────
// Canonical keys are `<os>-<arch>`. Only what we actually build for is
// listed. Anything else is `unknown` and disables updates.

export const SUPPORTED_TARGETS = /** @type {const} */ ([
  "windows-x86_64",
]);

export function normalizeTarget(input) {
  if (!input || typeof input !== "object") return "unknown";
  const os = String(input.os ?? "").toLowerCase();
  const arch = String(input.arch ?? "").toLowerCase();
  const osMap = { windows: "windows", win32: "windows", "windows_nt": "windows" };
  const archMap = { x86_64: "x86_64", x64: "x86_64", amd64: "x86_64" };
  const o = osMap[os];
  const a = archMap[arch];
  if (!o || !a) return "unknown";
  const key = `${o}-${a}`;
  return SUPPORTED_TARGETS.includes(key) ? key : "unknown";
}

// ─── Manifest validation ────────────────────────────────────────────────
// A release manifest (our own JSON, not Tauri's `latest.json`) describes
// exactly one artifact for exactly one platform-arch. Missing / mismatched
// fields fail-closed with a specific reason.

const SHA256_RE = /^[0-9a-f]{64}$/;
const HTTPS_RE = /^https:\/\//i;

/**
 * @param {any} m raw parsed manifest
 * @param {{ expectedTarget?: string, expectedChannel?: string, currentVersion?: string }} [ctx]
 */
export function validateReleaseManifest(m, ctx = {}) {
  const errors = [];
  const warnings = [];
  const push = (e) => errors.push(e);

  if (!m || typeof m !== "object" || Array.isArray(m)) {
    return { ok: false, errors: ["manifest_not_object"], warnings, manifest: null };
  }
  if (m.schemaVersion !== 3) push("schema_version_must_be_3");
  const version = parseSemver(m.version);
  if (!version) push("version_invalid_semver");
  const channel = String(m.channel ?? "");
  if (!RELEASE_CHANNELS.includes(channel)) push("channel_invalid");
  const target = normalizeTarget(m.target ?? { os: m.os, arch: m.arch });
  if (target === "unknown") push("target_unsupported_or_missing");
  if (typeof m.url !== "string" || !HTTPS_RE.test(m.url)) push("url_not_https");
  if (typeof m.sha256 !== "string" || !SHA256_RE.test(m.sha256)) push("sha256_missing_or_invalid");
  if (typeof m.bytes !== "number" || !Number.isFinite(m.bytes) || m.bytes <= 0) push("bytes_missing_or_invalid");
  if (typeof m.releasedAt !== "string" || Number.isNaN(Date.parse(m.releasedAt))) push("releasedAt_missing_or_invalid");
  if (typeof m.file !== "string" || !/^rah-desktop-bridge-\d+\.\d+\.\d+.*\.exe$/i.test(m.file)) {
    push("file_name_pattern_mismatch");
  }
  // Signature block: OPTIONAL but if present must be structurally valid.
  const sig = m.signature ?? null;
  if (sig !== null) {
    if (typeof sig !== "object") push("signature_not_object");
    else {
      if (sig.type !== "minisign") push("signature_type_unsupported");
      if (typeof sig.value !== "string" || sig.value.length < 32) push("signature_value_missing");
      if (typeof sig.keyId !== "string" || sig.keyId.length < 4) push("signature_keyId_missing");
    }
  } else {
    warnings.push("unsigned_release");
  }

  // Context mismatches
  if (ctx.expectedTarget && target !== "unknown" && target !== ctx.expectedTarget) {
    push(`target_mismatch:expected_${ctx.expectedTarget}_got_${target}`);
  }
  if (ctx.expectedChannel && channel && channel !== ctx.expectedChannel) {
    push(`channel_mismatch:expected_${ctx.expectedChannel}_got_${channel}`);
  }
  if (ctx.currentVersion && version) {
    const cmp = compareSemver(m.version, ctx.currentVersion);
    if (cmp === -1) push("downgrade_not_allowed_via_this_path");
    if (cmp === 0) warnings.push("same_version_as_current");
  }

  if (errors.length > 0) return { ok: false, errors, warnings, manifest: null };
  return {
    ok: true,
    errors: [],
    warnings,
    manifest: {
      schemaVersion: 3,
      version: m.version,
      channel,
      target,
      url: m.url,
      sha256: m.sha256.toLowerCase(),
      bytes: m.bytes,
      releasedAt: m.releasedAt,
      file: m.file,
      signature: sig,
      signed: sig !== null,
    },
  };
}

// ─── Download progress shaping ──────────────────────────────────────────

export function shapeDownloadProgress({ received = 0, total = 0, startedAt = null, now = Date.now() } = {}) {
  const r = Math.max(0, Math.floor(received));
  const t = Math.max(0, Math.floor(total));
  const knownTotal = t > 0;
  const pct = knownTotal ? Math.min(100, Math.floor((r / t) * 100)) : null;
  let bytesPerSec = null;
  let etaSeconds = null;
  if (startedAt && Number.isFinite(startedAt) && now > startedAt) {
    const elapsed = (now - startedAt) / 1000;
    if (elapsed > 0.5 && r > 0) {
      bytesPerSec = Math.floor(r / elapsed);
      if (knownTotal && bytesPerSec > 0) {
        etaSeconds = Math.max(0, Math.floor((t - r) / bytesPerSec));
      }
    }
  }
  return {
    received: r, total: knownTotal ? t : null, pct,
    bytesPerSec, etaSeconds,
    label: pct == null ? `${formatBytes(r)} received` : `${pct}% (${formatBytes(r)}/${formatBytes(t)})`,
  };
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, x = n;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// ─── Rollback eligibility ───────────────────────────────────────────────

/**
 * @param {{ currentVersion: string, target: string, channel: string }} current
 * @param {{ version: string, target: string, channel: string, sha256?: string, verified?: boolean, localPath?: string, signed?: boolean }} candidate
 */
export function evaluateRollback(current, candidate) {
  const reasons = [];
  if (!candidate || typeof candidate !== "object") {
    return { eligible: false, reason: "no_candidate", reasons: ["no_candidate"] };
  }
  if (!candidate.localPath) reasons.push("no_local_installer_present");
  if (!candidate.verified) reasons.push("integrity_not_verified");
  if (!candidate.sha256 || !SHA256_RE.test(String(candidate.sha256))) reasons.push("checksum_missing");
  const t = normalizeTarget({ os: candidate.target?.split("-")[0], arch: candidate.target?.split("-")[1] });
  if (t === "unknown" || t !== current.target) reasons.push("target_mismatch");
  if (candidate.channel !== current.channel) reasons.push("channel_mismatch");
  const cmp = compareSemver(candidate.version, current.currentVersion);
  if (cmp === null) reasons.push("version_invalid");
  else if (cmp !== -1) reasons.push("not_older_than_current");
  if (reasons.length > 0) return { eligible: false, reason: reasons[0], reasons };
  return { eligible: true, reason: null, reasons: [] };
}

// ─── Signing / release preflight (deterministic summary) ────────────────

/**
 * Summarise which release-signing prerequisites are configured, missing, or
 * externally required. Input is presence booleans only — this helper never
 * touches env or secrets itself; the CLI script does the reading.
 */
export function summarizeSigningReadiness(input = {}) {
  const c = !!input.tauriPrivateKeyPresent;
  const p = !!input.tauriKeyPasswordPresent;
  const pub = !!input.tauriPublicKeyPresent;
  const cert = !!input.windowsCertPresent;
  const tool = !!input.windowsSignToolPresent;
  const endpoint = !!input.updaterEndpointConfigured;

  const configured = [];
  const missing = [];
  const external = [];
  (c ? configured : missing).push("TAURI_SIGNING_PRIVATE_KEY");
  (p ? configured : missing).push("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
  (pub ? configured : missing).push("tauri.conf.json plugins.updater.pubkey");
  (cert ? configured : external).push("Windows code-signing certificate (WINDOWS_CERTIFICATE / WINDOWS_CERTIFICATE_PASSWORD)");
  (tool ? configured : external).push("signtool.exe (Windows SDK)");
  (endpoint ? configured : missing).push("plugins.updater.endpoints");

  const canSignUpdaterArtifacts = c && p && pub;
  const canSignWindowsInstaller = cert && tool;
  const canPublishUpdater = canSignUpdaterArtifacts && endpoint;
  const overall =
    canPublishUpdater && canSignWindowsInstaller ? "ready_signed"
    : canPublishUpdater ? "ready_updater_only_installer_unsigned"
    : canSignWindowsInstaller ? "installer_signed_updater_not_configured"
    : "not_configured";
  return {
    overall,
    canSignUpdaterArtifacts,
    canSignWindowsInstaller,
    canPublishUpdater,
    configured, missing, external,
  };
}

// ─── Sidecar version compatibility ──────────────────────────────────────

export function evaluateSidecarCompatibility({ sidecarVersion, appVersion, bridgeMinVersion }) {
  const reasons = [];
  if (!parseSemver(sidecarVersion)) reasons.push("sidecar_version_invalid");
  if (!parseSemver(appVersion)) reasons.push("app_version_invalid");
  if (!parseSemver(bridgeMinVersion)) reasons.push("bridge_min_version_invalid");
  if (reasons.length > 0) return { compatible: false, reasons };
  if (!meetsMinimum(sidecarVersion, bridgeMinVersion)) {
    return { compatible: false, reasons: [`sidecar_below_min:${sidecarVersion}<${bridgeMinVersion}`] };
  }
  const appMajor = parseSemver(appVersion).major;
  const sideMajor = parseSemver(sidecarVersion).major;
  if (appMajor !== sideMajor) {
    return { compatible: false, reasons: [`major_mismatch:app_${appMajor}_sidecar_${sideMajor}`] };
  }
  return { compatible: true, reasons: [] };
}

// ─── Restart blockers ───────────────────────────────────────────────────

export function computeRestartBlockers({
  activeWorkflowRuns = 0,
  pendingApprovals = 0,
  unsavedDrafts = 0,
  activeFocusSession = false,
  downloadInProgress = false,
} = {}) {
  const blockers = [];
  if (activeWorkflowRuns > 0) blockers.push({ kind: "workflow_runs", count: activeWorkflowRuns, label: `${activeWorkflowRuns} active workflow run(s)` });
  if (pendingApprovals > 0) blockers.push({ kind: "approvals", count: pendingApprovals, label: `${pendingApprovals} pending approval(s)` });
  if (unsavedDrafts > 0) blockers.push({ kind: "drafts", count: unsavedDrafts, label: `${unsavedDrafts} unsaved draft(s)` });
  if (activeFocusSession) blockers.push({ kind: "focus_session", count: 1, label: "Active focus session" });
  if (downloadInProgress) blockers.push({ kind: "download", count: 1, label: "Update download in progress" });
  return {
    safe: blockers.length === 0,
    blockers,
    requiresAcknowledgement: blockers.length > 0,
  };
}

// ─── Update history ─────────────────────────────────────────────────────

/** Deterministic event record shape. */
export function createHistoryEvent({ id, at, state, fromVersion, toVersion, channel, target, detail, sha256, bytes, signed, error } = {}) {
  if (!at || !Number.isFinite(at)) throw new Error("history_event_requires_at");
  if (!UPDATER_STATES.includes(state)) throw new Error(`history_event_invalid_state:${state}`);
  return {
    id: String(id ?? `${at}-${state}`),
    at,
    state,
    fromVersion: fromVersion ?? null,
    toVersion: toVersion ?? null,
    channel: channel ?? null,
    target: target ?? null,
    detail: detail ?? null,
    sha256: sha256 ?? null,
    bytes: Number.isFinite(bytes) ? bytes : null,
    signed: typeof signed === "boolean" ? signed : null,
    error: error ?? null,
  };
}

export function filterHistory(events, filter = {}) {
  const arr = Array.isArray(events) ? events.slice() : [];
  const { state, channel, sinceMs, untilMs, versionContains } = filter;
  return arr
    .filter((e) => e && Number.isFinite(e.at))
    .filter((e) => state == null || e.state === state)
    .filter((e) => channel == null || e.channel === channel)
    .filter((e) => sinceMs == null || e.at >= sinceMs)
    .filter((e) => untilMs == null || e.at <= untilMs)
    .filter((e) => !versionContains || String(e.toVersion ?? "").includes(versionContains) || String(e.fromVersion ?? "").includes(versionContains))
    .sort((a, b) => b.at - a.at);
}

export function exportHistoryJson(events) {
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), events: filterHistory(events) }, null, 2);
}

export function exportHistoryMarkdown(events) {
  const list = filterHistory(events);
  if (list.length === 0) return "# Update history\n\n_No events recorded._\n";
  const lines = ["# Update history", ""];
  lines.push("| Time | State | From | To | Channel | Target | Signed | Detail |");
  lines.push("|------|-------|------|----|---------|--------|--------|--------|");
  for (const e of list) {
    lines.push(`| ${new Date(e.at).toISOString()} | ${e.state} | ${e.fromVersion ?? "—"} | ${e.toVersion ?? "—"} | ${e.channel ?? "—"} | ${e.target ?? "—"} | ${e.signed == null ? "—" : e.signed ? "yes" : "no"} | ${(e.detail ?? e.error ?? "").toString().replace(/\|/g, "\\|")} |`);
  }
  return lines.join("\n") + "\n";
}

// ─── UI summary (single source of truth for the Native Companion card) ──

/** Everything the /native page renders is derived from this pure function. */
export function summarizeCompanionStatus(input = {}) {
  const dash = (v) => (v == null || v === "" ? "—" : v);
  const appVersion = dash(input.appVersion);
  const bridgeVersion = dash(input.bridgeVersion);
  const sidecarVersion = dash(input.sidecarVersion);
  const target = input.target && input.target !== "unknown" ? input.target : "—";
  const channelSel = selectReleaseChannel(input.prefs ?? {}, { forceStable: input.forceStable });
  const sign = summarizeSigningReadiness(input.signing ?? {});
  const endpointConfigured = !!input.signing?.updaterEndpointConfigured;
  const publicKeyConfigured = !!input.signing?.tauriPublicKeyPresent;

  const blockers = [];
  if (!input.nativeAvailable) blockers.push("native_companion_unavailable");
  if (!endpointConfigured) blockers.push("updater_endpoint_not_configured");
  if (!publicKeyConfigured) blockers.push("updater_public_key_not_configured");

  const state = !input.nativeAvailable ? "unsupported"
    : blockers.length > 0 ? "not_configured"
    : (input.state && UPDATER_STATES.includes(input.state) ? input.state : "idle");

  return {
    appVersion, bridgeVersion, sidecarVersion, target,
    channel: channelSel.channel,
    channelReason: channelSel.reason,
    endpointConfigured,
    publicKeyConfigured,
    signingReadiness: sign.overall,
    signingConfigured: sign.configured,
    signingMissing: sign.missing,
    signingExternal: sign.external,
    lastCheckAt: input.lastCheckAt ?? null,
    lastCheckLabel: input.lastCheckAt ? new Date(input.lastCheckAt).toISOString() : "—",
    downloadedVersion: dash(input.downloadedVersion),
    state,
    blockers,
    canCheck: state !== "unsupported" && state !== "not_configured",
    canDownload: state === "update_available",
    canInstall: state === "downloaded",
    canRestart: state === "awaiting_restart",
    autoCheckAllowed: !!input.prefs?.autoCheck && state !== "unsupported" && state !== "not_configured",
  };
}

// ─── No-fabrication contract (self-test helper) ─────────────────────────
// Callers can pass in a raw "check result" they got from Tauri; this
// helper refuses to invent a version/checksum if the runtime did not
// supply them. It never returns `update_available` with unknowns.
export function normalizeCheckResult(raw, { currentVersion } = {}) {
  if (raw == null) return { state: "up_to_date", available: null };
  if (typeof raw !== "object") return { state: "failed", available: null, error: "check_result_not_object" };
  if (raw.available === false) return { state: "up_to_date", available: null };
  if (raw.available !== true) return { state: "failed", available: null, error: "check_result_missing_available_flag" };
  const v = raw.version;
  if (!parseSemver(v)) return { state: "failed", available: null, error: "check_result_version_invalid" };
  if (currentVersion && !isNewerVersion(v, currentVersion)) {
    return { state: "up_to_date", available: null };
  }
  return {
    state: "update_available",
    available: {
      version: v,
      date: typeof raw.date === "string" ? raw.date : null,
      body: typeof raw.body === "string" ? raw.body : null,
      signature: typeof raw.signature === "string" ? raw.signature : null,
    },
  };
}