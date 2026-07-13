// Pure, deterministic orchestration logic for the RAH Agent Team.
// Every function here is side-effect free and unit-testable in Node.
// UI/runtime wiring lives in orchestrationRuntime.ts.

export const TEAM_MODES = ["fast", "team_review", "full_council", "manual"];
export const MAX_CONCURRENT = 4;

// Deterministic keyword weights per specialist. Master Brain is excluded
// from routing — it always synthesizes and is never a "specialist".
const AGENT_KEYWORDS = {
  coder: [
    ["code", 3], ["bug", 3], ["error", 3], ["debug", 3], ["refactor", 3],
    ["api", 2], ["function", 2], ["class", 2], ["typescript", 3], ["javascript", 3],
    ["python", 3], ["react", 2], ["npm", 2], ["compile", 2], ["stack trace", 3],
    ["implement", 2], ["algorithm", 2], ["regex", 2], ["sql", 2],
  ],
  vision: [
    ["screenshot", 4], ["image", 3], ["screen", 2], ["diagram", 3], ["ui", 2],
    ["interface", 2], ["look at", 3], ["see this", 3], ["visual", 3],
    ["photo", 3], ["picture", 3], ["mockup", 3],
  ],
  research: [
    ["research", 4], ["find", 2], ["source", 2], ["cite", 3], ["evidence", 3],
    ["latest", 2], ["news", 2], ["study", 2], ["paper", 2], ["compare options", 2],
    ["benchmark", 2], ["market data", 3],
  ],
  designer: [
    ["design", 4], ["layout", 3], ["ux", 3], ["ui", 2], ["brand", 3],
    ["wireframe", 4], ["color", 2], ["style", 2], ["typography", 3],
    ["accessibility", 3], ["figma", 3], ["prototype", 2],
  ],
  engineer: [
    ["architecture", 4], ["system", 2], ["infrastructure", 3], ["scale", 3],
    ["performance", 3], ["deploy", 3], ["hardware", 3], ["latency", 2],
    ["throughput", 3], ["capacity", 3], ["reliability", 3],
  ],
  earth: [
    ["energy", 3], ["climate", 4], ["ecological", 4], ["carbon", 4],
    ["environment", 2], ["sustainability", 4], ["emissions", 4],
    ["renewable", 3], ["battery", 2], ["solar", 3], ["wind", 2],
  ],
  business: [
    ["cost", 3], ["price", 3], ["pricing", 3], ["market", 3], ["revenue", 3],
    ["business", 2], ["roi", 4], ["budget", 3], ["profit", 3], ["margin", 3],
    ["customer", 2], ["monetize", 3], ["saas", 2],
  ],
  guardian: [
    ["privacy", 4], ["secret", 3], ["gdpr", 4], ["pii", 4], ["security", 3],
    ["safe", 2], ["permission", 2], ["sensitive", 3], ["consent", 3],
    ["encrypt", 3], ["auth", 2], ["compliance", 3],
  ],
  action: [
    ["execute", 3], ["run this", 3], ["deploy", 2], ["launch", 3],
    ["checklist", 4], ["rollout", 3], ["steps to", 2], ["procedure", 3],
    ["automate", 3], ["schedule", 2],
  ],
};

const ALL_SPECIALIST_IDS = Object.keys(AGENT_KEYWORDS);

// Score every specialist against the prompt. Ties break by declaration order.
export function scoreSpecialists(prompt) {
  const p = String(prompt || "").toLowerCase();
  const scored = ALL_SPECIALIST_IDS.map((id, idx) => {
    let score = 0;
    for (const [kw, weight] of AGENT_KEYWORDS[id]) {
      if (p.includes(kw)) score += weight;
    }
    return { id, score, idx };
  });
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored;
}

