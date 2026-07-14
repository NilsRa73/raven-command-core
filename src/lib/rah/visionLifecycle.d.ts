export const LIFECYCLE_STATUSES: readonly ("active" | "ended" | "cancelled")[];
export const SAVE_DESTINATIONS: readonly (
  | "project_memory" | "chronicle" | "evidence_version" | "command_center"
  | "workflow_proposal" | "safe_action_proposal" | "clipboard"
)[];

export interface LifecycleSession {
  id: string;
  projectId: string | null;
  sourceLabel: string;
  displaySurface: string | null;
  apiLabel: string;
  mode: "fast" | "deep";
  question: string;
  consented: boolean;
  status: "active" | "ended" | "cancelled";
  startedAt: number;
  updatedAt: number;
  stoppedAt: number | null;
  captureCount: number;
  evidenceIds: string[];
  endReason?: string;
}

export function startSession(input: {
  id: string; projectId: string | null; sourceLabel?: string | null;
  displaySurface?: string | null; consented?: boolean; apiLabel?: string | null;
  mode?: "fast" | "deep"; question?: string; now?: number;
}): { ok: boolean; reason: string | null; session: LifecycleSession | null };

export function incrementCaptureCount(session: LifecycleSession | null, opts?: { now?: number }): LifecycleSession | null;
export function endSession(session: LifecycleSession | null, opts?: { reason?: string; now?: number }): LifecycleSession | null;
export function cancelSession(session: LifecycleSession | null, opts?: { reason?: string; now?: number }): LifecycleSession | null;
export function isSessionLive(session: LifecycleSession | null | undefined): boolean;

export interface HashResult {
  hash: string | null;
  algorithm: "sha256" | null;
  byteLength: number | null;
  hashedAt: number | null;
  failureReason: string | null;
}
export function shapeHashResult(input?: {
  hash?: string | null; algorithm?: string | null;
  bytes?: { byteLength?: number } | null; byteLength?: number;
  failureReason?: string | null; hashedAt?: number;
}): HashResult;

export function chooseEvidenceStorage(input?: { includeImage?: boolean; hasImageBytes?: boolean }): {
  storeImage: boolean; mode: "metadata_only" | "image_bundled"; warning: string | null;
};

export interface VisionResult {
  id: string; sessionId: string | null; evidenceId: string | null; projectId: string | null;
  createdAt: number; updatedAt: number; question: string; rawText: string;
  provider: string | null; model: string | null; transport: string | null; engine: string | null;
  latencyMs: number | null; variantSent: "original" | "redacted"; mode: "fast" | "deep";
  frameHash: string | null; frameCapturedAt: number | null;
  version: number; previousVersionId: string | null;
  editedText?: string; editedBy?: string;
}
export function createResult(input?: Partial<VisionResult> & { rawText?: string; now?: number }): VisionResult | null;
export function createResultVersion(prev: VisionResult, opts?: { id?: string; editedText?: string; editedBy?: string; now?: number }): VisionResult | null;
export function buildResultChain(results: VisionResult[], headId: string): VisionResult[];

export function shapeSaveReceipt(input?: { destination?: string; id?: string | null; at?: number; meta?: Record<string, unknown> | null }): {
  ok: boolean; reason: string | null;
  receipt: { destination: string; id: string | null; at: number; meta: Record<string, unknown> | null } | null;
};

export function canDispatchProposal(input?: { proposal?: { sideEffectClass?: string } | null; confirmed?: boolean }): {
  ok: boolean; reason: string | null;
  action: "none" | "handoff_inert" | "dispatch_ui_only";
};

export function filterVisionArtifacts(
  input: { sessions?: unknown[]; evidence?: unknown[]; results?: unknown[] },
  opts?: {
    q?: string; projectId?: string | null;
    status?: "active" | "ended" | "cancelled" | null;
    privacyClass?: string | null; source?: string | null;
    since?: number; until?: number;
  },
): { sessions: unknown[]; evidence: unknown[]; results: unknown[] };

export function planImportApply(input?: {
  existing?: { sessions?: { id: string }[]; evidence?: { id: string; frame?: { hash?: string | null } }[] };
  incoming?: { sessions?: { id: string }[]; evidence?: { id: string; frame?: { hash?: string | null } }[] };
  conflictActions?: Record<string, "replace" | "skip">;
}): {
  sessions: { id: string | null; action: "create" | "replace" | "skip"; reason: string | null }[];
  evidence: { id: string | null; action: "create" | "replace" | "skip"; reason: string | null }[];
  conflicts: { kind: "session" | "evidence"; id: string; reason: string }[];
};

export function shouldConfirmVisionExit(input?: {
  session?: LifecycleSession | null;
  resultDraftDirty?: boolean;
  regionsDirty?: boolean;
  evidenceNotesDirty?: boolean;
}): boolean;