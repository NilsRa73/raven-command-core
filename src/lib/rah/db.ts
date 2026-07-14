import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ProjectMemoryRecord } from "./projectMemory";
export type { ProjectMemoryRecord } from "./projectMemory";
import type { Workflow, WorkflowRun } from "./workflow";
export type { Workflow, WorkflowRun } from "./workflow";
import type { DeviceSnapshot } from "./deviceHistory";
export type { DeviceSnapshot } from "./deviceHistory";
import type { RoadmapMilestone } from "./roadmap";
export type { RoadmapMilestone } from "./roadmap";
import type { DecisionRecord, DecisionVersion } from "./decisions";
export type { DecisionRecord, DecisionVersion } from "./decisions";
import type { FocusSession } from "./focusSession";
export type { FocusSession } from "./focusSession";
import type { VoiceProfile, VoiceSessionRecord, VoiceTranscriptReview } from "./voiceProfiles";
export type { VoiceProfile, VoiceSessionRecord, VoiceTranscriptReview } from "./voiceProfiles";

export type ApprovalMode = "advisory" | "ask_every" | "trusted_low_risk";
export type Theme = "raven" | "forest" | "arctic" | "hc";
export type ExecutionMode = "fast" | "expert" | "debate" | "deep_project";

export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "active" | "archived";
  priority: "low" | "normal" | "high";
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  goals?: string;
  notes?: string;
  /** Sprint 2 — task tracking (user-edited, no silent updates). */
  currentTask?: string;
  nextTask?: string;
  blocker?: string;
  estimatedCompletionAt?: number;
}

export interface CommandRecord {
  id: string;
  projectId?: string;
  createdAt: number;
  inputType: "text" | "voice" | "screen" | "file";
  prompt: string;
  agents: string[];
  mode: ExecutionMode;
  fileIds: string[];
  status: "queued" | "running" | "awaiting_approval" | "done" | "rejected" | "error";
  resultSummary?: string;
  favorite?: boolean;
  approvals?: string[];
  demo?: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  usage?: unknown;
  errorMessage?: string;
  attachments?: {
    id: string;
    name: string;
    mime: string;
    width: number;
    height: number;
    sizeBytes: number;
    included: boolean;
    analyzed?: boolean;
    state?: string;
  }[];
  visionUsed?: boolean;
  /** Payload retained for a queued command awaiting approval so it can be executed after Approve. */
  pending?: {
    context?: { projectName?: string; projectGoals?: string; memory?: string[]; projectMemoryBlock?: string };
    images?: { name: string; mime: string; dataUrl: string }[];
  };
}

export interface MemoryItem {
  id: string;
  layer: "session" | "project" | "personal";
  projectId?: string;
  text: string;
  category: string;
  source: string;
  createdAt: number;
  lastUsedAt?: number;
  disabled?: boolean;
}

export interface FileItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  blob: Blob;
  projectId?: string;
  tags: string[];
  folder?: string;
  favorite?: boolean;
  notes?: string;
}

export interface Approval {
  id: string;
  createdAt: number;
  title: string;
  reason: string;
  tools: string[];
  dataShared: string[];
  expectedResult: string;
  risk: "low" | "medium" | "high";
  category: string;
  undo?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  /** The queued CommandRecord this approval authorises, if any. */
  commandId?: string;
  /** The workflow run this approval authorises, if any. */
  workflowRunId?: string;
  /** The specific workflow step id this approval authorises. */
  workflowStepId?: string;
  /** Human-readable action label for the workflow step, if any. */
  workflowAction?: string;
}

export interface Preferences {
  id: "prefs";
  theme: Theme;
  textSize: "sm" | "md" | "lg";
  reducedMotion: boolean;
  language: string;
  voiceLang: string;
  ttsEnabled: boolean;
  ttsRate: number;
  ttsVoice?: string;
  shortcutsEnabled: boolean;
  approvalMode: ApprovalMode;
  memoryEnabled: boolean;
  activeProjectId?: string;
  defaultMode: ExecutionMode;
  onboardingComplete: boolean;
  localOnly: boolean;
  provider?: { name: string; baseUrl: string; secretName?: string; model?: string };
}

