import type { Project, CommandRecord, Approval, ProjectMemoryRecord } from "./db";

export const MORNING_LAST_SEEN_KEY: string;

export function dayKey(ts: number): string;
export function greetingPhase(ts: number): { phase: "morning"|"afternoon"|"evening"|"night"; salutation: string };

export interface WelcomeBack {
  today: string;
  isFirstVisitToday: boolean;
  salutation: string;
  phase: "morning"|"afternoon"|"evening"|"night";
  userName: string;
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectIcon: string | null;
  currentTask: string | null;
  nextTask: string | null;
  blocker: string | null;
  lastMilestone: string | null;
  estimatedCompletionAt: number | null;
  pendingApprovals: number;
  recentProjects: { id: string; name: string; icon: string; updatedAt: number }[];
  commandsSinceLast: number;
}
export function buildWelcomeBack(inputs: {
  now?: number;
  lastSeenDay?: string | null;
  userName?: string;
  activeProject: Project | null;
  projects: Project[];
  projectMemory: ProjectMemoryRecord[];
  commands: CommandRecord[];
  approvals: Approval[];
}): WelcomeBack;

export function markMorningSeen(ts?: number): void;
export function loadMorningLastSeen(): string | null;
export function formatEta(estimatedAt: number | null | undefined, now?: number): string | null;
