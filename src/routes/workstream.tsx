import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useRah } from "@/lib/rah/context";

export const Route = createFileRoute("/workstream")({
  head: () => ({
    meta: [
      { title: "Workstream — Raven Hub" },
      { name: "description", content: "Live curated execution log. Full-screen ready for monitor 3." },
    ],
  }),
  component: WorkstreamPage,
});

function WorkstreamPage() {
  const { activeProject, commands, approvals } = useRah();
  const [full, setFull] = useState(false);
  const [pulse, setPulse] = useState(true);
  const [sound, setSound] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => {
    return [...commands]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 12);
  }, [commands]);

  const goal = activeProject?.name ?? "Raven overview";
  const step = events[0]?.prompt ?? "Awaiting next command…";
  const completed = events.filter((e) => e.status === "done").length;
  const failing = events.filter((e) => e.status === "error").length;
  const pending = approvals.filter((a) => a.status === "pending").length;

  useEffect(() => {
    if (!sound) return;
    // A calm, low, near-inaudible tick using WebAudio — user-triggered only.
    let ctx: AudioContext | null = null;
    const iv = setInterval(() => {
      try {
        if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 220;
        g.gain.value = 0.02;
        o.connect(g); g.connect(ctx.destination);
        o.start();
        setTimeout(() => o.stop(), 40);
      } catch { /* ignore */ }
    }, 5000);
    return () => { clearInterval(iv); try { ctx?.close(); } catch { /* ignore */ } };
  }, [sound]);

  async function toggleFull() {
    try {
      if (!full) { await rootRef.current?.requestFullscreen(); setFull(true); }
      else { await document.exitFullscreen(); setFull(false); }
    } catch { /* ignore */ }
  }

  return (
    <div ref={rootRef} className="space-y-6 bg-background">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
        <div className="min-w-0">
          <h1 className="display text-3xl gold-text truncate">Raven Workstream</h1>
          <p className="text-muted-foreground">A curated execution log — visible, not hidden chain-of-thought.</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={pulse} onCheckedChange={setPulse} /> Pulse</label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={sound} onCheckedChange={setSound} /> Sound</label>
          <Button size="sm" onClick={toggleFull}>{full ? "Exit full screen" : "Present"}</Button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Goal" value={goal} />
        <Stat label="Completed" value={String(completed)} />
        <Stat label="Failed" value={String(failing)} tone={failing > 0 ? "warn" : undefined} />
        <Stat label="Pending approvals" value={String(pending)} tone={pending > 0 ? "accent" : undefined} />
      </div>

      <Card className="p-5 rune-tile">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Current step</p>
        <p className={"display text-2xl mt-1 " + (pulse ? "pulse-gold rounded-md p-2 -m-2" : "")}>{step}</p>
      </Card>

      <section>
        <h2 className="display text-lg mb-2">Event stream</h2>
        <div className="space-y-2">
          {events.length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
          {events.map((e) => (
            <Card key={e.id} className="p-3 rune-tile">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    {new Date(e.createdAt).toLocaleTimeString()} · {e.status ?? "—"}
                  </div>
                  <div className="text-sm mt-1 truncate">{e.prompt}</div>
                </div>
                {e.status === "error" && <span className="text-[10px] uppercase tracking-widest text-destructive">error</span>}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "accent" }) {
  const cls = tone === "warn" ? "text-destructive" : tone === "accent" ? "text-primary" : "text-foreground";
  return (
    <Card className="p-4 rune-tile">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={"display text-xl mt-1 truncate " + cls}>{value}</div>
    </Card>
  );
}