import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getDB, getPrefs, savePrefs, seedIfEmpty, seedProjectMemoryIfEmpty, uid, type Approval, type CommandRecord, type MemoryItem, type Preferences, type Project, type ProjectMemoryRecord } from "./db";
import { streamChat } from "./ai";
import { toast } from "sonner";
import { applyBridgeAutoMigration } from "./localAi";
import { selectRelevantForPrompt, buildMemoryInjectionBlock } from "./projectMemory";
import {
  runWorkflow as executorRunWorkflow,
  resumeAfterApproval as executorResumeAfterApproval,
  pauseRun as executorPauseRun,
  cancelRun as executorCancelRun,
  reconcileOnReload as executorReconcile,
  abortRun as executorAbort,
} from "./workflowExecutor";
import { STEP_CATALOG } from "./workflow";
import {
  bridgeStatusSnapshot,
  bridgeReadText, bridgePrepare, bridgeExecute,
} from "./bridge";

type Ctx = {
  ready: boolean;
  prefs: Preferences;
  updatePrefs: (patch: Partial<Preferences>) => Promise<void>;
  projects: Project[];
  reloadProjects: () => Promise<void>;
  createProject: (p: Partial<Project>) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<Project | null>;
  activeProject: Project | null;
  setActiveProject: (id?: string) => Promise<void>;
  commands: CommandRecord[];
  reloadCommands: () => Promise<void>;
  addCommand: (c: Omit<CommandRecord, "id" | "createdAt">) => Promise<CommandRecord>;
  updateCommand: (id: string, patch: Partial<CommandRecord>) => Promise<void>;
  deleteCommand: (id: string) => Promise<void>;
  memory: MemoryItem[];
  reloadMemory: () => Promise<void>;
  addMemory: (m: Omit<MemoryItem, "id" | "createdAt">) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  projectMemory: ProjectMemoryRecord[];
  reloadProjectMemory: () => Promise<void>;
  createProjectMemory: (m: Omit<ProjectMemoryRecord, "id" | "createdAt" | "updatedAt">) => Promise<ProjectMemoryRecord>;
  updateProjectMemory: (id: string, patch: Partial<ProjectMemoryRecord>) => Promise<void>;
  deleteProjectMemory: (id: string) => Promise<void>;
  togglePinProjectMemory: (id: string) => Promise<void>;
  toggleArchiveProjectMemory: (id: string) => Promise<void>;
  buildProjectMemoryContext: () => { memoryBlock: string; count: number };
  approvals: Approval[];
  reloadApprovals: () => Promise<void>;
  requestApproval: (a: Omit<Approval, "id" | "createdAt" | "status">) => Promise<Approval>;
  resolveApproval: (id: string, status: "approved" | "rejected" | "cancelled") => Promise<void>;
  runApprovedCommand: (commandId: string) => Promise<void>;
  emergencyStop: () => Promise<void>;
  workflowRun: (runId: string) => Promise<void>;
  workflowPause: (runId: string) => Promise<void>;
  workflowCancel: (runId: string) => Promise<void>;
  focusCommandBar: () => void;
  registerCommandBarFocus: (fn: () => void) => () => void;
};

const RahContext = createContext<Ctx | null>(null);

export function useRah() {
  const c = useContext(RahContext);
  if (!c) throw new Error("useRah must be used inside <RahProvider>");
  return c;
}

