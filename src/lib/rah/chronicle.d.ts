export type ChronicleKind = "command" | "memory" | "approval" | "connection" | "summary";
export interface ChronicleEntry {
  id: string;
  kind: ChronicleKind;
  ts: number;
  title: string;
  detail?: string;
  tone?: "ok" | "warn" | "bad" | "info";
  sourceId?: string;
  type?: string;
}
export const CHRONICLE_KINDS: ChronicleKind[];
export function buildChronicleEntries(sources: {
  commands?: unknown[]; projectMemory?: unknown[]; approvals?: unknown[];
}): ChronicleEntry[];
export function dayKey(ts: number): string;
export function groupByDay(entries: ChronicleEntry[]): { day: string; items: ChronicleEntry[] }[];
export function filterEntries(entries: ChronicleEntry[], opts?: { q?: string; kinds?: Iterable<ChronicleKind> }): ChronicleEntry[];
export function buildDailySummaryDraft(entries: ChronicleEntry[], opts?: { now?: number }): {
  day: string; text: string;
  counts: { commands: number; approvals: number; memory: number; milestones: number; blockers: number; decisions: number; nextActions: number };
  requiresExplicitSave: true;
};
export function exportChronicleJson(entries: ChronicleEntry[]): string;
export function exportChronicleMarkdown(entries: ChronicleEntry[]): string;