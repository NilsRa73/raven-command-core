// Pure helpers for the Raven Chronicle. Truth-only: never fabricates, never
// silently persists. Merges real records (commands, project memory,
// approvals, workflow runs) into a chronological, filterable timeline.

function safeStr(s, max = 200) {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Draft/queued workflow runs are excluded — they represent no real work yet. */
const WF_INCLUDE = new Set(["completed", "failed", "cancelled", "running", "paused", "awaiting_approval"]);

export function buildChronicleEntries(sources) {
  const out = [];
  const commands = sources.commands ?? [];
  const projectMemory = sources.projectMemory ?? [];
  const approvals = sources.approvals ?? [];
  const workflowRuns = sources.workflowRuns ?? [];
  const workflows = sources.workflows ?? [];

  const cmdById = new Map();
  for (const c of commands) if (c && c.id) cmdById.set(c.id, c);
  const wfById = new Map();
  for (const w of workflows) if (w && w.id) wfById.set(w.id, w);
  const runById = new Map();
  for (const r of workflowRuns) if (r && r.runId) runById.set(r.runId, r);

  function projectIdOfRun(run) {
    if (!run) return null;
    if (typeof run.projectId === "string") return run.projectId;
    const wf = wfById.get(run.workflowId);
    return wf && typeof wf.projectId === "string" ? wf.projectId : null;
  }
  function projectIdOfApproval(a) {
    if (!a) return null;
    if (a.commandId) {
      const c = cmdById.get(a.commandId);
      if (c && typeof c.projectId === "string") return c.projectId;
    }
    if (a.workflowRunId) return projectIdOfRun(runById.get(a.workflowRunId));
    return null;
  }

  for (const c of commands) {
    if (!c || typeof c.createdAt !== "number") continue;
    let tone = "info";
    if (c.status === "done") tone = "ok";
    else if (c.status === "error") tone = "bad";
    else if (c.status === "rejected") tone = "warn";
    out.push({
      id: "cmd:" + c.id, kind: "command", source: "command",
      ts: c.createdAt,
      title: safeStr(c.prompt) || "(empty prompt)",
      detail: c.resultSummary ? safeStr(c.resultSummary, 240) : undefined,
      tone, sourceId: c.id, type: c.status,
      projectId: typeof c.projectId === "string" ? c.projectId : null,
    });
  }
  for (const m of projectMemory) {
    if (!m || typeof m.updatedAt !== "number") continue;
    if (m.archived) continue;
    let tone = "info";
    if (m.type === "milestone") tone = "ok";
    else if (m.type === "blocker") tone = "warn";
    out.push({
      id: "mem:" + m.id,
      kind: m.type === "daily_log" || m.type === "weekly_log" ? "summary" : "memory",
      source: "memory",
      ts: m.updatedAt,
      title: safeStr(m.title) || "(untitled memory)",
      detail: safeStr(m.content, 240),
      tone, sourceId: m.id, type: m.type,
      projectId: typeof m.projectId === "string" ? m.projectId : null,
    });
  }
  for (const a of approvals) {
    if (!a || typeof a.createdAt !== "number") continue;
    if (a.status === "pending") continue;
    const tone = a.status === "approved" ? "ok" : a.status === "rejected" ? "warn" : "info";
    out.push({
      id: "app:" + a.id, kind: "approval", source: "approval",
      ts: a.createdAt,
      title: safeStr(a.title) || "(approval)",
      detail: `${a.status} · ${safeStr(a.reason, 160)}`,
      tone, sourceId: a.id, type: a.status,
      projectId: projectIdOfApproval(a),
    });
  }
  for (const r of workflowRuns) {
    if (!r || typeof r.createdAt !== "number") continue;
    const status = r.status || "unknown";
    if (!WF_INCLUDE.has(status)) continue;
    const tone = status === "completed" ? "ok"
      : status === "failed" ? "bad"
      : status === "cancelled" ? "warn" : "info";
    const wf = wfById.get(r.workflowId);
    const name = (r.workflowName || (wf && wf.name)) || "Workflow";
    const detail = r.errorMessage || r.failureReason || undefined;
    out.push({
      id: "run:" + r.runId, kind: "workflow", source: "workflow",
      ts: r.finishedAt || r.startedAt || r.createdAt,
      title: `${name} · ${status}`,
      detail: detail ? safeStr(detail, 200) : undefined,
      tone, sourceId: r.runId, type: status,
      projectId: projectIdOfRun(r),
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

export function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupByDay(entries) {
  const groups = new Map();
  for (const e of entries) {
    const k = dayKey(e.ts);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }));
}

export function filterEntries(entries, opts = {}) {
  const q = (opts.q ?? "").trim().toLowerCase();
  const kinds = opts.kinds instanceof Set ? opts.kinds : new Set(opts.kinds ?? []);
  const srcs = opts.sources instanceof Set ? opts.sources : new Set(opts.sources ?? []);
  const from = typeof opts.from === "number" ? opts.from : null;
  const to = typeof opts.to === "number" ? opts.to : null;
  const scope = opts.projectId; // undefined = all, null = unassigned, string = specific
  return entries.filter((e) => {
    if (kinds.size > 0 && !kinds.has(e.kind)) return false;
    if (srcs.size > 0 && !srcs.has(e.source)) return false;
    if (from !== null && e.ts < from) return false;
    if (to !== null && e.ts > to) return false;
    if (scope !== undefined) {
      if (scope === null) { if (e.projectId) return false; }
      else if (e.projectId !== scope) return false;
    }
    if (!q) return true;
    return (e.title + " " + (e.detail ?? "")).toLowerCase().includes(q);
  });
}

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
  lines.push(`# Chronicle — ${key}`, "");
  lines.push(`- Commands run: ${commands.length}`);
  lines.push(`- Approvals resolved: ${approvals.length}`);
  lines.push(`- Memory changes: ${memory.length} (milestones ${milestones.length}, blockers ${blockers.length}, decisions ${decisions.length}, next actions ${nextActions.length})`);
  if (milestones.length) { lines.push("", "## Milestones"); for (const m of milestones.slice(0, 5)) lines.push(`- ${m.title}`); }
  if (decisions.length) { lines.push("", "## Decisions"); for (const m of decisions.slice(0, 5)) lines.push(`- ${m.title}`); }
  if (blockers.length) { lines.push("", "## Blockers"); for (const m of blockers.slice(0, 5)) lines.push(`- ${m.title}`); }
  if (nextActions.length) { lines.push("", "## Next actions"); for (const m of nextActions.slice(0, 5)) lines.push(`- ${m.title}`); }
  if (commands.length === 0 && memory.length === 0 && approvals.length === 0) {
    lines.push("", "_No activity recorded for this day yet._");
  }
  return {
    day: key, text: lines.join("\n"),
    counts: {
      commands: commands.length, approvals: approvals.length, memory: memory.length,
      milestones: milestones.length, blockers: blockers.length,
      decisions: decisions.length, nextActions: nextActions.length,
    },
    requiresExplicitSave: true,
  };
}

export function exportChronicleJson(entries) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: entries.length, entries }, null, 2);
}

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

export const CHRONICLE_KINDS = ["command", "memory", "approval", "connection", "summary", "workflow"];
