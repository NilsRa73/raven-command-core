import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getDB, getPrefs, savePrefs, seedIfEmpty, uid, type Approval, type CommandRecord, type MemoryItem, type Preferences, type Project } from "./db";
import { streamChat } from "./ai";
import { toast } from "sonner";

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
  approvals: Approval[];
  reloadApprovals: () => Promise<void>;
  requestApproval: (a: Omit<Approval, "id" | "createdAt" | "status">) => Promise<Approval>;
  resolveApproval: (id: string, status: "approved" | "rejected" | "cancelled") => Promise<void>;
  runApprovedCommand: (commandId: string) => Promise<void>;
  emergencyStop: () => Promise<void>;
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
  const reloadApprovals = useCallback(async () => {
    const db = await getDB();
    setApprovals((await db.getAll("approvals")).sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await seedIfEmpty();
        const p = await getPrefs();
        setPrefs(p);
        await Promise.all([reloadProjects(), reloadCommands(), reloadMemory(), reloadApprovals()]);
      } finally {
        setReady(true);
      }
    })();
  }, [reloadProjects, reloadCommands, reloadMemory, reloadApprovals]);

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
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("rah:emergency-stop"));
  }, [reloadApprovals]);

  const focusCommandBar = useCallback(() => focusRef.current(), []);
  const registerCommandBarFocus = useCallback((fn: () => void) => {
    focusRef.current = fn;
    return () => { if (focusRef.current === fn) focusRef.current = () => {}; };
  }, []);

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
    approvals, reloadApprovals, requestApproval, resolveApproval,
    runApprovedCommand,
    emergencyStop,
    focusCommandBar, registerCommandBarFocus,
  };

  return <RahContext.Provider value={value}>{children}</RahContext.Provider>;
}