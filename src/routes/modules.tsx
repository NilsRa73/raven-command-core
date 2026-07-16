import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HUB_MODULES, HUB_GROUP_LABEL, filterModules,
  loadPinnedModuleIds, togglePinnedModule, type ModuleGroup,
} from "@/lib/rah/moduleRegistry";

export const Route = createFileRoute("/modules")({
  head: () => ({
    meta: [
      { title: "Module Registry — Raven Hub" },
      { name: "description", content: "All RAH Raven modules with status, progress, and quick launch." },
    ],
  }),
  component: ModulesPage,
});

function ModulesPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<ModuleGroup | "all">("all");
  const [pins, setPins] = useState<string[]>(() => loadPinnedModuleIds());

  const filtered = useMemo(() => {
    const base = filterModules(q);
    return group === "all" ? base : base.filter((m) => m.group === group);
  }, [q, group]);

  const pinned = useMemo(() => filtered.filter((m) => pins.includes(m.id)), [filtered, pins]);
  const rest = useMemo(() => filtered.filter((m) => !pins.includes(m.id)), [filtered, pins]);

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="display text-3xl gold-text">Module Registry</h1>
          <p className="text-muted-foreground">
            Every RAH Raven module. Pin favorites, filter by group, and open in one click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{filtered.length} shown</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <Input placeholder="Search modules, keywords…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {(["all", "core", "environment", "play", "system"] as const).map((g) => (
            <Button key={g} size="sm" variant={group === g ? "default" : "outline"} onClick={() => setGroup(g)}>
              {g === "all" ? "All" : HUB_GROUP_LABEL[g]}
            </Button>
          ))}
        </div>
      </div>

      {pinned.length > 0 && (
        <section className="space-y-2">
          <h2 className="display text-lg">Pinned</h2>
          <ModuleGrid items={pinned} pins={pins} onPin={(id) => setPins(togglePinnedModule(id))} />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="display text-lg">{pinned.length > 0 ? "All modules" : "Modules"}</h2>
        <ModuleGrid items={rest} pins={pins} onPin={(id) => setPins(togglePinnedModule(id))} />
      </section>
    </div>
  );
}

function ModuleGrid({
  items, pins, onPin,
}: { items: typeof HUB_MODULES; pins: string[]; onPin: (id: string) => void }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No modules match.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((m) => {
        const badge =
          m.status === "active" ? "bg-primary/10 text-primary border-primary/40"
          : m.status === "prototype" ? "bg-amber-500/10 text-amber-400 border-amber-500/40"
          : "bg-muted text-muted-foreground border-border";
        const pinned = pins.includes(m.id);
        return (
          <Card key={m.id} className="p-4 space-y-3 rune-tile">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-primary/30 bg-background/40 text-2xl text-primary">
                {m.glyph}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="display text-lg truncate">{m.name}</h3>
                  <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " + badge}>
                    {m.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{HUB_GROUP_LABEL[m.group]} · {m.progress}%</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{m.description}</p>
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary/70" style={{ width: `${Math.min(100, m.progress)}%` }} />
            </div>
            <div className="flex gap-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Button asChild size="sm"><Link to={m.to as any}>Open</Link></Button>
              <Button size="sm" variant={pinned ? "default" : "ghost"} onClick={() => onPin(m.id)}>
                {pinned ? "★ Pinned" : "☆ Pin"}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}