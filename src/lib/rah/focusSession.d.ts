export type FocusStatus =
  | "draft" | "running" | "paused" | "completed" | "cancelled" | "invalid";

export interface FocusSession {
  id: string;
  projectId: string | null;
  title: string;
  mode: "fast" | "deep";
  plannedDurationMs: number | null;
  agents: string[];
  breakReminderMinutes: number | null;
  linkedWorkflowId: string | null;
  linkedRunId: string | null;
  notes: string;
  source: string;
  startedAt: number | null;
  pausedAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  accumulatedPausedMs: number;
  interruptions: { ts: number; note: string }[];
  status: FocusStatus;
  createdAt: number;
  updatedAt: number;
}

export interface FocusTiming {
  status: FocusStatus | "unknown";
  elapsedMs: number;
  remainingMs: number | null;
  overdue: boolean;
  warning?: string;
}

export function newFocusDraft(input?: Partial<FocusSession> & { now?: number }): FocusSession;
export function isFocusDraftDirty(draft: FocusSession | null | undefined, projectId?: string | null): boolean;
export function isActive(rec: FocusSession | null | undefined): boolean;
export function start(draft: FocusSession, now: number): FocusSession;
export function pause(rec: FocusSession, now: number): FocusSession;
export function resume(rec: FocusSession, now: number): FocusSession;
export function complete(rec: FocusSession, now: number): FocusSession;
export function cancel(rec: FocusSession, now: number): FocusSession;
export function reset(rec: FocusSession, now: number): FocusSession;
export function logInterruption(rec: FocusSession, note: string, now: number): FocusSession;
export function computeTiming(rec: FocusSession | null, now: number): FocusTiming;
export function restoreAfterReload(rec: FocusSession | null, now: number): FocusSession | null;
export function formatDuration(ms: number): string;
export function buildCompletionDraft(rec: FocusSession, now: number): any;
export function filterHistory(records: FocusSession[], filter?: { projectId?: string | null; status?: string; since?: number; until?: number }): FocusSession[];
export function shapeHistoryForExport(records: FocusSession[], meta?: { now?: number; projectId?: string | null; projectName?: string | null }): any;

export interface FocusCommand { id: string; title: string; action: string; section: string; shortcut?: string; }
export const FOCUS_COMMANDS: FocusCommand[];
export function rankCommands<T extends { title?: string }>(commands: T[], query: string): T[];
export function shouldSuppressShortcut(target: EventTarget | null, opts?: { key?: string; escapeAllowed?: boolean }): boolean;