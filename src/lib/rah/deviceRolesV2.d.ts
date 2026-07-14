import type { DeviceRecord } from "./devices";

export type DeviceRoleV2 =
  | "command_node" | "ai_compute" | "display_vr"
  | "storage" | "bridge_automation" | "planned" | "unassigned";

export interface RoleDef { id: DeviceRoleV2; label: string; hint: string }
export const DEVICE_ROLES_V2: RoleDef[];

export function normalizeRoleV2(role: string | null | undefined): DeviceRoleV2;
export function effectiveRoleV2(device: DeviceRecord | null | undefined): DeviceRoleV2;

export interface RoleGroup { role: DeviceRoleV2; label: string; hint: string; devices: DeviceRecord[] }
export function groupDevicesByRoleV2(devices: DeviceRecord[]): RoleGroup[];

export interface RoleSummaryEntry extends RoleGroup {
  total: number; live: number; offline: number; planned: number; unknown: number;
  lastSeen: number | null;
  capability: { withTelemetry: number; bridgeCapable: number; total: number };
  blockers: string[];
}
export function roleSummary(devices: DeviceRecord[]): RoleSummaryEntry[];
export function capabilityCoverage(devices: DeviceRecord[]): { total: number; withTelemetry: number; bridgeCapable: number };