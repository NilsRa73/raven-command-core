import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, Mic, MonitorPlay, Users, FolderKanban, Workflow, FileText,
  History as HistoryIcon, Brain, Cable, ShieldCheck, Settings as SettingsIcon,
  Menu, X, StopCircle, ClipboardCheck, MonitorSmartphone, BookMarked,
} from "lucide-react";
import { RavenMark } from "./RavenMark";
import { useRah } from "@/lib/rah/context";
import { Button } from "@/components/ui/button";

const nav = [
  { to: "/", label: "Raven Home", icon: LayoutDashboard },
  { to: "/voice", label: "Voice Assistant", icon: Mic },
  { to: "/vision", label: "Screen Vision", icon: MonitorPlay },
  { to: "/agents", label: "Agent Team", icon: Users },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/devices", label: "Device Center", icon: MonitorSmartphone },
  { to: "/automations", label: "Automations", icon: Workflow },
  { to: "/files", label: "Files & Knowledge", icon: FileText },
  { to: "/history", label: "Command History", icon: HistoryIcon },
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
            <div className="display text-lg gold-text">RAH Listen Key</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">RAH AI Studios</div>
          </div>
        </Link>
        <span
          className="hidden sm:inline-flex items-center rounded-full border border-primary/60 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary"
          title="Raven One product line — Alpha 0.1"
        >
          Raven One · Alpha 0.1
        </span>
        <div className="ml-auto flex items-center gap-2">
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