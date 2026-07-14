// Deterministic weekly Chronicle helpers. No fabrication. Requires explicit
// user save. AI polish (if used) rewrites tone only.

import { filterEntries } from "./chronicle.js";

export const CHRONICLE_SOURCES = ["command", "memory", "approval", "workflow"];

/* ─────────────── Week bounds ─────────────── */

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
/** Monday of the ISO week containing `d`. */
function mondayOf(d) {
  const s = startOfLocalDay(d);
  // JS: Sun=0 Mon=1 ... Sat=6. ISO: Mon=1..Sun=7. Compute offset back to Mon.
  const dow = s.getDay(); // 0..6
  const back = dow === 0 ? 6 : dow - 1;
  s.setDate(s.getDate() - back);
  return s;
}

export function weekBoundsFromDate(d) {
  const dateObj = d instanceof Date ? d : new Date(d);
  const start = mondayOf(dateObj);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const endD = endOfLocalDay(end);
  return {
    startDate: start, endDate: endD,
    startMs: start.getTime(), endMs: endD.getTime(),
  };
}

export function shiftWeek(bounds, delta) {
  const s = new Date(bounds.startDate);
  s.setDate(s.getDate() + 7 * delta);
  return weekBoundsFromDate(s);
}

/* ─────────────── ISO week label ─────────────── */

export function isoWeek(date) {
  // Standard ISO 8601 algorithm.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  const label = `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  return { year: d.getUTCFullYear(), week, label };
}

export function formatWeekRange(b) {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(b.startDate)} → ${fmt(b.endDate)}`;
}

/* ─────────────── Aggregation ─────────────── */

export function entriesInWeek({ entries, bounds, projectScope }) {
  return filterEntries(entries, {
    from: bounds.startMs, to: bounds.endMs, projectId: projectScope,
  });
}

export function aggregateWeek({ entries, memory, bounds, projectScope }) {
  const inWeek = entriesInWeek({ entries, bounds, projectScope });
  const memInWeek = (memory ?? []).filter((m) => {
    if (!m || typeof m.updatedAt !== "number") return false;
    if (m.archived) return false;
    if (m.updatedAt < bounds.startMs || m.updatedAt > bounds.endMs) return false;
    if (projectScope !== undefined) {
      const pid = typeof m.projectId === "string" ? m.projectId : null;
      if (projectScope === null) { if (pid) return false; }
      else if (pid !== projectScope) return false;
    }
    return true;
  });

  const completedCommands = inWeek.filter((e) => e.kind === "command" && e.type === "done");
  const failedCommands = inWeek.filter((e) => e.kind === "command" && (e.type === "error" || e.type === "rejected"));
  const workflowsCompleted = inWeek.filter((e) => e.kind === "workflow" && e.type === "completed");
  const workflowsFailed = inWeek.filter((e) => e.kind === "workflow" && e.type !== "completed");
  const approvals = inWeek.filter((e) => e.kind === "approval");
  const decisions = memInWeek.filter((m) => m.type === "decision");
  const blockers = memInWeek.filter((m) => m.type === "blocker");
  const milestones = memInWeek.filter((m) => m.type === "milestone");
  const nextSteps = memInWeek.filter((m) => m.type === "next_action");

  return {
    completedCommands, failedCommands,
    workflowsCompleted, workflowsFailed,
    approvals, decisions, blockers, milestones, nextSteps,
    memInWeek, allInWeek: inWeek,
  };
}

/* ─────────────── Draft generation ─────────────── */

function projectName(project, scope) {
  if (project && project.name) return project.name;
  if (scope === null) return "Unassigned";
  if (scope === undefined) return "All projects";
  return "(project)";
}

function section(lines, heading, items, format) {
  lines.push("", `### ${heading}`);
  if (!items.length) { lines.push("_No recorded items._"); return; }
  for (const it of items) lines.push(`- ${format(it)}`);
}

