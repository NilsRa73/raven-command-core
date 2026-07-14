// Pure, deterministic helpers for the Device Center v0.2 hardware
// history. All I/O (IndexedDB) lives in deviceHistoryDb.ts — this
// module never touches storage, time, or randomness unless an
// explicit `now`/`id` is provided.
//
// No fabricated telemetry. If a field is not present in the source
// (bridge health/system status), it is stored as `null` and rendered
// as "—" downstream. There is no interpolation between snapshots.

export const HISTORY_FORMAT = "raven-device-history/v1";

export const HISTORY_RANGES = [
  { id: "24h", label: "24 hours", ms: 24 * 3600 * 1000 },
  { id: "7d",  label: "7 days",   ms: 7 * 24 * 3600 * 1000 },
  { id: "30d", label: "30 days",  ms: 30 * 24 * 3600 * 1000 },
  { id: "all", label: "All",      ms: null },
];

function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/**
 * Build a snapshot from a live bridge health snapshot + system status.
 * Fails closed when the bridge is not online. No fields are invented.
 *
 * @param {{
 *   deviceId: string,
 *   snapshot: {ui?:string, version?:string, latencyMs?:number} | null,
 *   sys: any,
 *   id?: string,
 *   now?: number,
 * }} input
 */
export function captureFromBridge({ deviceId, snapshot, sys, id, now }) {
  const reason = captureDisabledReason({ snapshot, sys });
  if (reason) return { ok: false, reason };
  if (!deviceId || typeof deviceId !== "string") {
    return { ok: false, reason: "Missing deviceId." };
  }
  const capturedAt = typeof now === "number" ? now : Date.now();
  const snap = {
    id: id ?? `snap_${capturedAt}_${Math.random().toString(36).slice(2, 8)}`,
    deviceId,
    capturedAt,
    source: "bridge",
    cpuCores:          num(sys?.cpu?.cores),
    cpuLoad1m:         Array.isArray(sys?.cpu?.loadAvg) ? num(sys.cpu.loadAvg[0]) : null,
    ramUsedBytes:      num(sys?.memory?.usedBytes),
    ramTotalBytes:     num(sys?.memory?.totalBytes),
    storageUsedBytes:  null,   // Bridge does not report disk yet — honest null.
    storageTotalBytes: null,
    networkTxBytes:    null,
    networkRxBytes:    null,
    bridgeVersion:     snapshot?.version ?? null,
    latencyMs:         num(snapshot?.latencyMs),
    hostname:          typeof sys?.hostname === "string" ? sys.hostname : null,
  };
  return { ok: true, snapshot: snap };
}

/** Return a user-facing reason why capture is disabled, or null when OK. */
export function captureDisabledReason({ snapshot, sys }) {
  if (!snapshot) return "Bridge status unknown — waiting for first check.";
  if (snapshot.ui === "pairing_required") return "Pair the Desktop Bridge to capture telemetry.";
  if (snapshot.ui === "offline") return "Bridge is offline.";
  if (snapshot.ui === "emergency_stopped") return "Bridge is in emergency stop.";
  if (snapshot.ui === "version_mismatch") return "Bridge version is below the minimum required.";
  if (snapshot.ui === "feature_missing") return "Bridge is missing required features.";
  if (snapshot.ui !== "paired_online") return `Bridge not ready (${snapshot.ui}).`;
  if (!sys) return "No system status returned by the Bridge yet.";
  return null;
}

/**
 * Filter a list of snapshots to a range and sort ascending by capturedAt.
 * Deterministic — accepts an explicit `now`.
 */
export function filterByRange(snapshots, rangeId, now) {
  const list = Array.isArray(snapshots) ? snapshots.slice() : [];
  list.sort((a, b) => a.capturedAt - b.capturedAt);
  const range = HISTORY_RANGES.find((r) => r.id === rangeId);
  if (!range || range.ms == null) return list;
  const t = typeof now === "number" ? now : Date.now();
  const cutoff = t - range.ms;
  return list.filter((s) => s.capturedAt >= cutoff);
}

/**
 * Detect gaps between consecutive snapshots larger than `maxGapMs`.
 * Returns [{ from, to, gapMs }] — never invents values inside a gap.
 */
export function detectGaps(snapshots, maxGapMs) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return [];
  const sorted = snapshots.slice().sort((a, b) => a.capturedAt - b.capturedAt);
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].capturedAt - sorted[i - 1].capturedAt;
    if (gap > maxGapMs) out.push({ from: sorted[i - 1].capturedAt, to: sorted[i].capturedAt, gapMs: gap });
  }
  return out;
}