interface Schema extends DBSchema {
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
  commands: { key: string; value: CommandRecord; indexes: { createdAt: number; projectId: string } };
  memory: { key: string; value: MemoryItem; indexes: { layer: string; projectId: string } };
  files: { key: string; value: FileItem; indexes: { createdAt: number; projectId: string } };
  approvals: { key: string; value: Approval; indexes: { status: string } };
  prefs: { key: string; value: Preferences };
  projectMemory: { key: string; value: ProjectMemoryRecord; indexes: { updatedAt: number; projectId: string } };
  workflows: { key: string; value: Workflow; indexes: { updatedAt: number; projectId: string } };
  workflowRuns: { key: string; value: WorkflowRun; indexes: { createdAt: number; workflowId: string; status: string } };
  deviceHistory: { key: string; value: DeviceSnapshot; indexes: { capturedAt: number; deviceId: string } };
  roadmapMilestones: { key: string; value: RoadmapMilestone; indexes: { projectId: string; updatedAt: number } };
  decisions: { key: string; value: DecisionRecord; indexes: { projectId: string; updatedAt: number } };
  decisionVersions: { key: string; value: DecisionVersion; indexes: { decisionId: string; createdAt: number } };
  focusSessions: { key: string; value: FocusSession; indexes: { projectId: string; createdAt: number; status: string } };
  voiceProfiles: { key: string; value: VoiceProfile; indexes: { projectId: string; updatedAt: number } };
  voiceSessions: { key: string; value: VoiceSessionRecord; indexes: { projectId: string; createdAt: number; status: string } };
  voiceTranscripts: { key: string; value: VoiceTranscriptReview; indexes: { projectId: string; profileId: string; createdAt: number; status: string } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
export function getDB() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  if (!dbp) {
    dbp = openDB<Schema>("rah-listen-key", 7, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const p = db.createObjectStore("projects", { keyPath: "id" });
          p.createIndex("updatedAt", "updatedAt");
          const c = db.createObjectStore("commands", { keyPath: "id" });
          c.createIndex("createdAt", "createdAt");
          c.createIndex("projectId", "projectId");
          const m = db.createObjectStore("memory", { keyPath: "id" });
          m.createIndex("layer", "layer");
          m.createIndex("projectId", "projectId");
          const f = db.createObjectStore("files", { keyPath: "id" });
          f.createIndex("createdAt", "createdAt");
          f.createIndex("projectId", "projectId");
          const a = db.createObjectStore("approvals", { keyPath: "id" });
          a.createIndex("status", "status");
          db.createObjectStore("prefs", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          const pm = db.createObjectStore("projectMemory", { keyPath: "id" });
          pm.createIndex("updatedAt", "updatedAt");
          pm.createIndex("projectId", "projectId");
        }
        if (oldVersion < 3) {
          const wf = db.createObjectStore("workflows", { keyPath: "id" });
          wf.createIndex("updatedAt", "updatedAt");
          wf.createIndex("projectId", "projectId");
          const wr = db.createObjectStore("workflowRuns", { keyPath: "runId" });
          wr.createIndex("createdAt", "createdAt");
          wr.createIndex("workflowId", "workflowId");
          wr.createIndex("status", "status");
        }
        if (oldVersion < 4) {
          const dh = db.createObjectStore("deviceHistory", { keyPath: "id" });
          dh.createIndex("capturedAt", "capturedAt");
          dh.createIndex("deviceId", "deviceId");
        }
        if (oldVersion < 5) {
          const rm = db.createObjectStore("roadmapMilestones", { keyPath: "id" });
          rm.createIndex("projectId", "projectId");
          rm.createIndex("updatedAt", "updatedAt");
          const dec = db.createObjectStore("decisions", { keyPath: "id" });
          dec.createIndex("projectId", "projectId");
          dec.createIndex("updatedAt", "updatedAt");
          const dv = db.createObjectStore("decisionVersions", { keyPath: "id" });
          dv.createIndex("decisionId", "decisionId");
          dv.createIndex("createdAt", "createdAt");
        }
        if (oldVersion < 6) {
          const fs = db.createObjectStore("focusSessions", { keyPath: "id" });
          fs.createIndex("projectId", "projectId");
          fs.createIndex("createdAt", "createdAt");
          fs.createIndex("status", "status");
        }
        if (oldVersion < 7) {
          const vp = db.createObjectStore("voiceProfiles", { keyPath: "id" });
          vp.createIndex("projectId", "projectId");
          vp.createIndex("updatedAt", "updatedAt");
          const vs = db.createObjectStore("voiceSessions", { keyPath: "id" });
          vs.createIndex("projectId", "projectId");
          vs.createIndex("createdAt", "createdAt");
          vs.createIndex("status", "status");
          const vt = db.createObjectStore("voiceTranscripts", { keyPath: "id" });
          vt.createIndex("projectId", "projectId");
          vt.createIndex("profileId", "profileId");
          vt.createIndex("createdAt", "createdAt");
          vt.createIndex("status", "status");
        }
      },
    });
  }
  return dbp;
}

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export const defaultPrefs = (): Preferences => ({
  id: "prefs",
  theme: "raven",
  textSize: "md",
  reducedMotion: false,
  language: "en",
  voiceLang: "en-US",
  ttsEnabled: false,
  ttsRate: 1,
  shortcutsEnabled: true,
  approvalMode: "ask_every",
  memoryEnabled: true,
  defaultMode: "fast",
  onboardingComplete: false,
  localOnly: true,
});

