import { openDB } from "idb";
import {
  DEFAULT_BRIDGE_PORT, PROTOCOL_VERSION,
  type BridgeHealth, type BridgePairResponse, type BridgeCapabilities,
  type BridgeSystemStatus, type BridgeListResult, type BridgeSearchResult,
  type BridgeReadTextResult, type BridgeJob, type BridgePrepareResponse,
  type CapabilityId,
} from "./bridge-protocol";

// ---- Secure token storage (IndexedDB, never localStorage) ----
const DB_NAME = "rah-bridge-secure";
const STORE = "kv";
async function db() {
  return openDB(DB_NAME, 1, { upgrade(d) { d.createObjectStore(STORE); } });
}
export async function saveCredentials(deviceToken: string, hmacSecret: string, pairedAt: number, bridgeVersion: string) {
  const d = await db();
  await d.put(STORE, { deviceToken, hmacSecret, pairedAt, bridgeVersion }, "creds");
}
export async function loadCredentials(): Promise<{ deviceToken: string; hmacSecret: string; pairedAt: number; bridgeVersion: string } | null> {
  const d = await db();
  return (await d.get(STORE, "creds")) ?? null;
}
export async function forgetCredentials() {
  const d = await db();
  await d.delete(STORE, "creds");
}

// ---- HMAC signing (Web Crypto) ----
function b(str: string) { return new TextEncoder().encode(str); }
function hex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(text: string) {
  return hex(await crypto.subtle.digest("SHA-256", b(text)));
}
async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", b(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, b(message)));
}
async function signHeaders(method: string, path: string, body: string, token: string, secret: string) {
  const ts = String(Date.now());
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(body ?? "");
  const canonical = [method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
  const sig = await hmacHex(secret, canonical);
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token,
    "X-RAH-Timestamp": ts,
    "X-RAH-Nonce": nonce,
    "X-RAH-Signature": sig,
  } as Record<string, string>;
}

// ---- Endpoint discovery ----
function baseUrl(port = DEFAULT_BRIDGE_PORT) { return `http://127.0.0.1:${port}`; }

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

