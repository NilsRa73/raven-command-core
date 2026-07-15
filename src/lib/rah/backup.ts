/**
 * RAH Local Workspace v1 — Backup & Restore.
 *
 * Local-first, versioned JSON backups of everything safe to export:
 *   projects, project memory, commands metadata, approvals, tasks,
 *   decisions (+ versions), roadmap, workflows (+ runs), focus sessions,
 *   voice profiles/sessions/transcripts, vision sessions/evidence/results,
 *   device history, and non-secret prefs.
 *
 * NEVER exports: bridge device tokens, HMAC secrets, pairing codes,
 * provider API keys or Supabase session tokens (those live in the
 * separate `rah-bridge-secure` IDB or in Cloudflare secrets and are
 * simply not read by this module).
 *
 * Snapshots live in a dedicated `rah-backup-snapshots` IndexedDB so
 * they never touch the main app schema.
 */

import { openDB } from "idb";
import { getDB, uid } from "./db";

export const BACKUP_SCHEMA_VERSION = 1;
export const APP_BACKUP_APP = "raven-command";
export const SNAPSHOT_RETENTION = 10;

/** Ordered list of stores that are safe to export/import as JSON. */
export const BACKUP_STORES = [
  "projects",
  "commands",
  "memory",
  "approvals",
  "projectMemory",
  "workflows",
  "workflowRuns",
  "deviceHistory",
  "roadmapMilestones",
  "decisions",
  "decisionVersions",
  "focusSessions",
  "voiceProfiles",
  "voiceSessions",
  "voiceTranscripts",
  "visionSessions",
  "visionEvidence",
  "visionEvidenceVersions",
  "visionResults",
] as const;
export type BackupStore = (typeof BACKUP_STORES)[number];

/** Fields in `prefs` we strip because they can reference secrets. */
const PREFS_SECRET_FIELDS = ["provider"] as const;

export interface BackupPayload {
  app: string;
  schema: number;
  appVersion: string;
  createdAt: string;
  counts: Record<string, number>;
  checksum: string;      // sha-256 over canonical(data)
  prefs: Record<string, unknown> | null;
  data: Record<BackupStore, unknown[]>;
}

// ─── Canonical JSON + checksum ──────────────────────────────────────────
// Deterministic stringifier: keys sorted at every object level, so the
// same data yields the same checksum regardless of insertion order.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k])).join(",") + "}";
}

export async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Node fallback for tests.
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