export const EXAMPLE_PROJECTS: Omit<Project, "id" | "createdAt" | "updatedAt">[] = [
  { name: "RAH AI Studios", description: "Umbrella product line and studio operations.", icon: "🏛️", status: "active", priority: "high", tags: ["studio"], favorite: true },
  { name: "RAH OS", description: "Personal AI operating-system layer.", icon: "🜛", status: "active", priority: "high", tags: ["os"], favorite: true },
  { name: "RAH Raven Browser", description: "Privacy-first browser with agent hooks.", icon: "🜲", status: "active", priority: "normal", tags: ["browser"], favorite: false },
  { name: "RAH Earth Simulator", description: "Ecosystem, energy and climate modelling.", icon: "🜨", status: "active", priority: "normal", tags: ["research"], favorite: false },
  { name: "RAH Raven ZipForge", description: "Archive tooling for large project bundles.", icon: "🜃", status: "active", priority: "low", tags: ["tools"], favorite: false },
  { name: "RAH Gammon", description: "Backgammon variant with AI opponents.", icon: "🎲", status: "active", priority: "low", tags: ["game"], favorite: false },
  { name: "Personal Research", description: "Notes, references, and reading log.", icon: "📓", status: "active", priority: "normal", tags: ["personal"], favorite: false },
];

export async function seedIfEmpty() {
  const db = await getDB();
  const count = await db.count("projects");
  if (count > 0) return;
  const now = Date.now();
  const tx = db.transaction("projects", "readwrite");
  for (const p of EXAMPLE_PROJECTS) {
    await tx.store.put({ ...p, id: uid(), createdAt: now, updatedAt: now });
  }
  await tx.done;
}

export async function getPrefs(): Promise<Preferences> {
  const db = await getDB();
  const existing = await db.get("prefs", "prefs");
  if (existing) return existing;
  const p = defaultPrefs();
  await db.put("prefs", p);
  return p;
}
export async function savePrefs(p: Preferences) {
  const db = await getDB();
  await db.put("prefs", p);
}

