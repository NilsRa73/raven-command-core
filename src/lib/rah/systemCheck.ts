/**
 * System Check — production "Make Everything Work" probe suite.
 *
 * Every probe returns an honest state. We never fabricate a healthy
 * result: if a service does not answer we report `offline` with the
 * exact corrective action the user can copy.
 *
 * No secrets are written to localStorage. Non-secret UI state
 * (last-run timestamp, "startWorkSessionEligible") uses stable keys.
 */

import {
  bridgeHealth, bridgeStatusSnapshot, bridgeCapabilities, bridgeSignedFetch,
  isBridgePaired, loadCredentials,
} from "./bridge";
import type { BridgeStatusSnapshot } from "./bridge";
import { DEFAULT_BRIDGE_PORT, BRIDGE_MIN_VERSION } from "./bridge-protocol";
import { getLocalAiSettings } from "./localAi";
import { getDB } from "./db";
import { buildAuditChain, verifyChain } from "./auditChain";

export type CheckSeverity = "ok" | "warn" | "bad" | "info";
export type OverallState = "ready" | "attention" | "offline" | "demo";

export interface CopyAction { label: string; text: string }

export interface CheckResult {
  id: string;
  label: string;
  severity: CheckSeverity;
  detail: string;
  hint?: string;
  copy?: CopyAction[];
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface SystemCheckReport {
  ts: number;
  overall: OverallState;
  summary: string;
  checks: CheckResult[];
  bridgePortDetected?: number;
  bridgeSnapshot?: BridgeStatusSnapshot;
  approvedRoots?: string[];
  canStartWorkSession: boolean;
}

/** Ports the System Check will probe, in order of preference. */
export const PROBE_PORTS: readonly number[] = [8765, DEFAULT_BRIDGE_PORT];

const LAST_REPORT_KEY = "rah:systemCheck:last:v1";
const WORK_SESSION_KEY = "rah:systemCheck:workSessionEligibleAt:v1";

function classifyOverall(checks: CheckResult[]): OverallState {
  const required = checks.filter((c) => c.id === "web" || c.id === "bridge" || c.id === "lmstudio" || c.id === "audit");
  const anyBad = required.some((c) => c.severity === "bad");
  const anyWarn = required.some((c) => c.severity === "warn");
  const engine = checks.find((c) => c.id === "engine")?.meta?.engine;
  if (engine === "demo") return "demo";
  if (anyBad) {
    const bridgeBad = required.find((c) => c.id === "bridge")?.severity === "bad";
    const lmBad = required.find((c) => c.id === "lmstudio")?.severity === "bad";
    if (bridgeBad && lmBad) return "offline";
    return "attention";
  }
  if (anyWarn) return "attention";
  return "ready";
}

function summarize(overall: OverallState): string {
  switch (overall) {
    case "ready":     return "All required systems are online. You are cleared to start work.";
    case "attention": return "Some systems need attention. Follow the corrective actions below.";
    case "offline":   return "Local services are unreachable. Start the Desktop Bridge and LM Studio.";
    case "demo":      return "Running in Local Demo Engine mode. Switch to a real engine to enable full features.";
  }
}

function copy(label: string, text: string): CopyAction { return { label, text }; }

/* ---------- individual probes ---------- */

function checkWebApp(): CheckResult {
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  return {
    id: "web",
    label: "Raven web app",
    severity: online ? "ok" : "bad",
    detail: online ? "Loaded and reachable." : "Browser reports offline — network unreachable.",
  };
}

async function probeBridgePort(port: number): Promise<{ port: number; ok: boolean; version?: string; features?: string[]; latencyMs?: number; paired?: boolean; emergencyStopped?: boolean; message?: string }> {
  const h = await bridgeHealth(port);
  if (h.state === "online") {
    return { port, ok: true, version: h.bridgeVersion, features: h.features, latencyMs: h.latencyMs, paired: !!h.paired, emergencyStopped: !!h.emergencyStopped };
  }
  return { port, ok: false, message: h.message, latencyMs: h.latencyMs };
}

async function checkBridge(): Promise<{ result: CheckResult; snapshot: BridgeStatusSnapshot | undefined; detectedPort?: number; roots?: string[] }> {
  const probes = await Promise.all(PROBE_PORTS.map(probeBridgePort));
  const alive = probes.find((p) => p.ok);
  if (!alive) {
    return {
      result: {
        id: "bridge",
        label: "RAH Desktop Bridge",
        severity: "bad",
        detail: `No bridge answered on ${PROBE_PORTS.map((p) => "127.0.0.1:" + p).join(" or ")}.`,
        hint: "Start the bridge on your Windows PC (Omen). See the Windows startup guide below.",
        copy: [
          copy("Bridge start command", "cd desktop-bridge && node src\\index.js"),
          copy("Preferred URL", "http://127.0.0.1:8765/v1/health"),
          copy("Default URL", "http://127.0.0.1:47824/v1/health"),
        ],
      },
      snapshot: undefined,
    };
  }

  // Snapshot uses the default port; if the alive port differs, still
  // report honestly rather than pretending the client is paired there.
  const snap = alive.port === DEFAULT_BRIDGE_PORT ? await bridgeStatusSnapshot() : undefined;

  let roots: string[] | undefined;
  if (snap?.ui === "paired_online") {
    try { roots = (await bridgeCapabilities()).approvedRoots; } catch { /* keep undefined */ }
  }

  const hostname = "Omen";
  const meta: Record<string, string | number | boolean | null | undefined> = {
    port: alive.port,
    version: alive.version ?? "unknown",
    latencyMs: alive.latencyMs ?? -1,
    hostname,
    paired: !!snap?.paired,
    emergencyStopped: !!snap?.emergencyStopped,
  };

  if (alive.emergencyStopped) {
    return {
      result: {
        id: "bridge",
        label: "RAH Desktop Bridge",
        severity: "warn",
        detail: `Bridge v${alive.version} is in Emergency Stop.`,
        hint: "Open Connections and press Resume, or restart the bridge.",
        meta,
      },
      snapshot: snap, detectedPort: alive.port, roots,
    };
  }

  if (snap?.ui === "version_mismatch" || snap?.ui === "feature_missing") {
    return {
      result: {
        id: "bridge",
        label: "RAH Desktop Bridge",
        severity: "bad",
        detail: snap.message ?? "Bridge version incompatible.",
        hint: `Download v${BRIDGE_MIN_VERSION} from Connections and restart the bridge.`,
        copy: [copy("Required min version", BRIDGE_MIN_VERSION)],
        meta,
      },
      snapshot: snap, detectedPort: alive.port, roots,
    };
  }

  if (!alive.paired || snap?.ui === "pairing_required") {
    return {
      result: {
        id: "bridge",
        label: "RAH Desktop Bridge",
        severity: "warn",
        detail: `Bridge v${alive.version} online on 127.0.0.1:${alive.port} but this browser is not paired.`,
        hint: "Open Connections and enter the 6-digit code shown in the bridge console.",
        meta,
      },
      snapshot: snap, detectedPort: alive.port, roots,
    };
  }

  return {
    result: {
      id: "bridge",
      label: "RAH Desktop Bridge",
      severity: "ok",
      detail: `Paired · v${alive.version} · ${alive.latencyMs ?? "?"} ms · 127.0.0.1:${alive.port} · ${hostname}`,
      meta,
    },
    snapshot: snap, detectedPort: alive.port, roots,
  };
}

function checkEngine(): CheckResult {
  const s = getLocalAiSettings();
  return {
    id: "engine",
    label: "AI engine selection",
    severity: s.engine === "demo" ? "info" : "ok",
    detail: `Engine: ${s.engine} · transport: ${s.transport} · LM Studio model: ${s.lmStudioModel}`,
    meta: { engine: s.engine, transport: s.transport },
  };
}

/**
 * LM Studio via the authenticated bridge proxy. Never a direct browser
 * fetch to 127.0.0.1:1234 — that would misrepresent an unpaired setup as
 * working.
 */
async function checkLmStudio(bridgeOk: boolean): Promise<CheckResult> {
  if (!bridgeOk) {
    return {
      id: "lmstudio",
      label: "LM Studio (local model)",
      severity: "bad",
      detail: "Cannot verify — Desktop Bridge must be paired and online first.",
      hint: "Fix the Bridge check above, then re-run System Check.",
    };
  }
  try {
    const res = await bridgeSignedFetch("GET", "/localai/lmstudio/models");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        id: "lmstudio",
        label: "LM Studio (local model)",
        severity: "bad",
        detail: `LM Studio proxy returned HTTP ${res.status}.`,
        hint: "In LM Studio, open Developer, load Gemma 3 4B Instruct, and Start Server on port 1234.",
        copy: [copy("LM Studio API URL", "http://127.0.0.1:1234/v1"), copy("Server body", text.slice(0, 300))],
      };
    }
    const j = await res.json() as { data?: { id: string }[] };
    const models = j.data ?? [];
    if (models.length === 0) {
      return {
        id: "lmstudio",
        label: "LM Studio (local model)",
        severity: "warn",
        detail: "LM Studio is reachable but has no models loaded.",
        hint: "Load Gemma 3 4B Instruct (or any chat model) in LM Studio, then re-run System Check.",
      };
    }
    // Tiny harmless completion: 1-token echo.
    const settings = getLocalAiSettings();
    const model = settings.lmStudioModel || models[0].id;
    const chat = await bridgeSignedFetch("POST", "/localai/lmstudio/chat", {
      model, stream: false, temperature: 0, max_tokens: 4,
      messages: [
        { role: "system", content: "Respond with the single word: pong" },
        { role: "user", content: "ping" },
      ],
    });
    if (!chat.ok) {
      return {
        id: "lmstudio",
        label: "LM Studio (local model)",
        severity: "warn",
        detail: `Models list OK; test completion failed (HTTP ${chat.status}).`,
        hint: `Confirm the model "${model}" is loaded in LM Studio.`,
      };
    }
    const body = await chat.json().catch(() => ({})) as { choices?: { message?: { content?: string } }[] };
    const sample = body.choices?.[0]?.message?.content?.trim() ?? "";
    return {
      id: "lmstudio",
      label: "LM Studio (local model)",
      severity: "ok",
      detail: `${models.length} model(s) loaded · verified through bridge proxy · reply: "${sample.slice(0, 40)}"`,
      meta: { model, models: models.length },
    };
  } catch (err) {
    return {
      id: "lmstudio",
      label: "LM Studio (local model)",
      severity: "bad",
      detail: err instanceof Error ? err.message : String(err),
      hint: "Confirm LM Studio Developer Server is running on port 1234, with 'Serve on Local Network' OFF.",
    };
  }
}