/** Build a sparkline (min-max normalized) from a numeric field. Nulls skipped. */
export function sparklinePoints(snapshots, field, width = 100, height = 20) {
  const pts = (snapshots ?? [])
    .map((s) => ({ t: s.capturedAt, v: num(s[field]) }))
    .filter((p) => p.v != null);
  if (pts.length === 0) return { points: [], min: null, max: null };
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const t0 = pts[0].t, tN = pts[pts.length - 1].t;
  const tSpan = tN - t0 || 1;
  const points = pts.map((p) => ({
    x: ((p.t - t0) / tSpan) * width,
    y: height - ((p.v - min) / span) * height,
    v: p.v,
    t: p.t,
  }));
  return { points, min, max };
}

/** Wrap snapshots for JSON export. */
export function exportPayload(snapshots) {
  return {
    format: HISTORY_FORMAT,
    exportedAt: new Date().toISOString(),
    snapshots: (snapshots ?? []).slice().sort((a, b) => a.capturedAt - b.capturedAt),
  };
}

/**
 * Validate an imported payload. Never throws — returns a report so the
 * UI can show errors and ask the user before merging.
 */
export function validateImport(json) {
  if (!json || typeof json !== "object") return { ok: false, error: "Not a JSON object.", snapshots: [], errors: [] };
  if (json.format !== HISTORY_FORMAT) return { ok: false, error: `Wrong format (expected ${HISTORY_FORMAT}).`, snapshots: [], errors: [] };
  if (!Array.isArray(json.snapshots)) return { ok: false, error: "Missing snapshots array.", snapshots: [], errors: [] };
  const valid = [];
  const errors = [];
  for (let i = 0; i < json.snapshots.length; i++) {
    const s = json.snapshots[i];
    if (!s || typeof s !== "object") { errors.push(`Row ${i}: not an object.`); continue; }
    if (typeof s.id !== "string" || !s.id) { errors.push(`Row ${i}: missing id.`); continue; }
    if (typeof s.deviceId !== "string" || !s.deviceId) { errors.push(`Row ${i}: missing deviceId.`); continue; }
    if (!Number.isFinite(s.capturedAt)) { errors.push(`Row ${i}: capturedAt must be a number.`); continue; }
    // Coerce known numeric fields to null when missing/invalid — never fabricate.
    const norm = {
      id: s.id, deviceId: s.deviceId, capturedAt: s.capturedAt,
      source: typeof s.source === "string" ? s.source : "import",
      cpuCores: num(s.cpuCores), cpuLoad1m: num(s.cpuLoad1m),
      ramUsedBytes: num(s.ramUsedBytes), ramTotalBytes: num(s.ramTotalBytes),
      storageUsedBytes: num(s.storageUsedBytes), storageTotalBytes: num(s.storageTotalBytes),
      networkTxBytes: num(s.networkTxBytes), networkRxBytes: num(s.networkRxBytes),
      bridgeVersion: typeof s.bridgeVersion === "string" ? s.bridgeVersion : null,
      latencyMs: num(s.latencyMs),
      hostname: typeof s.hostname === "string" ? s.hostname : null,
    };
    valid.push(norm);
  }
  return { ok: errors.length === 0, snapshots: valid, errors };
}

/**
 * Merge imported snapshots with existing ones. No silent overwrite —
 * caller passes `mode` and gets a per-row breakdown.
 *
 * @param {"skip"|"replace"} mode
 */
export function mergeImport(existing, incoming, mode) {
  const byId = new Map((existing ?? []).map((s) => [s.id, s]));
  let added = 0, replaced = 0, skipped = 0;
  for (const s of incoming ?? []) {
    if (byId.has(s.id)) {
      if (mode === "replace") { byId.set(s.id, s); replaced++; }
      else { skipped++; }
    } else {
      byId.set(s.id, s); added++;
    }
  }
  const list = [...byId.values()].sort((a, b) => a.capturedAt - b.capturedAt);
  return { list, added, replaced, skipped };
}

/** Compute a compact latest-snapshot summary. Missing fields → null. */
export function latestSummary(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  const sorted = snapshots.slice().sort((a, b) => a.capturedAt - b.capturedAt);
  const latest = sorted[sorted.length - 1];
  return {
    capturedAt: latest.capturedAt,
    source: latest.source,
    cpuCores: latest.cpuCores,
    cpuLoad1m: latest.cpuLoad1m,
    ramUsedBytes: latest.ramUsedBytes,
    ramTotalBytes: latest.ramTotalBytes,
    bridgeVersion: latest.bridgeVersion,
    latencyMs: latest.latencyMs,
    hostname: latest.hostname,
  };
}