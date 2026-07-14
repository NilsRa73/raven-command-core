import { test } from "node:test";
import assert from "node:assert/strict";

import {
  UPDATER_STATES,
  canTransition,
  nextUpdaterState,
  parseSemver,
  compareSemver,
  isNewerVersion,
  meetsMinimum,
  selectReleaseChannel,
  normalizeTarget,
  validateReleaseManifest,
  shapeDownloadProgress,
  formatBytes,
  evaluateRollback,
  summarizeSigningReadiness,
  evaluateSidecarCompatibility,
  computeRestartBlockers,
  createHistoryEvent,
  filterHistory,
  exportHistoryJson,
  exportHistoryMarkdown,
  summarizeCompanionStatus,
  normalizeCheckResult,
  RELEASE_CHANNELS,
  SUPPORTED_TARGETS,
} from "../../src/lib/rah/updater.js";

// ── State machine ─────────────────────────────────────────────────────

test("state machine lists exactly the 11 required states", () => {
  const required = [
    "unsupported","not_configured","idle","checking","update_available",
    "downloading","downloaded","awaiting_restart","up_to_date","failed","rollback_unavailable",
  ];
  assert.deepEqual([...UPDATER_STATES].sort(), required.sort());
});

test("legal transitions from idle", () => {
  assert.equal(canTransition("idle", "checking"), true);
  assert.equal(canTransition("idle", "not_configured"), true);
  assert.equal(canTransition("idle", "failed"), true);
  assert.equal(canTransition("idle", "downloading"), false); // must go via checking->update_available
});

test("checking cannot jump directly to downloaded", () => {
  assert.equal(canTransition("checking", "downloaded"), false);
});

test("unsupported is terminal — no transitions out", () => {
  for (const s of UPDATER_STATES) assert.equal(canTransition("unsupported", s), false);
});

test("not_configured is idempotent only", () => {
  assert.equal(canTransition("not_configured", "not_configured"), true);
  assert.equal(canTransition("not_configured", "checking"), false);
});

test("nextUpdaterState throws on illegal transition", () => {
  assert.throws(() => nextUpdaterState("idle", "downloaded"));
  assert.equal(nextUpdaterState("checking", "update_available"), "update_available");
});

// ── Semver ────────────────────────────────────────────────────────────

test("parseSemver accepts strict form, rejects looseness", () => {
  assert.equal(parseSemver("v1.2.3"), null);
  assert.equal(parseSemver("1.2"), null);
  assert.equal(parseSemver("1.2.3.4"), null);
  assert.deepEqual(parseSemver("1.2.3").pre, []);
  assert.deepEqual(parseSemver("1.2.3-beta.4").pre, ["beta", "4"]);
  assert.equal(parseSemver("1.2.3+build.1").raw, "1.2.3+build.1");
});

test("compareSemver: patch/minor/major ordering", () => {
  assert.equal(compareSemver("1.2.3", "1.2.4"), -1);
  assert.equal(compareSemver("1.3.0", "1.2.99"), 1);
  assert.equal(compareSemver("2.0.0", "1.99.99"), 1);
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
});

test("compareSemver: prerelease is lower than release", () => {
  assert.equal(compareSemver("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.2"), -1);
  assert.equal(compareSemver("1.0.0-alpha", "1.0.0-alpha.1"), -1);
});

test("compareSemver: build metadata is ignored", () => {
  assert.equal(compareSemver("1.0.0+a", "1.0.0+b"), 0);
});

test("compareSemver returns null on invalid input (fail-closed)", () => {
  assert.equal(compareSemver("garbage", "1.0.0"), null);
  assert.equal(compareSemver("1.0.0", null), null);
});

test("isNewerVersion + meetsMinimum are strict", () => {
  assert.equal(isNewerVersion("0.3.0", "0.2.1"), true);
  assert.equal(isNewerVersion("0.2.1", "0.2.1"), false);
  assert.equal(meetsMinimum("0.2.1", "0.2.1"), true);
  assert.equal(meetsMinimum("0.2.0", "0.2.1"), false);
  assert.equal(meetsMinimum("garbage", "0.2.1"), false); // fail-closed
});

// ── Channels ──────────────────────────────────────────────────────────

test("selectReleaseChannel falls back to stable for unknown", () => {
  const r = selectReleaseChannel({ channel: "nightly" });
  assert.equal(r.channel, "stable");
  assert.equal(r.reason, "unknown_channel_fell_back_to_stable");
});

test("selectReleaseChannel honors beta preference; forceStable overrides", () => {
  assert.equal(selectReleaseChannel({ channel: "beta" }).channel, "beta");
  assert.equal(selectReleaseChannel({ channel: "beta" }, { forceStable: true }).channel, "stable");
});

