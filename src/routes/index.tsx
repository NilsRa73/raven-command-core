import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CommandBar } from "@/components/rah/CommandBar";
import { useRah } from "@/lib/rah/context";
import { AGENTS, agentById } from "@/lib/rah/agents";
import { RavenMark } from "@/components/rah/RavenMark";
import { getLocalAiSettings, engineLabel, subscribeLocalAi, isLocalEngine, type LocalAiSettings } from "@/lib/rah/localAi";
import { useBridgeStatus, refreshBridgeStatus } from "@/lib/rah/bridgeStatus";
import { bridgeShortLabel, bridgeUiKind } from "@/lib/rah/bridgeStatusLabels";
import { selectWelcomeSummary, memoryDiagnostics, MEMORY_TYPE_LABEL } from "@/lib/rah/projectMemory";

export const Route = createFileRoute("/")({
  component: CommandCenter,
});

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="glass-panel p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold display gold-text">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function CommandCenter() {
  const rah = useRah();
  const welcome = useMemo(
    () => selectWelcomeSummary(rah.projectMemory, { projectId: rah.activeProject?.id ?? null }),
    [rah.projectMemory, rah.activeProject?.id],
  );
  const memDiag = useMemo(() => memoryDiagnostics(rah.projectMemory), [rah.projectMemory]);
  const [localAi, setLocalAi] = useState<LocalAiSettings>(() => getLocalAiSettings());
  useEffect(() => subscribeLocalAi(setLocalAi), []);
  const { snapshot: bridge, loading: bridgeLoading, refreshing: bridgeRefreshing } = useBridgeStatus();
  // Route navigation back to the Command Center must trigger a fresh bridge
  // check immediately rather than waiting for the 5s poll tick — this is what
  // guarantees the strip below is never stale after returning from Connections.
  useEffect(() => { void refreshBridgeStatus(); }, []);
  const bridgeKind = bridgeUiKind(bridge, bridgeLoading);
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = rah.commands.filter((c) => c.createdAt >= today.getTime()).length;
    const voice = rah.commands.filter((c) => c.inputType === "voice").length;
    const pending = rah.approvals.filter((a) => a.status === "pending").length;
    const active = rah.projects.filter((p) => p.status === "active").length;
    const agentCounts = new Map<string, number>();
    rah.commands.forEach((c) => c.agents.forEach((a) => agentCounts.set(a, (agentCounts.get(a) ?? 0) + 1)));
    const top = [...agentCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { today: todayCount, voice, pending, active, mem: rah.memory.length, mostAgent: top ? agentById(top[0])?.name ?? top[0] : "—" };
  }, [rah.commands, rah.approvals, rah.projects, rah.memory]);

  const recent = rah.commands.slice(0, 5);

  return (
    <div className="space-y-6">
      {!rah.prefs.onboardingComplete && (
        <div className="glass-panel gold-border p-4 flex flex-wrap items-center gap-3">
          <RavenMark size={32} />
          <div className="min-w-0">
            <div className="display gold-text text-lg">Welcome to RAH Listen Key</div>
            <div className="text-sm text-muted-foreground">Run the short setup to choose language, approvals and your first project.</div>
          </div>
          <Link to="/onboarding" className="ml-auto inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Start onboarding
          </Link>
        </div>
      )}

      <div>
        <h1 className="display text-3xl md:text-4xl">Command Center</h1>
        <p className="text-muted-foreground mt-1">Speak. Show. Command. Create.</p>
      </div>

      {(welcome.lastMilestone || welcome.currentBlocker || welcome.nextAction || rah.activeProject) && (
        <section className="glass-panel gold-border p-4" aria-label="Welcome back summary">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-primary text-lg">🜛</span>
            <div className="display text-lg gold-text">Welcome back</div>
            <span className="ml-auto text-[11px] text-muted-foreground">Local memory · never uploaded</span>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <WelcomeCell label="Active project" value={rah.activeProject ? `${rah.activeProject.icon} ${rah.activeProject.name}` : "None"} />
            <WelcomeCell label="Last milestone" value={welcome.lastMilestone?.title ?? "—"} />
            <WelcomeCell label="Current blocker" value={welcome.currentBlocker?.title ?? "None"} tone={welcome.currentBlocker ? "warn" : "ok"} />
            <WelcomeCell label="Next action" value={welcome.nextAction?.title ?? "—"} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => rah.focusCommandBar()}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90"
            >
              Continue →
            </button>
            <Link to="/memory" className="text-primary hover:underline">Open Project Memory →</Link>
            <span className="ml-auto text-muted-foreground">
              {memDiag.total} record{memDiag.total === 1 ? "" : "s"} · {memDiag.pinned} pinned · {memDiag.archived} archived
            </span>
          </div>
        </section>
      )}

      <div className="glass-panel p-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full border border-border/70 px-2 py-1">
          <span className="text-muted-foreground">Engine:</span>{" "}
          <span className="text-foreground">{engineLabel(localAi.engine)}</span>
        </span>
        {isLocalEngine(localAi.engine) && (
          <span className="rounded-full border border-primary/60 bg-primary/10 px-2 py-1 text-primary">LOCAL</span>
        )}
        {localAi.engine === "cloud" && (
          <span className="rounded-full border border-border/70 px-2 py-1 text-muted-foreground">CLOUD</span>
        )}
        <span className={
          "rounded-full border px-2 py-1 " +
          (bridgeKind === "connected" ? "border-primary/60 text-primary"
            : bridgeKind === "emergency" || bridgeKind === "error" ? "border-destructive text-destructive"
            : bridgeKind === "checking" ? "border-primary/40 text-primary/80 animate-pulse"
            : "border-border/70 text-muted-foreground")
        } title={bridgeRefreshing ? "Refreshing bridge status…" : undefined}>
          Bridge: {bridgeShortLabel(bridge, bridgeLoading)}
          {bridgeKind === "connected" && bridge?.version ? ` v${bridge.version}` : ""}
          {bridgeKind === "connected" && bridgeRefreshing && (
            <span className="ml-1 opacity-60">·</span>
          )}
        </span>
        {stats.pending > 0 && (
          <Link to="/approvals" className="rounded-full border border-primary/60 text-primary px-2 py-1">
            {stats.pending} pending approval{stats.pending > 1 ? "s" : ""} →
          </Link>
        )}
        <Link
          to="/vision"
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/20"
          aria-label="Open Raven Screen Vision"
          title="Share your screen and let Raven analyze what's on it"
        >
          👁 Analyze screen →
        </Link>
      </div>

      <CommandBar />

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Commands today" value={stats.today} />
        <Stat label="Voice commands" value={stats.voice} />
        <Stat label="Pending approvals" value={stats.pending} hint="Live count" />
        <Stat label="Active projects" value={stats.active} />
        <Stat label="Saved memories" value={stats.mem} />
        <Stat label="Most-used agent" value={stats.mostAgent} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass-panel p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="display text-lg">Recent activity</h2>
            <Link to="/history" className="text-xs text-primary hover:underline">Open history</Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commands yet. Try “RAH Brain, help me organize my next project.”</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {recent.map((c) => (
                <li key={c.id} className="py-2 flex items-start gap-3">
                  <span className="mt-0.5 text-xs text-muted-foreground min-w-[68px]">
                    {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{c.prompt}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.agents.map((a) => agentById(a)?.emoji).join(" ")} · {c.mode} · {c.status}
                      {c.demo && " · demo output"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass-panel p-4">
          <h2 className="display text-lg mb-3">Agent team</h2>
          <ul className="space-y-2">
            {AGENTS.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <span className="text-lg leading-none">{a.emoji}</span>
                <div className="min-w-0">
                  <div className="text-sm">{a.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{a.summary}</div>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/agents" className="mt-3 inline-block text-xs text-primary hover:underline">View all agents</Link>
        </div>
      </div>
    </div>
  );
}
