/**
 * RAH Local Workspace v1 — Continue Project workflow.
 *
 * Turns a project + memory + decisions + roadmap into a concrete work
 * plan and, for the first shipping workflow, executes a safe "project
 * status note" task through the RAH Desktop Bridge:
 *
 *   1. Coordinator drafts the note from Project DNA
 *   2. Builder writes the note via files.writeText (through approval)
 *   3. Tester reads the file back and verifies byte-exact content
 *   4. Memory role records a fact/milestone in Project Memory
 *
 * If the bridge is offline, permissions are missing, or the workspace
 * path is not inside an approved root, the task returns a Blocked
 * result with an actionable corrective step — never fake success.
 */

import type { Project } from "./db";
import type { ProjectMemoryRecord } from "./projectMemory";
import type { DecisionRecord } from "./decisions";
import type { RoadmapMilestone } from "./roadmap";

export type TaskRole = "coordinator" | "builder" | "tester" | "memory";

export type TaskStatus =
  | "queued" | "running" | "testing" | "awaiting_approval" | "complete" | "blocked";

export interface WorkPlan {
  projectId: string;
  createdAt: number;
  currentMilestone: string | null;
  nextTask: string;
  dependencies: string[];
  requiredAgents: TaskRole[];
  permissions: string[];        // e.g. ["files.writeText", "files.readText"]
  risk: "low" | "medium" | "high";
  deliverables: string[];
  verification: string;
  blockers: string[];
  contextFacts: string[];       // trimmed excerpts from Project Memory
  workspacePathHint: string | null;
}

/** Deterministic plan built from local state — no LLM required. */
export function buildWorkPlan(input: {
  project: Project & { workspacePath?: string };
  memory: ProjectMemoryRecord[];
  decisions: DecisionRecord[];
  milestones: RoadmapMilestone[];
}): WorkPlan {
  const { project, memory, decisions, milestones } = input;

  const currentMilestone = milestones
    .filter((m) => m.status === "in_progress" || m.status === "planned")
    .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))[0]?.title ?? null;

  const explicitBlocker = project.blocker?.trim();
  const memBlockers = memory
    .filter((m) => !m.archived && (m.type === "blocker" || m.tags.includes("blocker")))
    .map((m) => m.title);
  const blockers = [explicitBlocker, ...memBlockers].filter(Boolean) as string[];

  const nextTask =
    project.nextTask?.trim() ||
    memory.find((m) => !m.archived && m.type === "next_action" && m.projectId === project.id)?.title ||
    memory.find((m) => !m.archived && m.type === "next_action")?.title ||
    "Draft or refresh the project status note.";

  const dependencies: string[] = [];
  if (!project.workspacePath) dependencies.push("Set a workspace folder inside an approved root");
  dependencies.push("RAH Desktop Bridge online and paired");
  dependencies.push("Bridge feature: textFileWrite");

  const contextFacts = memory
    .filter((m) => !m.archived && (m.type === "fact" || m.type === "milestone" || m.pinned))
    .slice(0, 6)
    .map((m) => (m.content ? `${m.title} — ${m.content}` : m.title));

  const recentDecisions = decisions
    .filter((d) => !d.archived)
    .slice(0, 3)
    .map((d) => `Decision: ${d.title}`);

  return {
    projectId: project.id,
    createdAt: Date.now(),
    currentMilestone,
    nextTask,
    dependencies,
    requiredAgents: ["coordinator", "builder", "tester", "memory"],
    permissions: ["files.writeText", "files.readText"],
    risk: "medium",
    deliverables: [
      "PROJECT_STATUS.md inside the workspace folder",
      "Read-back verification of exact contents",
      "New Project Memory milestone entry",
    ],
    verification: "Bridge files.readText returns text equal to the written note byte-for-byte.",
    blockers,
    contextFacts: [...contextFacts, ...recentDecisions],
    workspacePathHint: project.workspacePath ?? null,
  };
}

/** Compose a deterministic project-status note from the plan. */
export function composeStatusNote(project: Project & { workspacePath?: string }, plan: WorkPlan): string {
  const lines: string[] = [];
  lines.push(`# ${project.name} — Project Status`);
  lines.push("");
  lines.push(`_Updated ${new Date().toISOString()} by Raven Command._`);
  lines.push("");
  if (plan.currentMilestone) {
    lines.push(`**Current milestone:** ${plan.currentMilestone}`);
    lines.push("");
  }
  lines.push(`**Next task:** ${plan.nextTask}`);
  lines.push("");
  if (plan.blockers.length) {
    lines.push("## Blockers");
    for (const b of plan.blockers) lines.push(`- ${b}`);
    lines.push("");
  }
  if (plan.contextFacts.length) {
    lines.push("## Context");
    for (const f of plan.contextFacts) lines.push(`- ${f}`);
    lines.push("");
  }
  lines.push("## Verification");
  lines.push(`- ${plan.verification}`);
  lines.push("");
  return lines.join("\n");
}

// ─── Workspace helpers ─────────────────────────────────────────────────
export interface WorkspaceValidation { ok: boolean; reason?: string; }

/**
 * Validate a workspace path against the bridge's approved roots.
 * Pure helper — path comparison only, no filesystem I/O.
 */
export function validateWorkspacePath(workspace: string, approvedRoots: string[]): WorkspaceValidation {
  if (!workspace || typeof workspace !== "string") return { ok: false, reason: "Workspace path is empty" };
  if (workspace.includes("\u0000")) return { ok: false, reason: "Null byte in path" };
  const norm = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const rootRaw of approvedRoots) {
    const root = rootRaw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!root) continue;
    if (norm === root) return { ok: true };
    if (norm.toLowerCase().startsWith(root.toLowerCase() + "/")) return { ok: true };
  }
  return { ok: false, reason: "Workspace is not inside any approved root" };
}

/** Join workspace + note filename in a cross-platform-friendly way. */
export function noteTargetPath(workspace: string, filename = "PROJECT_STATUS.md"): string {
  const sep = workspace.includes("\\") && !workspace.includes("/") ? "\\" : "/";
  const trimmed = workspace.replace(/[\\/]+$/, "");
  return trimmed + sep + filename;
}

// ─── Task-run state machine ────────────────────────────────────────────
export interface TaskRun {
  id: string;
  projectId: string;
  startedAt: number;
  role: TaskRole;
  status: TaskStatus;
  steps: { role: TaskRole; status: TaskStatus; detail: string; at: number }[];
  blockedReason?: string;
  approvalId?: string;
  writtenPath?: string;
  verifiedBytes?: number;
}

export function nextStatus(current: TaskStatus, event: "approve" | "reject" | "wrote" | "verified" | "block"): TaskStatus {
  switch (event) {
    case "block":    return "blocked";
    case "reject":   return "blocked";
    case "approve":  return current === "awaiting_approval" ? "running" : current;
    case "wrote":    return "testing";
    case "verified": return "complete";
  }
}