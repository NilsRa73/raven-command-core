import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [dryRunPlan, setDryRunPlan] = useState<ReturnType<typeof planDryRun> | null>(null);

  const reloadAll = useCallback(async () => {
    const db = await getDB();
    const [ws, rs] = await Promise.all([db.getAll("workflows"), db.getAll("workflowRuns")]);
    setWorkflows(ws.sort((a, b) => b.updatedAt - a.updatedAt));
    setRuns(rs.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => { void reloadAll(); }, [reloadAll]);
  useEffect(() => {
    if (selectedId) {
      const wf = workflows.find((w) => w.id === selectedId) ?? null;
      setDraft(wf ? structuredClone(wf) : null);
      setDirty(false);
      setDryRunPlan(null);
    } else {
      setDraft(null);
    }
  }, [selectedId, workflows]);

  const bridgeCtx = useMemo(() => ({
    status: bridge.snapshot?.ui ?? "unknown",
    features: bridge.snapshot?.features ?? [],
    capabilities: [] as string[],
  }), [bridge.snapshot]);

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

  async function handleCreate() {
    const wf = createWorkflow({ name: "New workflow", steps: [createStep("ai_prompt", { prompt: "" })] });
    const db = await getDB();
    await db.put("workflows", wf);
    await reloadAll();
    setSelectedId(wf.id);
    toast.success("Workflow created (draft, not yet saved edits).");
  }
  async function handleSave() {
    if (!draft) return;
    const v = validateWorkflow(draft);
    if (!v.ok) { toast.error(v.errors[0]); return; }
    const next = { ...draft, updatedAt: Date.now() };
    const db = await getDB();
    await db.put("workflows", next);
    setDirty(false);
    await reloadAll();
    toast.success("Workflow saved.");
  }
  async function handleDelete() {
    if (!draft) return;
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
    try {
      const text = await file.text();
      const wf = importWorkflowJson(text);
      const db = await getDB();
      await db.put("workflows", wf);
      await reloadAll();
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

  async function handleStartRun() {
    if (!draft) return;
    const v = validateWorkflow(draft);
    if (!v.ok) { toast.error(v.errors[0]); return; }
    if (dirty) { toast.error("Save the workflow before running."); return; }

    const db = await getDB();
    let run = createRun(draft);
    run.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: draft.id, type: "run.created",
      actor: "user", nextState: "draft",
    });
    // Queue → running (or awaiting_approval if any side-effect step exists)
    const needsApproval = draft.steps.some((s) => STEP_CATALOG[s.type]?.requiresApproval);
    const queued = transitionRun(run, "queued");
    queued.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: draft.id, type: "run.queued",
      actor: "user", prevState: "draft", nextState: "queued",
    });
    run = queued;

    if (needsApproval) {
      const approval = await rah.requestApproval({
        title: `Run workflow: ${draft.name}`,
        reason: "This workflow contains side-effecting steps (memory writes, chronicle entries, or bridge actions).",
        tools: draft.steps.map((s) => STEP_CATALOG[s.type]?.label ?? s.type),
        dataShared: draft.projectId ? ["active project context", "pinned memory"] : ["pinned memory"],
        expectedResult: `Execute ${draft.steps.length} step(s) once. Approval is one-shot.`,
        risk: draft.steps.some((s) => STEP_CATALOG[s.type]?.risk === "high") ? "high"
             : draft.steps.some((s) => STEP_CATALOG[s.type]?.risk === "medium") ? "medium" : "low",
        category: "workflow",
        undo: "Cancel the run at any time. Immutable event log records every step.",
      });
      run.approvalIds.push(approval.id);
      const gated = transitionRun(run, "awaiting_approval");
      gated.events = await appendEvent(run.events, {
        runId: run.runId, workflowId: draft.id, type: "run.awaiting_approval",
        actor: "system", prevState: "queued", nextState: "awaiting_approval",
        metadata: { approvalId: approval.id },
      });
      run = gated;
      await db.put("workflowRuns", run);
      await reloadAll();
      toast.message("Approval requested. Approve it in Approvals to start the run.");
      return;
    }

    // No side-effects → move to completed after logging plan (this is an inference-only run).
    const running = transitionRun(run, "running");
    running.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: draft.id, type: "run.started",
      actor: "system", prevState: "queued", nextState: "running",
    });
    const completed = transitionRun(running, "completed");
    completed.events = await appendEvent(running.events, {
      runId: run.runId, workflowId: draft.id, type: "run.completed",
      actor: "system", prevState: "running", nextState: "completed",
      metadata: { note: "Deterministic run plan recorded. Attach an AI executor to run inference." },
    });
    await db.put("workflowRuns", completed);
    await reloadAll();
    toast.success("Run recorded.");
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="display text-3xl gold-text">Automations</h1>
          <p className="text-muted-foreground">
            Local-first workflows. Every side-effect requires explicit approval. Every run
            writes to an immutable, hash-chained event log.
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
              <button key={w.id} onClick={() => setSelectedId(w.id)}
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

              <RunsPanel runs={runs.filter((r) => r.workflowId === draft.id)} onReload={reloadAll} />
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

function RunsPanel({ runs, onReload }: { runs: WorkflowRun[]; onReload: () => Promise<void> }) {
  const [chainStatus, setChainStatus] = useState<Record<string, "ok" | "bad" | null>>({});
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  async function verifyRun(run: WorkflowRun) {
    const v = await verifyEventChain(run.events);
    setChainStatus((s) => ({ ...s, [run.runId]: v.ok ? "ok" : "bad" }));
  }

  async function cancelRun(run: WorkflowRun) {
    if (!["draft","queued","awaiting_approval","running","paused"].includes(run.status)) return;
    const db = await getDB();
    const next = transitionRun(run, "cancelled");
    next.events = await appendEvent(run.events, {
      runId: run.runId, workflowId: run.workflowId, type: "run.cancelled",
      actor: "user", prevState: run.status, nextState: "cancelled",
    });
    await db.put("workflowRuns", next);
    await onReload();
    toast.message("Run cancelled.");
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
                  {ctrls.includes("cancel") && (
                    <Button size="sm" variant="ghost" onClick={() => void cancelRun(r)}><Ban className="h-4 w-4" /></Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setSelectedRun(selectedRun === r.runId ? null : r.runId)}>
                    {selectedRun === r.runId ? "Hide log" : "View log"}
                  </Button>
                </div>
              </div>
              {selectedRun === r.runId && (
                <ol className="space-y-1 text-xs font-mono bg-black/40 rounded p-2 max-h-60 overflow-auto">
                  {r.events.map((e) => (
                    <li key={e.id}>
                      #{e.seq} {new Date(e.ts).toISOString()} {e.type} {e.prevState ?? ""}→{e.nextState ?? ""} <span className="text-muted-foreground">{e.hash.slice(0, 12)}…</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">Event log is append-only and hash-chained (SHA-256 of each entry links to the previous). "Verify chain" recomputes hashes locally.</p>
      <div className="hidden"><Pause /><RotateCcw /></div>
    </div>
  );
}
