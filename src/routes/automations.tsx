import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/automations")({
  head: () => ({ meta: [{ title: "Automations — RAH Listen Key" }] }),
  component: () => (
    <div className="space-y-4">
      <h1 className="display text-3xl">Automations</h1>
      <div className="glass-panel p-6 space-y-2">
        <p className="text-sm">Automations link approved commands into repeatable flows.</p>
        <p className="text-sm text-muted-foreground">
          This surface is scaffolded but intentionally empty. Automations require a configured AI provider and — for system-level actions — the RAH Desktop Bridge.
          Building fake toggles here would break RAH's honesty rule.
        </p>
      </div>
    </div>
  ),
});