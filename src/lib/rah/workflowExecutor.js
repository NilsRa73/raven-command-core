// Deterministic, dependency-injected workflow executor.
//
// This module is intentionally free of React and IndexedDB. All I/O is
// injected via `deps` so it is unit-testable in Node and re-usable by any
// runtime that satisfies the contract below.
//
// deps = {
//   loadRun(runId)                                 -> WorkflowRun | null
//   saveRun(run)                                   -> void        // persist after every mutation
//   loadWorkflow(workflowId)                       -> Workflow | null
//   requestApproval({run, step, index, ...})       -> Approval    // returns pending approval
//   loadApproval(approvalId)                       -> Approval | null
//   ai({prompt, systemExtra, signal, mode})        -> {text, provider, model, transport, latencyMs, usage}
//   memory.save({title, content, projectId, tags}) -> void        // only called after approval
//   chronicle.log({title, detail, projectId})      -> void        // only called after approval
//   bridge.status()                                -> {status, capabilities}
//   bridge.readFile(path)                          -> {text, size}
//   bridge.writeFile(path, source?)                -> {ok}        // uses files.copy capability
//   bridge.launchUrl(url)                          -> {ok}
//   bridge.launchApp(program)                      -> {ok}
//   now()                                          -> number
//   rng()                                          -> string      // deterministic random for event ids
// }

import {
  STEP_CATALOG, TERMINAL_STATES,
  transitionRun, appendEvent, canTransition,
} from "./workflow.js";

/**
 * Registry of active AbortControllers per runId. Emergency stop and cancel
 * call `abortRun(runId)` to interrupt in-flight AI calls.
 */
const controllers = new Map();
export function abortRun(runId) {
  const c = controllers.get(runId);
  if (c) { try { c.abort(); } catch { /* ignore */ } }
}
export function isRunning(runId) { return controllers.has(runId); }

function nowFn(deps) { return typeof deps.now === "function" ? deps.now() : Date.now(); }
function rngFn(deps) { return typeof deps.rng === "function" ? deps.rng() : Math.random().toString(36).slice(2, 8); }

async function logEvent(run, deps, evt) {
  run.events = await appendEvent(run.events, {
    ...evt,
    runId: run.runId, workflowId: run.workflowId,
    ts: nowFn(deps), rng: () => rngFn(deps),
  });
  return run;
}

async function transitionAndLog(run, deps, next, evtType, meta) {
  const prev = run.status;
  const moved = transitionRun(run, next, { now: nowFn(deps) });
  moved.events = run.events;
  await logEvent(moved, deps, { type: evtType, prevState: prev, nextState: next, metadata: meta ?? null });
  await deps.saveRun(moved);
  return moved;
}

function recordStepResult(run, stepId, patch) {
  const existing = run.stepResults.find((r) => r.stepId === stepId);
  if (existing) Object.assign(existing, patch);
  else run.stepResults.push({ stepId, status: "ok", startedAt: patch.startedAt ?? Date.now(), ...patch });
  return run;
}

/**
 * Start (or resume) a run's sequential execution loop.
 *
 * Contract:
 *   - Only one loop per runId at a time (protected by controllers map).
 *   - Reads latest run state from deps.loadRun before every step so paused
 *     / cancelled / awaiting_approval decisions land safely across reloads.
 *   - Never executes a side-effect step without a matching approval record
 *     in the "approved" state that names this run + step.
 */
