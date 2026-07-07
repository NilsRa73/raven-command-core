import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Star, Copy, Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRah } from "@/lib/rah/context";

export const Route = createFileRoute("/projects")({
  head: () => ({ meta: [{ title: "Projects — RAH Listen Key" }] }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const rah = useRah();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const list = rah.projects.filter((p) =>
    (showArchived ? true : p.status === "active") &&
    (p.name + " " + p.description + " " + p.tags.join(" ")).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="display text-3xl">Projects</h1>
          <p className="text-muted-foreground">Every command, memory and file can be scoped to a project. Everything persists on this device.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" className="w-56" />
          <Button variant="secondary" onClick={() => setShowArchived((s) => !s)}>{showArchived ? "Hide archived" : "Show archived"}</Button>
          <Button onClick={async () => {
            const p = await rah.createProject({ name: "New project", description: "", icon: "✦" });
            toast.success("Project created."); await rah.setActiveProject(p.id);
          }}><Plus className="h-4 w-4" /> New</Button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => (
          <article key={p.id} className={"glass-panel p-4 space-y-2 " + (rah.activeProject?.id === p.id ? "gold-border" : "")}>
            <div className="flex items-start gap-3">
              <div className="text-2xl leading-none">{p.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold truncate">{p.name}</h2>
                  {p.favorite && <Star className="h-3.5 w-3.5 text-primary fill-primary" />}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2.5em]">{p.description || "No description."}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{p.status}</span><span>·</span><span>{p.priority}</span>
              {p.tags.map((t) => <span key={t}>· {t}</span>)}
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              <Button size="sm" variant={rah.activeProject?.id === p.id ? "default" : "secondary"} onClick={() => rah.setActiveProject(p.id)}>Set active</Button>
              <Button size="sm" variant="ghost" onClick={() => rah.updateProject(p.id, { favorite: !p.favorite })} aria-label="Favorite">
                <Star className={"h-4 w-4 " + (p.favorite ? "text-primary fill-primary" : "")} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => rah.duplicateProject(p.id).then(() => toast.success("Duplicated"))} aria-label="Duplicate">
                <Copy className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => rah.updateProject(p.id, { status: p.status === "active" ? "archived" : "active" })} aria-label="Archive">
                <Archive className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${p.name}"?`)) rah.deleteProject(p.id); }} aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Link to="/projects/$id" params={{ id: p.id }} className="ml-auto text-xs text-primary hover:underline self-center">Open →</Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}