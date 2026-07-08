import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Volume2, Star, RotateCcw, Square, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "./Markdown";
import type { AiState } from "@/lib/rah/ai";

export interface LiveResponse {
  id?: string;
  prompt: string;
  agents: string[];
  text: string;
  state: "thinking" | "streaming" | "done" | "error" | "cancelled";
  provider?: string;
  model?: string;
  latencyMs?: number;
  usage?: unknown;
  error?: string;
  errorState?: AiState;
  demo?: boolean;
  startedAt: number;
  favorite?: boolean;
  visionUsed?: boolean;
  attachmentCount?: number;
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}

export function ResponsePanel({
  response, onStop, onRetry, onSaveToProject, onFavorite, onClear,
}: {
  response: LiveResponse | null;
  onStop: () => void;
  onRetry: () => void;
  onSaveToProject: () => void;
  onFavorite: () => void;
  onClear: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!response || (response.state !== "thinking" && response.state !== "streaming")) return;
    const t = setInterval(() => setElapsed(Date.now() - response.startedAt), 100);
    return () => clearInterval(t);
  }, [response]);

  if (!response) return null;
  const streaming = response.state === "thinking" || response.state === "streaming";
  const latency = response.latencyMs ?? elapsed;

  return (
    <section className="glass-panel gold-border p-4 md:p-5 space-y-3" aria-live="polite">
      <header className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        <span className={
          "rounded-full border px-2 py-0.5 " +
          (response.demo ? "border-yellow-500/60 text-yellow-500" :
           response.state === "error" ? "border-destructive text-destructive" :
           response.state === "done" ? "border-primary text-primary" :
           "border-primary/60 text-primary animate-pulse")
        }>
          {response.demo ? "Local Demo" : response.state === "error" ? "Error" : response.state === "done" ? "Real AI" : (response.state === "thinking" ? "Thinking…" : "Streaming…")}
        </span>
        {response.provider && <span>{response.provider}</span>}
        {response.model && <span>· {response.model}</span>}
        <span>· {(latency / 1000).toFixed(2)}s</span>
        {response.visionUsed && (
          <span className="rounded-full border border-primary/60 px-2 py-0.5 text-primary">
            👁 Vision used{response.attachmentCount ? ` · ${response.attachmentCount} img` : ""}
          </span>
        )}
        {(() => {
          const u = response.usage as { total_tokens?: number } | null | undefined;
          if (!u || typeof u !== "object" || u.total_tokens == null) return null;
          return <span>· {String(u.total_tokens)} tok</span>;
        })()}
        <span className="ml-auto normal-case tracking-normal">Agents: {response.agents.join(", ") || "brain"}</span>
      </header>

      <div className="rounded-md border border-border/60 bg-background/40 p-3 min-h-[80px] max-h-[60vh] overflow-auto">
        {response.state === "error" ? (
          <div className="text-sm text-destructive whitespace-pre-wrap">
            <strong>{response.errorState ?? "error"}:</strong> {response.error ?? "Unknown error."}
          </div>
        ) : response.text ? (
          <Markdown>{response.text}</Markdown>
        ) : (
          <div className="text-sm text-muted-foreground">
            {response.state === "thinking" ? "Contacting the model…" : "Waiting for tokens…"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {streaming ? (
          <Button type="button" variant="destructive" size="sm" onClick={onStop}><Square className="h-3.5 w-3.5" /> Stop</Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="secondary" disabled={!response.text}
              onClick={async () => { await navigator.clipboard.writeText(response.text); toast.success("Copied response"); }}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!response.text}
              onClick={() => { if (!speak(response.text)) toast.error("Speech synthesis unavailable"); }}>
              <Volume2 className="h-3.5 w-3.5" /> Speak
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!response.text} onClick={onSaveToProject}>
              <Save className="h-3.5 w-3.5" /> Save to Project
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onFavorite}>
              <Star className="h-3.5 w-3.5" /> {response.favorite ? "Favorited" : "Favorite"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          </>
        )}
      </div>
    </section>
  );
}