import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useRah } from "@/lib/rah/context";

export const Route = createFileRoute("/approvals")({
  head: () => ({ meta: [{ title: "Approvals — RAH Listen Key" }] }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const rah = useRah();
  const pending = rah.approvals.filter((a) => a.status === "pending");
  const past = rah.approvals.filter((a) => a.status !== "pending").slice(0, 30);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="display text-3xl">Approvals</h1>
          <p className="text-muted-foreground">Every non-advisory action is reviewed here before it runs.</p>
        </div>
        <Button variant="destructive" onClick={() => rah.emergencyStop()}>Emergency stop</Button>
      </header>

      <section className="space-y-3">
        <h2 className="display text-lg">Pending ({pending.length})</h2>
        {pending.length === 0 && <p className="text-sm text-muted-foreground">No pending approvals.</p>}
        {pending.map((a) => (
          <article key={a.id} className="glass-panel gold-border p-4 space-y-2">
            <div className="flex items-start gap-3">
              <span className="rounded px-2 py-0.5 text-[10px] uppercase tracking-widest border border-primary text-primary">{a.risk} risk</span>
              <h3 className="font-semibold flex-1 min-w-0">{a.title}</h3>
            </div>
            <div className="grid gap-2 md:grid-cols-2 text-xs">
              <div><b className="text-muted-foreground">Why:</b> {a.reason}</div>
              <div><b className="text-muted-foreground">Expected:</b> {a.expectedResult}</div>
              <div><b className="text-muted-foreground">Tools:</b> {a.tools.join(", ") || "—"}</div>
              <div><b className="text-muted-foreground">Data shared:</b> {a.dataShared.join(", ") || "None"}</div>
              {a.undo && <div className="md:col-span-2"><b className="text-muted-foreground">Undo:</b> {a.undo}</div>}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => rah.resolveApproval(a.id, "approved")}>Approve</Button>
              <Button variant="secondary" onClick={() => rah.resolveApproval(a.id, "rejected")}>Reject</Button>
              <Button variant="ghost" onClick={() => rah.resolveApproval(a.id, "cancelled")}>Cancel</Button>
            </div>
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="display text-lg">Recent</h2>
        <div className="glass-panel divide-y divide-border/60">
          {past.length === 0 && <p className="p-4 text-sm text-muted-foreground">No history yet.</p>}
          {past.map((a) => (
            <div key={a.id} className="p-3 text-sm flex items-center gap-3">
              <span className="min-w-[70px] text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
              <span className="flex-1 truncate">{a.title}</span>
              <span className="text-xs text-muted-foreground">{a.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}