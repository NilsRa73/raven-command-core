import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRah } from "@/lib/rah/context";

export const Route = createFileRoute("/applications")({
  head: () => ({ meta: [
    { title: "Applications — RAH AI Studios" },
    { name: "description", content: "Launcher for RAH studio applications and modules." },
  ] }),
  component: ApplicationsPage,
});

interface AppCard {
  id: string; name: string; icon: string; status: "shipping" | "alpha" | "planned";
  version: string; progress: number; summary: string; to?: string;
  external?: string;
}

const APPS: AppCard[] = [
  { id: "raven-command", name: "Raven Command Center", icon: "🜛", status: "shipping",
    version: "Alpha 0.3", progress: 82, summary: "This app. Orchestrates every RAH module.", to: "/" },
  { id: "rah-vision", name: "Raven Vision", icon: "👁", status: "shipping",
    version: "v0.3", progress: 78, summary: "Consent-first screen capture with redaction.", to: "/vision" },
  { id: "rah-memory", name: "Project Memory", icon: "🜃", status: "shipping",
    version: "v0.2", progress: 74, summary: "Long-term project context with prompt injection.", to: "/memory" },
  { id: "rah-workflows", name: "Raven Workflows", icon: "⚙️", status: "shipping",
    version: "Alpha 0.2", progress: 70, summary: "Approval-gated deterministic execution.", to: "/automations" },
  { id: "rah-rethink", name: "Raven Re-think", icon: "🜄", status: "shipping",
    version: "v0.1", progress: 65, summary: "Local text transforms and article distillation.", to: "/rethink" },
  { id: "rah-devices", name: "Device Center", icon: "🖥", status: "shipping",
    version: "v0.2", progress: 68, summary: "Bridge telemetry and role-based dashboards.", to: "/devices" },
  { id: "rah-browser", name: "RAH Raven Browser", icon: "🜲", status: "planned",
    version: "0.0", progress: 8, summary: "Privacy-first browser with agent hooks." },
  { id: "rah-gammon", name: "RAH Gammon", icon: "🎲", status: "planned",
    version: "0.0", progress: 3, summary: "Backgammon with AI opponents." },
  { id: "rah-zipforge", name: "RAH Raven ZipForge", icon: "🜃", status: "planned",
    version: "0.0", progress: 4, summary: "Archive tooling for large project bundles." },
  { id: "rah-pay", name: "RAH Pay AI", icon: "🜍", status: "planned",
    version: "0.0", progress: 2, summary: "Payments and settlement AI." },
  { id: "rah-os", name: "RAH OS", icon: "🜛", status: "alpha",
    version: "0.1", progress: 22, summary: "Personal AI operating-system layer." },
  { id: "rah-powershell", name: "RAH Raven PowerShell", icon: "⌘", status: "planned",
    version: "0.0", progress: 1, summary: "Trusted PowerShell agent shell." },
  { id: "rah-social", name: "Social Media Studio", icon: "🜋", status: "planned",
    version: "0.0", progress: 5, summary: "Multi-channel content planning." },
  { id: "quest-vr", name: "Quest 3 VR Room", icon: "🥽", status: "planned",
    version: "0.0", progress: 2, summary: "Spatial workspace for Raven agents." },
];

function statusBadge(s: AppCard["status"]) {
  const map = {
    shipping: "bg-primary/10 text-primary border-primary/40",
    alpha: "bg-amber-500/10 text-amber-400 border-amber-500/40",
    planned: "bg-muted text-muted-foreground border-border",
  } as const;
  return "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + map[s];
}

function ApplicationsPage() {
  const rah = useRah();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Applications</h1>
        <p className="text-muted-foreground">
          RAH studio modules. Shipping cards open inside this workspace; planned cards are on the roadmap.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {APPS.map((app) => (
          <Card key={app.id} className="p-4 space-y-3 glass-panel">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border/60 text-2xl bg-background/40">
                {app.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="display text-lg truncate">{app.name}</h2>
                  <span className={statusBadge(app.status)}>{app.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{app.version} · {app.progress}%</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{app.summary}</p>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary/70" style={{ width: `${Math.min(100, app.progress)}%` }} />
            </div>
            <div className="flex gap-2">
              {app.to ? (
                <Button asChild size="sm"><Link to={app.to}>Open</Link></Button>
              ) : (
                <Button size="sm" variant="outline" disabled>Coming soon</Button>
              )}
              <Button
                size="sm" variant="ghost"
                onClick={() => void rah.createProjectMemory({
                  projectId: rah.activeProject?.id ?? null,
                  title: `App interest · ${app.name}`,
                  content: `Flagged ${app.name} (${app.status}) for follow-up.`,
                  type: "note", tags: ["app", app.id],
                  pinned: false, archived: false, source: "user",
                })}
              >Track</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