// ---- Unauthenticated ----
export async function bridgeHealth(port = DEFAULT_BRIDGE_PORT): Promise<BridgeHealth & { latencyMs?: number; state: "offline" | "online" | "error"; message?: string }> {
  const start = performance.now();
  try {
    const res = await withTimeout(fetch(`${baseUrl(port)}/${PROTOCOL_VERSION}/health`, { method: "GET" }), 1500);
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) return { ok: false, state: "error", message: `HTTP ${res.status}`, latencyMs };
    const j = (await res.json()) as BridgeHealth;
    return { ...j, latencyMs, state: "online" };
  } catch (err) {
    return { ok: false, state: "offline", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function bridgePair(code: string, port = DEFAULT_BRIDGE_PORT): Promise<BridgePairResponse> {
  const res = await fetch(`${baseUrl(port)}/${PROTOCOL_VERSION}/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Pairing failed (HTTP ${res.status})`);
  }
  const j = (await res.json()) as BridgePairResponse;
  await saveCredentials(j.deviceToken, j.hmacSecret, Date.now(), j.bridgeVersion);
  return j;
}

// ---- Authenticated call helper ----
async function authedCall<T>(method: string, path: string, body?: unknown, port = DEFAULT_BRIDGE_PORT): Promise<T> {
  const creds = await loadCredentials();
  if (!creds) throw new Error("Bridge not paired");
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers = await signHeaders(method, `/${PROTOCOL_VERSION}${path}`, raw, creds.deviceToken, creds.hmacSecret);
  const res = await fetch(`${baseUrl(port)}/${PROTOCOL_VERSION}${path}`, { method, headers, body: method === "GET" ? undefined : raw });
  const text = await res.text();
  let json: unknown; try { json = text ? JSON.parse(text) : {}; } catch { json = { error: "bad_response" }; }
  if (!res.ok) {
    const j = json as { error?: string; message?: string };
    const err = new Error(j.error || `HTTP ${res.status}`);
    (err as Error & { status?: number; details?: unknown }).status = res.status;
    (err as Error & { status?: number; details?: unknown }).details = json;
    throw err;
  }
  return json as T;
}

export const bridgeCapabilities = () => authedCall<BridgeCapabilities>("GET", "/capabilities");
export const bridgeSystemStatus = () => authedCall<BridgeSystemStatus>("GET", "/system/status");
export const bridgeListFolder = (path: string) => authedCall<BridgeListResult>("POST", "/files/list", { path });
export const bridgeSearch = (opts: { root: string; query?: string; extensions?: string[]; limit?: number }) => authedCall<BridgeSearchResult>("POST", "/files/search", opts);
export const bridgeReadText = (path: string) => authedCall<BridgeReadTextResult>("POST", "/files/read-text", { path });
export const bridgeEmergencyStop = () => authedCall<{ ok: boolean; stopped: boolean }>("POST", "/emergency-stop", {});
export const bridgeResume = () => authedCall<{ ok: boolean; stopped: boolean }>("POST", "/resume", {});
export const bridgeAuditRecent = () => authedCall<{ entries: unknown[] }>("GET", "/audit/recent");

/**
 * Prepare an action. The response includes a one-time `confirmationToken`
 * that MUST be passed back verbatim to bridgeExecute. The token is only
 * returned here; the bridge never returns it again.
 */
export async function bridgePrepare(capability: CapabilityId, params: Record<string, unknown> = {}) {
  return authedCall<BridgePrepareResponse>("POST", "/actions/prepare", { capability, params });
}
/**
 * Execute a prepared action. Only jobId, approvalId, and confirmationToken
 * are accepted — no per-call parameter overrides.
 */
export async function bridgeExecute(jobId: string, approvalId: string, confirmationToken: string) {
  return authedCall<{ job: BridgeJob }>("POST", "/actions/execute", { jobId, approvalId, confirmationToken });
}
export async function bridgeCancel(jobId: string) {
  return authedCall<{ job: BridgeJob }>("POST", "/actions/cancel", { jobId });
}

/**
 * Server-side disconnect. Revokes the on-disk device credentials and
 * starts a fresh pairing session whose 6-digit code is printed only in the
 * local bridge console. Also forgets the browser-side credentials so the
 * UI drops back into the pairing wizard.
 */
export async function bridgeDisconnect() {
  try {
    await authedCall<{ ok: boolean; disconnected: boolean }>("POST", "/disconnect", {});
  } finally {
    await forgetCredentials();
  }
}

export type BridgeUiState =
  | "offline" | "pairing_required" | "paired_online" | "emergency_stopped"
  | "version_mismatch" | "error";

export interface BridgeStatusSnapshot {
  ui: BridgeUiState;
  version?: string;
  latencyMs?: number;
  paired: boolean;
  pairedAt?: number;
  emergencyStopped?: boolean;
  message?: string;
}

export async function bridgeStatusSnapshot(): Promise<BridgeStatusSnapshot> {
  const h = await bridgeHealth();
  const creds = await loadCredentials();
  if (h.state === "offline") return { ui: "offline", paired: !!creds, message: h.message };
  if (h.state === "error") return { ui: "error", paired: !!creds, message: h.message, latencyMs: h.latencyMs };
  const paired = !!(h.paired && creds);
  if (!paired) return { ui: "pairing_required", paired: false, version: h.bridgeVersion, latencyMs: h.latencyMs };
  if (h.emergencyStopped) return { ui: "emergency_stopped", paired: true, version: h.bridgeVersion, pairedAt: creds?.pairedAt, latencyMs: h.latencyMs, emergencyStopped: true };
  return { ui: "paired_online", paired: true, version: h.bridgeVersion, pairedAt: creds?.pairedAt, latencyMs: h.latencyMs };
}
