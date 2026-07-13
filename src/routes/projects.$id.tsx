import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { getDB, type FileItem } from "@/lib/rah/db";
import {
  buildProjectOverview,
  computeProjectHealth,
  buildProjectTimeline,
  deriveRoadmap,
  deterministicProjectProfile,
  buildProjectBriefContext,
  buildContinueProjectPreview,
  PROJECT_DNA_TABS,
} from "@/lib/rah/projectDna";
import { filterMemories, MEMORY_TYPES, MEMORY_TYPE_LABEL, type MemoryType, type ProjectMemoryRecord } from "@/lib/rah/projectMemory";

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
  const decisions = useMemo(
    () => filterMemories(rah.projectMemory, { projectId: project.id, types: ["decision"], includeArchived: true }),
    [rah.projectMemory, project.id],
  );
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<ProjectMemoryRecord | null>(null);

  return (
    <section className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="display text-lg gold-text">Decisions</h2>
        <Button size="sm" className="ml-auto" onClick={() => { setEditing(null); setShowEditor(true); }}>
          <Plus className="h-4 w-4" /> Add decision
        </Button>
      </div>
      {(showEditor || editing) && (
        <DecisionEditor
          initial={editing ?? undefined}
          projectId={project.id}
          onCancel={() => { setShowEditor(false); setEditing(null); }}
          onSave={async (draft) => {
            if (editing) await rah.updateProjectMemory(editing.id, draft);
            else await rah.createProjectMemory({ ...draft, source: "decision-manual" });
            setShowEditor(false); setEditing(null);
            toast.success("Decision saved.");
          }}
        />
      )}
      {decisions.length === 0 && !showEditor
        ? <EmptyState hint='No decisions logged. First click: "Add decision" above. AI output is never saved automatically.' />
        : (
          <ul className="divide-y divide-border/50">
            {decisions.map((d) => (
              <li key={d.id} className="py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{d.title}{d.archived && <span className="text-[10px] text-muted-foreground"> · archived</span>}</div>
                  {d.content && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{d.content}</div>}
                  <div className="text-[11px] text-muted-foreground">{new Date(d.updatedAt).toLocaleString()}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(d)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => rah.toggleArchiveProjectMemory(d.id)}>{d.archived ? "Unarchive" : "Archive"}</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this decision?")) void rah.deleteProjectMemory(d.id); }}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function DecisionEditor({
  initial, projectId, onCancel, onSave,
}: {
  initial?: ProjectMemoryRecord;
  projectId: string;
  onCancel: () => void;
  onSave: (draft: Omit<ProjectMemoryRecord, "id" | "createdAt" | "updatedAt">) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  return (
    <div className="glass-panel gold-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="display text-sm">{initial ? "Edit decision" : "New decision"}</div>
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="h-4 w-4" /></Button>
      </div>
      <Input placeholder="Decision title (what did you decide?)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea rows={3} placeholder="Context / rationale (optional)" value={content} onChange={(e) => setContent(e.target.value)} />
      <Input placeholder="tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => {
          if (!title.trim()) { toast.error("Title required"); return; }
          void onSave({
            projectId, title: title.trim(), content: content.trim(), type: "decision",
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
            pinned: initial?.pinned ?? false, archived: initial?.archived ?? false,
            source: initial?.source ?? "decision-manual",
          });
        }}>Save decision</Button>
      </div>
    </div>
  );
}

/* ─── Roadmap ─── */

function RoadmapTab({ project, rah }: { project: any; rah: ReturnType<typeof useRah> }) {
  const rm = useMemo(
    () => deriveRoadmap({ memory: rah.projectMemory, projectId: project.id }),
    [rah.projectMemory, project.id],
  );
  const Bucket = ({ title, items, hint }: { title: string; items: {id:string;title:string;source:string}[]; hint: string | null }) => (
    <div className="glass-panel p-3 space-y-2">
      <h3 className="display text-sm gold-text">{title}</h3>
      {items.length === 0
        ? <div className="text-xs text-muted-foreground">{hint}</div>
        : (
          <ul className="text-sm space-y-1">
            {items.map((i) => (
              <li key={i.source + i.id} className="flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-widest text-primary min-w-[70px]">{i.source.replace("memory:", "")}</span>
                <span>{i.title}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Derived only from your memory records. No fake roadmap items are ever inserted.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Bucket title="Now"   items={rm.now}   hint={rm.guidance.now} />
        <Bucket title="Next"  items={rm.next}  hint={rm.guidance.next} />
        <Bucket title="Later" items={rm.later} hint={rm.guidance.later} />
      </div>
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