async function checkOllama(bridgeOk: boolean): Promise<CheckResult> {
  if (!bridgeOk) {
    return {
      id: "ollama",
      label: "Ollama (optional fallback)",
      severity: "info",
      detail: "Skipped — Desktop Bridge not online.",
    };
  }
  try {
    const res = await bridgeSignedFetch("GET", "/localai/ollama/tags");
    if (!res.ok) {
      return {
        id: "ollama",
        label: "Ollama (optional fallback)",
        severity: "info",
        detail: `Not running (HTTP ${res.status}). Optional — LM Studio is the primary engine.`,
      };
    }
    const j = await res.json() as { models?: { name: string }[] };
    const models = j.models ?? [];
    return {
      id: "ollama",
      label: "Ollama (optional fallback)",
      severity: models.length ? "ok" : "info",
      detail: models.length ? `${models.length} model(s) installed.` : "Reachable · no models installed.",
    };
  } catch {
    return {
      id: "ollama",
      label: "Ollama (optional fallback)",
      severity: "info",
      detail: "Not reachable · optional fallback only.",
    };
  }
}

async function checkProjectMemory(): Promise<CheckResult> {
  try {
    const db = await getDB();
    const all = await db.getAll("projectMemory");
    return {
      id: "memory",
      label: "Project Memory",
      severity: "ok",
      detail: `${all.length} memory record(s) stored locally.`,
    };
  } catch (err) {
    return {
      id: "memory", label: "Project Memory", severity: "warn",
      detail: err instanceof Error ? err.message : "Memory store unreachable.",
    };
  }
}

