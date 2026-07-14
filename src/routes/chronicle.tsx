import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useRah } from "@/lib/rah/context";
import { streamChat } from "@/lib/rah/ai";
import { getDB, type WorkflowRun } from "@/lib/rah/db";
import {
  buildChronicleEntries, groupByDay, filterEntries, buildDailySummaryDraft,
  CHRONICLE_KINDS, type ChronicleEntry, type ChronicleKind, type ChronicleSource,
} from "@/lib/rah/chronicle";
import {
  weekBoundsFromDate, shiftWeek, isoWeek, formatWeekRange,
  buildWeeklyDraft, findExistingWeeklySummary, buildSaveableWeeklySummary,
  buildExportMetadata, exportFilteredChronicleJson, exportFilteredChronicleMarkdown,
  exportWeeklyDraftJson, exportWeeklyDraftMarkdown, CHRONICLE_SOURCES,
  type WeekBounds, type WeeklyDraft,
} from "@/lib/rah/chronicleWeek";

const searchSchema = z.object({
  projectId: z.string().catch("__all__").default("__all__"),
  week: z.string().catch("").default(""),
  view: z.string().catch("timeline").default("timeline"),
});
type ChronicleSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/chronicle")({
  head: () => ({ meta: [{ title: "Chronicle · Raven One" }, { name: "description", content: "Truthful per-project timeline and weekly summaries." }] }),
  validateSearch: (input: Record<string, unknown>): ChronicleSearch => searchSchema.parse(input),
  component: ChroniclePage,
});

function download(name: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Convert the URL scope token into the ProjectScope value. */
function scopeFromToken(token: string): string | null | undefined {
  if (token === "__all__") return undefined;
  if (token === "__unassigned__") return null;
  return token;
}

function KindBadge({ k }: { k: ChronicleEntry["kind"] }) {
  const cls = k === "command" ? "border-primary/60 text-primary"
    : k === "memory" ? "border-yellow-500/60 text-yellow-400"
    : k === "approval" ? "border-yellow-500/60 text-yellow-400"
    : k === "summary" ? "border-primary/60 text-primary"
    : "border-border/60 text-muted-foreground";
  return <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + cls}>{k}</span>;
}

