// Pure helpers for the Project DNA workspace.
//
// Deterministic, side-effect free — safe to exercise from node:test without
// React, DOM, or IndexedDB. Never fabricates progress. Never persists.

function normMem(r) {
  return {
    id: String(r.id ?? ""),
    projectId: r.projectId ?? null,
    title: String(r.title ?? "").trim(),
    content: String(r.content ?? ""),
    type: String(r.type ?? "note"),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    updatedAt: Number(r.updatedAt) || Number(r.createdAt) || 0,
    createdAt: Number(r.createdAt) || 0,
    pinned: !!r.pinned,
    archived: !!r.archived,
    source: String(r.source ?? "user"),
  };
}

function scopeMemory(memory, projectId) {
  return (memory ?? []).map(normMem).filter((r) => !r.archived && r.projectId === projectId);
}

function newestOfType(scope, type) {
  return scope.filter((r) => r.type === type).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

export function buildProjectOverview({ project, memory, commands, approvals, files, now }) {
  if (!project) return null;
  const scope = scopeMemory(memory, project.id);
  const nowTs = Number(now) || Date.now();
  const oneWeek = 7 * 24 * 3600 * 1000;
  const projCommands = (commands ?? []).filter((c) => c && c.projectId === project.id);
  const recentCommandCount = projCommands.filter((c) => (Number(c.createdAt) || 0) >= nowTs - oneWeek).length;
  const linkedFileCount = (files ?? []).filter((f) => f && f.projectId === project.id).length;
  const projCmdIds = new Set(projCommands.map((c) => c.id));
  const pendingApprovalCount = (approvals ?? [])
    .filter((a) => a && a.status === "pending" && a.commandId && projCmdIds.has(a.commandId))
    .length;
  const lastActivityTs = Math.max(
    Number(project.updatedAt) || 0,
    ...scope.map((r) => r.updatedAt),
    ...projCommands.map((c) => Number(c.createdAt) || 0),
    0,
  );
  return {
    id: project.id,
    name: String(project.name ?? "Untitled project"),
    icon: String(project.icon ?? "✦"),
    description: String(project.description ?? ""),
    goals: String(project.goals ?? "").trim(),
    status: project.status ?? "active",
    priority: project.priority ?? "normal",
    tags: Array.isArray(project.tags) ? project.tags : [],
    createdAt: Number(project.createdAt) || 0,
    updatedAt: Number(project.updatedAt) || 0,
    lastActivityTs,
    lastMilestone: newestOfType(scope, "milestone"),
    currentBlocker: newestOfType(scope, "blocker"),
    nextAction: newestOfType(scope, "next_action"),
    memoryCount: scope.length,
    linkedFileCount,
    recentCommandCount,
    pendingApprovalCount,
  };
}

export function computeProjectHealth({ project, memory, commands, files, bridgeSnapshot, engine, now }) {
  if (!project) return { score: 0, checks: [] };
  const scope = scopeMemory(memory, project.id);
  const nowTs = Number(now) || Date.now();
  const oneWeek = 7 * 24 * 3600 * 1000;
  const hasGoal = !!(project.goals && String(project.goals).trim());
  const nextAction = newestOfType(scope, "next_action");
  const blocker = newestOfType(scope, "blocker");
  const projCommands = (commands ?? []).filter((c) => c && c.projectId === project.id);
  const recentActivity = projCommands.some((c) => (Number(c.createdAt) || 0) >= nowTs - oneWeek)
    || scope.some((r) => r.updatedAt >= nowTs - oneWeek);
  const linkedFiles = (files ?? []).some((f) => f && f.projectId === project.id);
  const bridgeOnline = bridgeSnapshot?.ui === "paired_online";
  const engineReachable = engine === "cloud" || engine === "demo" ? true : bridgeOnline;

  const checks = [
    { id: "goal", label: "Active goal defined", ok: hasGoal, weight: 20,
      detail: hasGoal ? "Goal text present" : "No goal set" },
    { id: "next_action", label: "Next action captured", ok: !!nextAction, weight: 20,
      detail: nextAction ? nextAction.title : "No next_action memory" },
    { id: "blocker", label: "No open blocker", ok: !blocker, weight: 15,
      detail: blocker ? "Blocker: " + blocker.title : "Clear" },
    { id: "activity", label: "Recent activity (7 days)", ok: recentActivity, weight: 15,
      detail: recentActivity ? "Activity within the last week" : "No recent activity" },
    { id: "memory", label: "Project memory available", ok: scope.length > 0, weight: 10,
      detail: scope.length + " records" },
    { id: "files", label: "Files linked", ok: linkedFiles, weight: 10,
      detail: linkedFiles ? "At least one file linked" : "No files linked" },
    { id: "engine", label: "AI engine reachable", ok: engineReachable, weight: 10,
      detail: engineReachable ? String(engine) : "Engine unreachable" },
  ];
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = Math.round((got / totalWeight) * 100);
  return { score, checks };
}

export function buildProjectTimeline({ project, memory, commands, approvals, limit }) {
  if (!project) return [];
  const scope = scopeMemory(memory, project.id);
  const rows = [];
  for (const m of scope) {
    rows.push({
      ts: m.updatedAt,
      kind: "memory",
      type: m.type,
      id: m.id,
      title: m.title,
      detail: m.content ? m.content.slice(0, 240) : "",
      source: "memory:" + m.type,
    });
  }
  const projCmdIds = new Set();
  for (const c of (commands ?? [])) {
    if (!c || c.projectId !== project.id) continue;
    projCmdIds.add(c.id);
    rows.push({
      ts: Number(c.createdAt) || 0,
      kind: "command",
      id: c.id,
      status: c.status,
      title: String(c.prompt ?? "").slice(0, 200) || "(empty prompt)",
      detail: c.resultSummary ? String(c.resultSummary).slice(0, 240) : "",
      source: "history",
    });
  }
  for (const a of (approvals ?? [])) {
    if (!a || !a.commandId || !projCmdIds.has(a.commandId)) continue;
    rows.push({
      ts: Number(a.createdAt) || 0,
      kind: "approval",
      id: a.id,
      status: a.status,
      title: String(a.title ?? "Approval"),
      detail: String(a.reason ?? ""),
      source: "approval:" + (a.status ?? "pending"),
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  const cap = Number.isFinite(limit) ? limit : rows.length;
  return rows.slice(0, cap);
}

export function deriveRoadmap({ memory, projectId }) {
  const scope = scopeMemory(memory, projectId ?? null).sort((a, b) => b.updatedAt - a.updatedAt);
  const blockers = scope.filter((r) => r.type === "blocker");
  const nexts = scope.filter((r) => r.type === "next_action");
  const decisions = scope.filter((r) => r.type === "decision");
  const milestones = scope.filter((r) => r.type === "milestone");
  const facts = scope.filter((r) => r.type === "fact" || r.type === "note");

  const nowBucket = [];
  for (const b of blockers) nowBucket.push({ id: b.id, source: "memory:blocker", title: "Blocker: " + b.title });
  if (nexts[0]) nowBucket.push({ id: nexts[0].id, source: "memory:next_action", title: nexts[0].title });

  const nextBucket = nexts.slice(1, 5).map((r) => ({ id: r.id, source: "memory:next_action", title: r.title }));
  for (const d of decisions.slice(0, 3)) {
    nextBucket.push({ id: d.id, source: "memory:decision", title: "Decision: " + d.title });
  }

  const laterBucket = [];
  for (const f of facts.slice(0, 5)) laterBucket.push({ id: f.id, source: "memory:" + f.type, title: f.title });
  for (const m of milestones.slice(0, 3)) laterBucket.push({ id: m.id, source: "memory:milestone", title: "Follow-up: " + m.title });

  const guidance = {
    now: nowBucket.length ? null : "Add a next_action or blocker memory to populate Now.",
    next: nextBucket.length ? null : "Add decisions or additional next_action memories to populate Next.",
    later: laterBucket.length ? null : "Add facts or milestones to populate Later.",
  };
  return { now: nowBucket, next: nextBucket, later: laterBucket, guidance };
}

export function deterministicProjectProfile({ project, memory, files, commands }) {
  if (!project) return null;
  const scope = scopeMemory(memory, project.id);
  const tagCounts = new Map();
  for (const t of project.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 2);
  for (const m of scope) for (const t of m.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([k]) => k);
  const stances = {
    decisions: scope.filter((r) => r.type === "decision").length,
    milestones: scope.filter((r) => r.type === "milestone").length,
    blockers: scope.filter((r) => r.type === "blocker").length,
    nextActions: scope.filter((r) => r.type === "next_action").length,
    notes: scope.filter((r) => r.type === "note" || r.type === "fact").length,
  };
  const lines = [];
  lines.push(project.icon + " " + project.name);
  if (project.description) lines.push(project.description);
  if (project.goals) lines.push("Goals: " + project.goals);
  lines.push(
    "Signals: " + stances.decisions + " decisions, " + stances.milestones + " milestones, " +
    stances.blockers + " blockers, " + stances.nextActions + " next actions.",
  );
  if (topTags.length) lines.push("Themes: " + topTags.join(", ") + ".");
  const linkedFiles = (files ?? []).filter((f) => f && f.projectId === project.id).length;
  const projCommands = (commands ?? []).filter((c) => c && c.projectId === project.id).length;
  lines.push("Linked files: " + linkedFiles + ". Commands recorded: " + projCommands + ".");
  return {
    projectId: project.id,
    topTags,
    stances,
    linkedFiles,
    commandCount: projCommands,
    summary: lines.join("\n"),
    aiEnhanced: false,
  };
}

export function buildProjectBriefContext({ project, memory, files, commands, limit }) {
  if (!project) return null;
  const scope = scopeMemory(memory, project.id).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  const memLimit = Number.isFinite(limit) ? limit : 12;
  const picked = scope.slice(0, memLimit);
  const fileMetas = (files ?? [])
    .filter((f) => f && f.projectId === project.id)
    .map((f) => ({ name: f.name, mime: f.mime, size: f.size }));
  const recentCommands = (commands ?? [])
    .filter((c) => c && c.projectId === project.id)
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, 5)
    .map((c) => ({ prompt: String(c.prompt ?? "").slice(0, 200), status: c.status }));
  return {
    projectName: project.name,
    projectGoals: String(project.goals ?? "").trim(),
    description: String(project.description ?? "").trim(),
    memoryRecords: picked.map((m) => ({
      type: m.type, title: m.title, content: m.content.slice(0, 400),
      tags: m.tags, pinned: m.pinned,
    })),
    files: fileMetas,
    recentCommands,
    requiresExplicitConfirmToSave: true,
  };
}

export function buildContinueProjectPreview({ project, memory, commands, files, limit }) {
  if (!project) return null;
  const scope = scopeMemory(memory, project.id);
  const blocker = newestOfType(scope, "blocker");
  const nextAction = newestOfType(scope, "next_action");
  const lastMilestone = newestOfType(scope, "milestone");
  const memLimit = Number.isFinite(limit) ? limit : 6;
  const picked = scope.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  }).slice(0, memLimit);
  return {
    projectId: project.id,
    projectName: project.name,
    icon: project.icon,
    blocker: blocker ? blocker.title : null,
    nextAction: nextAction ? nextAction.title : null,
    lastMilestone: lastMilestone ? lastMilestone.title : null,
    memoryPreview: picked.map((r) => ({ type: r.type, title: r.title, pinned: r.pinned })),
    files: (files ?? []).filter((f) => f && f.projectId === project.id).length,
    commands: (commands ?? []).filter((c) => c && c.projectId === project.id).length,
    sentAutomatically: false,
  };
}

export const PROJECT_DNA_TABS = ["overview", "memory", "files", "timeline", "decisions", "roadmap"];

export const NO_SILENT_SAVE = Object.freeze({
  briefRequiresExplicitSave: true,
  aiEnhancementRequiresExplicitClick: true,
  continueProjectDoesNotSendAutomatically: true,
});
