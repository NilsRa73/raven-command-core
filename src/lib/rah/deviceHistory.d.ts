export interface DeviceSnapshot {
  id: string;
  deviceId: string;
  capturedAt: number;
  source: string;
  cpuCores: number | null;
  cpuLoad1m: number | null;
  ramUsedBytes: number | null;
  ramTotalBytes: number | null;
  storageUsedBytes: number | null;
  storageTotalBytes: number | null;
  networkTxBytes: number | null;
  networkRxBytes: number | null;
  bridgeVersion: string | null;
  latencyMs: number | null;
  hostname: string | null;
}

export const HISTORY_FORMAT: "raven-device-history/v1";
export type HistoryRangeId = "24h" | "7d" | "30d" | "all";
export const HISTORY_RANGES: { id: HistoryRangeId; label: string; ms: number | null }[];

export function captureFromBridge(input: {
  deviceId: string;
  snapshot: { ui?: string; version?: string; latencyMs?: number } | null;
  sys: unknown;
  id?: string;
  now?: number;
}): { ok: true; snapshot: DeviceSnapshot } | { ok: false; reason: string };

export function captureDisabledReason(input: { snapshot: { ui?: string } | null; sys?: unknown }): string | null;
export function filterByRange(snapshots: DeviceSnapshot[], rangeId: HistoryRangeId, now?: number): DeviceSnapshot[];
export function detectGaps(snapshots: DeviceSnapshot[], maxGapMs: number): { from: number; to: number; gapMs: number }[];
export function sparklinePoints(snapshots: DeviceSnapshot[], field: keyof DeviceSnapshot, width?: number, height?: number):
  { points: { x: number; y: number; v: number; t: number }[]; min: number | null; max: number | null };
export function exportPayload(snapshots: DeviceSnapshot[]): { format: string; exportedAt: string; snapshots: DeviceSnapshot[] };
export function validateImport(json: unknown): { ok: boolean; error?: string; snapshots: DeviceSnapshot[]; errors: string[] };
export function mergeImport(existing: DeviceSnapshot[], incoming: DeviceSnapshot[], mode: "skip" | "replace"): {
  list: DeviceSnapshot[]; added: number; replaced: number; skipped: number;
};
export function latestSummary(snapshots: DeviceSnapshot[]): (Partial<DeviceSnapshot> & { capturedAt: number }) | null;