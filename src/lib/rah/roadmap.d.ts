export type RoadmapStatus = "backlog" | "planned" | "in_progress" | "blocked" | "done";
export type RoadmapColumn = RoadmapStatus | "unassigned";
export type RoadmapPriority = "low" | "normal" | "high" | "critical";

export interface RoadmapMilestone {
  id: string;
  projectId: string | null;
  title: string;
  description: string;
  status: RoadmapStatus | "";
  rawStatus: string | null;
  priority: RoadmapPriority;
  targetDate: string | null;
  owner: string | null;
  dependencies: string[];
  evidenceIds: string[];
  order: number;
  createdAt: number;
  updatedAt: number;
  source: string;
}

export interface RoadmapValidationError {
  milestoneId?: string;
  code: "empty_title" | "invalid_status" | "invalid_date" | "duplicate_id" | "self_dependency" | "missing_dependency" | "circular_dependency";
  message: string;
}

export const ROADMAP_STATUSES: RoadmapStatus[];
export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string>;
export const ROADMAP_STATUS_ORDER: Record<RoadmapStatus, number>;
export const ROADMAP_PRIORITIES: RoadmapPriority[];
export const ROADMAP_COLUMNS: readonly RoadmapColumn[];
export const UNASSIGNED_COLUMN: "unassigned";

export function normalizeMilestone(raw: unknown): RoadmapMilestone | null;
export function groupByColumn(
  milestones: unknown[],
  opts?: { projectId?: string | null },
): Record<RoadmapColumn, RoadmapMilestone[]>;
export function moveMilestone(
  milestones: unknown[],
  id: string,
  targetStatus: RoadmapColumn,
  targetIndex: number,
): RoadmapMilestone[];
export function reorderWithinColumn(
  milestones: unknown[],
  id: string,
  delta: 1 | -1 | number,
): RoadmapMilestone[];
export function isRoadmapDirty(saved: unknown[], draft: unknown[]): boolean;
export function validateRoadmap(milestones: unknown[]): { valid: boolean; errors: RoadmapValidationError[] };
export function exportRoadmapJson(input: { project: { id: string; name: string } | null; milestones: unknown[]; exportedAt?: number }): unknown;
export function exportRoadmapMarkdown(input: { project: { id: string; name: string } | null; milestones: unknown[]; exportedAt?: number }): string;

export const NO_SILENT_SAVE: Readonly<{
  roadmapRequiresExplicitSave: true;
  dragUpdatesInMemoryDraftOnly: true;
}>;