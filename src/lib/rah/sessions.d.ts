export type CheckpointKind = "manual" | "auto" | "milestone";
export type SessionStatus = "active" | "paused" | "completed";

export interface Checkpoint {
  id: string;
  sessionId: string;
  projectId: string | null;
  createdAt: number;
  note: string;
  resumeRoute?: string;
  module?: string;
  nextAction?: string;
}

export interface WorkSession {
  id: string;
  projectId: string | null;
  title: string;
  objective: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  lastRoute?: string;
  lastCheckpointId?: string;
}

export interface ResumableInfo {
  session: WorkSession;
  checkpoint: Checkpoint | null;
  resumeRoute: string;
  reason: string;
}

export type TaskQueueStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed";
export interface TaskQueueRow {
  id: string;
  status: TaskQueueStatus;
  title: string;
  createdAt: number;
  source: "command" | "approval";
}

export function subscribeSessions(l: () => void): () => void;
export function listSessions(): WorkSession[];
export function getSession(id: string): WorkSession | null;
export function createSession(input: {
  projectId: string | null; title: string; objective?: string;
}): WorkSession;
export function updateSession(id: string, patch: Partial<WorkSession>): WorkSession | null;
export function setSessionStatus(id: string, status: SessionStatus): WorkSession | null;
export function deleteSession(id: string): void;
export function listCheckpoints(sessionId?: string): Checkpoint[];
export function saveCheckpoint(input: Omit<Checkpoint, "id" | "createdAt"> & { kind?: CheckpointKind }): Checkpoint;
export function findResumable(sessionsIn?: WorkSession[], checkpointsIn?: Checkpoint[]): ResumableInfo | null;
export function seedSessionsIfEmpty(map: { byName: Record<string, string> }): boolean;
export function deriveTaskQueue(input: {
  commands?: Array<{ id: string; prompt?: string; status?: string; createdAt?: number }>;
  approvals?: Array<{ id: string; title?: string; status?: string; createdAt?: number }>;
  limit?: number;
}): TaskQueueRow[];