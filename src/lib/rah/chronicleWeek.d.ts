import type { ChronicleEntry, ChronicleKind, ChronicleSource } from "./chronicle.js";

export interface WeekBounds {
  startMs: number; endMs: number;
  startDate: Date; endDate: Date;
}
export interface IsoWeek { year: number; week: number; label: string; }
export interface WeeklyEvidence {
  kind: ChronicleKind; id: string; ts: number;
  type?: string; projectId?: string | null;
}
export interface WeeklyDraftMeta {
  projectScope: string | null | undefined;
  projectName: string;
  weekLabel: string;
  bounds: { startIso: string; endIso: string };
  generatedAt: number;
  requiresExplicitSave: true;
  counts: {
    completed: number; decisions: number; blockers: number; nextSteps: number;
    approvals: number; workflows: number; commands: number; memory: number;
  };
}
export interface WeeklyDraft {
  text: string;
  meta: WeeklyDraftMeta;
  evidence: WeeklyEvidence[];
}
export interface ExportMetadata {
  exportedAt: string;
  scope: string;
  filter: {
    q: string; kinds: ChronicleKind[]; sources: ChronicleSource[];
    from: string | null; to: string | null;
  };
  bounds: { startIso: string; endIso: string; label: string } | null;
}
export const CHRONICLE_SOURCES: ChronicleSource[];
export function weekBoundsFromDate(d: Date): WeekBounds;
export function shiftWeek(bounds: WeekBounds, delta: number): WeekBounds;
export function isoWeek(d: Date): IsoWeek;
export function formatWeekRange(b: WeekBounds): string;
export function buildWeeklyDraft(opts: {
  project: { id: string; name?: string } | null;
  projectScope: string | null | undefined;
  entries: ChronicleEntry[];
  memory: unknown[];
  bounds: WeekBounds;
  now?: number;
}): WeeklyDraft;
export function findExistingWeeklySummary(
  memory: unknown[],
  projectScope: string | null,
  weekLabel: string,
): unknown | null;
export function buildSaveableWeeklySummary(
  draft: WeeklyDraft,
  opts?: { versionSuffix?: string | null },
): {
  projectId: string | null;
  title: string;
  content: string;
  type: "weekly_log";
  tags: string[];
  source: string;
  archived: false;
  pinned: false;
  evidence: WeeklyEvidence[];
};
export function buildExportMetadata(opts: {
  filter: { q: string; kinds: Set<ChronicleKind> | ChronicleKind[]; sources: Set<ChronicleSource> | ChronicleSource[]; from: number | null; to: number | null };
  bounds: WeekBounds | null;
  projectScope: string | null | undefined;
  projects: { id: string; name: string }[];
}): ExportMetadata;
export function exportFilteredChronicleJson(entries: ChronicleEntry[], meta: ExportMetadata): string;
export function exportFilteredChronicleMarkdown(entries: ChronicleEntry[], meta: ExportMetadata): string;
export function exportWeeklyDraftJson(draft: WeeklyDraft): string;
export function exportWeeklyDraftMarkdown(draft: WeeklyDraft): string;
