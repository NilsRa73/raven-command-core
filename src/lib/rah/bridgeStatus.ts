import { useSyncExternalStore } from "react";
import { bridgeStatusSnapshot, type BridgeStatusSnapshot } from "./bridge";

export interface SharedBridgeState {
  snapshot: BridgeStatusSnapshot | null;
  loading: boolean;
  lastUpdated: number | null;
  error: string | null;
}

let state: SharedBridgeState = {
  snapshot: null,
  loading: false,
  lastUpdated: null,
  error: null,
};

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function setState(patch: Partial<SharedBridgeState>) {
  state = { ...state, ...patch };
  emit();
}

let inflight: Promise<BridgeStatusSnapshot | null> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Fetch a fresh snapshot. Coalesces concurrent calls so components can call
 * `refreshBridgeStatus()` freely without spamming the bridge.
 */
export async function refreshBridgeStatus(): Promise<BridgeStatusSnapshot | null> {
  if (inflight) return inflight;
  setState({ loading: true });
  inflight = (async () => {
    try {
      const snap = await bridgeStatusSnapshot();
      setState({ snapshot: snap, loading: false, lastUpdated: Date.now(), error: null });
      return snap;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ loading: false, error: msg, lastUpdated: Date.now() });
      return state.snapshot;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function startPolling() {
  if (started || typeof window === "undefined") return;
  started = true;
  void refreshBridgeStatus();
  const schedule = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshBridgeStatus();
    }, 5000);
  };
  const stop = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
  schedule();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void refreshBridgeStatus();
        schedule();
      } else {
        stop();
      }
    });
  }
}

function subscribe(cb: () => void) {
  startPolling();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function getSnapshot(): SharedBridgeState { return state; }
function getServerSnapshot(): SharedBridgeState { return state; }

export function useBridgeStatus(): SharedBridgeState & { refresh: () => Promise<BridgeStatusSnapshot | null> } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...s, refresh: refreshBridgeStatus };
}

/** Non-React accessor for occasional callers. */
export function getBridgeStatusState(): SharedBridgeState { return state; }
