// Deterministic core for Raven One workflows.
// Pure helpers so state machine, validation, dry-run, context selection
// and the hash-chained event log are unit-testable in Node.

export const WORKFLOW_VERSION = 1;

export const STEP_TYPES = [
  "ai_prompt","save_memory","chronicle_entry",
  "bridge_read_file","bridge_write_file","bridge_launch_url","bridge_launch_app",
  "wait_manual","final_summary",
];

export const STEP_CATALOG = {
  ai_prompt:         { label: "AI Prompt / Agent Team", category: "ai",       sideEffect: false, requiresApproval: false, requiresBridgeCapability: null,             risk: "low" },
  save_memory:       { label: "Save to Project Memory", category: "memory",   sideEffect: true,  requiresApproval: true,  requiresBridgeCapability: null,             risk: "low" },
  chronicle_entry:   { label: "Create Chronicle Entry", category: "chronicle",sideEffect: true,  requiresApproval: true,  requiresBridgeCapability: null,             risk: "low" },
  bridge_read_file:  { label: "Read File (Bridge)",     category: "bridge",   sideEffect: false, requiresApproval: false, requiresBridgeCapability: "files.readText", risk: "low" },
  // Backwards-compat step type name; the visible action is Copy File.
  // The bridge protocol implements files.copy, not arbitrary write-text.
  bridge_write_file: { label: "Copy File (Bridge)",     category: "bridge",   sideEffect: true,  requiresApproval: true,  requiresBridgeCapability: "files.copy",     risk: "medium" },
  bridge_launch_url: { label: "Open URL (Bridge)",      category: "bridge",   sideEffect: true,  requiresApproval: true,  requiresBridgeCapability: "launch.url",     risk: "low" },
  bridge_launch_app: { label: "Launch App (Bridge)",    category: "bridge",   sideEffect: true,  requiresApproval: true,  requiresBridgeCapability: "launch.program", risk: "high" },
  wait_manual:       { label: "Manual Checkpoint",      category: "control",  sideEffect: false, requiresApproval: false, requiresBridgeCapability: null,             risk: "low" },
  final_summary:     { label: "Final Summary",          category: "ai",       sideEffect: false, requiresApproval: false, requiresBridgeCapability: null,             risk: "low" },
};

export const EXECUTION_PROFILES = ["fast", "deep"];

export const RUN_STATES = ["draft","queued","awaiting_approval","running","paused","completed","failed","cancelled"];
export const TERMINAL_STATES = ["completed","failed","cancelled"];

const TRANSITIONS = {
  draft:             ["queued","cancelled"],
  queued:            ["awaiting_approval","running","cancelled","failed"],
  awaiting_approval: ["running","paused","cancelled","failed"],
  running:           ["awaiting_approval","paused","completed","failed","cancelled"],
  paused:            ["running","awaiting_approval","cancelled","failed"],
  completed:         [],
  failed:            ["queued","cancelled"],
  cancelled:         [],
};

export function canTransition(from, to) { return Boolean(TRANSITIONS[from]?.includes(to)); }

export function transitionRun(run, next, meta = {}) {
  if (!canTransition(run.status, next)) throw new Error(`invalid transition ${run.status} -> ${next}`);
  const now = meta.now ?? Date.now();
  const patch = { status: next };
  if (next === "running" && !run.startedAt) patch.startedAt = now;
  if (TERMINAL_STATES.includes(next)) patch.finishedAt = now;
  if (next === "queued" && run.status === "failed") patch.failureReason = null;
  return { ...run, ...patch };
}

export function availableControls(status) {
  switch (status) {
    case "draft":
    case "queued":             return ["run","dryRun","cancel"];
    case "awaiting_approval":  return ["cancel"];
    case "running":            return ["pause","cancel"];
    case "paused":             return ["resume","cancel"];
    case "failed":             return ["retry","startNew"];
    case "completed":
    case "cancelled":          return ["startNew"];
    default:                   return [];
  }
}