export function buildWeeklyDraft({ project, projectScope, entries, memory, bounds, now }) {
  const iso = isoWeek(new Date(bounds.startMs + 3 * 86_400_000));
  const agg = aggregateWeek({ entries, memory, bounds, projectScope });
  const pName = projectName(project, projectScope);
  const genAt = typeof now === "number" ? now : Date.now();

  const lines = [];
  lines.push(`# Weekly summary — ${pName} — ${iso.label}`, "");
  lines.push(`_Week ${formatWeekRange(bounds)}_`);
  lines.push(`_Generated ${new Date(genAt).toISOString()} from real records only. No fabrication._`);

  section(lines, "Completed work", [
    ...agg.completedCommands.map((e) => ({ label: e.title, src: e })),
    ...agg.workflowsCompleted.map((e) => ({ label: e.title, src: e })),
  ], (x) => x.label);
  section(lines, "Decisions", agg.decisions, (m) => m.title);
  section(lines, "Blockers", agg.blockers, (m) => m.title);
  section(lines, "Next steps", agg.nextSteps, (m) => m.title);
  section(lines, "Approvals resolved", agg.approvals, (e) => e.title);
  if (agg.failedCommands.length || agg.workflowsFailed.length) {
    section(lines, "Issues", [...agg.failedCommands, ...agg.workflowsFailed], (e) => e.title);
  }

  const totalItems = agg.completedCommands.length + agg.workflowsCompleted.length
    + agg.decisions.length + agg.blockers.length + agg.nextSteps.length
    + agg.approvals.length + agg.milestones.length;
  if (totalItems === 0) {
    lines.push("", "_No activity recorded for this scope in this week._");
  }

  // Evidence: exact ids and timestamps used to build the sections above.
  const ev = [];
  const push = (kind, id, ts, extra) => ev.push({ kind, id, ts, ...(extra || {}) });
  for (const e of agg.completedCommands) push("command", e.sourceId, e.ts, { type: e.type, projectId: e.projectId ?? null });
  for (const e of agg.failedCommands) push("command", e.sourceId, e.ts, { type: e.type, projectId: e.projectId ?? null });
  for (const e of agg.workflowsCompleted) push("workflow", e.sourceId, e.ts, { type: e.type, projectId: e.projectId ?? null });
  for (const e of agg.workflowsFailed) push("workflow", e.sourceId, e.ts, { type: e.type, projectId: e.projectId ?? null });
  for (const e of agg.approvals) push("approval", e.sourceId, e.ts, { type: e.type, projectId: e.projectId ?? null });
  for (const m of agg.decisions) push("memory", m.id, m.updatedAt, { type: m.type, projectId: m.projectId ?? null });
  for (const m of agg.blockers) push("memory", m.id, m.updatedAt, { type: m.type, projectId: m.projectId ?? null });
  for (const m of agg.milestones) push("memory", m.id, m.updatedAt, { type: m.type, projectId: m.projectId ?? null });
  for (const m of agg.nextSteps) push("memory", m.id, m.updatedAt, { type: m.type, projectId: m.projectId ?? null });

  const meta = {
    projectScope, projectName: pName, weekLabel: iso.label,
    bounds: { startIso: new Date(bounds.startMs).toISOString(), endIso: new Date(bounds.endMs).toISOString() },
    generatedAt: genAt,
    requiresExplicitSave: true,
    counts: {
      completed: agg.completedCommands.length + agg.workflowsCompleted.length,
      decisions: agg.decisions.length,
      blockers: agg.blockers.length,
      nextSteps: agg.nextSteps.length,
      approvals: agg.approvals.length,
      workflows: agg.workflowsCompleted.length + agg.workflowsFailed.length,
      commands: agg.completedCommands.length + agg.failedCommands.length,
      memory: agg.decisions.length + agg.blockers.length + agg.milestones.length + agg.nextSteps.length,
    },
  };

  return { text: lines.join("\n"), meta, evidence: ev };
}

/* ─────────────── Save & duplicate guard ─────────────── */

export function weeklySummaryTitle(projectName, weekLabel) {
  return `Weekly summary — ${projectName} — ${weekLabel}`;
}

export function findExistingWeeklySummary(memory, projectScope, weekLabel) {
  for (const m of memory ?? []) {
    if (!m || m.type !== "weekly_log" || m.archived) continue;
    const pid = typeof m.projectId === "string" ? m.projectId : null;
    const scope = projectScope ?? null;
    if (pid !== scope) continue;
    const tags = Array.isArray(m.tags) ? m.tags : [];
    if (tags.includes(weekLabel) && tags.includes("weekly-summary")) return m;
  }
  return null;
}

