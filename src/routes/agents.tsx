import { createFileRoute } from "@tanstack/react-router";
import { AGENTS } from "@/lib/rah/agents";
import { useAgentStats, clearAgentStats } from "@/lib/rah/agentSessionStats";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agent Team — RAH Listen Key" }, { name: "description", content: "Ten specialist RAH agents with clear roles and boundaries." }] }),
  component: AgentsPage,
});

function AgentsPage() {
  const stats = useAgentStats();
  const anyStats = Object.keys(stats).length > 0;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Agent Team</h1>
        <p className="text-muted-foreground">Ten specialists. Every response tells you which spoke. Real analysis requires a configured provider.</p>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-widest">This session</span>
          <span>Counters are in-memory only and reset on refresh.</span>
          {anyStats && (
            <Button size="sm" variant="ghost" onClick={clearAgentStats}>Reset counters</Button>
          )}
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((a) => {
          const s = stats[a.id];
          const avg = s && s.completed ? Math.round(s.totalLatencyMs / s.completed) : 0;
          return (
          <article key={a.id} className="glass-panel p-4 space-y-2" style={{ boxShadow: `inset 0 0 0 1px ${a.color}22` }}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg grid place-items-center text-lg" style={{ background: `${a.color}22`, color: a.color }}>{a.emoji}</div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate">{a.name}</h2>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{a.role}</div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{a.summary}</p>
            <ul className="text-xs text-foreground/80 space-y-1 mt-2">
              {a.responsibilities.map((r) => <li key={r} className="flex gap-2"><span className="text-primary">›</span>{r}</li>)}
            </ul>
            <div className="mt-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground font-mono">
              {s ? (
                <>
                  runs: {s.runs} · ok: {s.completed} · fail: {s.failed} · cancel: {s.cancelled}
                  {avg ? ` · avg ${avg}ms` : ""}
                  {s.lastEngine ? <div className="truncate">last: {s.lastEngine}{s.lastTransport ? ` · ${s.lastTransport}` : ""}{s.lastProvider ? ` · ${s.lastProvider}` : ""}</div> : null}
                </>
              ) : (
                <span>No runs yet this session.</span>
              )}
            </div>
          </article>
          );
        })}
      </div>
    </div>
  );
}