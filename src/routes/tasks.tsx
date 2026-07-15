import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRah } from "@/lib/rah/context";

export const Route = createFileRoute("/tasks")({
  head: () => ({ meta: [
    { title: "Tasks — RAH AI Studios" },
    { name: "description", content: "Consolidated view of active project tasks and next actions." },
  ] }),
  component: TasksPage,
});

interface Row {
  projectId: string;
  projectName: string;
  projectIcon: string;
  kind: "current" | "next" | "blocker";
  text: string;
  priority: "low" | "normal" | "high";
}

function TasksPage() {
  const rah = useRah();
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const p of rah.projects) {
      if (p.status !== "active") continue;
      if (p.currentTask) out.push({ projectId: p.id, projectName: p.name, projectIcon: p.icon, kind: "current", text: p.currentTask, priority: p.priority });
      if (p.nextTask) out.push({ projectId: p.id, projectName: p.name, projectIcon: p.icon, kind: "next", text: p.nextTask, priority: p.priority });
      if (p.blocker) out.push({ projectId: p.id, projectName: p.name, projectIcon: p.icon, kind: "blocker", text: p.blocker, priority: "high" });
    }
    const order = { high: 0, normal: 1, low: 2 } as const;
    return out.sort((a, b) => order[a.priority] - order[b.priority]);
  }, [rah.projects]);

  const grouped = useMemo(() => ({
    blocker: rows.filter((r) => r.kind === "blocker"),
    current: rows.filter((r) => r.kind === "current"),
    next: rows.filter((r) => r.kind === "next"),
  }), [rows]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Tasks</h1>
        <p className="text-muted-foreground">
          Current focus, next actions and blockers across every active project. Edit each in Project DNA.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <TaskColumn title="Blockers" tone="bad" rows={grouped.blocker} />
        <TaskColumn title="In Progress" tone="ok" rows={grouped.current} />
        <TaskColumn title="Up Next" tone="info" rows={grouped.next} />
      </div>

      {rows.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground glass-panel">
          No task fields set yet. Open a project and fill in Current, Next and Blocker to see it here.
        </Card>
      )}
    </div>
  );
}

function TaskColumn({ title, rows, tone }: { title: string; rows: Row[]; tone: "ok" | "bad" | "info" }) {
  const toneClass =
    tone === "bad" ? "text-destructive" :
    tone === "ok" ? "text-primary" : "text-muted-foreground";
  return (
    <section className="space-y-2">
      <h2 className={"display text-lg " + toneClass}>{title} <span className="text-xs text-muted-foreground">({rows.length})</span></h2>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">Nothing here.</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <Card key={r.projectId + i} className="p-3 space-y-1 glass-panel">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{r.projectIcon}</span>
              <span className="truncate">{r.projectName}</span>
              <span className="ml-auto uppercase tracking-widest text-[10px]">{r.priority}</span>
            </div>
            <p className="text-sm">{r.text}</p>
            <div className="pt-1">
              <Button asChild size="sm" variant="ghost">
                <Link to="/projects/$id" params={{ id: r.projectId }}>Open project</Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
