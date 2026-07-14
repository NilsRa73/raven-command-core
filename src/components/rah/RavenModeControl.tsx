import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Zap, BrainCircuit, Info, RefreshCw, Pin, PinOff, EyeOff, Eye, RotateCcw, ScrollText } from "lucide-react";
import { useRah } from "@/lib/rah/context";
import {
  RAVEN_MODE_META, PRIORITY_LABEL,
  buildContextPacket, classifyRoute, healthCheck,
  type RavenMode,
} from "@/lib/rah/ravenMode";
import {
  getRavenModeState, subscribeRavenMode, setMode as storeSetMode,
  pinMemory, unpinMemory, excludeMemory, includeMemory,
  resetTemporary, markRefreshed, storageAvailable,
} from "@/lib/rah/ravenModeStore";
import { getRavenAudit, subscribeRavenAudit, logRavenAudit } from "@/lib/rah/ravenAudit";
import { toast } from "sonner";

/**
 * Header-mounted Fast/Deep segmented control + Context Manager dialog.
 * - Persists selection via ravenModeStore (localStorage).
 * - Keyboard: Alt+F = Fast, Alt+D = Deep.
 * - All mutating actions emit audit events via ravenAudit.
 */
export function RavenModeControl({ prompt = "" }: { prompt?: string }) {
  const rah = useRah();
  const [state, setState] = useState(() => getRavenModeState());
  useEffect(() => subscribeRavenMode(setState), []);

  const [audit, setAudit] = useState(() => getRavenAudit());
  useEffect(() => subscribeRavenAudit(setAudit), []);

  const [open, setOpen] = useState(false);
  const [openHelp, setOpenHelp] = useState(false);

  const activeProjectId = rah.activeProject?.id ?? null;
  const packet = useMemo(() => buildContextPacket(rah.projectMemory, {
    mode: state.mode,
    projectId: activeProjectId,
    pinnedIds: state.pinnedIds,
    excludedIds: state.excludedIds,
  }), [rah.projectMemory, state.mode, state.pinnedIds, state.excludedIds, activeProjectId, state.lastRefreshAt]);

  const route = useMemo(() => classifyRoute(prompt, {
    mode: state.mode,
    approvalMode: rah.prefs.approvalMode,
  }), [prompt, state.mode, rah.prefs.approvalMode]);

  const health = useMemo(() => healthCheck({
    list: rah.projectMemory,
    storageAvailable: storageAvailable(),
    modePersisted: true,
  }), [rah.projectMemory]);

  // Alt+F / Alt+D shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "f") { e.preventDefault(); storeSetMode("fast"); }
      else if (k === "d") { e.preventDefault(); storeSetMode("deep"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = useCallback((next: RavenMode) => {
    storeSetMode(next);
    toast.success(`Raven ${RAVEN_MODE_META[next].label} active`, {
      description: RAVEN_MODE_META[next].tagline,
    });
  }, []);

  const doRefresh = useCallback(() => {
    markRefreshed();
    toast.success("Context refreshed");
  }, []);
  const doReset = useCallback(() => {
    resetTemporary();
    toast.success("Temporary context cleared");
  }, []);

  const routeTone = route.lane === "approval_required" ? "text-amber-400"
    : route.lane === "planning_deep" ? "text-primary"
    : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2">
      <div
        role="tablist"
        aria-label="Raven response mode"
        className="inline-flex items-center rounded-full border border-primary/40 bg-background/60 p-0.5 shadow-inner"
      >
        <ModeButton mode="fast" active={state.mode === "fast"} onSelect={pick}
          icon={<Zap className="h-3.5 w-3.5" />} label="Fast" />
        <ModeButton mode="deep" active={state.mode === "deep"} onSelect={pick}
          icon={<BrainCircuit className="h-3.5 w-3.5" />} label="Deep" />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/40 px-2 py-1 text-[11px] hover:bg-accent"
            title="Open Context Manager"
            aria-label="Open Context Manager"
          >
            <ScrollText className="h-3.5 w-3.5" />
            <span>{packet.items.length} ctx</span>
            <span className="text-muted-foreground">· ~{packet.approxTokens} tok</span>
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl gold-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-primary">{RAVEN_MODE_META[state.mode].icon}</span>
              Context Manager · {RAVEN_MODE_META[state.mode].label}
            </DialogTitle>
            <DialogDescription>
              {RAVEN_MODE_META[state.mode].tagline}. Response target: <span className="text-primary">{RAVEN_MODE_META[state.mode].target}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Metric label="Selected" value={`${packet.items.length}/${rah.projectMemory.length}`} />
            <Metric label="Approx tokens" value={String(packet.approxTokens)} />
            <Metric label="Compression" value={`${packet.compressionPct}%`} />
            <Metric label="Last refresh" value={state.lastRefreshAt ? new Date(state.lastRefreshAt).toLocaleTimeString() : "never"} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={doRefresh} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 hover:bg-accent">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh Context
            </button>
            <button type="button" onClick={doReset} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 hover:bg-accent">
              <RotateCcw className="h-3.5 w-3.5" /> Reset Temporary
            </button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              cache: {state.cacheHits} hits · {state.cacheMisses} misses
            </span>
          </div>

          <div className={"rounded-md border px-3 py-2 text-xs " + (route.lane === "approval_required" ? "border-amber-400/50 bg-amber-400/5" : "border-border/60 bg-background/40")}>
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-widest text-[10px] text-muted-foreground">Command route</span>
              <span className={"font-medium " + routeTone}>{route.label}</span>
              <span className="text-[10px] text-muted-foreground">· target: {route.target}</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {route.reasons.length ? route.reasons.join(" · ") : "no signals"}
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 bg-background/30 p-2 space-y-1">
            {packet.items.length === 0 && (
              <p className="text-xs text-muted-foreground p-4 text-center">
                No memory records selected. Pin an entry or add a next-action / blocker to prime {RAVEN_MODE_META[state.mode].label}.
              </p>
            )}
            {packet.items.map((s) => (
              <div key={s.rec.id} className="flex items-start gap-2 rounded border border-border/40 bg-background/40 p-2 text-xs">
                <span className={"mt-0.5 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest " +
                  (s.priority === "critical" ? "bg-primary/20 text-primary" :
                   s.priority === "active" ? "bg-amber-400/15 text-amber-300" :
                   "bg-muted text-muted-foreground")}>
                  {PRIORITY_LABEL[s.priority]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.rec.title || "(untitled)"}</div>
                  <div className="text-[10px] text-muted-foreground">{s.reason}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" title="Pin" onClick={() => state.pinnedIds.includes(s.rec.id) ? unpinMemory(s.rec.id) : pinMemory(s.rec.id)}
                    className="rounded p-1 hover:bg-accent">
                    {state.pinnedIds.includes(s.rec.id) ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  </button>
                  <button type="button" title="Exclude" onClick={() => state.excludedIds.includes(s.rec.id) ? includeMemory(s.rec.id) : excludeMemory(s.rec.id)}
                    className="rounded p-1 hover:bg-accent">
                    {state.excludedIds.includes(s.rec.id) ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <details className="rounded-md border border-border/60 bg-background/40 text-xs">
            <summary className="cursor-pointer px-3 py-2 select-none">Preview exact context packet ({packet.approxChars} chars)</summary>
            <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-snug whitespace-pre-wrap">{packet.text}</pre>
          </details>

          <details className="rounded-md border border-border/60 bg-background/40 text-xs">
            <summary className="cursor-pointer px-3 py-2 select-none">Recent audit ({audit.length})</summary>
            <ul className="max-h-40 overflow-auto px-3 pb-2 text-[11px]">
              {audit.slice(-30).reverse().map((a) => (
                <li key={a.id} className="border-b border-border/30 py-1">
                  <span className="text-muted-foreground">{new Date(a.ts).toLocaleTimeString()}</span>
                  {" · "}
                  <span className="text-primary">{a.type}</span>
                  {" · "}
                  <span>{a.detail}</span>
                </li>
              ))}
              {audit.length === 0 && <li className="py-2 text-muted-foreground">No audit events yet.</li>}
            </ul>
          </details>

          {!health.ok && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-[11px] text-destructive">
              Health warnings:
              <ul className="ml-4 list-disc">{health.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setOpenHelp(true); logRavenAudit({ type: "health_check", detail: "help opened", source: "user" }); }}>
              <Info className="h-3.5 w-3.5" /> When to use Fast vs Deep?
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openHelp} onOpenChange={setOpenHelp}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Fast Mode vs Deep Mode</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <div className="flex items-center gap-2 font-medium"><Zap className="h-4 w-4 text-primary" /> Fast Mode</div>
              <p className="text-muted-foreground text-xs mt-1">Instant answers, short prompts, quick actions. Prioritizes Critical (pinned) and Active (blockers / next-actions) memory, plus a small number of the most recent and relevant Supporting notes so recent context is not lost. Best for status checks, quick edits, one-liners.</p>
            </div>
            <div>
              <div className="flex items-center gap-2 font-medium"><BrainCircuit className="h-4 w-4 text-primary" /> Deep Mode</div>
              <p className="text-muted-foreground text-xs mt-1">Planning, architecture, tradeoffs, and multi-step reasoning. Expands context with Supporting memory and surfaces assumptions, dependencies, and staged plans. Best for design docs, refactors, roadmaps.</p>
            </div>
            <p className="text-[11px] text-muted-foreground">Approval rules and governance are identical in both modes — critical actions always require approval.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModeButton({ mode, active, onSelect, icon, label }: {
  mode: RavenMode; active: boolean; onSelect: (m: RavenMode) => void;
  icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(mode)}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] uppercase tracking-widest transition-all outline-none " +
        "focus-visible:ring-2 focus-visible:ring-primary/60 " +
        (active
          ? "bg-gradient-to-b from-primary/30 to-primary/10 text-primary shadow-[0_0_0_1px_rgba(212,175,55,0.5)]"
          : "text-muted-foreground hover:text-foreground")
      }
      title={`${label} Mode (Alt+${label[0]})`}
    >
      <span className={active ? "animate-pulse" : ""}>{icon}</span>
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