test("RELEASE_CHANNELS is exactly stable/beta/dev", () => {
  assert.deepEqual([...RELEASE_CHANNELS].sort(), ["beta", "dev", "stable"]);
});

// ── Target normalization ──────────────────────────────────────────────

test("normalizeTarget maps aliases; unknown => unknown", () => {
  assert.equal(normalizeTarget({ os: "Windows", arch: "x64" }), "windows-x86_64");
  assert.equal(normalizeTarget({ os: "win32", arch: "amd64" }), "windows-x86_64");
  assert.equal(normalizeTarget({ os: "linux", arch: "x86_64" }), "unknown");
  assert.equal(normalizeTarget({ os: "windows", arch: "arm64" }), "unknown");
  assert.equal(normalizeTarget(null), "unknown");
});

test("SUPPORTED_TARGETS is honest — only what CI actually builds", () => {
  assert.deepEqual([...SUPPORTED_TARGETS], ["windows-x86_64"]);
});

// ── Manifest validation ───────────────────────────────────────────────

const GOOD = () => ({
  schemaVersion: 3,
  version: "0.3.0",
  channel: "stable",
  target: { os: "windows", arch: "x86_64" },
  url: "https://example.com/rah-desktop-bridge-0.3.0-x64.exe",
  sha256: "a".repeat(64),
  bytes: 25_000_000,
  releasedAt: "2026-08-01T12:00:00.000Z",
  file: "rah-desktop-bridge-0.3.0-x64.exe",
  signature: null,
});

test("valid manifest passes with unsigned warning", () => {
  const r = validateReleaseManifest(GOOD());
  assert.equal(r.ok, true, r.errors.join(","));
  assert.deepEqual(r.warnings, ["unsigned_release"]);
  assert.equal(r.manifest.signed, false);
  assert.equal(r.manifest.target, "windows-x86_64");
});

test("manifest fails on missing schemaVersion", () => {
  const m = GOOD(); delete m.schemaVersion;
  assert.equal(validateReleaseManifest(m).ok, false);
});

test("manifest fails on http (not https) URL", () => {
  const m = GOOD(); m.url = "http://x/y.exe";
  const r = validateReleaseManifest(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("url_not_https"));
});

test("manifest fails on bad sha256", () => {
  const m = GOOD(); m.sha256 = "not-a-hash";
  const r = validateReleaseManifest(m);
  assert.ok(r.errors.includes("sha256_missing_or_invalid"));
});

test("manifest fails on file-name mismatch", () => {
  const m = GOOD(); m.file = "random.exe";
  assert.ok(validateReleaseManifest(m).errors.includes("file_name_pattern_mismatch"));
});

test("manifest rejects downgrade when currentVersion provided", () => {
  const m = GOOD(); m.version = "0.1.0"; m.file = "rah-desktop-bridge-0.1.0-x64.exe";
  const r = validateReleaseManifest(m, { currentVersion: "0.3.0" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("downgrade_not_allowed_via_this_path"));
});

test("manifest reports target/channel mismatch against expected", () => {
  const m = GOOD();
  const r = validateReleaseManifest(m, { expectedChannel: "beta", expectedTarget: "windows-x86_64" });
  assert.ok(r.errors.some((e) => e.startsWith("channel_mismatch")));
});

test("manifest accepts structurally-valid signature block", () => {
  const m = GOOD();
  m.signature = { type: "minisign", value: "x".repeat(64), keyId: "abcd" };
  const r = validateReleaseManifest(m);
  assert.equal(r.ok, true);
  assert.equal(r.manifest.signed, true);
  assert.equal(r.warnings.includes("unsigned_release"), false);
});

test("manifest rejects signature with unknown type", () => {
  const m = GOOD();
  m.signature = { type: "pgp", value: "x".repeat(64), keyId: "abcd" };
  assert.ok(validateReleaseManifest(m).errors.includes("signature_type_unsupported"));
});

// ── Download progress ─────────────────────────────────────────────────

test("shapeDownloadProgress with unknown total", () => {
  const p = shapeDownloadProgress({ received: 1024 });
  assert.equal(p.pct, null);
  assert.match(p.label, /received/);
});

test("shapeDownloadProgress computes pct/eta with elapsed", () => {
  const p = shapeDownloadProgress({ received: 500, total: 1000, startedAt: 1_000, now: 2_000 });
  assert.equal(p.pct, 50);
  assert.equal(p.bytesPerSec, 500);
  assert.equal(p.etaSeconds, 1);
});

test("formatBytes never fabricates for negative/NaN", () => {
  assert.equal(formatBytes(-1), "—");
  assert.equal(formatBytes(NaN), "—");
  assert.equal(formatBytes(2048), "2 KB");
});

// ── Rollback ──────────────────────────────────────────────────────────

const CURRENT = { currentVersion: "0.3.0", target: "windows-x86_64", channel: "stable" };

test("rollback needs local installer + verified checksum + older version", () => {
  const c = { version: "0.2.1", target: "windows-x86_64", channel: "stable", sha256: "b".repeat(64), verified: true, localPath: "C:/x.exe" };
  const r = evaluateRollback(CURRENT, c);
  assert.equal(r.eligible, true);
});

test("rollback rejected when not older", () => {
  const c = { version: "0.3.0", target: "windows-x86_64", channel: "stable", sha256: "b".repeat(64), verified: true, localPath: "C:/x.exe" };
  const r = evaluateRollback(CURRENT, c);
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("not_older_than_current"));
});

