import { useEffect, useMemo, useState, useSyncExternalStore, useCallback } from "react";
import { useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { useRah } from "@/lib/rah/context";
import {
  createSession, deleteSession, deriveTaskQueue, findResumable,
  listCheckpoints, listSessions, saveCheckpoint, setSessionStatus,
  seedSessionsIfEmpty, subscribeSessions, migrateSessionsToIdb,
  type WorkSession, type Checkpoint,
} from "@/lib/rah/sessions";
import { getDB, type CouncilJobRow } from "@/lib/rah/db";
import { deriveCouncilQueue, type CouncilQueueRow } from "@/lib/rah/councilJobs";
import { toast } from "sonner";

type MergedQueueRow =
  | { id: string; status: "queued" | "running" | "awaiting_approval" | "completed" | "failed"; title: string; createdAt: number; source: "command" | "approval" }
  | CouncilQueueRow;

const QUEUE_PRIORITY: Record<string, number> = {
  running: 0, awaiting_approval: 1, queued: 2, failed: 3, completed: 4,
};

function useSessionsStore() {
  const sessions = useSyncExternalStore(subscribeSessions, listSessions, listSessions);
  const checkpoints = useSyncExternalStore(subscribeSessions, listCheckpoints, listCheckpoints);
  return { sessions, checkpoints };
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = {
    running: "bg-primary/20 text-primary border-primary/40",
    queued: "bg-background/60 text-foreground border-border/60",
    awaiting_approval: "bg-yellow-500/10 text-yellow-400 border-yellow-500/40",
    completed: "bg-primary/10 text-primary border-primary/30",
    failed: "bg-destructive/10 text-destructive border-destructive/40",
    active: "bg-primary/10 text-primary border-primary/30",
    paused: "bg-background/60 text-muted-foreground border-border/60",
  };
  return (
    <span className={"inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + (map[s] ?? "border-border/60")}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

export function MissionControlPanel() {
  const rah = useRah();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const { sessions, checkpoints } = useSessionsStore();
  const [councilJobs, setCouncilJobs] = useState<CouncilJobRow[]>([]);

  const reloadCouncil = useCallback(async () => {
    try {
      const db = await getDB();
      const rows = await db.getAll("councilJobs");
      setCouncilJobs(rows);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (!rah.ready) return;
    void reloadCouncil();
    const onFocus = () => { void reloadCouncil(); };
    const onChanged = () => { void reloadCouncil(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("rah:council-jobs-changed", onChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("rah:council-jobs-changed", onChanged);
    };
  }, [rah.ready, reloadCouncil]);

  // First-run seed once projects are loaded.
  useEffect(() => {
    if (!rah.ready) return;
    const byName: Record<string, string> = {};
    for (const p of rah.projects) byName[p.name] = p.id;
    seedSessionsIfEmpty({ byName });
    // One-shot LS→IDB migration (idempotent). Also hydrates IDB→LS when
    // localStorage is empty after a JSON restore.
    void migrateSessionsToIdb().catch(() => { /* non-fatal */ });
  }, [rah.ready, rah.projects]);

  const resumable = useMemo(() => findResumable(), [sessions, checkpoints]);
  const queue = useMemo<MergedQueueRow[]>(() => {
    const base = deriveTaskQueue({ commands: rah.commands, approvals: rah.approvals, limit: 8 }) as MergedQueueRow[];
    const council = deriveCouncilQueue(councilJobs, 8) as MergedQueueRow[];
    const merged = [...base, ...council];
    merged.sort((a, b) => {
      const pa = QUEUE_PRIORITY[a.status] ?? 9;
      const pb = QUEUE_PRIORITY[b.status] ?? 9;
      if (pa !== pb) return pa - pb;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
    return merged.slice(0, 8);
  }, [rah.commands, rah.approvals, councilJobs]);

  const activeSession = useMemo<WorkSession | null>(() => {
    const pid = rah.activeProject?.id ?? null;
    return sessions.find((s) => s.status === "active" && s.projectId === pid)
      ?? sessions.find((s) => s.status === "active") ?? null;
  }, [sessions, rah.activeProject?.id]);

  const sessionCheckpoints: Checkpoint[] = useMemo(
    () => activeSession ? checkpoints.filter((c) => c.sessionId === activeSession.id) : [],
    [activeSession, checkpoints],
  );

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [nextDraft, setNextDraft] = useState("");

  const canCreate = title.trim().length > 0;

  const onCreate = useCallback(() => {
    if (!canCreate) return;
    try {
      const s = createSession({
        projectId: rah.activeProject?.id ?? null,
        title: title.trim(),
        objective: objective.trim(),
      });
      setTitle(""); setObjective(""); setCreating(false);
      toast.success("Session started", { description: s.title });
    } catch (e) {
      toast.error("Could not start session", { description: (e as Error).message });
    }
  }, [canCreate, title, objective, rah.activeProject?.id]);

  const onCheckpoint = useCallback(() => {
    if (!activeSession) return;
    try {
      saveCheckpoint({
        sessionId: activeSession.id,
        projectId: activeSession.projectId,
        note: noteDraft.trim() || "Manual checkpoint",
        nextAction: nextDraft.trim() || undefined,
        resumeRoute: currentPath || "/",
        module: "mission-control",
      });
      setNoteDraft(""); setNextDraft("");
      toast.success("Checkpoint saved");
    } catch (e) {
      toast.error("Could not save checkpoint", { description: (e as Error).message });
    }
  }, [activeSession, noteDraft, nextDraft, currentPath]);

  const onComplete = useCallback(() => {
    if (!activeSession) return;
    setSessionStatus(activeSession.id, "completed");
    toast.message("Session marked complete", { description: activeSession.title });
  }, [activeSession]);

  const onResume = useCallback(async () => {
    if (!resumable) return;
    // Restore project context if the checkpoint session is scoped to one.
    const pid = resumable.session.projectId;
    if (pid && rah.activeProject?.id !== pid) {
      try { await rah.setActiveProject(pid); } catch { /* ignore */ }
    }
    setSessionStatus(resumable.session.id, "active");
    toast.success("Resuming session", { description: resumable.reason });
    const route = resumable.resumeRoute || "/";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to: route as any }).catch(() => navigate({ to: "/" }));
  }, [resumable, rah, navigate]);

  return (
    <section className="glass-panel gold-border p-4" aria-label="Mission Control">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Mission Control</div>
          <h2 className="display gold-text text-lg">Sessions & Checkpoints</h2>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onResume}
            disabled={!resumable}
            aria-disabled={!resumable}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            title={resumable ? resumable.reason : "No resumable session yet — save a checkpoint to enable this."}
          >
            ⏮ Continue Yesterday
          </button>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="inline-flex h-9 items-center rounded-md border border-border/70 px-3 text-sm hover:border-primary/60"
          >
            {creating ? "Cancel" : "+ New session"}
          </button>
        </div>
      </div>

      {resumable && (
        <p className="mt-2 text-xs text-muted-foreground">
          Continue will restore <span className="text-foreground">{resumable.session.title}</span>
          {resumable.session.projectId ? " (project context)" : ""} and open
          <code className="mx-1 rounded bg-background/60 px-1">{resumable.resumeRoute}</code>.
          {resumable.checkpoint?.nextAction ? <> Next: <span className="text-foreground">{resumable.checkpoint.nextAction}</span>.</> : null}
        </p>
      )}

      {creating && (
        <div className="mt-3 grid gap-2 rounded-md border border-border/60 bg-background/40 p-3 md:grid-cols-2">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Session title *</span>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Ship Mission Control v0.4"
              className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Objective</span>
            <input
              value={objective} onChange={(e) => setObjective(e.target.value)}
              placeholder="What does 'done' look like?"
              className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <div className="md:col-span-2 flex items-center gap-2">
            <button
              type="button" onClick={onCreate} disabled={!canCreate}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Start session
            </button>
            <span className="text-[11px] text-muted-foreground">
              Any existing active session for {rah.activeProject ? rah.activeProject.name : "no project"} will be paused.
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {/* Active session + checkpoint tools */}
        <div className="rounded-md border border-border/60 bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Active session</h3>
            {activeSession && <StatusPill s={activeSession.status} />}
          </div>
          {!activeSession ? (
            <p className="text-xs text-muted-foreground">
              No active session. Click <em>New session</em> to start one — checkpoints and Continue Yesterday depend on it.
            </p>
          ) : (
            <div className="space-y-2">
              <div>
                <div className="text-sm text-foreground truncate">{activeSession.title}</div>
                {activeSession.objective && <div className="text-xs text-muted-foreground">{activeSession.objective}</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button" onClick={onCheckpoint}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                >
                  💾 Save checkpoint
                </button>
                <button
                  type="button" onClick={() => { setSessionStatus(activeSession.id, "paused"); toast.message("Session paused"); }}
                  className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60"
                >
                  ⏸ Pause
                </button>
                <button
                  type="button" onClick={onComplete}
                  className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60"
                >
                  ✓ Mark complete
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="mb-1 block text-muted-foreground">Checkpoint note</span>
                  <input
                    value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="What was just done?"
                    className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-muted-foreground">Next action on resume</span>
                  <input
                    value={nextDraft} onChange={(e) => setNextDraft(e.target.value)}
                    placeholder="What to do first tomorrow?"
                    className="w-full rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60"
                  />
                </label>
              </div>
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Recent checkpoints</div>
                {sessionCheckpoints.length === 0 ? (
                  <div className="text-xs text-muted-foreground mt-1">No checkpoints yet.</div>
                ) : (
                  <ul className="mt-1 divide-y divide-border/60">
                    {sessionCheckpoints.slice(0, 4).map((c) => (
                      <li key={c.id} className="py-1.5 text-xs">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[10px] text-muted-foreground min-w-[64px]">
                            {new Date(c.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className="truncate">{c.note}</span>
                        </div>
                        {c.nextAction && <div className="ml-16 text-[11px] text-primary/80 truncate">→ {c.nextAction}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* All sessions */}
        <div className="rounded-md border border-border/60 bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">All sessions</h3>
            <Link to="/projects" className="ml-auto text-[11px] text-primary hover:underline">Change project</Link>
          </div>
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sessions yet.</p>
          ) : (
            <ul className="divide-y divide-border/60 max-h-64 overflow-auto">
              {sessions.map((s) => (
                <li key={s.id} className="py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="truncate min-w-0 flex-1 text-foreground" title={s.title}>{s.title}</span>
                    <StatusPill s={s.status} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                    {s.objective && <span className="truncate">· {s.objective}</span>}
                    <button
                      type="button"
                      onClick={() => { if (confirm("Delete session and its checkpoints?")) deleteSession(s.id); }}
                      className="ml-auto text-destructive hover:underline"
                      aria-label={"Delete session " + s.title}
                    >
                      delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Command / task queue */}
        <div className="rounded-md border border-border/60 bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Task queue</h3>
            <Link to="/history" className="ml-auto text-[11px] text-primary hover:underline">Full history</Link>
          </div>
          {queue.length === 0 ? (
            <p className="text-xs text-muted-foreground">Queue is empty. Send a command or request an approval to populate it.</p>
          ) : (
            <ul className="divide-y divide-border/60 max-h-64 overflow-auto">
              {queue.map((r) => (
                <li key={r.source + ":" + r.id} className="py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <StatusPill s={r.status} />
                    {r.source === "council" ? (
                      <Link to="/council" className="truncate min-w-0 flex-1 hover:underline" title={r.title}>{r.title}</Link>
                    ) : (
                      <span className="truncate min-w-0 flex-1" title={r.title}>{r.title}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {r.source} · {r.createdAt ? new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}