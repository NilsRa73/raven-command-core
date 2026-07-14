// Pure helpers for Device Center v0.2 role grouping and dashboards.
// Deterministic — no I/O, no time, no randomness.
//
// Roles are additive: existing/manual devices with legacy role ids are
// mapped safely into v2 buckets, and any unknown role falls through to
// "unassigned" (never silently guessed as a real role).

export const DEVICE_ROLES_V2 = [
  { id: "command_node",      label: "Command Node",              hint: "Primary control desktop / daily driver." },
  { id: "ai_compute",        label: "AI Compute Node",           hint: "Dedicated inference workstation (LM Studio / Ollama)." },
  { id: "display_vr",        label: "Display / VR Node",         hint: "Headsets, media surfaces, capture / playback." },
  { id: "storage",           label: "Storage Node",              hint: "NAS or backup target." },
  { id: "bridge_automation", label: "Bridge / Automation Node",  hint: "Paired Desktop Bridge / workflow runner." },
  { id: "planned",           label: "Planned Device",            hint: "Placeholder for future hardware." },
  { id: "unassigned",        label: "Unassigned",                hint: "Role not set — pick one to organise the cluster." },
];

const LEGACY_MAP = {
  ai_core: "ai_compute",
  development: "command_node",
  media: "display_vr",
  vr: "display_vr",
  pocket: "command_node",
  other: "unassigned",
  // v2 identity mappings
  command_node: "command_node",
  ai_compute: "ai_compute",
  display_vr: "display_vr",
  storage: "storage",
  bridge_automation: "bridge_automation",
  planned: "planned",
  unassigned: "unassigned",
};

/** Map any incoming role id to a valid v2 id. Unknown → "unassigned". */
export function normalizeRoleV2(role) {
  if (!role || typeof role !== "string") return "unassigned";
  return LEGACY_MAP[role] ?? "unassigned";
}

/** Effective role for a device, honouring "Planned" status. */
export function effectiveRoleV2(device) {
  if (!device) return "unassigned";
  if (device.kind === "bridge") return "bridge_automation";
  if (device.status === "Planned" && !LEGACY_MAP[device.role]) return "planned";
  return normalizeRoleV2(device.role);
}

/**
 * Group devices by v2 role. Returns one entry per role in a stable order,
 * including empty roles so the dashboard is deterministic.
 */
export function groupDevicesByRoleV2(devices) {
  const buckets = new Map(DEVICE_ROLES_V2.map((r) => [r.id, []]));
  for (const d of devices ?? []) {
    const role = effectiveRoleV2(d);
    buckets.get(role).push(d);
  }
  return DEVICE_ROLES_V2.map((r) => ({
    role: r.id,
    label: r.label,
    hint: r.hint,
    devices: buckets.get(r.id),
  }));
}

/** Deterministic per-role dashboard summary. No fabricated telemetry. */
export function roleSummary(devices) {
  return groupDevicesByRoleV2(devices).map((g) => {
    let live = 0, offline = 0, planned = 0, unknown = 0, lastSeen = 0;
    let withTelemetry = 0, bridgeCapable = 0;
    for (const d of g.devices) {
      if (d.status === "Connected") live++;
      else if (d.status === "Offline") offline++;
      else if (d.status === "Planned") planned++;
      else unknown++;
      if (typeof d.lastSeen === "number" && d.lastSeen > lastSeen) lastSeen = d.lastSeen;
      if (d.telemetry) withTelemetry++;
      if (d.telemetry?.bridgeVersion) bridgeCapable++;
    }
    const total = g.devices.length;
    const blockers = [];
    if (total === 0 && g.role !== "unassigned" && g.role !== "planned") {
      blockers.push(`No ${g.label} assigned yet.`);
    } else if (total > 0 && live === 0 && offline > 0) {
      blockers.push("All devices in this role are offline.");
    }
    return {
      role: g.role, label: g.label, hint: g.hint, devices: g.devices,
      total, live, offline, planned, unknown,
      lastSeen: lastSeen || null,
      capability: { withTelemetry, bridgeCapable, total },
      blockers,
    };
  });
}

/** Cluster-wide capability coverage. Honest — only counts real telemetry. */
export function capabilityCoverage(devices) {
  const list = devices ?? [];
  const withTelemetry = list.filter((d) => !!d.telemetry).length;
  const bridgeCapable = list.filter((d) => d.telemetry?.bridgeVersion).length;
  return { total: list.length, withTelemetry, bridgeCapable };
}