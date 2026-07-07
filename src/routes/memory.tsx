import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRah } from "@/lib/rah/context";
import { toast } from "sonner";

export const Route = createFileRoute("/memory")({
  head: () => ({ meta: [{ title: "Memory — RAH Listen Key" }] }),
  component: MemoryPage,
});

function MemoryPage() {
  const rah = useRah();
  const [text, setText] = useState("");
  const [layer, setLayer] = useState<"session" | "project" | "personal">("personal");
  const [category, setCategory] = useState("general");
  const [q, setQ] = useState("");

  const list = rah.memory.filter((m) => (m.text + m.category).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Memory</h1>
        <p className="text-muted-foreground">Three explicit layers. Nothing is stored automatically.</p>
      </header>

      <div className="glass-panel p-4 space-y-3">
        <div className="grid gap-2 md:grid-cols-[1fr_180px_180px_auto]">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Something you want RAH to remember…" />
          <Select value={layer} onValueChange={(v) => setLayer(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="session">Session</SelectItem>
              <SelectItem value="project">Project</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
            </SelectContent>
          </Select>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
          <Button onClick={async () => {
            if (!text.trim()) return;
            if (!rah.prefs.memoryEnabled) return toast.error("Memory is disabled in Settings.");
            await rah.addMemory({
              text: text.trim(), layer, category,
              projectId: layer === "project" ? rah.activeProject?.id : undefined,
              source: "manual",
            });
            setText(""); toast.success("Saved to memory");
          }}>Save</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memory…" className="max-w-sm" />
        <Button variant="ghost" onClick={() => {
          if (!confirm("Delete ALL memory?")) return;
          Promise.all(rah.memory.map((m) => rah.deleteMemory(m.id))).then(() => toast.success("Memory cleared"));
        }}>Delete all</Button>
      </div>

      <div className="glass-panel divide-y divide-border/60">
        {list.length === 0 && <p className="p-4 text-sm text-muted-foreground">No memory items.</p>}
        {list.map((m) => (
          <div key={m.id} className="p-3 flex items-start gap-3">
            <span className="text-[10px] uppercase tracking-widest text-primary min-w-[70px]">{m.layer}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{m.text}</div>
              <div className="text-[11px] text-muted-foreground">{m.category} · {new Date(m.createdAt).toLocaleString()} · from {m.source}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => rah.deleteMemory(m.id)}>Delete</Button>
          </div>
        ))}
      </div>
    </div>
  );
}