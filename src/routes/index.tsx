import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CommandBar } from "@/components/rah/CommandBar";
import { useRah } from "@/lib/rah/context";
import { RavenMark } from "@/components/rah/RavenMark";
import {
  getLocalAiSettings, engineLabel, subscribeLocalAi,
  type LocalAiSettings,
} from "@/lib/rah/localAi";
import { useBridgeStatus, refreshBridgeStatus } from "@/lib/rah/bridgeStatus";
import { bridgeShortLabel, bridgeUiKind } from "@/lib/rah/bridgeStatusLabels";
import { bridgeSystemStatus } from "@/lib/rah/bridge";
import type { BridgeSystemStatus } from "@/lib/rah/bridge-protocol";
import { isSpeechSupported } from "@/lib/rah/speech";
import { useOrchestration } from "@/lib/rah/orchestrationRuntime";
import { useAgentStats } from "@/lib/rah/agentSessionStats";
import {
  computeReadiness, computePrivacyStatus, deriveTodaysMission,
  mergeRecentActivity, formatTelemetry, agentTeamCounts,
  loadFocusMode, saveFocusMode,
} from "@/lib/rah/missionControl";
import { memoryDiagnostics } from "@/lib/rah/projectMemory";

export const Route = createFileRoute("/")({
  component: CommandCenter,
});

