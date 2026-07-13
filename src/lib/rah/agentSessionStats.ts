// Session-scoped (in-memory, never persisted) per-agent performance counters.
// Cleared on page refresh — this is intentional: no silent persistence.

import { useSyncExternalStore } from "react";

export interface AgentSessionStat {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalLatencyMs: number;
  lastEngine?: string;
  lastProvider?: string;
  lastTransport?: "bridge" | "direct";
}

type Store = Record<string, AgentSessionStat>;
let store: Store = {};
const listeners = new Set<() => void>();
function emit() { for (const fn of listeners) fn(); }

export function recordAgentRun(agentId: string, patch: Partial<AgentSessionStat> & {
  outcome: "completed" | "failed" | "cancelled";
  latencyMs?: number;
}) {
  const cur: AgentSessionStat = store[agentId] ?? {
    runs: 0, completed: 0, failed: 0, cancelled: 0, totalLatencyMs: 0,
  };
  const next: AgentSessionStat = {
    ...cur,
    runs: cur.runs + 1,
    completed: cur.completed + (patch.outcome === "completed" ? 1 : 0),
    failed: cur.failed + (patch.outcome === "failed" ? 1 : 0),
    cancelled: cur.cancelled + (patch.outcome === "cancelled" ? 1 : 0),
    totalLatencyMs: cur.totalLatencyMs + (patch.latencyMs ?? 0),
    lastEngine: patch.lastEngine ?? cur.lastEngine,
    lastProvider: patch.lastProvider ?? cur.lastProvider,
    lastTransport: patch.lastTransport ?? cur.lastTransport,
  };
  store = { ...store, [agentId]: next };
  emit();
}

export function getAgentStats(): Store { return store; }

export function useAgentStats(): Store {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => store,
    () => store,
  );
}

export function clearAgentStats() { store = {}; emit(); }