export function RahProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [projectMemory, setProjectMemory] = useState<ProjectMemoryRecord[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const focusRef = useRef<() => void>(() => {});

  const reloadProjects = useCallback(async () => {
    const db = await getDB();
    const all = await db.getAll("projects");
    setProjects(all.sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);
  const reloadCommands = useCallback(async () => {
    const db = await getDB();
    const all = await db.getAll("commands");
    setCommands(all.sort((a, b) => b.createdAt - a.createdAt));
  }, []);
  const reloadMemory = useCallback(async () => {
    const db = await getDB();
    setMemory(await db.getAll("memory"));
  }, []);
  const reloadProjectMemory = useCallback(async () => {
    const db = await getDB();
    const all = await db.getAll("projectMemory");
    setProjectMemory(all.sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);
  const reloadApprovals = useCallback(async () => {
    const db = await getDB();
    setApprovals((await db.getAll("approvals")).sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await seedIfEmpty();
        await seedProjectMemoryIfEmpty();
        const p = await getPrefs();
        setPrefs(p);
        await Promise.all([reloadProjects(), reloadCommands(), reloadMemory(), reloadApprovals(), reloadProjectMemory()]);
        void applyBridgeAutoMigration();
      } finally {
        setReady(true);
      }
    })();
  }, [reloadProjects, reloadCommands, reloadMemory, reloadApprovals, reloadProjectMemory]);

  // apply theme + text size + reduced motion to <html>
  useEffect(() => {
    if (!prefs || typeof document === "undefined") return;
    const html = document.documentElement;
    html.classList.remove("raven", "forest", "arctic", "hc");
    html.classList.add(prefs.theme === "raven" ? "raven" : prefs.theme);
    html.style.fontSize = prefs.textSize === "sm" ? "14px" : prefs.textSize === "lg" ? "18px" : "16px";
    html.classList.toggle("reduce-motion", prefs.reducedMotion);
  }, [prefs]);

  const updatePrefs = useCallback(async (patch: Partial<Preferences>) => {
    setPrefs((cur) => {
      const next = { ...(cur ?? ({ id: "prefs" } as Preferences)), ...patch } as Preferences;
      void savePrefs(next);
      return next;
    });
  }, []);

  const createProject = useCallback<Ctx["createProject"]>(async (p) => {
    const now = Date.now();
    const project: Project = {
      id: uid(), name: p.name ?? "Untitled project", description: p.description ?? "", icon: p.icon ?? "✦",
      status: p.status ?? "active", priority: p.priority ?? "normal", tags: p.tags ?? [], favorite: p.favorite ?? false,
      createdAt: now, updatedAt: now, goals: p.goals, notes: p.notes,
    };
    const db = await getDB();
    await db.put("projects", project);
    await reloadProjects();
    return project;
  }, [reloadProjects]);

  const updateProject = useCallback<Ctx["updateProject"]>(async (id, patch) => {
    const db = await getDB();
    const cur = await db.get("projects", id);
    if (!cur) return;
    await db.put("projects", { ...cur, ...patch, updatedAt: Date.now() });
    await reloadProjects();
  }, [reloadProjects]);

  const deleteProject = useCallback<Ctx["deleteProject"]>(async (id) => {
    const db = await getDB();
    await db.delete("projects", id);
    await reloadProjects();
  }, [reloadProjects]);

  const duplicateProject = useCallback<Ctx["duplicateProject"]>(async (id) => {
    const db = await getDB();
    const cur = await db.get("projects", id);
    if (!cur) return null;
    const now = Date.now();
    const copy: Project = { ...cur, id: uid(), name: cur.name + " (copy)", createdAt: now, updatedAt: now, favorite: false };
    await db.put("projects", copy);
    await reloadProjects();
    return copy;
  }, [reloadProjects]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === prefs?.activeProjectId) ?? null,
    [projects, prefs?.activeProjectId],
  );
  const setActiveProject = useCallback(async (id?: string) => {
    await updatePrefs({ activeProjectId: id });
  }, [updatePrefs]);

  const addCommand = useCallback<Ctx["addCommand"]>(async (c) => {
    const rec: CommandRecord = { ...c, id: uid(), createdAt: Date.now() };
    const db = await getDB();
    await db.put("commands", rec);
    await reloadCommands();
    return rec;
  }, [reloadCommands]);
  const updateCommand = useCallback<Ctx["updateCommand"]>(async (id, patch) => {
    const db = await getDB();
    const cur = await db.get("commands", id);
    if (!cur) return;
    await db.put("commands", { ...cur, ...patch });
    await reloadCommands();
  }, [reloadCommands]);
  const deleteCommand = useCallback<Ctx["deleteCommand"]>(async (id) => {
    const db = await getDB();
    await db.delete("commands", id);
    await reloadCommands();
  }, [reloadCommands]);

  const addMemory = useCallback<Ctx["addMemory"]>(async (m) => {
    const db = await getDB();
    await db.put("memory", { ...m, id: uid(), createdAt: Date.now() });
    await reloadMemory();
  }, [reloadMemory]);
  const deleteMemory = useCallback<Ctx["deleteMemory"]>(async (id) => {
    const db = await getDB();
    await db.delete("memory", id);
    await reloadMemory();
  }, [reloadMemory]);

  const createProjectMemory = useCallback<Ctx["createProjectMemory"]>(async (m) => {
    const now = Date.now();
    const rec: ProjectMemoryRecord = { ...m, id: uid(), createdAt: now, updatedAt: now };
    const db = await getDB();
    await db.put("projectMemory", rec);
    await reloadProjectMemory();
    return rec;
  }, [reloadProjectMemory]);
  const updateProjectMemory = useCallback<Ctx["updateProjectMemory"]>(async (id, patch) => {
    const db = await getDB();
    const cur = await db.get("projectMemory", id);
    if (!cur) return;
    await db.put("projectMemory", { ...cur, ...patch, updatedAt: Date.now() });
    await reloadProjectMemory();
  }, [reloadProjectMemory]);
  const deleteProjectMemory = useCallback<Ctx["deleteProjectMemory"]>(async (id) => {
    const db = await getDB();
    await db.delete("projectMemory", id);
    await reloadProjectMemory();
  }, [reloadProjectMemory]);
  const togglePinProjectMemory = useCallback<Ctx["togglePinProjectMemory"]>(async (id) => {
    const db = await getDB();
    const cur = await db.get("projectMemory", id);
    if (!cur) return;
    await db.put("projectMemory", { ...cur, pinned: !cur.pinned, updatedAt: Date.now() });
    await reloadProjectMemory();
  }, [reloadProjectMemory]);
  const toggleArchiveProjectMemory = useCallback<Ctx["toggleArchiveProjectMemory"]>(async (id) => {
    const db = await getDB();
    const cur = await db.get("projectMemory", id);
    if (!cur) return;
    await db.put("projectMemory", { ...cur, archived: !cur.archived, updatedAt: Date.now() });
    await reloadProjectMemory();
  }, [reloadProjectMemory]);

  const requestApproval = useCallback<Ctx["requestApproval"]>(async (a) => {
    const rec: Approval = { ...a, id: uid(), createdAt: Date.now(), status: "pending" };
    const db = await getDB();
    await db.put("approvals", rec);
    await reloadApprovals();
    return rec;
  }, [reloadApprovals]);
  const resolveApproval = useCallback<Ctx["resolveApproval"]>(async (id, status) => {
    const db = await getDB();
    const cur = await db.get("approvals", id);
    if (!cur) return;
    // Prevent double-use: an approval that has already left "pending" is
    // spent and must not resume anything again.
    if (cur.status !== "pending") return;
    await db.put("approvals", { ...cur, status });
    await reloadApprovals();
    if (status === "approved" && cur.commandId) {
      // Fire-and-forget: actually run the AI inference the user just authorised.
      void runApprovedCommand(cur.commandId);
    } else if (status !== "approved" && cur.commandId) {
      const cmd = await db.get("commands", cur.commandId);
      if (cmd && cmd.status === "awaiting_approval") {
        const { pending: _drop, ...rest } = cmd;
        void _drop;
        await db.put("commands", { ...rest, status: status === "rejected" ? "rejected" : "error", resultSummary: status === "rejected" ? "Rejected by user." : "Cancelled by user." });
        await reloadCommands();
      }
    }
    // Workflow approvals: dispatch to executor.
    if (cur.workflowRunId) {
      void executorResumeAfterApproval(cur.workflowRunId, id, buildExecutorDeps({ requestApproval, reloadApprovals }));
    }
  }, [reloadApprovals]);

  const runApprovedCommand = useCallback<Ctx["runApprovedCommand"]>(async (commandId) => {
    const db = await getDB();
    const cmd = await db.get("commands", commandId);
    if (!cmd) return;
    if (cmd.status !== "awaiting_approval" && cmd.status !== "queued") return;
    const pending = cmd.pending;
    await db.put("commands", { ...cmd, status: "running", resultSummary: "Running…" });
    await reloadCommands();
    const startedAt = Date.now();
    let providerLabel = "Lovable AI Gateway";
    let modelLabel: string | undefined;
    let latencyMs = 0;
    let usage: unknown = null;
    let finalText = "";
    let visionUsed = false;
    try {
      await streamChat({
        prompt: cmd.prompt,
        agents: cmd.agents,
        mode: cmd.mode,
        context: pending?.context,
        images: pending?.images,
      }, {
        onStart: (i) => { providerLabel = i.provider; modelLabel = i.model; },
        onVision: (i) => { visionUsed = i.imageCount > 0; },
        onDelta: (_c, full) => { finalText = full; },
        onDone: (i) => { finalText = i.text; modelLabel = i.model; providerLabel = i.provider; latencyMs = i.latencyMs; usage = i.usage; },
      });
      const { pending: _drop, ...rest } = cmd;
      void _drop;
      await db.put("commands", {
        ...rest,
        status: "done",
        resultSummary: finalText || "(empty response)",
        provider: providerLabel,
        model: modelLabel,
        latencyMs: latencyMs || (Date.now() - startedAt),
        usage,
        visionUsed,
        demo: false,
      });
      await reloadCommands();
      toast.success("Approved command finished — see History.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { pending: _drop, ...rest } = cmd;
      void _drop;
      await db.put("commands", { ...rest, status: "error", errorMessage: msg, resultSummary: `Error: ${msg}` });
      await reloadCommands();
      toast.error("Approved command failed: " + msg);
    }
  }, [reloadCommands]);

  const emergencyStop = useCallback(async () => {
    const db = await getDB();
    const pending = await db.getAll("approvals");
    for (const a of pending) if (a.status === "pending") await db.put("approvals", { ...a, status: "cancelled" });
    await reloadApprovals();
    // Abort any running workflow executors.
    const runs = await db.getAll("workflowRuns");
    for (const r of runs) if (r.status === "running" || r.status === "awaiting_approval") executorAbort(r.runId);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("rah:emergency-stop"));
  }, [reloadApprovals]);

  const focusCommandBar = useCallback(() => focusRef.current(), []);
  const registerCommandBarFocus = useCallback((fn: () => void) => {
    focusRef.current = fn;
    return () => { if (focusRef.current === fn) focusRef.current = () => {}; };
  }, []);

  const workflowRun = useCallback<Ctx["workflowRun"]>(async (runId) => {
    await executorRunWorkflow(runId, buildExecutorDeps({ requestApproval, reloadApprovals }));
  }, [requestApproval, reloadApprovals]);
  const workflowPause = useCallback<Ctx["workflowPause"]>(async (runId) => {
    await executorPauseRun(runId, buildExecutorDeps({ requestApproval, reloadApprovals }));
  }, [requestApproval, reloadApprovals]);
  const workflowCancel = useCallback<Ctx["workflowCancel"]>(async (runId) => {
    await executorCancelRun(runId, buildExecutorDeps({ requestApproval, reloadApprovals }));
  }, [requestApproval, reloadApprovals]);

  // Reconcile stale workflow runs on startup.
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const db = await getDB();
      const runs = await db.getAll("workflowRuns");
      for (const r of runs) {
        if (r.status === "running") {
          await executorReconcile(r.runId, buildExecutorDeps({ requestApproval, reloadApprovals }));
        }
      }
    })();
  }, [ready, requestApproval, reloadApprovals]);

  const value: Ctx = {
    ready, prefs: prefs ?? {
      id: "prefs", theme: "raven", textSize: "md", reducedMotion: false, language: "en", voiceLang: "en-US",
      ttsEnabled: false, ttsRate: 1, shortcutsEnabled: true, approvalMode: "ask_every", memoryEnabled: true,
      defaultMode: "fast", onboardingComplete: false, localOnly: true,
    },
    updatePrefs,
    projects, reloadProjects, createProject, updateProject, deleteProject, duplicateProject,
    activeProject, setActiveProject,
    commands, reloadCommands, addCommand, updateCommand, deleteCommand,
    memory, reloadMemory, addMemory, deleteMemory,
    projectMemory, reloadProjectMemory, createProjectMemory, updateProjectMemory, deleteProjectMemory,
    togglePinProjectMemory, toggleArchiveProjectMemory,
    buildProjectMemoryContext: () => {
      const picked = selectRelevantForPrompt(projectMemory, {
        projectId: activeProject?.id ?? null,
        limit: 8,
      });
      return {
        memoryBlock: buildMemoryInjectionBlock(picked, { projectName: activeProject?.name }),
        count: picked.length,
      };
    },
    approvals, reloadApprovals, requestApproval, resolveApproval,
    runApprovedCommand,
    emergencyStop,
    workflowRun, workflowPause, workflowCancel,
    focusCommandBar, registerCommandBarFocus,
  };

  return <RahContext.Provider value={value}>{children}</RahContext.Provider>;
}

