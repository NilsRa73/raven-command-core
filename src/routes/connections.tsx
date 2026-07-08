import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { probeBridge, type BridgeState } from "@/lib/rah/speech";
import { AiStatusBadge, useAiHealth } from "@/components/rah/AiStatusBadge";
import { testVision, type VisionTestResult } from "@/lib/rah/ai";
import { toast } from "sonner";

export const Route = createFileRoute("/connections")({
  head: () => ({ meta: [{ title: "Connections — RAH Listen Key" }] }),
  component: Connections,
});

function Connections() {
  const [state, setState] = useState<BridgeState>("checking");
  async function check() { setState("checking"); setState(await probeBridge()); }
  useEffect(() => { void check(); }, []);
  const { health, loading, refresh } = useAiHealth(true);
  const [vision, setVision] = useState<VisionTestResult | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  async function runVisionTest() {
    setVisionLoading(true);
    const r = await testVision();
    setVision(r);
    setVisionLoading(false);
    if (r.ok) toast.success(`Vision ready · ${r.model ?? ""}`);
    else toast.error(`Vision test failed: ${r.message ?? r.state}`);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Connections</h1>
        <p className="text-muted-foreground">Live status for the AI backend and the optional RAH Desktop Bridge.</p>
      </header>

      <section className="glass-panel gold-border p-5 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="display text-lg">AI backend</h2>
          <AiStatusBadge health={health} loading={loading} />
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void refresh()}>Test AI Connection</Button>
        </div>
        {health && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Provider: <span className="text-foreground">{health.provider}</span></div>
            {health.model && <div>Model: <span className="text-foreground">{health.model}</span></div>}
            {typeof health.latencyMs === "number" && <div>Latency: <span className="text-foreground">{health.latencyMs} ms</span></div>}
            {health.sample && <div>Health-check reply: <span className="text-foreground">"{health.sample}"</span></div>}
            {health.message && <div className="text-destructive">Message: {health.message}</div>}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          When connected, all Raven Command requests stream through the Lovable AI Gateway from a server-side function.
          The API key is stored server-side only and never shipped to the browser.
          When disconnected or rate limited, the Command Center automatically falls back to the labelled Local Demo engine.
        </p>
      </section>

      <section className="glass-panel gold-border p-5 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="display text-lg">Multimodal vision</h2>
          <span className={
            "rounded-full border px-3 py-1 text-xs " +
            (vision?.ok ? "border-primary text-primary"
              : vision ? "border-destructive text-destructive"
              : "border-border text-muted-foreground")
          }>
            {visionLoading ? "Testing…" : vision?.ok ? "Vision Ready" : vision ? "Failed" : "Not tested"}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void runVisionTest()} disabled={visionLoading}>
            Test Vision
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Sends a small fixture image (a solid red square) through the real secure server route and asks the AI
          to name its color. "Vision Ready" only shows after the live multimodal round-trip succeeds and the
          reply actually mentions the correct color.
        </p>
        {vision && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Provider: <span className="text-foreground">{vision.provider}</span></div>
            {vision.model && <div>Model: <span className="text-foreground">{vision.model}</span></div>}
            {typeof vision.latencyMs === "number" && <div>Latency: <span className="text-foreground">{vision.latencyMs} ms</span></div>}
            {vision.reply && <div>Reply: <span className="text-foreground">"{vision.reply}"</span></div>}
            {vision.message && <div className={vision.ok ? "" : "text-destructive"}>Message: {vision.message}</div>}
          </div>
        )}
      </section>

      <header>
        <h2 className="display text-2xl">RAH Desktop Bridge</h2>
        <p className="text-muted-foreground text-sm">Optional companion app that provides user-approved system access.</p>
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