export function validateWorkflow(w) {
  const errors = [], warnings = [];
  if (!w || typeof w !== "object") return { ok: false, errors: ["workflow missing"], warnings };
  if (!w.name || !String(w.name).trim()) errors.push("Name is required");
  if (!Array.isArray(w.steps) || w.steps.length === 0) errors.push("At least one step is required");
  if (!EXECUTION_PROFILES.includes(w.executionProfile)) errors.push(`executionProfile must be one of ${EXECUTION_PROFILES.join(", ")}`);
  const ids = new Set();
  (w.steps ?? []).forEach((s, i) => {
    if (!s?.id) errors.push(`step ${i + 1}: missing id`);
    else if (ids.has(s.id)) errors.push(`step ${i + 1}: duplicate id ${s.id}`);
    ids.add(s?.id);
    const cat = STEP_CATALOG[s?.type];
    if (!cat) { errors.push(`step ${i + 1}: unknown type ${s?.type}`); return; }
    if (s.type === "ai_prompt"        && !s.config?.prompt?.trim()) errors.push(`step ${i + 1}: prompt is required`);
    if (s.type === "save_memory"      && !s.config?.title?.trim())  errors.push(`step ${i + 1}: memory title required`);
    if (s.type === "chronicle_entry"  && !s.config?.title?.trim())  errors.push(`step ${i + 1}: chronicle title required`);
    if (s.type === "bridge_read_file" && !s.config?.path?.trim())   errors.push(`step ${i + 1}: path required`);
    if (s.type === "bridge_write_file") {
      // Copy File requires an explicit source and destination. Legacy
      // workflows stored only `path` (destination); those are blocked
      // honestly rather than silently copying a file onto itself.
      const dest = (s.config?.dest ?? s.config?.path);
      if (!dest || !String(dest).trim()) errors.push(`step ${i + 1}: destination path required`);
      if (!s.config?.source || !String(s.config.source).trim()) {
        errors.push(`step ${i + 1}: source path required (Copy File needs source and destination)`);
      } else if (dest && String(s.config.source).trim() === String(dest).trim()) {
        errors.push(`step ${i + 1}: source and destination must differ`);
      }
    }
    if (s.type === "bridge_launch_url"&& !s.config?.url?.trim())    errors.push(`step ${i + 1}: url required`);
    if (s.type === "bridge_launch_url"&& s.config?.url && !/^https:\/\//i.test(s.config.url)) errors.push(`step ${i + 1}: url must be https://`);
    if (s.type === "bridge_launch_app"&& !s.config?.program?.trim())errors.push(`step ${i + 1}: program required`);
  });
  if ((w.steps ?? []).some((s) => STEP_CATALOG[s?.type]?.sideEffect)) {
    warnings.push("Workflow contains side-effecting steps; each will require approval unless a trusted-low-risk policy applies.");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function planDryRun(workflow, ctx = {}) {
  const validation = validateWorkflow(workflow);
  const bridge = ctx.bridge ?? { status: "unknown", features: [], capabilities: [] };
  const steps = (workflow?.steps ?? []).map((s, i) => {
    const cat = STEP_CATALOG[s.type] ?? { label: s.type, sideEffect: false, requiresApproval: false, requiresBridgeCapability: null, risk: "low" };
    let blocked = false, blockedReason = null;
    if (cat.requiresBridgeCapability) {
      if (!bridge || typeof bridge !== "object") {
        blocked = true;
        blockedReason = `Bridge status unknown — ${cat.requiresBridgeCapability} denied by default`;
      } else if (bridge.status !== "paired_online") {
        blocked = true;
        blockedReason = `Bridge ${bridge.status ?? "unknown"} — ${cat.requiresBridgeCapability} unavailable`;
      }
      else if (!Array.isArray(bridge.capabilities) || bridge.capabilities.length === 0) {
        // Deny-by-default. Unknown / empty capability data must never permit.
        blocked = true;
        blockedReason = `Bridge capability unknown — ${cat.requiresBridgeCapability} denied by default`;
      } else if (!bridge.capabilities.includes(cat.requiresBridgeCapability)) {
        blocked = true; blockedReason = `Bridge missing capability ${cat.requiresBridgeCapability}`;
      }
    }
    return {
      index: i, id: s.id, type: s.type, label: cat.label,
      sideEffect: !!cat.sideEffect, requiresApproval: !!cat.requiresApproval,
      requiresBridgeCapability: cat.requiresBridgeCapability, risk: cat.risk,
      blocked, blockedReason, preview: previewStep(s),
    };
  });
  return { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, steps, dryRun: true };
}

function previewStep(s) {
  switch (s.type) {
    case "ai_prompt":        return truncate(s.config?.prompt ?? "");
    case "save_memory":      return `Would save memory: ${s.config?.title ?? ""}`;
    case "chronicle_entry":  return `Would log chronicle: ${s.config?.title ?? ""}`;
    case "bridge_read_file": return `Would read: ${s.config?.path ?? ""}`;
    case "bridge_write_file": {
      const dest = s.config?.dest ?? s.config?.path ?? "";
      const src = s.config?.source ?? "";
      return `Would copy: ${src || "(source missing)"} → ${dest || "(destination missing)"}`;
    }
    case "bridge_launch_url":return `Would open URL: ${s.config?.url ?? ""}`;
    case "bridge_launch_app":return `Would launch program: ${s.config?.program ?? ""}`;
    case "wait_manual":      return `Pause for manual checkpoint: ${s.config?.note ?? ""}`;
    case "final_summary":    return "Summarize run";
    default:                 return "";
  }
}
function truncate(s, n = 140) { return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; }

export function selectRunContext(workflow, sources = {}) {
  const profile = workflow?.executionProfile === "deep" ? "deep" : "fast";
  const projectId = workflow?.projectId ?? null;
  const project = (sources.projects ?? []).find((p) => p.id === projectId) ?? null;
  const memoryAll = (sources.projectMemory ?? []).filter((m) => !m.archived);
  if (profile === "fast") {
    const memory = memoryAll.filter((m) => m.pinned && (!projectId || m.projectId === projectId || m.projectId == null)).slice(0, 3);
    return { profile, project, memory, includeFullDna: false };
  }
  const memory = memoryAll
    .filter((m) => !projectId || m.projectId === projectId || m.projectId == null)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    .slice(0, 20);
  return { profile, project, memory, includeFullDna: true };
}

// ─── Hash-chained event log ────────────────────────────────────────────
async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto subtle unavailable");
  const buf = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function appendEvent(events, evt) {
  const seq = events.length ? events[events.length - 1].seq + 1 : 1;
  const prevHash = events.length ? events[events.length - 1].hash : "GENESIS";
  const now = evt.ts ?? (evt.now ?? Date.now());
  const idSeed = evt.id
    ?? (typeof evt.rng === "function" ? evt.rng() : Math.random().toString(36).slice(2, 8));
  const base = {
    id: evt.id ?? `evt_${seq}_${String(idSeed).replace(/-/g, "").slice(0, 8)}`,
    seq, ts: now,
    runId: evt.runId, workflowId: evt.workflowId,
    type: evt.type, actor: evt.actor ?? "system",
    prevState: evt.prevState ?? null, nextState: evt.nextState ?? null,
    stepId: evt.stepId ?? null, metadata: sanitizeMeta(evt.metadata),
    prevHash,
  };
  const hash = await sha256Hex(JSON.stringify(base));
  return [...events, { ...base, hash }];
}

export async function verifyEventChain(events) {
  const problems = [];
  let prevHash = "GENESIS";
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1) problems.push({ index: i, error: "seq mismatch" });
    if (e.prevHash !== prevHash) problems.push({ index: i, error: "prevHash mismatch" });
    const { hash, ...base } = e;
    const expected = await sha256Hex(JSON.stringify(base));
    if (expected !== hash) problems.push({ index: i, error: "hash mismatch" });
    prevHash = e.hash;
  }
  return { ok: problems.length === 0, problems };
}

function sanitizeMeta(m) {
  if (m == null) return null;
  try { return JSON.parse(JSON.stringify(m)); } catch { return null; }
}

// ─── Factories ────────────────────────────────────────────────────────
export function createWorkflow(partial = {}) {
  const now = Date.now();
  return {
    id: partial.id ?? uid("wf"),
    name: partial.name ?? "Untitled workflow",
    description: partial.description ?? "",
    projectId: partial.projectId ?? null,
    enabled: partial.enabled ?? true,
    executionProfile: partial.executionProfile ?? "fast",
    trigger: partial.trigger ?? { kind: "manual" },
    steps: partial.steps ?? [],
    tags: partial.tags ?? [],
    lastRunAt: partial.lastRunAt ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    version: partial.version ?? WORKFLOW_VERSION,
  };
}

export function createStep(type, config = {}) {
  if (!STEP_CATALOG[type]) throw new Error(`unknown step type ${type}`);
  return { id: uid("st"), type, config };
}

export function createRun(workflow, opts = {}) {
  const now = opts.now ?? Date.now();
  return {
    runId: opts.runId ?? uid("run"),
    workflowId: workflow.id,
    workflowVersion: workflow.version ?? WORKFLOW_VERSION,
    status: "draft",
    currentStepIndex: 0,
    startedAt: null,
    finishedAt: null,
    dryRun: !!opts.dryRun,
    engine: opts.engine ?? null,
    provider: opts.provider ?? null,
    model: opts.model ?? null,
    transport: opts.transport ?? null,
    stepResults: [],
    approvalIds: [],
    failureReason: null,
    events: [],
    createdAt: now,
  };
}

function uid(prefix) {
  const rand = (globalThis.crypto?.randomUUID?.() ?? (Math.random().toString(36).slice(2) + Date.now().toString(36)));
  return `${prefix}_${String(rand).replace(/-/g, "").slice(0, 16)}`;
}

// ─── Import / Export ──────────────────────────────────────────────────
export function exportWorkflowJson(w) {
  const { id: _id, createdAt: _c, updatedAt: _u, lastRunAt: _l, ...rest } = w;
  void _id; void _c; void _u; void _l;
  return JSON.stringify({ ravenWorkflow: 1, workflow: rest }, null, 2);
}

export function importWorkflowJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.ravenWorkflow !== 1 || !parsed.workflow) throw new Error("Not a Raven workflow export");
  const wf = createWorkflow(parsed.workflow);
  const v = validateWorkflow(wf);
  if (!v.ok) throw new Error("Imported workflow invalid: " + v.errors.join("; "));
  return wf;
}

export const _internals = { sha256Hex };
