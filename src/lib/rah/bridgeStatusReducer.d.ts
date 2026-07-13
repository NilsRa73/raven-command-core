export interface Snap {
  ui: string;
  paired?: boolean;
  version?: string;
  latencyMs?: number;
  message?: string;
}
export interface SharedState {
  snapshot: Snap | null;
  loading: boolean;
  refreshing: boolean;
  lastUpdated: number | null;
  lastGoodAt: number | null;
  error: string | null;
  consecutiveFailures: number;
}
export function initialSharedState(): SharedState;
export function reduceRefreshStart(state: SharedState): SharedState;
export function reduceRefreshResult(
  state: SharedState,
  result: { ok: true; snapshot: Snap } | { ok: false; error?: string; snapshot?: Snap | null },
  now?: number,
): SharedState;
export function reduceNoteExternalSnapshot(
  state: SharedState,
  snap: Snap,
  now?: number,
): SharedState;