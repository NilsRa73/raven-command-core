// Lightweight append-only audit log for Raven mode + context actions.
// Persisted in localStorage (capped at MAX_ENTRIES). Not cryptographically
// signed; described consistently as "append-only local audit log".

export type RavenAuditType =
  | "mode_change"
  | "context_refresh"
  | "context_pin"
  | "context_unpin"
  | "context_exclude"
  | "context_include"
  | "context_reset"
  | "route_decision"
  | "health_check"
  | "council";

export interface RavenAuditEntry {
  id: string;
  ts: number;
  type: RavenAuditType;
  detail: string;
  source: string;
  meta?: unknown;
}

const KEY = "rah:raven-audit:v1";
const MAX_ENTRIES = 500;

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function uid() {
  return (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function load(): RavenAuditEntry[] {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(-MAX_ENTRIES);
  } catch { return []; }
}
function save(list: RavenAuditEntry[]) {
  const ls = safeStorage();
  if (!ls) return;
  try { ls.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch { /* quota */ }
}

const listeners = new Set<(entries: RavenAuditEntry[]) => void>();
let cache: RavenAuditEntry[] = load();

export function logRavenAudit(input: Omit<RavenAuditEntry, "id" | "ts"> & { ts?: number }) {
  const entry: RavenAuditEntry = {
    id: uid(),
    ts: input.ts ?? Date.now(),
    type: input.type,
    detail: String(input.detail ?? ""),
    source: String(input.source ?? "system"),
    meta: input.meta,
  };
  cache = [...cache, entry].slice(-MAX_ENTRIES);
  save(cache);
  for (const fn of listeners) try { fn(cache); } catch { /* */ }
  return entry;
}

export function getRavenAudit(): RavenAuditEntry[] { return cache; }

export function subscribeRavenAudit(fn: (entries: RavenAuditEntry[]) => void): () => void {
  listeners.add(fn); fn(cache);
  return () => { listeners.delete(fn); };
}

export function clearRavenAudit(source = "user") {
  cache = [];
  save(cache);
  logRavenAudit({ type: "context_reset", detail: "audit cleared", source });
}
