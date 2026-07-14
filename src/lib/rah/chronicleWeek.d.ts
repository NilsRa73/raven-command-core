import type { ChronicleEntry, ChronicleKind, ChronicleSource } from "./chronicle";

export interface WeekBounds { startMs: number; endMs: number; startDate: Date; endDate: Date }
export function weekBoundsFromDate(input: number | Date, opts?: { weekStartsOn?: number }): WeekBounds;
export function shiftWeek(bounds: WeekBounds, delta: number): WeekBounds;
export function isoWeek(input: number | Date): { year: number; week: number; label: string };
export function formatWeekRange(bounds: WeekBounds, locale?: string): string;

export type ProjectScope = string | null | undefined;

export function entriesInWeek(entries: ChronicleEntry[], bounds: WeekBounds, projectScope?: ProjectScope): ChronicleEntry[];

export interface WeeklyAggregate {
  bounds: WeekBounds; projectScope: ProjectScope;
  counts: Record<string, number>;
  completedCommands: ChronicleEntry[]; completedWorkflows: ChronicleEntry[];
  decisions: any[]; blockers: any[]; milestones: any[]; nextActions: any[];
  approvalsResolved: ChronicleEntry[]; workflowActivity: ChronicleEntry[];
  failedCommands: ChronicleEntry[]; openIssues: any[];
}
export function aggregateWeek(opts: { entries?: ChronicleEntry[]; memory?: any[]; bounds: WeekBounds; projectScope?: ProjectScope }): WeeklyAggregate;

export interface EvidenceRef {
  id: string; kind: string; ts: number;
  projectId: string | null; type: string | null;
}
export interface WeeklyDraft {
  text: string;
  evidence: EvidenceRef[];
  agg: WeeklyAggregate;
  meta: {
    projectId: string;
    projectScope: ProjectScope;
    projectName: string;
    weekLabel: string;
    bounds: WeekBounds;
    generatedAt: number;
    requiresExplicitSave: true;
  };
}
export function buildWeeklyDraft(opts: {
  project?: { id?: string; name?: string } | null;
  projectScope?: ProjectScope;
  entries?: ChronicleEntry[]; memory?: any[]; bounds: WeekBounds; now?: number;
}): WeeklyDraft;

export function weeklySummaryTitle(projectName: string, weekLabel: string): string;
export function findExistingWeeklySummary(memoryList: any[], projectScope: ProjectScope, weekLabel: string): any | null;
export function buildSaveableWeeklySummary(draft: WeeklyDraft, opts?: { versionSuffix?: string | null }): any;

export interface ExportMetadata {
  exportedAt: string; projectScope: string; projectName: string;
  filter: { q: string; kinds: ChronicleKind[]; sources: ChronicleSource[]; from: number | null; to: number | null };
  weekBounds: { startMs: number; endMs: number } | null;
}
export function buildExportMetadata(opts?: {
  filter?: { q?: string; kinds?: Iterable<ChronicleKind>; sources?: Iterable<ChronicleSource>; from?: number | null; to?: number | null };
  bounds?: WeekBounds | null; projectScope?: ProjectScope;
  projects?: { id: string; name: string }[];
}): ExportMetadata;

export function exportFilteredChronicleJson(entries: ChronicleEntry[], meta: ExportMetadata): string;
export function exportFilteredChronicleMarkdown(entries: ChronicleEntry[], meta: ExportMetadata): string;
export function exportWeeklyDraftJson(draft: WeeklyDraft): string;
export function exportWeeklyDraftMarkdown(draft: WeeklyDraft): string;

export const CHRONICLE_SOURCES: ChronicleSource[];