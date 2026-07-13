import { openDB } from "idb";
import {
  BRIDGE_MIN_VERSION, REQUIRED_BRIDGE_FEATURES, DEFAULT_BRIDGE_PORT, PROTOCOL_VERSION,
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

/**
 * Signed raw fetch to the bridge for streaming responses (Local AI proxy).
 * Returns a native Response so callers can stream body chunks directly.
 *
 * `subpath` is appended after `/v1` (e.g. "/localai/lmstudio/models").
 */
export async function bridgeSignedFetch(
  method: "GET" | "POST",
  subpath: string,
  body?: unknown,
  init?: { signal?: AbortSignal; port?: number },
): Promise<Response> {
  const creds = await loadCredentials();
  if (!creds) throw new Error("Bridge not paired");
  const raw = body === undefined ? "" : JSON.stringify(body);
  const path = `/${PROTOCOL_VERSION}${subpath}`;
  const headers = await signHeaders(method, path, raw, creds.deviceToken, creds.hmacSecret);
  return await fetch(`${baseUrl(init?.port ?? DEFAULT_BRIDGE_PORT)}${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : raw,
    signal: init?.signal,
  });
}

/** True if bridge credentials are stored (paired at some point). */
export async function isBridgePaired(): Promise<boolean> {
  try { return !!(await loadCredentials()); } catch { return false; }
}

export type BridgeUiState =
  | "offline" | "pairing_required" | "paired_online" | "emergency_stopped"
  | "version_mismatch" | "feature_missing" | "error";

export interface BridgeStatusSnapshot {
  ui: BridgeUiState;
  version?: string;
  latencyMs?: number;
  paired: boolean;
  pairedAt?: number;
  emergencyStopped?: boolean;
  message?: string;
  features?: string[];
  missingFeatures?: string[];
}

export async function bridgeStatusSnapshot(): Promise<BridgeStatusSnapshot> {
  const h = await bridgeHealth();
  const creds = await loadCredentials();
  if (h.state === "offline") return { ui: "offline", paired: !!creds, message: h.message };
  if (h.state === "error") return { ui: "error", paired: !!creds, message: h.message, latencyMs: h.latencyMs };
  const detected = h.bridgeVersion;
  if (detected && !isVersionCompatible(detected, BRIDGE_MIN_VERSION)) {
    return {
      ui: "version_mismatch",
      paired: !!creds,
      version: detected,
      latencyMs: h.latencyMs,
      message: `Bridge v${detected} is below the required minimum v${BRIDGE_MIN_VERSION}. Download v${BRIDGE_MIN_VERSION} from Connections and restart the bridge.`,
    };
  }
  const features = Array.isArray(h.features) ? h.features : [];
  const missingFeatures = REQUIRED_BRIDGE_FEATURES.filter((f) => !features.includes(f));
  // Feature gate: a bridge that answers /health but lacks a required
  // feature (e.g. an older 0.2.0 build without /v1/localai/*) must NOT be
  // treated as fully paired-online. This is what stopped local AI from
  // silently appearing "offline" when the source ZIP was out of date.
  if (missingFeatures.length > 0) {
    return {
      ui: "feature_missing",
      paired: !!(h.paired && creds),
      version: detected,
      latencyMs: h.latencyMs,
      features,
      missingFeatures: [...missingFeatures],
      message:
        `Bridge v${detected ?? "?"} is missing required feature(s): ${missingFeatures.join(", ")}. ` +
        `Download v${BRIDGE_MIN_VERSION} from Connections and restart the bridge.`,
    };
  }
  const paired = !!(h.paired && creds);
  if (!paired) return { ui: "pairing_required", paired: false, version: h.bridgeVersion, latencyMs: h.latencyMs };
  if (h.emergencyStopped) return { ui: "emergency_stopped", paired: true, version: h.bridgeVersion, pairedAt: creds?.pairedAt, latencyMs: h.latencyMs, emergencyStopped: true, features };
  return { ui: "paired_online", paired: true, version: h.bridgeVersion, pairedAt: creds?.pairedAt, latencyMs: h.latencyMs, features };
}

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compatible if:
 *   - detected version parses,
 *   - detected.major === min.major (a bumped major is treated as incompatible
 *     until the web client is updated for the new protocol), and
 *   - detected >= min (semver-style compare on major.minor.patch).
 */
export function isVersionCompatible(detected: string, min: string): boolean {
  const d = parseVersion(detected);
  const m = parseVersion(min);
  if (!d || !m) return false;
  if (d[0] !== m[0]) return false;
  for (let i = 0; i < 3; i++) {
    if (d[i] > m[i]) return true;
    if (d[i] < m[i]) return false;
  }
  return true;
}
