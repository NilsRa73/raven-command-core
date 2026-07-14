export const GLOBAL_PROFILE_ID: string;
export const VOICE_PROFILES_SCHEMA_VERSION: number;
export const DEFAULT_CONFIDENCE_THRESHOLD: number;
export const LOW_CONFIDENCE_THRESHOLD: number;
export const ALLOWED_COMMAND_CATEGORIES: readonly string[];

export interface VoiceProfile {
  id: string;
  schemaVersion: number;
  projectId: string | null;
  name: string;
  locale: string;
  wakePhrase: string;
  alternatePhrases: string[];
  wakeConfidenceThreshold: number;
  pushToTalk: boolean;
  continuousListening: boolean;
  autoStopSilenceMs: number;
  preferredInputDeviceId: string | null;
  preferredInputDeviceLabel: string | null;
  defaultMode: "fast" | "deep";
  allowedCommandCategories: string[];
  enabled: boolean;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface VoiceSessionRecord {
  id: string;
  createdAt: number;
  updatedAt?: number;
  projectId: string | null;
  profileId: string | null;
  status: string;
  turns?: Array<{ role: string; text: string; ts: number }>;
  transcripts?: string[];
}

export interface VoiceTranscriptReview {
  id: string;
  schemaVersion: number;
  createdAt: number;
  projectId: string | null;
  profileId: string | null;
  sourceApi: string;
  locale: string | null;
  confidence: number | null;
  rawText: string;
  normalizedText: string;
  editedText: string | null;
  segments: string[];
  wakeMatch: unknown;
  status: "review" | "discarded" | "saved" | "prompt_sent" | "proposed" | "confirmed";
  saveDestination: string | null;
  proposalId: string | null;
  confirmationId: string | null;
}

export function normalizeProfile(input?: Partial<VoiceProfile> & { now?: number }): VoiceProfile;
export function normalizeLocale(input: unknown): string;
export function normalizeWakePhrase(input: unknown): string;
export function isValidProfile(input: unknown): boolean;
export function buildGlobalDefaultProfile(now?: number): VoiceProfile;
export function resolveProfileForProject(
  projectId: string | null | undefined,
  profiles?: VoiceProfile[],
  globalDefault?: VoiceProfile,
): { profile: VoiceProfile | null; matchedBy: "project" | "global_fallback" | "none"; fallback: boolean };

export interface WakeMatchResult {
  matched: boolean;
  reason: string;
  score: number;
  threshold: number;
  phrase: string | null;
  method: "exact" | "prefix" | "similarity" | "none";
  command: string;
  normalizedTranscript?: string;
}
export function matchWakePhrase(transcript: string, profile: VoiceProfile): WakeMatchResult;

export function buildTranscriptReview(input: {
  raw: string;
  now?: number;
  id?: string;
  projectId?: string | null;
  profileId?: string | null;
  sourceApi?: string;
  locale?: string | null;
  confidence?: number | null;
  wakeMatch?: unknown;
}): VoiceTranscriptReview;
export function normalizeTranscript(raw: unknown): string;
export function segmentTranscript(raw: unknown): string[];
export function isDuplicateTranscript(candidate: unknown, history?: unknown[], windowMs?: number, now?: number): boolean;

export interface VoiceCommandProposalTop {
  id: string;
  commandId: string;
  category: string;
  title: string;
  action: unknown;
  sideEffect: "ui_only" | "requires_approval" | "unknown";
  intentScore: number;
  sttConfidence: number | null;
  normalizedTranscript: string;
  profileId: string | null;
  projectId: string | null;
  requiresConfirmation: true;
}
export interface VoiceCommandProposal {
  status: "empty" | "no_match" | "low_confidence" | "ambiguous" | "ready";
  reason: string;
  top: VoiceCommandProposalTop | null;
  alternatives: VoiceCommandProposalTop[];
  confidenceOk: boolean;
  intentScore?: number;
  intentThreshold?: number;
  sttConfidence?: number | null;
}
export const VOICE_COMMAND_CATALOG: ReadonlyArray<{
  id: string; category: string; title: string; action: unknown; phrases: string[]; sideEffect: string;
}>;
export function proposeVoiceCommand(input: {
  transcript: string;
  profile?: VoiceProfile;
  confidence?: number | null;
  catalog?: typeof VOICE_COMMAND_CATALOG;
}): VoiceCommandProposal;
export function classifySideEffect(entry: { sideEffect?: string } | null | undefined): string;
export function buildConfirmationView(
  proposal: VoiceCommandProposalTop | null,
  opts?: { catalog?: typeof VOICE_COMMAND_CATALOG },
): unknown;

export interface ReadinessSummary {
  sttSupported: boolean;
  ttsSupported: boolean;
  micPermission: string;
  bridgeOnline: boolean;
  level: "unsupported" | "permission_not_requested" | "permission_unknown" | "ready";
  blockers: string[];
  canStart: boolean;
  honestCapabilityStatement: string;
}
export function buildReadinessSummary(input: {
  sttSupported?: boolean;
  ttsSupported?: boolean;
  micPermission?: string;
  bridgeOnline?: boolean;
}): ReadinessSummary;

export function summarizeSession(session: {
  turns?: Array<{ role: string; text: string; ts: number }>;
  transcripts?: Array<{ status?: string }>;
}): { userTurns: number; assistantTurns: number; transcripts: number; proposed: number; confirmed: number; saved: number };

export function filterVoiceHistory(rows: unknown[], filters?: {
  projectId?: string | null;
  profileId?: string | null;
  status?: string;
  since?: number;
  until?: number;
  q?: string;
}): unknown[];
export function shapeHistoryForExport(rows: unknown[]): unknown[];

export function isProfileDraftDirty(draft: Partial<VoiceProfile> | null, baseline: Partial<VoiceProfile> | null): boolean;
export function isReviewDraftDirty(draft: Partial<VoiceTranscriptReview> | null): boolean;

export function shapeProfileForExport(profile: VoiceProfile): {
  schemaVersion: number; exportedAt: string; profile: VoiceProfile;
};
export function validateProfileImport(payload: unknown): {
  ok: boolean; error: string | null; profiles: VoiceProfile[];
};
export function planProfileMerge(input: {
  incoming: VoiceProfile[]; existing?: VoiceProfile[]; decisions?: Record<string, "replace" | "skip">;
}): {
  ops: Array<{ op: "insert" | "replace" | "skip" | "conflict"; profile: VoiceProfile; previous?: VoiceProfile }>;
  hasConflicts: boolean; conflictIds: string[];
};

export function buildCleanupPrompt(rawText: string): string;
export function isCleanupSuspicious(before: string, after: string): boolean;