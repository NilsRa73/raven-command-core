// Work Sessions & Checkpoints — typed local persistence adapter.
//
// This module deliberately uses localStorage (not IndexedDB) so it is
// synchronous, fast, and works immediately without a DB migration.
// It can be swapped for a Supabase table later by re-implementing
// `readAll` / `writeAll` while keeping the same types + API.

const SESSIONS_KEY = "rah:sessions:v1";
const CHECKPOINTS_KEY = "rah:checkpoints:v1";
const SEED_MARKER = "rah:sessions:seeded:v1";

function safeLS() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
function readAll(key) {
  const ls = safeLS(); if (!ls) return [];
  try { const raw = ls.getItem(key); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function writeAll(key, rows) {
  const ls = safeLS(); if (!ls) return;
  try { ls.setItem(key, JSON.stringify(rows)); } catch { /* quota */ }
  emit();
}

// ── Subscription (mission control refresh) ────────────────────────────
const listeners = new Set();
function emit() { for (const l of Array.from(listeners)) { try { l(); } catch { /* ignore */ } } }
export function subscribeSessions(l) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// ── Sessions ──────────────────────────────────────────────────────────
export function listSessions() {
  return readAll(SESSIONS_KEY).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getSession(id) {
  return listSessions().find((s) => s.id === id) ?? null;
}
export function createSession(input) {
  const now = Date.now();
  const s = {
    id: uid("sess"),
    projectId: input.projectId ?? null,
    title: (input.title ?? "").trim() || "Untitled session",
    objective: (input.objective ?? "").trim(),
    createdAt: now, updatedAt: now,
    status: "active",
  };
  const rows = listSessions();
  const updated = rows.map((r) =>
    r.status === "active" && r.projectId === s.projectId
      ? { ...r, status: "paused", updatedAt: now }
      : r,
  );
  writeAll(SESSIONS_KEY, [s, ...updated]);
  return s;
}
export function updateSession(id, patch) {
  const rows = listSessions();
  let out = null;
  const next = rows.map((r) => {
    if (r.id !== id) return r;
    out = { ...r, ...patch, id: r.id, createdAt: r.createdAt, updatedAt: Date.now() };
    return out;
  });
  writeAll(SESSIONS_KEY, next);
  return out;
}
export function setSessionStatus(id, status) {
  return updateSession(id, { status });
}
export function deleteSession(id) {
  writeAll(SESSIONS_KEY, listSessions().filter((s) => s.id !== id));
  writeAll(CHECKPOINTS_KEY, listCheckpoints().filter((c) => c.sessionId !== id));
}

// ── Checkpoints ───────────────────────────────────────────────────────
export function listCheckpoints(sessionId) {
  const all = readAll(CHECKPOINTS_KEY);
  const filtered = sessionId ? all.filter((c) => c.sessionId === sessionId) : all;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}
export function saveCheckpoint(input) {
  const now = Date.now();
  const cp = {
    id: uid("cp"),
    sessionId: input.sessionId,
    projectId: input.projectId ?? null,
    createdAt: now,
    note: (input.note ?? "").trim() || "Checkpoint",
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
export function findResumable(sessionsIn, checkpointsIn) {
  const sessions = (sessionsIn ?? listSessions()).filter((s) => s.status !== "completed");
  if (sessions.length === 0) return null;
  const s = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const all = checkpointsIn ?? listCheckpoints();
  const cps = all.filter((c) => c.sessionId === s.id).sort((a, b) => b.createdAt - a.createdAt);
  const cp = cps[0] ?? null;
  const resumeRoute = cp?.resumeRoute ?? s.lastRoute ?? "/";
  const parts = [];
  parts.push('Resume "' + s.title + '"');
  if (s.objective) parts.push("objective: " + s.objective);
  if (cp?.nextAction) parts.push("next: " + cp.nextAction);
  else if (cp?.note) parts.push(cp.note);
  return { session: s, checkpoint: cp, resumeRoute, reason: parts.join(" · ") };
}

// ── Seed (first-run only) ─────────────────────────────────────────────
export function seedSessionsIfEmpty(map) {
  const ls = safeLS(); if (!ls) return false;
  if (ls.getItem(SEED_MARKER)) return false;
  if (listSessions().length > 0) { ls.setItem(SEED_MARKER, "1"); return false; }
  const pid = (name) => (map && map.byName && map.byName[name]) ?? null;
  const now = Date.now();
  const day = 24 * 3600_000;
  const seeds = [
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
  const sessionRows = [];
  const checkpointRows = [];
  for (const seed of seeds) {
    const s = { ...seed.s, id: uid("sess") };
    let lastCpId;
    for (const cp of seed.cps) {
      const c = { ...cp, id: uid("cp"), sessionId: s.id };
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
export function deriveTaskQueue(input) {
  const limit = input.limit ?? 12;
  const rows = [];
  for (const c of input.commands ?? []) {
    if (!c) continue;
    let status = null;
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
  const prio = { running: 0, awaiting_approval: 1, queued: 2, failed: 3, completed: 4 };
  rows.sort((a, b) => (prio[a.status] - prio[b.status]) || (b.createdAt - a.createdAt));
  return rows.slice(0, limit);
}
