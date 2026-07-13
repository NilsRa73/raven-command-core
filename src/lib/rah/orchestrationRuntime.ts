// React-side runtime that turns the pure orchestrator into a live run.
//
// - Wires selected specialists into streamChat with bounded concurrency.
// - Never persists intermediate specialist outputs; only the final
//   synthesized command is written to Command History by the caller.
// - App-generated runtime identity per specialist (not model-reported).
// - Cancellation stops pending tasks and aborts in-flight ones.

import { useCallback, useRef, useState } from "react";
import { AGENTS, agentById } from "./agents";
import { streamChat } from "./ai";
import {
  pickSpecialists, runWithConcurrency, buildSpecialistUserPrompt,
  buildSynthesisPrompt, specialistRuntimeLine, privacyLabel,
  makeEventLogger,
  type TeamMode, type TaskSummary, type PrivacyLabel,
} from "./orchestrator";
import { getLocalAiSettings, engineLabel, type LocalAiSettings } from "./localAi";
import { recordAgentRun } from "./agentSessionStats";

export interface TaskCard {
  id: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentColor: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  startedAt?: number;
  finishedAt?: number;
  provider?: string;
  model?: string;
  engine?: string;
  transport?: "bridge" | "direct";
  latencyMs?: number;
  text: string;         // live/final specialist output (session-only)
  error?: string;
  runtimeLine: string;  // app-generated, never model-generated
  abort: () => void;
}

export interface OrchestrationState {
  runId: string;
  teamMode: TeamMode;
  userPrompt: string;
  privacy: PrivacyLabel;
  tasks: TaskCard[];
  phase: "idle" | "planning" | "running" | "synthesizing" | "done" | "cancelled" | "error";
  synthesis: string;           // live/final synthesized answer
  synthesisProvider?: string;
  synthesisModel?: string;
  synthesisRuntimeLine?: string;
  startedAt?: number;
  finishedAt?: number;
  events: Array<{ ts: number; kind: string } & Record<string, unknown>>;
}

function newRunId() { return "run_" + Math.random().toString(36).slice(2, 10); }

function routeFor(settings: LocalAiSettings, bridgeOnline: boolean) {
  const engine = settings.engine;
  const transport = engine === "cloud" || engine === "demo"
    ? "direct"
    : (settings.transport !== "direct" && bridgeOnline ? "bridge" : "direct");
  return { engine, transport: transport as "bridge" | "direct" };
}

export interface StartOrchestrationOpts {
  userPrompt: string;
  teamMode: TeamMode;
  manualSelection?: string[];
  context: {
    projectName?: string;
    projectGoals?: string;
    memory?: string[];
    projectMemoryBlock?: string;
  };
  bridgeOnline: boolean;
  /** Called after synthesis finishes with the FINAL command payload the
   *  caller should persist to Command History (single record). */
  onFinal: (final: {
    runId: string;
    prompt: string;
    specialists: string[];
    synthesis: string;
    provider?: string;
    model?: string;
    latencyMs: number;
    privacy: PrivacyLabel;
  }) => void;
}