export async function runWorkflow(runId, deps) {
  if (controllers.has(runId)) return; // already running
  const controller = new AbortController();
  controllers.set(runId, controller);
  try {
    let run = await deps.loadRun(runId);
    if (!run) return;
    const wf = await deps.loadWorkflow(run.workflowId);
    if (!wf) throw new Error("workflow missing");

    if (run.status === "queued" || run.status === "awaiting_approval") {
      if (canTransition(run.status, "running")) {
        run = await transitionAndLog(run, deps, "running", "run.started");
      }
    }

    while (run.currentStepIndex < wf.steps.length) {
      // Re-load in case an external actor mutated the run (pause/cancel/approval).
      run = await deps.loadRun(runId);
      if (!run || TERMINAL_STATES.includes(run.status)) return;
      if (run.status === "paused" || run.status === "awaiting_approval") return;
      if (controller.signal.aborted) return;

      const step = wf.steps[run.currentStepIndex];
      const cat = STEP_CATALOG[step.type];

      // Dry run: log a preview event, do nothing side-effecting, advance.
      if (run.dryRun) {
        await logEvent(run, deps, {
          type: "step.dry_run", stepId: step.id,
          metadata: { index: run.currentStepIndex, type: step.type },
        });
        recordStepResult(run, step.id, { status: "skipped", startedAt: nowFn(deps), finishedAt: nowFn(deps) });
        run.currentStepIndex += 1;
        await deps.saveRun(run);
        continue;
      }

      // Manual checkpoint always pauses.
      if (step.type === "wait_manual") {
        await logEvent(run, deps, {
          type: "step.manual_checkpoint", stepId: step.id,
          metadata: { note: step.config?.note ?? null },
        });
        run = await transitionAndLog(run, deps, "paused", "run.paused", { reason: "manual_checkpoint", stepId: step.id });
        return;
      }

      // Per-step approval gating.
      if (cat?.requiresApproval) {
        const priorApprovalId = run.stepApprovals?.[step.id];
        const priorApproval = priorApprovalId ? await deps.loadApproval(priorApprovalId) : null;
        if (!priorApproval || priorApproval.status !== "approved") {
          // Rejected/cancelled: fail the run permanently.
          if (priorApproval && (priorApproval.status === "rejected" || priorApproval.status === "cancelled")) {
            recordStepResult(run, step.id, {
              status: "blocked", startedAt: nowFn(deps), finishedAt: nowFn(deps),
              error: `approval ${priorApproval.status}`, approvalId: priorApproval.id,
            });
            run.failureReason = `Step "${step.id}" ${priorApproval.status} by user.`;
            run = await transitionAndLog(run, deps, priorApproval.status === "cancelled" ? "cancelled" : "failed",
              priorApproval.status === "cancelled" ? "run.cancelled" : "run.failed",
              { stepId: step.id, approvalId: priorApproval.id });
            return;
          }
          // No approval yet — request one, pause the loop.
          const approval = await deps.requestApproval({ run, step, index: run.currentStepIndex, workflow: wf });
          run.stepApprovals = { ...(run.stepApprovals ?? {}), [step.id]: approval.id };
          run.approvalIds = Array.from(new Set([...(run.approvalIds ?? []), approval.id]));
          await logEvent(run, deps, {
            type: "approval.requested", stepId: step.id,
            metadata: { approvalId: approval.id, capability: cat.requiresBridgeCapability, risk: cat.risk },
          });
          run = await transitionAndLog(run, deps, "awaiting_approval", "run.awaiting_approval",
            { stepId: step.id, approvalId: approval.id });
          return;
        }
        // We hold a valid approval — log it and proceed.
        await logEvent(run, deps, {
          type: "approval.granted", stepId: step.id,
          metadata: { approvalId: priorApproval.id },
        });
      }

      const startedAt = nowFn(deps);
      recordStepResult(run, step.id, { status: "ok", startedAt });
      await deps.saveRun(run);

      try {
        const output = await executeStep(step, wf, run, deps, controller.signal);
        recordStepResult(run, step.id, {
          status: "ok", startedAt, finishedAt: nowFn(deps),
          output: output?.text ?? null,
          route: output?.route ?? null,
        });
        await logEvent(run, deps, {
          type: "step.completed", stepId: step.id,
          metadata: {
            type: step.type,
            provider: output?.route?.provider ?? null,
            model: output?.route?.model ?? null,
            transport: output?.route?.transport ?? null,
            latencyMs: output?.route?.latencyMs ?? null,
          },
        });
        run.currentStepIndex += 1;
        // Capture engine/route metadata on first AI step.
        if (output?.route && !run.provider) {
          run.provider = output.route.provider ?? null;
          run.model = output.route.model ?? null;
          run.transport = output.route.transport ?? null;
          run.engine = output.route.engine ?? null;
        }
        await deps.saveRun(run);
      } catch (err) {
        if (controller.signal.aborted) {
          recordStepResult(run, step.id, {
            status: "failed", startedAt, finishedAt: nowFn(deps), error: "aborted",
          });
          run.failureReason = "aborted";
          run = await transitionAndLog(run, deps, "cancelled", "run.cancelled", { stepId: step.id, reason: "abort" });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        recordStepResult(run, step.id, { status: "failed", startedAt, finishedAt: nowFn(deps), error: msg });
        run.failureReason = msg;
        await logEvent(run, deps, { type: "step.failed", stepId: step.id, metadata: { error: msg } });
        run = await transitionAndLog(run, deps, "failed", "run.failed", { stepId: step.id, error: msg });
        return;
      }
    }

    run = await transitionAndLog(run, deps, "completed", "run.completed");
  } finally {
    controllers.delete(runId);
  }
}

/**
 * Execute one step. Returns `{text, route}` where route carries the AI
 * provider/model/transport when applicable.
 */
async function executeStep(step, wf, run, deps, signal) {
  const cfg = step.config ?? {};
  switch (step.type) {
    case "ai_prompt":
    case "final_summary": {
      if (!deps.ai) throw new Error("no AI executor available");
      const res = await deps.ai({
        prompt: cfg.prompt ?? "",
        systemExtra: buildContextExtra(wf, run, deps),
        signal, mode: wf.executionProfile === "deep" ? "deep_project" : "fast",
      });
      return { text: res.text, route: {
        provider: res.provider ?? null, model: res.model ?? null,
        transport: res.transport ?? null, engine: res.engine ?? null,
        latencyMs: res.latencyMs ?? null,
      } };
    }
    case "save_memory": {
      const lastAi = [...run.stepResults].reverse().find((r) => r.output);
      await deps.memory.save({
        title: cfg.title ?? "(untitled)",
        content: cfg.content?.trim() || lastAi?.output || "",
        projectId: wf.projectId ?? null,
        tags: Array.isArray(wf.tags) ? wf.tags : [],
      });
      return { text: `Saved memory: ${cfg.title ?? ""}` };
    }
    case "chronicle_entry": {
      await deps.chronicle.log({
        title: cfg.title ?? "(untitled)",
        detail: cfg.content ?? "",
        projectId: wf.projectId ?? null,
      });
      return { text: `Logged chronicle: ${cfg.title ?? ""}` };
    }
    case "bridge_read_file": {
      const st = await deps.bridge.status();
      assertBridgeCapability(st, "files.readText");
      const r = await deps.bridge.readFile(cfg.path);
      return { text: r.text ?? "" };
    }
    case "bridge_write_file": {
      const st = await deps.bridge.status();
      assertBridgeCapability(st, "files.copy");
      const r = await deps.bridge.writeFile(cfg.path, cfg.source);
      return { text: `wrote ${cfg.path} (${r?.ok ? "ok" : "?"})` };
    }
    case "bridge_launch_url": {
      const st = await deps.bridge.status();
      assertBridgeCapability(st, "launch.url");
      if (!/^https:\/\//i.test(cfg.url ?? "")) throw new Error("URL must be https://");
      await deps.bridge.launchUrl(cfg.url);
      return { text: `launched ${cfg.url}` };
    }
    case "bridge_launch_app": {
      const st = await deps.bridge.status();
      assertBridgeCapability(st, "launch.program");
      await deps.bridge.launchApp(cfg.program);
      return { text: `launched ${cfg.program}` };
    }
    default:
      throw new Error(`unknown step type ${step.type}`);
  }
}

function assertBridgeCapability(st, cap) {
  if (!st || st.status !== "paired_online") throw new Error(`Bridge offline — ${cap} unavailable`);
  if (Array.isArray(st.capabilities) && st.capabilities.length && !st.capabilities.includes(cap)) {
    throw new Error(`Bridge missing capability ${cap}`);
  }
}

function buildContextExtra(wf, _run, deps) {
  if (typeof deps.buildContextExtra === "function") return deps.buildContextExtra(wf);
  return "";
}

/**
 * Resume a run that was paused waiting on approval.
 * If approval is approved: relaunches the executor loop.
 * If rejected/cancelled: transitions run appropriately.
 *
 * This is the single entry point the app calls from resolveApproval.
 */
export async function resumeAfterApproval(runId, approvalId, deps) {
  const run = await deps.loadRun(runId);
  if (!run) return;
  const approval = await deps.loadApproval(approvalId);
  if (!approval) return;
  // Guard: exactly-once. If the run has already moved past the step this
  // approval authorised, don't re-execute anything.
  if (TERMINAL_STATES.includes(run.status)) return;
  if (approval.status === "approved") {
    if (run.status === "awaiting_approval") {
      // Transition back to running and continue.
      const running = transitionRun(run, "running", { now: nowFn(deps) });
      running.events = run.events;
      await logEvent(running, deps, {
        type: "run.resumed", prevState: "awaiting_approval", nextState: "running",
        metadata: { approvalId },
      });
      await deps.saveRun(running);
    }
    await runWorkflow(runId, deps);
    return;
  }
  if (approval.status === "rejected" || approval.status === "cancelled") {
    const next = approval.status === "cancelled" ? "cancelled" : "failed";
    if (canTransition(run.status, next)) {
      const moved = transitionRun(run, next, { now: nowFn(deps) });
      moved.events = run.events;
      moved.failureReason = `Approval ${approval.status} by user.`;
      await logEvent(moved, deps, {
        type: next === "cancelled" ? "run.cancelled" : "run.failed",
        prevState: run.status, nextState: next,
        metadata: { approvalId },
      });
      await deps.saveRun(moved);
    }
  }
}

/** Pause a running run at the next safe boundary. */
export async function pauseRun(runId, deps) {
  const run = await deps.loadRun(runId);
  if (!run || run.status !== "running") return;
  const moved = transitionRun(run, "paused", { now: nowFn(deps) });
  moved.events = run.events;
  await logEvent(moved, deps, { type: "run.paused", prevState: "running", nextState: "paused", metadata: { reason: "user" } });
  await deps.saveRun(moved);
  abortRun(runId); // interrupt in-flight AI
}

/** Cancel a run (any non-terminal state). Aborts in-flight AI. */
export async function cancelRun(runId, deps) {
  const run = await deps.loadRun(runId);
  if (!run || TERMINAL_STATES.includes(run.status)) return;
  const moved = transitionRun(run, "cancelled", { now: nowFn(deps) });
  moved.events = run.events;
  await logEvent(moved, deps, { type: "run.cancelled", prevState: run.status, nextState: "cancelled", metadata: { reason: "user" } });
  await deps.saveRun(moved);
  abortRun(runId);
}

/** Reconcile a stale run on app reload (running/awaiting stuck without an active controller). */
export async function reconcileOnReload(runId, deps) {
  const run = await deps.loadRun(runId);
  if (!run) return;
  if (isRunning(runId)) return; // active in this process
  if (run.status === "running") {
    // Executor died without terminal event; move to paused so user can decide.
    const moved = transitionRun(run, "paused", { now: nowFn(deps) });
    moved.events = run.events;
    await logEvent(moved, deps, {
      type: "run.reconciled", prevState: "running", nextState: "paused",
      metadata: { reason: "process_restart" },
    });
    await deps.saveRun(moved);
  }
}

export const _internals = { executeStep, assertBridgeCapability };