import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_ROLES_V2, normalizeRoleV2, effectiveRoleV2,
  groupDevicesByRoleV2, roleSummary, capabilityCoverage,
} from "../../src/lib/rah/deviceRolesV2.js";

const bridgeDev = {
  id: "bridge:local", kind: "bridge", role: "ai_core", status: "Connected",
  lastSeen: 1000, telemetry: { bridgeVersion: "0.2.1", cores: 16 },
};
const manualPlanned = {
  id: "m1", kind: "manual", role: "vr", status: "Planned", lastSeen: null, telemetry: null,
};
const manualOffline = {
  id: "m2", kind: "manual", role: "development", status: "Offline", lastSeen: 500, telemetry: null,
};
const unknownRole = {
  id: "m3", kind: "manual", role: "???", status: "Planned", lastSeen: null, telemetry: null,
};

test("normalizeRoleV2 maps legacy roles, unknown → unassigned", () => {
  assert.equal(normalizeRoleV2("ai_core"), "ai_compute");
  assert.equal(normalizeRoleV2("development"), "command_node");
  assert.equal(normalizeRoleV2("vr"), "display_vr");
  assert.equal(normalizeRoleV2("media"), "display_vr");
  assert.equal(normalizeRoleV2("pocket"), "command_node");
  assert.equal(normalizeRoleV2("other"), "unassigned");
  assert.equal(normalizeRoleV2("storage"), "storage");
  assert.equal(normalizeRoleV2("bogus"), "unassigned");
  assert.equal(normalizeRoleV2(null), "unassigned");
  assert.equal(normalizeRoleV2(undefined), "unassigned");
});

test("effectiveRoleV2: bridge devices → bridge_automation regardless of stored role", () => {
  assert.equal(effectiveRoleV2(bridgeDev), "bridge_automation");
});

test("effectiveRoleV2: unknown role + Planned status → planned bucket, never guessed", () => {
  assert.equal(effectiveRoleV2(unknownRole), "planned");
});

test("groupDevicesByRoleV2: deterministic order, includes empty buckets", () => {
  const groups = groupDevicesByRoleV2([bridgeDev, manualPlanned, manualOffline]);
  assert.deepEqual(groups.map((g) => g.role), DEVICE_ROLES_V2.map((r) => r.id));
  const byId = Object.fromEntries(groups.map((g) => [g.role, g.devices.map((d) => d.id)]));
  assert.deepEqual(byId.bridge_automation, ["bridge:local"]);
  assert.deepEqual(byId.display_vr, ["m1"]);
  assert.deepEqual(byId.command_node, ["m2"]);
  assert.deepEqual(byId.storage, []);
});

test("roleSummary: honest counts + blockers, never fabricates telemetry", () => {
  const summary = roleSummary([bridgeDev, manualPlanned, manualOffline]);
  const bridge = summary.find((s) => s.role === "bridge_automation");
  assert.equal(bridge.total, 1);
  assert.equal(bridge.live, 1);
  assert.equal(bridge.capability.bridgeCapable, 1);
  assert.equal(bridge.lastSeen, 1000);
  const cmd = summary.find((s) => s.role === "command_node");
  assert.equal(cmd.total, 1);
  assert.equal(cmd.offline, 1);
  assert.equal(cmd.live, 0);
  assert.ok(cmd.blockers.some((b) => /offline/i.test(b)));
  const storage = summary.find((s) => s.role === "storage");
  assert.equal(storage.total, 0);
  assert.ok(storage.blockers.some((b) => /Storage Node/i.test(b)));
  const unassigned = summary.find((s) => s.role === "unassigned");
  assert.equal(unassigned.total, 0);
  assert.deepEqual(unassigned.blockers, []); // empty unassigned is not a blocker
});

test("capabilityCoverage: only counts real telemetry, no fabrication", () => {
  const cov = capabilityCoverage([bridgeDev, manualPlanned, manualOffline, unknownRole]);
  assert.deepEqual(cov, { total: 4, withTelemetry: 1, bridgeCapable: 1 });
  assert.deepEqual(capabilityCoverage([]), { total: 0, withTelemetry: 0, bridgeCapable: 0 });
});