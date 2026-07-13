import { useSyncExternalStore } from "react";
import { bridgeStatusSnapshot, type BridgeStatusSnapshot } from "./bridge";
import {
  initialSharedState,
  reduceRefreshStart,
  reduceRefreshResult,
  reduceNoteExternalSnapshot,
  type SharedState,
} from "./bridgeStatusReducer";

export type SharedBridgeState = SharedState<BridgeStatusSnapshot>;

let state: SharedBridgeState = initialSharedState();

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function replace(next: SharedBridgeState) { state = next; emit(); }

let inflight: Promise<BridgeStatusSnapshot | null> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Fetch a fresh snapshot. Coalesces concurrent calls so components can call
 * `refreshBridgeStatus()` freely without spamming the bridge. Uses the shared
 * reducer to keep the last-known-good snapshot during transient failures
 * (one hiccup no longer flips the UI to offline).
 */
export async function refreshBridgeStatus(): Promise<BridgeStatusSnapshot | null> {
  if (inflight) return inflight;
  replace(reduceRefreshStart(state));
  inflight = (async () => {
    try {
      const snap = await bridgeStatusSnapshot();
      replace(reduceRefreshResult(state, { ok: true, snapshot: snap }));
      return state.snapshot;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      replace(reduceRefreshResult(state, { ok: false, error: msg }));
      return state.snapshot;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Push an authoritative snapshot into the shared store — used after
 *  pair/resume/disconnect/model-test in Connections and LocalAiPanel so all
 *  consumers reflect the confirmed state without waiting for the next poll. */
export function noteBridgeSnapshot(snap: BridgeStatusSnapshot | null): void {
  if (!snap) return;
  replace(reduceNoteExternalSnapshot(state, snap));
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
