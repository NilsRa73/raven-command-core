import type { ProjectMemoryRecord } from "./projectMemory";
import type { Project, CommandRecord, Approval, FileItem } from "./db";

export interface OverviewSummary {
  id: string;
  name: string;
  icon: string;
  description: string;
  goals: string;
  status: string;
  priority: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastActivityTs: number;
  lastMilestone: ProjectMemoryRecord | null;
  currentBlocker: ProjectMemoryRecord | null;
  nextAction: ProjectMemoryRecord | null;
  memoryCount: number;
  linkedFileCount: number;
  recentCommandCount: number;
  pendingApprovalCount: number;
}

export interface HealthCheck {
  id: string;
  label: string;
  ok: boolean;
  weight: number;
  detail?: string;
}
export interface HealthResult { score: number; checks: HealthCheck[]; }

export interface TimelineRow {
  ts: number;
  kind: "memory" | "command" | "approval";
  id: string;
  title: string;
  detail?: string;
  source: string;
  status?: string;
  type?: string;
}

export interface RoadmapItem { id: string; source: string; title: string }
export interface RoadmapResult {
  now: RoadmapItem[];
  next: RoadmapItem[];
  later: RoadmapItem[];
  guidance: { now: string | null; next: string | null; later: string | null };
}

export interface ProjectProfile {
  projectId: string;
  topTags: string[];
  stances: { decisions: number; milestones: number; blockers: number; nextActions: number; notes: number };
  linkedFiles: number;
  commandCount: number;
  summary: string;
  aiEnhanced: boolean;
}

export interface BriefContext {
  projectName: string;
  projectGoals: string;
  description: string;
  memoryRecords: { type: string; title: string; content: string; tags: string[]; pinned: boolean }[];
  files: { name: string; mime: string; size: number }[];
  recentCommands: { prompt: string; status: string }[];
  requiresExplicitConfirmToSave: true;
}

export interface ContinueProjectPreview {
  projectId: string;
  projectName: string;
  icon: string;
  blocker: string | null;
  nextAction: string | null;
  lastMilestone: string | null;
  memoryPreview: { type: string; title: string; pinned: boolean }[];
  files: number;
  commands: number;
  sentAutomatically: false;
}

export function buildProjectOverview(inputs: {
  project: Project | null | undefined;
  memory: ProjectMemoryRecord[];
  commands: CommandRecord[];
  approvals: Approval[];
  files: FileItem[];
  now?: number;
}): OverviewSummary | null;

export function computeProjectHealth(inputs: {
  project: Project | null | undefined;
  memory: ProjectMemoryRecord[];
  commands: CommandRecord[];
  files: FileItem[];
  bridgeSnapshot: { ui?: string } | null;
  engine: string;
  now?: number;
}): HealthResult;

export function buildProjectTimeline(inputs: {
  project: Project | null | undefined;
  memory: ProjectMemoryRecord[];
  commands: CommandRecord[];
  approvals: Approval[];
  limit?: number;
}): TimelineRow[];

export function deriveRoadmap(inputs: {
  memory: ProjectMemoryRecord[];
  projectId: string | null;
}): RoadmapResult;

export function deterministicProjectProfile(inputs: {
  project: Project | null | undefined;
  memory: ProjectMemoryRecord[];
  files: FileItem[];
  commands: CommandRecord[];
}): ProjectProfile | null;

export function buildProjectBriefContext(inputs: {
  project: Project | null | undefined;
  memory: ProjectMemoryRecord[];
  files: FileItem[];
  commands: CommandRecord[];
  limit?: number;
}): BriefContext | null;

export function buildContinueProjectPreview(inputs: {
  project: Project | null | undefined;
  memory: ProjectMemoryRecord[];
  commands: CommandRecord[];
  files: FileItem[];
  limit?: number;
}): ContinueProjectPreview | null;

export const PROJECT_DNA_TABS: readonly ["overview","memory","files","timeline","decisions","roadmap"];
export const NO_SILENT_SAVE: Readonly<{
  briefRequiresExplicitSave: true;
  aiEnhancementRequiresExplicitClick: true;
  continueProjectDoesNotSendAutomatically: true;
}>;
