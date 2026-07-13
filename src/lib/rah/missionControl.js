// Pure helpers for the Mission Control home dashboard.
//
// Everything here is deterministic and side-effect free so it can be
// exercised by fast Node tests. No React, no DOM, no IndexedDB. No
// telemetry is ever fabricated: if a value is missing from the source
// system-status snapshot we return an explicit "unavailable" marker
// rather than a made-up number.

/**
 * Compute the Raven Readiness score from real app checks. Never invents
 * a value: every input is a boolean the caller already resolved from
 * live app state.
 *
 * @param {{
 *   bridgeSnapshot: {ui?:string}|null,
 *   engine: string,
 *   projectSelected: boolean,
 *   memoryEnabled: boolean,
 *   voiceSupported: boolean,
 *   visionSupported: boolean,
 * }} inputs
 */
export function computeReadiness(inputs) {
  const bridgeOnline = inputs.bridgeSnapshot?.ui === "paired_online";
  const engineOk = inputs.engine === "cloud"
    ? true
    : inputs.engine === "demo"
      ? true
      : bridgeOnline; // local engines require the bridge in production
  const checks = [
    { id: "bridge", label: "Desktop Bridge online", ok: bridgeOnline, weight: 25,
      detail: bridgeOnline ? "paired_online" : (inputs.bridgeSnapshot?.ui ?? "checking") },
    { id: "engine", label: "AI engine reachable", ok: engineOk, weight: 25,
      detail: inputs.engine },
    { id: "project", label: "Active project selected", ok: !!inputs.projectSelected, weight: 15 },
    { id: "memory",  label: "Project memory enabled", ok: !!inputs.memoryEnabled,   weight: 15 },
    { id: "voice",   label: "Voice supported",         ok: !!inputs.voiceSupported,  weight: 10 },
    { id: "vision",  label: "Screen Vision available", ok: !!inputs.visionSupported, weight: 10 },
  ];
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = Math.round((got / totalWeight) * 100);
  return { score, checks };
}

/**
 * Determine the current privacy label for the running session.
 *
 * @param {{engine:string, transport:string, bridgeSnapshot:{ui?:string}|null}} inputs
 */
export function computePrivacyStatus(inputs) {
  const eng = inputs.engine;
  const bridgeOnline = inputs.bridgeSnapshot?.ui === "paired_online";
  if (eng === "demo") {
    return { label: "LOCAL", explanation: "Demo engine only — no network calls." };
  }
  if (eng === "cloud") {
    return { label: "CLOUD", explanation: "Requests go to Lovable AI Gateway over the network." };
  }
  // Local engines (lmstudio / ollama)
  if (inputs.transport === "direct") {
    return { label: "LOCAL", explanation: "Local model reached directly from this browser." };
  }
  if (bridgeOnline) {
    return { label: "LOCAL", explanation: "Local model reached through the paired Desktop Bridge on 127.0.0.1." };
  }
  return { label: "OFFLINE", explanation: "Local engine selected but the Desktop Bridge is not reachable." };
}

function normalizeMemory(r) {
  return {
    id: String(r.id),
    projectId: r.projectId ?? null,
    title: String(r.title ?? "").trim(),
    type: String(r.type ?? "note"),
    updatedAt: Number(r.updatedAt) || Number(r.createdAt) || 0,
    pinned: !!r.pinned,
    archived: !!r.archived,
  };
}

/**
 * Derive "Today's Mission" from project memory + recent commands.
 * Suggestions are deterministic — no AI required.
 *
 * @param {{projectMemory: any[], projectId: string|null, commands?: any[], now?: number, limit?: number}} inputs
 */
export function deriveTodaysMission(inputs) {
  const scope = (inputs.projectMemory ?? [])
    .map(normalizeMemory)
    .filter((r) => !r.archived && (r.projectId === (inputs.projectId ?? null) || r.projectId === null));
  const newest = (t) =>
    scope.filter((r) => r.type === t).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  const blocker = newest("blocker");
  const nextAction = newest("next_action");
  const lastMilestone = newest("milestone");

  const limit = Number.isFinite(inputs.limit) ? inputs.limit : 5;
  const suggestions = [];
  const seen = new Set();
  const push = (title, source) => {
    const key = title.toLowerCase();
    if (!title || seen.has(key) || suggestions.length >= limit) return;
    seen.add(key);
    suggestions.push({ title, source });
  };
  if (nextAction) push(nextAction.title, "memory:next_action");
  if (blocker) push("Resolve blocker: " + blocker.title, "memory:blocker");
  for (const r of scope.filter((r) => r.pinned).sort((a, b) => b.updatedAt - a.updatedAt)) {
    push(r.title, "memory:pinned");
  }
  for (const c of (inputs.commands ?? [])) {
    if (suggestions.length >= limit) break;
    if (c && c.status === "awaiting_approval" && typeof c.prompt === "string") {
      push("Approve pending: " + c.prompt.slice(0, 60), "command:awaiting");
    }
  }
  return { blocker, nextAction, lastMilestone, suggestions };
}