function ChroniclePage() {
  const { commands, projectMemory, approvals, projects, createProjectMemory } = useRah();
  const nav = useNavigate({ from: "/chronicle" });
  const search = useSearch({ from: "/chronicle" });
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);

  // Load workflow runs (chronicle needs them as a data source).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const db = await getDB();
        const runs = await db.getAll("workflowRuns");
        if (alive) setWorkflowRuns(runs);
      } catch { /* IDB unavailable */ }
    })();
    return () => { alive = false; };
  }, [commands.length, approvals.length, projectMemory.length]);

  // Local UI state.
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<Set<ChronicleKind>>(new Set());
  const [sources, setSources] = useState<Set<ChronicleSource>>(new Set());
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [dailyDraft, setDailyDraft] = useState<{ day: string; text: string } | null>(null);
  const [weeklyDraft, setWeeklyDraft] = useState<WeeklyDraft | null>(null);
  const [polishedText, setPolishedText] = useState<string | null>(null);
  const [polishRunning, setPolishRunning] = useState(false);

  // Project scope from URL.
  const projectScope = scopeFromToken(search.projectId);
  const projectName = projectScope === undefined ? "All projects"
    : projectScope === null ? "Unassigned"
    : projects.find((p) => p.id === projectScope)?.name ?? "(unknown project)";

  // Week bounds — from URL if provided, else current week.
  const bounds: WeekBounds = useMemo(() => {
    if (search.week && /^\d{4}-\d{2}-\d{2}$/.test(search.week)) {
      const [y, m, d] = search.week.split("-").map(Number);
      return weekBoundsFromDate(new Date(y, m - 1, d));
    }
    return weekBoundsFromDate(new Date());
  }, [search.week]);
  const iso = useMemo(() => isoWeek(new Date(bounds.startMs + 3 * 86_400_000)), [bounds]);

  const allEntries = useMemo(
    () => buildChronicleEntries({ commands, projectMemory, approvals, workflowRuns }),
    [commands, projectMemory, approvals, workflowRuns],
  );

  const filter = useMemo(() => ({
    q,
    kinds: [...kinds] as ChronicleKind[],
    sources: [...sources] as ChronicleSource[],
    from: from ? new Date(from).getTime() : null,
    to: to ? new Date(to).getTime() + 86_399_999 : null,
  }), [q, kinds, sources, from, to]);

  const filteredAll = useMemo(() => filterEntries(allEntries, {
    q, kinds, sources,
    from: filter.from ?? undefined,
    to: filter.to ?? undefined,
    projectId: projectScope,
  }), [allEntries, q, kinds, sources, filter.from, filter.to, projectScope]);

  const groups = useMemo(() => groupByDay(filteredAll), [filteredAll]);

  const activeFilterCount = (q ? 1 : 0) + kinds.size + sources.size + (from ? 1 : 0) + (to ? 1 : 0)
    + (projectScope === undefined ? 0 : 1);

  function toggleKind(k: ChronicleKind) {
    const next = new Set(kinds);
    next.has(k) ? next.delete(k) : next.add(k);
    setKinds(next);
  }
  function toggleSource(s: ChronicleSource) {
    const next = new Set(sources);
    next.has(s) ? next.delete(s) : next.add(s);
    setSources(next);
  }
  function clearFilters() {
    setQ(""); setKinds(new Set()); setSources(new Set()); setFrom(""); setTo("");
  }
  function changeProject(token: string) {
    void nav({ search: (prev: ChronicleSearch) => ({ ...prev, projectId: token }) });
  }
  function changeWeek(delta: number) {
    const next = shiftWeek(bounds, delta);
    const d = next.startDate;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    void nav({ search: (prev: ChronicleSearch) => ({ ...prev, week: iso }) });
  }
  function currentWeek() { void nav({ search: (prev: ChronicleSearch) => ({ ...prev, week: "" }) }); }

  function makeDailyDraft() {
    const d = buildDailySummaryDraft(allEntries);
    setDailyDraft({ day: d.day, text: d.text });
  }
  async function saveDailyDraft() {
    if (!dailyDraft) return;
    await createProjectMemory({
      projectId: null, title: `Chronicle summary — ${dailyDraft.day}`,
      content: dailyDraft.text, type: "daily_log", tags: ["chronicle"],
      source: "chronicle", archived: false, pinned: false,
    });
    toast.success("Daily summary saved to Memory.");
    setDailyDraft(null);
  }

  function makeWeeklyDraft() {
    const project = projectScope && typeof projectScope === "string"
      ? projects.find((p) => p.id === projectScope) ?? null : null;
    const d = buildWeeklyDraft({
      project, projectScope, entries: allEntries, memory: projectMemory, bounds,
    });
    setWeeklyDraft(d);
    setPolishedText(null);
  }

  async function polishWithAi() {
    if (!weeklyDraft) return;
    setPolishRunning(true); setPolishedText("");
    try {
      await streamChat({
        prompt: [
          "You are polishing a Raven weekly summary. Only rewrite for clarity and tone.",
          "Do NOT invent progress, decisions, blockers, next steps, approvals, or commands.",
          "If the source draft has 'No recorded items' in a section, keep that section empty or say so.",
          "Preserve the section headings exactly. Output Markdown only.",
          "", weeklyDraft.text,
        ].join("\n"),
        agents: ["writer"], mode: "fast",
      }, {
        onDelta: (_c, full) => setPolishedText(full),
        onDone: (i) => setPolishedText(i.text),
      });
    } catch (err) {
      toast.error("AI polish failed: " + (err instanceof Error ? err.message : String(err)));
      setPolishedText(null);
    } finally { setPolishRunning(false); }
  }

  async function saveWeekly(opts: { forceNewVersion?: boolean } = {}) {
    if (!weeklyDraft) return;
    const existing = findExistingWeeklySummary(projectMemory, projectScope ?? null, weeklyDraft.meta.weekLabel);
    if (existing && !opts.forceNewVersion) {
      toast.error(`A weekly summary already exists for ${weeklyDraft.meta.projectName} / ${weeklyDraft.meta.weekLabel}. Choose "Save another version" if you really want to duplicate.`);
      return;
    }
    const versionSuffix = existing ? `v${new Date().toISOString().slice(0, 10)}` : null;
    const record = buildSaveableWeeklySummary(
      polishedText ? { ...weeklyDraft, text: polishedText } : weeklyDraft,
      { versionSuffix },
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { evidence: _drop, ...rest } = record;
    await createProjectMemory(rest);
    toast.success("Weekly summary saved to Memory.");
    setWeeklyDraft(null); setPolishedText(null);
  }

  function exportFiltered(fmt: "md" | "json") {
    const meta = buildExportMetadata({ filter: { q, kinds, sources, from: filter.from, to: filter.to }, bounds: null, projectScope, projects });
    const name = `raven-chronicle-${Date.now()}.${fmt}`;
    if (fmt === "md") download(name, "text/markdown", exportFilteredChronicleMarkdown(filteredAll, meta));
    else download(name, "application/json", exportFilteredChronicleJson(filteredAll, meta));
  }
  function exportWeekly(fmt: "md" | "json") {
    if (!weeklyDraft) return;
    const d = polishedText ? { ...weeklyDraft, text: polishedText } : weeklyDraft;
    const name = `raven-weekly-${d.meta.weekLabel}-${(d.meta.projectScope ?? "unassigned")}.${fmt}`;
    if (fmt === "md") download(name, "text/markdown", exportWeeklyDraftMarkdown(d));
    else download(name, "application/json", exportWeeklyDraftJson(d));
  }

  return (
    <div className="space-y-4">
      <header className="glass-panel gold-border p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Raven One · Alpha 0.2</div>
          <h1 className="display text-2xl gold-text">Raven Chronicle</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Truthful per-project timeline. Nothing is invented. Weekly summaries build from real records only.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-[11px] uppercase tracking-widest text-muted-foreground">Project</label>
          <select
            value={search.projectId}
            onChange={(e) => changeProject(e.target.value)}
            className="h-8 rounded-md border border-border/70 bg-background/40 px-2 text-sm"
            aria-label="Project scope"
          >
            <option value="__all__">All projects</option>
            <option value="__unassigned__">Unassigned</option>
            {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
      </header>

      {/* Weekly navigation */}
      <section className="glass-panel p-3 flex flex-wrap items-center gap-2">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Week</div>
        <button onClick={() => changeWeek(-1)} className="h-8 rounded-md border border-border/70 px-2 text-xs hover:border-primary/60" aria-label="Previous week">← Prev</button>
        <button onClick={currentWeek} className="h-8 rounded-md border border-border/70 px-2 text-xs hover:border-primary/60">This week</button>
        <button onClick={() => changeWeek(1)} className="h-8 rounded-md border border-border/70 px-2 text-xs hover:border-primary/60" aria-label="Next week">Next →</button>
        <span className="text-sm ml-2"><b className="gold-text">{iso.label}</b> · {formatWeekRange(bounds)}</span>
        <span className="ml-2 text-[11px] text-muted-foreground">Scope: {projectName}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={makeWeeklyDraft} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">Generate weekly draft</button>
          <button onClick={makeDailyDraft} className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Today’s summary</button>
          <button onClick={() => exportFiltered("md")} className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Export MD</button>
          <button onClick={() => exportFiltered("json")} className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Export JSON</button>
        </div>
      </section>

      {/* Filters */}
      <section className="glass-panel p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chronicle…"
            className="h-8 flex-1 min-w-[200px] rounded-md border border-border/70 bg-background/40 px-2 text-sm" />
          <label className="text-[11px] text-muted-foreground">From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 h-7 rounded-md border border-border/70 bg-background/40 px-1 text-xs" />
          </label>
          <label className="text-[11px] text-muted-foreground">To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 h-7 rounded-md border border-border/70 bg-background/40 px-1 text-xs" />
          </label>
          <button onClick={clearFilters} className="h-7 rounded-md border border-border/60 px-3 text-[11px] text-muted-foreground">Clear</button>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground self-center mr-2">Kinds</span>
          {CHRONICLE_KINDS.map((k) => (
            <button key={k} onClick={() => toggleKind(k)} className={"h-6 rounded-full border px-2 text-[10px] uppercase tracking-widest " + (kinds.has(k) ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/60")}>{k}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground self-center mr-2">Sources</span>
          {CHRONICLE_SOURCES.map((s) => (
            <button key={s} onClick={() => toggleSource(s)} className={"h-6 rounded-full border px-2 text-[10px] uppercase tracking-widest " + (sources.has(s) ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/60")}>{s}</button>
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {filteredAll.length} entr{filteredAll.length === 1 ? "y" : "ies"} · {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
        </div>
      </section>

      {/* Weekly draft */}
      {weeklyDraft && (
        <section className="glass-panel gold-border p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display gold-text text-lg flex-1">Weekly draft — {weeklyDraft.meta.projectName} — {weeklyDraft.meta.weekLabel}</h2>
            <button onClick={() => { setWeeklyDraft(null); setPolishedText(null); }} className="h-8 rounded-md border border-border/70 px-3 text-xs">Discard</button>
            <button onClick={polishWithAi} disabled={polishRunning} className="h-8 rounded-md border border-primary/60 px-3 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">
              {polishRunning ? "Polishing…" : "AI polish (optional)"}
            </button>
            <button onClick={() => exportWeekly("md")} className="h-8 rounded-md border border-border/70 px-3 text-xs">Export MD</button>
            <button onClick={() => exportWeekly("json")} className="h-8 rounded-md border border-border/70 px-3 text-xs">Export JSON</button>
            <button onClick={() => void saveWeekly()} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Save weekly summary</button>
            {Boolean(findExistingWeeklySummary(projectMemory, (typeof weeklyDraft.meta.projectScope === "string" ? weeklyDraft.meta.projectScope : null), weeklyDraft.meta.weekLabel)) && (
              <button onClick={() => void saveWeekly({ forceNewVersion: true })} className="h-8 rounded-md border border-yellow-500/60 px-3 text-xs text-yellow-400">Save another version</button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Nothing is saved until you click <b>Save weekly summary</b>. AI polish rewrites for tone only — it must not add facts.
            {polishedText !== null && <> Current view: <b className="text-primary">AI-polished draft</b>.</>}
          </p>
          <textarea readOnly value={polishedText ?? weeklyDraft.text} rows={16}
            className="w-full rounded-md border border-border/70 bg-background/40 px-2 py-1 text-xs font-mono" />
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Evidence ({weeklyDraft.evidence.length} record{weeklyDraft.evidence.length === 1 ? "" : "s"})</summary>
            {weeklyDraft.evidence.length === 0 ? (
              <p className="mt-2 text-muted-foreground">No source records were used — the draft is empty by construction.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {weeklyDraft.evidence.map((e) => (
                  <li key={`${e.kind}:${e.id}`} className="flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded border border-border/70 px-1">{e.kind}</span>
                    <span className="font-mono">{e.id}</span>
                    <span className="text-muted-foreground">{new Date(e.ts).toISOString()}</span>
                    {e.type && <span className="text-muted-foreground">· {e.type}</span>}
                    {e.projectId && <span className="text-muted-foreground">· project:{e.projectId}</span>}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </section>
      )}

      {/* Daily draft (legacy quick action) */}
      {dailyDraft && (
        <section className="glass-panel gold-border p-4">
          <div className="flex items-center gap-2">
            <h2 className="display gold-text text-lg flex-1">Draft daily summary — {dailyDraft.day}</h2>
            <button onClick={() => setDailyDraft(null)} className="h-8 rounded-md border border-border/70 px-3 text-xs">Discard</button>
            <button onClick={() => void saveDailyDraft()} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Save to Memory</button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Nothing is saved until you click Save.</p>
          <textarea readOnly value={dailyDraft.text} rows={10} className="mt-3 w-full rounded-md border border-border/70 bg-background/40 px-2 py-1 text-xs font-mono" />
        </section>
      )}

      {/* Timeline */}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground p-6 text-center">
          No matching entries in this scope. Adjust filters or the week, or capture activity in Commands, Memory, or Approvals.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="glass-panel p-4">
            <h2 className="display text-sm uppercase tracking-widest text-muted-foreground">{g.day} · {g.items.length} entr{g.items.length === 1 ? "y" : "ies"}</h2>
            <ul className="mt-2 divide-y divide-border/60">
              {g.items.map((e) => (
                <li key={e.id} className="py-2 flex items-start gap-3 text-sm">
                  <span className="text-[10px] text-muted-foreground min-w-[54px] mt-1">
                    {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <KindBadge k={e.kind} />
                      {e.source && <span className="text-[10px] text-muted-foreground uppercase tracking-widest">· {e.source}</span>}
                      {e.projectId && (
                        <Link to="/chronicle" search={{ projectId: e.projectId, week: "", view: "timeline" }} className="text-[10px] text-primary hover:underline">project:{projects.find((p) => p.id === e.projectId)?.name ?? e.projectId}</Link>
                      )}
                      <span className="truncate">{e.title}</span>
                    </div>
                    {e.detail && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{e.detail}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}