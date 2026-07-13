// Pure helpers for Raven Device Center.
//
// - Manual device records live in localStorage under DEVICES_KEY.
// - The Desktop Bridge host is never stored: it is derived live from the
//   current bridge snapshot + system status so its state is always honest.
// - No remote execution, no fabricated telemetry. Missing fields → "Unknown".

export const DEVICES_KEY = "rah:deviceCenter:v1";

/** @typedef {"Connected"|"Offline"|"Planned"|"Unknown"} DeviceStatus */
/** @typedef {"ai_core"|"development"|"media"|"vr"|"pocket"|"other"} DeviceRole */

export const DEVICE_ROLES = [
  { id: "ai_core",    label: "AI Core" },
  { id: "development",label: "Development Node" },
  { id: "media",      label: "Media Node" },
  { id: "vr",         label: "VR Node" },
  { id: "pocket",     label: "Pocket Node" },
  { id: "other",      label: "Other" },
];

export const CONNECTION_TYPES = ["Desktop Bridge", "Manual entry", "Planned", "Other"];

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Derive a read-only device record from live bridge state. Returns null
 * when the bridge has never been paired (no device to describe).
 *
 * @param {{
 *   snapshot: {ui?:string, version?:string, latencyMs?:number, pairedAt?:number} | null,
 *   sys: any,
 *   allowedRoots?: string[] | null,
 * }} inputs
 */
export function bridgeDeviceRecord({ snapshot, sys, allowedRoots }) {
  if (!snapshot) return null;
  const ui = snapshot.ui;
  if (ui === "pairing_required" || !ui) return null;
  /** @type {DeviceStatus} */
  let status = "Unknown";
  if (ui === "paired_online") status = "Connected";
  else if (ui === "offline") status = "Offline";
  else if (ui === "emergency_stopped" || ui === "version_mismatch" || ui === "feature_missing" || ui === "error") status = "Offline";
  const hostname = sys?.hostname ?? "Unknown host";
  const username = sys?.username ?? "?";
  const cores = Number.isFinite(sys?.cpu?.cores) ? sys.cpu.cores : null;
  const totalGB = sys?.memory?.totalBytes ? (sys.memory.totalBytes / 1e9) : null;
  const usedGB  = sys?.memory?.usedBytes  ? (sys.memory.usedBytes  / 1e9) : null;
  return {
    id: "bridge:local",
    kind: "bridge",
    displayName: hostname,
    role: "ai_core",
    connectionType: "Desktop Bridge",
    status,
    enabled: true,
    notes: "",
    lastSeen: status === "Connected" ? Date.now() : (snapshot.pairedAt ?? null),
    telemetry: {
      hostname,
      username,
      platform: sys?.platform ?? "Unknown",
      arch: sys?.arch ?? null,
      release: sys?.release ?? null,
      cores,
      totalGB,
      usedGB,
      bridgeVersion: snapshot.version ?? null,
      latencyMs: Number.isFinite(snapshot.latencyMs) ? snapshot.latencyMs : null,
      allowedRoots: Array.isArray(allowedRoots) ? allowedRoots : null,
    },
  };
}

/** Load manual devices from localStorage. Returns [] on any failure. */
export function loadManualDevices() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEVICES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidManualDevice);
  } catch { return []; }
}

export function saveManualDevices(list) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DEVICES_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function isValidManualDevice(d) {
  return !!d && typeof d === "object"
    && typeof d.id === "string"
    && typeof d.displayName === "string"
    && DEVICE_ROLES.some((r) => r.id === d.role);
}

/** Create a manual device with honest defaults ("Planned"). Never claims online. */
export function createManualDevice(patch) {
  const now = Date.now();
  return {
    id: uid(),
    kind: "manual",
    displayName: (patch?.displayName ?? "New device").slice(0, 80),
    role: patch?.role && DEVICE_ROLES.some((r) => r.id === patch.role) ? patch.role : "other",
    connectionType: patch?.connectionType ?? "Planned",
    status: /** @type {DeviceStatus} */ ("Planned"),
    enabled: patch?.enabled !== false,
    notes: (patch?.notes ?? "").slice(0, 1000),
    createdAt: now,
    updatedAt: now,
    lastSeen: null,
    telemetry: null,
  };
}

export function updateManualDevice(list, id, patch) {
  return list.map((d) => d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d);
}

export function removeManualDevice(list, id) {
  return list.filter((d) => d.id !== id);
}

/** Merge live bridge device (if any) with stored manual devices. Live first. */
export function mergeDevices(bridgeDevice, manual) {
  return [
    ...(bridgeDevice ? [bridgeDevice] : []),
    ...manual,
  ];
}

export const DEVICE_ROLE_HINTS = [
  "AI Core — dedicated inference workstation running LM Studio / Ollama.",
  "Development Node — coding/build machine paired via Desktop Bridge.",
  "Media Node — capture, editing, or playback surface.",
  "VR Node — headset-connected PC for immersive sessions.",
  "Pocket Node — laptop or handheld for on-the-go work.",
];