import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { queryPermission, type PermState } from "@/lib/rah/speech";
import { exportAll, storageEstimate, wipeAll } from "@/lib/rah/db";
import { useRah } from "@/lib/rah/context";
import { toast } from "sonner";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy — RAH Listen Key" }] }),
  component: Privacy,
});

function Privacy() {
  const rah = useRah();
  const [perms, setPerms] = useState<Record<string, PermState>>({});
  const [usage, setUsage] = useState<string>("—");

  async function refresh() {
    const [mic, cam, notif] = await Promise.all([
      queryPermission("microphone"), queryPermission("camera"), queryPermission("notifications"),
    ]);
    setPerms({ mic, cam, notif });
    const est = await storageEstimate();
    if (est) setUsage(`${((est.usage ?? 0) / 1024 / 1024).toFixed(1)} MB / ${((est.quota ?? 0) / 1024 / 1024).toFixed(0)} MB`);
  }
  useEffect(() => { void refresh(); }, []);

  const row = (k: string, label: string) => (
    <div key={k} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="flex-1">{label}</div>
      <span className="text-xs rounded-full border px-2 py-0.5">{perms[k] ?? "unknown"}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Privacy Center</h1>
        <p className="text-muted-foreground">Nothing is recorded, shared, uploaded, or remembered without visible user permission.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="glass-panel p-4">
          <h2 className="display text-lg mb-2">Browser permissions</h2>
          {row("mic", "Microphone")}
          {row("cam", "Camera")}
          {row("notif", "Notifications")}
          <p className="text-xs text-muted-foreground mt-2">
            Screen sharing is a per-session permission; the browser will ask each time you press “Start screen share”.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={refresh}>Refresh</Button>
        </section>

        <section className="glass-panel p-4">
          <h2 className="display text-lg mb-2">Local storage</h2>
          <p className="text-sm">Used: <b>{usage}</b></p>
          <p className="text-sm">Local-only mode: <b>{rah.prefs.localOnly ? "on" : "off"}</b></p>
          <div className="flex gap-2 mt-3">
            <Button variant="secondary" onClick={async () => {
              const blob = await exportAll(); const u = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = u; a.download = "rah-export.json"; a.click(); URL.revokeObjectURL(u);
            }}>Export all data</Button>
            <Button variant="destructive" onClick={async () => {
              if (!confirm("This wipes every local project, command, memory, file and setting. Continue?")) return;
              await wipeAll(); toast.success("All local data cleared."); location.reload();
            }}>Delete all data</Button>
          </div>
        </section>
      </div>

      <section className="glass-panel p-4 text-sm text-muted-foreground">
        <b className="text-foreground">Principle:</b> local-first, permission-first. Cloud sync, AI providers and the Desktop Bridge are optional add-ons; disabling them keeps the app fully functional in local mode.
      </section>
    </div>
  );
}