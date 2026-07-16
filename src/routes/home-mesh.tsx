import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/home-mesh")({
  head: () => ({ meta: [
    { title: "Home Mesh — Raven Hub" },
    { name: "description", content: "Rooms and devices you control from Raven. Local-only prototype." },
  ] }),
  component: HomeMeshPage,
});

const KEY = "rah.mesh.rooms.v1";
interface Room { id: string; name: string; deviceCount: number }
const SEED: Room[] = [
  { id: "r_study",  name: "Study",       deviceCount: 3 },
  { id: "r_living", name: "Living Room", deviceCount: 4 },
  { id: "r_bed",    name: "Bedroom",     deviceCount: 2 },
];

function HomeMeshPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); setRooms(raw ? JSON.parse(raw) : SEED); if (!raw) localStorage.setItem(KEY, JSON.stringify(SEED)); }
    catch { setRooms(SEED); }
  }, []);
  function save(next: Room[]) { setRooms(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Home Mesh</h1>
        <p className="text-muted-foreground">Prototype room map. Physical device pairing arrives with Raven Bridge v0.3.</p>
      </header>
      <Card className="p-4 rune-tile grid gap-2 md:grid-cols-[1fr_auto]">
        <Input placeholder="Add a room…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={() => { if (name.trim()) { save([...rooms, { id: `r_${Date.now()}`, name: name.trim(), deviceCount: 0 }]); setName(""); } }}>Add room</Button>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rooms.map((r) => (
          <Card key={r.id} className="p-4 rune-tile">
            <div className="display text-lg">{r.name}</div>
            <p className="text-xs text-muted-foreground">{r.deviceCount} devices · prototype</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => save(rooms.map((x) => x.id === r.id ? { ...x, deviceCount: x.deviceCount + 1 } : x))}>+ Device</Button>
              <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => save(rooms.filter((x) => x.id !== r.id))}>Remove</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}