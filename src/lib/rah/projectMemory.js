// Pure helpers for the Raven Project Memory system.
//
// Only deterministic pure functions so it can be exercised by fast Node
// tests without touching IndexedDB, React, or the DOM.
// Privacy contract: nothing here logs record contents.

export const MEMORY_TYPES = [
  "note",
  "decision",
  "milestone",
  "blocker",
  "next_action",
  "daily_log",
  "fact",
];

export const MEMORY_TYPE_LABEL = {
  note: "Note",
  decision: "Decision",
  milestone: "Milestone",
  blocker: "Blocker",
  next_action: "Next action",
  daily_log: "Daily log",
  fact: "Important fact",
};

export const MEMORY_INJECTION_MARKER = "=== RAH PROJECT MEMORY (deterministic) ===";
export const MEMORY_INJECTION_END = "=== END RAH PROJECT MEMORY ===";

function normalize(r) {
  return {
    id: String(r.id),
    projectId: r.projectId ?? null,
    title: String(r.title ?? "").trim(),
    content: String(r.content ?? ""),
    type: MEMORY_TYPES.includes(r.type) ? r.type : "note",
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || Number(r.createdAt) || 0,
    source: String(r.source ?? "user"),
    archived: Boolean(r.archived),
    pinned: Boolean(r.pinned),
  };
}

export function filterMemories(list, opts = {}) {
  const q = String(opts.q ?? "").trim().toLowerCase();
  const types = opts.types && opts.types.length ? new Set(opts.types) : null;
  const projectId = opts.projectId === undefined ? undefined : (opts.projectId ?? null);
  const includeArchived = Boolean(opts.includeArchived);
  return list
    .map(normalize)
    .filter((r) => (includeArchived ? true : !r.archived))
    .filter((r) => (types ? types.has(r.type) : true))
    .filter((r) => (projectId === undefined ? true : r.projectId === projectId))
    .filter((r) => {
      if (!q) return true;
      const hay = (r.title + " \n " + r.content + " " + r.tags.join(" ")).toLowerCase();
      return hay.includes(q);
    });
}

export function selectRelevantForPrompt(list, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 8;
  const projectId = opts.projectId ?? null;
  const live = list.map(normalize).filter((r) => !r.archived);
  const pool = live.filter((r) => r.projectId === projectId || r.projectId === null);
  const pinned = pool.filter((r) => r.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = pool.filter((r) => !r.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  const out = [];
  const seen = new Set();
  for (const r of [...pinned, ...recent]) {
    if (out.length >= limit) break;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function buildMemoryInjectionBlock(records, opts = {}) {
  const list = (records ?? []).map(normalize).filter((r) => !r.archived);
  if (!list.length) return "";
  const projectName = opts.projectName ? ` for project "${opts.projectName}"` : "";
  const header = [
    MEMORY_INJECTION_MARKER,
    "The following " + list.length + " memory record" + (list.length === 1 ? "" : "s") + projectName +
      " were selected by the Raven Command app (not by you) as the most relevant recent + pinned context. Treat them as authoritative background. Do NOT invent memories that are not listed here.",
  ];
  for (const r of list) {
    const tags = r.tags.length ? " [" + r.tags.join(", ") + "]" : "";
    const pin = r.pinned ? " (pinned)" : "";
    const t = MEMORY_TYPE_LABEL[r.type] ?? r.type;
    const body = r.content ? "\n    " + r.content.replace(/\n/g, "\n    ") : "";
    header.push("- [" + t + "]" + pin + " " + r.title + tags + body);
  }
  header.push(MEMORY_INJECTION_END);
  return header.join("\n");
}

export function selectWelcomeSummary(list, opts = {}) {
  const projectId = opts.projectId ?? null;
  const live = list.map(normalize).filter((r) => !r.archived);
  const scope = live.filter((r) => r.projectId === projectId || r.projectId === null);
  const newest = (t) =>
    scope.filter((r) => r.type === t).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  return {
    projectId,
    lastMilestone: newest("milestone"),
    currentBlocker: newest("blocker"),
    nextAction: newest("next_action"),
    generatedAt: Number(opts.now) || Date.now(),
  };
}

export function bucketToday(list, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  return list.map(normalize).filter((r) => !r.archived && r.updatedAt >= start.getTime());
}
export function bucketRecent(list, now = Date.now(), days = 7) {
  const cutoff = now - days * 24 * 3600 * 1000;
  return list.map(normalize)
    .filter((r) => !r.archived && r.updatedAt >= cutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function bucketPinned(list) {
  return list.map(normalize)
    .filter((r) => !r.archived && r.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function bucketByProject(list) {
  const out = new Map();
  for (const r of list.map(normalize)) {
    if (r.archived) continue;
    const k = r.projectId ?? "__global__";
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  for (const arr of out.values()) arr.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function makeMemorySuggestionFromCommand(cmd, opts = {}) {
  if (!cmd || typeof cmd !== "object") return null;
  if (cmd.status && cmd.status !== "done") return null;
  const prompt = String(cmd.prompt ?? "").trim();
  if (!prompt) return null;
  const summary = String(cmd.resultSummary ?? "").trim();
  const title = prompt.length > 80 ? prompt.slice(0, 77) + "…" : prompt;
  const lowered = prompt.toLowerCase();
  let type = "note";
  if (/\b(decide|decision|choose|chose|selected)\b/.test(lowered)) type = "decision";
  else if (/\b(done|shipped|released|completed|milestone)\b/.test(lowered)) type = "milestone";
  else if (/\b(blocked|blocker|stuck|cannot|failing|error)\b/.test(lowered)) type = "blocker";
  else if (/\b(next|todo|action|follow[- ]up|plan)\b/.test(lowered)) type = "next_action";
  else if (/\b(remember|fact|important|note that)\b/.test(lowered)) type = "fact";
  return {
    _suggestion: true,
    draft: {
      projectId: opts.projectId ?? null,
      title,
      content: summary ? (prompt + "\n\n" + summary).slice(0, 4000) : prompt,
      type,
      tags: Array.isArray(cmd.agents) ? cmd.agents.slice(0, 4) : [],
      source: "command-suggestion",
      pinned: false,
      archived: false,
    },
  };
}

export function memoryDiagnostics(list) {
  const normed = list.map(normalize);
  const byType = {};
  for (const t of MEMORY_TYPES) byType[t] = 0;
  let pinned = 0, archived = 0, global = 0;
  for (const r of normed) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    if (r.pinned) pinned++;
    if (r.archived) archived++;
    if (r.projectId === null) global++;
  }
  return { total: normed.length, pinned, archived, global, byType };
}

export const NO_SILENT_SAVE = Object.freeze({
  suggestionsRequireExplicitConfirm: true,
});
