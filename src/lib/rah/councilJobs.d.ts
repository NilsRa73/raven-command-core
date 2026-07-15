import type { CouncilJobRow, CouncilJobStepRow, CouncilJobStatus, CouncilRole } from "./db";

export const COUNCIL_ROLES: CouncilRole[];
export const JOB_STATUSES: CouncilJobStatus[];
export const TRANSITIONS: Record<CouncilJobStatus, CouncilJobStatus[]>;

export function canTransition(from: CouncilJobStatus, to: CouncilJobStatus): boolean;
export function assertTransition(from: CouncilJobStatus, to: CouncilJobStatus): void;

export interface CreatedJob { job: CouncilJobRow; steps: CouncilJobStepRow[]; }
export function createJob(input: {
  projectId?: string | null; sessionId?: string | null;
  objective?: string; kind?: "project_review" | "custom";
  provider?: "deterministic" | "ai"; resumeRoute?: string;
}): CreatedJob;
export function projectReviewSteps(jobId: string, now?: number): CouncilJobStepRow[];

export function transitionJob(job: CouncilJobRow, to: CouncilJobStatus, patch?: Partial<CouncilJobRow>): CouncilJobRow;
export function transitionStep(step: CouncilJobStepRow, to: CouncilJobStatus, patch?: Partial<CouncilJobStepRow>): CouncilJobStepRow;

export interface ProjectReviewContext {
  project?: { name?: string; description?: string; status?: string; currentTask?: string; nextTask?: string } | null;
  sessions?: Array<{ id: string; title: string; objective?: string; status: string }>;
  checkpoints?: Array<{ id: string; note: string; nextAction?: string; sessionId: string; createdAt: number }>;
  memory?: Array<{ id: string; title: string; pinned?: boolean; archived?: boolean; type?: string; tags?: string[] }>;
  decisions?: Array<{ id: string; title: string }>;
  commands?: Array<{ id: string; prompt?: string; status?: string }>;
  roadmap?: Array<{ id: string; title: string; status?: string }>;
}
export interface ProjectReviewOutput {
  findings: Record<string, unknown>;
  outputByStepOrder: Record<number, string>;
  deterministic: boolean;
}
export function synthesizeProjectReview(ctx: ProjectReviewContext): ProjectReviewOutput;

export interface CouncilQueueRow {
  id: string;
  status: "queued" | "running" | "awaiting_approval" | "completed" | "failed";
  title: string;
  createdAt: number;
  source: "council";
}
export function deriveCouncilQueue(jobs: CouncilJobRow[], limit?: number): CouncilQueueRow[];
export function seedCouncilJobsIfEmpty(existing: CouncilJobRow[]): CreatedJob | null;