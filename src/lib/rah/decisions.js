// Pure deterministic helpers for Project DNA v0.2 decisions changelog.
//
// A "decision" is an aggregate identified by decisionId. Every edit produces
// a new immutable version with monotonic versionNumber, timestamp, and
// immutable payload. Nothing here writes to storage; the caller decides
// when to persist. Duplicate detection is a warning only.

export const DECISION_STATUSES = ["proposed", "accepted", "superseded", "reversed"];

export const DECISION_STATUS_LABEL = {
  proposed: "Proposed",
  accepted: "Accepted",
  superseded: "Superseded",
  reversed: "Reversed",
};

function coerceString(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
function isFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }

/** Normalize a raw decision version record. */
export function normalizeVersion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = coerceString(raw.id).trim();
  const decisionId = coerceString(raw.decisionId).trim();
  if (!id || !decisionId) return null;
  const rawStatus = coerceString(raw.status).trim().toLowerCase();
  const status = DECISION_STATUSES.includes(rawStatus) ? rawStatus : "proposed";
  return {
    id,
    decisionId,
    versionNumber: isFiniteNumber(raw.versionNumber) ? raw.versionNumber : 1,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : 0,
    title: coerceString(raw.title).trim(),
    content: coerceString(raw.content),
    rationale: coerceString(raw.rationale),
    status,
    author: coerceString(raw.author).trim() || null,
    source: coerceString(raw.source).trim() || "user",
    evidenceIds: Array.isArray(raw.evidenceIds)
      ? raw.evidenceIds.map((e) => coerceString(e).trim()).filter(Boolean)
      : [],
    supersedesDecisionId: raw.supersedesDecisionId ? coerceString(raw.supersedesDecisionId).trim() : null,
    reversesDecisionId: raw.reversesDecisionId ? coerceString(raw.reversesDecisionId).trim() : null,
  };
}

/** Normalize a raw decision aggregate record. */
export function normalizeDecision(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = coerceString(raw.id).trim();
  if (!id) return null;
  return {
    id,
    projectId: raw.projectId == null ? null : coerceString(raw.projectId),
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : (isFiniteNumber(raw.createdAt) ? raw.createdAt : 0),
    archived: Boolean(raw.archived),
  };
}

/** Build an initial version for a brand-new decision. Never persists. */
export function makeInitialVersion({
  decisionId, title, content = "", rationale = "", status = "proposed",
  author = null, source = "user", evidenceIds = [], now = Date.now(), versionId,
}) {
  if (!decisionId) throw new Error("decisionId required");
  return normalizeVersion({
    id: versionId ?? `${decisionId}:v1`,
    decisionId, versionNumber: 1, createdAt: now,
    title, content, rationale, status, author, source, evidenceIds,
  });
}

/** Create the next version from an existing latest version + a patch. Immutable append; never mutates the prior. */
export function makeNextVersion(previousVersion, patch = {}, opts = {}) {
  const prev = normalizeVersion(previousVersion);
  if (!prev) throw new Error("previousVersion required");
  const now = isFiniteNumber(opts.now) ? opts.now : Date.now();
  const nextNumber = prev.versionNumber + 1;
  const next = {
    id: opts.versionId ?? `${prev.decisionId}:v${nextNumber}`,
    decisionId: prev.decisionId,
    versionNumber: nextNumber,
    createdAt: now,
    title: patch.title !== undefined ? patch.title : prev.title,
    content: patch.content !== undefined ? patch.content : prev.content,
    rationale: patch.rationale !== undefined ? patch.rationale : prev.rationale,
    status: patch.status !== undefined ? patch.status : prev.status,
    author: patch.author !== undefined ? patch.author : prev.author,
    source: patch.source !== undefined ? patch.source : "user-edit",
    evidenceIds: patch.evidenceIds !== undefined ? patch.evidenceIds : prev.evidenceIds,
    supersedesDecisionId: patch.supersedesDecisionId !== undefined ? patch.supersedesDecisionId : prev.supersedesDecisionId,
    reversesDecisionId: patch.reversesDecisionId !== undefined ? patch.reversesDecisionId : prev.reversesDecisionId,
  };
  return normalizeVersion(next);
}

/** Group and sort versions per decisionId, oldest first. */
export function groupVersions(versions) {
  const map = new Map();
  for (const raw of versions ?? []) {
    const v = normalizeVersion(raw);
    if (!v) continue;
    if (!map.has(v.decisionId)) map.set(v.decisionId, []);
    map.get(v.decisionId).push(v);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.versionNumber - b.versionNumber || a.createdAt - b.createdAt);
  return map;
}

/** Latest version for each decision id. */
export function latestVersions(versions) {
  const groups = groupVersions(versions);
  const out = new Map();
  for (const [k, arr] of groups) out.set(k, arr[arr.length - 1]);
  return out;
}

