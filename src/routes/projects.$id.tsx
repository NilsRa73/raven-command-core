import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useRah } from "@/lib/rah/context";
import { agentById } from "@/lib/rah/agents";

export const Route = createFileRoute("/projects/$id")({
  head: () => ({ meta: [{ title: "Project — RAH Listen Key" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { id } = useParams({ from: "/projects/$id" });
  const nav = useNavigate();
  const rah = useRah();
  const project = rah.projects.find((p) => p.id === id);
  const cmds = useMemo(() => rah.commands.filter((c) => c.projectId === id), [rah.commands, id]);
  const mem = useMemo(() => rah.memory.filter((m) => m.projectId === id), [rah.memory, id]);

  if (!project) return (
    <div className="glass-panel p-6">
      <p>Project not found. <Link to="/projects" className="text-primary hover:underline">Back to projects</Link></p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-3xl">{project.icon}</div>
        <Input value={project.name} onChange={(e) => rah.updateProject(project.id, { name: e.target.value })} className="max-w-md text-lg" />
        <Button variant="secondary" onClick={() => rah.setActiveProject(project.id)}>Set active</Button>
        <Button variant="ghost" onClick={() => { if (confirm("Delete?")) { rah.deleteProject(project.id); nav({ to: "/projects" }); } }}>Delete</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-panel p-4 space-y-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Description</label>
          <Textarea rows={3} value={project.description} onChange={(e) => rah.updateProject(project.id, { description: e.target.value })} />
          <label className="text-xs uppercase tracking-widest text-muted-foreground mt-2">Goals</label>
          <Textarea rows={3} value={project.goals ?? ""} onChange={(e) => rah.updateProject(project.id, { goals: e.target.value })} />
          <label className="text-xs uppercase tracking-widest text-muted-foreground mt-2">Notes</label>
          <Textarea rows={5} value={project.notes ?? ""} onChange={(e) => rah.updateProject(project.id, { notes: e.target.value })} />
        </div>
        <div className="space-y-4">
          <div className="glass-panel p-4">
            <h2 className="display text-lg mb-2">Commands ({cmds.length})</h2>
            {cmds.length === 0
              ? <p className="text-sm text-muted-foreground">No commands yet for this project.</p>
              : <ul className="divide-y divide-border/60 max-h-64 overflow-y-auto">
                  {cmds.map((c) => (
                    <li key={c.id} className="py-2 text-sm">
                      <div className="truncate">{c.prompt}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString()} · {c.agents.map((a) => agentById(a)?.emoji).join(" ")} · {c.status}
                      </div>
                    </li>
                  ))}
                </ul>}
          </div>
          <div className="glass-panel p-4">
            <h2 className="display text-lg mb-2">Project memory ({mem.length})</h2>
            {mem.length === 0
              ? <p className="text-sm text-muted-foreground">No project memories saved.</p>
              : <ul className="divide-y divide-border/60 max-h-64 overflow-y-auto">{mem.map((m) => <li key={m.id} className="py-2 text-sm">{m.text}</li>)}</ul>}
          </div>
        </div>
      </div>
    </div>
  );
}