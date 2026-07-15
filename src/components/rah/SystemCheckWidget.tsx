import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadLastReportSummary, runSystemCheck, type OverallState } from "@/lib/rah/systemCheck";
import { ShieldCheck, RefreshCw, Play } from "lucide-react";

function toneClass(o: OverallState | null): string {
  if (o === "ready") return "border-primary/60 bg-primary/10 text-primary";
  if (o === "attention") return "border-yellow-500/60 bg-yellow-500/10 text-yellow-400";
  if (o === "offline") return "border-destructive/60 bg-destructive/10 text-destructive";
  return "border-border/60 bg-background/40 text-muted-foreground";
}

function label(o: OverallState | null): string {
  if (o === "ready") return "Ready";
  if (o === "attention") return "Needs attention";
  if (o === "offline") return "Offline";
  if (o === "demo") return "Demo-only";
  return "Not run";
}

export function SystemCheckWidget() {
  const [overall, setOverall] = useState<OverallState | null>(null);
  const [ts, setTs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const last = loadLastReportSummary();
    if (last) { setOverall(last.overall); setTs(last.ts); }
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const r = await runSystemCheck();
      setOverall(r.overall);
      setTs(r.ts);
    } finally { setBusy(false); }
  };

  return (
    <section className={"glass-panel border p-4 " + toneClass(overall)}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" />
        <h2 className="display text-sm uppercase tracking-widest">System Check</h2>
        <span className="ml-auto text-[11px] uppercase tracking-widest">{label(overall)}</span>
      </div>
      <p className="mt-2 text-xs opacity-90">
        {ts ? "Last run " + new Date(ts).toLocaleTimeString() : "Not yet run this session."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border/60 bg-background/40 px-3 text-xs hover:bg-accent"
        >
          <RefreshCw className={"h-3 w-3 " + (busy ? "animate-spin" : "")} />
          {busy ? "Checking…" : "Re-check now"}
        </button>
        <Link
          to="/system-check"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border/60 bg-background/40 px-3 text-xs hover:bg-accent"
        >
          <Play className="h-3 w-3" /> Open full System Check
        </Link>
      </div>
    </section>
  );
}