export async function exportAll(): Promise<Blob> {
  const db = await getDB();
  const [projects, commands, memory, approvals, prefs, files, projectMemory, workflows, workflowRuns, deviceHistory, roadmapMilestones, decisions, decisionVersions, focusSessions, voiceProfiles, voiceSessions, voiceTranscripts] = await Promise.all([
    db.getAll("projects"),
    db.getAll("commands"),
    db.getAll("memory"),
    db.getAll("approvals"),
    db.getAll("prefs"),
    db.getAll("files"),
    db.getAll("projectMemory"),
    db.getAll("workflows"),
    db.getAll("workflowRuns"),
    db.getAll("deviceHistory"),
    db.getAll("roadmapMilestones"),
    db.getAll("decisions"),
    db.getAll("decisionVersions"),
    db.getAll("focusSessions"),
    db.getAll("voiceProfiles"),
    db.getAll("voiceSessions"),
    db.getAll("voiceTranscripts"),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    projects,
    commands,
    memory,
    approvals,
    prefs,
    files: files.map((f) => ({ ...f, blob: undefined, byteSize: f.size })),
    projectMemory,
    workflows,
    workflowRuns,
    deviceHistory,
    roadmapMilestones,
    decisions,
    decisionVersions,
    focusSessions,
    voiceProfiles,
    voiceSessions,
    voiceTranscripts,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

export async function wipeAll() {
  const db = await getDB();
  for (const store of ["projects", "commands", "memory", "files", "approvals", "prefs", "projectMemory", "workflows", "workflowRuns", "deviceHistory", "roadmapMilestones", "decisions", "decisionVersions", "focusSessions", "voiceProfiles", "voiceSessions", "voiceTranscripts"] as const) {
    await db.clear(store);
  }
}

// ─── Seeded Project Memory ──────────────────────────────────────────────
// First-run entries so Command Center is useful before the user types
// anything. Kept small and deterministic. Never re-seeded once present.

export const SEEDED_PROJECT_MEMORY: Omit<ProjectMemoryRecord, "id" | "createdAt" | "updatedAt">[] = [
  {
    projectId: null,
    title: "Desktop Bridge connected",
    content: "RAH Desktop Bridge is paired and online on 127.0.0.1:47824.",
    type: "fact",
    tags: ["bridge"],
    source: "seed",
    archived: false,
    pinned: true,
  },
  {
    projectId: null,
    title: "LM Studio google/gemma-4-e4b via Bridge v0.2.1",
    content: "Default local engine is LM Studio, model google/gemma-4-e4b, routed through RAH Desktop Bridge v0.2.1.",
    type: "fact",
    tags: ["engine", "lmstudio"],
    source: "seed",
    archived: false,
    pinned: true,
  },
  {
    projectId: null,
    title: "Screen Vision working with ImageCapture fallback",
    content: "Screen Vision uses a dual pipeline: video element + ImageCapture.grabFrame() fallback for sources that render black in <video>.",
    type: "milestone",
    tags: ["vision"],
    source: "seed",
    archived: false,
    pinned: false,
  },
  {
    projectId: null,
    title: "Current priority: finish Project Memory, then Voice, then parallel agents",
    content: "Sprint order: 1) Project Memory (in-progress) → 2) Voice Assistant hardening → 3) Parallel agents.",
    type: "next_action",
    tags: ["roadmap"],
    source: "seed",
    archived: false,
    pinned: true,
  },
  {
    projectId: null,
    title: "Current blocker: none",
    content: "No open blockers as of the Project Memory sprint kickoff.",
    type: "note",
    tags: ["status"],
    source: "seed",
    archived: false,
    pinned: false,
  },
];

export async function seedProjectMemoryIfEmpty() {
  const db = await getDB();
  const count = await db.count("projectMemory");
  if (count > 0) return;
  const now = Date.now();
  const tx = db.transaction("projectMemory", "readwrite");
  for (const r of SEEDED_PROJECT_MEMORY) {
    await tx.store.put({ ...r, id: uid(), createdAt: now, updatedAt: now });
  }
  await tx.done;
}

export async function storageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}