// Choose specialists for a team-mode run. Master Brain never appears here.
export function pickSpecialists(prompt, teamMode, opts = {}) {
  const manual = (opts.manualSelection || []).filter((id) => id !== "brain");
  if (teamMode === "manual") return manual.slice(0, 5);
  if (teamMode === "fast") return manual.length ? manual.slice(0, 1) : ["coder"];

  const scored = scoreSpecialists(prompt).filter((s) => s.id !== "brain");
  const nonZero = scored.filter((s) => s.score > 0).map((s) => s.id);

  const defaults = ["coder", "research", "engineer", "designer", "guardian"];
  const targetMin = teamMode === "team_review" ? 2 : 3;
  const targetMax = teamMode === "team_review" ? 3 : 5;

  const picks = nonZero.slice(0, targetMax);
  for (const id of defaults) {
    if (picks.length >= targetMin) break;
    if (!picks.includes(id)) picks.push(id);
  }
  return picks.slice(0, targetMax);
}

export const TEAM_MODE_LABEL = {
  fast: "Fast Answer",
  team_review: "Team Review",
  full_council: "Full Council",
  manual: "Manual",
};

// Run tasks with bounded concurrency. Never throws — each task settles
// independently. Preserves input order in the returned array.
export async function runWithConcurrency(items, worker, opts = {}) {
  const limit = Math.max(1, Math.min(MAX_CONCURRENT, opts.concurrency || MAX_CONCURRENT));
  const signal = opts.signal;
  const results = new Array(items.length);
  let cursor = 0;
  let inFlight = 0;
  let peak = 0;
  async function pump() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      if (signal && signal.aborted) {
        results[idx] = { status: "cancelled", value: null };
        continue;
      }
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      try {
        const value = await worker(items[idx], idx);
        results[idx] = { status: "fulfilled", value };
      } catch (err) {
        results[idx] = { status: "rejected", reason: err };
      } finally {
        inFlight--;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, pump);
  await Promise.all(workers);
  results.peakInFlight = peak;
  return results;
}

// Deterministic runtime-identity line for a specialist card. Never
// generated by the model.
export function specialistRuntimeLine({ agentName, provider, model, engine, transport, latencyMs }) {
  const parts = [];
  parts.push(agentName || "Unknown");
  if (provider) parts.push(provider);
  if (model) parts.push(model);
  if (engine) parts.push(engine === "cloud" ? "cloud" : "local");
  if (transport) parts.push(transport === "bridge" ? "via Bridge" : "direct");
  if (typeof latencyMs === "number" && latencyMs >= 0) parts.push(latencyMs + "ms");
  return parts.join(" · ");
}

// Privacy label from the set of routes the orchestration will use.
export function privacyLabel(routes) {
  if (!routes || !routes.length) return "UNKNOWN";
  const engines = new Set(routes.map((r) => (r && r.engine) || "unknown"));
  const anyCloud = engines.has("cloud");
  const anyLocal = engines.has("lmstudio") || engines.has("ollama") || engines.has("demo");
  if (anyCloud && anyLocal) return "MIXED";
  if (anyCloud) return "CLOUD";
  if (anyLocal) return "LOCAL";
  return "UNKNOWN";
}

// Build the role-scoped user prompt for a single specialist. Only its own
// role instructions plus shared context — never the other specialists'
// definitions, to keep contexts small and independent.
export function buildSpecialistUserPrompt(userPrompt, ctx) {
  const lines = [];
  if (ctx && ctx.projectName) lines.push("Active project: " + ctx.projectName);
  if (ctx && ctx.projectGoals) lines.push("Project goals: " + ctx.projectGoals);
  if (ctx && ctx.projectMemoryBlock) lines.push(ctx.projectMemoryBlock);
  lines.push("");
  lines.push("User request:");
  lines.push(userPrompt);
  lines.push("");
  lines.push(
    "Respond ONLY from your specialist perspective. Do not synthesize across " +
    "specialists — Master Brain will do that. Keep the answer focused, cite " +
    "assumptions, and flag anything outside your role."
  );
  return lines.join("\n");
}

