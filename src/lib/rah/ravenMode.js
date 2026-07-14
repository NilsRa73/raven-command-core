// Raven Fast Mode / Deep Mode — deterministic pure helpers.
//
// No React, no DOM, no IndexedDB. Safe for Node tests. All persistence
// (localStorage, audit) lives in ravenModeStore.ts / ravenAudit.ts.
//
// Priority tagging (derived from existing memory fields — no schema change):
//   critical   = pinned && !archived
//   active     = !archived && (type === "blocker" || type === "next_action")
//   supporting = !archived && everything else
//   archived   = archived
//
// Fast packet includes only critical + active; Deep packet expands with the
// most-recent relevant supporting items. Both packets scope to the active
// project + globals (projectId === null).

export const RAVEN_MODES = ["fast", "deep"];

export const RAVEN_MODE_LABEL = { fast: "Fast Mode", deep: "Deep Mode" };

export const RAVEN_MODE_META = {
  fast: {
    label: "Fast Mode",
    icon: "⚡",
    tagline: "Critical + Active + a few recent Supporting",
    target: "Instant",
    contextLimit: 6,
    perItemChars: 220,
    // Fast Mode prioritizes Critical + Active but keeps room for a small,
    // bounded number of the most recent/relevant Supporting records —
    // enough to preserve continuity without blowing the context budget.
    includeSupporting: true,
    fastSupportingCap: 2,
    fastSupportingMinScore: 30, // must beat baseline "old + irrelevant"
    includeArchivedSearchable: false,
  },
  deep: {
    label: "Deep Mode",
    icon: "🜛",
    tagline: "Architecture · reasoning · full relevant context",
    target: "Deep",
    contextLimit: 20,
    perItemChars: 800,
    includeSupporting: true,
    fastSupportingCap: Infinity,
    fastSupportingMinScore: 0,
    includeArchivedSearchable: true,
  },
};

export const PRIORITY_ORDER = ["critical", "active", "supporting", "archived"];
export const PRIORITY_LABEL = {
  critical: "Critical",
  active: "Active",
  supporting: "Supporting",
  archived: "Archived",
};

export function derivePriority(rec) {
  if (!rec) return "supporting";
  if (rec.archived) return "archived";
  if (rec.pinned) return "critical";
  if (rec.type === "blocker" || rec.type === "next_action") return "active";
  return "supporting";
}

/**
 * Score higher = more relevant. Deterministic; based on:
 *   priority weight + recency (log-scaled days) + optional keyword match.
 */
export function scoreRelevance(rec, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const priority = derivePriority(rec);
  const priorityWeight =
    priority === "critical" ? 100 :
    priority === "active" ? 60 :
    priority === "supporting" ? 25 : 0;
  const ageDays = Math.max(0, (now - (Number(rec.updatedAt) || 0)) / 86_400_000);
  const recency = Math.max(0, 30 - Math.min(30, ageDays));
  const q = String(opts.query ?? "").trim().toLowerCase();
  let match = 0;
  if (q) {
    const hay = ((rec.title || "") + " " + (rec.content || "") + " " + (rec.tags || []).join(" ")).toLowerCase();
    if (hay.includes(q)) match = 20;
  }
  return priorityWeight + recency + match;
}

export function reasonForInclusion(rec, opts = {}) {
  const p = derivePriority(rec);
  const pinned = rec.pinned ? "pinned" : null;
  const type = rec.type ? `type=${rec.type}` : null;
  const q = String(opts.query ?? "").trim().toLowerCase();
  const matched = q && ((rec.title || "") + " " + (rec.content || "")).toLowerCase().includes(q) ? `matches "${q}"` : null;
  return [PRIORITY_LABEL[p], pinned, type, matched].filter(Boolean).join(" · ");
}

/**
 * Build the ordered list of memory records for a mode.
 * Honors explicit pins (always included when live) and excludes (always dropped)
 * kept in the mode store.
 */
