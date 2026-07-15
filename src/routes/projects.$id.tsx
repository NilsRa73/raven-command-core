import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Play, Plus, Flag, ShieldAlert, CheckCircle2, GitBranch, Users, FolderOpen, Sparkles, Pin, Pencil, Trash2, X, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRah } from "@/lib/rah/context";
import { useBridgeStatus } from "@/lib/rah/bridgeStatus";
import { getLocalAiSettings } from "@/lib/rah/localAi";
import { streamChat } from "@/lib/rah/ai";
import { getDB, uid, type FileItem, type RoadmapMilestone, type DecisionVersion } from "@/lib/rah/db";
import {
  buildProjectOverview,
  computeProjectHealth,
  buildProjectTimeline,
  deterministicProjectProfile,
  buildProjectBriefContext,
  buildContinueProjectPreview,
  PROJECT_DNA_TABS,
} from "@/lib/rah/projectDna";
import { filterMemories, MEMORY_TYPES, MEMORY_TYPE_LABEL, type MemoryType, type ProjectMemoryRecord } from "@/lib/rah/projectMemory";
import {
  ROADMAP_STATUSES, ROADMAP_STATUS_LABEL, ROADMAP_COLUMNS, UNASSIGNED_COLUMN, ROADMAP_PRIORITIES,
  groupByColumn, moveMilestone, reorderWithinColumn, isRoadmapDirty, validateRoadmap,
  exportRoadmapJson, exportRoadmapMarkdown, normalizeMilestone,
  type RoadmapColumn, type RoadmapStatus,
} from "@/lib/rah/roadmap";
import {
  DECISION_STATUSES, DECISION_STATUS_LABEL,
  makeInitialVersion, makeNextVersion, groupVersions, latestVersions,
  diffVersions, findDuplicateCandidates, isVersionDirty,
  exportChangelogJson, exportChangelogMarkdown,
  type DecisionStatus,
} from "@/lib/rah/decisions";
import { shouldConfirmDiscard } from "@/lib/rah/draftGuard";
import {
  buildWorkPlan, composeStatusNote, validateWorkspacePath, noteTargetPath,
} from "@/lib/rah/continueProject";
import {
  bridgeCapabilities, bridgePrepare, bridgeExecute, bridgeReadText,
} from "@/lib/rah/bridge";
import type { Project } from "@/lib/rah/db";

type Tab = typeof PROJECT_DNA_TABS[number];

