import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildContextPacket } from "@/lib/rah/ravenMode";
import { getRavenModeState } from "@/lib/rah/ravenModeStore";
import { useRah as _useRahForProject } from "@/lib/rah/context";
void _useRahForProject;
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Play, Save, Trash2, Plus, Download, Upload, ShieldAlert, Pause, RotateCcw, Ban, Check, X, FlaskConical, GitBranch } from "lucide-react";
import { getDB } from "@/lib/rah/db";
import { useRah } from "@/lib/rah/context";
import { useBridgeStatus } from "@/lib/rah/bridgeStatus";
import { bridgeCapabilities } from "@/lib/rah/bridge";
import {
  STEP_CATALOG, EXECUTION_PROFILES,
  createWorkflow, createStep, createRun,
  validateWorkflow, planDryRun, availableControls, transitionRun,
  appendEvent, verifyEventChain,
  exportWorkflowJson, importWorkflowJson,
  type Workflow, type WorkflowRun, type WorkflowStep, type StepType,
} from "@/lib/rah/workflow";

export const Route = createFileRoute("/automations")({
  head: () => ({ meta: [{ title: "Automations — Raven Command" }] }),
  component: AutomationsPage,
});

const STEP_ORDER: StepType[] = [
  "ai_prompt", "wait_manual", "save_memory", "chronicle_entry",
  "bridge_read_file", "bridge_write_file", "bridge_launch_url", "bridge_launch_app", "final_summary",
];

