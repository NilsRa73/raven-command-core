import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useRah } from "@/lib/rah/context";
import {
  buildChronicleEntries, groupByDay, filterEntries, buildDailySummaryDraft,
  exportChronicleJson, exportChronicleMarkdown, CHRONICLE_KINDS,
  type ChronicleKind,
} from "@/lib/rah/chronicle";
import { toast } from "sonner";

export const Route = createFileRoute("/chronicle")({ component: ChroniclePage });

function download(name: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function KindBadge({ k }: { k: ChronicleKind }) {
  const cls = k === "command" ? "border-primary/60 text-primary"
    : k === "memory" ? "border-yellow-500/60 text-yellow-400"
    : k === "approval" ? "border-yellow-500/60 text-yellow-400"
    : k === "summary" ? "border-primary/60 text-primary"
    : "border-border/60 text-muted-foreground";
  return <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + cls}>{k}</span>;
}

function ChroniclePage() {
  const { commands, projectMemory, approvals, createProjectMemory } = useRah();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<ChronicleKind>>(new Set());
  const [draft, setDraft] = useState<{ day: string; text: string } | null>(null);

  const all = useMemo(() => buildChronicleEntries({ commands, projectMemory, approvals }), [commands, projectMemory, approvals]);
  const filtered = useMemo(() => filterEntries(all, { q, kinds: selected }), [all, q, selected]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  function toggleKind(k: ChronicleKind) {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    setSelected(next);
  }

  function createSummary() {
    const d = buildDailySummaryDraft(all);
    setDraft({ day: d.day, text: d.text });
  }

  async function saveSummary() {
    if (!draft) return;
    await createProjectMemory({
      projectId: null,
      title: `Chronicle summary — ${draft.day}`,
      content: draft.text,
      type: "daily_log",
      tags: ["chronicle"],
      source: "chronicle",
      archived: false,
      pinned: false,
    });
    toast.success("Summary saved to Memory.");
    setDraft(null);
  }

  return (
    <div className="space-y-4">
      <header className="glass-panel gold-border p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Raven One · Alpha 0.1</div>
          <h1 className="display text-2xl gold-text">Raven Chronicle</h1>
          <p className="text-xs text-muted-foreground mt-1">
            A truthful timeline built only from your real commands, saved memory, and resolved approvals. Nothing is invented.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={createSummary} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">Create today’s summary</button>
          <button onClick={() => download(`raven-chronicle-${Date.now()}.md`, "text/markdown", exportChronicleMarkdown(filtered))} className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Export MD</button>
          <button onClick={() => download(`raven-chronicle-${Date.now()}.json`, "application/json", exportChronicleJson(filtered))} className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs hover:border-primary/60">Export JSON</button>
        </div>
      </header>

      <section className="glass-panel p-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chronicle…" className="h-8 flex-1 min-w-[200px] rounded-md border border-border/70 bg-background/40 px-2 text-sm" />
        <div className="flex flex-wrap gap-1">
          {CHRONICLE_KINDS.map((k) => (
            <button key={k} onClick={() => toggleKind(k)} className={"h-7 rounded-full border px-3 text-[11px] uppercase tracking-widest " + (selected.has(k) ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/60")}>
              {k}
            </button>
          ))}
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="h-7 rounded-full border border-border/60 px-3 text-[11px] text-muted-foreground">clear</button>
          )}
        </div>
      </section>

      {draft && (
        <section className="glass-panel gold-border p-4">
          <div className="flex items-center gap-2">
            <h2 className="display gold-text text-lg flex-1">Draft summary — {draft.day}</h2>
            <button onClick={() => setDraft(null)} className="h-8 rounded-md border border-border/70 px-3 text-xs">Discard</button>
            <button onClick={() => void saveSummary()} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Save to Memory</button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Nothing is saved until you click “Save to Memory”.</p>
          <textarea readOnly value={draft.text} rows={12} className="mt-3 w-full rounded-md border border-border/70 bg-background/40 px-2 py-1 text-xs font-mono" />
        </section>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground p-6 text-center">No matching activity yet. Run a command, save a memory, or resolve an approval to fill your Chronicle.</p>
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
                    <div className="flex items-center gap-2">
                      <KindBadge k={e.kind} />
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