/** Deterministic field-level diff between two versions.
 *  Returns array of { field, before, after, changed }. */
const DIFF_FIELDS = ["title", "status", "author", "content", "rationale", "evidenceIds", "supersedesDecisionId", "reversesDecisionId"];
export function diffVersions(a, b) {
  const x = normalizeVersion(a);
  const y = normalizeVersion(b);
  const rows = [];
  for (const f of DIFF_FIELDS) {
    const bv = x ? x[f] : null;
    const av = y ? y[f] : null;
    const changed = JSON.stringify(bv) !== JSON.stringify(av);
    rows.push({ field: f, before: bv, after: av, changed });
  }
  return rows;
}

/** Normalize a string for similarity comparison: lowercase, strip non-alphanumerics. */
function normStr(s) {
  return coerceString(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function jaccard(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
/** Return duplicate candidates for a draft version against latest versions,
 *  as [{ decisionId, similarity }]. Threshold default 0.75. */
export function findDuplicateCandidates({ draft, decisions, versions, projectId = null, threshold = 0.75 }) {
  const latest = latestVersions(versions);
  const draftText = normStr((draft?.title ?? "") + " " + (draft?.content ?? ""));
  if (!draftText) return [];
  const projDecisionIds = new Set(
    (decisions ?? [])
      .map(normalizeDecision).filter(Boolean)
      .filter((d) => !d.archived && (projectId === null || d.projectId === projectId))
      .map((d) => d.id),
  );
  const out = [];
  for (const [decisionId, v] of latest) {
    if (draft?.decisionId && draft.decisionId === decisionId) continue;
    if (!projDecisionIds.has(decisionId)) continue;
    const candText = normStr(v.title + " " + v.content);
    const s = jaccard(draftText, candText);
    if (s >= threshold) out.push({ decisionId, similarity: Number(s.toFixed(3)), title: v.title });
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out;
}

/** Check whether a draft version differs from the latest saved one. */
export function isVersionDirty(latestVersion, draft) {
  if (!latestVersion) return Boolean(draft && (draft.title || draft.content || draft.rationale));
  const rows = diffVersions(latestVersion, { ...latestVersion, ...draft });
  return rows.some((r) => r.changed);
}

/** Export the changelog to JSON. */
export function exportChangelogJson({ project, decisions, versions, exportedAt = Date.now() }) {
  const groups = groupVersions(versions);
  const decs = (decisions ?? []).map(normalizeDecision).filter(Boolean)
    .filter((d) => !project || d.projectId === project.id);
  return {
    kind: "raven-decisions/v1",
    exportedAt: new Date(exportedAt).toISOString(),
    project: project ? { id: project.id, name: project.name } : null,
    decisions: decs.map((d) => ({
      id: d.id,
      projectId: d.projectId,
      archived: d.archived,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      versions: (groups.get(d.id) ?? []),
    })),
  };
}

/** Export the changelog to Markdown. */
export function exportChangelogMarkdown({ project, decisions, versions, exportedAt = Date.now() }) {
  const groups = groupVersions(versions);
  const decs = (decisions ?? []).map(normalizeDecision).filter(Boolean)
    .filter((d) => !project || d.projectId === project.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const lines = [];
  lines.push(`# Decisions Changelog — ${project?.name ?? "Untitled project"}`);
  lines.push("");
  lines.push(`_Exported ${new Date(exportedAt).toISOString()} · ${decs.length} decision(s)_`);
  for (const d of decs) {
    const vs = groups.get(d.id) ?? [];
    const latest = vs[vs.length - 1];
    lines.push("");
    lines.push(`## ${latest?.title ?? "(untitled decision)"}${d.archived ? " · archived" : ""}`);
    lines.push(`_id: ${d.id} · status: ${latest?.status ?? "—"} · versions: ${vs.length}_`);
    for (const v of vs) {
      lines.push("");
      lines.push(`### v${v.versionNumber} — ${new Date(v.createdAt).toISOString()} — ${DECISION_STATUS_LABEL[v.status] ?? v.status}`);
      lines.push(`- author: ${v.author ?? "—"} · source: ${v.source}`);
      if (v.supersedesDecisionId) lines.push(`- supersedes: ${v.supersedesDecisionId}`);
      if (v.reversesDecisionId) lines.push(`- reverses: ${v.reversesDecisionId}`);
      if (v.evidenceIds.length) lines.push(`- evidence: ${v.evidenceIds.join(", ")}`);
      if (v.content) { lines.push(""); lines.push(v.content); }
      if (v.rationale) { lines.push(""); lines.push(`_Rationale:_ ${v.rationale}`); }
    }
  }
  return lines.join("\n");
}

export const NO_SILENT_SAVE = Object.freeze({
  editCreatesNewVersion: true,
  historyIsImmutable: true,
  duplicateWarningIsNotAutoMerge: true,
  archivePreferredOverDelete: true,
});