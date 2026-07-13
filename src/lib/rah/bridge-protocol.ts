// MUST match desktop-bridge/src/protocol.js
export const BRIDGE_MIN_VERSION = "0.2.1";

// Feature flags the web client REQUIRES. If the bridge's /v1/health does
// not advertise all of these, the UI must show a "download and restart"
// message instead of silently claiming the local AI is offline.
export const REQUIRED_BRIDGE_FEATURES = ["localAiProxy"] as const;
export type RequiredBridgeFeature = (typeof REQUIRED_BRIDGE_FEATURES)[number];
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
  features?: string[];
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
export interface BridgeJob {
  id: string;
  capability: CapabilityId;
  params: Record<string, unknown>;
  status: "prepared" | "approved" | "running" | "done" | "error" | "cancelled" | "expired";
  approvalId: string | null;
  createdAt: number;
  expiresAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result: unknown;
  error: string | null;
}

export interface BridgePrepareResponse {
  job: BridgeJob;
  confirmationToken: string;
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  expiresAt: number;
}