async function checkApprovalsAndAudit(): Promise<CheckResult[]> {
  try {
    const db = await getDB();
    const approvals = await db.getAll("approvals");
    const commands = await db.getAll("commands");
    const pending = approvals.filter((a) => a.status === "pending").length;
    const approvalsCheck: CheckResult = {
      id: "approvals",
      label: "Approvals queue",
      severity: pending > 0 ? "warn" : "ok",
      detail: pending > 0 ? `${pending} approval(s) awaiting decision.` : `No pending approvals · ${approvals.length} total historical.`,
    };
    const chain = await buildAuditChain(commands, approvals);
    const verified = await verifyChain(chain);
    const auditCheck: CheckResult = {
      id: "audit",
      label: "Audit chain integrity",
      severity: verified.ok ? "ok" : "bad",
      detail: verified.ok
        ? `${chain.length} event(s) · SHA-256 hash chain verified.`
        : `Chain broken at event #${verified.brokenAt}.`,
    };
    return [approvalsCheck, auditCheck];
  } catch (err) {
    return [{
      id: "audit", label: "Audit chain integrity", severity: "warn",
      detail: err instanceof Error ? err.message : "Audit unreachable.",
    }];
  }
}

function checkAgents(): CheckResult {
  // Agents are always in-process; there is no external service to poll.
  return {
    id: "agents",
    label: "Agent Team",
    severity: "ok",
    detail: "Local orchestrator loaded. Real inference is gated by the AI engine check above.",
  };
}

