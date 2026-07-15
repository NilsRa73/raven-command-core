// Work Sessions & Checkpoints — typed local persistence adapter.
//
// This module deliberately uses localStorage (not IndexedDB) so it is
// synchronous, fast, and works immediately without a DB migration.
// It can be swapped for a Supabase table later by re-implementing
// `readAll` / `writeAll` while keeping the same types + API.

export type CheckpointKind = "manual" | "auto" | "milestone";

export interface Checkpoint {
  id: string;
  sessionId: string;
  projectId: string | null;
  createdAt: number;
  note: string;
  /** What to resume — a route the app can navigate to. */
  resumeRoute?: string;
  /** Free-form module identifier ("memory", "workflow", "vision"…). */
  module?: string;
  /** Human-readable next action restored on resume. */
  nextAction?: string;
}

export type SessionStatus = "active" | "paused" | "completed";

export interface WorkSession {
  id: string;
  projectId: string | null;
  title: string;
  objective: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  /** Latest resumable route captured on any checkpoint. */
  lastRoute?: string;
  /** Most recent checkpoint id, for O(1) resume. */
  lastCheckpointId?: string;
}

const SESSIONS_KEY = "rah:sessions:v1";
const CHECKPOINTS_KEY = "rah:checkpoints:v1";
const SEED_MARKER = "rah:sessions:seeded:v1";

