export type TeamMode = "fast" | "team_review" | "full_council" | "manual";
export const TEAM_MODES: TeamMode[];
export const TEAM_MODE_LABEL: Record<TeamMode, string>;
export const MAX_CONCURRENT: number;

export interface ScoredSpecialist { id: string; score: number; idx: number }
export function scoreSpecialists(prompt: string): ScoredSpecialist[];

export function pickSpecialists(
  prompt: string,
  teamMode: TeamMode,
  opts?: { manualSelection?: string[] },
): string[];

export interface Settled<T = unknown> {
  status: "fulfilled" | "rejected" | "cancelled";
  value?: T;
  reason?: unknown;
}
export interface SettledArray<T = unknown> extends Array<Settled<T>> {
  peakInFlight?: number;
}
export function runWithConcurrency<T, I>(
  items: I[],
  worker: (item: I, index: number) => Promise<T>,
  opts?: { concurrency?: number; signal?: AbortSignal },
): Promise<SettledArray<T>>;

export interface SpecialistRuntimeInput {
  agentName: string;
  provider?: string;
  model?: string;
  engine?: "cloud" | "lmstudio" | "ollama" | "demo" | string;
  transport?: "bridge" | "direct";
  latencyMs?: number;
}
export function specialistRuntimeLine(i: SpecialistRuntimeInput): string;

export type PrivacyLabel = "LOCAL" | "MIXED" | "CLOUD" | "UNKNOWN";
export function privacyLabel(routes: { engine?: string }[]): PrivacyLabel;

export interface PromptCtx {
  projectName?: string;
  projectGoals?: string;
  projectMemoryBlock?: string;
}
export function buildSpecialistUserPrompt(userPrompt: string, ctx?: PromptCtx): string;

export type TaskState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface TaskSummary {
  agentId: string;
  agentName: string;
  state: TaskState;
  text?: string;
  error?: string;
}
export function buildSynthesisPrompt(userPrompt: string, taskStates: TaskSummary[]): string;

export interface TeamSummarySuggestion {
  _suggestion: true;
  draft: {
    projectId: string | null;
    title: string;
    content: string;
    type: string;
    tags: string[];
    source: string;
    archived: boolean;
    pinned: boolean;
  };
}
export function buildTeamSummarySuggestion(input: {
  userPrompt: string;
  taskStates: TaskSummary[];
  synthesis: string;
  projectId?: string | null;
}): TeamSummarySuggestion | null;

export interface EventLogger {
  events: Array<{ ts: number; kind: string } & Record<string, unknown>>;
  log(kind: string, payload?: Record<string, unknown>): void;
}
export function makeEventLogger(): EventLogger;

export function isolateFailures<T = unknown>(settled: Settled<T>[]): Array<{
  index: number; ok: boolean; failed: boolean; cancelled: boolean;
  value: T | null; reason: string | null;
}>;

export const ORCHESTRATION_INVARIANTS: Readonly<{
  maxConcurrent: number;
  masterBrainNeverSpecialist: true;
  synthesisNeverForgesResults: true;
  neverPersistIntermediateSpecialistOutputs: true;
  saveTeamSummaryRequiresExplicitConfirm: true;
  approvalCardsRequiredForSideEffects: true;
  runtimeIdentityGeneratedByApp: true;
}>;