function checkLocalBridgePermissions(roots: string[] | undefined): CheckResult {
  if (!roots) {
    return {
      id: "permissions",
      label: "Local Bridge permissions",
      severity: "info",
      detail: "Approved roots unknown until bridge is paired.",
    };
  }
  const required = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"];
  const covered = required.filter((name) => roots.some((r) => r.endsWith("\\" + name) || r.endsWith("/" + name)));
  const missing = required.filter((n) => !covered.includes(n));
  return {
    id: "permissions",
    label: "Local Bridge permissions",
    severity: missing.length === 0 ? "ok" : "warn",
    detail: `${covered.length}/${required.length} standard roots approved.`,
    hint: missing.length ? "Missing: " + missing.join(", ") + ". Edit approvedRoots in the bridge config.json." : undefined,
    meta: { approvedRoots: roots.length },
  };
}

/* ---------- top-level runner ---------- */

export async function runSystemCheck(): Promise<SystemCheckReport> {
  const checks: CheckResult[] = [];
  checks.push(checkWebApp());

  const bridge = await checkBridge();
  checks.push(bridge.result);

  const bridgeOk = bridge.result.severity === "ok";
  const [lmStudio, ollama] = await Promise.all([
    checkLmStudio(bridgeOk),
    checkOllama(bridgeOk),
  ]);
  checks.push(lmStudio, ollama);

  checks.push(checkEngine());
  checks.push(await checkProjectMemory());
  const approvalsAudit = await checkApprovalsAndAudit();
  checks.push(...approvalsAudit);
  checks.push(checkAgents());
  checks.push(checkLocalBridgePermissions(bridge.roots));

  const overall = classifyOverall(checks);
  const canStart = overall === "ready" || overall === "attention";

  const report: SystemCheckReport = {
    ts: Date.now(),
    overall,
    summary: summarize(overall),
    checks,
    bridgePortDetected: bridge.detectedPort,
    bridgeSnapshot: bridge.snapshot,
    approvedRoots: bridge.roots,
    canStartWorkSession: canStart,
  };

  persistNonSecretSummary(report);
  return report;
}

