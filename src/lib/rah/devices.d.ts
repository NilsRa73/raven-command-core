export type DeviceStatus = "Connected" | "Offline" | "Planned" | "Unknown";
export type DeviceRole = "ai_core" | "development" | "media" | "vr" | "pocket" | "other";

export interface DeviceTelemetry {
  hostname: string;
  username: string;
  platform: string;
  arch: string | null;
  release: string | null;
  cores: number | null;
  totalGB: number | null;
  usedGB: number | null;
  bridgeVersion: string | null;
  latencyMs: number | null;
  allowedRoots: string[] | null;
}

export interface DeviceRecord {
  id: string;
  kind: "bridge" | "manual";
  displayName: string;
  role: DeviceRole;
  connectionType: string;
  status: DeviceStatus;
  enabled: boolean;
  notes: string;
  createdAt?: number;
  updatedAt?: number;
  lastSeen: number | null;
  telemetry: DeviceTelemetry | null;
}

export const DEVICES_KEY: string;
export const DEVICE_ROLES: { id: DeviceRole; label: string }[];
export const CONNECTION_TYPES: string[];
export const DEVICE_ROLE_HINTS: string[];

export function bridgeDeviceRecord(inputs: {
  snapshot: { ui?: string; version?: string; latencyMs?: number; pairedAt?: number } | null;
  sys: unknown;
  allowedRoots?: string[] | null;
}): DeviceRecord | null;

export function loadManualDevices(): DeviceRecord[];
export function saveManualDevices(list: DeviceRecord[]): void;
export function isValidManualDevice(d: unknown): boolean;
export function createManualDevice(patch?: Partial<DeviceRecord>): DeviceRecord;
export function updateManualDevice(list: DeviceRecord[], id: string, patch: Partial<DeviceRecord>): DeviceRecord[];
export function removeManualDevice(list: DeviceRecord[], id: string): DeviceRecord[];
export function mergeDevices(bridgeDevice: DeviceRecord | null, manual: DeviceRecord[]): DeviceRecord[];