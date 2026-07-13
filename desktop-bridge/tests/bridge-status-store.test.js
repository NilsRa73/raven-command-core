import { test } from "node:test";
import assert from "node:assert/strict";

import {
  initialSharedState,
  reduceRefreshStart,
  reduceRefreshResult,
  reduceNoteExternalSnapshot,
} from "../../src/lib/rah/bridgeStatusReducer.js";

const paired = { ui: "paired_online", paired: true, version: "0.2.1", latencyMs: 12 };
const offlineSnap = { ui: "offline", paired: false };

test("initial state is empty and not loading", () => {
  const s = initialSharedState();
  assert.equal(s.snapshot, null);
  assert.equal(s.loading, false);
  assert.equal(s.refreshing, false);
  assert.equal(s.consecutiveFailures, 0);
});

test("first refresh start sets loading only when no snapshot exists", () => {
  let s = initialSharedState();
  s = reduceRefreshStart(s);
  assert.equal(s.loading, true);
  assert.equal(s.refreshing, true);
  s = reduceRefreshResult(s, { ok: true, snapshot: paired }, 1000);
  s = reduceRefreshStart(s);
  // We already have a snapshot — loading must NOT flip back to true.
  assert.equal(s.loading, false);
  assert.equal(s.refreshing, true);
});

test("successful refresh installs snapshot and clears failure counter", () => {
  let s = initialSharedState();
  s = reduceRefreshResult(s, { ok: false, error: "boom" }, 1000);
  assert.equal(s.consecutiveFailures, 1);
  s = reduceRefreshResult(s, { ok: true, snapshot: paired }, 2000);
  assert.deepEqual(s.snapshot, paired);
  assert.equal(s.consecutiveFailures, 0);
  assert.equal(s.lastGoodAt, 2000);
});

test("last-known-good: one transient failure keeps paired_online snapshot", () => {
  let s = initialSharedState();
  s = reduceRefreshResult(s, { ok: true, snapshot: paired }, 1000);
  // Simulated single transient error.
  s = reduceRefreshResult(s, { ok: false, error: "network" }, 2000);
  assert.deepEqual(s.snapshot, paired, "snapshot must remain paired_online after one failure");
  assert.equal(s.consecutiveFailures, 1);
  assert.equal(s.error, "network");
});

test("two consecutive failures flip snapshot away from paired_online", () => {
  let s = initialSharedState();
  s = reduceRefreshResult(s, { ok: true, snapshot: paired }, 1000);
  s = reduceRefreshResult(s, { ok: false, error: "1" }, 2000);
  s = reduceRefreshResult(s, { ok: false, snapshot: offlineSnap, error: "2" }, 3000);
  assert.notEqual(s.snapshot?.ui, "paired_online");
});

test("offline snapshot from result counts as failure", () => {
  let s = initialSharedState();
  s = reduceRefreshResult(s, { ok: true, snapshot: paired }, 1000);
  s = reduceRefreshResult(s, { ok: true, snapshot: offlineSnap }, 2000);
  // First "offline" answer is a failure; last-known-good preserved.
  assert.deepEqual(s.snapshot, paired);
  assert.equal(s.consecutiveFailures, 1);
});

test("noteBridgeSnapshot: external good snapshot promotes immediately", () => {
  let s = initialSharedState();
  s = reduceRefreshResult(s, { ok: false, error: "x" }, 1000);
  s = reduceNoteExternalSnapshot(s, paired, 2000);
  assert.deepEqual(s.snapshot, paired);
  assert.equal(s.consecutiveFailures, 0);
  assert.equal(s.lastGoodAt, 2000);
});

test("noteBridgeSnapshot: external offline snapshot does NOT flip a good prior", () => {
  let s = initialSharedState();
  s = reduceRefreshResult(s, { ok: true, snapshot: paired }, 1000);
  s = reduceNoteExternalSnapshot(s, offlineSnap, 2000);
  assert.deepEqual(s.snapshot, paired);
});

test("pairing_required is treated as a 'good' answer (bridge is up)", () => {
  let s = initialSharedState();
  s = reduceRefreshResult(s, { ok: true, snapshot: { ui: "pairing_required" } }, 1000);
  assert.equal(s.snapshot?.ui, "pairing_required");
  assert.equal(s.consecutiveFailures, 0);
});

// Subscriber updates: exercise the same "event stream" a UI would see, via
// a tiny hand-rolled subscribe/emit around the reducer.
test("subscribers receive updates for each state transition", () => {
  let s = initialSharedState();
  const events = [];
  const emit = (next) => { s = next; events.push(s); };
  emit(reduceRefreshStart(s));
  emit(reduceRefreshResult(s, { ok: true, snapshot: paired }, 1000));
  emit(reduceRefreshResult(s, { ok: false, error: "hiccup" }, 2000));
  emit(reduceRefreshResult(s, { ok: true, snapshot: paired }, 3000));
  assert.equal(events.length, 4);
  assert.equal(events[0].refreshing, true);
  assert.equal(events[1].snapshot?.ui, "paired_online");
  assert.deepEqual(events[2].snapshot, paired, "held last-known-good after single failure");
  assert.equal(events[3].consecutiveFailures, 0);
});