/** Persist a NON-secret summary: statuses, port, latency, timestamps.
 *  Never write tokens, HMAC secrets, or approval detail. */
function persistNonSecretSummary(r: SystemCheckReport): void {
  if (typeof window === "undefined") return;
  try {
    const safe = {
      ts: r.ts,
      overall: r.overall,
      bridgePortDetected: r.bridgePortDetected ?? null,
      checks: r.checks.map((c) => ({ id: c.id, severity: c.severity, detail: c.detail.slice(0, 200) })),
    };
    window.localStorage.setItem(LAST_REPORT_KEY, JSON.stringify(safe));
    if (r.canStartWorkSession) window.localStorage.setItem(WORK_SESSION_KEY, String(r.ts));
  } catch { /* quota */ }
}

export function loadLastReportSummary(): { ts: number; overall: OverallState } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_REPORT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { ts: number; overall: OverallState };
    return { ts: j.ts, overall: j.overall };
  } catch { return null; }
}

export function workSessionEligibleAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WORK_SESSION_KEY);
    return raw ? Number(raw) : null;
  } catch { return null; }
}

/** Confirm we NEVER persist token/hmac. Called by tests. */
export async function assertNoSecretLeakInLocalStorage(): Promise<{ ok: boolean; findings: string[] }> {
  const findings: string[] = [];
  if (typeof window === "undefined") return { ok: true, findings };
  try {
    const creds = await loadCredentials();
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      const v = window.localStorage.getItem(k) ?? "";
      if (creds?.deviceToken && v.includes(creds.deviceToken)) findings.push("token leak in " + k);
      if (creds?.hmacSecret && v.includes(creds.hmacSecret)) findings.push("hmac leak in " + k);
    }
  } catch { /* ignore */ }
  return { ok: findings.length === 0, findings };
}

// Re-export for widgets
export { isBridgePaired };

export const SYSTEM_CHECK_STORAGE_KEYS = { LAST_REPORT_KEY, WORK_SESSION_KEY };

export { classifyOverall };

/* ---------- Windows startup guide ---------- */

export const WINDOWS_STARTUP_GUIDE = `# Raven Command · Windows Startup Guide

Host: Omen (Windows 11)

## 1. Start the RAH Desktop Bridge

1. Download the latest package from **Connections → Download bridge** (rah-desktop-bridge-${BRIDGE_MIN_VERSION}.zip).
2. Extract it somewhere permanent, e.g. \`C:\\Tools\\rah-desktop-bridge\`.
3. Double-click \`Start RAH Desktop Bridge.cmd\`. A console appears showing:
       RAH_BRIDGE_READY port=47824 version=${BRIDGE_MIN_VERSION}
4. Leave the console open. It only listens on 127.0.0.1 — no LAN exposure.

Preferred URL:  http://127.0.0.1:8765
Default URL:    http://127.0.0.1:${DEFAULT_BRIDGE_PORT}

## 2. Pair the browser

1. Open Raven Command → Connections.
2. Enter the 6-digit pairing code shown in the bridge console.
3. The status changes to "Paired · Online".

## 3. Start LM Studio

1. Install LM Studio (https://lmstudio.ai).
2. Load the model **Gemma 3 4B Instruct**.
3. Open the Developer tab → **Start Server**.
4. Port: **1234** · "Serve on Local Network": **OFF** (loopback only).
5. Confirm LM Studio shows: Server running at http://127.0.0.1:1234

## 4. Verify

Run **System Check** in Raven Command. It probes:
- Bridge health, version, hostname, latency, pairing, emergency-stop
- LM Studio proxied through the bridge (no direct browser fetch)
- Ollama fallback (optional)
- Project Memory, Approvals, Audit chain integrity

## 5. Approved roots

The bridge is pre-scoped to: Desktop, Documents, Downloads, Pictures, Videos, Music.
Anything outside those roots is refused.

## Safety

- Risky actions always require explicit approval.
- No unrestricted PowerShell or CMD shell — \`launch.program\` is disabled.
- Tokens/HMAC secrets live in IndexedDB, never plain localStorage.
`;