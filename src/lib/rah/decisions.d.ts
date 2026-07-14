export type DecisionStatus = "proposed" | "accepted" | "superseded" | "reversed";

export interface DecisionRecord {
  id: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

export interface DecisionVersion {
  id: string;
  decisionId: string;
  versionNumber: number;
  createdAt: number;
  title: string;
  content: string;
  rationale: string;
  status: DecisionStatus;
  author: string | null;
  source: string;
  evidenceIds: string[];
  supersedesDecisionId: string | null;
  reversesDecisionId: string | null;
}

export interface DiffRow {
  field: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

export interface DuplicateCandidate {
  decisionId: string;
  similarity: number;
  title: string;
}

export const DECISION_STATUSES: DecisionStatus[];
export const DECISION_STATUS_LABEL: Record<DecisionStatus, string>;

export function normalizeVersion(raw: unknown): DecisionVersion | null;
export function normalizeDecision(raw: unknown): DecisionRecord | null;
export function makeInitialVersion(input: {
  decisionId: string; title: string; content?: string; rationale?: string;
  status?: DecisionStatus; author?: string | null; source?: string; evidenceIds?: string[];
  now?: number; versionId?: string;
}): DecisionVersion;
export function makeNextVersion(
  previousVersion: DecisionVersion,
  patch?: Partial<DecisionVersion>,
  opts?: { now?: number; versionId?: string },
): DecisionVersion;
export function groupVersions(versions: unknown[]): Map<string, DecisionVersion[]>;
export function latestVersions(versions: unknown[]): Map<string, DecisionVersion>;
export function diffVersions(a: unknown, b: unknown): DiffRow[];
export function findDuplicateCandidates(input: {
  draft: { decisionId?: string | null; title?: string; content?: string };
  decisions: unknown[]; versions: unknown[]; projectId?: string | null; threshold?: number;
}): DuplicateCandidate[];
export function isVersionDirty(latestVersion: DecisionVersion | null, draft: Partial<DecisionVersion>): boolean;
export function exportChangelogJson(input: {
  project: { id: string; name: string } | null;
  decisions: unknown[]; versions: unknown[]; exportedAt?: number;
}): unknown;
export function exportChangelogMarkdown(input: {
  project: { id: string; name: string } | null;
  decisions: unknown[]; versions: unknown[]; exportedAt?: number;
}): string;

export const NO_SILENT_SAVE: Readonly<{
  editCreatesNewVersion: true;
  historyIsImmutable: true;
  duplicateWarningIsNotAutoMerge: true;
  archivePreferredOverDelete: true;
}>;