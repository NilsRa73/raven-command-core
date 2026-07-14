// Deterministic pure helpers for the Raven Home v0.2 mission timer
// and Focus Block workflow. No React, no DOM, no IndexedDB — only
// data-in / data-out so Node tests can pin every transition.
//
// A FocusSession record shape (persisted verbatim to IndexedDB):
// {
//   id, projectId|null, title, mode: "fast"|"deep",
//   plannedDurationMs: number|null,   // null => count-up
//   startedAt: number|null, pausedAt: number|null,
//   completedAt: number|null, cancelledAt: number|null,
//   accumulatedPausedMs: number,
//   interruptions: [{ ts, note }],
//   status: "draft"|"running"|"paused"|"completed"|"cancelled"|"invalid",
//   linkedWorkflowId: string|null, linkedRunId: string|null,
//   notes: string, source: string,
//   agents: string[], breakReminderMinutes: number|null,
//   createdAt, updatedAt,
// }

/** Deterministic id fallback so tests do not depend on crypto. */
function fallbackId() {
  return "fs_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Build the initial focus-block draft. Nothing is persisted. */
export function newFocusDraft(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  return {
    id: input.id || fallbackId(),
    projectId: input.projectId ?? null,
    title: String(input.title ?? "").trim(),
    mode: input.mode === "deep" ? "deep" : "fast",
    plannedDurationMs: Number.isFinite(input.plannedDurationMs)
      ? Math.max(0, Math.floor(input.plannedDurationMs)) : null,
    agents: Array.isArray(input.agents) ? input.agents.slice() : [],
    breakReminderMinutes: Number.isFinite(input.breakReminderMinutes)
      ? Math.max(0, Math.floor(input.breakReminderMinutes)) : null,
    linkedWorkflowId: input.linkedWorkflowId ?? null,
    linkedRunId: null,
    notes: String(input.notes ?? ""),
    source: String(input.source ?? "raven-home"),
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    cancelledAt: null,
    accumulatedPausedMs: 0,
    interruptions: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

/** Reference template for dirty detection. */
function templateFor(projectId) {
  return {
    projectId: projectId ?? null,
    title: "",
    mode: "fast",
    plannedDurationMs: null,
    agents: [],
    breakReminderMinutes: null,
    linkedWorkflowId: null,
    notes: "",
  };
}

/**
 * A draft is "dirty" when any user-visible input differs from the empty
 * template for the current project. Used by the unsaved-draft guard so
 * we never lose configuration on navigation.
 */
export function isFocusDraftDirty(draft, projectId) {
  if (!draft) return false;
  const t = templateFor(projectId ?? draft.projectId ?? null);
  if (String(draft.title ?? "").trim() !== t.title) return true;
  if (draft.mode !== t.mode) return true;
  if ((draft.plannedDurationMs ?? null) !== t.plannedDurationMs) return true;
  if ((draft.breakReminderMinutes ?? null) !== t.breakReminderMinutes) return true;
  if ((draft.linkedWorkflowId ?? null) !== t.linkedWorkflowId) return true;
  if (String(draft.notes ?? "") !== t.notes) return true;
  if ((draft.agents ?? []).length !== 0) return true;
  if ((draft.projectId ?? null) !== t.projectId) return true;
  return false;
}

/** True when a record is in an active timing state. */
export function isActive(rec) {
  return !!rec && (rec.status === "running" || rec.status === "paused");
}

/**
 * Start a draft. Requires an explicit `now`. Refuses non-draft input so
 * the timer can never begin automatically or restart itself.
 */
export function start(draft, now) {
  if (!draft || draft.status !== "draft") throw new Error("start: draft required");
  if (!Number.isFinite(now)) throw new Error("start: now required");
  if (!String(draft.title ?? "").trim()) throw new Error("start: title required");
  return { ...draft, status: "running", startedAt: now, pausedAt: null, updatedAt: now };
}

export function pause(rec, now) {
  if (!rec || rec.status !== "running") throw new Error("pause: running required");
  if (!Number.isFinite(now) || now < rec.startedAt) {
    return { ...rec, status: "invalid", updatedAt: now };
  }
  return { ...rec, status: "paused", pausedAt: now, updatedAt: now };
}

export function resume(rec, now) {
  if (!rec || rec.status !== "paused") throw new Error("resume: paused required");
  if (!Number.isFinite(now) || now < (rec.pausedAt ?? 0)) {
    return { ...rec, status: "invalid", updatedAt: now };
  }
  const added = Math.max(0, now - (rec.pausedAt ?? now));
  return {
    ...rec, status: "running", pausedAt: null,
    accumulatedPausedMs: (rec.accumulatedPausedMs ?? 0) + added,
    updatedAt: now,
  };
}

function finalize(rec, now, statusField) {
  if (!rec || (rec.status !== "running" && rec.status !== "paused")) {
    throw new Error("finalize: active required");
  }
  let acc = rec.accumulatedPausedMs ?? 0;
  if (rec.status === "paused" && Number.isFinite(now) && now >= (rec.pausedAt ?? 0)) {
    acc += Math.max(0, now - (rec.pausedAt ?? now));
  }
  const status = statusField === "completedAt" ? "completed" : "cancelled";
  return {
    ...rec, status, pausedAt: null, accumulatedPausedMs: acc,
    [statusField]: now, updatedAt: now,
  };
}

export function complete(rec, now) { return finalize(rec, now, "completedAt"); }
export function cancel(rec, now)   { return finalize(rec, now, "cancelledAt"); }

/** Reset an active record back into a fresh draft with the same configuration. */
export function reset(rec, now) {
  if (!rec) throw new Error("reset: record required");
  return newFocusDraft({
    projectId: rec.projectId, title: rec.title, mode: rec.mode,
    plannedDurationMs: rec.plannedDurationMs, agents: rec.agents,
    breakReminderMinutes: rec.breakReminderMinutes,
    linkedWorkflowId: rec.linkedWorkflowId, notes: rec.notes,
    source: rec.source, now,
  });
}

/** Log an interruption; deterministic and additive. */
export function logInterruption(rec, note, now) {
  if (!rec) throw new Error("logInterruption: record required");
  if (!Number.isFinite(now)) throw new Error("logInterruption: now required");
  const entry = { ts: now, note: String(note ?? "").trim().slice(0, 200) };
  return {
    ...rec,
    interruptions: [...(rec.interruptions ?? []), entry],
    updatedAt: now,
  };
}

/**
 * Compute honest elapsed / remaining values.
 *
 * `elapsedMs` = wall-clock since `startedAt`, minus paused accumulation.
 * `remainingMs` = null when count-up, else `plannedDurationMs - elapsedMs`.
 * Returns `status: "invalid"` when the input is inconsistent (backward
 * clock, missing timestamps, etc.) so the UI can pause safely.
 */
export function computeTiming(rec, now) {
  if (!rec) return { status: "unknown", elapsedMs: 0, remainingMs: null, overdue: false };
  if (rec.status === "draft") {
    return { status: "draft", elapsedMs: 0, remainingMs: rec.plannedDurationMs ?? null, overdue: false };
  }
  if (!Number.isFinite(rec.startedAt)) {
    return { status: "invalid", elapsedMs: 0, remainingMs: null, overdue: false, warning: "startedAt missing" };
  }
  const anchor = rec.status === "completed" ? rec.completedAt
    : rec.status === "cancelled" ? rec.cancelledAt
    : rec.status === "paused" ? rec.pausedAt
    : now;
  if (!Number.isFinite(anchor) || anchor < rec.startedAt) {
    return { status: "invalid", elapsedMs: 0, remainingMs: null, overdue: false, warning: "clock moved backward" };
  }
  let paused = rec.accumulatedPausedMs ?? 0;
  // For paused-running: current pause window is not yet folded in, but
  // wall-clock stops advancing at pausedAt, so we simply anchor there.
  const elapsedMs = Math.max(0, anchor - rec.startedAt - paused);
  const remainingMs = rec.plannedDurationMs != null
    ? rec.plannedDurationMs - elapsedMs
    : null;
  const overdue = remainingMs != null && remainingMs < 0;
  return { status: rec.status, elapsedMs, remainingMs, overdue };
}

/**
 * Restore a record after reload. Detects invalid timestamps and clocks
 * that moved backward; never simulates ticks. Callers should still call
 * `computeTiming` with `now` for display.
 */
export function restoreAfterReload(rec, now) {
  if (!rec) return null;
  if (rec.status !== "running" && rec.status !== "paused") return rec;
  const t = computeTiming(rec, now);
  if (t.status === "invalid") {
    return { ...rec, status: rec.status === "running" ? "paused" : rec.status,
             pausedAt: rec.pausedAt ?? now, updatedAt: now };
  }
  return rec;
}

/** Format milliseconds as HH:MM:SS or MM:SS. Deterministic, no locale. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—";
  const sign = ms < 0 ? "-" : "";
  const total = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return sign + (h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`);
}

/** Build a Chronicle/Memory completion draft. Never persisted here. */
export function buildCompletionDraft(rec, now) {
  const t = computeTiming(rec, now);
  return {
    focusId: rec.id,
    projectId: rec.projectId ?? null,
    title: rec.title || "(untitled focus block)",
    mode: rec.mode,
    elapsedMs: t.elapsedMs,
    plannedDurationMs: rec.plannedDurationMs ?? null,
    interruptionCount: (rec.interruptions ?? []).length,
    interruptions: (rec.interruptions ?? []).slice(),
    linkedWorkflowId: rec.linkedWorkflowId ?? null,
    linkedRunId: rec.linkedRunId ?? null,
    status: rec.status,
    notes: rec.notes ?? "",
    generatedAt: now,
    source: rec.source ?? "raven-home",
  };
}

/** Filter + shape focus history for export/UI. */
export function filterHistory(records, filter = {}) {
  const rows = Array.isArray(records) ? records.slice() : [];
  const out = rows.filter((r) => {
    if (!r) return false;
    if (filter.projectId != null && (r.projectId ?? null) !== filter.projectId) return false;
    if (filter.status && filter.status !== "all" && r.status !== filter.status) return false;
    if (Number.isFinite(filter.since) && (r.createdAt ?? 0) < filter.since) return false;
    if (Number.isFinite(filter.until) && (r.createdAt ?? 0) > filter.until) return false;
    return true;
  });
  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return out;
}

/** Shape history rows for export. */
export function shapeHistoryForExport(records, meta = {}) {
  return {
    kind: "raven-focus-history/v1",
    exportedAt: Number.isFinite(meta.now) ? meta.now : Date.now(),
    projectId: meta.projectId ?? null,
    projectName: meta.projectName ?? null,
    count: records.length,
    sessions: records.map((r) => ({
      id: r.id,
      projectId: r.projectId ?? null,
      title: r.title || "",
      mode: r.mode,
      status: r.status,
      plannedDurationMs: r.plannedDurationMs ?? null,
      startedAt: r.startedAt ?? null,
      pausedAt: r.pausedAt ?? null,
      completedAt: r.completedAt ?? null,
      cancelledAt: r.cancelledAt ?? null,
      accumulatedPausedMs: r.accumulatedPausedMs ?? 0,
      interruptions: (r.interruptions ?? []).slice(),
      linkedWorkflowId: r.linkedWorkflowId ?? null,
      linkedRunId: r.linkedRunId ?? null,
      notes: r.notes ?? "",
      source: r.source ?? "raven-home",
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    })),
  };
}

// ─── Keyboard command catalog ──────────────────────────────────────────
//
// Small deterministic catalog used by the palette + shortcut overlay.
// Ranking is a simple length-sensitive prefix match; ties break by the
// declared order so tests can pin outputs.

export const FOCUS_COMMANDS = [
  { id: "focus:start",   title: "Start focus block",   action: "focus_start",   section: "Focus", shortcut: "Alt+F" },
  { id: "focus:pause",   title: "Pause focus block",   action: "focus_pause",   section: "Focus", shortcut: "Alt+P" },
  { id: "focus:resume",  title: "Resume focus block",  action: "focus_resume",  section: "Focus", shortcut: "Alt+P" },
  { id: "focus:complete",title: "Complete focus block",action: "focus_complete",section: "Focus", shortcut: "Alt+Enter" },
  { id: "focus:cancel",  title: "Cancel focus block",  action: "focus_cancel",  section: "Focus", shortcut: "Alt+Backspace" },
  { id: "focus:log_interruption", title: "Log interruption", action: "focus_log_interruption", section: "Focus", shortcut: "Alt+I" },
  { id: "focus:toggle_mode", title: "Toggle Fast/Deep mode", action: "toggle_raven_mode", section: "Focus", shortcut: "Alt+M" },
];

/** Rank commands by a query. Deterministic; used by tests and palette. */
export function rankCommands(commands, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return commands.slice();
  const scored = commands.map((c, i) => {
    const t = (c.title ?? "").toLowerCase();
    let s = 0;
    if (t === q) s += 100;
    else if (t.startsWith(q)) s += 60;
    else if (t.includes(q)) s += 20;
    else {
      // loose fuzzy
      let j = 0;
      for (const ch of t) { if (ch === q[j]) j++; if (j >= q.length) break; }
      if (j >= q.length) s += 5;
    }
    return { c, s, i };
  }).filter((x) => x.s > 0).sort((a, b) => (b.s - a.s) || (a.i - b.i));
  return scored.map((x) => x.c);
}

/**
 * Decide whether a keyboard shortcut should be suppressed because the
 * user is currently typing. `escapeAllowed` events (like Escape) may
 * pass through to close modals.
 */
export function shouldSuppressShortcut(target, opts = {}) {
  if (opts.escapeAllowed && opts.key === "Escape") return false;
  const el = target;
  if (!el || typeof el !== "object") return false;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable === true) return true;
  return false;
}