import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/browser")({
  head: () => ({ meta: [
    { title: "Raven Browser — Raven Hub" },
    { name: "description", content: "Bookmarked research surface for Raven. Agent hooks are on the roadmap." },
  ] }),
  component: BrowserPage,
});

const KEY = "rah.browser.bookmarks.v1";
interface Bookmark { id: string; label: string; url: string }

function BrowserPage() {
  const [items, setItems] = useState<Bookmark[]>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setItems(raw ? JSON.parse(raw) : SEED);
      if (!raw) localStorage.setItem(KEY, JSON.stringify(SEED));
    } catch { setItems(SEED); }
  }, []);

  function save(next: Bookmark[]) {
    setItems(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function add() {
    if (!label.trim() || !url.trim()) return toast.error("Label and URL required");
    try { new URL(url); } catch { return toast.error("URL must be absolute (https://…)"); }
    save([...items, { id: `b_${Date.now()}`, label: label.trim(), url: url.trim() }]);
    setLabel(""); setUrl("");
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Raven Browser</h1>
        <p className="text-muted-foreground">Prototype research surface. Bookmarks open in a new tab.</p>
      </header>
      <Card className="p-4 rune-tile space-y-3">
        <h2 className="display text-lg">Add bookmark</h2>
        <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
          <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button onClick={add}>Add</Button>
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((b) => (
          <Card key={b.id} className="p-4 rune-tile flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="display truncate">{b.label}</div>
              <a href={b.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate block">{b.url}</a>
            </div>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => save(items.filter((x) => x.id !== b.id))}>Remove</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

const SEED: Bookmark[] = [
  { id: "b_docs",   label: "Raven Docs",     url: "https://docs.lovable.dev" },
  { id: "b_status", label: "Raven Status",   url: "https://raven-command-core.lovable.app/system-check" },
];