export function selectContextForMode(list, opts = {}) {
  const mode = opts.mode === "deep" ? "deep" : "fast";
  const meta = RAVEN_MODE_META[mode];
  const projectId = opts.projectId ?? null;
  const pins = new Set(opts.pinnedIds || []);
  const excludes = new Set(opts.excludedIds || []);
  const now = Number(opts.now) || Date.now();

  const scoped = (list || [])
    .filter((r) => r && !excludes.has(r.id))
    .filter((r) => r.projectId === projectId || r.projectId === null);

  const live = scoped.filter((r) => !r.archived);
  const scored = live.map((r) => ({
    rec: r,
    priority: derivePriority(r),
    score: scoreRelevance(r, { now, query: opts.query }),
    reason: reasonForInclusion(r, { query: opts.query }),
    forcedPin: pins.has(r.id),
  }));

  // Priority tier ordering: pins first, then critical, active, supporting.
  const tierRank = (s) => (s.forcedPin ? -1 : PRIORITY_ORDER.indexOf(s.priority));
  const bySalience = (a, b) => {
    const ta = tierRank(a), tb = tierRank(b);
    if (ta !== tb) return ta - tb;
    if (b.score !== a.score) return b.score - a.score;
    return (b.rec.updatedAt || 0) - (a.rec.updatedAt || 0);
  };

  // Critical + Active + pins always considered.
  const primary = scored.filter(
    (s) => s.forcedPin || s.priority === "critical" || s.priority === "active",
  ).sort(bySalience);

  // Supporting: in Fast Mode allow only the top-scoring, recent-relevant few
  // (bounded by fastSupportingCap and fastSupportingMinScore). In Deep Mode
  // include all supporting; primary priority still comes first via bySalience.
  const supportingAll = scored
    .filter((s) => s.priority === "supporting" && !s.forcedPin)
    .sort(bySalience);
  const supportingKept = meta.includeSupporting
    ? supportingAll
        .filter((s) => s.score >= (meta.fastSupportingMinScore ?? 0))
        .slice(0, meta.fastSupportingCap ?? Infinity)
    : [];

  // Merge: primary first, then supporting; then cap to contextLimit.
  return [...primary, ...supportingKept].slice(0, meta.contextLimit);
}

/** Truncate content to a per-mode character budget without breaking words hard. */
export function truncateForMode(text, mode) {
  const meta = RAVEN_MODE_META[mode === "deep" ? "deep" : "fast"];
  const s = String(text ?? "");
  if (s.length <= meta.perItemChars) return s;
  return s.slice(0, meta.perItemChars - 1).trimEnd() + "…";
}

/** Build a plain-text context packet string suitable for prompt injection. */
export function buildContextPacket(list, opts = {}) {
  const mode = opts.mode === "deep" ? "deep" : "fast";
  const meta = RAVEN_MODE_META[mode];
  const selected = selectContextForMode(list, opts);
  const composition = mode === "fast"
    ? "critical + active + up to " + (meta.fastSupportingCap ?? 0) + " recent supporting"
    : "critical + active + supporting";
  // Optional project header — when a project is supplied, the executor and
  // the Automations preview both prepend it so the emitted text (and
  // therefore the packet hash / parity id) is identical in both places.
  const project = opts.project ?? null;
  const projectHeaderLines = project
    ? [
        `=== RAH PROJECT ===`,
        `Name: ${project.name ?? ""}`,
        project.description ? `Description: ${project.description}` : null,
        project.goals ? `Goals: ${project.goals}` : null,
        `=== END RAH PROJECT ===`,
      ].filter(Boolean)
    : [];
  const header = [
    ...projectHeaderLines,
    `=== RAH RAVEN CONTEXT · ${meta.label.toUpperCase()} ===`,
    `Selected ${selected.length}/${(list || []).length} memory records (${composition}).`,
  ];
  const body = selected.map((s) => {
    const tags = (s.rec.tags && s.rec.tags.length) ? ` [${s.rec.tags.join(", ")}]` : "";
    const pin = s.forcedPin ? " (pinned)" : s.rec.pinned ? " (pinned)" : "";
    const content = truncateForMode(s.rec.content, mode);
    return `- [${PRIORITY_LABEL[s.priority]}] ${s.rec.title}${tags}${pin}\n    ${content.replace(/\n/g, "\n    ")}`;
  });
  const footer = ["=== END RAH RAVEN CONTEXT ==="];
  const text = [...header, ...body, ...footer].join("\n");
  const selectedIds = selected.map((s) => s.rec.id);
  // Deterministic SHA-256 over the exact emitted packet text plus the
  // structural inputs. Same inputs → same hash on every runtime.
  const packetHash = deterministicHash(
    JSON.stringify({ mode, selectedIds, projectId: opts.projectId ?? null, textLen: text.length, text }),
  );
  const parityId = `pkt_${mode}_${selectedIds.length}_${packetHash.slice(0, 12)}`;
  return {
    mode,
    text,
    items: selected,
    approxChars: text.length,
    approxTokens: Math.ceil(text.length / 4),
    generatedAt: Number(opts.now) || Date.now(),
    compressionPct: computeCompression(selected, list, mode),
    selectedIds,
    packetHash,
    parityId,
    projectId: opts.projectId ?? null,
    projectName: project?.name ?? null,
  };
}

