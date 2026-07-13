export interface SharedState<S = unknown> {
  snapshot: S | null;
  loading: boolean;
  refreshing: boolean;
  lastUpdated: number | null;
  lastGoodAt: number | null;
  error: string | null;
  consecutiveFailures: number;
}
export function initialSharedState<S = unknown>(): SharedState<S>;
export function reduceRefreshStart<S>(state: SharedState<S>): SharedState<S>;
export function reduceRefreshResult<S>(
  state: SharedState<S>,
  result: { ok: true; snapshot: S } | { ok: false; error?: string; snapshot?: S | null },
  now?: number,
): SharedState<S>;
export function reduceNoteExternalSnapshot<S>(
  state: SharedState<S>,
  snap: S,
  now?: number,
): SharedState<S>;