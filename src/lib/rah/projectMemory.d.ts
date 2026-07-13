export type MemoryType =
  | "note" | "decision" | "milestone" | "blocker"
  | "next_action" | "daily_log" | "fact";

export interface ProjectMemoryRecord {
  id: string;
  projectId: string | null;
  title: string;
  content: string;
  type: MemoryType;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  source: string;
  archived: boolean;
  pinned: boolean;
}

export const MEMORY_TYPES: MemoryType[];
export const MEMORY_TYPE_LABEL: Record<MemoryType, string>;
export const MEMORY_INJECTION_MARKER: string;
export const MEMORY_INJECTION_END: string;
export const NO_SILENT_SAVE: { suggestionsRequireExplicitConfirm: true };

export interface FilterOpts {
  q?: string;
  types?: MemoryType[];
  projectId?: string | null;
  includeArchived?: boolean;
}
export function filterMemories(list: ProjectMemoryRecord[], opts?: FilterOpts): ProjectMemoryRecord[];

export function selectRelevantForPrompt(
  list: ProjectMemoryRecord[],
  opts?: { projectId?: string | null; limit?: number },
): ProjectMemoryRecord[];

export function buildMemoryInjectionBlock(
  records: ProjectMemoryRecord[],
  opts?: { projectName?: string },
): string;

export interface WelcomeSummary {
  projectId: string | null;
  lastMilestone: ProjectMemoryRecord | null;
  currentBlocker: ProjectMemoryRecord | null;
  nextAction: ProjectMemoryRecord | null;
  generatedAt: number;
}
export function selectWelcomeSummary(
  list: ProjectMemoryRecord[],
  opts?: { projectId?: string | null; now?: number },
): WelcomeSummary;

export function bucketToday(list: ProjectMemoryRecord[], now?: number): ProjectMemoryRecord[];
export function bucketRecent(list: ProjectMemoryRecord[], now?: number, days?: number): ProjectMemoryRecord[];
export function bucketPinned(list: ProjectMemoryRecord[]): ProjectMemoryRecord[];
export function bucketByProject(list: ProjectMemoryRecord[]): Map<string, ProjectMemoryRecord[]>;

export interface MemorySuggestion {
  _suggestion: true;
  draft: Omit<ProjectMemoryRecord, "id" | "createdAt" | "updatedAt">;
}
export function makeMemorySuggestionFromCommand(
  cmd: { prompt?: string; resultSummary?: string; status?: string; agents?: string[] } | null | undefined,
  opts?: { projectId?: string | null },
): MemorySuggestion | null;

export interface MemoryDiagnostics {
  total: number;
  pinned: number;
  archived: number;
  global: number;
  byType: Record<MemoryType, number>;
}
export function memoryDiagnostics(list: ProjectMemoryRecord[]): MemoryDiagnostics;