import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bridgeDeviceRecord, createManualDevice, updateManualDevice,
  removeManualDevice, mergeDevices, isValidManualDevice,
} from "../../src/lib/rah/devices.js";

test("bridgeDeviceRecord: null when never paired", () => {
  assert.equal(bridgeDeviceRecord({ snapshot: null, sys: null }), null);
  assert.equal(bridgeDeviceRecord({ snapshot: { ui: "pairing_required" }, sys: null }), null);
});

test("bridgeDeviceRecord: Connected when paired_online, honest telemetry", () => {
  const rec = bridgeDeviceRecord({
    snapshot: { ui: "paired_online", version: "0.2.1", latencyMs: 12, pairedAt: 100 },
    sys: { hostname: "beacon", username: "nils", platform: "win32", arch: "x64", release: "10", cpu: { cores: 16 }, memory: { totalBytes: 32e9, usedBytes: 8e9 } },
  });
  assert.equal(rec.status, "Connected");
  assert.equal(rec.telemetry.cores, 16);
  assert.equal(rec.telemetry.bridgeVersion, "0.2.1");
  assert.equal(rec.telemetry.latencyMs, 12);
  assert.equal(rec.kind, "bridge");
});

test("bridgeDeviceRecord: offline maps to Offline, no fabricated cores", () => {
  const rec = bridgeDeviceRecord({ snapshot: { ui: "offline" }, sys: null });
  assert.equal(rec.status, "Offline");
  assert.equal(rec.telemetry.cores, null);
});

test("createManualDevice: defaults to Planned, never Connected", () => {
  const d = createManualDevice({ displayName: "VR box", role: "vr" });
  assert.equal(d.status, "Planned");
  assert.equal(d.kind, "manual");
  assert.equal(d.role, "vr");
  assert.ok(isValidManualDevice(d));
});

test("updateManualDevice / removeManualDevice", () => {
  const a = createManualDevice({ displayName: "A", role: "development" });
  const b = createManualDevice({ displayName: "B", role: "media" });
  const list = [a, b];
  const updated = updateManualDevice(list, a.id, { notes: "test" });
  assert.equal(updated.find((x) => x.id === a.id).notes, "test");
  const removed = removeManualDevice(list, a.id);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].id, b.id);
});

test("mergeDevices: bridge device appears first", () => {
  const bridge = bridgeDeviceRecord({ snapshot: { ui: "paired_online" }, sys: { hostname: "h" } });
  const manual = [createManualDevice({ displayName: "M" })];
  const merged = mergeDevices(bridge, manual);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].kind, "bridge");
  assert.equal(merged[1].kind, "manual");
  // no bridge → only manual
  assert.deepEqual(mergeDevices(null, manual), manual);
});