function safeLS(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
function readAll<T>(key: string): T[] {
  const ls = safeLS(); if (!ls) return [];
  try { const raw = ls.getItem(key); return raw ? (JSON.parse(raw) as T[]) : []; } catch { return []; }
}
function writeAll<T>(key: string, rows: T[]): void {
  const ls = safeLS(); if (!ls) return;
  try { ls.setItem(key, JSON.stringify(rows)); } catch { /* quota */ }
  emit();
}

// ── Subscription (mission control refresh) ────────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();
function emit() { for (const l of Array.from(listeners)) { try { l(); } catch { /* ignore */ } } }
export function subscribeSessions(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function uid(prefix: string): string {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// ── Sessions ──────────────────────────────────────────────────────────
export function listSessions(): WorkSession[] {
  return readAll<WorkSession>(SESSIONS_KEY).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getSession(id: string): WorkSession | null {
  return listSessions().find((s) => s.id === id) ?? null;
}
export function createSession(input: {
  projectId: string | null; title: string; objective?: string;
}): WorkSession {
  const now = Date.now();
  const s: WorkSession = {
    id: uid("sess"),
    projectId: input.projectId,
    title: input.title.trim() || "Untitled session",
    objective: (input.objective ?? "").trim(),
    createdAt: now, updatedAt: now,
    status: "active",
  };
  const rows = listSessions();
  // Pause any other active session for the same project — one active at a time.
  const updated = rows.map((r) =>
    r.status === "active" && r.projectId === s.projectId
      ? { ...r, status: "paused" as SessionStatus, updatedAt: now }
      : r,
  );
  writeAll(SESSIONS_KEY, [s, ...updated]);
  return s;
}
export function updateSession(id: string, patch: Partial<WorkSession>): WorkSession | null {
  const rows = listSessions();
  let out: WorkSession | null = null;
  const next = rows.map((r) => {
    if (r.id !== id) return r;
    out = { ...r, ...patch, id: r.id, createdAt: r.createdAt, updatedAt: Date.now() };
    return out;
  });
  writeAll(SESSIONS_KEY, next);
  return out;
}
export function setSessionStatus(id: string, status: SessionStatus): WorkSession | null {
  return updateSession(id, { status });
}
export function deleteSession(id: string): void {
  writeAll(SESSIONS_KEY, listSessions().filter((s) => s.id !== id));
  writeAll(CHECKPOINTS_KEY, listCheckpoints().filter((c) => c.sessionId !== id));
}

// ── Checkpoints ───────────────────────────────────────────────────────
export function listCheckpoints(sessionId?: string): Checkpoint[] {
  const all = readAll<Checkpoint>(CHECKPOINTS_KEY);
  const filtered = sessionId ? all.filter((c) => c.sessionId === sessionId) : all;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}
export function saveCheckpoint(input: Omit<Checkpoint, "id" | "createdAt"> & { kind?: CheckpointKind }): Checkpoint {
  const now = Date.now();
  const cp: Checkpoint = {
    id: uid("cp"),
    sessionId: input.sessionId,
    projectId: input.projectId ?? null,
    createdAt: now,
    note: input.note.trim() || "Checkpoint",
    resumeRoute: input.resumeRoute,
    module: input.module,
    nextAction: input.nextAction,
  };
  writeAll(CHECKPOINTS_KEY, [cp, ...listCheckpoints()]);
  updateSession(cp.sessionId, {
    lastCheckpointId: cp.id,
    lastRoute: cp.resumeRoute ?? undefined,
    status: "active",
  });
  return cp;
}

// ── Resumable discovery ───────────────────────────────────────────────
export interface ResumableInfo {
  session: WorkSession;
  checkpoint: Checkpoint | null;
  resumeRoute: string;
  reason: string; // Human-readable explanation for the button
}
export function findResumable(): ResumableInfo | null {
  const sessions = listSessions().filter((s) => s.status !== "completed");
  if (sessions.length === 0) return null;
  const s = sessions[0]; // Newest updated
  const cps = listCheckpoints(s.id);
  const cp = cps[0] ?? null;
  const resumeRoute = cp?.resumeRoute ?? s.lastRoute ?? "/";
  const parts: string[] = [];
  parts.push('Resume "' + s.title + '"');
  if (s.objective) parts.push("objective: " + s.objective);
  if (cp?.nextAction) parts.push("next: " + cp.nextAction);
  else if (cp?.note) parts.push(cp.note);
  return { session: s, checkpoint: cp, resumeRoute, reason: parts.join(" · ") };
}

// ── Seed (first-run only) ─────────────────────────────────────────────
export interface SeedProjectMap {
  /** Map project name → project id (from RahContext projects). */
  byName: Record<string, string>;
}
export function seedSessionsIfEmpty(map: SeedProjectMap): boolean {
  const ls = safeLS(); if (!ls) return false;
  if (ls.getItem(SEED_MARKER)) return false;
  if (listSessions().length > 0) { ls.setItem(SEED_MARKER, "1"); return false; }
  const pid = (name: string): string | null => map.byName[name] ?? null;
  const now = Date.now();
  const day = 24 * 3600_000;
  const seeds: Array<{ s: Omit<WorkSession, "id">; cps: Array<Omit<Checkpoint, "id" | "sessionId">> }> = [
    {
      s: {
        projectId: pid("Raven Command Center") ?? pid("RAH AI Studios"),
        title: "Command Center v0.4 polish",
        objective: "Ship the Mission Control redesign and Continue-Yesterday flow.",
        createdAt: now - 2 * day, updatedAt: now - 3600_000,
        status: "active",
        lastRoute: "/",
      },
      cps: [
        { projectId: null, createdAt: now - 3600_000, note: "Wired session store + checkpoint types.",
          resumeRoute: "/", module: "mission-control",
          nextAction: "Verify Continue Yesterday selects the correct checkpoint." },
      ],
    },
    {
      s: {
        projectId: pid("RAH Raven Browser") ?? pid("RAH OS"),
        title: "RAH Browser agent hooks",
        objective: "Design safe browser-agent execution surface.",
        createdAt: now - 5 * day, updatedAt: now - 2 * day,
        status: "paused",
        lastRoute: "/memory",
      },
      cps: [
        { projectId: null, createdAt: now - 2 * day, note: "Drafted approval schema for browser actions.",
          resumeRoute: "/memory", module: "memory",
          nextAction: "Formalize per-tab consent model." },
      ],
    },
    {
      s: {
        projectId: pid("RAH Gammon"),
        title: "Gammon AI opponent tuning",
        objective: "Balance early-game aggression for the medium bot.",
        createdAt: now - 8 * day, updatedAt: now - 7 * day,
        status: "paused",
        lastRoute: "/projects",
      },
      cps: [],
    },
  ];
  const sessionRows: WorkSession[] = [];
  const checkpointRows: Checkpoint[] = [];
  for (const seed of seeds) {
    const s: WorkSession = { ...seed.s, id: uid("sess") };
    let lastCpId: string | undefined;
    for (const cp of seed.cps) {
      const c: Checkpoint = { ...cp, id: uid("cp"), sessionId: s.id };
      checkpointRows.push(c);
      lastCpId = c.id;
    }
    if (lastCpId) s.lastCheckpointId = lastCpId;
    sessionRows.push(s);
  }
  writeAll(SESSIONS_KEY, sessionRows);
  writeAll(CHECKPOINTS_KEY, checkpointRows);
  ls.setItem(SEED_MARKER, "1");
  return true;
}

// ── Task-queue derivation ─────────────────────────────────────────────
export type TaskQueueStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed";
export interface TaskQueueRow {
  id: string;
  status: TaskQueueStatus;
  title: string;
  createdAt: number;
  source: "command" | "approval";
}
export function deriveTaskQueue(input: {
  commands?: Array<{ id: string; prompt?: string; status?: string; createdAt?: number }>;
  approvals?: Array<{ id: string; title?: string; status?: string; createdAt?: number }>;
  limit?: number;
}): TaskQueueRow[] {
  const limit = input.limit ?? 12;
  const rows: TaskQueueRow[] = [];
  for (const c of input.commands ?? []) {
    if (!c) continue;
    let status: TaskQueueStatus | null = null;
    switch (c.status) {
      case "queued": status = "queued"; break;
      case "running": status = "running"; break;
      case "awaiting_approval": status = "awaiting_approval"; break;
      case "done": status = "completed"; break;
      case "error": case "rejected": status = "failed"; break;
      default: status = null;
    }
    if (!status) continue;
    rows.push({
      id: c.id, status,
      title: (c.prompt ?? "").slice(0, 120) || "(empty command)",
      createdAt: Number(c.createdAt) || 0,
      source: "command",
    });
  }
  for (const a of input.approvals ?? []) {
    if (!a || a.status !== "pending") continue;
    rows.push({
      id: a.id, status: "awaiting_approval",
      title: a.title ?? "Pending approval",
      createdAt: Number(a.createdAt) || 0,
      source: "approval",
    });
  }
  // Sort: active statuses first, then newest
  const prio: Record<TaskQueueStatus, number> = {
    running: 0, awaiting_approval: 1, queued: 2, failed: 3, completed: 4,
  };
  rows.sort((a, b) => (prio[a.status] - prio[b.status]) || (b.createdAt - a.createdAt));
  return rows.slice(0, limit);
}