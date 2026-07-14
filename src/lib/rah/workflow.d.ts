export type StepType =
  | "ai_prompt" | "save_memory" | "chronicle_entry"
  | "bridge_read_file" | "bridge_write_file" | "bridge_launch_url" | "bridge_launch_app"
  | "wait_manual" | "final_summary";

export type ExecutionProfile = "fast" | "deep";
export type RunState =
  | "draft" | "queued" | "awaiting_approval" | "running"
  | "paused" | "completed" | "failed" | "cancelled";

export interface WorkflowStep {
  id: string;
  type: StepType;
  config: Record<string, unknown> & {
    prompt?: string; title?: string; content?: string;
    path?: string;        // legacy: bridge_write_file destination
    source?: string;      // bridge_write_file (Copy File) source
    dest?: string;        // bridge_write_file (Copy File) destination
    url?: string; program?: string; note?: string;
  };
}

export interface WorkflowTrigger { kind: "manual" | "scheduled" | "external"; }

export interface Workflow {
  id: string;
  name: string;
  description: string;
  projectId: string | null;
  enabled: boolean;
  executionProfile: ExecutionProfile;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  tags: string[];
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface StepResult {
  stepId: string;
  status: "ok" | "skipped" | "blocked" | "failed";
  startedAt: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  approvalId?: string;
}

export interface RunEvent {
  id: string; seq: number; ts: number;
  runId: string; workflowId: string;
  type: string; actor: "user" | "system";
  prevState: RunState | null; nextState: RunState | null;
  stepId: string | null; metadata: unknown;
  prevHash: string; hash: string;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  status: RunState;
  currentStepIndex: number;
  startedAt: number | null;
  finishedAt: number | null;
  dryRun: boolean;
  engine: string | null;
  provider: string | null;
  model: string | null;
  transport: string | null;
  stepResults: StepResult[];
  approvalIds: string[];
  /** Map of stepId -> approvalId for per-step approvals. */
  stepApprovals?: Record<string, string>;
  failureReason: string | null;
  events: RunEvent[];
  createdAt: number;
}

export const WORKFLOW_VERSION: number;
export const STEP_TYPES: StepType[];
export const STEP_CATALOG: Record<StepType, {
  label: string; category: string;
  sideEffect: boolean; requiresApproval: boolean;
  requiresBridgeCapability: string | null;
  risk: "low" | "medium" | "high";
}>;
export const EXECUTION_PROFILES: ExecutionProfile[];
export const RUN_STATES: RunState[];
export const TERMINAL_STATES: RunState[];

export function canTransition(from: RunState, to: RunState): boolean;
export function transitionRun(run: WorkflowRun, next: RunState, meta?: { now?: number }): WorkflowRun;
export function availableControls(status: RunState): string[];
export function validateWorkflow(w: Workflow | null | undefined): { ok: boolean; errors: string[]; warnings: string[] };
export function planDryRun(w: Workflow, ctx?: { bridge?: { status?: string; features?: string[]; capabilities?: string[] } }): {
  ok: boolean; errors: string[]; warnings: string[];
  steps: {
    index: number; id: string; type: StepType; label: string;
    sideEffect: boolean; requiresApproval: boolean;
    requiresBridgeCapability: string | null; risk: string;
    blocked: boolean; blockedReason: string | null; preview: string;
  }[];
  dryRun: true;
};
export function selectRunContext(w: Workflow, sources: { projects?: unknown[]; projectMemory?: unknown[] }): {
  profile: ExecutionProfile; project: unknown; memory: unknown[]; includeFullDna: boolean;
};
export function appendEvent(events: RunEvent[], evt: Partial<RunEvent> & { runId: string; workflowId: string; type: string }): Promise<RunEvent[]>;
export function verifyEventChain(events: RunEvent[]): Promise<{ ok: boolean; problems: { index: number; error: string }[] }>;
export function createWorkflow(partial?: Partial<Workflow>): Workflow;
export function createStep(type: StepType, config?: WorkflowStep["config"]): WorkflowStep;
export function createRun(w: Workflow, opts?: { runId?: string; dryRun?: boolean; engine?: string; provider?: string; model?: string; transport?: string; now?: number }): WorkflowRun;
export function exportWorkflowJson(w: Workflow): string;
export function importWorkflowJson(text: string): Workflow;
