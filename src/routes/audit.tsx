import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRah } from "@/lib/rah/context";
import { buildAuditChain, verifyChain, type AuditEvent } from "@/lib/rah/auditChain";

export const Route = createFileRoute("/audit")({
  head: () => ({ meta: [
    { title: "Audit Log — RAH AI Studios" },
    { name: "description", content: "Local, hash-chained audit log of commands and approvals." },
  ] }),
  component: AuditPage,
});

function AuditPage() {
  const rah = useRah();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [verify, setVerify] = useState<{ ok: boolean; brokenAt?: number } | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    void buildAuditChain(rah.commands, rah.approvals).then((ev) => {
      if (!cancelled) setEvents(ev);
    });
    return () => { cancelled = true; };
  }, [rah.commands, rah.approvals]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return events.filter((e) => !ql || e.type.includes(ql) || e.detail.toLowerCase().includes(ql));
  }, [events, q]);

  const runVerify = async () => setVerify(await verifyChain(events));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `rah-audit-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="display text-3xl gold-text">Audit Log</h1>
          <p className="text-muted-foreground">
            Hash-chained events for commands and approvals. Verified locally with SHA-256.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runVerify}>Verify chain</Button>
          <Button variant="outline" onClick={exportJson}>Export JSON</Button>
        </div>
      </header>

      <Card className="p-4 space-y-2 glass-panel">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm">
            <span className="text-muted-foreground">Events:</span> {events.length}
          </div>
          {verify && (
            <div className={"text-sm font-medium " + (verify.ok ? "text-primary" : "text-destructive")}>
              {verify.ok ? "✓ Chain intact" : `✗ Broken at seq #${verify.brokenAt}`}
            </div>
          )}
          <div className="ml-auto w-full md:w-80">
            <Input placeholder="Filter by type or detail…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Time</th>
              <th className="text-left p-2">Actor</th>
              <th className="text-left p-2">Event</th>
              <th className="text-left p-2">Detail</th>
              <th className="text-left p-2 hidden md:table-cell">Hash</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No events.</td></tr>
            )}
            {filtered.slice(-200).reverse().map((e) => (
              <tr key={e.seq} className="border-t border-border/40 hover:bg-accent/30">
                <td className="p-2 font-mono text-xs">{e.seq}</td>
                <td className="p-2 text-xs">{new Date(e.ts).toLocaleString()}</td>
                <td className="p-2 text-xs">{e.actor}{e.agent ? ` · ${e.agent}` : ""}</td>
                <td className="p-2 text-xs font-mono">{e.type}</td>
                <td className="p-2 text-xs max-w-[420px] truncate">{e.detail}</td>
                <td className="p-2 hidden md:table-cell font-mono text-[10px] text-muted-foreground">
                  {e.hash.slice(0, 12)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