function Card({ title, children, action, tone }: {
  title: string; children: React.ReactNode;
  action?: React.ReactNode; tone?: "ok" | "warn" | "bad";
}) {
  const border = tone === "warn"
    ? "border-yellow-500/50"
    : tone === "bad" ? "border-destructive/60"
    : tone === "ok" ? "border-primary/40"
    : "border-border/60";
  return (
    <section className={"glass-panel p-4 border " + border}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="display text-sm uppercase tracking-widest text-muted-foreground">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

function KeyVal({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" | "bad" }) {
  const cls = tone === "warn" ? "text-yellow-400"
    : tone === "bad" ? "text-destructive"
    : tone === "ok" ? "text-primary"
    : "text-foreground";
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={"mt-0.5 text-sm truncate " + cls} title={value}>{value}</div>
    </div>
  );
}

function PrivacyBadge({ label, explanation }: { label: string; explanation: string }) {
  const cls = label === "LOCAL" ? "border-primary/60 bg-primary/10 text-primary"
    : label === "CLOUD" ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-400"
    : label === "MIXED" ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-400"
    : "border-destructive/60 bg-destructive/10 text-destructive";
  return (
    <span
      className={"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + cls}
      title={explanation}
    >
      {label}
    </span>
  );
}

function CommandCenter() {
  const rah = useRah();
  const [localAi, setLocalAi] = useState<LocalAiSettings>(() => getLocalAiSettings());
  useEffect(() => subscribeLocalAi(setLocalAi), []);
  const { snapshot: bridge, loading: bridgeLoading, refreshing: bridgeRefreshing, refresh: refreshBridge } =
    useBridgeStatus();
  useEffect(() => { void refreshBridgeStatus(); }, []);

  const [voiceSupported, setVoiceSupported] = useState(false);
  const [visionSupported, setVisionSupported] = useState(false);
  useEffect(() => {
    setVoiceSupported(isSpeechSupported());
    setVisionSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getDisplayMedia,
    );
  }, []);

  const [sys, setSys] = useState<BridgeSystemStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (bridge?.ui === "paired_online") {
      bridgeSystemStatus().then((s) => { if (!cancelled) setSys(s); }).catch(() => { /* ignore */ });
    } else {
      setSys(null);
    }
    return () => { cancelled = true; };
  }, [bridge?.ui, bridge?.version]);

  const orch = useOrchestration();
  const agentStats = useAgentStats();

  const [focus, setFocusState] = useState<boolean>(() => loadFocusMode());
  const setFocus = (v: boolean) => { saveFocusMode(v); setFocusState(v); };

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const readiness = useMemo(() => computeReadiness({
    bridgeSnapshot: bridge, engine: localAi.engine,
    projectSelected: !!rah.activeProject, memoryEnabled: rah.prefs.memoryEnabled,
    voiceSupported, visionSupported,
  }), [bridge, localAi.engine, rah.activeProject, rah.prefs.memoryEnabled, voiceSupported, visionSupported]);

  const privacy = useMemo(() => computePrivacyStatus({
    engine: localAi.engine, transport: localAi.transport, bridgeSnapshot: bridge,
  }), [localAi.engine, localAi.transport, bridge]);

  const mission = useMemo(() => deriveTodaysMission({
    projectMemory: rah.projectMemory,
    projectId: rah.activeProject?.id ?? null,
    commands: rah.commands,
  }), [rah.projectMemory, rah.activeProject?.id, rah.commands]);

  const activity = useMemo(() => mergeRecentActivity({
    commands: rah.commands, projectMemory: rah.projectMemory, limit: 8,
  }), [rah.commands, rah.projectMemory]);

  const telemetry = useMemo(
    () => formatTelemetry(sys, { latencyMs: bridge?.latencyMs }),
    [sys, bridge?.latencyMs],
  );

  const teamCounts = useMemo(() => agentTeamCounts(orch.state, agentStats), [orch.state, agentStats]);

  const memDiag = useMemo(() => memoryDiagnostics(rah.projectMemory), [rah.projectMemory]);
  const pendingApprovals = rah.approvals.filter((a) => a.status === "pending").length;

  const bridgeKind = bridgeUiKind(bridge, bridgeLoading);
  const bridgeTone: "ok" | "warn" | "bad" | undefined =
    bridgeKind === "connected" ? "ok"
    : bridgeKind === "offline" || bridgeKind === "error" || bridgeKind === "emergency" ? "bad"
    : bridgeKind === "update_required" || bridgeKind === "pair_required" ? "warn"
    : undefined;

  const localTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const localDate = new Date(now).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="space-y-4">
      {!rah.prefs.onboardingComplete && (
        <div className="glass-panel gold-border p-3 flex flex-wrap items-center gap-3">
          <RavenMark size={28} />
          <div className="min-w-0">
            <div className="display gold-text text-base">Welcome to RAH Listen Key</div>
            <div className="text-xs text-muted-foreground">Run the short setup to choose language, approvals and your first project.</div>
          </div>
          <Link to="/onboarding" className="ml-auto inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            Start onboarding
          </Link>
        </div>
      )}

      {/* ── Greeting / header ───────────────────────────────────────── */}
      <header className="glass-panel gold-border p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-center">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Raven Home · Alpha 0.1</div>
            <h1 className="display text-2xl md:text-3xl gold-text truncate">
              Welcome back, Nils. Let’s build something worthwhile today.
            </h1>
            <div className="mt-1 text-xs text-muted-foreground">
              {rah.activeProject ? <>Active project: <span className="text-foreground">{rah.activeProject.icon} {rah.activeProject.name}</span> · </> : <>No active project · </>}
              {localDate} · {localTime}
              {rah.activeProject?.goals ? <> · Goal: <span className="text-foreground">{rah.activeProject.goals.slice(0, 90)}</span></> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PrivacyBadge label={privacy.label} explanation={privacy.explanation} />
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Readiness {readiness.score}%
            </span>
            <label className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-[11px]">
              <input
                type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)}
                className="h-3 w-3 accent-primary"
              />
              Focus mode
            </label>
          </div>
        </div>
      </header>

      {/* ── Current mission summary ────────────────────────────────── */}
      <section className="glass-panel p-4" aria-label="Current mission">
        <div className="grid gap-2 md:grid-cols-3">
          <KeyVal label="Next action" value={mission.nextAction?.title ?? "—"} />
          <KeyVal
            label="Current blocker" tone={mission.blocker ? "warn" : "ok"}
            value={mission.blocker?.title ?? "None"}
          />
          <KeyVal label="Last milestone" value={mission.lastMilestone?.title ?? "—"} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              if (rah.activeProject) rah.focusCommandBar();
              else toast.message("No active project", { description: "Open Projects to pick one, then continue today’s mission." });
            }}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90"
          >
            Continue today’s mission →
          </button>
          <Link to="/memory" className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 hover:border-primary/60">
            View memory
          </Link>
          <Link to="/projects" className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 hover:border-primary/60">
            Change project
          </Link>
          <Link to="/devices" className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 hover:border-primary/60">
            Device Center
          </Link>
          <Link to="/chronicle" className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 hover:border-primary/60">
            Chronicle
          </Link>
          {pendingApprovals > 0 && (
            <Link to="/approvals" className="ml-auto rounded-full border border-primary/60 bg-primary/10 px-3 py-1 text-primary">
              {pendingApprovals} pending approval{pendingApprovals > 1 ? "s" : ""} →
            </Link>
          )}
        </div>
      </section>

      {/* ── Command Bar (always immediately reachable) ─────────────── */}
      <CommandBar />

      {focus ? null : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* System status */}
          <Card
            title="System status"
            tone={bridgeTone}
            action={
              <button
                type="button" onClick={() => refreshBridge()}
                className="text-[11px] text-primary hover:underline"
                title={bridgeRefreshing ? "Refreshing…" : "Refresh"}
              >
                Refresh
              </button>
            }
          >
            <div className="grid gap-2 grid-cols-2">
              <KeyVal
                label="Desktop Bridge"
                value={bridgeShortLabel(bridge, bridgeLoading) + (bridge?.version ? " · v" + bridge.version : "")}
                tone={bridgeTone}
              />
              <KeyVal label="AI engine" value={engineLabel(localAi.engine)} />
              <KeyVal label="Cloud AI" value={localAi.engine === "cloud" ? "in use" : "available fallback"} />
              <KeyVal
                label="Voice"
                value={voiceSupported ? "supported" : "unsupported browser"}
                tone={voiceSupported ? "ok" : "warn"}
              />
              <KeyVal
                label="Screen Vision"
                value={visionSupported ? "ready" : "unavailable"}
                tone={visionSupported ? "ok" : "warn"}
              />
              <KeyVal
                label="Project memory"
                value={rah.prefs.memoryEnabled ? `${memDiag.total} record${memDiag.total === 1 ? "" : "s"}` : "disabled"}
                tone={rah.prefs.memoryEnabled ? undefined : "warn"}
              />
            </div>
          </Card>

          {/* Hardware telemetry */}
          <Card
            title="Host telemetry"
            action={
              <span className="text-[11px] text-muted-foreground">
                {telemetry.available ? "live via Bridge" : "requires Bridge"}
              </span>
            }
          >
            <div className="grid gap-2 grid-cols-1">
              <KeyVal label="CPU" value={telemetry.cpuLine} />
              <KeyVal label="Memory" value={telemetry.memoryLine} />
              <KeyVal label="Platform" value={telemetry.platformLine} />
              <KeyVal label="Host / user" value={telemetry.hostUserLine} />
              <KeyVal label="Bridge latency" value={telemetry.latencyLine} />
              <KeyVal label="GPU" value={telemetry.gpuLine} tone="warn" />
            </div>
          </Card>

          {/* Today's mission suggestions */}
          <Card
            title="Today's mission"
            action={<Link to="/memory" className="text-[11px] text-primary hover:underline">Open memory</Link>}
          >
            {mission.suggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No deterministic suggestions yet. Add a “next action” or “blocker” in Project Memory to see it here.
              </p>
            ) : (
              <ol className="space-y-2">
                {mission.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 text-primary">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate" title={s.title}>{s.title}</div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.source}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 text-[11px] text-muted-foreground">
              Deterministic — sourced from Project Memory + pending approvals. No AI generation.
            </div>
          </Card>

          {/* Agent team */}
          <Card
            title="Agent team"
            tone={teamCounts.active ? "ok" : undefined}
            action={<Link to="/agents" className="text-[11px] text-primary hover:underline">Open team</Link>}
          >
            <div className="grid gap-2 grid-cols-2">
              <KeyVal label="Current run" value={teamCounts.active ? teamCounts.phase : "idle"} tone={teamCounts.active ? "ok" : undefined} />
              <KeyVal label="Running tasks" value={String(teamCounts.runningTasks)} />
              <KeyVal label="Completed (session)" value={String(teamCounts.completedRuns)} />
              <KeyVal label="Failed (session)" value={String(teamCounts.failedRuns)} tone={teamCounts.failedRuns ? "warn" : undefined} />
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">Session-only counters. Never persisted.</div>
          </Card>

          {/* Recent activity */}
          <Card
            title="Recent activity"
            action={<Link to="/history" className="text-[11px] text-primary hover:underline">Open history</Link>}
          >
            {activity.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activity yet. Anything you run or save will appear here.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {activity.map((r, i) => (
                  <li key={i} className="py-1.5 flex items-start gap-2 text-sm">
                    <span className="mt-0.5 text-[10px] text-muted-foreground min-w-[54px]">
                      {r.ts ? new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{r.title}</div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {r.source}{r.status ? " · " + r.status : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Quick actions */}
          <Card title="Quick actions">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link to="/voice" className="rounded-md border border-border/60 bg-background/40 px-3 py-2 hover:border-primary/60">🎙 Voice session</Link>
              <Link to="/vision" className="rounded-md border border-border/60 bg-background/40 px-3 py-2 hover:border-primary/60">👁 Screen Vision</Link>
              <button
                type="button" onClick={() => rah.focusCommandBar()}
                className="rounded-md border border-primary/60 bg-primary/10 px-3 py-2 text-left text-primary hover:bg-primary/20"
              >
                ⚡ Team Review (use CommandBar)
              </button>
              <button
                type="button" onClick={() => rah.focusCommandBar()}
                className="rounded-md border border-primary/60 bg-primary/10 px-3 py-2 text-left text-primary hover:bg-primary/20"
              >
                🜛 Full Council (use CommandBar)
              </button>
              <Link to="/projects" className="rounded-md border border-border/60 bg-background/40 px-3 py-2 hover:border-primary/60">＋ New project</Link>
              <Link to="/files" className="rounded-md border border-border/60 bg-background/40 px-3 py-2 hover:border-primary/60">📁 Files &amp; Knowledge</Link>
              <Link to="/connections" className="rounded-md border border-border/60 bg-background/40 px-3 py-2 hover:border-primary/60 col-span-2">🔗 Connections</Link>
            </div>
          </Card>

          {/* Readiness detail */}
          <Card title={"Raven readiness (" + readiness.score + "%)"}>
            <ul className="space-y-1 text-xs">
              {readiness.checks.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className={c.ok ? "text-primary" : "text-muted-foreground"}>{c.ok ? "✓" : "○"}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.weight}%{c.detail ? " · " + c.detail : ""}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[11px] text-muted-foreground">
              Score = sum of passing weights. All checks are live app state; nothing is inferred.
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