// Deterministic SHA-256 (64-hex). Pure JS, synchronous — safe for the
// packet builder used by both preview and executor. Not intended as a
// security primitive; used for content parity/identity.
export function deterministicHash(str) {
  return sha256HexSync(String(str ?? ""));
}

const _K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function sha256HexSync(msg) {
  const bytes = new TextEncoder().encode(msg);
  const bitLen = bytes.length * 8;
  const paddedLen = ((bytes.length + 9 + 63) >>> 6) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  const H = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15], w2 = W[t - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const T1 = (h + S1 + ch + _K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const T2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + T1) >>> 0;
      d = c; c = b; b = a; a = (T1 + T2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
  return out;
}

function computeCompression(selected, list, mode) {
  const total = (list || []).reduce((s, r) => s + String(r.content || "").length + String(r.title || "").length, 0);
  if (total === 0) return 0;
  const kept = selected.reduce((s, x) => s + Math.min(String(x.rec.content || "").length, RAVEN_MODE_META[mode].perItemChars) + String(x.rec.title || "").length, 0);
  return Math.max(0, Math.min(100, Math.round(100 - (kept / total) * 100)));
}

/**
 * Routing classifier — returns which lane a prompt will land in.
 * Deterministic, keyword-based; supplemented by mode + approvalMode.
 */
export const ROUTE_LANES = ["local_quick_action", "raven_agent", "planning_deep", "approval_required"];

export const ROUTE_LABEL = {
  local_quick_action: "Local Quick Action",
  raven_agent: "Raven Agent",
  planning_deep: "Planning / Deep Analysis",
  approval_required: "Approval Required",
};

export const ROUTE_TARGET = {
  local_quick_action: "Instant",
  raven_agent: "Fast",
  planning_deep: "Deep",
  approval_required: "Gated",
};

const APPROVAL_RX = /\b(delete|remove|move|rename|launch|open|execute|run\s+app|install|write\s+file|overwrite)\b/i;
const PLANNING_RX = /\b(plan|architect|design|analyz(?:e|is)|compare|why|research|strategy|refactor|roadmap|breakdown)\b/i;
const QUICK_RX = /\b(what|when|where|list|show|status|summary|note|remind)\b/i;

export function classifyRoute(prompt, opts = {}) {
  const p = String(prompt || "").trim();
  const mode = opts.mode === "deep" ? "deep" : "fast";
  const approvalMode = opts.approvalMode || "ask_every";
  const reasons = [];
  if (!p) {
    return { lane: "local_quick_action", label: ROUTE_LABEL.local_quick_action, target: ROUTE_TARGET.local_quick_action, reasons: ["empty prompt"], mode };
  }
  if (APPROVAL_RX.test(p) && approvalMode !== "advisory") {
    reasons.push("mutation verb detected");
    reasons.push(`approvalMode=${approvalMode}`);
    return { lane: "approval_required", label: ROUTE_LABEL.approval_required, target: ROUTE_TARGET.approval_required, reasons, mode };
  }
  if (mode === "deep" || PLANNING_RX.test(p)) {
    if (mode === "deep") reasons.push("Deep Mode active");
    if (PLANNING_RX.test(p)) reasons.push("planning verb detected");
    return { lane: "planning_deep", label: ROUTE_LABEL.planning_deep, target: ROUTE_TARGET.planning_deep, reasons, mode };
  }
  if (QUICK_RX.test(p) && p.length < 160) {
    reasons.push("short informational query");
    return { lane: "local_quick_action", label: ROUTE_LABEL.local_quick_action, target: ROUTE_TARGET.local_quick_action, reasons, mode };
  }
  reasons.push("default agent lane");
  return { lane: "raven_agent", label: ROUTE_LABEL.raven_agent, target: ROUTE_TARGET.raven_agent, reasons, mode };
}

/** Health check for the mode + context subsystem. Pure. */
export function healthCheck({ list, storageAvailable, modePersisted }) {
  const problems = [];
  if (!storageAvailable) problems.push("localStorage unavailable — mode will not persist across sessions.");
  if (!modePersisted) problems.push("No persisted mode found — defaulting to Fast.");
  const total = (list || []).length;
  const critical = (list || []).filter((r) => derivePriority(r) === "critical").length;
  const active = (list || []).filter((r) => derivePriority(r) === "active").length;
  return {
    ok: problems.length === 0,
    problems,
    counts: { total, critical, active },
  };
}
