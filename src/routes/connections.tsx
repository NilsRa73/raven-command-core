import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { probeBridge, type BridgeState } from "@/lib/rah/speech";

export const Route = createFileRoute("/connections")({
  head: () => ({ meta: [{ title: "Connections — RAH Listen Key" }] }),
  component: Connections,
});

function Connections() {
  const [state, setState] = useState<BridgeState>("checking");
  async function check() { setState("checking"); setState(await probeBridge()); }
  useEffect(() => { void check(); }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">RAH Desktop Bridge</h1>
        <p className="text-muted-foreground">Optional companion app that provides user-approved system access.</p>
      </header>
      <div className="glass-panel p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Status</span>
          <span className={"rounded-full border px-3 py-1 text-xs " + (state === "connected" ? "border-primary text-primary" : "")}>{state}</span>
          <Button variant="secondary" size="sm" onClick={check}>Re-check</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          The web app is intentionally sandboxed for security. Global Windows hotkeys, active-window title, clipboard access,
          selected folders, system audio, and local file operations require a separate locally installed companion application
          with explicit permissions.
        </p>
        <div className="grid gap-3 md:grid-cols-2 text-sm">
          {[
            "Global Windows hotkeys",
            "Active-window title",
            "Clipboard access",
            "Selected folders",
            "System audio",
            "Local applications",
            "File operations",
            "Local automation",
            "System notifications",
          ].map((c) => (
            <div key={c} className="rounded-md border p-3 opacity-70">
              <div className="flex items-center gap-2"><span className="text-primary">◇</span>{c}</div>
              <div className="text-[11px] text-muted-foreground mt-1">Requires RAH Desktop Bridge</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}