test("rollback rejected when unverified or missing checksum", () => {
  const c = { version: "0.2.1", target: "windows-x86_64", channel: "stable", localPath: "C:/x.exe" };
  const r = evaluateRollback(CURRENT, c);
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("integrity_not_verified"));
  assert.ok(r.reasons.includes("checksum_missing"));
});

test("rollback rejected on channel/target mismatch", () => {
  const c = { version: "0.2.1", target: "windows-x86_64", channel: "beta", sha256: "b".repeat(64), verified: true, localPath: "x" };
  assert.ok(evaluateRollback(CURRENT, c).reasons.includes("channel_mismatch"));
});

test("rollback: null candidate returns no_candidate", () => {
  assert.equal(evaluateRollback(CURRENT, null).reason, "no_candidate");
});

// ── Signing readiness ─────────────────────────────────────────────────

test("signing: nothing configured => not_configured (no fabrication)", () => {
  const r = summarizeSigningReadiness({});
  assert.equal(r.overall, "not_configured");
  assert.equal(r.canPublishUpdater, false);
  assert.equal(r.canSignWindowsInstaller, false);
  assert.ok(r.missing.includes("TAURI_SIGNING_PRIVATE_KEY"));
  assert.ok(r.external.includes("signtool.exe (Windows SDK)"));
});

test("signing: only updater keys => updater ready, installer unsigned", () => {
  const r = summarizeSigningReadiness({
    tauriPrivateKeyPresent: true, tauriKeyPasswordPresent: true,
    tauriPublicKeyPresent: true, updaterEndpointConfigured: true,
  });
  assert.equal(r.overall, "ready_updater_only_installer_unsigned");
  assert.equal(r.canPublishUpdater, true);
  assert.equal(r.canSignWindowsInstaller, false);
});

test("signing: fully ready", () => {
  const r = summarizeSigningReadiness({
    tauriPrivateKeyPresent: true, tauriKeyPasswordPresent: true, tauriPublicKeyPresent: true,
    updaterEndpointConfigured: true, windowsCertPresent: true, windowsSignToolPresent: true,
  });
  assert.equal(r.overall, "ready_signed");
});

// ── Sidecar compatibility ─────────────────────────────────────────────

test("sidecar compat: major mismatch fails", () => {
  const r = evaluateSidecarCompatibility({ sidecarVersion: "1.0.0", appVersion: "0.3.0", bridgeMinVersion: "0.2.1" });
  assert.equal(r.compatible, false);
  assert.ok(r.reasons.some((x) => x.startsWith("major_mismatch")));
});

test("sidecar compat: below min fails", () => {
  const r = evaluateSidecarCompatibility({ sidecarVersion: "0.2.0", appVersion: "0.3.0", bridgeMinVersion: "0.2.1" });
  assert.equal(r.compatible, false);
  assert.ok(r.reasons.some((x) => x.startsWith("sidecar_below_min")));
});

test("sidecar compat: same major, meets min", () => {
  const r = evaluateSidecarCompatibility({ sidecarVersion: "0.3.0", appVersion: "0.3.0", bridgeMinVersion: "0.2.1" });
  assert.equal(r.compatible, true);
});

// ── Restart blockers ──────────────────────────────────────────────────

test("restart blockers: none => safe", () => {
  const r = computeRestartBlockers({});
  assert.equal(r.safe, true);
  assert.equal(r.blockers.length, 0);
});

test("restart blockers: workflow runs + drafts + focus + download reported separately", () => {
  const r = computeRestartBlockers({
    activeWorkflowRuns: 2, unsavedDrafts: 1, activeFocusSession: true, downloadInProgress: true, pendingApprovals: 3,
  });
  assert.equal(r.safe, false);
  assert.equal(r.blockers.length, 5);
  assert.equal(r.requiresAcknowledgement, true);
});

