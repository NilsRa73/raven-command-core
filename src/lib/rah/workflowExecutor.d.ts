import type { Approval } from "./db";
import type { Workflow, WorkflowRun, WorkflowStep } from "./workflow";

export interface WorkflowExecutorDeps {
  loadRun(id: string): Promise<WorkflowRun | null>;
  saveRun(run: WorkflowRun): Promise<void>;
  loadWorkflow(id: string): Promise<Workflow | null>;
  loadApproval(id: string): Promise<Approval | null>;
  requestApproval(args: { run: WorkflowRun; step: WorkflowStep; index: number; workflow: Workflow }): Promise<Approval>;
  ai(args: { prompt: string; systemExtra?: string; signal: AbortSignal; mode: string }): Promise<{
    text: string; provider?: string | null; model?: string | null;
    transport?: string | null; engine?: string | null; latencyMs?: number | null;
  }>;
  memory: { save(m: { title: string; content: string; projectId: string | null; tags: string[] }): Promise<void> };
  chronicle: { log(c: { title: string; detail: string; projectId: string | null }): Promise<void> };
  bridge: {
    status(): Promise<{ status: string; capabilities: string[] }>;
    readFile(path: string): Promise<{ text: string; size?: number }>;
    writeFile(path: string, source?: string): Promise<{ ok: boolean }>;
    launchUrl(url: string): Promise<{ ok: boolean }>;
    launchApp(program: string): Promise<{ ok: boolean }>;
  };
  now?: () => number;
  rng?: () => string;
  buildContextExtra?: (workflow: Workflow) => string | {
    text: string;
    meta?: {
      mode: string;
      selectedCount: number;
      selectedIds: string[];
      approxTokens: number | null;
    } | null;
  };
}

export function runWorkflow(runId: string, deps: WorkflowExecutorDeps): Promise<void>;
export function resumeAfterApproval(runId: string, approvalId: string, deps: WorkflowExecutorDeps): Promise<void>;
export function pauseRun(runId: string, deps: WorkflowExecutorDeps): Promise<void>;
export function cancelRun(runId: string, deps: WorkflowExecutorDeps): Promise<void>;
export function resumePausedRun(runId: string, deps: WorkflowExecutorDeps): Promise<void>;
export function retryRun(runId: string, deps: WorkflowExecutorDeps): Promise<void>;
export function reconcileOnReload(runId: string, deps: WorkflowExecutorDeps): Promise<void>;
export function abortRun(runId: string): void;
export function isRunning(runId: string): boolean;

export const _internals: {
  assertBridgeCapability(status: { status: string; capabilities?: string[] } | null, cap: string): void;
};