function AutomationsPage() {
  const rah = useRah();
  const bridge = useBridgeStatus();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isDraftUnsaved, setIsDraftUnsaved] = useState(false);
  const [dryRunPlan, setDryRunPlan] = useState<ReturnType<typeof planDryRun> | null>(null);
  const [caps, setCaps] = useState<string[]>([]);

  const reloadAll = useCallback(async () => {
    const db = await getDB();
    const [ws, rs] = await Promise.all([db.getAll("workflows"), db.getAll("workflowRuns")]);
    setWorkflows(ws.sort((a, b) => b.updatedAt - a.updatedAt));
    setRuns(rs.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => { void reloadAll(); }, [reloadAll]);
  useEffect(() => {
    if (isDraftUnsaved) return; // don't clobber an in-memory new-workflow draft
    if (selectedId) {
      // If switching from an unsaved new draft to an existing workflow,
      // this effect runs; guard against clobbering handled in click handler.
      const wf = workflows.find((w) => w.id === selectedId) ?? null;
      if (wf) {
        setDraft(structuredClone(wf));
        setDirty(false);
        setIsDraftUnsaved(false);
        setDryRunPlan(null);
      }
    } else {
      setDraft(null);
      setIsDraftUnsaved(false);
    }
  }, [selectedId, workflows, isDraftUnsaved]);

  // Fetch real capabilities from bridge for honest dry-run gating.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (bridge.snapshot?.ui !== "paired_online") { if (alive) setCaps([]); return; }
      try {
        const c = await bridgeCapabilities();
        const disabled = new Set(c?.disabled ?? []);
        const list = Object.entries(c?.capabilities ?? {})
          .filter(([id, spec]) => !disabled.has(id as never) && !(spec as { disabled?: boolean }).disabled)
          .map(([id]) => id);
        if (alive) setCaps(list);
      } catch {
        if (alive) setCaps([]);
      }
    })();
    return () => { alive = false; };
  }, [bridge.snapshot?.ui]);

  const bridgeCtx = useMemo(() => ({
    status: bridge.snapshot?.ui ?? "unknown",
    features: bridge.snapshot?.features ?? [],
    capabilities: caps,
  }), [bridge.snapshot, caps]);

  const validation = useMemo(() => (draft ? validateWorkflow(draft) : null), [draft]);

  const patchDraft = (patch: Partial<Workflow>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const patchStep = (id: string, config: WorkflowStep["config"]) => {
    if (!draft) return;
    setDraft({ ...draft, steps: draft.steps.map((s) => s.id === id ? { ...s, config: { ...s.config, ...config } } : s) });
    setDirty(true);
  };
  const moveStep = (id: string, dir: -1 | 1) => {
    if (!draft) return;
    const i = draft.steps.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= draft.steps.length) return;
    const steps = draft.steps.slice();
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({ ...draft, steps });
    setDirty(true);
  };
  const removeStep = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, steps: draft.steps.filter((s) => s.id !== id) });
    setDirty(true);
  };
  const addStep = (type: StepType) => {
    if (!draft) return;
    setDraft({ ...draft, steps: [...draft.steps, createStep(type)] });
    setDirty(true);
  };

  function handleCreate() {
    if (dirty && !confirm("Discard unsaved changes to the current workflow?")) return;
    // In-memory draft only. Nothing is written to IndexedDB until the user
    // clicks Save. Enforces no-silent-save.
    const wf = createWorkflow({ name: "New workflow", steps: [createStep("ai_prompt", { prompt: "" })] });
    setSelectedId(null);
    setDraft(wf);
    setDirty(true);
    setIsDraftUnsaved(true);
    setDryRunPlan(null);
    toast.message("New workflow draft — click Save to persist.");
  }
  async function handleSave() {
    if (!draft) return;
    const v = validateWorkflow(draft);
    if (!v.ok) { toast.error(v.errors[0]); return; }
    const next = { ...draft, updatedAt: Date.now() };
    const db = await getDB();
    await db.put("workflows", next);
    setDirty(false);
    setIsDraftUnsaved(false);
    await reloadAll();
    setSelectedId(next.id);
    toast.success("Workflow saved.");
  }
  async function handleDelete() {
    if (!draft) return;
    if (isDraftUnsaved) {
      // Unsaved draft — just discard from memory, no db call.
      setDraft(null); setSelectedId(null); setDirty(false); setIsDraftUnsaved(false);
      toast.message("Draft discarded.");
      return;
    }
    if (!confirm(`Delete workflow "${draft.name}"? This does not delete existing run history.`)) return;
    const db = await getDB();
    await db.delete("workflows", draft.id);
    setSelectedId(null);
    await reloadAll();
    toast.success("Workflow deleted.");
  }
  async function handleExport() {
    if (!draft) return;
    const blob = new Blob([exportWorkflowJson(draft)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.raven-workflow.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function handleImport(file: File) {
    if ((dirty || isDraftUnsaved) && !confirm("Discard unsaved changes to the current workflow?")) return;
    try {
      const text = await file.text();
      const wf = importWorkflowJson(text);
      const db = await getDB();
      await db.put("workflows", wf);
      await reloadAll();
      setDirty(false);
      setIsDraftUnsaved(false);
      setSelectedId(wf.id);
      toast.success(`Imported "${wf.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  }

  function handleDryRun() {
    if (!draft) return;
    const plan = planDryRun(draft, { bridge: bridgeCtx });
    setDryRunPlan(plan);
    toast.message("Dry run planned. No side effects executed.");
  }

  // Warn on hard page unload while a draft has unsaved changes.
  useEffect(() => {
    if (!(dirty || isDraftUnsaved)) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, isDraftUnsaved]);

  // Fast/Deep packet preview — same builder the executor uses at run-time,
  // so what you see here is what the AI will actually receive.
  const packetPreview = useMemo(() => {
    if (!draft) return null;
    try {
      const rs = getRavenModeState();
      return buildContextPacket(rah.projectMemory, {
        mode: draft.executionProfile === "deep" ? "deep" : "fast",
        projectId: draft.projectId ?? null,
        pinnedIds: rs.pinnedIds,
        excludedIds: rs.excludedIds,
      });
    } catch { return null; }
  }, [draft, rah.projectMemory]);

  async function handleStartRun() {
    if (!draft) return;
    if (isDraftUnsaved) { toast.error("Save the workflow before running."); return; }
    const v = validateWorkflow(draft);
    if (!v.ok) { toast.error(v.errors[0]); return; }
    if (dirty) { toast.error("Save the workflow before running."); return; }

    const db = await getDB();
    let run = createRun(draft);
    run.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: draft.id, type: "run.created",
      actor: "user", nextState: "draft",
    });
    const queued = transitionRun(run, "queued");
    queued.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: draft.id, type: "run.queued",
      actor: "user", prevState: "draft", nextState: "queued",
    });
    await db.put("workflowRuns", queued);
    await reloadAll();
    // Hand off to the real executor. It handles per-step approval requests,
    // sequential execution, hash-chained events, and safe pause/cancel.
    void rah.workflowRun(queued.runId).then(reloadAll);
    toast.success("Run started. Side-effect steps will request per-step approval.");
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="display text-3xl gold-text">Automations</h1>
          <p className="text-muted-foreground">
            Local-first workflows. Every side-effect requires explicit approval. Every run
            writes to an append-only, hash-chained, tamper-evident local log.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={handleCreate}><Plus className="h-4 w-4" /> New workflow</Button>
          <label className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm cursor-pointer hover:bg-accent">
            <Upload className="h-4 w-4" /> Import
            <input type="file" accept="application/json" className="hidden"
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImport(f); e.currentTarget.value = ""; }} />
          </label>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="glass-panel p-3 space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground px-2 py-1">Workflows</div>
          {workflows.length === 0 && <div className="text-sm text-muted-foreground px-2 py-4">No workflows yet.</div>}
          {workflows.map((w) => {
            const runCount = runs.filter((r) => r.workflowId === w.id).length;
            return (
              <button key={w.id} onClick={() => {
                if ((dirty || isDraftUnsaved) && !confirm("Discard unsaved changes to the current workflow?")) return;
                setIsDraftUnsaved(false);
                setDirty(false);
                setSelectedId(w.id);
              }}
                className={`w-full text-left rounded-md px-2 py-2 text-sm hover:bg-accent ${selectedId === w.id ? "bg-accent" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{w.name}</span>
                  <Badge variant="outline" className="text-[10px]">{w.executionProfile}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{w.steps.length} step{w.steps.length !== 1 ? "s" : ""} · {runCount} run{runCount !== 1 ? "s" : ""}</div>
              </button>
            );
          })}
        </aside>

        <section className="space-y-6">
          {!draft && (
            <div className="glass-panel p-8 text-center text-muted-foreground">
              Select a workflow on the left, or create a new one to begin.
            </div>
          )}
          {draft && (
            <>
              <div className="glass-panel gold-border p-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                  <div>
                    <label className="text-xs uppercase text-muted-foreground">Name</label>
                    <Input value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs uppercase text-muted-foreground">Execution profile</label>
                    <Select value={draft.executionProfile} onValueChange={(v) => patchDraft({ executionProfile: v as Workflow["executionProfile"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EXECUTION_PROFILES.map((p) => (
                          <SelectItem key={p} value={p}>{p === "fast" ? "Fast — pinned memory only" : "Deep — full project DNA + memory"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-xs uppercase text-muted-foreground">Description</label>
                  <Textarea rows={2} value={draft.description} onChange={(e) => patchDraft({ description: e.target.value })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleSave} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button>
                  <Button variant="outline" onClick={handleDryRun}><FlaskConical className="h-4 w-4" /> Dry Run</Button>
                  <Button onClick={handleStartRun} disabled={dirty || !validation?.ok}><Play className="h-4 w-4" /> Run</Button>
                  <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4" /> Export</Button>
                  <Button variant="destructive" onClick={handleDelete} className="ml-auto"><Trash2 className="h-4 w-4" /> Delete</Button>
                </div>
                {dirty && <p className="text-xs text-amber-500">Unsaved changes. Save before running.</p>}
                {validation && !validation.ok && (
                  <ul className="text-xs text-red-500 space-y-0.5">
                    {validation.errors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                )}
                {validation?.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-500 flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> {w}</p>
                ))}
              </div>

              <div className="glass-panel p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Steps</h2>
                  <div className="flex gap-2">
                    <Select onValueChange={(v) => addStep(v as StepType)}>
                      <SelectTrigger className="w-[220px]"><SelectValue placeholder="Add step…" /></SelectTrigger>
                      <SelectContent>
                        {STEP_ORDER.map((t) => (
                          <SelectItem key={t} value={t}>{STEP_CATALOG[t].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {draft.steps.length === 0 && (
                  <p className="text-sm text-muted-foreground">Add at least one step to run this workflow.</p>
                )}
                <ol className="space-y-2">
                  {draft.steps.map((s, idx) => {
                    const cat = STEP_CATALOG[s.type];
                    return (
                      <li key={s.id} className="rounded-md border border-border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
                          <span className="font-medium">{cat.label}</span>
                          <Badge variant="outline" className="text-[10px]">{cat.risk}</Badge>
                          {cat.sideEffect && <Badge className="text-[10px]" variant="secondary">side effect</Badge>}
                          {cat.requiresBridgeCapability && <Badge className="text-[10px]" variant="secondary">bridge</Badge>}
                          <div className="ml-auto flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => moveStep(s.id, -1)} disabled={idx === 0}>↑</Button>
                            <Button size="sm" variant="ghost" onClick={() => moveStep(s.id, 1)} disabled={idx === draft.steps.length - 1}>↓</Button>
                            <Button size="sm" variant="ghost" onClick={() => removeStep(s.id)}><X className="h-4 w-4" /></Button>
                          </div>
                        </div>
                        <StepEditor step={s} onChange={(c) => patchStep(s.id, c)} />
                      </li>
                    );
                  })}
                </ol>
              </div>

              {packetPreview && (
                <div className="glass-panel p-4 space-y-2">
                  <h2 className="font-semibold flex items-center gap-2">
                    <FlaskConical className="h-4 w-4" /> Context packet preview ({packetPreview.mode})
                  </h2>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                    <span>selected: {packetPreview.selectedIds.length}</span>
                    <span>~tokens: {packetPreview.approxTokens}</span>
                    <span>parity: {packetPreview.parityId}</span>
                    <span>hash: {packetPreview.packetHash}</span>
                  </div>
                  <pre className="text-[11px] bg-black/40 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">{packetPreview.text}</pre>
                  <p className="text-[10px] text-muted-foreground">This is the exact context block the executor will build when this workflow runs. Project name/goals are prepended when a project is selected.</p>
                </div>
              )}

              {dryRunPlan && (
                <div className="glass-panel p-4 space-y-2">
                  <h2 className="font-semibold flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Dry Run Plan</h2>
                  <p className="text-xs text-muted-foreground">No side effects executed. Blocked bridge steps are surfaced explicitly.</p>
                  <ol className="space-y-1 text-sm">
                    {dryRunPlan.steps.map((p) => (
                      <li key={p.id} className={`rounded-md border p-2 ${p.blocked ? "border-red-500/50" : "border-border"}`}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.index + 1}. {p.label}</span>
                          {p.blocked && <Badge variant="destructive" className="text-[10px]">blocked</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.preview}</div>
                        {p.blockedReason && <div className="text-xs text-red-500">{p.blockedReason}</div>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <RunsPanel workflow={draft} runs={runs.filter((r) => r.workflowId === draft.id)} onReload={reloadAll} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function StepEditor({ step, onChange }: { step: WorkflowStep; onChange: (c: WorkflowStep["config"]) => void }) {
  const c = step.config;
  switch (step.type) {
    case "ai_prompt":
    case "final_summary":
      return <Textarea rows={3} placeholder="Prompt for the model" value={String(c.prompt ?? "")} onChange={(e) => onChange({ prompt: e.target.value })} />;
    case "save_memory":
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Memory title" value={String(c.title ?? "")} onChange={(e) => onChange({ title: e.target.value })} />
          <Input placeholder="Content (optional — model output used if empty)" value={String(c.content ?? "")} onChange={(e) => onChange({ content: e.target.value })} />
        </div>
      );
    case "chronicle_entry":
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Chronicle title" value={String(c.title ?? "")} onChange={(e) => onChange({ title: e.target.value })} />
          <Input placeholder="Detail (optional)" value={String(c.content ?? "")} onChange={(e) => onChange({ content: e.target.value })} />
        </div>
      );
    case "bridge_read_file":
    case "bridge_write_file":
      return <Input placeholder="Absolute path within allowed roots" value={String(c.path ?? "")} onChange={(e) => onChange({ path: e.target.value })} />;
    case "bridge_launch_url":
      return <Input placeholder="https://…" value={String(c.url ?? "")} onChange={(e) => onChange({ url: e.target.value })} />;
    case "bridge_launch_app":
      return <Input placeholder="Program name (bridge policy applies)" value={String(c.program ?? "")} onChange={(e) => onChange({ program: e.target.value })} />;
    case "wait_manual":
      return <Input placeholder="Note for the checkpoint" value={String(c.note ?? "")} onChange={(e) => onChange({ note: e.target.value })} />;
    default:
      return null;
  }
}

function RunsPanel({ workflow, runs, onReload }: { workflow: Workflow; runs: WorkflowRun[]; onReload: () => Promise<void> }) {
  const rah = useRah();
  const [chainStatus, setChainStatus] = useState<Record<string, "ok" | "bad" | null>>({});
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  async function verifyRun(run: WorkflowRun) {
    const v = await verifyEventChain(run.events);
    setChainStatus((s) => ({ ...s, [run.runId]: v.ok ? "ok" : "bad" }));
  }

  async function cancelRun(run: WorkflowRun) {
    await rah.workflowCancel(run.runId);
    await onReload();
    toast.message("Run cancelled.");
  }
  async function pauseRun(run: WorkflowRun) {
    await rah.workflowPause(run.runId);
    await onReload();
    toast.message("Run paused.");
  }
  async function resumeRun(run: WorkflowRun) {
    await onReload();
    void rah.workflowResume(run.runId).then(onReload);
    toast.success("Run resumed.");
  }
  async function retryRun(run: WorkflowRun) {
    await onReload();
    void rah.workflowRetry(run.runId).then(onReload);
    toast.success("Run re-queued.");
  }
  async function startNewRun() {
    const db = await getDB();
    let run = createRun(workflow);
    run.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: workflow.id, type: "run.created",
      actor: "user", nextState: "draft",
    });
    const queued = transitionRun(run, "queued");
    queued.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: workflow.id, type: "run.queued",
      actor: "user", prevState: "draft", nextState: "queued",
    });
    await db.put("workflowRuns", queued);
    await onReload();
    void rah.workflowRun(queued.runId).then(onReload);
    toast.success("New run started.");
  }

  return (
    <div className="glass-panel p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><GitBranch className="h-4 w-4" /> Runs</h2>
      {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
      <ul className="space-y-2">
        {runs.map((r) => {
          const ctrls = availableControls(r.status);
          return (
            <li key={r.runId} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                {r.dryRun && <Badge variant="secondary" className="text-[10px]">dry-run</Badge>}
                <span className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()} · {r.events.length} events
                </span>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void verifyRun(r)}>
                    {chainStatus[r.runId] === "ok" ? <Check className="h-4 w-4 text-emerald-500" />
                     : chainStatus[r.runId] === "bad" ? <ShieldAlert className="h-4 w-4 text-red-500" />
                     : "Verify chain"}
                  </Button>
                  {ctrls.includes("pause") && (
                    <Button size="sm" variant="ghost" title="Pause" onClick={() => void pauseRun(r)}><Pause className="h-4 w-4" /></Button>
                  )}
                  {ctrls.includes("resume") && (
                    <Button size="sm" variant="ghost" title="Resume" onClick={() => void resumeRun(r)}><Play className="h-4 w-4" /></Button>
                  )}
                  {ctrls.includes("retry") && (
                    <Button size="sm" variant="ghost" title="Retry" onClick={() => void retryRun(r)}><RotateCcw className="h-4 w-4" /></Button>
                  )}
                  {ctrls.includes("startNew") && (
                    <Button size="sm" variant="ghost" title="New run" onClick={() => void startNewRun()}><Plus className="h-4 w-4" /></Button>
                  )}
                  {ctrls.includes("cancel") && (
                    <Button size="sm" variant="ghost" onClick={() => void cancelRun(r)}><Ban className="h-4 w-4" /></Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setSelectedRun(selectedRun === r.runId ? null : r.runId)}>
                    {selectedRun === r.runId ? "Hide details" : "Inspect"}
                  </Button>
                  <Button size="sm" variant="ghost" title="Export run as JSON" onClick={() => {
                    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `run-${r.runId}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}><Download className="h-4 w-4" /></Button>
                </div>
              </div>
              {(r.failureReason || r.provider) && (
                <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3">
                  {r.provider && <span>engine: {r.provider}{r.model ? ` · ${r.model}` : ""}</span>}
                  {r.failureReason && <span className="text-destructive">reason: {r.failureReason}</span>}
                </div>
              )}
              {selectedRun === r.runId && <RunDetails run={r} workflow={workflow} />}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">Event log is append-only, hash-chained, and tamper-evident (SHA-256 of each entry links to the previous). It is not cryptographically signed and the local database can still be replaced. "Verify chain" recomputes hashes locally.</p>
    </div>
  );
}

function fmtTime(t: number | null | undefined): string {
  if (!t) return "—";
  try { return new Date(t).toLocaleString(); } catch { return String(t); }
}
function fmtDuration(a: number | null | undefined, b: number | null | undefined): string {
  if (!a || !b) return "—";
  const ms = b - a;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60_000)}m ${Math.round((ms%60_000)/1000)}s`;
}

function RunDetails({ run, workflow }: { run: WorkflowRun; workflow: Workflow }) {
  const totalSteps = workflow.steps.length;
  const done = Math.min(run.currentStepIndex, totalSteps);
  const pct = totalSteps ? Math.round((done / totalSteps) * 100) : 0;
  const currentStep = workflow.steps[run.currentStepIndex] ?? null;
  const elapsed = fmtDuration(run.startedAt, run.finishedAt ?? Date.now());
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 text-xs">
        <div><span className="text-muted-foreground">Run ID:</span> <span className="font-mono">{run.runId}</span></div>
        <div><span className="text-muted-foreground">Status:</span> {run.status}</div>
        <div><span className="text-muted-foreground">Progress:</span> {done}/{totalSteps} ({pct}%)</div>
        <div><span className="text-muted-foreground">Current step:</span> {currentStep ? `${run.currentStepIndex + 1}. ${STEP_CATALOG[currentStep.type]?.label ?? currentStep.type}` : "—"}</div>
        <div><span className="text-muted-foreground">Engine:</span> {run.engine ?? "—"} / {run.provider ?? "—"}</div>
        <div><span className="text-muted-foreground">Model:</span> {run.model ?? "—"}</div>
        <div><span className="text-muted-foreground">Transport:</span> {run.transport ?? "—"}</div>
        <div><span className="text-muted-foreground">Created:</span> {fmtTime(run.createdAt)}</div>
        <div><span className="text-muted-foreground">Started:</span> {fmtTime(run.startedAt)}</div>
        <div><span className="text-muted-foreground">Finished:</span> {fmtTime(run.finishedAt)}</div>
        <div><span className="text-muted-foreground">Elapsed:</span> {elapsed}</div>
        {run.failureReason && (
          <div className="text-destructive md:col-span-2 lg:col-span-3">
            <span className="text-muted-foreground">Reason:</span> {run.failureReason}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Per-step results</div>
        <ol className="space-y-2 text-xs bg-black/30 rounded p-2 max-h-96 overflow-auto">
          {run.stepResults.length === 0 && <li className="text-muted-foreground">No steps executed yet.</li>}
          {run.stepResults.map((sr) => {
            const dur = sr.finishedAt && sr.startedAt ? sr.finishedAt - sr.startedAt : null;
            const stepDef = workflow.steps.find((s) => s.id === sr.stepId);
            const label = stepDef ? STEP_CATALOG[stepDef.type]?.label ?? stepDef.type : sr.stepId;
            return (
              <li key={sr.stepId} className="rounded border border-border/60 p-2 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Badge variant="outline" className="text-[9px]">{sr.status}</Badge>
                  <span className="font-medium">{label}</span>
                  <span className="font-mono text-muted-foreground">{sr.stepId}</span>
                  {dur != null && <span className="text-[10px] text-muted-foreground">{dur}ms</span>}
                  {sr.approvalId && <span className="text-[10px]">approval: <span className="font-mono">{sr.approvalId}</span></span>}
                </div>
                {sr.error && (
                  <pre className="text-destructive whitespace-pre-wrap bg-black/30 rounded p-1 text-[11px]">{sr.error}</pre>
                )}
                {sr.output && (
                  <pre className="whitespace-pre-wrap bg-black/20 rounded p-1 text-[11px] max-h-48 overflow-auto">{String(sr.output)}</pre>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Event log ({run.events.length})</div>
        <ol className="space-y-1 text-[11px] font-mono bg-black/40 rounded p-2 max-h-72 overflow-auto">
          {run.events.map((e) => (
            <li key={e.id}>
              <div>
                #{e.seq} {new Date(e.ts).toISOString().slice(11, 19)} {e.type} {e.prevState ?? ""}→{e.nextState ?? ""} <span className="text-muted-foreground">{e.hash.slice(0, 12)}…</span>
              </div>
              {e.metadata != null && (
                <pre className="pl-4 whitespace-pre-wrap text-muted-foreground">{JSON.stringify(e.metadata, null, 0)}</pre>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
