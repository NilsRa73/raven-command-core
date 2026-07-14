export const VISION_SESSIONS_SCHEMA_VERSION: number;
export const SESSION_STATUSES: readonly ("active" | "ended" | "cancelled")[];
export const PRIVACY_CLASSES: readonly string[];
export const PRIVACY_CLASS_LABEL: Record<string, string>;
export const PRIVACY_HEURISTIC_DISCLAIMER: string;
export const REVIEW_STATES: readonly string[];
export const REVIEW_EVENTS: readonly string[];
export const FRAME_VARIANTS: readonly ("original" | "redacted")[];
export const VISION_ACTION_CATALOG: readonly {
  id: string; category: string; sideEffectClass: "ui_only" | "workflow_handoff" | "denied";
}[];
export const SIDE_EFFECT_CLASSES: readonly ("ui_only" | "workflow_handoff" | "denied")[];
export const CONFIDENCE_MIN_FOR_AUTO: number;
export const VISION_NO_FABRICATION: Readonly<Record<string, boolean>>;

export type SessionStatus = "active" | "ended" | "cancelled";
export type PrivacyClass = string;
export type ReviewState = string;
export type FrameVariant = "original" | "redacted";

export interface FrameMetadata {
  width: number; height: number; sizeBytes: number;
  capturedAt: number | null; mime: string;
  captureMethod: "image-capture" | "video-canvas" | "unknown";
  hash: string | null;
}
export interface RedactionRegion { id: string; x: number; y: number; w: number; h: number; label: string | null }
export interface PrivacyClassification { class: PrivacyClass; reasons: string[]; disclaimer?: string }

export interface VisionSession {
  id: string; schemaVersion: number;
  projectId: string | null; title: string; question: string; presetId: string | null;
  mode: "fast" | "deep"; sourceLabel: string; displaySurface: string | null; apiLabel: string;
  startedAt: number; stoppedAt: number | null; createdAt: number; updatedAt: number;
  captureCount: number; consented: boolean; privacyMode: "standard" | "strict";
  status: SessionStatus; evidenceIds: string[]; workflowProposalIds: string[];
}
export interface EvidenceRecord {
  id: string; schemaVersion: number; sessionId: string | null; projectId: string | null;
  createdAt: number; version: number; previousVersionId: string | null;
  frame: FrameMetadata; redactedFrame: FrameMetadata | null;
  redactionRegions: RedactionRegion[]; privacy: PrivacyClassification;
  notes: string; checksum: string | null; linkedResultId: string | null;
  savedTo: string[]; sourceLabel: string; apiLabel: string;
}

export function normalizeVisionSession(input?: Partial<VisionSession> & { now?: number }): VisionSession;
export function resolveProjectForSession(args?: { requestedProjectId?: string | null; projects?: { id: string; name?: string }[]; activeProjectId?: string | null }): { projectId: string | null; projectName: string; fallback: boolean };
export function shapeFrameMetadata(input?: Partial<FrameMetadata>): FrameMetadata;
export function classifyPrivacy(input?: { userMarkedSensitive?: boolean; note?: string; question?: string; sourceLabel?: string }): PrivacyClassification;
export function classIsSensitive(cls: PrivacyClass): boolean;
export function validateRedactionRegion(region: Partial<RedactionRegion>, frame?: { width?: number; height?: number }): { ok: boolean; region?: RedactionRegion; reason?: string };
export function validateRedactionRegions(regions: Partial<RedactionRegion>[], frame?: { width?: number; height?: number }): { accepted: RedactionRegion[]; rejected: { region: unknown; reason: string }[] };
export function selectFrameVariant(args?: { regions?: unknown[]; privacyClass?: PrivacyClass; userChoice?: FrameVariant | null }): { variant: FrameVariant; defaultVariant: FrameVariant; requiresSecondConfirmation: boolean };
export function areFramesDuplicate(a: FrameMetadata | null, b: FrameMetadata | null): boolean;
export function nextReviewState(current: ReviewState, event: string): ReviewState;
export function shapeEvidenceRecord(input?: Partial<EvidenceRecord>): EvidenceRecord;
export function versionEvidence(prev: EvidenceRecord, patch?: Partial<EvidenceRecord>, opts?: { now?: number; id?: string }): EvidenceRecord;
export function classifyActionSideEffect(intentId: string): { allowed: boolean; sideEffectClass: string; category?: string; reason?: string };
export function isLowConfidence(confidence: number): boolean;
export function proposeSafeAction(args: { intentId: string; params?: Record<string, unknown>; confidence?: number; ambiguous?: boolean; sessionId?: string | null; evidenceId?: string | null; question?: string }): { ok: boolean; reason: string | null; proposal: unknown | null };
export function proposeWorkflowHandoff(args: { title?: string; steps?: unknown[]; sessionId?: string | null; evidenceId?: string | null; question?: string; projectId?: string | null }): { ok: boolean; reason: string | null; proposal: unknown | null };
export function buildConfirmationPayload(args: { proposal: unknown; evidence?: EvidenceRecord | null; approvalStatus?: string }): { ok: boolean; reason: string | null; payload: unknown | null };
export function computeSessionStatistics(sessions?: VisionSession[], evidence?: EvidenceRecord[]): { sessions: number; active: number; ended: number; cancelled: number; totalCaptures: number; evidenceCount: number; sensitiveCount: number };
export function filterVisionHistory(sessions: VisionSession[], opts?: { q?: string; projectId?: string | null; status?: SessionStatus | null; privacyClass?: PrivacyClass | null; source?: string | null; since?: number; until?: number }): VisionSession[];
export function exportVisionHistoryJson(payload: { sessions?: VisionSession[]; evidence?: EvidenceRecord[]; results?: unknown[] }): string;
export function exportVisionHistoryMarkdown(payload: { sessions?: VisionSession[]; evidence?: EvidenceRecord[]; results?: unknown[] }): string;
export function shouldConfirmVisionDiscard(args?: { hasCapturedFrame?: boolean; regionsDirty?: boolean; resultDraftDirty?: boolean; evidenceNotesDirty?: boolean; proposalDraftDirty?: boolean; reviewState?: ReviewState }): boolean;
export function validateImportPayload(raw: unknown): { ok: boolean; reason: string | null; parsed: { schemaVersion: number; sessions: VisionSession[]; evidence: EvidenceRecord[]; results: unknown[] } | null };
export function mergeVisionImport(args: { existing?: { sessions?: VisionSession[]; evidence?: EvidenceRecord[] }; incoming: { sessions?: VisionSession[]; evidence?: EvidenceRecord[] }; strategy?: "skip" | "replace" }): { merged: { sessions: VisionSession[]; evidence: EvidenceRecord[] }; skipped: { sessions: { id: string | null; reason: string }[]; evidence: { id: string | null; reason: string }[] }; replaced: { sessions: string[]; evidence: string[] } };
export function detectAmbiguity(args?: { question?: string; evidenceId?: string | null; extra?: boolean }): boolean;
export function shapeRuntimeMetadata(input?: { provider?: string | null; model?: string | null; transport?: string | null; engine?: string | null; latencyMs?: number | null }): { provider: string | null; model: string | null; transport: string | null; engine: string | null; latencyMs: number | null };