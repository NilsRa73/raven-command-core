// Pure helpers for the "Raven Morning" Welcome Back experience.
// No React, no DOM, no IndexedDB — safe for node:test.
// Never fabricates activity: every field maps to an actual record.

export const MORNING_LAST_SEEN_KEY = "rah:morning:lastSeenDay:v1";

/** Convert a timestamp to a YYYY-MM-DD string in the local timezone. */
export function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Compute the greeting phase for the hour of day. Deterministic. */
export function greetingPhase(ts) {
  const h = new Date(ts).getHours();
  if (h < 5)  return { phase: "night",     salutation: "Still up" };
  if (h < 12) return { phase: "morning",   salutation: "Good morning" };
  if (h < 17) return { phase: "afternoon", salutation: "Good afternoon" };
  if (h < 22) return { phase: "evening",   salutation: "Good evening" };
  return       { phase: "night",           salutation: "Good evening" };
}

/**
 * Build the Welcome Back summary the Home page shows when the user
 * arrives (or the day rolls over). Purely a read of persisted state.
 *
 * @param {{
 *   now?: number,
 *   lastSeenDay?: string | null,
 *   userName?: string,
 *   activeProject: any | null,
 *   projects: any[],
 *   projectMemory: any[],
 *   commands: any[],
 *   approvals: any[],
 * }} inputs
 */
export function buildWelcomeBack(inputs) {
  const now = Number.isFinite(inputs.now) ? inputs.now : Date.now();
  const today = dayKey(now);
  const isFirstVisitToday = !inputs.lastSeenDay || inputs.lastSeenDay !== today;
  const { salutation, phase } = greetingPhase(now);
  const userName = (inputs.userName || "").trim();

  const projMemory = (inputs.projectMemory ?? []).filter((m) => m && !m.archived);
  const scope = inputs.activeProject
    ? projMemory.filter((m) => m.projectId === inputs.activeProject.id || m.projectId === null)
    : projMemory;

  const newest = (t) =>
    scope.filter((m) => m.type === t).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;

  const currentTask =
    inputs.activeProject?.currentTask ||
    newest("next_action")?.title ||
    null;
  const nextTask =
    inputs.activeProject?.nextTask ||
    scope.filter((m) => m.type === "next_action").sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[1]?.title ||
    null;
  const blocker =
    inputs.activeProject?.blocker ||
    newest("blocker")?.title ||
    null;
  const lastMilestone = newest("milestone")?.title ?? null;

  const pendingApprovals = (inputs.approvals ?? []).filter((a) => a && a.status === "pending").length;

  const recentProjects = (inputs.projects ?? [])
    .filter((p) => p && p.status !== "archived")
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 3)
    .map((p) => ({ id: p.id, name: p.name, icon: p.icon, updatedAt: p.updatedAt ?? 0 }));

  const commandsSinceLast = countCommandsSince(inputs.commands ?? [], inputs.lastSeenDay ?? null, now);

  return {
    today,
    isFirstVisitToday,
    salutation,
    phase,
    userName,
    activeProjectId: inputs.activeProject?.id ?? null,
    activeProjectName: inputs.activeProject?.name ?? null,
    activeProjectIcon: inputs.activeProject?.icon ?? null,
    currentTask,
    nextTask,
    blocker,
    lastMilestone,
    estimatedCompletionAt: inputs.activeProject?.estimatedCompletionAt ?? null,
    pendingApprovals,
    recentProjects,
    commandsSinceLast,
  };
}

function countCommandsSince(commands, lastSeenDay, now) {
  if (!lastSeenDay) return 0;
  // Count commands whose day is strictly after lastSeenDay AND on-or-before today.
  const cutoffStart = new Date(now);
  cutoffStart.setHours(0, 0, 0, 0);
  const startTs = cutoffStart.getTime();
  return commands.filter((c) => Number(c.createdAt) >= startTs).length;
}

/** Persist "we greeted the user today" so Welcome Back does not spam. */
export function markMorningSeen(ts) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(MORNING_LAST_SEEN_KEY, dayKey(ts ?? Date.now())); } catch { /* quota */ }
}
export function loadMorningLastSeen() {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(MORNING_LAST_SEEN_KEY); } catch { return null; }
}

/**
 * Estimated-completion label: "in 3 days" / "today" / "overdue by 2 days" / null.
 * Deterministic, no locale surprises.
 */
export function formatEta(estimatedAt, now) {
  if (!Number.isFinite(estimatedAt)) return null;
  const nowTs = Number.isFinite(now) ? now : Date.now();
  const days = Math.round((estimatedAt - nowTs) / (24 * 3600 * 1000));
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 1)   return `due in ${days} days`;
  if (days === -1) return "overdue by 1 day";
  return `overdue by ${Math.abs(days)} days`;
}
