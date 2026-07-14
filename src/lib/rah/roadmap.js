// Pure deterministic helpers for Project DNA v0.2 roadmap milestones.
//
// React must only render the results of these functions. No IndexedDB,
// no DOM, no side effects. Missing values return null/"" — never fabricated.

export const ROADMAP_STATUSES = ["backlog", "planned", "in_progress", "blocked", "done"];

export const ROADMAP_STATUS_LABEL = {
  backlog: "Backlog",
  planned: "Planned",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

export const ROADMAP_STATUS_ORDER = Object.freeze(
  Object.fromEntries(ROADMAP_STATUSES.map((s, i) => [s, i])),
);

export const ROADMAP_PRIORITIES = ["low", "normal", "high", "critical"];

export const UNASSIGNED_COLUMN = "unassigned";
export const ROADMAP_COLUMNS = Object.freeze([...ROADMAP_STATUSES, UNASSIGNED_COLUMN]);

function coerceString(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
function isFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }

export function normalizeMilestone(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = coerceString(raw.id).trim();
  if (!id) return null;
  const rawStatus = coerceString(raw.status).trim().toLowerCase();
  const status = ROADMAP_STATUSES.includes(rawStatus) ? rawStatus : "";
  const rawPriority = coerceString(raw.priority).trim().toLowerCase();
  const priority = ROADMAP_PRIORITIES.includes(rawPriority) ? rawPriority : "normal";
  let targetDate = null;
  if (raw.targetDate) {
    const d = new Date(raw.targetDate);
    if (!Number.isNaN(d.getTime())) targetDate = d.toISOString().slice(0, 10);
  }
  const dependencies = Array.isArray(raw.dependencies)
    ? [...new Set(raw.dependencies.map((d) => coerceString(d).trim()).filter(Boolean))]
    : [];
  const evidenceIds = Array.isArray(raw.evidenceIds)
    ? raw.evidenceIds.map((e) => coerceString(e).trim()).filter(Boolean)
    : [];
  return {
    id,
    projectId: raw.projectId == null ? null : coerceString(raw.projectId),
    title: coerceString(raw.title).trim(),
    description: coerceString(raw.description),
    status, // "" means unassigned/unknown legacy value
    rawStatus: rawStatus || null,
    priority,
    targetDate,
    owner: coerceString(raw.owner).trim() || null,
    dependencies,
    evidenceIds,
    order: isFiniteNumber(raw.order) ? raw.order : 0,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : (isFiniteNumber(raw.createdAt) ? raw.createdAt : 0),
    source: coerceString(raw.source).trim() || "user",
  };
}

function sortInColumn(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id.localeCompare(b.id);
}

/** Group milestones by column. Unknown statuses => UNASSIGNED_COLUMN. */
export function groupByColumn(milestones, opts = {}) {
  const projectId = opts.projectId === undefined ? undefined : (opts.projectId ?? null);
  const columns = {};
  for (const c of ROADMAP_COLUMNS) columns[c] = [];
  for (const raw of milestones ?? []) {
    const m = normalizeMilestone(raw);
    if (!m) continue;
    if (projectId !== undefined && m.projectId !== projectId) continue;
    const col = m.status || UNASSIGNED_COLUMN;
    columns[col].push(m);
  }
  for (const col of ROADMAP_COLUMNS) columns[col].sort(sortInColumn);
  return columns;
}

/** Return a new list with `id` moved to `targetStatus` at `targetIndex`.
 *  targetIndex is the position within the target column after removal.
 *  Recomputes `order` densely (0..n-1) per column. */
export function moveMilestone(milestones, id, targetStatus, targetIndex) {
  const normList = (milestones ?? []).map(normalizeMilestone).filter(Boolean);
  const moving = normList.find((m) => m.id === id);
  if (!moving) return normList;
  const validTarget = ROADMAP_STATUSES.includes(targetStatus) || targetStatus === UNASSIGNED_COLUMN;
  if (!validTarget) return normList;

  const nextStatus = targetStatus === UNASSIGNED_COLUMN ? "" : targetStatus;
  const withoutMoving = normList.filter((m) => m.id !== id);
  const grouped = {};
  for (const c of ROADMAP_COLUMNS) grouped[c] = [];
  for (const m of withoutMoving) grouped[m.status || UNASSIGNED_COLUMN].push(m);
  for (const c of ROADMAP_COLUMNS) grouped[c].sort(sortInColumn);

  const updated = { ...moving, status: nextStatus };
  const dest = grouped[targetStatus];
  const idx = Math.max(0, Math.min(targetIndex ?? dest.length, dest.length));
  dest.splice(idx, 0, updated);

  const out = [];
  for (const c of ROADMAP_COLUMNS) {
    grouped[c].forEach((m, i) => {
      const wasReordered = m.order !== i || (m.id === id);
      out.push(wasReordered ? { ...m, order: i } : { ...m, order: i });
    });
  }
  return out;
}

/** Move within same column by delta (-1 up, +1 down). */
export function reorderWithinColumn(milestones, id, delta) {
  const list = (milestones ?? []).map(normalizeMilestone).filter(Boolean);
  const target = list.find((m) => m.id === id);
  if (!target) return list;
  const col = target.status || UNASSIGNED_COLUMN;
  const grouped = groupByColumn(list);
  const arr = grouped[col];
  const i = arr.findIndex((m) => m.id === id);
  const j = i + (delta > 0 ? 1 : -1);
  if (i < 0 || j < 0 || j >= arr.length) return list;
  return moveMilestone(list, id, col === UNASSIGNED_COLUMN ? UNASSIGNED_COLUMN : col, j);
}

/** Detect changes between saved and draft milestone arrays. Returns true if any differ. */
export function isRoadmapDirty(saved, draft) {
  const norm = (list) => (list ?? []).map(normalizeMilestone).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  const a = norm(saved);
  const b = norm(draft);
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id) return true;
    if (x.title !== y.title) return true;
    if (x.description !== y.description) return true;
    if (x.status !== y.status) return true;
    if (x.priority !== y.priority) return true;
    if (x.targetDate !== y.targetDate) return true;
    if ((x.owner ?? "") !== (y.owner ?? "")) return true;
    if (x.order !== y.order) return true;
    if (JSON.stringify(x.dependencies) !== JSON.stringify(y.dependencies)) return true;
    if (JSON.stringify(x.evidenceIds) !== JSON.stringify(y.evidenceIds)) return true;
  }
  return false;
}