// ─── Prefs sanitization ────────────────────────────────────────────────
export function sanitizePrefs(prefs: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!prefs) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prefs)) {
    if ((PREFS_SECRET_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

// ─── Export ─────────────────────────────────────────────────────────────
export async function buildBackup(appVersion: string): Promise<BackupPayload> {
  const db = await getDB();
  const data = {} as Record<BackupStore, unknown[]>;
  const counts: Record<string, number> = {};
  for (const store of BACKUP_STORES) {
    // Files are excluded from JSON backup — blobs can't round-trip cleanly.
    const rows = await db.getAll(store as never);
    data[store] = rows as unknown[];
    counts[store] = rows.length;
  }
  const prefsRow = await db.get("prefs", "prefs");
  const prefs = sanitizePrefs(prefsRow as Record<string, unknown> | undefined);
  const checksum = await sha256Hex(canonicalize(data));
  return {
    app: APP_BACKUP_APP,
    schema: BACKUP_SCHEMA_VERSION,
    appVersion,
    createdAt: new Date().toISOString(),
    counts,
    checksum,
    prefs,
    data,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  checksumOk: boolean | null;
  counts: Record<string, number>;
  hasPrefs: boolean;
  hasSecrets: boolean;   // true if a scrubbed secret field was present in prefs
}

export async function validateBackup(candidate: unknown): Promise<ValidationResult> {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  let checksumOk: boolean | null = null;
  let hasPrefs = false;
  let hasSecrets = false;

  if (!candidate || typeof candidate !== "object") {
    return { ok: false, errors: ["Not a JSON object"], checksumOk: null, counts, hasPrefs, hasSecrets };
  }
  const c = candidate as Partial<BackupPayload>;
  if (c.app !== APP_BACKUP_APP) errors.push(`app must be "${APP_BACKUP_APP}"`);
  if (typeof c.schema !== "number") errors.push("schema missing");
  if (typeof c.schema === "number" && c.schema > BACKUP_SCHEMA_VERSION) errors.push(`schema ${c.schema} is newer than this app (${BACKUP_SCHEMA_VERSION})`);
  if (typeof c.checksum !== "string") errors.push("checksum missing");
  if (!c.data || typeof c.data !== "object") errors.push("data missing");

  if (c.data && typeof c.data === "object") {
    for (const store of BACKUP_STORES) {
      const rows = (c.data as Record<string, unknown>)[store];
      if (rows !== undefined && !Array.isArray(rows)) errors.push(`data.${store} must be an array`);
      counts[store] = Array.isArray(rows) ? rows.length : 0;
    }
  }
  if (c.prefs && typeof c.prefs === "object") {
    hasPrefs = true;
    for (const k of PREFS_SECRET_FIELDS) {
      if (k in (c.prefs as Record<string, unknown>)) hasSecrets = true;
    }
  }
  if (typeof c.checksum === "string" && c.data) {
    checksumOk = (await sha256Hex(canonicalize(c.data))) === c.checksum;
    if (!checksumOk) errors.push("checksum mismatch — file may be corrupted or edited");
  }
  return { ok: errors.length === 0, errors, checksumOk, counts, hasPrefs, hasSecrets };
}

// ─── Preview / diff ─────────────────────────────────────────────────────
export interface StoreDiff { store: string; adds: number; updates: number; unchanged: number; existing: number; incoming: number; }

function keyOf(row: unknown): string | null {
  if (row && typeof row === "object") {
    const r = row as Record<string, unknown>;
    if (typeof r.id === "string") return r.id;
    if (typeof r.runId === "string") return r.runId;
  }
  return null;
}

export function computeDiff(existing: Record<string, unknown[]>, incoming: Record<string, unknown[]>): StoreDiff[] {
  const out: StoreDiff[] = [];
  for (const store of BACKUP_STORES) {
    const cur = existing[store] ?? [];
    const inc = incoming[store] ?? [];
    const curKeys = new Map<string, unknown>();
    for (const r of cur) { const k = keyOf(r); if (k) curKeys.set(k, r); }
    let adds = 0, updates = 0, unchanged = 0;
    for (const r of inc) {
      const k = keyOf(r);
      if (!k) { adds++; continue; }
      if (!curKeys.has(k)) adds++;
      else if (canonicalize(curKeys.get(k)) === canonicalize(r)) unchanged++;
      else updates++;
    }
    out.push({ store, adds, updates, unchanged, existing: cur.length, incoming: inc.length });
  }
  return out;
}

// ─── Import ─────────────────────────────────────────────────────────────
export type ImportMode = "merge" | "replace";

export async function applyBackup(backup: BackupPayload, mode: ImportMode): Promise<{ imported: Record<string, number> }> {
  const db = await getDB();
  const imported: Record<string, number> = {};
  for (const store of BACKUP_STORES) {
    const rows = backup.data[store] ?? [];
    const tx = db.transaction(store as never, "readwrite");
    if (mode === "replace") await tx.store.clear();
    for (const r of rows) {
      await tx.store.put(r as never);
    }
    await tx.done;
    imported[store] = rows.length;
  }
  return { imported };
}

// ─── Snapshots (separate IDB, retention capped) ─────────────────────────
const SNAP_DB = "rah-backup-snapshots";
async function snapDb() {
  return openDB(SNAP_DB, 1, {
    upgrade(d) {
      const s = d.createObjectStore("snapshots", { keyPath: "id" });
      s.createIndex("createdAt", "createdAt");
    },
  });
}

export interface SnapshotMeta {
  id: string;
  createdAt: number;
  reason: string;
  appVersion: string;
  totalRows: number;
  checksum: string;
  bytes: number;
}

export interface SnapshotRow extends SnapshotMeta { payload: BackupPayload; }

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const d = await snapDb();
  const rows = (await d.getAll("snapshots")) as SnapshotRow[];
  return rows
    .map(({ payload: _p, ...meta }) => { void _p; return meta; })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSnapshot(id: string): Promise<SnapshotRow | null> {
  const d = await snapDb();
  return ((await d.get("snapshots", id)) as SnapshotRow | undefined) ?? null;
}

/**
 * Choose which snapshots to keep after retention is applied.
 * Pure helper so tests can exercise it without IDB.
 */
export function snapshotsToDelete(existing: SnapshotMeta[], retention = SNAPSHOT_RETENTION): string[] {
  const sorted = [...existing].sort((a, b) => b.createdAt - a.createdAt);
  return sorted.slice(retention).map((s) => s.id);
}

export async function saveSnapshot(payload: BackupPayload, reason: string, retention = SNAPSHOT_RETENTION): Promise<SnapshotMeta> {
  const totalRows = Object.values(payload.counts).reduce((s, n) => s + n, 0);
  const jsonStr = JSON.stringify(payload);
  const meta: SnapshotMeta = {
    id: uid(),
    createdAt: Date.now(),
    reason,
    appVersion: payload.appVersion,
    totalRows,
    checksum: payload.checksum,
    bytes: jsonStr.length,
  };
  const d = await snapDb();
  await d.put("snapshots", { ...meta, payload });
  // Retention
  const all = await listSnapshots();
  for (const id of snapshotsToDelete(all, retention)) {
    await d.delete("snapshots", id);
  }
  return meta;
}

export async function deleteSnapshot(id: string) {
  const d = await snapDb();
  await d.delete("snapshots", id);
}

/** Should we take an automatic daily snapshot? */
export function shouldTakeDailySnapshot(existing: SnapshotMeta[], now: number, minIntervalMs = 24 * 60 * 60 * 1000): boolean {
  const daily = existing.filter((s) => s.reason === "daily-auto");
  if (daily.length === 0) return true;
  const newest = Math.max(...daily.map((s) => s.createdAt));
  return now - newest >= minIntervalMs;
}