// Build executor deps that read/write the same IndexedDB the rest of the
// app uses and delegate to the real AI, memory, chronicle, and bridge
// implementations. Constructed per-call so the current React callbacks
// (requestApproval, reloadApprovals) are captured.
function buildExecutorDeps(hooks: {
  requestApproval: (a: Omit<Approval, "id" | "createdAt" | "status">) => Promise<Approval>;
  reloadApprovals: () => Promise<void>;
}) {
  return {
    loadRun: async (id: string) => {
      const db = await getDB();
      return (await db.get("workflowRuns", id)) ?? null;
    },
    saveRun: async (r: unknown) => {
      const db = await getDB();
      await db.put("workflowRuns", r as never);
    },
    loadWorkflow: async (id: string) => {
      const db = await getDB();
      return (await db.get("workflows", id)) ?? null;
    },
    loadApproval: async (id: string) => {
      const db = await getDB();
      return (await db.get("approvals", id)) ?? null;
    },
    requestApproval: async ({ step, workflow, run }: { step: { id: string; type: string; config: Record<string, unknown> }; workflow: { id: string; name: string; projectId: string | null }; run: { runId: string } }) => {
      const cat = STEP_CATALOG[step.type as keyof typeof STEP_CATALOG];
      const detail = summariseStepForApproval(step);
      const approval = await hooks.requestApproval({
        title: `${workflow.name} — ${cat?.label ?? step.type}`,
        reason: detail,
        tools: [cat?.label ?? step.type],
        dataShared: workflow.projectId ? ["active project context"] : [],
        expectedResult: detail,
        risk: (cat?.risk as "low" | "medium" | "high") ?? "low",
        category: "workflow",
        undo: "This approval is one-shot and only authorises this single step.",
        workflowRunId: run.runId,
        workflowStepId: step.id,
        workflowAction: cat?.label ?? step.type,
      });
      await hooks.reloadApprovals();
      return approval;
    },
    ai: async ({ prompt, signal, mode }: { prompt: string; signal: AbortSignal; mode: string }) => {
      let text = "", provider = "", model = "", latencyMs = 0;
      await streamChat(
        { prompt, agents: ["brain"], mode: (mode as "fast" | "deep_project"), signal, context: {} },
        {
          onStart: (i) => { provider = i.provider; model = i.model; },
          onDelta: (_c, full) => { text = full; },
          onDone: (i) => { text = i.text; provider = i.provider; model = i.model; latencyMs = i.latencyMs; },
        },
      );
      return { text, provider, model, transport: "streamChat", engine: null, latencyMs };
    },
    memory: {
      save: async (m: { title: string; content: string; projectId: string | null; tags: string[] }) => {
        const db = await getDB();
        const now = Date.now();
        await db.put("projectMemory", {
          id: uid(), projectId: m.projectId, title: m.title, content: m.content,
          type: "note", tags: m.tags, source: "workflow",
          archived: false, pinned: false, createdAt: now, updatedAt: now,
        });
      },
    },
    chronicle: {
      log: async (c: { title: string; detail: string; projectId: string | null }) => {
        const db = await getDB();
        const now = Date.now();
        await db.put("projectMemory", {
          id: uid(), projectId: c.projectId, title: c.title, content: c.detail,
          type: "daily_log", tags: ["chronicle"], source: "workflow",
          archived: false, pinned: false, createdAt: now, updatedAt: now,
        });
      },
    },
    bridge: {
      status: async () => {
        const s = await bridgeStatusSnapshot();
        return { status: s.ui, capabilities: [] };
      },
      readFile: async (p: string) => {
        const r = await bridgeReadText(p);
        return { text: r.text, size: r.size };
      },
      writeFile: async (p: string, source?: string) => {
        // Uses files.copy capability (see workflow.js). Requires an
        // approval-driven prepare/execute pair.
        const prep = await bridgePrepare("files.copy", { source: source ?? p, dest: p });
        await bridgeExecute(prep.job.id, prep.job.approvalId ?? "", prep.confirmationToken);
        return { ok: true };
      },
      launchUrl: async (u: string) => {
        const prep = await bridgePrepare("launch.url", { url: u });
        await bridgeExecute(prep.job.id, prep.job.approvalId ?? "", prep.confirmationToken);
        return { ok: true };
      },
      launchApp: async (p: string) => {
        const prep = await bridgePrepare("launch.program", { program: p });
        await bridgeExecute(prep.job.id, prep.job.approvalId ?? "", prep.confirmationToken);
        return { ok: true };
      },
    },
    now: () => Date.now(),
    rng: () => Math.random().toString(36).slice(2, 8),
  };
}

function summariseStepForApproval(step: { type: string; config: Record<string, unknown> }): string {
  const c = step.config as Record<string, string | undefined>;
  switch (step.type) {
    case "save_memory": return `Save memory: ${c.title ?? "(untitled)"}`;
    case "chronicle_entry": return `Log chronicle: ${c.title ?? "(untitled)"}`;
    case "bridge_read_file": return `Read file: ${c.path ?? ""}`;
    case "bridge_write_file": return `Write file: ${c.path ?? ""}`;
    case "bridge_launch_url": return `Open URL: ${c.url ?? ""}`;
    case "bridge_launch_app": return `Launch: ${c.program ?? ""}`;
    default: return step.type;
  }
}