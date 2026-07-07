import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRah } from "@/lib/rah/context";
import { AGENTS, agentById } from "@/lib/rah/agents";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Command History — RAH Listen Key" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const rah = useRah();
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState<string>("all");
  const [proj, setProj] = useState<string>("all");

  const list = useMemo(() => rah.commands.filter((c) =>
    (agent === "all" || c.agents.includes(agent)) &&
    (proj === "all" || c.projectId === proj) &&
    c.prompt.toLowerCase().includes(q.toLowerCase()),
  ), [rah.commands, agent, proj, q]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Command History</h1>
        <p className="text-muted-foreground">Stored locally on this device. Search, filter, re-run and export.</p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts…" className="w-64" />
        <Select value={agent} onValueChange={setAgent}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Agent" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {AGENTS.map((a) => <SelectItem key={a.id} value={a.id}>{a.emoji} {a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={proj} onValueChange={setProj}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {rah.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.icon} {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="secondary" onClick={() => {
          const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
          const u = URL.createObjectURL(blob); const a = document.createElement("a");
          a.href = u; a.download = "rah-history.json"; a.click(); URL.revokeObjectURL(u);
        }}>Export</Button>
      </div>

      <div className="glass-panel divide-y divide-border/60">
        {list.length === 0 && <p className="p-4 text-sm text-muted-foreground">No history matches.</p>}
        {list.map((c) => (
          <article key={c.id} className="p-4 flex items-start gap-3">
            <div className="text-xs text-muted-foreground min-w-[120px]">
              {new Date(c.createdAt).toLocaleString()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{c.prompt}</div>
              <div className="text-[11px] text-muted-foreground">
                {c.agents.map((a) => agentById(a)?.emoji).join(" ")} · {c.mode} · {c.status}
                {c.projectId && ` · ${rah.projects.find((p) => p.id === c.projectId)?.name ?? "project"}`}
                {c.demo && " · demo output"}
              </div>
              {c.resultSummary && <div className="text-xs text-muted-foreground mt-1">{c.resultSummary}</div>}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => rah.updateCommand(c.id, { favorite: !c.favorite })}>{c.favorite ? "★" : "☆"}</Button>
              <Button size="sm" variant="secondary" onClick={async () => {
                await rah.addCommand({ prompt: c.prompt, agents: c.agents, mode: c.mode, fileIds: c.fileIds, projectId: c.projectId, inputType: "text", status: "done", resultSummary: "Re-run recorded.", demo: c.demo });
                toast.success("Re-ran command");
              }}>Re-run</Button>
              <Button size="sm" variant="ghost" onClick={() => rah.deleteCommand(c.id)}>Delete</Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}