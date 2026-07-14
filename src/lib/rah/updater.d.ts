export type UpdaterState =
  | "unsupported" | "not_configured" | "idle" | "checking"
  | "update_available" | "downloading" | "downloaded"
  | "awaiting_restart" | "up_to_date" | "failed" | "rollback_unavailable";

export const UPDATER_STATES: readonly UpdaterState[];
export const RELEASE_CHANNELS: readonly ("stable" | "beta" | "dev")[];
export const SUPPORTED_TARGETS: readonly ("windows-x86_64")[];

export function canTransition(from: UpdaterState, to: UpdaterState): boolean;
export function nextUpdaterState(from: UpdaterState, to: UpdaterState): UpdaterState;

export interface ParsedSemver { major: number; minor: number; patch: number; pre: string[]; raw: string }
export function parseSemver(v: string): ParsedSemver | null;
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null;
export function isNewerVersion(candidate: string, current: string): boolean;
export function meetsMinimum(candidate: string, min: string): boolean;

export function selectReleaseChannel(prefs: { channel?: string } | null | undefined, options?: { allowed?: readonly string[]; forceStable?: boolean }): { channel: string; reason: string };
export function normalizeTarget(input: { os?: string; arch?: string } | null | undefined): string;

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest: null | {
    schemaVersion: 3;
    version: string; channel: string; target: string;
    url: string; sha256: string; bytes: number; releasedAt: string;
    file: string; signature: null | { type: string; value: string; keyId: string }; signed: boolean;
  };
}
export function validateReleaseManifest(m: unknown, ctx?: { expectedTarget?: string; expectedChannel?: string; currentVersion?: string }): ManifestValidation;

export function shapeDownloadProgress(input?: { received?: number; total?: number; startedAt?: number | null; now?: number }): {
  received: number; total: number | null; pct: number | null;
  bytesPerSec: number | null; etaSeconds: number | null; label: string;
};
export function formatBytes(n: number): string;

export function evaluateRollback(
  current: { currentVersion: string; target: string; channel: string },
  candidate: { version: string; target: string; channel: string; sha256?: string; verified?: boolean; localPath?: string; signed?: boolean }
): { eligible: boolean; reason: string | null; reasons: string[] };

export function summarizeSigningReadiness(input?: {
  tauriPrivateKeyPresent?: boolean;
  tauriKeyPasswordPresent?: boolean;
  tauriPublicKeyPresent?: boolean;
  windowsCertPresent?: boolean;
  windowsSignToolPresent?: boolean;
  updaterEndpointConfigured?: boolean;
}): {
  overall: "ready_signed" | "ready_updater_only_installer_unsigned" | "installer_signed_updater_not_configured" | "not_configured";
  canSignUpdaterArtifacts: boolean;
  canSignWindowsInstaller: boolean;
  canPublishUpdater: boolean;
  configured: string[]; missing: string[]; external: string[];
};

export function evaluateSidecarCompatibility(input: { sidecarVersion: string; appVersion: string; bridgeMinVersion: string }): { compatible: boolean; reasons: string[] };

export function computeRestartBlockers(input?: {
  activeWorkflowRuns?: number; pendingApprovals?: number; unsavedDrafts?: number;
  activeFocusSession?: boolean; downloadInProgress?: boolean;
}): { safe: boolean; blockers: { kind: string; count: number; label: string }[]; requiresAcknowledgement: boolean };

export interface UpdateHistoryEvent {
  id: string; at: number; state: UpdaterState;
  fromVersion: string | null; toVersion: string | null;
  channel: string | null; target: string | null;
  detail: string | null; sha256: string | null; bytes: number | null;
  signed: boolean | null; error: string | null;
}
export function createHistoryEvent(input: Partial<UpdateHistoryEvent> & { at: number; state: UpdaterState }): UpdateHistoryEvent;
export function filterHistory(events: UpdateHistoryEvent[], filter?: { state?: UpdaterState; channel?: string; sinceMs?: number; untilMs?: number; versionContains?: string }): UpdateHistoryEvent[];
export function exportHistoryJson(events: UpdateHistoryEvent[]): string;
export function exportHistoryMarkdown(events: UpdateHistoryEvent[]): string;

export function summarizeCompanionStatus(input?: Record<string, unknown>): {
  appVersion: string; bridgeVersion: string; sidecarVersion: string; target: string;
  channel: string; channelReason: string;
  endpointConfigured: boolean; publicKeyConfigured: boolean;
  signingReadiness: string; signingConfigured: string[]; signingMissing: string[]; signingExternal: string[];
  lastCheckAt: number | null; lastCheckLabel: string; downloadedVersion: string;
  state: UpdaterState; blockers: string[];
  canCheck: boolean; canDownload: boolean; canInstall: boolean; canRestart: boolean;
  autoCheckAllowed: boolean;
};

export function normalizeCheckResult(raw: unknown, ctx?: { currentVersion?: string }): {
  state: "up_to_date" | "update_available" | "failed";
  available: null | { version: string; date: string | null; body: string | null; signature: string | null };
  error?: string;
};