export function useOrchestration() {
  const [state, setState] = useState<OrchestrationState | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const taskAbortsRef = useRef<Map<string, AbortController>>(new Map());

  const update = useCallback((patch: Partial<OrchestrationState> | ((s: OrchestrationState) => OrchestrationState)) => {
    setState((cur) => {
      if (!cur) return cur;
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      return next;
    });
  }, []);

  const patchTask = useCallback((id: string, patch: Partial<TaskCard>) => {
    setState((cur) => cur ? ({ ...cur, tasks: cur.tasks.map((t) => t.id === id ? { ...t, ...patch } : t) }) : cur);
  }, []);

  const cancelAll = useCallback(() => {
    runAbortRef.current?.abort();
    for (const ac of taskAbortsRef.current.values()) { try { ac.abort(); } catch { /* */ } }
  }, []);

  const cancelTask = useCallback((taskId: string) => {
    const ac = taskAbortsRef.current.get(taskId);
    try { ac?.abort(); } catch { /* */ }
  }, []);

  const reset = useCallback(() => { setState(null); }, []);

  const start = useCallback(async (opts: StartOrchestrationOpts) => {
    const settings = getLocalAiSettings();
    const route = routeFor(settings, opts.bridgeOnline);
    const specialists = pickSpecialists(opts.userPrompt, opts.teamMode, {
      manualSelection: opts.manualSelection,
    });
    if (!specialists.length) {
      // Nothing to run — bail early with a helpful state.
      setState({
        runId: newRunId(), teamMode: opts.teamMode, userPrompt: opts.userPrompt,
        privacy: "UNKNOWN", tasks: [], phase: "error", synthesis: "",
        events: [], startedAt: Date.now(), finishedAt: Date.now(),
      });
      return;
    }
    const runId = newRunId();
    const runAbort = new AbortController();
    runAbortRef.current = runAbort;
    taskAbortsRef.current = new Map();

    const routes = specialists.map(() => route);
    // synthesis also uses the same engine
    routes.push(route);
    const privacy = privacyLabel(routes);

    const logger = makeEventLogger();
    logger.log("run:start", {
      runId, teamMode: opts.teamMode,
      specialists, concurrency: 4, privacy,
      engine: route.engine, transport: route.transport,
    });

    const tasks: TaskCard[] = specialists.map((aid, i) => {
      const def = agentById(aid) ?? AGENTS[0];
      const ac = new AbortController();
      const tid = `${runId}_${i}_${aid}`;
      taskAbortsRef.current.set(tid, ac);
      const runtimeLine = specialistRuntimeLine({
        agentName: def.name, engine: route.engine, transport: route.transport,
      });
      return {
        id: tid, agentId: aid, agentName: def.name, agentEmoji: def.emoji,
        agentColor: def.color, state: "queued", text: "", runtimeLine,
        engine: route.engine, transport: route.transport,
        abort: () => { try { ac.abort(); } catch { /* */ } },
      };
    });

    setState({
      runId, teamMode: opts.teamMode, userPrompt: opts.userPrompt,
      privacy, tasks, phase: "running", synthesis: "",
      events: logger.events, startedAt: Date.now(),
    });

    const runSpecialist = async (t: TaskCard): Promise<TaskSummary> => {
      const startedAt = Date.now();
      patchTask(t.id, { state: "running", startedAt });
      logger.log("agent:start", { runId, agentId: t.agentId });
      const userMsg = buildSpecialistUserPrompt(opts.userPrompt, opts.context);
      let finalText = "";
      let providerLabel: string | undefined;
      let modelLabel: string | undefined;
      const ac = taskAbortsRef.current.get(t.id)!;
      try {
        await streamChat({
          prompt: userMsg,
          agents: [t.agentId],       // scope system prompt to this specialist
          mode: "fast",
          signal: ac.signal,
          context: {
            projectName: opts.context.projectName,
            projectGoals: opts.context.projectGoals,
            memory: opts.context.memory,
            projectMemoryBlock: opts.context.projectMemoryBlock,
          },
        }, {
          onStart: (i) => {
            providerLabel = i.provider;
            modelLabel = i.model;
            patchTask(t.id, {
              provider: i.provider, model: i.model,
              runtimeLine: specialistRuntimeLine({
                agentName: t.agentName, provider: i.provider, model: i.model,
                engine: t.engine, transport: t.transport,
              }),
            });
          },
          onDelta: (_c, full) => {
            finalText = full;
            patchTask(t.id, { text: full });
          },
          onDone: (i) => {
            finalText = i.text || finalText;
            providerLabel = i.provider; modelLabel = i.model;
          },
        });
        const finishedAt = Date.now();
        const latencyMs = finishedAt - startedAt;
        patchTask(t.id, {
          state: "done", text: finalText, finishedAt, latencyMs,
          provider: providerLabel, model: modelLabel,
          runtimeLine: specialistRuntimeLine({
            agentName: t.agentName, provider: providerLabel, model: modelLabel,
            engine: t.engine, transport: t.transport, latencyMs,
          }),
        });
        logger.log("agent:done", { runId, agentId: t.agentId, latencyMs });
        recordAgentRun(t.agentId, {
          outcome: "completed", latencyMs,
          lastEngine: t.engine, lastProvider: providerLabel, lastTransport: t.transport,
        });
        return { agentId: t.agentId, agentName: t.agentName, state: "done", text: finalText };
      } catch (err) {
        const finishedAt = Date.now();
        const latencyMs = finishedAt - startedAt;
        const aborted = ac.signal.aborted || runAbort.signal.aborted;
        const msg = err instanceof Error ? err.message : String(err);
        if (aborted) {
          patchTask(t.id, { state: "cancelled", finishedAt, latencyMs, error: "cancelled" });
          logger.log("agent:cancelled", { runId, agentId: t.agentId, latencyMs });
          recordAgentRun(t.agentId, { outcome: "cancelled", latencyMs, lastEngine: t.engine, lastTransport: t.transport });
          return { agentId: t.agentId, agentName: t.agentName, state: "cancelled" };
        }
        patchTask(t.id, { state: "failed", finishedAt, latencyMs, error: msg });
        logger.log("agent:failed", { runId, agentId: t.agentId, latencyMs, errorCode: "runtime" });
        recordAgentRun(t.agentId, { outcome: "failed", latencyMs, lastEngine: t.engine, lastTransport: t.transport });
        return { agentId: t.agentId, agentName: t.agentName, state: "failed", error: msg };
      }
    };

    const settled = await runWithConcurrency(tasks, runSpecialist, {
      concurrency: 4, signal: runAbort.signal,
    });

    // Any task whose settled status is "cancelled" (i.e. scheduler-skipped
    // because signal aborted before it ran) needs its card updated too.
    settled.forEach((r, i) => {
      if (r.status === "cancelled") {
        const t = tasks[i];
        patchTask(t.id, { state: "cancelled", finishedAt: Date.now() });
      }
    });

    // Build the taskStates from what actually happened.
    const taskStates: TaskSummary[] = tasks.map((t, i) => {
      const r = settled[i];
      if (r.status === "fulfilled" && r.value) return r.value as TaskSummary;
      if (r.status === "cancelled") return { agentId: t.agentId, agentName: t.agentName, state: "cancelled" };
      return { agentId: t.agentId, agentName: t.agentName, state: "failed", error: "unknown" };
    });

    if (runAbort.signal.aborted && !taskStates.some((t) => t.state === "done")) {
      update({ phase: "cancelled", finishedAt: Date.now() });
      logger.log("run:cancelled", { runId });
      return;
    }

    update({ phase: "synthesizing" });
    logger.log("run:synthesizing", { runId });

    const synthesisPrompt = buildSynthesisPrompt(opts.userPrompt, taskStates);
    const synthAbort = new AbortController();
    // A run-level cancel also cancels synthesis.
    if (runAbort.signal.aborted) synthAbort.abort();
    runAbort.signal.addEventListener("abort", () => synthAbort.abort());
    let synthText = "";
    let synthProvider: string | undefined;
    let synthModel: string | undefined;
    const synthStart = Date.now();
    try {
      await streamChat({
        prompt: synthesisPrompt,
        agents: ["brain"],
        mode: "expert",
        signal: synthAbort.signal,
        context: {
          projectName: opts.context.projectName,
          projectGoals: opts.context.projectGoals,
          memory: opts.context.memory,
          projectMemoryBlock: opts.context.projectMemoryBlock,
        },
      }, {
        onStart: (i) => { synthProvider = i.provider; synthModel = i.model; },
        onDelta: (_c, full) => {
          synthText = full;
          update({ synthesis: full });
        },
        onDone: (i) => {
          synthText = i.text || synthText;
          synthProvider = i.provider; synthModel = i.model;
        },
      });
      const finishedAt = Date.now();
      const latencyMs = finishedAt - synthStart;
      const runtimeLine = specialistRuntimeLine({
        agentName: "RAH Master Brain", provider: synthProvider, model: synthModel,
        engine: route.engine, transport: route.transport, latencyMs,
      });
      update({
        phase: "done", synthesis: synthText,
        synthesisProvider: synthProvider, synthesisModel: synthModel,
        synthesisRuntimeLine: runtimeLine, finishedAt,
      });
      logger.log("run:done", { runId, latencyMs });
      opts.onFinal({
        runId,
        prompt: opts.userPrompt,
        specialists,
        synthesis: synthText,
        provider: synthProvider,
        model: synthModel,
        latencyMs: finishedAt - (state?.startedAt ?? synthStart),
        privacy,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (synthAbort.signal.aborted) {
        update({ phase: "cancelled", finishedAt: Date.now() });
        logger.log("run:cancelled", { runId });
      } else {
        update({ phase: "error", synthesis: synthText || `Synthesis failed: ${msg}`, finishedAt: Date.now() });
        logger.log("run:error", { runId, errorCode: "synthesis" });
      }
    }
  }, [patchTask, update]);

  const retryAgent = useCallback(async (taskId: string, opts: { context: StartOrchestrationOpts["context"]; bridgeOnline: boolean }) => {
    if (!state) return;
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const settings = getLocalAiSettings();
    const route = routeFor(settings, opts.bridgeOnline);
    const ac = new AbortController();
    taskAbortsRef.current.set(t.id, ac);
    patchTask(t.id, {
      state: "running", startedAt: Date.now(), text: "", error: undefined,
      engine: route.engine, transport: route.transport,
      runtimeLine: specialistRuntimeLine({ agentName: t.agentName, engine: route.engine, transport: route.transport }),
    });
    let finalText = "";
    try {
      const userMsg = buildSpecialistUserPrompt(state.userPrompt, opts.context);
      let providerLabel: string | undefined;
      let modelLabel: string | undefined;
      const startedAt = Date.now();
      await streamChat({
        prompt: userMsg, agents: [t.agentId], mode: "fast", signal: ac.signal,
        context: opts.context,
      }, {
        onStart: (i) => { providerLabel = i.provider; modelLabel = i.model; },
        onDelta: (_c, full) => { finalText = full; patchTask(t.id, { text: full }); },
        onDone: (i) => { finalText = i.text || finalText; providerLabel = i.provider; modelLabel = i.model; },
      });
      const finishedAt = Date.now();
      const latencyMs = finishedAt - startedAt;
      patchTask(t.id, {
        state: "done", text: finalText, finishedAt, latencyMs,
        provider: providerLabel, model: modelLabel,
        runtimeLine: specialistRuntimeLine({
          agentName: t.agentName, provider: providerLabel, model: modelLabel,
          engine: route.engine, transport: route.transport, latencyMs,
        }),
      });
      recordAgentRun(t.agentId, { outcome: "completed", latencyMs, lastEngine: route.engine, lastTransport: route.transport, lastProvider: providerLabel });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patchTask(t.id, { state: "failed", finishedAt: Date.now(), error: msg });
      recordAgentRun(t.agentId, { outcome: "failed" });
    }
  }, [state, patchTask]);

  const retrySynthesis = useCallback(async (opts: { context: StartOrchestrationOpts["context"] }) => {
    if (!state) return;
    const taskStates: TaskSummary[] = state.tasks.map((t) => ({
      agentId: t.agentId, agentName: t.agentName,
      state: t.state === "done" ? "done" : t.state === "cancelled" ? "cancelled" : t.state === "failed" ? "failed" : "failed",
      text: t.text, error: t.error,
    }));
    const synthesisPrompt = buildSynthesisPrompt(state.userPrompt, taskStates);
    const ac = new AbortController();
    runAbortRef.current = ac;
    update({ phase: "synthesizing", synthesis: "" });
    let synthText = "";
    let synthProvider: string | undefined;
    let synthModel: string | undefined;
    const startedAt = Date.now();
    try {
      await streamChat({
        prompt: synthesisPrompt, agents: ["brain"], mode: "expert",
        signal: ac.signal, context: opts.context,
      }, {
        onStart: (i) => { synthProvider = i.provider; synthModel = i.model; },
        onDelta: (_c, full) => { synthText = full; update({ synthesis: full }); },
        onDone: (i) => { synthText = i.text || synthText; synthProvider = i.provider; synthModel = i.model; },
      });
      const latencyMs = Date.now() - startedAt;
      const runtimeLine = specialistRuntimeLine({
        agentName: "RAH Master Brain", provider: synthProvider, model: synthModel,
        latencyMs,
      });
      update({
        phase: "done", synthesis: synthText, synthesisProvider: synthProvider,
        synthesisModel: synthModel, synthesisRuntimeLine: runtimeLine,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      update({ phase: "error", synthesis: synthText || `Synthesis failed: ${msg}` });
    }
  }, [state, update]);

  return { state, start, cancelAll, cancelTask, retryAgent, retrySynthesis, reset };
}

// Small helper for consumers that only need to display the privacy label.
export function privacyBadgeClass(label: PrivacyLabel): string {
  if (label === "LOCAL") return "border-primary/60 bg-primary/10 text-primary";
  if (label === "MIXED") return "border-yellow-500/60 bg-yellow-500/10 text-yellow-400";
  if (label === "CLOUD") return "border-border/70 text-muted-foreground";
  return "border-border/70 text-muted-foreground";
}

export function engineLabelFor(engine: string): string { return engineLabel(engine as any); }