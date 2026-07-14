// Persistence + subscription for Raven Fast/Deep mode state.
// Storage is localStorage-only; DB migrations are unnecessary because the
// underlying memory records are unchanged (priority is derived on read).
//
// Older builds stored only a `mode` string. We migrate safely by wrapping
// it into the current shape without losing the user's selection.

import type { RavenMode } from "./ravenMode";
import { logRavenAudit } from "./ravenAudit";

const KEY = "rah:raven-mode:v1";
const LEGACY_KEY = "rah:raven-mode"; // pre-v1 stored a bare string

export interface RavenModeState {
  mode: RavenMode;
  pinnedIds: string[];
  excludedIds: string[];
  temporary: {
    /** Session-only pins that clear on Reset. Persisted so a reload keeps them. */
    pinnedIds: string[];
    excludedIds: string[];
  };
  lastRefreshAt: number;
  cacheHits: number;
  cacheMisses: number;
  updatedAt: number;
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function defaults(): RavenModeState {
  return {
    mode: "fast",
    pinnedIds: [],
    excludedIds: [],
    temporary: { pinnedIds: [], excludedIds: [] },
    lastRefreshAt: 0,
    cacheHits: 0,
    cacheMisses: 0,
    updatedAt: Date.now(),
  };
}

function migrate(): RavenModeState {
  const ls = safeStorage();
  if (!ls) return defaults();
  try {
    const raw = ls.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RavenModeState>;
      const s = { ...defaults(), ...parsed };
      s.mode = parsed.mode === "deep" ? "deep" : "fast";
      s.pinnedIds = Array.isArray(parsed.pinnedIds) ? parsed.pinnedIds.map(String) : [];
      s.excludedIds = Array.isArray(parsed.excludedIds) ? parsed.excludedIds.map(String) : [];
      s.temporary = {
        pinnedIds: Array.isArray(parsed.temporary?.pinnedIds) ? parsed.temporary!.pinnedIds.map(String) : [],
        excludedIds: Array.isArray(parsed.temporary?.excludedIds) ? parsed.temporary!.excludedIds.map(String) : [],
      };
      return s;
    }
    const legacy = ls.getItem(LEGACY_KEY);
    if (legacy === "deep" || legacy === "fast") {
      const s = defaults();
      s.mode = legacy;
      ls.setItem(KEY, JSON.stringify(s));
      return s;
    }
  } catch { /* ignore */ }
  return defaults();
}

let state: RavenModeState = migrate();
const listeners = new Set<(s: RavenModeState) => void>();

function persist() {
  const ls = safeStorage();
  if (!ls) return;
  try { ls.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
}
function emit() { for (const fn of listeners) try { fn(state); } catch { /* */ } }

export function getRavenModeState(): RavenModeState { return state; }
export function subscribeRavenMode(fn: (s: RavenModeState) => void): () => void {
  listeners.add(fn); fn(state);
  return () => { listeners.delete(fn); };
}

export function setMode(next: RavenMode, source = "user") {
  if (state.mode === next) return;
  const prev = state.mode;
  state = { ...state, mode: next, updatedAt: Date.now() };
  persist(); emit();
  logRavenAudit({ type: "mode_change", detail: `${prev} → ${next}`, source, meta: { prev, next } });
}

export function pinMemory(id: string, source = "user") {
  if (state.pinnedIds.includes(id)) return;
  state = { ...state, pinnedIds: [...state.pinnedIds, id], updatedAt: Date.now() };
  persist(); emit();
  logRavenAudit({ type: "context_pin", detail: id, source });
}
export function unpinMemory(id: string, source = "user") {
  if (!state.pinnedIds.includes(id)) return;
  state = { ...state, pinnedIds: state.pinnedIds.filter((x) => x !== id), updatedAt: Date.now() };
  persist(); emit();
  logRavenAudit({ type: "context_unpin", detail: id, source });
}
export function excludeMemory(id: string, source = "user") {
  if (state.excludedIds.includes(id)) return;
  state = {
    ...state,
    excludedIds: [...state.excludedIds, id],
    pinnedIds: state.pinnedIds.filter((x) => x !== id),
    updatedAt: Date.now(),
  };
  persist(); emit();
  logRavenAudit({ type: "context_exclude", detail: id, source });
}
export function includeMemory(id: string, source = "user") {
  if (!state.excludedIds.includes(id)) return;
  state = { ...state, excludedIds: state.excludedIds.filter((x) => x !== id), updatedAt: Date.now() };
  persist(); emit();
  logRavenAudit({ type: "context_include", detail: id, source });
}

export function resetTemporary(source = "user") {
  state = {
    ...state,
    temporary: { pinnedIds: [], excludedIds: [] },
    excludedIds: [],
    updatedAt: Date.now(),
  };
  persist(); emit();
  logRavenAudit({ type: "context_reset", detail: "temporary excludes cleared", source });
}

export function markRefreshed(source = "user") {
  state = { ...state, lastRefreshAt: Date.now(), cacheMisses: state.cacheMisses + 1, updatedAt: Date.now() };
  persist(); emit();
  logRavenAudit({ type: "context_refresh", detail: `at ${new Date(state.lastRefreshAt).toISOString()}`, source });
}
export function noteCacheHit() {
  state = { ...state, cacheHits: state.cacheHits + 1 };
  // Do not persist on every hit (noisy); flush on refresh/change.
}

export function storageAvailable(): boolean { return !!safeStorage(); }
