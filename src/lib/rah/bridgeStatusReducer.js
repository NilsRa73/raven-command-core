// Pure reducer for the shared bridge status store.
//
// Kept as .js (with a sibling .d.ts) so it can be unit-tested directly by
// node --test without a TS runtime.
//
// Rules:
//   - `snapshot` is the last-known-good (or last-known result) surfaced to UI.
//   - `refreshing` is true only while a fetch is in flight. Distinct from
//     `loading`, which is only true during the very first fetch when we have
//     no snapshot yet.
//   - A successful "healthy" result (paired_online / pairing_required /
//     version_mismatch / feature_missing / emergency_stopped) resets the
//     consecutive-failure counter and becomes the new snapshot.
//   - A transient failure (thrown error, or a bare `offline`) does NOT
//     immediately flip a previously-paired snapshot. We keep the
//     last-known-good until we see TWO consecutive failures — this absorbs
//     the ~2–3s hiccups that were flipping the Command Center to
//     "offline / Bridge required" while Connections was still green.

/** @typedef {{ui:string, paired?:boolean, version?:string, latencyMs?:number, message?:string}} Snap */
/** @typedef {{
 *   snapshot: Snap|null,
 *   loading: boolean,
 *   refreshing: boolean,
 *   lastUpdated: number|null,
 *   lastGoodAt: number|null,
 *   error: string|null,
 *   consecutiveFailures: number,
 * }} SharedState */

/** @returns {SharedState} */
export function initialSharedState() {
  return {
    snapshot: null,
    loading: false,
    refreshing: false,
    lastUpdated: null,
    lastGoodAt: null,
    error: null,
    consecutiveFailures: 0,
  };
}

/** @param {SharedState} state */
export function reduceRefreshStart(state) {
  return { ...state, refreshing: true, loading: state.snapshot == null };
}

/** A snapshot counts as a "good" result — i.e. the bridge answered coherently
 *  — whenever it isn't a bare offline/error. Note that pairing_required and
 *  version_mismatch are still "good" answers: the bridge itself is up. */
function isGoodSnapshot(snap) {
  if (!snap || typeof snap.ui !== "string") return false;
  return snap.ui !== "offline" && snap.ui !== "error";
}

/**
 * @param {SharedState} state
 * @param {{ok:true, snapshot:Snap} | {ok:false, error?:string, snapshot?:Snap|null}} result
 * @param {number} [now]
 */
export function reduceRefreshResult(state, result, now = Date.now()) {
  if (result.ok && isGoodSnapshot(result.snapshot)) {
    return {
      ...state,
      snapshot: result.snapshot,
      loading: false,
      refreshing: false,
      lastUpdated: now,
      lastGoodAt: now,
      error: null,
      consecutiveFailures: 0,
    };
  }
  // Failure path: throw, offline, or ui==="error".
  const failures = state.consecutiveFailures + 1;
  const wasGood = state.snapshot != null && state.snapshot.ui === "paired_online";
  // Keep last-known-good for the first transient failure only.
  const keepPrior = wasGood && failures < 2;
  const nextSnapshot = keepPrior
    ? state.snapshot
    : (result.snapshot ?? (state.snapshot && state.snapshot.ui !== "paired_online" ? state.snapshot : null));
  return {
    ...state,
    snapshot: nextSnapshot,
    loading: false,
    refreshing: false,
    lastUpdated: now,
    error: result.ok ? null : (result.error ?? null),
    consecutiveFailures: failures,
  };
}

/** External authoritative snapshot (e.g. right after pair/resume/model-test).
 *  Immediately promotes the store to that snapshot, no failure math. */
export function reduceNoteExternalSnapshot(state, snap, now = Date.now()) {
  if (!isGoodSnapshot(snap)) {
    // Even an offline external note should not flip a good prior snapshot
    // without going through the normal failure gating.
    return state;
  }
  return {
    ...state,
    snapshot: snap,
    loading: false,
    lastUpdated: now,
    lastGoodAt: snap.ui === "paired_online" ? now : state.lastGoodAt,
    error: null,
    consecutiveFailures: 0,
  };
}