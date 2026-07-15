import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRah } from "@/lib/rah/context";
import { getDB, type CouncilJobRow, type CouncilJobStepRow } from "@/lib/rah/db";
import {
  createJob, transitionJob, transitionStep, canTransition,
  synthesizeProjectReview, seedCouncilJobsIfEmpty,
  COUNCIL_ROLES,
  buildCouncilPrompt, parseAiSynthesisResponse, mergeAiSynthesis,
  councilApprovalDescriptor, buildCouncilMemoryPayload, decideFinalization,
} from "@/lib/rah/councilJobs";
import { listSessions, listCheckpoints, saveCheckpoint } from "@/lib/rah/sessions";
import {
  getLocalAiSettings, isLocalEngine, engineLabel,
  streamLmStudio, streamOllama, checkLocalHealth,
} from "@/lib/rah/localAi";
import { logRavenAudit } from "@/lib/rah/ravenAudit";
import { toast } from "sonner";

function emitCouncilChanged() {
  try { window.dispatchEvent(new Event("rah:council-jobs-changed")); } catch { /* SSR */ }
}
import { Play, Pause, RotateCcw, XCircle, ShieldAlert, ChevronRight, Cpu, Sparkles, ExternalLink } from "lucide-react";

const AI_SYNTH_TOGGLE_KEY = "rah:council:aiSynth:v1";
function readAiSynthToggle(): boolean {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(AI_SYNTH_TOGGLE_KEY) : null;
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch { /* */ }
  // Fallback: default OFF, but honor an existing explicit local-engine
  // preference from prior migration if user already chose local AI.
  return false;
}
function writeAiSynthToggle(v: boolean) {
  try { window.localStorage.setItem(AI_SYNTH_TOGGLE_KEY, v ? "1" : "0"); } catch { /* */ }
}

export const Route = createFileRoute("/council")({
  head: () => ({
    meta: [
      { title: "AI Council — Raven Command" },
      { name: "description", content: "Orchestrated multi-role AI jobs: Project Review, planning, and governance." },
    ],
  }),
  component: CouncilPage,
});

const ROLE_LABEL: Record<string, string> = {
  orchestrator: "Orchestrator / Master Brain",
  researcher: "Researcher",
  designer: "Designer",
  builder: "Builder",
  tester: "Tester",
  memory_governance: "Memory & Governance",
};

