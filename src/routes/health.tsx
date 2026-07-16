import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/health")({
  head: () => ({ meta: [
    { title: "Health Dashboard — Raven Hub" },
    { name: "description", content: "Manual health metric log. Wearables integration is planned." },
  ] }),
  component: HealthPage,
});

const KEY = "rah.health.metrics.v1";
interface Metric { id: string; ts: number; sleepHours?: number; steps?: number; mood?: number; note?: string }

function HealthPage() {
  const [items, setItems] = useState<Metric[]>([]);
  const [draft, setDraft] = useState<Partial<Metric>>({});
  useEffect(() => { try { const raw = localStorage.getItem(KEY); setItems(raw ? JSON.parse(raw) : []); } catch { /* ignore */ } }, []);
  function save(next: Metric[]) { setItems(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } }
  function add() {
    const m: Metric = { id: `m_${Date.now()}`, ts: Date.now(), ...draft,
      sleepHours: draft.sleepHours ? Number(draft.sleepHours) : undefined,
      steps: draft.steps ? Number(draft.steps) : undefined,
      mood: draft.mood ? Number(draft.mood) : undefined,
    };
    save([m, ...items].slice(0, 100));
    setDraft({});
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Health Dashboard</h1>
        <p className="text-muted-foreground">Manual log. Wearables and Apple Health hooks are on the roadmap.</p>
      </header>
      <Card className="p-4 rune-tile grid gap-2 md:grid-cols-[1fr_1fr_1fr_2fr_auto]">
        <Input placeholder="Sleep (h)" value={draft.sleepHours ?? ""} onChange={(e) => setDraft({ ...draft, sleepHours: e.target.value as unknown as number })} />
        <Input placeholder="Steps" value={draft.steps ?? ""} onChange={(e) => setDraft({ ...draft, steps: e.target.value as unknown as number })} />
        <Input placeholder="Mood 1–10" value={draft.mood ?? ""} onChange={(e) => setDraft({ ...draft, mood: e.target.value as unknown as number })} />
        <Input placeholder="Note" value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        <Button onClick={add}>Log</Button>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((m) => (
          <Card key={m.id} className="p-4 rune-tile">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{new Date(m.ts).toLocaleString()}</div>
            <div className="text-sm mt-1">Sleep: <span className="gold-text">{m.sleepHours ?? "—"}h</span> · Steps: <span className="gold-text">{m.steps ?? "—"}</span> · Mood: <span className="gold-text">{m.mood ?? "—"}</span></div>
            {m.note && <p className="text-sm text-muted-foreground mt-1">{m.note}</p>}
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
      </div>
    </div>
  );
}