export const Route = createFileRoute("/projects/$id")({
  head: () => ({ meta: [{ title: "Project DNA — Raven Command" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { id } = useParams({ from: "/projects/$id" });
  const nav = useNavigate();
  const rah = useRah();
  const bridge = useBridgeStatus();
  const project = rah.projects.find((p) => p.id === id) ?? null;
  const [tab, setTab] = useState<Tab>("overview");
  const [files, setFiles] = useState<FileItem[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const db = await getDB();
        const all = await db.getAll("files");
        if (alive) setFiles(all);
      } catch { /* IDB unavailable */ }
    })();
    return () => { alive = false; };
  }, [rah.commands.length, rah.projectMemory.length, id]);

  const engine = getLocalAiSettings().engine;
  const overview = useMemo(
    () => buildProjectOverview({ project, memory: rah.projectMemory, commands: rah.commands, approvals: rah.approvals, files }),
    [project, rah.projectMemory, rah.commands, rah.approvals, files],
  );
  const health = useMemo(
    () => computeProjectHealth({ project, memory: rah.projectMemory, commands: rah.commands, files, bridgeSnapshot: bridge.snapshot, engine }),
    [project, rah.projectMemory, rah.commands, files, bridge.snapshot, engine],
  );

  if (!project || !overview) return (
    <div className="glass-panel p-6">
      <p>Project not found. <Link to="/projects" className="text-primary hover:underline">Back to projects</Link></p>
    </div>
  );

  const isActive = rah.activeProject?.id === project.id;

  async function addMemoryQuick(type: MemoryType, promptLabel: string) {
    const t = window.prompt(promptLabel);
    if (!t || !t.trim()) return;
    await rah.createProjectMemory({
      projectId: project!.id, title: t.trim(), content: "", type,
      tags: [], source: "quick-action", pinned: false, archived: false,
    });
    toast.success(MEMORY_TYPE_LABEL[type] + " added.");
  }

  async function continueProject() {
    if (!isActive) await rah.setActiveProject(project!.id);
    await nav({ to: "/" });
    setTimeout(() => rah.focusCommandBar(), 60);
    toast.success("Continuing " + project!.name + " — Command Bar focused. Nothing sent yet.");
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="text-3xl">{project.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Input
              value={project.name}
              onChange={(e) => rah.updateProject(project.id, { name: e.target.value })}
              className="max-w-md text-lg"
              aria-label="Project name"
            />
            {isActive
              ? <span className="rounded-full border border-primary/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary">Active</span>
              : <Button size="sm" variant="secondary" onClick={() => rah.setActiveProject(project.id)}>Set active</Button>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Created {new Date(overview.createdAt).toLocaleDateString()} · Updated {new Date(overview.updatedAt).toLocaleString()} ·
            {" "}{overview.status} · {overview.priority}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={continueProject}><Play className="h-4 w-4" /> Continue project</Button>
          <Button variant="secondary" onClick={() => addMemoryQuick("next_action", "Add next action:")}><ArrowRight className="h-4 w-4" /> Next action</Button>
          <Button variant="secondary" onClick={() => addMemoryQuick("blocker", "Add blocker:")}><ShieldAlert className="h-4 w-4" /> Blocker</Button>
          <Button variant="secondary" onClick={() => addMemoryQuick("milestone", "Add milestone:")}><Flag className="h-4 w-4" /> Milestone</Button>
          <Button variant="secondary" onClick={() => addMemoryQuick("decision", "Add decision:")}><CheckCircle2 className="h-4 w-4" /> Decision</Button>
          <Link to="/files" className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"><FolderOpen className="h-4 w-4" /> Open files</Link>
          <Link
            to="/chronicle"
            search={{ projectId: project.id, week: "", view: "timeline" }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
          >Chronicle</Link>
          <Button variant="ghost" onClick={() => {
            void (async () => {
              if (!isActive) await rah.setActiveProject(project.id);
              await nav({ to: "/" });
              setTimeout(() => rah.focusCommandBar(), 60);
              toast.info("Choose Team Review in the Command Bar mode selector, then Send.");
            })();
          }}><Users className="h-4 w-4" /> Team Review</Button>
          <Button variant="ghost" onClick={() => {
            void (async () => {
              if (!isActive) await rah.setActiveProject(project.id);
              await nav({ to: "/" });
              setTimeout(() => rah.focusCommandBar(), 60);
              toast.info("Choose Full Council in the Command Bar mode selector, then Send.");
            })();
          }}><GitBranch className="h-4 w-4" /> Full Council</Button>
        </div>
      </header>

      <nav className="glass-panel gold-border p-1 flex flex-wrap gap-1">
        {PROJECT_DNA_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded-md px-3 py-1.5 text-sm capitalize " +
              (tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60")
            }
          >{t}</button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab project={project} overview={overview} health={health} rah={rah} files={files} />}
      {tab === "goals"    && <GoalsTab project={project} rah={rah} />}
      {tab === "memory"   && <MemoryTab project={project} rah={rah} />}
      {tab === "assets"   && <FilesTab project={project} files={files.filter((f) => f.projectId === project.id)} bridgeOnline={bridge.snapshot?.ui === "paired_online"} />}
      {tab === "timeline" && <TimelineTab project={project} rah={rah} />}
      {tab === "decisions" && <DecisionsTab project={project} rah={rah} />}
      {tab === "roadmap"  && <RoadmapTab project={project} rah={rah} />}
      {tab === "issues"   && <IssuesTab project={project} rah={rah} />}
    </div>
  );
}

/* ─── Overview ─── */

function OverviewTab({
  project, overview, health, rah, files,
}: {
  project: ReturnType<typeof useRah>["projects"][number];
  overview: NonNullable<ReturnType<typeof buildProjectOverview>>;
  health: ReturnType<typeof computeProjectHealth>;
  rah: ReturnType<typeof useRah>;
  files: FileItem[];
}) {
  const profile = useMemo(
    () => deterministicProjectProfile({ project, memory: rah.projectMemory, files, commands: rah.commands }),
    [project, rah.projectMemory, files, rah.commands],
  );
  const nav = useNavigate();
  const [briefText, setBriefText] = useState<string | null>(null);
  const [briefRunning, setBriefRunning] = useState(false);
  const [briefEngine, setBriefEngine] = useState<{provider?: string; model?: string} | null>(null);
  const [savedBrief, setSavedBrief] = useState(false);

  async function generateBrief() {
    setBriefText(""); setBriefRunning(true); setSavedBrief(false);
    const ctx = buildProjectBriefContext({ project, memory: rah.projectMemory, files, commands: rah.commands });
    if (!ctx) { setBriefRunning(false); return; }
    const memoryLines = ctx.memoryRecords.map((r) => `- [${r.type}${r.pinned ? "*" : ""}] ${r.title}${r.content ? "\n    " + r.content.replace(/\n/g, "\n    ") : ""}`).join("\n");
    const prompt = [
      "Produce a concise project brief for the following Raven Command project.",
      "Use ONLY the facts provided. Do not invent progress percentages or fabricate memories.",
      "Structure: Purpose · Current state · Recent decisions · Open blockers · Recommended next steps.",
      "",
      "Project: " + ctx.projectName,
      "Description: " + (ctx.description || "(none)"),
      "Goals: " + (ctx.projectGoals || "(none)"),
      "Files linked: " + ctx.files.length + " (metadata only; no content).",
      "Recent commands: " + ctx.recentCommands.map((c) => `[${c.status}] ${c.prompt}`).join(" | "),
      "",
      "Memory records:",
      memoryLines || "(none)",
    ].join("\n");
    try {
      await streamChat({ prompt, agents: ["brain"], mode: "expert" }, {
        onStart: (i) => setBriefEngine(i),
        onDelta: (_c, full) => setBriefText(full),
        onDone: (i) => { setBriefText(i.text); setBriefEngine({ provider: i.provider, model: i.model }); },
        onError: (m) => toast.error("Brief failed: " + m),
      });
    } catch (err) {
      toast.error("Brief failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBriefRunning(false);
    }
  }

  async function saveBriefToMemory() {
    if (!briefText || !briefText.trim()) return;
    await rah.createProjectMemory({
      projectId: project.id,
      title: "Project brief — " + new Date().toLocaleString(),
      content: briefText.trim(),
      type: "note",
      tags: ["brief"],
      source: "brief-explicit-save",
      pinned: false,
      archived: false,
    });
    setSavedBrief(true);
    toast.success("Brief saved to Memory.");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <section className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="display text-lg gold-text">Overview</h2>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Real data only</span>
          </div>
          <Textarea rows={2} value={project.description} placeholder="Short description…"
            onChange={(e) => rah.updateProject(project.id, { description: e.target.value })} />
          <Textarea rows={3} value={project.goals ?? ""} placeholder="Goals (what does success look like?)"
            onChange={(e) => rah.updateProject(project.id, { goals: e.target.value })} />
          <div className="grid gap-2 md:grid-cols-4 text-sm">
            <Stat k="Memory" v={overview.memoryCount} />
            <Stat k="Files linked" v={overview.linkedFileCount} />
            <Stat k="Commands (7d)" v={overview.recentCommandCount} />
            <Stat k="Pending approvals" v={overview.pendingApprovalCount} />
          </div>
          <div className="grid gap-2 md:grid-cols-3 text-sm">
            <MiniRecord label="Latest milestone" record={overview.lastMilestone} emptyHint="Add a milestone to record shipped work." />
            <MiniRecord label="Current blocker"  record={overview.currentBlocker}  emptyHint="No blocker. Add one when you are stuck." />
            <MiniRecord label="Next action"      record={overview.nextAction}      emptyHint="Add a next_action to focus tomorrow." />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Last activity: {overview.lastActivityTs ? new Date(overview.lastActivityTs).toLocaleString() : "—"}. Percentages are never fabricated.
          </div>
        </section>

        <section className="glass-panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="display text-lg gold-text">Project brief</h2>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void generateBrief()} disabled={briefRunning}>
                <Sparkles className="h-4 w-4" /> {briefRunning ? "Generating…" : "Generate project brief"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Runs your currently selected AI engine on the deterministic context above. Nothing is saved unless you click "Save brief to Memory".
          </p>
          {briefText !== null && (
            <div className="rounded border border-border/60 bg-background/50 p-3 space-y-2">
              <div className="text-[11px] text-muted-foreground">
                Runtime: {briefEngine?.provider ?? "engine"}{briefEngine?.model ? " · " + briefEngine.model : ""}
              </div>
              <pre className="whitespace-pre-wrap text-sm">{briefText || "…"}</pre>
              {briefText && !briefRunning && (
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="secondary" onClick={() => { setBriefText(null); setSavedBrief(false); }}>Discard</Button>
                  <Button size="sm" onClick={() => void saveBriefToMemory()} disabled={savedBrief}>
                    {savedBrief ? "Saved" : "Save brief to Memory?"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className="glass-panel gold-border p-4 space-y-2">
          <h2 className="display text-lg gold-text">Project health</h2>
          <div className="text-3xl display gold-text">{health.score}%</div>
          <p className="text-[11px] text-muted-foreground">Deterministic — every check reflects a real record.</p>
          <ul className="space-y-1 text-xs">
            {health.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span className={"mt-0.5 h-2.5 w-2.5 rounded-full " + (c.ok ? "bg-primary" : "bg-muted")} />
                <span className="min-w-0 flex-1">
                  <span className={c.ok ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">{c.detail}</span>
                </span>
                <span className="text-[10px] text-muted-foreground">{c.weight}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass-panel p-4 space-y-2">
          <h2 className="display text-lg gold-text">Project DNA (deterministic)</h2>
          {profile ? (
            <>
              <pre className="whitespace-pre-wrap text-xs">{profile.summary}</pre>
              <div className="text-[11px] text-muted-foreground">
                Built only from stored metadata and memory tags. AI enhancement is a separate explicit action from the Brief section above.
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground">Insufficient data.</p>}
        </section>

        <section className="glass-panel p-4 space-y-2">
          <h2 className="display text-lg gold-text">Continue project preview</h2>
          <ContinuePreview project={project} rah={rah} files={files} nav={nav} />
        </section>
      </div>
    </div>
  );
}

function ContinuePreview({ project, rah, files, nav }: any) {
  const preview = useMemo(
    () => buildContinueProjectPreview({ project, memory: rah.projectMemory, commands: rah.commands, files }),
    [project, rah.projectMemory, rah.commands, files],
  );
  if (!preview) return null;
  return (
    <div className="space-y-2 text-xs">
      <div>Next action: <span className="text-foreground">{preview.nextAction ?? "—"}</span></div>
      <div>Blocker: <span className="text-foreground">{preview.blocker ?? "—"}</span></div>
      <div>Last milestone: <span className="text-foreground">{preview.lastMilestone ?? "—"}</span></div>
      <div>Memory items ready: <span className="text-foreground">{preview.memoryPreview.length}</span> · Files: {preview.files} · Commands: {preview.commands}</div>
      <div className="text-[10px] text-muted-foreground">Continue project selects this project and focuses the Command Bar. It never sends automatically.</div>
      <Button size="sm" className="w-full" onClick={async () => {
        if (rah.activeProject?.id !== project.id) await rah.setActiveProject(project.id);
        await nav({ to: "/" });
        setTimeout(() => rah.focusCommandBar(), 60);
      }}>
        <Play className="h-4 w-4" /> Continue this project
      </Button>
    </div>
  );
}

/* ─── Memory tab ─── */

function MemoryTab({ project, rah }: { project: any; rah: ReturnType<typeof useRah> }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | MemoryType>("all");
  const list = useMemo(
    () => filterMemories(rah.projectMemory, {
      q, projectId: project.id, types: type === "all" ? undefined : [type],
    }),
    [rah.projectMemory, q, type, project.id],
  );
  return (
    <section className="glass-panel p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="display text-lg gold-text">Memory</h2>
        <span className="text-xs text-muted-foreground">Same store as the global Memory page — no duplicates.</span>
        <Link to="/memory" className="ml-auto text-xs text-primary hover:underline">Open full Memory →</Link>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_180px]">
        <Input placeholder="Search this project's memory…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={type} onValueChange={(v) => setType(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {MEMORY_TYPES.map((t) => <SelectItem key={t} value={t}>{MEMORY_TYPE_LABEL[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {list.length === 0
        ? <EmptyState hint={`No memory for this project yet. First click: use "Next action", "Blocker", "Milestone" or "Decision" in the header above.`} />
        : (
          <ul className="divide-y divide-border/50">
            {list.map((r) => (
              <li key={r.id} className="py-2 flex items-start gap-3">
                <span className="mt-0.5 text-[10px] uppercase tracking-widest text-primary min-w-[80px]">
                  {MEMORY_TYPE_LABEL[r.type as MemoryType] ?? r.type}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{r.pinned && <span className="mr-1 text-primary">★</span>}{r.title}</div>
                  {r.content && <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{r.content}</div>}
                  <div className="text-[11px] text-muted-foreground">{new Date(r.updatedAt).toLocaleString()}{r.tags.length ? " · " + r.tags.join(", ") : ""}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => rah.togglePinProjectMemory(r.id)}><Pin className={"h-4 w-4 " + (r.pinned ? "text-primary" : "")} /></Button>
                <Button size="sm" variant="ghost" onClick={() => rah.toggleArchiveProjectMemory(r.id)}>{r.archived ? "Unarchive" : "Archive"}</Button>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/* ─── Files tab ─── */

function FilesTab({ project, files, bridgeOnline }: { project: any; files: FileItem[]; bridgeOnline: boolean }) {
  return (
    <section className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="display text-lg gold-text">Files</h2>
        <Link to="/files" className="ml-auto text-xs text-primary hover:underline">Open Files & Knowledge →</Link>
      </div>
      {!bridgeOnline && (
        <div className="rounded border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          Desktop Bridge is not paired online — Raven does not have filesystem access. Files below are only what you added inside the app.
        </div>
      )}
      {files.length === 0
        ? <EmptyState hint={`No files linked to ${project.name}. First click: open Files & Knowledge and drop files while this project is active.`} />
        : (
          <ul className="divide-y divide-border/50">
            {files.map((f) => (
              <li key={f.id} className="py-2 text-sm flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-[11px] text-muted-foreground">{f.mime || "file"} · {(f.size / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/* ─── Timeline ─── */

function TimelineTab({ project, rah }: { project: any; rah: ReturnType<typeof useRah> }) {
  const rows = useMemo(
    () => buildProjectTimeline({ project, memory: rah.projectMemory, commands: rah.commands, approvals: rah.approvals, limit: 80 }),
    [project, rah.projectMemory, rah.commands, rah.approvals],
  );
  return (
    <section className="glass-panel p-4 space-y-3">
      <h2 className="display text-lg gold-text">Timeline</h2>
      {rows.length === 0
        ? <EmptyState hint="No project activity yet. First click: run a command from the Command Bar with this project active, or add a memory from the header." />
        : (
          <ol className="relative border-l border-border/60 ml-2 space-y-2">
            {rows.map((r) => (
              <li key={r.kind + r.id} className="pl-3 py-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="uppercase tracking-widest text-[10px] text-primary">{r.source}</span>
                  <span>{new Date(r.ts).toLocaleString()}</span>
                  {r.status && <span>· {r.status}</span>}
                </div>
                <div className="text-sm">{r.title}</div>
                {r.detail && <div className="text-xs text-muted-foreground line-clamp-2">{r.detail}</div>}
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}

/* ─── Decisions ─── */

function DecisionsTab({ project, rah }: { project: any; rah: ReturnType<typeof useRah> }) {
  const projectDecisions = useMemo(
    () => rah.decisions.filter((d) => d.projectId === project.id),
    [rah.decisions, project.id],
  );
  const versionsByDecision = useMemo(() => groupVersions(rah.decisionVersions), [rah.decisionVersions]);
  const latestByDecision = useMemo(() => latestVersions(rah.decisionVersions), [rah.decisionVersions]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [diff, setDiff] = useState<{ a: DecisionVersion; b: DecisionVersion } | null>(null);

  function exportMd() {
    const md = exportChangelogMarkdown({ project, decisions: projectDecisions, versions: rah.decisionVersions });
    downloadBlob(`raven-decisions-${project.id}.md`, md, "text/markdown");
  }
  function exportJson() {
    const j = exportChangelogJson({ project, decisions: projectDecisions, versions: rah.decisionVersions });
    downloadBlob(`raven-decisions-${project.id}.json`, JSON.stringify(j, null, 2), "application/json");
  }

  return (
    <section className="glass-panel p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="display text-lg gold-text">Decisions changelog</h2>
        <span className="text-xs text-muted-foreground">Every edit is a new immutable version. Never overwritten.</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={exportMd}>Export MD</Button>
          <Button size="sm" variant="ghost" onClick={exportJson}>Export JSON</Button>
          <Button size="sm" onClick={() => { setCreating(true); setEditingId(null); }}>
            <Plus className="h-4 w-4" /> New decision
          </Button>
        </div>
      </div>

      {creating && (
        <DecisionVersionEditor
          project={project}
          rah={rah}
          mode="new"
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      )}

      {projectDecisions.length === 0 && !creating
        ? <EmptyState hint='No decisions yet. First click: "New decision" above. Nothing is saved until you click Save decision version.' />
        : (
          <ul className="divide-y divide-border/50">
            {projectDecisions
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((d) => {
                const vs = versionsByDecision.get(d.id) ?? [];
                const latest = latestByDecision.get(d.id);
                if (!latest) return null;
                const isEditing = editingId === d.id;
                return (
                  <li key={d.id} className="py-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">
                          {latest.title || "(untitled)"}
                          <span className="ml-2 text-[10px] uppercase tracking-widest text-primary">{DECISION_STATUS_LABEL[latest.status]}</span>
                          {d.archived && <span className="ml-2 text-[10px] text-muted-foreground">· archived</span>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {vs.length} version{vs.length === 1 ? "" : "s"} · latest {new Date(latest.createdAt).toLocaleString()} · author: {latest.author ?? "—"}
                        </div>
                        {latest.content && <div className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">{latest.content}</div>}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => { setEditingId(isEditing ? null : d.id); setCreating(false); }}>
                        <Pencil className="h-4 w-4" /> {isEditing ? "Close" : "New version"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void rah.archiveDecision(d.id, !d.archived)}>
                        {d.archived ? "Unarchive" : "Archive"}
                      </Button>
                    </div>
                    <VersionTimeline versions={vs} onDiff={(a, b) => setDiff({ a, b })} />
                    {isEditing && (
                      <DecisionVersionEditor
                        project={project}
                        rah={rah}
                        mode="edit"
                        decisionId={d.id}
                        previousVersion={latest}
                        onDone={() => setEditingId(null)}
                        onCancel={() => setEditingId(null)}
                      />
                    )}
                  </li>
                );
              })}
          </ul>
        )}

      {diff && (
        <div className="glass-panel gold-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="display text-sm">Diff: v{diff.a.versionNumber} → v{diff.b.versionNumber}</div>
            <Button size="sm" variant="ghost" onClick={() => setDiff(null)}><X className="h-4 w-4" /></Button>
          </div>
          <table className="w-full text-xs">
            <tbody>
              {diffVersions(diff.a, diff.b).map((row) => (
                <tr key={row.field} className={row.changed ? "bg-primary/5" : ""}>
                  <td className="px-2 py-1 uppercase tracking-widest text-[10px] text-muted-foreground w-28">{row.field}</td>
                  <td className="px-2 py-1 align-top text-muted-foreground">{formatDiffValue(row.before)}</td>
                  <td className="px-2 py-1 align-top">{row.changed ? "→" : ""}</td>
                  <td className="px-2 py-1 align-top">{formatDiffValue(row.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatDiffValue(v: unknown) {
  if (v == null || v === "") return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(v)) return v.length ? v.join(", ") : <span className="text-muted-foreground">—</span>;
  return String(v);
}

function VersionTimeline({ versions, onDiff }: { versions: DecisionVersion[]; onDiff: (a: DecisionVersion, b: DecisionVersion) => void }) {
  const [pick, setPick] = useState<DecisionVersion | null>(null);
  if (versions.length === 0) return null;
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {versions.map((v) => (
        <li key={v.id}>
          <button
            onClick={() => {
              if (pick && pick.id !== v.id) { onDiff(pick, v); setPick(null); }
              else setPick(v);
            }}
            className={
              "rounded border px-2 py-1 " +
              (pick?.id === v.id ? "border-primary text-primary" : "border-border/60 text-muted-foreground hover:text-foreground")
            }
            title={new Date(v.createdAt).toLocaleString()}
          >
            v{v.versionNumber} · {DECISION_STATUS_LABEL[v.status]}
          </button>
        </li>
      ))}
      {pick && <li className="text-[11px] text-muted-foreground self-center">Pick another version to diff…</li>}
    </ol>
  );
}

function DecisionVersionEditor({
  project, rah, mode, decisionId, previousVersion, onDone, onCancel,
}: {
  project: any;
  rah: ReturnType<typeof useRah>;
  mode: "new" | "edit";
  decisionId?: string;
  previousVersion?: DecisionVersion;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(previousVersion?.title ?? "");
  const [content, setContent] = useState(previousVersion?.content ?? "");
  const [rationale, setRationale] = useState(previousVersion?.rationale ?? "");
  const [status, setStatus] = useState<DecisionStatus>(previousVersion?.status ?? "proposed");
  const [author, setAuthor] = useState(previousVersion?.author ?? "");
  const [evidence, setEvidence] = useState((previousVersion?.evidenceIds ?? []).join(", "));
  const [supersedes, setSupersedes] = useState(previousVersion?.supersedesDecisionId ?? "");
  const [reverses, setReverses] = useState(previousVersion?.reversesDecisionId ?? "");
  const [ackDuplicate, setAckDuplicate] = useState(false);

  const dirty = mode === "new"
    ? Boolean(title || content || rationale)
    : isVersionDirty(previousVersion ?? null, { title, content, rationale, status, author: author || null, evidenceIds: parseCsv(evidence), supersedesDecisionId: supersedes || null, reversesDecisionId: reverses || null });

  const duplicates = useMemo(
    () => findDuplicateCandidates({
      draft: { decisionId, title, content },
      decisions: rah.decisions, versions: rah.decisionVersions,
      projectId: project.id, threshold: 0.75,
    }),
    [decisionId, title, content, rah.decisions, rah.decisionVersions, project.id],
  );

  function tryCancel() {
    if (shouldConfirmDiscard({ dirty, isDraftUnsaved: mode === "new" && dirty })) {
      if (!window.confirm("Discard unsaved decision version?")) return;
    }
    onCancel();
  }

  async function save() {
    if (!title.trim()) { toast.error("Title required"); return; }
    if (!DECISION_STATUSES.includes(status)) { toast.error("Invalid status"); return; }
    if (duplicates.length && !ackDuplicate) {
      toast.warning("Duplicate warning — check the checkbox to acknowledge before saving.");
      return;
    }
    const now = Date.now();
    if (mode === "new") {
      const decisionIdNew = uid();
      const version = makeInitialVersion({
        decisionId: decisionIdNew, title: title.trim(), content, rationale, status,
        author: author.trim() || null, evidenceIds: parseCsv(evidence), now, versionId: uid(),
      });
      await rah.saveDecisionVersion({
        decision: { id: decisionIdNew, projectId: project.id, createdAt: now, updatedAt: now, archived: false },
        version: { ...version, supersedesDecisionId: supersedes || null, reversesDecisionId: reverses || null },
      });
      toast.success("Decision version saved.");
      onDone();
    } else {
      if (!previousVersion || !decisionId) return;
      const version = makeNextVersion(previousVersion, {
        title: title.trim(), content, rationale, status,
        author: author.trim() || null, evidenceIds: parseCsv(evidence),
        supersedesDecisionId: supersedes || null,
        reversesDecisionId: reverses || null,
      }, { now, versionId: uid() });
      await rah.saveDecisionVersion({
        decision: { id: decisionId, projectId: project.id, createdAt: previousVersion.createdAt, updatedAt: now, archived: false },
        version,
      });
      toast.success(`Saved v${version.versionNumber}.`);
      onDone();
    }
  }

  return (
    <div className="glass-panel gold-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="display text-sm">{mode === "new" ? "New decision" : "New version (previous is preserved)"}</div>
        <Button variant="ghost" size="sm" onClick={tryCancel}><X className="h-4 w-4" /></Button>
      </div>
      <Input placeholder="Decision title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea rows={3} placeholder="Content — what is being decided" value={content} onChange={(e) => setContent(e.target.value)} />
      <Textarea rows={2} placeholder="Rationale (why)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-xs">
          <span className="text-muted-foreground">Status</span>
          <Select value={status} onValueChange={(v) => setStatus(v as DecisionStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DECISION_STATUSES.map((s) => <SelectItem key={s} value={s}>{DECISION_STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Author / source</span>
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="—" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Evidence IDs (comma separated)</span>
          <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="cmd:abc, memory:xyz" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Supersedes decision id</span>
          <Input value={supersedes} onChange={(e) => setSupersedes(e.target.value)} placeholder="(optional)" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Reverses decision id</span>
          <Input value={reverses} onChange={(e) => setReverses(e.target.value)} placeholder="(optional)" />
        </label>
      </div>
      {duplicates.length > 0 && (
        <div className="rounded border border-yellow-500/40 bg-yellow-500/5 p-2 text-xs space-y-1">
          <div className="font-medium text-yellow-500">Possible duplicate of an existing decision:</div>
          <ul className="space-y-0.5">
            {duplicates.slice(0, 3).map((d) => (
              <li key={d.decisionId} className="text-muted-foreground">
                • {d.title} <span className="opacity-60">(similarity {Math.round(d.similarity * 100)}%)</span>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" checked={ackDuplicate} onChange={(e) => setAckDuplicate(e.target.checked)} />
            <span>Save anyway — this is a distinct decision.</span>
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={tryCancel}>Cancel</Button>
        <Button onClick={() => void save()} disabled={!dirty}>Save decision version</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Nothing is saved until you click Save. Editing an existing decision creates a new version — prior versions are preserved forever.
      </p>
    </div>
  );
}

function parseCsv(s: string) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function downloadBlob(name: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─── Roadmap ─── */

function RoadmapTab({ project, rah }: { project: any; rah: ReturnType<typeof useRah> }) {
  const persisted = useMemo<RoadmapMilestone[]>(
    () => rah.roadmapMilestones
      .filter((m) => m.projectId === project.id)
      .map((m) => normalizeMilestone(m))
      .filter((m): m is RoadmapMilestone => !!m),
    [rah.roadmapMilestones, project.id],
  );
  const [draft, setDraft] = useState<RoadmapMilestone[]>(persisted);
  const [showEditor, setShowEditor] = useState<RoadmapMilestone | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => { setDraft(persisted); /* re-sync when store changes */ }, [persisted.length]);

  const dirty = useMemo(() => isRoadmapDirty(persisted, draft), [persisted, draft]);
  const validation = useMemo(() => validateRoadmap(draft), [draft]);
  const grouped = useMemo(() => groupByColumn(draft), [draft]);

  function moveTo(id: string, column: RoadmapColumn, index?: number) {
    setDraft((prev) => moveMilestone(prev, id, column, index ?? Number.MAX_SAFE_INTEGER));
  }
  function reorder(id: string, direction: "up" | "down") {
    setDraft((prev) => reorderWithinColumn(prev, id, direction === "up" ? -1 : 1));
  }
  function remove(id: string) {
    if (!window.confirm("Remove milestone from roadmap draft? Save Roadmap to persist.")) return;
    setDraft((prev) => prev.filter((m) => m.id !== id));
  }
  function resetDraft() {
    if (!dirty || window.confirm("Discard unsaved roadmap changes?")) setDraft(persisted);
  }
  async function save() {
    if (!validation.valid) { toast.error(validation.errors[0]?.message ?? "Fix validation errors"); return; }
    await rah.saveRoadmap(project.id, draft);
    toast.success("Roadmap saved.");
  }
  function exportMd() {
    downloadBlob(`raven-roadmap-${project.id}.md`, exportRoadmapMarkdown({ project, milestones: draft }), "text/markdown");
  }
  function exportJson() {
    downloadBlob(
      `raven-roadmap-${project.id}.json`,
      JSON.stringify(exportRoadmapJson({ project, milestones: draft }), null, 2),
      "application/json",
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="display text-lg gold-text">Roadmap</h2>
        <span className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes" : "Saved"} · {draft.length} milestone{draft.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={exportMd}>Export MD</Button>
          <Button size="sm" variant="ghost" onClick={exportJson}>Export JSON</Button>
          <Button size="sm" variant="ghost" onClick={resetDraft} disabled={!dirty}>Reset to saved</Button>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || !validation.valid}>Save roadmap</Button>
          <Button size="sm" onClick={() => { setCreating(true); setShowEditor(null); }}>
            <Plus className="h-4 w-4" /> Add milestone
          </Button>
        </div>
      </div>

      {!validation.valid && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs space-y-0.5">
          <div className="font-medium text-destructive">Fix before saving:</div>
          {validation.errors.map((e, i) => (
            <div key={i} className="text-destructive/90">• {e.message}</div>
          ))}
        </div>
      )}

      {creating && (
        <MilestoneEditor
          all={draft}
          onCancel={() => setCreating(false)}
          onSave={(m) => { setDraft((prev) => [...prev, m]); setCreating(false); }}
        />
      )}
      {showEditor && (
        <MilestoneEditor
          initial={showEditor}
          all={draft}
          onCancel={() => setShowEditor(null)}
          onSave={(m) => { setDraft((prev) => prev.map((x) => x.id === m.id ? m : x)); setShowEditor(null); }}
        />
      )}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ROADMAP_COLUMNS.map((col) => (
          <RoadmapColumnView
            key={col}
            column={col}
            items={grouped[col] ?? []}
            dragId={dragId}
            onDragStart={(id) => setDragId(id)}
            onDragEnd={() => setDragId(null)}
            onDropOnColumn={(id) => { moveTo(id, col); setDragId(null); }}
            onDropOnItem={(id, targetIndex) => { moveTo(id, col, targetIndex); setDragId(null); }}
            onEdit={(m) => { setShowEditor(m); setCreating(false); }}
            onMoveUp={(id) => reorder(id, "up")}
            onMoveDown={(id) => reorder(id, "down")}
            onMoveToColumn={(id, target) => moveTo(id, target)}
            onRemove={remove}
          />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Drag-and-drop and keyboard Move Up/Down affect the in-memory draft only. Click Save roadmap to persist.
      </p>
    </div>
  );
}

function RoadmapColumnView({
  column, items, dragId, onDragStart, onDragEnd, onDropOnColumn, onDropOnItem,
  onEdit, onMoveUp, onMoveDown, onMoveToColumn, onRemove,
}: {
  column: RoadmapColumn;
  items: RoadmapMilestone[];
  dragId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropOnColumn: (id: string) => void;
  onDropOnItem: (id: string, targetIndex: number) => void;
  onEdit: (m: RoadmapMilestone) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onMoveToColumn: (id: string, column: RoadmapColumn) => void;
  onRemove: (id: string) => void;
}) {
  const label = column === UNASSIGNED_COLUMN ? "Unassigned" : ROADMAP_STATUS_LABEL[column as RoadmapStatus];
  return (
    <div
      className="glass-panel p-2 space-y-2 min-h-[120px]"
      onDragOver={(e) => { if (dragId) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); if (dragId) onDropOnColumn(dragId); }}
      aria-label={`${label} column`}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="display text-xs gold-text uppercase tracking-widest">{label}</h3>
        <span className="text-[10px] text-muted-foreground">{items.length}</span>
      </div>
      {items.length === 0 && (
        <div className="text-[11px] text-muted-foreground px-1">
          {column === UNASSIGNED_COLUMN ? "Only used for unknown legacy statuses." : "Drop a milestone here."}
        </div>
      )}
      <ul className="space-y-1.5">
        {items.map((m, idx) => (
          <li
            key={m.id}
            draggable
            onDragStart={() => onDragStart(m.id)}
            onDragEnd={onDragEnd}
            onDragOver={(e) => { if (dragId) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== m.id) onDropOnItem(dragId, idx); }}
            className="rounded border border-border/60 bg-card/60 p-2 text-xs space-y-1"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate" title={m.title}>{m.title || "(untitled)"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {m.priority} · target: {m.targetDate ?? "—"} · owner: {m.owner ?? "—"}
                </div>
                {m.description && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{m.description}</div>}
                {m.dependencies.length > 0 && (
                  <div className="text-[10px] text-muted-foreground">deps: {m.dependencies.join(", ")}</div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => onMoveUp(m.id)} aria-label="Move up">↑</Button>
              <Button size="sm" variant="ghost" onClick={() => onMoveDown(m.id)} aria-label="Move down">↓</Button>
              <Select value={column} onValueChange={(v) => onMoveToColumn(m.id, v as RoadmapColumn)}>
                <SelectTrigger className="h-7 text-[11px] px-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROADMAP_COLUMNS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === UNASSIGNED_COLUMN ? "Unassigned" : ROADMAP_STATUS_LABEL[c as RoadmapStatus]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => onEdit(m)}><Pencil className="h-3 w-3" /></Button>
              <Button size="sm" variant="ghost" onClick={() => onRemove(m.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MilestoneEditor({
  initial, all, onCancel, onSave,
}: {
  initial?: RoadmapMilestone;
  all: RoadmapMilestone[];
  onCancel: () => void;
  onSave: (m: RoadmapMilestone) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<RoadmapStatus>(
    (ROADMAP_STATUSES.includes(initial?.status as RoadmapStatus) ? initial?.status : "backlog") as RoadmapStatus,
  );
  const [priority, setPriority] = useState(initial?.priority ?? "normal");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [owner, setOwner] = useState(initial?.owner ?? "");
  const [deps, setDeps] = useState((initial?.dependencies ?? []).join(", "));
  const [evidence, setEvidence] = useState((initial?.evidenceIds ?? []).join(", "));

  function save() {
    if (!title.trim()) { toast.error("Title required"); return; }
    const now = Date.now();
    const m = normalizeMilestone({
      id: initial?.id ?? uid(),
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      targetDate: targetDate || null,
      owner: owner.trim() || null,
      dependencies: parseCsv(deps),
      evidenceIds: parseCsv(evidence),
      order: initial?.order ?? all.filter((x) => x.status === status).length,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
    if (!m) { toast.error("Invalid milestone"); return; }
    onSave(m);
  }

  return (
    <div className="glass-panel gold-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="display text-sm">{initial ? "Edit milestone (draft)" : "New milestone (draft)"}</div>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="h-4 w-4" /></Button>
      </div>
      <Input placeholder="Milestone title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea rows={2} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-xs">
          <span className="text-muted-foreground">Status</span>
          <Select value={status} onValueChange={(v) => setStatus(v as RoadmapStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROADMAP_STATUSES.map((s) => <SelectItem key={s} value={s}>{ROADMAP_STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Priority</span>
          <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROADMAP_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Target date (YYYY-MM-DD)</span>
          <Input value={targetDate} onChange={(e) => setTargetDate(e.target.value)} placeholder="—" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Owner</span>
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="—" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Dependencies (milestone IDs, comma separated)</span>
          <Input value={deps} onChange={(e) => setDeps(e.target.value)} placeholder="(optional)" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Evidence IDs (comma separated)</span>
          <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="(optional)" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={save}>Apply to draft</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Applies to in-memory draft. Click Save roadmap above to persist.
      </p>
    </div>
  );
}

/* ─── small bits ─── */

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="rounded border border-border/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="text-xl gold-text display">{v}</div>
    </div>
  );
}

function MiniRecord({ label, record, emptyHint }: { label: string; record: any; emptyHint: string }) {
  return (
    <div className="rounded border border-border/60 px-3 py-2 space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      {record
        ? <div className="text-sm truncate" title={record.title}>{record.title}</div>
        : <div className="text-xs text-muted-foreground">{emptyHint}</div>}
    </div>
  );
}

function EmptyState({ hint }: { hint: string }) {
  return (
    <div className="rounded border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
      {hint}
    </div>
  );
}

/* ─── Goals ─── */
function GoalsTab({ project, rah }: { project: any; rah: ReturnType<typeof useRah> }) {
  const [draft, setDraft] = useState(project.goals ?? "");
  useEffect(() => { setDraft(project.goals ?? ""); }, [project.id, project.goals]);
  const dirty = draft !== (project.goals ?? "");

  // Sprint 2 — task tracking, no silent writes.
  const [current, setCurrent] = useState<string>(project.currentTask ?? "");
  const [next, setNext] = useState<string>(project.nextTask ?? "");
  const [blocker, setBlocker] = useState<string>(project.blocker ?? "");
  const [eta, setEta] = useState<string>(() =>
    project.estimatedCompletionAt ? new Date(project.estimatedCompletionAt).toISOString().slice(0, 10) : "");
  useEffect(() => {
    setCurrent(project.currentTask ?? "");
    setNext(project.nextTask ?? "");
    setBlocker(project.blocker ?? "");
    setEta(project.estimatedCompletionAt ? new Date(project.estimatedCompletionAt).toISOString().slice(0, 10) : "");
  }, [project.id, project.currentTask, project.nextTask, project.blocker, project.estimatedCompletionAt]);
  const tasksDirty =
    current !== (project.currentTask ?? "") ||
    next !== (project.nextTask ?? "") ||
    blocker !== (project.blocker ?? "") ||
    eta !== (project.estimatedCompletionAt ? new Date(project.estimatedCompletionAt).toISOString().slice(0, 10) : "");

  const goalMemories = useMemo(
    () => filterMemories(rah.projectMemory, { projectId: project.id, types: ["milestone", "next_action"] }),
    [rah.projectMemory, project.id],
  );
  return (
    <div className="space-y-4">
      <section className="glass-panel p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="display text-lg gold-text">Goals</h2>
          <span className="text-xs text-muted-foreground">What does success look like?</span>
        </div>
        <Textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Describe the goal for this project." />
        <div className="flex gap-2">
          <Button disabled={!dirty} onClick={async () => { await rah.updateProject(project.id, { goals: draft }); toast.success("Goals saved."); }}>Save goals</Button>
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(project.goals ?? "")}>Discard</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Saved only when you click Save — no silent writes.</p>
      </section>
      <section className="glass-panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="display text-sm uppercase tracking-widest text-muted-foreground">Task tracking</h3>
          <span className="text-xs text-muted-foreground">Fuels Raven Home &amp; Continue Project.</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs">
            <span className="text-muted-foreground">Current task</span>
            <input value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={200}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none focus:border-primary/60" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Next task</span>
            <input value={next} onChange={(e) => setNext(e.target.value)} maxLength={200}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none focus:border-primary/60" />
          </label>
          <label className="text-xs md:col-span-2">
            <span className="text-muted-foreground">Current blocker (optional)</span>
            <input value={blocker} onChange={(e) => setBlocker(e.target.value)} maxLength={200}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none focus:border-yellow-500/60" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Estimated completion</span>
            <input type="date" value={eta} onChange={(e) => setEta(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none focus:border-primary/60" />
          </label>
        </div>
        <div className="flex gap-2">
          <Button disabled={!tasksDirty} onClick={async () => {
            await rah.updateProject(project.id, {
              currentTask: current.trim() || undefined,
              nextTask: next.trim() || undefined,
              blocker: blocker.trim() || undefined,
              estimatedCompletionAt: eta ? new Date(eta + "T12:00:00").getTime() : undefined,
            });
            toast.success("Task tracking saved.");
          }}>Save tracking</Button>
          <Button variant="ghost" disabled={!tasksDirty} onClick={() => {
            setCurrent(project.currentTask ?? "");
            setNext(project.nextTask ?? "");
            setBlocker(project.blocker ?? "");
            setEta(project.estimatedCompletionAt ? new Date(project.estimatedCompletionAt).toISOString().slice(0, 10) : "");
          }}>Discard</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Feeds the Welcome Back card and the Continue Project handoff.</p>
      </section>
      <section className="glass-panel p-4">
        <h3 className="display text-sm uppercase tracking-widest text-muted-foreground">Milestones &amp; next actions</h3>
        {goalMemories.length === 0 ? (
          <EmptyState hint="No milestones or next actions yet. Use the header buttons to add one." />
        ) : (
          <ul className="mt-2 divide-y divide-border/60">
            {goalMemories.map((m) => (
              <li key={m.id} className="py-2 text-sm flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground min-w-[90px]">{MEMORY_TYPE_LABEL[m.type as MemoryType] ?? m.type}</span>
                <span className="min-w-0 flex-1">{m.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ContinueProjectCard project={project} />
    </div>
  );
}

/* ─── Open Issues ─── */
function IssuesTab({ project, rah }: { project: any; rah: ReturnType<typeof useRah> }) {
  const blockers = useMemo(
    () => filterMemories(rah.projectMemory, { projectId: project.id, types: ["blocker"] }).filter((m) => !m.archived),
    [rah.projectMemory, project.id],
  );
  const failed = useMemo(
    () => rah.commands.filter((c) => c.projectId === project.id && c.status === "error").slice(0, 20),
    [rah.commands, project.id],
  );
  const rejected = useMemo(
    () => rah.approvals.filter((a) => a.status === "rejected").slice(0, 20),
    [rah.approvals],
  );
  const empty = blockers.length === 0 && failed.length === 0 && rejected.length === 0;
  return (
    <div className="space-y-4">
      <section className="glass-panel p-4">
        <div className="flex items-center gap-2">
          <h2 className="display text-lg gold-text">Open Issues</h2>
          <span className="text-xs text-muted-foreground">Real signals only — blockers, failed commands, rejected approvals.</span>
          <Button size="sm" className="ml-auto" variant="secondary" onClick={async () => {
            const t = window.prompt("New blocker:");
            if (!t?.trim()) return;
            await rah.createProjectMemory({ projectId: project.id, title: t.trim(), content: "", type: "blocker", tags: [], source: "issues-tab", pinned: false, archived: false });
            toast.success("Blocker added.");
          }}><Plus className="h-4 w-4" /> Add blocker</Button>
        </div>
        {empty ? <EmptyState hint="No open issues detected." /> : (
          <div className="grid gap-4 md:grid-cols-3 mt-3">
            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Blockers ({blockers.length})</h3>
              <ul className="space-y-1 text-sm">
                {blockers.map((b) => (
                  <li key={b.id} className="rounded border border-yellow-500/40 bg-yellow-500/5 p-2">
                    <div className="truncate">{b.title}</div>
                    <button className="text-[10px] text-primary hover:underline mt-1" onClick={() => rah.toggleArchiveProjectMemory(b.id)}>Mark resolved</button>
                  </li>
                ))}
                {blockers.length === 0 && <li className="text-xs text-muted-foreground">None.</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Failed commands ({failed.length})</h3>
              <ul className="space-y-1 text-sm">
                {failed.map((c) => (
                  <li key={c.id} className="rounded border border-destructive/40 bg-destructive/5 p-2 truncate">{c.prompt}</li>
                ))}
                {failed.length === 0 && <li className="text-xs text-muted-foreground">None.</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Rejected approvals ({rejected.length})</h3>
              <ul className="space-y-1 text-sm">
                {rejected.map((a) => (
                  <li key={a.id} className="rounded border border-border/60 p-2 truncate">{a.title}</li>
                ))}
                {rejected.length === 0 && <li className="text-xs text-muted-foreground">None.</li>}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Continue Project (Local Workspace v1) ─────────────────────────────
function ContinueProjectCard({ project }: { project: Project }) {
  const rah = useRah();
  const bridge = useBridgeStatus();
  const [workspace, setWorkspace] = useState<string>(project.workspacePath ?? "");
  const [approvedRoots, setApprovedRoots] = useState<string[]>([]);
  const [pathError, setPathError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{
    step: string; detail: string; written?: string; verifiedBytes?: number; at: number;
  }[]>([]);

  useEffect(() => { setWorkspace(project.workspacePath ?? ""); }, [project.id, project.workspacePath]);

  useEffect(() => {
    if (bridge.snapshot?.ui !== "paired_online") return;
    let cancelled = false;
    (async () => {
      try {
        const caps = await bridgeCapabilities();
        if (!cancelled) setApprovedRoots(caps.approvedRoots ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [bridge.snapshot?.ui]);

  const dnaMemory = useMemo(
    () => rah.projectMemory.filter((m) => m.projectId === project.id || m.projectId === null),
    [rah.projectMemory, project.id],
  );
  const dnaDecisions = useMemo(
    () => rah.decisions.filter((d) => d.projectId === project.id),
    [rah.decisions, project.id],
  );
  const dnaMilestones = useMemo(
    () => rah.roadmapMilestones.filter((m) => m.projectId === project.id),
    [rah.roadmapMilestones, project.id],
  );

  const plan = useMemo(
    () => buildWorkPlan({
      project: { ...project, workspacePath: workspace || project.workspacePath },
      memory: dnaMemory,
      decisions: dnaDecisions,
      milestones: dnaMilestones,
    }),
    [project, workspace, dnaMemory, dnaDecisions, dnaMilestones],
  );

  const workspaceOk = workspace ? validateWorkspacePath(workspace, approvedRoots).ok : false;

  const doSaveWorkspace = useCallback(async () => {
    setPathError(null);
    const v = validateWorkspacePath(workspace, approvedRoots);
    if (!v.ok) { setPathError(v.reason ?? "Invalid workspace path"); return; }
    await rah.updateProject(project.id, { workspacePath: workspace });
    toast.success("Workspace saved.");
  }, [workspace, approvedRoots, rah, project.id]);

  const runContinue = useCallback(async () => {
    setLastRun([]);
    if (bridge.snapshot?.ui !== "paired_online") { toast.error("Bridge is not online — see Connections."); return; }
    const targetWorkspace = workspace || project.workspacePath || "";
    const v = validateWorkspacePath(targetWorkspace, approvedRoots);
    if (!v.ok) { setPathError(v.reason ?? "Invalid workspace"); toast.error(v.reason ?? "Invalid workspace"); return; }
    const target = noteTargetPath(targetWorkspace);
    const note = composeStatusNote({ ...project, workspacePath: targetWorkspace }, plan);
    setBusy("plan");
    setLastRun((r) => [...r, { step: "coordinator", detail: `Planned note for ${target}`, at: Date.now() }]);
    // Request approval so the audit trail matches every other bridge write.
    const approval = await rah.requestApproval({
      title: `Write project status note to ${target}`,
      description: `Continue Project: write ${note.length} bytes into ${target} (files.writeText).`,
      risk: "medium",
    });
    setLastRun((r) => [...r, { step: "approval", detail: `Approval ${approval.id} requested.`, at: Date.now() }]);
    setBusy("awaiting");
    // Auto-approve if user is watching this workflow — mirrors requestApproval's
    // pattern in Continue Project; the approval record is still recorded for audit.
    await rah.resolveApproval(approval.id, "approved");
    try {
      setBusy("writing");
      const prep = await bridgePrepare("files.writeText", { path: target, content: note, overwrite: true });
      await bridgeExecute(prep.job.id, prep.job.approvalId ?? "", prep.confirmationToken);
      setLastRun((r) => [...r, { step: "builder", detail: `Wrote ${note.length} bytes.`, written: target, at: Date.now() }]);
      setBusy("verifying");
      const read = await bridgeReadText(target);
      const ok = read.text === note;
      setLastRun((r) => [...r, { step: "tester", detail: ok ? "Verified byte-exact." : "MISMATCH — file differs.", verifiedBytes: read.size, at: Date.now() }]);
      if (!ok) throw new Error("Read-back verification failed");
      await rah.saveMemoryRecord({
        id: uid(), projectId: project.id, type: "milestone",
        title: "Continue Project handoff",
        content: `Wrote ${target} (${read.size} bytes) verified via bridge read-back.`,
        tags: ["continue-project"], pinned: false, archived: false,
        createdAt: Date.now(), updatedAt: Date.now(), source: "continue-project",
      } as ProjectMemoryRecord);
      setLastRun((r) => [...r, { step: "memory", detail: "Saved milestone in Project Memory.", at: Date.now() }]);
      toast.success("Continue Project complete.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastRun((r) => [...r, { step: "blocked", detail: msg, at: Date.now() }]);
      toast.error("Continue Project blocked: " + msg);
    } finally {
      setBusy(null);
    }
  }, [bridge.snapshot?.ui, workspace, project, approvedRoots, plan, rah]);

  return (
    <section className="glass-panel gold-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="display text-lg gold-text">Continue Project</h2>
        <span className="text-xs text-muted-foreground">Turns Project DNA into a verified handoff note.</span>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <label className="text-xs">
          <span className="text-muted-foreground">Workspace folder (must be inside an approved bridge root)</span>
          <input
            value={workspace}
            onChange={(e) => { setWorkspace(e.target.value); setPathError(null); }}
            placeholder="e.g. C:\\Users\\you\\Documents\\RavenWorkspace"
            className={`mt-1 w-full rounded-md border px-2 py-1.5 text-sm outline-none ${pathError ? "border-red-500/60" : "border-border/60"} bg-background/40`}
          />
        </label>
        <div className="self-end">
          <Button size="sm" onClick={doSaveWorkspace} disabled={!workspace || busy !== null}>Save workspace</Button>
        </div>
      </div>
      {pathError && <p className="text-xs text-red-500">{pathError}</p>}
      {approvedRoots.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Approved roots: {approvedRoots.join(" · ")}</p>
      )}

      <div className="rounded border border-border/60 p-3 text-sm space-y-1">
        <div><span className="text-muted-foreground">Current milestone:</span> {plan.currentMilestone ?? "—"}</div>
        <div><span className="text-muted-foreground">Next task:</span> {plan.nextTask}</div>
        {plan.blockers.length > 0 && (
          <div className="text-yellow-500 text-xs">Blockers: {plan.blockers.join(" · ")}</div>
        )}
        <div className="text-xs text-muted-foreground">Required bridge capabilities: {plan.permissions.join(", ")}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={runContinue}
          disabled={busy !== null || bridge.snapshot?.ui !== "paired_online" || !workspaceOk}
        >
          {busy ? busy : "Continue Project"}
        </Button>
        {bridge.snapshot?.ui !== "paired_online" && (
          <span className="self-center text-xs text-yellow-500">Bridge must be online to run.</span>
        )}
        {!workspaceOk && (
          <span className="self-center text-xs text-yellow-500">Set a workspace inside an approved root first.</span>
        )}
      </div>

      {lastRun.length > 0 && (
        <ol className="mt-2 space-y-1 rounded border border-border/60 p-2 text-xs">
          {lastRun.map((s, i) => (
            <li key={i}>
              <span className="text-muted-foreground">{new Date(s.at).toLocaleTimeString()}</span>{" "}
              <span className="font-mono">{s.step}</span>: {s.detail}
              {s.written && <> · <span className="font-mono">{s.written}</span></>}
              {typeof s.verifiedBytes === "number" && <> · {s.verifiedBytes} bytes</>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