function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = {
    draft: "border-border/60",
    queued: "border-border/60 text-muted-foreground",
    running: "border-primary/40 bg-primary/10 text-primary",
    awaiting_approval: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
    testing: "border-blue-500/40 bg-blue-500/10 text-blue-300",
    completed: "border-primary/30 bg-primary/10 text-primary",
    blocked: "border-orange-500/40 bg-orange-500/10 text-orange-300",
    failed: "border-destructive/40 bg-destructive/10 text-destructive",
    cancelled: "border-border/60 text-muted-foreground",
  };
  return (
    <span className={"inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + (map[s] ?? "border-border/60")}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

function CouncilPage() {
  const rah = useRah();
  const [jobs, setJobs] = useState<CouncilJobRow[]>([]);
  const [steps, setSteps] = useState<CouncilJobStepRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [objective, setObjective] = useState("");
  const [aiSynthEnabled, setAiSynthEnabledState] = useState<boolean>(() => readAiSynthToggle());
  const setAiSynthEnabled = useCallback((v: boolean) => { writeAiSynthToggle(v); setAiSynthEnabledState(v); }, []);
  const [detectedProvider, setDetectedProvider] = useState<string>("");
  const [lastProviderNote, setLastProviderNote] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = getLocalAiSettings();
      if (!isLocalEngine(s.engine)) { if (!cancelled) setDetectedProvider(engineLabel(s.engine)); return; }
      try {
        const h = await checkLocalHealth(s);
        if (cancelled) return;
        if (h.ok) setDetectedProvider(`${h.provider} · ${h.model}`);
        else setDetectedProvider(`${engineLabel(s.engine)} — not reachable`);
      } catch {
        if (!cancelled) setDetectedProvider(`${engineLabel(s.engine)} — not reachable`);
      }
    })();
    return () => { cancelled = true; };
  }, [aiSynthEnabled]);

  const reload = useCallback(async () => {
    try {
      const db = await getDB();
      const [j, s] = await Promise.all([db.getAll("councilJobs"), db.getAll("councilJobSteps")]);
      j.sort((a, b) => b.updatedAt - a.updatedAt);
      s.sort((a, b) => a.order - b.order);
      setJobs(j); setSteps(s);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // First-run seed (never overwrites user data).
  useEffect(() => {
    (async () => {
      const db = await getDB();
      const existing = await db.getAll("councilJobs");
      const seeded = seedCouncilJobsIfEmpty(existing);
      if (seeded) {
        await db.put("councilJobs", seeded.job);
        for (const st of seeded.steps) await db.put("councilJobSteps", st);
        await reload();
        emitCouncilChanged();
      }
    })().catch(console.error);
  }, [reload]);

  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null, [jobs, selectedId]);
  const selectedSteps = useMemo(
    () => steps.filter((s) => s.jobId === selected?.id).sort((a, b) => a.order - b.order),
    [steps, selected?.id],
  );

  const onCreate = useCallback(async () => {
    const { job, steps: newSteps } = createJob({
      projectId: rah.activeProject?.id ?? null,
      sessionId: null,
      objective: objective.trim() || `Project Review — ${rah.activeProject?.name ?? "workspace"}`,
      provider: "deterministic",
    });
    const db = await getDB();
    await db.put("councilJobs", job);
    for (const s of newSteps) await db.put("councilJobSteps", s);
    setObjective(""); setCreating(false); setSelectedId(job.id);
    await reload();
    emitCouncilChanged();
    toast.success("Council job created (draft).");
  }, [rah.activeProject, objective, reload]);

  const persistJob = useCallback(async (patch: CouncilJobRow) => {
    const db = await getDB(); await db.put("councilJobs", patch); await reload(); emitCouncilChanged();
  }, [reload]);
  const persistStep = useCallback(async (patch: CouncilJobStepRow) => {
    const db = await getDB(); await db.put("councilJobSteps", patch); await reload(); emitCouncilChanged();
  }, [reload]);

  /** Deterministic Project Review runner. Advances each step in order. */
  const runJob = useCallback(async (job: CouncilJobRow) => {
    try {
      let currentJob = job;
      if (currentJob.status === "draft") {
        currentJob = transitionJob(currentJob, "queued");
        await persistJob(currentJob);
      }
      if (currentJob.status === "queued") {
        currentJob = transitionJob(currentJob, "running");
        await persistJob(currentJob);
        logRavenAudit({ type: "council", source: "council", detail: `Job ${currentJob.id} started`, meta: { jobId: currentJob.id, objective: currentJob.objective } });
      }
      // Build local context packet.
      const sessions = listSessions();
      const checkpoints = listCheckpoints();
      const activeProject = rah.projects.find((p) => p.id === currentJob.projectId) ?? rah.activeProject ?? null;
      const memoryRows = rah.projectMemory.filter((m) => !m.archived && (!currentJob.projectId || m.projectId === currentJob.projectId || m.projectId === null));
      const commandRows = rah.commands.filter((c) => !currentJob.projectId || c.projectId === currentJob.projectId);
      const projectDecisions = new Set(
        rah.decisions
          .filter((d) => !currentJob.projectId || d.projectId === currentJob.projectId)
          .map((d) => d.id),
      );
      const latestByDecision = new Map<string, { id: string; title: string }>();
      for (const v of rah.decisionVersions) {
        if (!projectDecisions.has(v.decisionId)) continue;
        const existing = latestByDecision.get(v.decisionId);
        if (!existing) latestByDecision.set(v.decisionId, { id: v.decisionId, title: v.title });
      }
      const decisions = Array.from(latestByDecision.values());
      const roadmap = rah.roadmapMilestones
        .filter((r) => !currentJob.projectId || r.projectId === currentJob.projectId)
        .map((r) => ({ id: r.id, title: r.title, status: r.status }));
      const deterministic = synthesizeProjectReview({
        project: activeProject ? { name: activeProject.name, description: activeProject.description, status: activeProject.status, currentTask: activeProject.currentTask, nextTask: activeProject.nextTask } : null,
        sessions, checkpoints, memory: memoryRows, decisions, commands: commandRows, roadmap,
      });

      // Optional local-AI rephrasing. Deterministic remains source of truth.
      let synth = deterministic;
      let providerTag: "deterministic" | "ai" = "deterministic";
      let providerLabel = "deterministic";
      if (aiSynthEnabled) {
        const s = getLocalAiSettings();
        if (!isLocalEngine(s.engine)) {
          setLastProviderNote(`AI synthesis skipped: current engine (${engineLabel(s.engine)}) is not a local provider.`);
          logRavenAudit({ type: "council", source: "council", detail: "AI synthesis skipped — non-local engine", meta: { jobId: currentJob.id } });
        } else {
          try {
            const prompt = buildCouncilPrompt({
              projectName: activeProject?.name ?? "(no active project)",
              orchestratorText: deterministic.outputByStepOrder[1],
              researcherText:   deterministic.outputByStepOrder[2],
              designerText:     deterministic.outputByStepOrder[3],
              builderText:      deterministic.outputByStepOrder[4],
              testerText:       deterministic.outputByStepOrder[5],
              governanceText:   deterministic.outputByStepOrder[6],
            });
            const started = Date.now();
            let full = "";
            let capturedProvider = "";
            let capturedModel = "";
            const cb = {
              onStart: (p: { provider: string; model: string }) => { capturedProvider = p.provider; capturedModel = p.model; },
              onDelta: (_d: string, running: string) => { full = running; },
            };
            const streamer = s.engine === "lmstudio" ? streamLmStudio : streamOllama;
            const raw = await streamer(
              { prompt, agents: ["brain"], mode: "fast" as const, context: {} },
              s,
              cb,
            );
            const parsed = parseAiSynthesisResponse(raw || full);
            if (parsed.ok) {
              synth = mergeAiSynthesis(deterministic, parsed.findings);
              providerTag = "ai";
              providerLabel = `${capturedProvider || engineLabel(s.engine)}${capturedModel ? " · " + capturedModel : ""}`;
              setLastProviderNote(`AI synthesis succeeded in ${Date.now() - started}ms via ${providerLabel}.`);
              logRavenAudit({ type: "council", source: "council", detail: "AI synthesis succeeded", meta: { jobId: currentJob.id, provider: providerLabel } });
            } else {
              setLastProviderNote(`AI synthesis fell back to deterministic: ${parsed.reason}.`);
              logRavenAudit({ type: "council", source: "council", detail: `AI synthesis fallback: ${parsed.reason}`, meta: { jobId: currentJob.id } });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setLastProviderNote(`AI synthesis fell back to deterministic: ${msg}.`);
            logRavenAudit({ type: "council", source: "council", detail: `AI synthesis error: ${msg}`, meta: { jobId: currentJob.id } });
          }
        }
      }
      if (currentJob.provider !== providerTag) {
        currentJob = { ...currentJob, provider: providerTag, updatedAt: Date.now() };
        await persistJob(currentJob);
      }

      const orderedSteps = steps
        .filter((s) => s.jobId === currentJob.id)
        .sort((a, b) => a.order - b.order);
      for (const st of orderedSteps) {
        if (st.status === "completed") continue;
        // Governance step requires approval.
        if (st.requiresApproval) {
          const running = transitionStep(st, "running");
          await persistStep(running);
          // Reuse an existing pending approval when re-running to keep this
          // idempotent across reloads.
          const existingApprovalId = (currentJob.approvalIds || []).find((id) =>
            rah.approvals.some((a) => a.id === id && a.status === "pending"),
          );
          let approvalId = existingApprovalId ?? "";
          if (!approvalId) {
            const descriptor = councilApprovalDescriptor(currentJob);
            const approval = await rah.requestApproval(descriptor);
            approvalId = approval.id;
          }
          const awaiting = transitionStep(running, "awaiting_approval", { approvalId });
          await persistStep(awaiting);
          const mergedIds = Array.from(new Set([...(currentJob.approvalIds || []), approvalId]));
          currentJob = transitionJob(currentJob, "awaiting_approval", { currentStepId: st.id, approvalIds: mergedIds });
          await persistJob(currentJob);
          logRavenAudit({ type: "council", source: "council", detail: "Awaiting governance approval", meta: { jobId: currentJob.id, approvalId } });
          toast.info("Governance step requires approval. Review it in Approvals.");
          return;
        }
        const running = transitionStep(st, "running");
        await persistStep(running);
        const output = synth.outputByStepOrder[st.order] ?? "(no output)";
        const done = transitionStep(running, "completed", { output });
        await persistStep(done);
      }
      currentJob = transitionJob(currentJob, "completed", { currentStepId: null, reason: "All steps completed (deterministic synthesis)." });
      await persistJob(currentJob);
      toast.success("Council job completed.");
    } catch (e) {
      toast.error("Council run failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [rah, aiSynthEnabled, steps, persistJob, persistStep]);

  // Idempotent finalizer: reacts to the linked approval status changing in
  // the shared approvals store. Never writes memory / checkpoint twice.
  useEffect(() => {
    (async () => {
      const jobsAwaiting = jobs.filter((j) => j.status === "awaiting_approval");
      for (const job of jobsAwaiting) {
        const approvalId = (job.approvalIds || []).slice(-1)[0];
        const approval = approvalId ? rah.approvals.find((a) => a.id === approvalId) : null;
        const memoryAlreadyExists = rah.projectMemory.some((m) => m.source === `council:${job.id}`);
        const decision = decideFinalization({ job, approval: approval ?? null, memoryAlreadyExists });
        if (decision === "noop") continue;

        const jobSteps = steps.filter((s) => s.jobId === job.id).sort((a, b) => a.order - b.order);
        const govStep = jobSteps.find((s) => s.id === job.currentStepId) ?? jobSteps.find((s) => s.requiresApproval);

        if (decision === "complete") {
          try {
            // Reconstruct synthesis output from the persisted steps so the
            // memory payload matches what was shown to the user.
            const findings = {
              orchestrator: jobSteps[0]?.output ?? "",
              researcher:   jobSteps[1]?.output ?? "",
              designer:     jobSteps[2]?.output ?? "",
              builder: { tasks: [jobSteps[3]?.output ?? ""].filter(Boolean), risk: "low" },
              tester:  { acceptance: [jobSteps[4]?.output ?? ""].filter(Boolean) },
              memory_governance: { summary: `Council review — ${job.objective}` },
            };
            const synth = {
              findings,
              outputByStepOrder: Object.fromEntries(jobSteps.map((s) => [s.order, s.output ?? ""])),
              deterministic: job.provider !== "ai",
            };
            const payload = buildCouncilMemoryPayload(job, synth as never, job.provider === "ai" ? "AI-assisted (local)" : "deterministic");
            if (!memoryAlreadyExists) {
              await rah.createProjectMemory(payload as never);
            }
            try {
              const activeSession = listSessions().find((s) => s.status === "active");
              const existingCheckpoints = listCheckpoints().filter((c) => c.note && c.note.includes(`[council:${job.id}]`));
              if (activeSession && existingCheckpoints.length === 0) {
                saveCheckpoint({
                  sessionId: activeSession.id,
                  projectId: activeSession.projectId,
                  note: `Council Project Review completed: ${job.objective} [council:${job.id}]`,
                  resumeRoute: "/council",
                  nextAction: "Review Builder task list from Council job",
                });
              }
            } catch { /* non-fatal */ }
            if (govStep && govStep.status !== "completed") {
              await persistStep(transitionStep(govStep, "completed", { output: "Approved by user; memory + checkpoint saved." }));
            }
            await persistJob(transitionJob(job, "completed", { currentStepId: null, reason: "User approved governance step." }));
            logRavenAudit({ type: "council", source: "council", detail: "Job approved & finalized", meta: { jobId: job.id, approvalId } });
            toast.success("Council job completed — memory + checkpoint saved.");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logRavenAudit({ type: "council", source: "council", detail: `Finalization error: ${msg}`, meta: { jobId: job.id } });
          }
        } else if (decision === "reject") {
          try {
            if (govStep && govStep.status !== "failed") {
              await persistStep(transitionStep(govStep, "failed", { reason: `Approval ${approval?.status}` }));
            }
            await persistJob(transitionJob(job, "blocked", { reason: `Governance approval ${approval?.status}. No memory written.` }));
            logRavenAudit({ type: "council", source: "council", detail: `Job blocked — approval ${approval?.status}`, meta: { jobId: job.id, approvalId } });
          } catch { /* */ }
        }
      }
    })().catch(console.error);
    // Depend on approvals + jobs so this re-runs on any approval change.
  }, [rah, jobs, steps, persistJob, persistStep]);

  const controlPause = useCallback(async () => {
    if (!selected || !canTransition(selected.status, "blocked")) return;
    await persistJob(transitionJob(selected, "blocked", { reason: "Paused by user." }));
    logRavenAudit({ type: "council", source: "council", detail: "Paused", meta: { jobId: selected.id } });
  }, [selected, persistJob]);
  const controlResume = useCallback(async () => {
    if (!selected || !canTransition(selected.status, "running")) return;
    const resumed = transitionJob(selected, "running", { reason: "Resumed by user." });
    await persistJob(resumed);
    logRavenAudit({ type: "council", source: "council", detail: "Resumed", meta: { jobId: resumed.id } });
    await runJob(resumed);
  }, [selected, persistJob, runJob]);
  const controlCancel = useCallback(async () => {
    if (!selected || !canTransition(selected.status, "cancelled")) return;
    await persistJob(transitionJob(selected, "cancelled", { reason: "Cancelled by user." }));
    logRavenAudit({ type: "council", source: "council", detail: "Cancelled", meta: { jobId: selected.id } });
  }, [selected, persistJob]);
  const controlRetry = useCallback(async () => {
    if (!selected || !canTransition(selected.status, "queued")) return;
    await persistJob(transitionJob(selected, "queued", { reason: "Retried by user." }));
    logRavenAudit({ type: "council", source: "council", detail: "Retry queued", meta: { jobId: selected.id } });
    // Reset failed steps.
    for (const st of selectedSteps) {
      if (st.status === "failed" || st.status === "blocked") {
        await persistStep({ ...st, status: "draft", output: undefined, reason: undefined, updatedAt: Date.now() });
      }
    }
  }, [selected, selectedSteps, persistJob, persistStep]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="display text-3xl gold-text">AI Council</h1>
          <p className="text-muted-foreground">
            Orchestrated multi-role jobs over your local Raven data. Deterministic today; AI-assisted synthesis when a provider is available.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreating((c) => !c)}>
            <Sparkles className="h-4 w-4" /> New Project Review
          </Button>
        </div>
      </header>

      {creating && (
        <section className="glass-panel gold-border p-4 space-y-2">
          <label className="text-sm font-medium">Objective</label>
          <input
            className="w-full rounded border border-border/60 bg-background px-3 py-2 text-sm"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder={`Project Review — ${rah.activeProject?.name ?? "workspace"}`}
            aria-label="Council job objective"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={onCreate}>Create Job</Button>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="glass-panel p-3 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Jobs</h2>
          {jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
          <ul className="space-y-1">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  className={"w-full rounded border px-2 py-2 text-left text-sm " + (selected?.id === j.id ? "border-primary/60 bg-primary/10" : "border-border/60 hover:bg-accent")}
                  onClick={() => setSelectedId(j.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{j.objective}</span>
                    <StatusPill s={j.status} />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {new Date(j.updatedAt).toLocaleString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="glass-panel gold-border p-4 space-y-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select or create a job.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{selected.objective}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusPill s={selected.status} />
                    <span>· kind: {selected.kind}</span>
                    <span>· provider: {selected.provider}</span>
                    {selected.projectId && <span>· project bound</span>}
                  </div>
                  {selected.reason && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <ShieldAlert className="inline h-3 w-3" /> {selected.reason}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status === "draft" || selected.status === "queued" || selected.status === "running" ? (
                    <Button size="sm" onClick={() => runJob(selected)}>
                      <Play className="h-4 w-4" /> Run
                    </Button>
                  ) : null}
                  {selected.status === "awaiting_approval" && (
                    <Button size="sm" asChild>
                      <Link to="/approvals">
                        <ShieldAlert className="h-4 w-4" /> Review in Approvals <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  )}
                  {canTransition(selected.status, "blocked") && (
                    <Button size="sm" variant="outline" onClick={controlPause}>
                      <Pause className="h-4 w-4" /> Pause
                    </Button>
                  )}
                  {canTransition(selected.status, "running") && selected.status !== "draft" && (
                    <Button size="sm" variant="outline" onClick={controlResume}>
                      <Play className="h-4 w-4" /> Resume
                    </Button>
                  )}
                  {canTransition(selected.status, "queued") && (
                    <Button size="sm" variant="outline" onClick={controlRetry}>
                      <RotateCcw className="h-4 w-4" /> Retry
                    </Button>
                  )}
                  {canTransition(selected.status, "cancelled") && (
                    <Button size="sm" variant="ghost" onClick={controlCancel}>
                      <XCircle className="h-4 w-4" /> Cancel
                    </Button>
                  )}
                </div>
              </div>

              <ol className="space-y-2">
                {selectedSteps.map((s) => (
                  <li key={s.id} className="rounded border border-border/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs uppercase tracking-widest text-muted-foreground">{ROLE_LABEL[s.role] ?? s.role}</span>
                          <StatusPill s={s.status} />
                          {s.requiresApproval && (
                            <span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0 text-[10px] uppercase tracking-widest text-yellow-400">approval</span>
                          )}
                        </div>
                        <div className="font-medium">{s.order}. {s.title}</div>
                        {s.dependencies.length > 0 && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            depends on step{s.dependencies.length > 1 ? "s" : ""} above
                          </div>
                        )}
                        {s.output && (
                          <pre className="mt-2 whitespace-pre-wrap rounded bg-background/60 p-2 text-xs">{s.output}</pre>
                        )}
                        {s.reason && <div className="mt-1 text-xs text-destructive">{s.reason}</div>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                Roles: {COUNCIL_ROLES.join(" · ")}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}