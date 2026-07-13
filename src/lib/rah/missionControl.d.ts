export interface ReadinessCheck { id: string; label: string; ok: boolean; weight: number; detail?: string }
export interface ReadinessResult { score: number; checks: ReadinessCheck[] }
export function computeReadiness(inputs: {
  bridgeSnapshot: { ui?: string } | null;
  engine: string;
  projectSelected: boolean;
  memoryEnabled: boolean;
  voiceSupported: boolean;
  visionSupported: boolean;
}): ReadinessResult;

export type PrivacyLabel = "LOCAL" | "MIXED" | "CLOUD" | "OFFLINE";
export interface PrivacyStatus { label: PrivacyLabel; explanation: string }
export function computePrivacyStatus(inputs: {
  engine: string; transport: string; bridgeSnapshot: { ui?: string } | null;
}): PrivacyStatus;

export interface MissionSuggestion { title: string; source: string }
export interface TodaysMission {
  blocker: any | null;
  nextAction: any | null;
  lastMilestone: any | null;
  suggestions: MissionSuggestion[];
}
export function deriveTodaysMission(inputs: {
  projectMemory: any[]; projectId: string | null; commands?: any[]; now?: number; limit?: number;
}): TodaysMission;

export interface ActivityRow { ts: number; kind: "command" | "memory"; title: string; source: string; status?: string }
export function mergeRecentActivity(inputs: { commands?: any[]; projectMemory?: any[]; limit?: number }): ActivityRow[];

export interface Telemetry {
  available: boolean;
  cpuLine: string; memoryLine: string; platformLine: string;
  hostUserLine: string; latencyLine: string; gpuLine: string;
}
export function formatTelemetry(sys: any, meta?: { latencyMs?: number }): Telemetry;

export interface AgentTeamCounts {
  phase: string; active: boolean;
  runningTasks: number; completedRuns: number; failedRuns: number; totalRuns: number;
  currentRunId?: string;
}
export function agentTeamCounts(state: any, agentStats: any): AgentTeamCounts;

export const FOCUS_MODE_KEY: string;
export function loadFocusMode(): boolean;
export function saveFocusMode(on: boolean): void;