// Pure helpers for Chronicle v0.2 — per-project views, ISO week boundaries,
// weekly aggregation, and deterministic weekly-summary draft generation.
//
// Contract:
//   - Nothing fabricates content. If a section has no source records it is
//     rendered as "No recorded items" (or omitted).
//   - Every returned draft exposes the exact evidence (source record ids +
//     timestamps + types + projects) used to build it.
//   - Persisted summaries carry those evidence ids so they remain traceable.
//   - Time handling uses LOCAL time consistently. ISO week label (YYYY-Www)
//     is computed from the same local date. No silent day-shifts.

import { filterEntries } from "./chronicle.js";

/** Return start-of-day in local time for a given timestamp. */
function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** End-of-day in local time (23:59:59.999). */
function endOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Week boundaries in LOCAL time. Week starts Monday, ends Sunday 23:59:59.999
 * (ISO 8601). Returns {startMs, endMs, startDate, endDate}.
 */
export function weekBoundsFromDate(input, opts = {}) {
  const weekStartsOn = Number.isInteger(opts.weekStartsOn) ? opts.weekStartsOn : 1; // Monday
  const src = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  const startBase = startOfLocalDay(src.getTime());
  const dow = startBase.getDay(); // 0=Sun..6=Sat
  // days back to reach weekStartsOn
  const delta = (dow - weekStartsOn + 7) % 7;
  const start = new Date(startBase.getTime());
  start.setDate(start.getDate() - delta);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 6);
  const endMs = endOfLocalDay(end.getTime()).getTime();
  return { startMs: start.getTime(), endMs, startDate: start, endDate: new Date(endMs) };
}

/** Shift a week window by an integer delta of weeks. */
export function shiftWeek(bounds, delta) {
  const d = new Date(bounds.startMs);
  d.setDate(d.getDate() + delta * 7);
  return weekBoundsFromDate(d);
}

/**
 * ISO-8601 week number and year for a local date. Returns
 * { year, week, label:"YYYY-Www" }.
 * Year handling correctly assigns week 53/1 near year boundaries.
 */