// Build the Master Brain synthesis prompt from completed specialist results.
export function buildSynthesisPrompt(userPrompt, taskStates) {
  const done = taskStates.filter((t) => t.state === "done");
  const failed = taskStates.filter((t) => t.state === "failed");
  const cancelled = taskStates.filter((t) => t.state === "cancelled");

  const parts = [
    "You are RAH Master Brain synthesizing the Agent Team's parallel outputs.",
    "",
    "USER REQUEST:",
    userPrompt,
    "",
    "SPECIALIST OUTPUTS (verbatim):",
  ];

  if (!done.length) {
    parts.push("(no specialist completed successfully)");
  } else {
    for (const t of done) {
      parts.push("");
      parts.push("### " + t.agentName + " — completed");
      parts.push(t.text || "(empty)");
    }
  }

  if (failed.length) {
    parts.push("");
    parts.push("SPECIALISTS THAT FAILED (do NOT pretend they contributed):");
    for (const t of failed) parts.push("- " + t.agentName + ": " + (t.error || "unknown error"));
  }
  if (cancelled.length) {
    parts.push("");
    parts.push("SPECIALISTS THAT WERE CANCELLED:");
    for (const t of cancelled) parts.push("- " + t.agentName);
  }

  parts.push("");
  parts.push("Produce ONE synthesis with EXACTLY these sections in this order:");
  parts.push("## Consensus");
  parts.push("## Disagreements");
  parts.push("## Risks");
  parts.push("## Recommended next action");
  parts.push("");
  parts.push(
    "Rules: cite specialists by name when quoting. Never invent a contribution " +
    "from a failed or cancelled specialist. If nothing completed, say so and " +
    "recommend a retry."
  );
  return parts.join("\n");
}

// Never save silently — the UI must call this and show the suggested card
// to the user before persisting.
export function buildTeamSummarySuggestion({ userPrompt, taskStates, synthesis, projectId }) {
  if (!synthesis || !taskStates || !taskStates.length) return null;
  const done = taskStates.filter((t) => t.state === "done").map((t) => t.agentName);
  const title = userPrompt.length > 80 ? userPrompt.slice(0, 80) + "…" : userPrompt;
  return {
    _suggestion: true,
    draft: {
      projectId: projectId == null ? null : projectId,
      title: "Team run: " + title,
      content: [
        "Specialists that completed: " + (done.join(", ") || "(none)"),
        "",
        synthesis,
      ].join("\n"),
      type: "note",
      tags: ["team-run", "orchestration"],
      source: "Agent Team synthesis",
      archived: false,
      pinned: false,
    },
  };
}

// Diagnostics event log: never include prompt or memory text — counts/IDs only.
const SAFE_STRING_FIELDS = new Set([
  "agentId", "agentName", "state", "runId", "provider", "model",
  "engine", "transport", "teamMode", "privacy", "errorCode", "kind",
]);
export function makeEventLogger() {
  const events = [];
  return {
    events,
    log(kind, payload) {
      const safe = { kind };
      const p = payload || {};
      for (const k of Object.keys(p)) {
        const v = p[k];
        if (typeof v === "string") {
          if (SAFE_STRING_FIELDS.has(k)) safe[k] = v;
          else safe[k] = "[len:" + v.length + "]";
        } else if (typeof v === "number" || typeof v === "boolean" || v == null) {
          safe[k] = v;
        } else if (Array.isArray(v)) {
          safe[k] = { count: v.length };
        }
      }
      events.push({ ts: Date.now(), ...safe });
    },
  };
}

// Failure isolation helper: never throw upward from settled results.
export function isolateFailures(settledResults) {
  return settledResults.map((r, i) => ({
    index: i,
    ok: r && r.status === "fulfilled",
    failed: r && r.status === "rejected",
    cancelled: r && r.status === "cancelled",
    value: (r && r.value) || null,
    reason: r && r.reason ? (r.reason.message || String(r.reason)) : null,
  }));
}

// The rules the runtime & UI must honor — asserted by tests.
export const ORCHESTRATION_INVARIANTS = Object.freeze({
  maxConcurrent: MAX_CONCURRENT,
  masterBrainNeverSpecialist: true,
  synthesisNeverForgesResults: true,
  neverPersistIntermediateSpecialistOutputs: true,
  saveTeamSummaryRequiresExplicitConfirm: true,
  approvalCardsRequiredForSideEffects: true,
  runtimeIdentityGeneratedByApp: true,
});
