import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_FORMAT, captureFromBridge, captureDisabledReason,
  filterByRange, detectGaps, sparklinePoints,
  exportPayload, validateImport, mergeImport, latestSummary,
} from "../../src/lib/rah/deviceHistory.js";

const onlineSnap = { ui: "paired_online", version: "0.2.1", latencyMs: 12 };
const sys = {
  hostname: "beacon", cpu: { cores: 16, loadAvg: [0.42, 0.5, 0.6] },
  memory: { totalBytes: 32e9, usedBytes: 8e9 },
};

test("captureFromBridge: succeeds only when paired_online + sys present", () => {
  const r = captureFromBridge({ deviceId: "d1", snapshot: onlineSnap, sys, now: 1000, id: "s1" });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.id, "s1");
  assert.equal(r.snapshot.capturedAt, 1000);
  assert.equal(r.snapshot.source, "bridge");
  assert.equal(r.snapshot.cpuCores, 16);
  assert.equal(r.snapshot.ramTotalBytes, 32e9);
  assert.equal(r.snapshot.bridgeVersion, "0.2.1");
  assert.equal(r.snapshot.latencyMs, 12);
  // No fabricated fields the bridge cannot provide today.
  assert.equal(r.snapshot.storageUsedBytes, null);
  assert.equal(r.snapshot.networkTxBytes, null);
});

test("captureFromBridge: fail-closed when offline / not paired / no sys", () => {
  assert.equal(captureFromBridge({ deviceId: "d1", snapshot: null, sys }).ok, false);
  assert.equal(captureFromBridge({ deviceId: "d1", snapshot: { ui: "offline" }, sys }).ok, false);
  assert.equal(captureFromBridge({ deviceId: "d1", snapshot: { ui: "pairing_required" }, sys }).ok, false);
  assert.equal(captureFromBridge({ deviceId: "d1", snapshot: onlineSnap, sys: null }).ok, false);
  assert.equal(captureFromBridge({ deviceId: "", snapshot: onlineSnap, sys }).ok, false);
});

test("captureDisabledReason: honest, specific reasons", () => {
  assert.match(captureDisabledReason({ snapshot: null }), /Bridge status unknown/);
  assert.match(captureDisabledReason({ snapshot: { ui: "offline" } }), /offline/i);
  assert.match(captureDisabledReason({ snapshot: { ui: "pairing_required" } }), /Pair/);
  assert.match(captureDisabledReason({ snapshot: { ui: "version_mismatch" } }), /minimum/i);
  assert.match(captureDisabledReason({ snapshot: onlineSnap, sys: null }), /system status/i);
  assert.equal(captureDisabledReason({ snapshot: onlineSnap, sys: {} }), null);
});

test("filterByRange: 24h/7d/all with explicit now, sorted ascending", () => {
  const now = 1_000_000_000_000;
  const day = 24 * 3600 * 1000;
  const snaps = [
    { id: "a", deviceId: "d", capturedAt: now - 40 * day },
    { id: "b", deviceId: "d", capturedAt: now - 3 * day },
    { id: "c", deviceId: "d", capturedAt: now - 1000 },
  ];
  assert.deepEqual(filterByRange(snaps, "24h", now).map((s) => s.id), ["c"]);
  assert.deepEqual(filterByRange(snaps, "7d", now).map((s) => s.id), ["b", "c"]);
  assert.deepEqual(filterByRange(snaps, "30d", now).map((s) => s.id), ["b", "c"]);
  assert.deepEqual(filterByRange(snaps, "all", now).map((s) => s.id), ["a", "b", "c"]);
});

test("detectGaps: reports intervals larger than maxGapMs, never invents values", () => {
  const snaps = [
    { id: "a", deviceId: "d", capturedAt: 0 },
    { id: "b", deviceId: "d", capturedAt: 1000 },
    { id: "c", deviceId: "d", capturedAt: 10000 },
  ];
  const gaps = detectGaps(snaps, 5000);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], { from: 1000, to: 10000, gapMs: 9000 });
});

test("sparklinePoints: null values skipped, no interpolation", () => {
  const snaps = [
    { capturedAt: 0, cpuLoad1m: 0.1 },
    { capturedAt: 1, cpuLoad1m: null },
    { capturedAt: 2, cpuLoad1m: 0.9 },
  ];
  const { points, min, max } = sparklinePoints(snaps, "cpuLoad1m", 100, 20);
  assert.equal(points.length, 2);
  assert.equal(min, 0.1); assert.equal(max, 0.9);
  const empty = sparklinePoints([{ capturedAt: 0, cpuLoad1m: null }], "cpuLoad1m");
  assert.deepEqual(empty, { points: [], min: null, max: null });
});

test("validateImport: rejects wrong format, keeps error details", () => {
  assert.equal(validateImport(null).ok, false);
  assert.equal(validateImport({ format: "wrong", snapshots: [] }).ok, false);
  const r = validateImport({
    format: HISTORY_FORMAT,
    snapshots: [
      { id: "a", deviceId: "d", capturedAt: 1 },
      { id: "", deviceId: "d", capturedAt: 2 },      // bad id
      { id: "c", deviceId: "d", capturedAt: "nope" },// bad time
      { id: "d", deviceId: "d", capturedAt: 3, cpuCores: "16" }, // coerces to null
    ],
  });
  assert.equal(r.ok, false);
  assert.equal(r.snapshots.length, 2);
  assert.equal(r.snapshots[1].cpuCores, null); // never fabricated
  assert.equal(r.errors.length, 2);
});

test("mergeImport: skip mode never overwrites, replace mode does", () => {
  const existing = [{ id: "a", deviceId: "d", capturedAt: 1, cpuCores: 4 }];
  const incoming = [
    { id: "a", deviceId: "d", capturedAt: 1, cpuCores: 99 },
    { id: "b", deviceId: "d", capturedAt: 2, cpuCores: 8 },
  ];
  const skip = mergeImport(existing, incoming, "skip");
  assert.equal(skip.added, 1); assert.equal(skip.skipped, 1); assert.equal(skip.replaced, 0);
  assert.equal(skip.list.find((s) => s.id === "a").cpuCores, 4);
  const rep = mergeImport(existing, incoming, "replace");
  assert.equal(rep.replaced, 1); assert.equal(rep.added, 1);
  assert.equal(rep.list.find((s) => s.id === "a").cpuCores, 99);
});

test("exportPayload / latestSummary round-trip", () => {
  const snaps = [
    { id: "a", deviceId: "d", capturedAt: 2, cpuCores: 8, source: "bridge" },
    { id: "b", deviceId: "d", capturedAt: 1, cpuCores: 4, source: "bridge" },
  ];
  const payload = exportPayload(snaps);
  assert.equal(payload.format, HISTORY_FORMAT);
  assert.deepEqual(payload.snapshots.map((s) => s.id), ["b", "a"]);
  const latest = latestSummary(snaps);
  assert.equal(latest.capturedAt, 2);
  assert.equal(latest.cpuCores, 8);
  assert.equal(latestSummary([]), null);
});