import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Markdown } from "@/components/rah/Markdown";
import { RETHINK_MODES, rethink, loadRethinkHistory, saveRethinkHistory, type RethinkMode, type RethinkHistoryEntry } from "@/lib/rah/rethink";
import { useRah } from "@/lib/rah/context";
import { addProjectMemory } from "@/lib/rah/projectMemory";

export const Route = createFileRoute("/rethink")({
  head: () => ({ meta: [
    { title: "Raven Re-think — RAH AI Studios" },
    { name: "description", content: "Local, deterministic text transformations: summarize, simplify, key facts, questions, actions." },
  ] }),
  component: RethinkPage,
});

function RethinkPage() {
  const rah = useRah();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<RethinkMode>("summarize");
  const [result, setResult] = useState<ReturnType<typeof rethink> | null>(null);
  const [history, setHistory] = useState<RethinkHistoryEntry[]>([]);

  useEffect(() => { setHistory(loadRethinkHistory()); }, []);

  const run = () => {
    if (!input.trim()) { toast.error("Paste some text first."); return; }
    const r = rethink(input, mode);
    setResult(r);
    const entry: RethinkHistoryEntry = { ...r, id: crypto.randomUUID(), input: input.slice(0, 500) };
    const next = [entry, ...history].slice(0, 25);
    setHistory(next); saveRethinkHistory(next);
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.markdown);
    toast.success("Copied markdown to clipboard.");
  };

  const exportMd = () => {
    if (!result) return;
    const blob = new Blob([result.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `rethink-${result.mode}-${Date.now()}.md`;
    a.click(); URL.revokeObjectURL(url);
  };

  const saveToMemory = async () => {
    if (!result) return;
    if (!rah.activeProject) { toast.error("Set an active project first."); return; }
    await addProjectMemory({
      projectId: rah.activeProject.id,
      title: `Re-think · ${result.label}`,
      content: result.markdown,
      type: "note", tags: ["rethink", result.mode],
      pinned: false, source: "user",
    });
    toast.success("Saved to Project Memory.");
  };

  const wordCount = useMemo(() => input.trim().split(/\s+/).filter(Boolean).length, [input]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Raven Re-think</h1>
        <p className="text-muted-foreground">
          Paste text and choose a mode. Deterministic local transforms — no external AI.
        </p>
      </header>

      <Card className="p-4 space-y-3 glass-panel gold-border">
        <div className="flex flex-wrap gap-2">
          {RETHINK_MODES.map((m) => (
            <Button key={m.id} size="sm"
              variant={mode === m.id ? "default" : "outline"}
              onClick={() => setMode(m.id)} title={m.hint}>
              {m.label}
            </Button>
          ))}
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste an article, notes, or webpage text…"
          className="min-h-[180px] font-mono text-sm"
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">{wordCount} words · {input.length} chars</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setInput(""); setResult(null); }}>Clear</Button>
            <Button onClick={run}>Re-think</Button>
          </div>
        </div>
      </Card>

      {result && (
        <Card className="p-4 space-y-3 glass-panel">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="display text-lg">{result.label}</div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Local demo · {new Date(result.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={copy}>Copy</Button>
              <Button size="sm" variant="outline" onClick={exportMd}>Export .md</Button>
              <Button size="sm" onClick={saveToMemory}>Save to Memory</Button>
            </div>
          </div>
          <div className="prose prose-invert max-w-none text-sm">
            <Markdown text={result.markdown} />
          </div>
        </Card>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="display text-lg">History</h2>
          {history.length > 0 && (
            <Button size="sm" variant="ghost"
              onClick={() => { setHistory([]); saveRethinkHistory([]); }}>
              Clear history
            </Button>
          )}
        </div>
        {history.length === 0 && <p className="text-sm text-muted-foreground">No re-thinks yet.</p>}
        <div className="grid gap-2 md:grid-cols-2">
          {history.map((h) => (
            <Card key={h.id} className="p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{h.label}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">{h.input}</p>
              <Button size="sm" variant="ghost" onClick={() => { setInput(h.input); setMode(h.mode); setResult({ mode: h.mode, label: h.label, markdown: h.markdown, demo: true, createdAt: h.createdAt }); }}>
                Reopen
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
