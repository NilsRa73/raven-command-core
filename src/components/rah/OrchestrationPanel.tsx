import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Loader2, StopCircle, RefreshCw, X, CheckCircle2, AlertCircle, Bookmark } from "lucide-react";
import type { OrchestrationState, TaskCard } from "@/lib/rah/orchestrationRuntime";
import { privacyBadgeClass } from "@/lib/rah/orchestrationRuntime";
import { TEAM_MODE_LABEL } from "@/lib/rah/orchestrator";

function StateBadge({ state }: { state: TaskCard["state"] }) {
  const map: Record<TaskCard["state"], { label: string; cls: string; Icon: any }> = {
    queued:    { label: "Queued",    cls: "border-border/70 text-muted-foreground",     Icon: Loader2 },
    running:   { label: "Running",   cls: "border-primary/60 bg-primary/10 text-primary", Icon: Loader2 },
    done:      { label: "Done",      cls: "border-emerald-500/60 bg-emerald-500/10 text-emerald-400", Icon: CheckCircle2 },
    failed:    { label: "Failed",    cls: "border-destructive/60 bg-destructive/10 text-destructive", Icon: AlertCircle },
    cancelled: { label: "Cancelled", cls: "border-border/70 text-muted-foreground",      Icon: StopCircle },
  };
  const { label, cls, Icon } = map[state];
  const spin = state === "running" || state === "queued";
  return (
    <span className={"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + cls}>
      <Icon className={"h-3 w-3 " + (spin ? "animate-spin" : "")} />
      {label}
    </span>
  );
}

function fmtMs(ms?: number) {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface OrchestrationPanelProps {
  state: OrchestrationState;
  onCancelAll: () => void;
  onCancelTask: (id: string) => void;
  onRetryAgent: (id: string) => void;
  onRetrySynthesis: () => void;
  onSaveSummary?: () => void;
  onClose: () => void;
}

export function OrchestrationPanel(p: OrchestrationPanelProps) {
  const { state } = p;
  const running = state.phase === "running" || state.phase === "synthesizing";
  const doneCount = state.tasks.filter((t) => t.state === "done").length;
  const failCount = state.tasks.filter((t) => t.state === "failed").length;
  const cancelCount = state.tasks.filter((t) => t.state === "cancelled").length;
  return (
    <div className="glass-panel gold-border p-4 md:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="uppercase tracking-widest text-muted-foreground">Team run</span>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-widest">
          {TEAM_MODE_LABEL[state.teamMode]}
        </span>
        <span className={"rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + privacyBadgeClass(state.privacy)}>
          {state.privacy}
        </span>
        <span className="text-muted-foreground">
          {doneCount}/{state.tasks.length} done{failCount ? ` · ${failCount} failed` : ""}{cancelCount ? ` · ${cancelCount} cancelled` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {running && (
            <Button size="sm" variant="destructive" onClick={p.onCancelAll}>
              <StopCircle className="h-4 w-4" /> Cancel run
            </Button>
          )}
          {!running && (
            <Button size="sm" variant="ghost" onClick={p.onClose} aria-label="Close team run">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <ul className="grid gap-2 md:grid-cols-2">
        {state.tasks.map((t) => (
          <li key={t.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span aria-hidden>{t.agentEmoji}</span>
              <span className="font-medium">{t.agentName}</span>
              <span className="ml-auto"><StateBadge state={t.state} /></span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono truncate" title={t.runtimeLine}>
              {t.runtimeLine}
              {t.latencyMs != null ? ` · ${fmtMs(t.latencyMs)}` : ""}
            </div>
            {t.state === "failed" && t.error && (
              <div className="text-xs text-destructive">{t.error}</div>
            )}
            {t.text && (
              <div className="max-h-40 overflow-y-auto rounded border border-border/50 bg-background/60 p-2 text-xs prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{t.text}</ReactMarkdown>
              </div>
            )}
            <div className="flex items-center gap-2">
              {t.state === "running" && (
                <Button size="sm" variant="ghost" onClick={() => p.onCancelTask(t.id)}>
                  <StopCircle className="h-3 w-3" /> Cancel
                </Button>
              )}
              {(t.state === "failed" || t.state === "cancelled") && (
                <Button size="sm" variant="secondary" onClick={() => p.onRetryAgent(t.id)}>
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="uppercase tracking-widest text-muted-foreground">Master Brain synthesis</span>
          {state.phase === "synthesizing" && (
            <span className="inline-flex items-center gap-1 text-primary text-[11px]">
              <Loader2 className="h-3 w-3 animate-spin" /> synthesizing…
            </span>
          )}
          {state.phase === "done" && (
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={p.onRetrySynthesis}>
                <RefreshCw className="h-3 w-3" /> Re-synthesize
              </Button>
              {p.onSaveSummary && (
                <Button size="sm" variant="secondary" onClick={p.onSaveSummary}>
                  <Bookmark className="h-3 w-3" /> Save summary to Memory
                </Button>
              )}
            </span>
          )}
        </div>
        {state.synthesisRuntimeLine && (
          <div className="text-[10px] text-muted-foreground font-mono">{state.synthesisRuntimeLine}</div>
        )}
        <div className="rounded border border-border/50 bg-background/60 p-3 text-sm prose prose-invert prose-sm max-w-none min-h-[3rem]">
          {state.synthesis
            ? <ReactMarkdown>{state.synthesis}</ReactMarkdown>
            : <span className="text-muted-foreground text-xs">Waiting for specialists…</span>}
        </div>
      </div>
    </div>
  );
}