/**
 * Merge Command History and Project Memory events into one recent list,
 * newest first. Only real persisted records are used — nothing invented.
 *
 * @param {{commands?: any[], projectMemory?: any[], limit?: number}} inputs
 */
export function mergeRecentActivity(inputs) {
  const limit = Number.isFinite(inputs.limit) ? inputs.limit : 8;
  const rows = [];
  for (const c of inputs.commands ?? []) {
    if (!c) continue;
    rows.push({
      ts: Number(c.createdAt) || 0,
      kind: "command",
      title: String(c.prompt ?? "").slice(0, 120) || "(empty prompt)",
      source: "history",
      status: c.status,
    });
  }
  for (const m of inputs.projectMemory ?? []) {
    if (!m || m.archived) continue;
    rows.push({
      ts: Number(m.updatedAt) || Number(m.createdAt) || 0,
      kind: "memory",
      title: String(m.title ?? "").slice(0, 120),
      source: "memory:" + (m.type ?? "note"),
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, limit);
}

/**
 * Format the Desktop Bridge system-status snapshot into safe display
 * strings. Missing fields become explicit "unavailable" labels — this
 * function never fabricates values.
 *
 * @param {any} sys
 * @param {{latencyMs?: number}} [meta]
 */
export function formatTelemetry(sys, meta) {
  if (!sys || typeof sys !== "object") {
    return {
      available: false,
      cpuLine: "CPU telemetry unavailable",
      memoryLine: "Memory telemetry unavailable",
      platformLine: "Platform telemetry unavailable",
      hostUserLine: "Host telemetry unavailable",
      latencyLine: "Bridge latency unavailable",
      gpuLine: "GPU telemetry unavailable",
    };
  }
  const cores = sys.cpu?.cores;
  const cpuLine = Number.isFinite(cores)
    ? `${cores} cores${sys.cpu?.model ? " · " + sys.cpu.model : ""}`
    : "CPU telemetry unavailable";
  const total = Number(sys.memory?.totalBytes) || 0;
  const used = Number(sys.memory?.usedBytes) || 0;
  const memoryLine = total > 0
    ? `${(used / 1e9).toFixed(1)} / ${(total / 1e9).toFixed(1)} GB used`
    : "Memory telemetry unavailable";
  const platformLine = sys.platform
    ? `${sys.platform}${sys.arch ? " · " + sys.arch : ""}${sys.release ? " · " + sys.release : ""}`
    : "Platform telemetry unavailable";
  const hostUserLine = sys.hostname || sys.username
    ? `${sys.username ?? "?"}@${sys.hostname ?? "?"}`
    : "Host telemetry unavailable";
  const latencyLine = Number.isFinite(meta?.latencyMs)
    ? `${meta.latencyMs} ms`
    : "Bridge latency unavailable";
  return {
    available: true,
    cpuLine, memoryLine, platformLine, hostUserLine, latencyLine,
    // We deliberately do not surface GPU data — Node's os module cannot
    // provide it and we refuse to invent one.
    gpuLine: "GPU telemetry unavailable",
  };
}

/**
 * Roll up the current orchestration state and session-only stats into
 * a small summary card. Nothing is persisted; nothing is invented.
 */
export function agentTeamCounts(state, agentStats) {
  const stats = agentStats ?? {};
  let completed = 0, failed = 0, runs = 0;
  for (const s of Object.values(stats)) {
    completed += s.completed ?? 0;
    failed += s.failed ?? 0;
    runs += s.runs ?? 0;
  }
  const tasks = state?.tasks ?? [];
  const running = tasks.filter((t) => t.state === "running" || t.state === "queued").length;
  const phase = state?.phase ?? "idle";
  const active = phase === "running" || phase === "synthesizing";
  return {
    phase,
    active,
    runningTasks: running,
    completedRuns: completed,
    failedRuns: failed,
    totalRuns: runs,
    currentRunId: state?.runId,
  };
}

export const FOCUS_MODE_KEY = "rah:missionControl:focus:v1";

export function loadFocusMode() {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(FOCUS_MODE_KEY) === "1"; } catch { return false; }
}
export function saveFocusMode(on) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(FOCUS_MODE_KEY, on ? "1" : "0"); } catch { /* quota */ }
}