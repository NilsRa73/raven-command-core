import { openDB, type DBSchema, type IDBPDatabase } from "idb";

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
    context?: { projectName?: string; projectGoals?: string; memory?: string[] };
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
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
export function getDB() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  if (!dbp) {
    dbp = openDB<Schema>("rah-listen-key", 1, {
      upgrade(db) {
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
  const [projects, commands, memory, approvals, prefs, files] = await Promise.all([
    db.getAll("projects"),
    db.getAll("commands"),
    db.getAll("memory"),
    db.getAll("approvals"),
    db.getAll("prefs"),
    db.getAll("files"),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    projects,
    commands,
    memory,
    approvals,
    prefs,
    files: files.map((f) => ({ ...f, blob: undefined, byteSize: f.size })),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

export async function wipeAll() {
  const db = await getDB();
  for (const store of ["projects", "commands", "memory", "files", "approvals", "prefs"] as const) {
    await db.clear(store);
  }
}

export async function storageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}