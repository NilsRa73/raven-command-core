// AI Council Jobs — typed state machine + deterministic Project Review
// synthesis. Pure JS module so it can be exercised in node --test.
//
// A CouncilJob has ordered steps assigned to specialist roles. Every
// state change is validated by `canTransition`; illegal transitions
// throw. Persistence is handled by the caller (IDB stores councilJobs
// and councilJobSteps in db.ts) so this module stays framework-free.

export const COUNCIL_ROLES = [
  "orchestrator", "researcher", "designer",
  "builder", "tester", "memory_governance",
];

export const JOB_STATUSES = [
  "draft", "queued", "running", "awaiting_approval",
  "testing", "completed", "blocked", "failed", "cancelled",
];

/** Directed transition graph. Terminal states have no outgoing edges. */
export const TRANSITIONS = {
  draft:               ["queued", "cancelled"],
  queued:              ["running", "cancelled"],
  running:             ["awaiting_approval", "testing", "completed", "blocked", "failed", "cancelled"],
  awaiting_approval:   ["running", "cancelled", "failed"],
  testing:             ["completed", "failed", "blocked", "running"],
  blocked:             ["running", "queued", "cancelled"],
  failed:              ["queued", "cancelled"],
  completed:           [],
  cancelled:           [],
};

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal council transition: ${from} → ${to}`);
  }
}

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/** Project Review workflow — the six-step orchestration template. */
export function projectReviewSteps(jobId, now = Date.now()) {
  const mk = (order, role, title, deps = [], requiresApproval = false, risk = "low") => ({
    id: uid("cjs"), jobId, role, order, title,
    status: "draft", createdAt: now, updatedAt: now,
    dependencies: deps, requiresApproval, riskLevel: risk,
  });
  const s1 = mk(1, "orchestrator", "Collect project state & recent activity");
  const s2 = mk(2, "researcher",   "Grounded findings from local data only", [s1.id]);
  const s3 = mk(3, "designer",     "UI / product implications brief",         [s2.id]);
  const s4 = mk(4, "builder",      "Implementation task list & risk review",  [s3.id]);
  const s5 = mk(5, "tester",       "Acceptance criteria & verification",      [s4.id]);
  const s6 = mk(6, "memory_governance", "Save to Project Memory + checkpoint", [s5.id], true, "low");
  return [s1, s2, s3, s4, s5, s6];
}

/** Create a new job in `draft` state. */
export function createJob(input) {
  const now = Date.now();
  const id = uid("cj");
  const kind = input.kind || "project_review";
  const job = {
    id,
    projectId: input.projectId ?? null,
    sessionId: input.sessionId ?? null,
    kind,
    objective: (input.objective || "").trim() || "Project review & next build plan",
    status: "draft",
    createdAt: now, updatedAt: now,
    currentStepId: null,
    provider: input.provider || "deterministic",
    approvalIds: [],
    resumeRoute: input.resumeRoute || "/council",
  };
  const steps = kind === "project_review" ? projectReviewSteps(id, now) : [];
  return { job, steps };
}

/** Apply a transition; returns the updated job (throws on illegal). */
export function transitionJob(job, to, patch = {}) {
  assertTransition(job.status, to);
  return { ...job, ...patch, status: to, updatedAt: Date.now() };
}
export function transitionStep(step, to, patch = {}) {
  assertTransition(step.status, to);
  return { ...step, ...patch, status: to, updatedAt: Date.now() };
}

// ── Deterministic Project Review synthesis ────────────────────────────
// Purely local: never fabricates external research. Every section cites
// which local store it came from. Stable output for the same input.

function trunc(s, n = 200) {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export function synthesizeProjectReview(ctx) {
  const project = ctx.project || null;
  const sessions = ctx.sessions || [];
  const checkpoints = ctx.checkpoints || [];
  const memory = ctx.memory || [];
  const decisions = ctx.decisions || [];
  const commands = ctx.commands || [];
  const roadmap = ctx.roadmap || [];

  const pName = project?.name || "(no active project)";
  const activeSession = sessions.find((s) => s.status === "active") || sessions[0] || null;
  const latestCp = checkpoints[0] || null;
  const pinned = memory.filter((m) => m.pinned && !m.archived);
  const blockers = memory.filter((m) => /blocker/i.test(String(m.type ?? m.tags ?? "")));
  const openRoadmap = roadmap.filter((r) => r.status !== "done").slice(0, 5);
  const recentCommands = commands.slice(0, 5);

  const findings = {
    orchestrator: [
      `Active project: ${pName}${project?.status ? ` (${project.status})` : ""}.`,
      activeSession
        ? `Active session "${activeSession.title}" — objective: ${activeSession.objective || "(none)"}.`
        : "No active work session.",
      latestCp ? `Latest checkpoint: ${latestCp.note} → next: ${latestCp.nextAction || "(unspecified)"}.` : "No checkpoints yet.",
      `Local signals: ${sessions.length} sessions, ${checkpoints.length} checkpoints, ${memory.length} memory rows, ${decisions.length} decisions, ${roadmap.length} roadmap items, ${commands.length} recent commands.`,
    ],
    researcher: [
      pinned.length
        ? "Pinned memory: " + pinned.slice(0, 5).map((m) => `• ${trunc(m.title, 80)}`).join(" ")
        : "No pinned memory yet — Researcher has nothing external to cite.",
      decisions.length
        ? "Recent decisions: " + decisions.slice(0, 3).map((d) => `• ${trunc(d.title, 80)}`).join(" ")
        : "No decisions recorded.",
      "Findings are local-only; no external sources were consulted.",
    ],
    designer: [
      project?.description ? `Product framing: ${trunc(project.description, 200)}` : "No product description on file.",
      openRoadmap.length
        ? "Open roadmap surfaces UI implications for: " + openRoadmap.map((r) => trunc(r.title, 60)).join("; ")
        : "No open roadmap items → no immediate UI implications.",
    ],
    builder: {
      tasks: [
        latestCp?.nextAction && `Continue: ${latestCp.nextAction}`,
        project?.currentTask && `In progress: ${project.currentTask}`,
        project?.nextTask && `Next: ${project.nextTask}`,
        ...openRoadmap.slice(0, 3).map((r) => `Roadmap: ${trunc(r.title, 80)}`),
      ].filter(Boolean),
      risk: blockers.length ? "medium" : (openRoadmap.length > 3 ? "medium" : "low"),
      fileTargets: [], // No file edits are proposed by the Project Review workflow itself.
    },
    tester: {
      acceptance: [
        "Continue Yesterday resumes the correct session and route.",
        "New checkpoint persists across reload.",
        "No memory row is added without explicit user confirmation.",
        latestCp?.nextAction ? `Verify: ${latestCp.nextAction}` : "Verify the top proposed builder task manually.",
      ],
      checks: ["Run desktop-bridge test suite", "Run TypeScript check", "Confirm no illegal state transitions in audit"],
    },
    memory_governance: {
      willSaveMemory: true,
      willCheckpoint: true,
      summary: `Project Review for ${pName} — ${new Date().toISOString().slice(0, 10)}.`,
    },
  };

  const outputByStepOrder = {
    1: findings.orchestrator.join("\n"),
    2: findings.researcher.join("\n"),
    3: findings.designer.join("\n"),
    4: `Tasks:\n- ${findings.builder.tasks.join("\n- ") || "(no concrete tasks — clarify with the user)"}\n\nRisk: ${findings.builder.risk}`,
    5: `Acceptance:\n- ${findings.tester.acceptance.join("\n- ")}\n\nChecks:\n- ${findings.tester.checks.join("\n- ")}`,
    6: findings.memory_governance.summary,
  };

  return { findings, outputByStepOrder, deterministic: true };
}

/** Derive Mission Control task-queue rows from council jobs. */
export function deriveCouncilQueue(jobs, limit = 8) {
  const active = (jobs || []).filter((j) =>
    j && j.status !== "completed" && j.status !== "cancelled",
  );
  const prio = { running: 0, awaiting_approval: 1, testing: 2, queued: 3, blocked: 4, failed: 5, draft: 6 };
  active.sort((a, b) => (prio[a.status] ?? 9) - (prio[b.status] ?? 9) || b.updatedAt - a.updatedAt);
  return active.slice(0, limit).map((j) => ({
    id: j.id,
    status: j.status === "awaiting_approval" ? "awaiting_approval"
          : j.status === "failed" ? "failed"
          : j.status === "completed" ? "completed"
          : j.status === "running" ? "running" : "queued",
    title: "Council: " + (j.objective || "Untitled job"),
    createdAt: j.createdAt,
    source: "council",
  }));
}

/** Seed example jobs when the store is empty. Never overwrites user data. */
export function seedCouncilJobsIfEmpty(existing) {
  if ((existing || []).length > 0) return null;
  const { job, steps } = createJob({
    kind: "project_review",
    objective: "Project Review & Next Build Plan — Raven Command",
    provider: "deterministic",
  });
  return { job, steps };
}