/** Detect cycles in dependency graph using DFS. Returns array of cyclic milestone ids. */
function findCycles(milestones) {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const state = new Map(); // 0=unvisited,1=visiting,2=done
  const cyclic = new Set();
  function visit(id, stack) {
    const s = state.get(id) ?? 0;
    if (s === 1) {
      const start = stack.indexOf(id);
      for (let i = Math.max(0, start); i < stack.length; i++) cyclic.add(stack[i]);
      return;
    }
    if (s === 2) return;
    state.set(id, 1);
    stack.push(id);
    const m = byId.get(id);
    for (const dep of m?.dependencies ?? []) {
      if (byId.has(dep)) visit(dep, stack);
    }
    stack.pop();
    state.set(id, 2);
  }
  for (const m of milestones) visit(m.id, []);
  return [...cyclic];
}

/** Validate roadmap. Returns { valid, errors: [{ milestoneId?, code, message }] } */
export function validateRoadmap(milestones) {
  const list = (milestones ?? []).map(normalizeMilestone).filter(Boolean);
  const errors = [];
  const seen = new Map();
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of list) {
    if (!m.title) errors.push({ milestoneId: m.id, code: "empty_title", message: "Milestone title is required." });
    if (m.status && !ROADMAP_STATUSES.includes(m.status))
      errors.push({ milestoneId: m.id, code: "invalid_status", message: `Invalid status "${m.status}".` });
    if (m.rawStatus && !m.status)
      errors.push({ milestoneId: m.id, code: "invalid_status", message: `Legacy status "${m.rawStatus}" must be reassigned before Save.` });
    if (m.targetDate) {
      const d = new Date(m.targetDate);
      if (Number.isNaN(d.getTime())) errors.push({ milestoneId: m.id, code: "invalid_date", message: "Target date is invalid." });
    }
    if (seen.has(m.id)) errors.push({ milestoneId: m.id, code: "duplicate_id", message: "Duplicate milestone id." });
    seen.set(m.id, true);
    for (const dep of m.dependencies) {
      if (dep === m.id) errors.push({ milestoneId: m.id, code: "self_dependency", message: "Milestone depends on itself." });
      else if (!byId.has(dep)) errors.push({ milestoneId: m.id, code: "missing_dependency", message: `Dependency "${dep}" does not exist.` });
    }
  }
  const cyclic = findCycles(list);
  for (const id of cyclic) errors.push({ milestoneId: id, code: "circular_dependency", message: "Circular dependency detected." });
  return { valid: errors.length === 0, errors };
}

