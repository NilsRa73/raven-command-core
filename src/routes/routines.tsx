import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  loadRoutines, saveRoutines, seedRoutinesIfEmpty, normalizeRoutine,
  isRoutineForDay, isRoutineDueNow, routineLabel, WEEKDAYS,
  type Routine, type Weekday,
} from "@/lib/rah/routines";

export const Route = createFileRoute("/routines")({
  head: () => ({
    meta: [
      { title: "Routine Mode — Raven Hub" },
      { name: "description", content: "Schedule, edit, and run Raven routines with explicit confirmations." },
    ],
  }),
  component: RoutinesPage,
});

const DAY_LABELS: Record<Weekday, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

function RoutinesPage() {
  const [items, setItems] = useState<Routine[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Partial<Routine>>({ time: "09:00", days: [], requireConfirmation: false, enabled: true });
  const [confirmRun, setConfirmRun] = useState<Routine | null>(null);

  useEffect(() => {
    setItems(seedRoutinesIfEmpty());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = useMemo(() => items.filter((r) => isRoutineForDay(r, new Date(now))), [items, now]);

  function persist(next: Routine[]) {
    setItems(next);
    saveRoutines(next);
  }

  function addRoutine() {
    try {
      const r = normalizeRoutine(draft);
      const next = [...items, r].sort((a, b) => a.time.localeCompare(b.time));
      persist(next);
      toast.success("Routine added");
      setDraft({ time: "09:00", days: [], requireConfirmation: false, enabled: true });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function updateRoutine(id: string, patch: Partial<Routine>) {
    persist(items.map((r) => (r.id === id ? normalizeRoutine({ ...r, ...patch }) : r)));
  }

  function deleteRoutine(id: string) {
    persist(items.filter((r) => r.id !== id));
  }

  function runNow(r: Routine) {
    if (r.requireConfirmation && confirmRun?.id !== r.id) {
      setConfirmRun(r);
      return;
    }
    const stamped = { ...r, lastRunTs: Date.now(), updatedAt: Date.now() };
    persist(items.map((x) => (x.id === r.id ? stamped : x)));
    setConfirmRun(null);
    toast.success(`Ran "${r.name}"`, { description: r.action || "No action script defined." });
  }

  function toggleDay(day: Weekday) {
    const cur = draft.days ?? [];
    setDraft({ ...draft, days: cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day] });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Routine Mode</h1>
        <p className="text-muted-foreground">
          Scheduled Raven rituals. Everything runs locally; confirmations gate anything sensitive.
        </p>
      </header>

      <Card className="p-4 space-y-4 rune-tile">
        <h2 className="display text-lg">Add a routine</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Name</Label>
            <Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Evening wind down" />
          </div>
          <div>
            <Label>Time</Label>
            <Input type="time" value={draft.time ?? "09:00"} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
          </div>
          <div>
            <Label>Room / device</Label>
            <Input value={draft.room ?? ""} onChange={(e) => setDraft({ ...draft, room: e.target.value })} placeholder="e.g. Living Room" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-2">Days (leave empty for every day):</span>
          {(WEEKDAYS as Weekday[]).map((d) => {
            const on = (draft.days ?? []).includes(d);
            return (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={"rounded-full border px-3 py-1 text-xs " + (on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                {DAY_LABELS[d]}
              </button>
            );
          })}
        </div>
        <div>
          <Label>Action</Label>
          <Textarea rows={2} value={draft.action ?? ""} onChange={(e) => setDraft({ ...draft, action: e.target.value })} placeholder="What Raven should do when this routine runs." />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(draft.requireConfirmation)} onCheckedChange={(v) => setDraft({ ...draft, requireConfirmation: v })} />
            Require confirmation before running
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.enabled !== false} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
            Enabled
          </label>
          <Button onClick={addRoutine} className="ml-auto">Add routine</Button>
        </div>
      </Card>

      <section>
        <h2 className="display text-lg mb-2">Today · {today.length} scheduled</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {items.length === 0 && <p className="text-sm text-muted-foreground">No routines yet.</p>}
          {items.map((r) => {
            const due = isRoutineDueNow(r, new Date(now));
            return (
              <Card key={r.id} className="p-4 space-y-2 rune-tile">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="display truncate">{r.name}</h3>
                      {due && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary">Due</span>}
                      {!r.enabled && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">Off</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{routineLabel(r)} · {r.days.length === 0 ? "Every day" : r.days.map((d) => DAY_LABELS[d]).join(" ")}</p>
                  </div>
                  <Switch checked={r.enabled} onCheckedChange={(v) => updateRoutine(r.id, { enabled: v })} />
                </div>
                {r.action && <p className="text-sm">{r.action}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="default" onClick={() => runNow(r)}>
                    {confirmRun?.id === r.id ? "Confirm run" : "Run now"}
                  </Button>
                  {confirmRun?.id === r.id && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRun(null)}>Cancel</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => updateRoutine(r.id, { requireConfirmation: !r.requireConfirmation })}>
                    {r.requireConfirmation ? "Confirmation on" : "Confirmation off"}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => deleteRoutine(r.id)}>Delete</Button>
                </div>
                {r.lastRunTs && (
                  <p className="text-[11px] text-muted-foreground">Last ran {new Date(r.lastRunTs).toLocaleString()}</p>
                )}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}