export function buildSaveableWeeklySummary(draft, opts = {}) {
  const suffix = opts.versionSuffix ? ` (${opts.versionSuffix})` : "";
  const title = weeklySummaryTitle(draft.meta.projectName, draft.meta.weekLabel) + suffix;
  const evidenceIds = draft.evidence.map((e) => `${e.kind}:${e.id}`);
  const content = [
    draft.text, "",
    "---",
    "Evidence (source records used):",
    ...evidenceIds.map((s) => `- ${s}`),
  ].join("\n");
  return {
    projectId: typeof draft.meta.projectScope === "string" ? draft.meta.projectScope : null,
    title, content,
    type: "weekly_log",
    tags: ["chronicle", "weekly-summary", draft.meta.weekLabel],
    source: "chronicle-week",
    archived: false, pinned: false,
    evidence: draft.evidence,
  };
}

/* ─────────────── Export helpers ─────────────── */

function asArray(v) {
  if (v instanceof Set) return [...v];
  return Array.isArray(v) ? v : [];
}

export function buildExportMetadata({ filter, bounds, projectScope, projects }) {
  const proj = typeof projectScope === "string"
    ? (projects ?? []).find((p) => p.id === projectScope) : null;
  const projectLabel = proj ? proj.name
    : projectScope === null ? "Unassigned"
    : projectScope === undefined ? "All projects"
    : "(unknown)";
  return {
    exportedAt: new Date().toISOString(),
    scope: projectLabel,
    projectName: projectLabel,
    projectScope: projectScope ?? null,
    filter: {
      q: filter?.q ?? "",
      kinds: asArray(filter?.kinds),
      sources: asArray(filter?.sources),
      from: filter?.from ? new Date(filter.from).toISOString() : null,
      to: filter?.to ? new Date(filter.to).toISOString() : null,
    },
    bounds: bounds ? {
      startIso: new Date(bounds.startMs).toISOString(),
      endIso: new Date(bounds.endMs).toISOString(),
      label: isoWeek(new Date(bounds.startMs + 3 * 86_400_000)).label,
    } : null,
    weekBounds: bounds ? { startMs: bounds.startMs, endMs: bounds.endMs } : null,
  };
}

export function exportFilteredChronicleJson(entries, meta) {
  return JSON.stringify({ ...meta, count: entries.length, entries }, null, 2);
}

export function exportFilteredChronicleMarkdown(entries, meta) {
  const lines = ["# Raven Chronicle export", ""];
  lines.push(`- Project: ${meta.projectName ?? meta.scope}`);
  if (meta.bounds) lines.push(`- Week: ${meta.bounds.label} (${meta.bounds.startIso} → ${meta.bounds.endIso})`);
  if (meta.filter?.q) lines.push(`- Search: \`${meta.filter.q}\``);
  if (meta.filter?.kinds?.length) lines.push(`- Kinds: ${meta.filter.kinds.join(", ")}`);
  if (meta.filter?.sources?.length) lines.push(`- Sources: ${meta.filter.sources.join(", ")}`);
  lines.push(`- Exported: ${meta.exportedAt}`, "");
  for (const e of entries) {
    const t = new Date(e.ts).toISOString();
    lines.push(`- **${t}** · _${e.kind}${e.type ? "/" + e.type : ""}_ — ${e.title}`);
    if (e.detail) lines.push(`  - ${e.detail.replace(/\n+/g, " ")}`);
  }
  return lines.join("\n");
}

export function exportWeeklyDraftJson(draft) {
  return JSON.stringify({
    kind: "raven-weekly-summary/v1",
    meta: draft.meta,
    text: draft.text,
    evidence: draft.evidence,
  }, null, 2);
}

export function exportWeeklyDraftMarkdown(draft) {
  const lines = [draft.text, "", "### Evidence", ""];
  for (const e of draft.evidence) {
    lines.push(`- ${e.kind}:${e.id} · ${new Date(e.ts).toISOString()}${e.type ? " · " + e.type : ""}${e.projectId ? " · project:" + e.projectId : ""}`);
  }
  return lines.join("\n");
}
