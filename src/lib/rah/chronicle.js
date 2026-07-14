// Pure helpers for the Raven Chronicle.
//
// Merges existing real data (commands, project memory, approvals) into a
// deterministic, chronological timeline. Never fabricates events, never
// silently persists. All AI-generated summaries are drafts returned to
// the UI for explicit user confirmation.

/**
 * @typedef {"command"|"memory"|"approval"|"connection"|"summary"} ChronicleKind
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: ChronicleKind,
 *   ts: number,
 *   title: string,
 *   detail?: string,
 *   tone?: "ok"|"warn"|"bad"|"info",
 *   sourceId?: string,
 *   type?: string,
 *   projectId?: string|null,
 *   source?: string,
 * }} ChronicleEntry
 */

function safeStr(s, max = 200) {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Build a merged timeline from real records only.
 *
 * @param {{
 *   commands?: any[],
 *   projectMemory?: any[],
 *   approvals?: any[],
 * }} sources
 * @returns {ChronicleEntry[]}
 */
export function buildChronicleEntries(sources) {
  const out = /** @type {ChronicleEntry[]} */ ([]);
  // Build lookup maps for approval → projectId derivation.
  const cmdById = new Map();
  for (const c of sources.commands ?? []) if (c && c.id) cmdById.set(c.id, c);
  const runById = new Map();
  for (const r of sources.workflowRuns ?? []) if (r && r.runId) runById.set(r.runId, r);
  for (const c of sources.commands ?? []) {
    if (!c || typeof c.createdAt !== "number") continue;
    /** @type {"ok"|"warn"|"bad"|"info"} */
    let tone = "info";
    if (c.status === "done") tone = "ok";
    else if (c.status === "error") tone = "bad";
    else if (c.status === "rejected") tone = "warn";
    out.push({
      id: "cmd:" + c.id,
      kind: "command",
      ts: c.createdAt,
      title: safeStr(c.prompt) || "(empty prompt)",
      detail: c.resultSummary ? safeStr(c.resultSummary, 240) : undefined,
      tone,
      sourceId: c.id,
      type: c.status,
      projectId: c.projectId ?? null,
      source: "command",
    });
  }
  for (const m of sources.projectMemory ?? []) {
    if (!m || typeof m.updatedAt !== "number") continue;
    if (m.archived) continue;
    /** @type {"ok"|"warn"|"bad"|"info"} */
    let tone = "info";
    if (m.type === "milestone") tone = "ok";
    else if (m.type === "blocker") tone = "warn";
    else if (m.type === "decision") tone = "info";
    out.push({
      id: "mem:" + m.id,
      kind: m.type === "daily_log" ? "summary" : "memory",
      ts: m.updatedAt,
      title: safeStr(m.title) || "(untitled memory)",
      detail: safeStr(m.content, 240),
      tone,
      sourceId: m.id,
      type: m.type,
      projectId: m.projectId ?? null,
      source: "memory",
    });
  }
  for (const a of sources.approvals ?? []) {
    if (!a || typeof a.createdAt !== "number") continue;
    if (a.status === "pending") continue;
    /** @type {"ok"|"warn"|"bad"|"info"} */
    const tone = a.status === "approved" ? "ok"
      : a.status === "rejected" ? "warn"
      : "info";
    // Derive projectId from linked command or workflow run when possible.
    // Never guess: leave null if no explicit link.
    let projectId = null;
    if (a.commandId && cmdById.has(a.commandId)) projectId = cmdById.get(a.commandId).projectId ?? null;
    else if (a.workflowRunId && runById.has(a.workflowRunId)) projectId = runById.get(a.workflowRunId).projectId ?? null;
    out.push({
      id: "app:" + a.id,
      kind: "approval",
      ts: a.createdAt,
      title: safeStr(a.title) || "(approval)",
      detail: `${a.status} · ${safeStr(a.reason, 160)}`,
      tone,
      sourceId: a.id,
      type: a.status,
      projectId,
      source: "approval",
    });
  }
  for (const r of sources.workflowRuns ?? []) {
    if (!r || typeof r.createdAt !== "number") continue;
    // Only include terminal runs so we don't fabricate progress from drafts.
    if (r.status !== "completed" && r.status !== "failed"
        && r.status !== "cancelled") continue;
    /** @type {"ok"|"warn"|"bad"|"info"} */
    const tone = r.status === "completed" ? "ok"
      : r.status === "failed" ? "bad" : "warn";
    out.push({
      id: "run:" + r.runId,
      kind: "command",
      ts: r.finishedAt ?? r.startedAt ?? r.createdAt,
      title: `Workflow ${r.status}: ${safeStr(r.workflowName ?? r.workflowId ?? "workflow")}`,
      detail: r.errorMessage ? safeStr(r.errorMessage, 240) : undefined,
      tone,
      sourceId: r.runId,
      type: r.status,
      projectId: r.projectId ?? null,
      source: "workflow",
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** Format a UTC-safe YYYY-MM-DD key using local time. */
export function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {ChronicleEntry[]} entries */
export function groupByDay(entries) {
  const groups = new Map();
  for (const e of entries) {
    const k = dayKey(e.ts);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }));
}

/** @param {ChronicleEntry[]} entries */
export function filterEntries(entries, opts = {}) {
  const q = (opts.q ?? "").trim().toLowerCase();
  const kinds = opts.kinds instanceof Set ? opts.kinds : new Set(opts.kinds ?? []);
  const sources = opts.sources instanceof Set ? opts.sources : (opts.sources ? new Set(opts.sources) : null);
  const from = Number.isFinite(opts.from) ? opts.from : null;
  const to = Number.isFinite(opts.to) ? opts.to : null;
  // projectFilter: undefined = all, null = unassigned only, string = that project id.
  const projectFilter = opts.projectId;
  return entries.filter((e) => {
    if (kinds.size > 0 && !kinds.has(e.kind)) return false;
    if (sources && sources.size > 0 && !sources.has(e.source ?? "unknown")) return false;
    if (from != null && e.ts < from) return false;
    if (to != null && e.ts > to) return false;
    if (projectFilter !== undefined) {
      const pid = e.projectId ?? null;
      if (projectFilter === null) { if (pid !== null) return false; }
      else if (pid !== projectFilter) return false;
    }
    if (!q) return true;
    return (e.title + " " + (e.detail ?? "")).toLowerCase().includes(q);
  });
}

/** Build a deterministic draft summary from a single day's entries. */
export function buildDailySummaryDraft(entries, opts = {}) {
  const now = opts.now ?? Date.now();
  const key = dayKey(now);
  const dayEntries = entries.filter((e) => dayKey(e.ts) === key);
  const commands = dayEntries.filter((e) => e.kind === "command");
  const memory = dayEntries.filter((e) => e.kind === "memory");
  const approvals = dayEntries.filter((e) => e.kind === "approval");
  const milestones = memory.filter((e) => e.type === "milestone");
  const blockers = memory.filter((e) => e.type === "blocker");
  const decisions = memory.filter((e) => e.type === "decision");
  const nextActions = memory.filter((e) => e.type === "next_action");
  const lines = [];
  lines.push(`# Chronicle — ${key}`);
  lines.push("");
  lines.push(`- Commands run: ${commands.length}`);
  lines.push(`- Approvals resolved: ${approvals.length}`);
  lines.push(`- Memory changes: ${memory.length} (milestones ${milestones.length}, blockers ${blockers.length}, decisions ${decisions.length}, next actions ${nextActions.length})`);
  if (milestones.length) {
    lines.push("");
    lines.push("## Milestones");
    for (const m of milestones.slice(0, 5)) lines.push(`- ${m.title}`);
  }
  if (decisions.length) {
    lines.push("");
    lines.push("## Decisions");
    for (const m of decisions.slice(0, 5)) lines.push(`- ${m.title}`);
  }
  if (blockers.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const m of blockers.slice(0, 5)) lines.push(`- ${m.title}`);
  }
  if (nextActions.length) {
    lines.push("");
    lines.push("## Next actions");
    for (const m of nextActions.slice(0, 5)) lines.push(`- ${m.title}`);
  }
  if (commands.length === 0 && memory.length === 0 && approvals.length === 0) {
    lines.push("");
    lines.push("_No activity recorded for this day yet._");
  }
  return {
    day: key,
    text: lines.join("\n"),
    counts: {
      commands: commands.length,
      approvals: approvals.length,
      memory: memory.length,
      milestones: milestones.length,
      blockers: blockers.length,
      decisions: decisions.length,
      nextActions: nextActions.length,
    },
    // Explicit contract: caller must confirm before persisting.
    requiresExplicitSave: true,
  };
}

/** Export helper: JSON blob text for a list of chronicle entries. */
export function exportChronicleJson(entries) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    count: entries.length,
    entries,
  }, null, 2);
}

/** Export helper: Markdown for a list of chronicle entries. */
export function exportChronicleMarkdown(entries) {
  const groups = groupByDay(entries);
  const lines = ["# Raven Chronicle export", ""];
  for (const g of groups) {
    lines.push(`## ${g.day}`);
    for (const e of g.items) {
      const time = new Date(e.ts).toISOString().slice(11, 16);
      lines.push(`- **${time}** · _${e.kind}${e.type ? "/" + e.type : ""}_ — ${e.title}`);
      if (e.detail) lines.push(`  - ${e.detail.replace(/\n+/g, " ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export const CHRONICLE_KINDS = ["command", "memory", "approval", "connection", "summary"];