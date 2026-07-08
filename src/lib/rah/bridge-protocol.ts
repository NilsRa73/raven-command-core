// MUST match desktop-bridge/src/protocol.js
export const BRIDGE_MIN_VERSION = "0.1.0";
export const PROTOCOL_VERSION = "v1";
export const DEFAULT_BRIDGE_PORT = 47824;

export type CapabilityId =
  | "system.status" | "files.list" | "files.search" | "files.readText"
  | "files.createFolder" | "files.rename" | "files.copy" | "files.move" | "files.recycle"
  | "launch.explorer" | "launch.url" | "launch.program" | "screenshot.capture";

export interface CapabilitySpec { risk: "low" | "medium" | "high"; requiresApproval: boolean; category: string; disabled?: boolean; }

export interface BridgeHealth {
  ok: boolean;
  bridgeVersion?: string;
  protocol?: string;
  paired?: boolean;
  pairingActive?: boolean;
  emergencyStopped?: boolean;
}

export interface BridgePairResponse { ok: boolean; deviceToken: string; hmacSecret: string; bridgeVersion: string; }

export interface BridgeCapabilities { capabilities: Record<CapabilityId, CapabilitySpec>; disabled: CapabilityId[]; approvedRoots: string[]; }

export interface BridgeSystemStatus {
  bridgeVersion: string; hostname: string; username: string; platform: string; release: string; arch: string;
  uptimeSec: number; processUptimeSec: number; paired: boolean; emergencyStopped: boolean; approvedRootsCount: number;
  cpu: { model: string; cores: number; loadAvg: number[] };
  memory: { totalBytes: number; freeBytes: number; usedBytes: number };
  network: { name: string; addresses: { family: string; cidr: string | null }[] }[];
}

export interface BridgeFile { name: string; path: string; size: number | null; mtime: number | null; type?: "file" | "dir"; }
export interface BridgeListResult { path: string; items: BridgeFile[]; }
export interface BridgeSearchResult { results: BridgeFile[]; truncated: boolean; }
export interface BridgeReadTextResult { path: string; size: number; mtime: number; text: string; }
export interface BridgeJob { id: string; capability: CapabilityId; target: unknown; status: string; approvalId: string | null; createdAt: number; startedAt: number | null; finishedAt: number | null; result: unknown; error: string | null; }
