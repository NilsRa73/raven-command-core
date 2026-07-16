import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, Mic, MonitorPlay, Users, FolderKanban, Workflow, FileText,
  History as HistoryIcon, Brain, Cable, ShieldCheck, Settings as SettingsIcon,
  Menu, X, StopCircle, ClipboardCheck, MonitorSmartphone, BookMarked, RefreshCw,
  Sparkles, AppWindow, ListChecks, ScrollText, HeartPulse,
  Landmark,
} from "lucide-react";
import { RavenMark } from "./RavenMark";
import { useRah } from "@/lib/rah/context";
import { Button } from "@/components/ui/button";
import { HUB_MODULES, HUB_GROUP_LABEL, type ModuleGroup } from "@/lib/rah/moduleRegistry";

const nav = [
  { to: "/", label: "Raven Home", icon: LayoutDashboard },
  { to: "/system-check", label: "System Check", icon: HeartPulse },
  { to: "/applications", label: "Applications", icon: AppWindow },
  { to: "/modules", label: "Module Registry", icon: AppWindow },
  { to: "/routines", label: "Routine Mode", icon: ListChecks },
  { to: "/shopping", label: "Shopping", icon: FolderKanban },
  { to: "/workstream", label: "Workstream", icon: MonitorPlay },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/rethink", label: "Raven Re-think", icon: Sparkles },
  { to: "/voice", label: "Voice Assistant", icon: Mic },
  { to: "/voice-profiles", label: "Voice Profiles", icon: Mic },
  { to: "/vision", label: "Screen Vision", icon: MonitorPlay },
  { to: "/vision-history", label: "Vision History", icon: HistoryIcon },
  { to: "/agents", label: "Agent Team", icon: Users },
  { to: "/council", label: "AI Council", icon: Landmark },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/devices", label: "Device Center", icon: MonitorSmartphone },
  { to: "/native", label: "Native Companion", icon: RefreshCw },
  { to: "/automations", label: "Automations", icon: Workflow },
  { to: "/files", label: "Files & Knowledge", icon: FileText },
  { to: "/history", label: "Command History", icon: HistoryIcon },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/chronicle", label: "Chronicle", icon: BookMarked },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/privacy", label: "Privacy", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { approvals, emergencyStop, activeProject } = useRah();
  const pending = approvals.filter((a) => a.status === "pending").length;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Top bar */}
      <header className="h-14 flex items-center gap-3 px-4 border-b border-border/60 bg-sidebar/60 backdrop-blur-md sticky top-0 z-40">
        <button
          onClick={() => setMobileOpen((o) => !o)}
          className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link to="/" className="flex items-center gap-2">
          <RavenMark size={30} />
          <div className="leading-tight">
            <div className="display text-lg gold-text">RAH Raven Hub</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">RAH AI Studios · Raven One</div>
          </div>
        </Link>
        <span
          className="hidden sm:inline-flex items-center rounded-full border border-primary/60 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary"
          title="Raven One product line — Hub 1.0"
        >
          Raven Hub · 1.0
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("rah:command-palette-toggle"))}
            className="hidden md:inline-flex items-center gap-2 rounded-md border border-border/70 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            aria-label="Open command palette (Ctrl+K)"
            title="Open command palette (Ctrl+K)"
          >
            <span className="text-primary">⌘</span> Search · <kbd className="rounded bg-muted px-1">Ctrl</kbd>+<kbd className="rounded bg-muted px-1">K</kbd>
          </button>
          {activeProject && (
            <div className="hidden md:flex items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-xs">
              <span>{activeProject.icon}</span>
              <span className="text-muted-foreground">Active:</span>
              <span className="text-foreground">{activeProject.name}</span>
            </div>
          )}
          <Link
            to="/approvals"
            className="relative inline-flex h-10 items-center gap-2 rounded-md border border-border/70 px-3 text-sm hover:bg-accent"
          >
            <ClipboardCheck className="h-4 w-4" />
            Approvals
            {pending > 0 && (
              <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {pending}
              </span>
            )}
          </Link>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void emergencyStop()}
            aria-label="Emergency stop — cancel pending actions"
            title="Emergency stop"
          >
            <StopCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Stop</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className={
            "fixed lg:static inset-y-14 left-0 z-30 w-64 shrink-0 border-r border-border/60 bg-sidebar/80 backdrop-blur-md overflow-y-auto transition-transform " +
            (mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")
          }
        >
          <nav className="p-3 flex flex-col gap-1" aria-label="Primary">
            <HubRail pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <div className="mt-4 mb-2 px-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Studio
            </div>
            {nav.map((item) => {
              const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors " +
                    (active
                      ? "bg-accent text-foreground gold-border"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/60")
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="p-3 mt-2">
            <div className="rune-divider mb-3" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Nothing is recorded, shared, or remembered without visible user permission.
            </p>
          </div>
        </aside>

        {/* Main */}
        <main id="main" className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 md:px-6 lg:px-8 py-6 md:py-8 pb-28 lg:pb-8">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 gap-1 border-t border-border/70 bg-sidebar/90 backdrop-blur-md px-2 py-2"
      >
        {[nav[0], nav[1], nav[2], nav[4], nav[7]].map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={
                "flex flex-col items-center gap-1 rounded-md px-2 py-1 text-[10px] " +
                (active ? "text-foreground" : "text-muted-foreground")
              }
            >
              <Icon className={"h-5 w-5 " + (active ? "text-primary" : "")} />
              <span className="truncate max-w-full">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function HubRail({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const groups: ModuleGroup[] = ["core", "environment", "play", "system"];
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const items = HUB_MODULES.filter((m) => m.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g}>
            <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {HUB_GROUP_LABEL[g]}
            </div>
            {items.map((m) => {
              const active = pathname === m.to || (m.to !== "/" && pathname.startsWith(m.to));
              const dim = m.status === "planned";
              return (
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                <Link
                  key={m.id}
                  to={m.to as any}
                  onClick={onNavigate}
                  className={
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors " +
                    (active
                      ? "bg-accent text-foreground gold-border"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/60") +
                    (dim ? " opacity-70" : "")
                  }
                  title={m.description}
                >
                  <span className="grid h-5 w-5 place-items-center text-[13px] text-primary">{m.glyph}</span>
                  <span className="truncate">{m.name}</span>
                  {m.status !== "active" && (
                    <span className="ml-auto text-[9px] uppercase tracking-widest text-muted-foreground">
                      {m.status === "prototype" ? "PROTO" : "SOON"}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}