export function isoWeek(input) {
  const src = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  // Copy date and normalize to Thursday in same week (ISO rule).
  const d = new Date(Date.UTC(src.getFullYear(), src.getMonth(), src.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = d.getTime() - firstThursday.getTime();
  const week = 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const year = d.getUTCFullYear();
  const label = `${year}-W${String(week).padStart(2, "0")}`;
  return { year, week, label };
}

/** Locale-safe short date label for a week bound (uses local time). */
export function formatWeekRange(bounds, locale) {
  const opts = { month: "short", day: "numeric" };
  try {
    const s = new Intl.DateTimeFormat(locale, opts).format(new Date(bounds.startMs));
    const e = new Intl.DateTimeFormat(locale, { ...opts, year: "numeric" }).format(new Date(bounds.endMs));
    return `${s} – ${e}`;
  } catch {
    return `${new Date(bounds.startMs).toDateString()} – ${new Date(bounds.endMs).toDateString()}`;
  }
}

/**
 * Filter chronicle entries for a given week and project scope.
 * projectScope: undefined = all, null = unassigned only, string = project id.
 */
export function entriesInWeek(entries, bounds, projectScope) {
  return filterEntries(entries, {
    from: bounds.startMs,
    to: bounds.endMs,
    projectId: projectScope,
  });
}

/**
 * Project-scoped filter for a raw memory list (used because we bucket by
 * memory type below and want the full untruncated record).
 */
function memoryInWeek(memoryList, bounds, projectScope) {
  return (memoryList ?? []).filter((m) => {
    if (!m || typeof m.updatedAt !== "number") return false;
    if (m.archived) return false;
    if (m.updatedAt < bounds.startMs || m.updatedAt > bounds.endMs) return false;
    const pid = m.projectId ?? null;
    if (projectScope === undefined) return true;
    if (projectScope === null) return pid === null;
    return pid === projectScope;
  });
}

/**
 * Aggregate a week's records into named buckets. Every bucket is an array of
 * concrete source records (never fabricated). Missing sections stay empty.
 */
export function aggregateWeek({ entries = [], memory = [], bounds, projectScope }) {
  const wkEntries = entriesInWeek(entries, bounds, projectScope);
  const wkMemory = memoryInWeek(memory, bounds, projectScope);
  const completedCommands = wkEntries.filter((e) => e.source === "command" && e.type === "done");
  const completedWorkflows = wkEntries.filter((e) => e.source === "workflow" && e.type === "completed");
  const decisions = wkMemory.filter((m) => m.type === "decision");
  const blockers = wkMemory.filter((m) => m.type === "blocker");
  const milestones = wkMemory.filter((m) => m.type === "milestone");
  const nextActions = wkMemory.filter((m) => m.type === "next_action");
  const approvalsResolved = wkEntries.filter((e) => e.source === "approval");
  const workflowActivity = wkEntries.filter((e) => e.source === "workflow");
  const failedCommands = wkEntries.filter((e) => e.source === "command" && e.type === "error");
  const openIssues = [...blockers, ...failedCommands.map((f) => ({
    id: f.sourceId, projectId: f.projectId ?? null,
    title: f.title, type: "failed_command", updatedAt: f.ts,
  }))];
  return {
    bounds, projectScope,
    counts: {
      commands: wkEntries.filter((e) => e.source === "command").length,
      completedCommands: completedCommands.length,
      approvals: approvalsResolved.length,
      memory: wkMemory.length,
      milestones: milestones.length,
      decisions: decisions.length,
      blockers: blockers.length,
      nextActions: nextActions.length,
      workflowActivity: workflowActivity.length,
      completedWorkflows: completedWorkflows.length,
      failedCommands: failedCommands.length,
    },
    completedCommands, completedWorkflows, decisions, blockers, milestones,
    nextActions, approvalsResolved, workflowActivity, failedCommands, openIssues,
  };
}

/** Truthful line printer — writes a section only when there are records. */
function section(lines, title, items, printer) {
  if (!items || items.length === 0) return;
  lines.push("");
  lines.push(`## ${title}`);
  for (const it of items.slice(0, 12)) lines.push(`- ${printer(it)}`);
  if (items.length > 12) lines.push(`- …and ${items.length - 12} more`);
}

/** Truthful section that ALWAYS renders, even when empty. */
function sectionRequired(lines, title, items, printer) {
  lines.push("");
  lines.push(`## ${title}`);
  if (!items || items.length === 0) { lines.push("- No recorded items"); return; }
  for (const it of items.slice(0, 12)) lines.push(`- ${printer(it)}`);
  if (items.length > 12) lines.push(`- …and ${items.length - 12} more`);
}

/**
 * Build a deterministic weekly summary draft.
 *
 * Returns { text, evidence, meta, agg }.
 *   - text: plain Markdown draft.
 *   - evidence: array of source record ids used (with kind, ts, projectId).
 *   - meta: { projectId, projectName, weekLabel, bounds, generatedAt, requiresExplicitSave: true }.
 */
export function buildWeeklyDraft({ project, projectScope, entries = [], memory = [], bounds, now = Date.now() }) {
  const agg = aggregateWeek({ entries, memory, bounds, projectScope });
  const iso = isoWeek(new Date(bounds.startMs + 3 * 86400000)); // Thursday-of-week
  const projectName = project?.name ?? (projectScope === null ? "Unassigned" : projectScope === undefined ? "All projects" : projectScope);

  const lines = [];
  lines.push(`# Weekly summary — ${projectName} — ${iso.label}`);
  lines.push(`_${formatWeekRange(bounds)}_`);
  lines.push("");
  lines.push(`- Commands: ${agg.counts.commands} (completed ${agg.counts.completedCommands}, failed ${agg.counts.failedCommands})`);
  lines.push(`- Workflow runs: ${agg.counts.workflowActivity} (completed ${agg.counts.completedWorkflows})`);
  lines.push(`- Approvals resolved: ${agg.counts.approvals}`);
  lines.push(`- Memory changes: ${agg.counts.memory} (milestones ${agg.counts.milestones}, decisions ${agg.counts.decisions}, blockers ${agg.counts.blockers}, next actions ${agg.counts.nextActions})`);

  sectionRequired(lines, "Completed work", [...agg.completedCommands, ...agg.completedWorkflows], (e) => e.title);
  sectionRequired(lines, "Decisions", agg.decisions, (m) => m.title);
  sectionRequired(lines, "Blockers", agg.blockers, (m) => m.title);
  section(lines, "Milestones", agg.milestones, (m) => m.title);
  sectionRequired(lines, "Approvals resolved", agg.approvalsResolved, (e) => e.title);
  section(lines, "Workflow activity", agg.workflowActivity, (e) => e.title);
  sectionRequired(lines, "Open issues", agg.openIssues, (m) => m.title);
  sectionRequired(lines, "Next steps", agg.nextActions, (m) => m.title);

  const empty = agg.counts.commands === 0 && agg.counts.memory === 0
    && agg.counts.approvals === 0 && agg.counts.workflowActivity === 0;
  if (empty) { lines.push(""); lines.push("_No activity recorded for this week yet._"); }

  // Evidence — every real source record used in aggregation, deduped.
  const evidence = [];
  const seen = new Set();
  function push(id, kind, ts, projectId, type) {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push({ id, kind, ts, projectId: projectId ?? null, type: type ?? null });
  }
  for (const e of [...agg.completedCommands, ...agg.completedWorkflows, ...agg.approvalsResolved, ...agg.workflowActivity, ...agg.failedCommands]) {
    push(e.sourceId ?? e.id, e.source ?? e.kind, e.ts, e.projectId, e.type);
  }
  for (const m of [...agg.decisions, ...agg.blockers, ...agg.milestones, ...agg.nextActions]) {
    push(m.id, "memory", m.updatedAt, m.projectId ?? null, m.type);
  }

  return {
    text: lines.join("\n"),
    evidence,
    agg,
    meta: {
      projectId: projectScope === undefined ? "__all__" : (projectScope ?? "__unassigned__"),
      projectScope,
      projectName,
      weekLabel: iso.label,
      bounds,
      generatedAt: now,
      requiresExplicitSave: true,
    },
  };
}

/** Canonical title for a saved weekly summary — used by the duplicate guard. */
export function weeklySummaryTitle(projectName, weekLabel) {
  return `Weekly summary — ${projectName} — ${weekLabel}`;
}

/**
 * Find an existing saved weekly summary for the given project + week.
 * Matches on the projectId + weekLabel tag pair we persist below.
 */
export function findExistingWeeklySummary(memoryList, projectScope, weekLabel) {
  const targetPid = projectScope ?? null;
  return (memoryList ?? []).find((m) => {
    if (!m || m.type !== "daily_log") return false;
    if ((m.projectId ?? null) !== targetPid) return false;
    const tags = Array.isArray(m.tags) ? m.tags : [];
    return tags.includes("weekly-summary") && tags.includes(weekLabel);
  }) ?? null;
}

/** Build the record we persist for a weekly summary (never persisted here). */
export function buildSaveableWeeklySummary(draft, { versionSuffix = null } = {}) {
  const title = weeklySummaryTitle(draft.meta.projectName, draft.meta.weekLabel)
    + (versionSuffix ? ` (${versionSuffix})` : "");
  return {
    projectId: draft.meta.projectScope ?? null,
    title,
    content: draft.text
      + "\n\n---\n_Evidence_: "
      + draft.evidence.map((e) => `${e.kind}:${e.id}`).join(", "),
    type: "daily_log",
    tags: ["weekly-summary", draft.meta.weekLabel, ...(versionSuffix ? ["version:" + versionSuffix] : [])],
    source: "chronicle-week",
    archived: false,
    pinned: false,
    // Extra evidence metadata for round-trip export/import.
    evidence: draft.evidence,
  };
}

/** Metadata block used in exports so consumers can reconstruct the filter. */
export function buildExportMetadata({ filter = {}, bounds = null, projectScope, projects = [] } = {}) {
  const projectName = projectScope === undefined ? "All projects"
    : projectScope === null ? "Unassigned"
    : (projects.find((p) => p.id === projectScope)?.name ?? projectScope);
  return {
    exportedAt: new Date().toISOString(),
    projectScope: projectScope === undefined ? "__all__" : (projectScope ?? "__unassigned__"),
    projectName,
    filter: {
      q: filter.q ?? "",
      kinds: Array.isArray(filter.kinds) ? filter.kinds : [...(filter.kinds ?? [])],
      sources: Array.isArray(filter.sources) ? filter.sources : [...(filter.sources ?? [])],
      from: filter.from ?? null,
      to: filter.to ?? null,
    },
    weekBounds: bounds ? { startMs: bounds.startMs, endMs: bounds.endMs } : null,
  };
}

export function exportFilteredChronicleJson(entries, meta) {
  return JSON.stringify({ ...meta, count: entries.length, entries }, null, 2);
}

export function exportFilteredChronicleMarkdown(entries, meta) {
  const lines = ["# Raven Chronicle export"];
  lines.push("");
  lines.push(`- Project: ${meta.projectName}`);
  if (meta.weekBounds) lines.push(`- Week: ${new Date(meta.weekBounds.startMs).toDateString()} – ${new Date(meta.weekBounds.endMs).toDateString()}`);
  if (meta.filter.q) lines.push(`- Search: \`${meta.filter.q}\``);
  if (meta.filter.kinds?.length) lines.push(`- Kinds: ${meta.filter.kinds.join(", ")}`);
  if (meta.filter.sources?.length) lines.push(`- Sources: ${meta.filter.sources.join(", ")}`);
  lines.push(`- Total entries: ${entries.length}`);
  lines.push("");
  for (const e of entries) {
    const time = new Date(e.ts).toISOString();
    lines.push(`- **${time}** · _${e.source ?? e.kind}${e.type ? "/" + e.type : ""}_ — ${e.title}` + (e.projectId ? ` _(project: ${e.projectId})_` : ""));
    if (e.detail) lines.push(`  - ${e.detail.replace(/\n+/g, " ")}`);
  }
  return lines.join("\n");
}

export function exportWeeklyDraftJson(draft) {
  return JSON.stringify({
    kind: "raven-weekly-summary/v1",
    meta: draft.meta, text: draft.text, evidence: draft.evidence,
    counts: draft.agg.counts,
  }, null, 2);
}

export function exportWeeklyDraftMarkdown(draft) {
  const lines = [draft.text, "", "---", "### Evidence"];
  if (draft.evidence.length === 0) lines.push("- (none)");
  else for (const e of draft.evidence) {
    lines.push(`- ${e.kind}:${e.id} · ${new Date(e.ts).toISOString()}${e.projectId ? ` · project:${e.projectId}` : ""}${e.type ? ` · ${e.type}` : ""}`);
  }
  return lines.join("\n");
}

export const CHRONICLE_SOURCES = ["command", "memory", "approval", "workflow"];