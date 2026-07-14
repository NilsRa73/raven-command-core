import type { ProjectMemoryRecord } from "./projectMemory";

export type RavenMode = "fast" | "deep";
export type MemoryPriority = "critical" | "active" | "supporting" | "archived";
export type RouteLane =
  | "local_quick_action" | "raven_agent" | "planning_deep" | "approval_required";

export const RAVEN_MODES: RavenMode[];
export const RAVEN_MODE_LABEL: Record<RavenMode, string>;
export const RAVEN_MODE_META: Record<RavenMode, {
  label: string; icon: string; tagline: string; target: string;
  contextLimit: number; perItemChars: number;
  includeSupporting: boolean; includeArchivedSearchable: boolean;
}>;
export const PRIORITY_ORDER: MemoryPriority[];
export const PRIORITY_LABEL: Record<MemoryPriority, string>;

export const ROUTE_LANES: RouteLane[];
export const ROUTE_LABEL: Record<RouteLane, string>;
export const ROUTE_TARGET: Record<RouteLane, string>;

export function derivePriority(rec: Partial<ProjectMemoryRecord> | null | undefined): MemoryPriority;
export function scoreRelevance(rec: Partial<ProjectMemoryRecord>, opts?: { now?: number; query?: string }): number;
export function reasonForInclusion(rec: Partial<ProjectMemoryRecord>, opts?: { query?: string }): string;

export interface SelectedItem {
  rec: ProjectMemoryRecord;
  priority: MemoryPriority;
  score: number;
  reason: string;
  forcedPin: boolean;
}

export function selectContextForMode(list: ProjectMemoryRecord[], opts?: {
  mode?: RavenMode; projectId?: string | null; pinnedIds?: Iterable<string>;
  excludedIds?: Iterable<string>; query?: string; now?: number;
}): SelectedItem[];

export function truncateForMode(text: string, mode: RavenMode): string;

export interface ContextPacket {
  mode: RavenMode;
  text: string;
  items: SelectedItem[];
  approxChars: number;
  approxTokens: number;
  generatedAt: number;
  compressionPct: number;
  selectedIds: string[];
  packetHash: string;
  parityId: string;
  projectId: string | null;
  projectName: string | null;
}

export function deterministicHash(str: string): string;

export function buildContextPacket(list: ProjectMemoryRecord[], opts?: {
  mode?: RavenMode; projectId?: string | null; pinnedIds?: Iterable<string>;
  excludedIds?: Iterable<string>; query?: string; now?: number;
  project?: { name?: string | null; description?: string | null; goals?: string | null } | null;
}): ContextPacket;

export interface RouteDecision {
  lane: RouteLane; label: string; target: string; reasons: string[]; mode: RavenMode;
}
export function classifyRoute(prompt: string, opts?: {
  mode?: RavenMode; approvalMode?: "advisory" | "ask_every" | "trusted_low_risk";
}): RouteDecision;

export function healthCheck(input: {
  list: ProjectMemoryRecord[];
  storageAvailable: boolean;
  modePersisted: boolean;
}): { ok: boolean; problems: string[]; counts: { total: number; critical: number; active: number } };