/** Produce a JSON export shape for the roadmap. */
export function exportRoadmapJson({ project, milestones, exportedAt = Date.now() }) {
  const grouped = groupByColumn(milestones, { projectId: project?.id ?? null });
  const validation = validateRoadmap(milestones ?? []);
  return {
    kind: "raven-roadmap/v1",
    exportedAt: new Date(exportedAt).toISOString(),
    project: project ? { id: project.id, name: project.name } : null,
    columns: ROADMAP_COLUMNS.map((c) => ({
      column: c,
      label: c === UNASSIGNED_COLUMN ? "Unassigned" : ROADMAP_STATUS_LABEL[c],
      milestones: grouped[c].map(({ rawStatus: _r, ...m }) => m),
    })),
    validation: { valid: validation.valid, errorCount: validation.errors.length, errors: validation.errors },
  };
}

/** Produce a Markdown export shape for the roadmap. */
export function exportRoadmapMarkdown({ project, milestones, exportedAt = Date.now() }) {
  const grouped = groupByColumn(milestones, { projectId: project?.id ?? null });
  const validation = validateRoadmap(milestones ?? []);
  const lines = [];
  lines.push(`# Roadmap — ${project?.name ?? "Untitled project"}`);
  lines.push(``);
  lines.push(`_Exported ${new Date(exportedAt).toISOString()} · ${validation.valid ? "valid" : validation.errors.length + " validation error(s)"}_`);
  for (const col of ROADMAP_COLUMNS) {
    const items = grouped[col];
    const label = col === UNASSIGNED_COLUMN ? "Unassigned" : ROADMAP_STATUS_LABEL[col];
    lines.push("");
    lines.push(`## ${label} (${items.length})`);
    if (items.length === 0) { lines.push("_—_"); continue; }
    for (const m of items) {
      const bits = [];
      bits.push(`**${m.title || "(untitled)"}**`);
      bits.push(`priority: ${m.priority}`);
      bits.push(`target: ${m.targetDate ?? "—"}`);
      bits.push(`owner: ${m.owner ?? "—"}`);
      if (m.dependencies.length) bits.push(`deps: ${m.dependencies.join(", ")}`);
      if (m.evidenceIds.length) bits.push(`evidence: ${m.evidenceIds.join(", ")}`);
      lines.push(`- ${bits.join(" · ")}`);
      if (m.description) lines.push(`  ${m.description.replace(/\n/g, "\n  ")}`);
    }
  }
  return lines.join("\n");
}

export const NO_SILENT_SAVE = Object.freeze({
  roadmapRequiresExplicitSave: true,
  dragUpdatesInMemoryDraftOnly: true,
});