// ── History ───────────────────────────────────────────────────────────

test("createHistoryEvent requires timestamp and valid state", () => {
  assert.throws(() => createHistoryEvent({ state: "idle" }));
  assert.throws(() => createHistoryEvent({ at: 1, state: "totally-fake" }));
  const e = createHistoryEvent({ at: 1000, state: "checking" });
  assert.equal(e.state, "checking");
  assert.equal(e.fromVersion, null);
});

test("filterHistory: state + channel + since/until + version substring", () => {
  const evts = [
    createHistoryEvent({ at: 100, state: "checking", channel: "stable" }),
    createHistoryEvent({ at: 200, state: "update_available", channel: "stable", toVersion: "0.3.1" }),
    createHistoryEvent({ at: 300, state: "downloaded", channel: "beta", toVersion: "0.4.0-beta" }),
  ];
  assert.equal(filterHistory(evts, { channel: "beta" }).length, 1);
  assert.equal(filterHistory(evts, { sinceMs: 150, untilMs: 250 }).length, 1);
  assert.equal(filterHistory(evts, { versionContains: "beta" }).length, 1);
  assert.equal(filterHistory(evts, { state: "checking" }).length, 1);
  // sort newest-first
  assert.equal(filterHistory(evts)[0].at, 300);
});

test("history export json + markdown do not fabricate", () => {
  const json = JSON.parse(exportHistoryJson([]));
  assert.equal(json.events.length, 0);
  assert.match(exportHistoryMarkdown([]), /No events recorded/);
  const md = exportHistoryMarkdown([createHistoryEvent({ at: 1, state: "up_to_date" })]);
  assert.match(md, /up_to_date/);
});

// ── Companion status summary ──────────────────────────────────────────

test("summary: native unavailable => unsupported, actions disabled", () => {
  const s = summarizeCompanionStatus({ nativeAvailable: false });
  assert.equal(s.state, "unsupported");
  assert.equal(s.canCheck, false);
  assert.equal(s.autoCheckAllowed, false);
  assert.equal(s.appVersion, "—");
});

test("summary: native available but no endpoint/pubkey => not_configured with blockers listed", () => {
  const s = summarizeCompanionStatus({ nativeAvailable: true, signing: {} });
  assert.equal(s.state, "not_configured");
  assert.ok(s.blockers.includes("updater_endpoint_not_configured"));
  assert.ok(s.blockers.includes("updater_public_key_not_configured"));
  assert.equal(s.canCheck, false);
});

test("summary: configured minimally => idle, canCheck true, autoCheck respects prefs", () => {
  const s = summarizeCompanionStatus({
    nativeAvailable: true,
    signing: { updaterEndpointConfigured: true, tauriPublicKeyPresent: true },
    prefs: { autoCheck: true, channel: "stable" },
    appVersion: "0.3.0", bridgeVersion: "0.2.1", sidecarVersion: "0.2.1",
  });
  assert.equal(s.state, "idle");
  assert.equal(s.canCheck, true);
  assert.equal(s.autoCheckAllowed, true);
  assert.equal(s.channel, "stable");
  assert.equal(s.appVersion, "0.3.0");
});

test("summary: unknown values render as '—' — no fabrication", () => {
  const s = summarizeCompanionStatus({
    nativeAvailable: true,
    signing: { updaterEndpointConfigured: true, tauriPublicKeyPresent: true },
  });
  assert.equal(s.appVersion, "—");
  assert.equal(s.bridgeVersion, "—");
  assert.equal(s.sidecarVersion, "—");
  assert.equal(s.downloadedVersion, "—");
  assert.equal(s.lastCheckLabel, "—");
});

// ── Check-result normalization ────────────────────────────────────────

test("normalizeCheckResult: null/empty => up_to_date", () => {
  assert.equal(normalizeCheckResult(null).state, "up_to_date");
  assert.equal(normalizeCheckResult({ available: false }).state, "up_to_date");
});

test("normalizeCheckResult: available:true but no version => failed (no fabrication)", () => {
  const r = normalizeCheckResult({ available: true });
  assert.equal(r.state, "failed");
});

test("normalizeCheckResult: newer version returns update_available", () => {
  const r = normalizeCheckResult({ available: true, version: "0.4.0" }, { currentVersion: "0.3.0" });
  assert.equal(r.state, "update_available");
  assert.equal(r.available.version, "0.4.0");
});

test("normalizeCheckResult: not newer treated as up_to_date", () => {
  const r = normalizeCheckResult({ available: true, version: "0.3.0" }, { currentVersion: "0.3.0" });
  assert.equal(r.state, "up_to_date");
});