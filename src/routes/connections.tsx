import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiStatusBadge, useAiHealth } from "@/components/rah/AiStatusBadge";
import { testVision, type VisionTestResult } from "@/lib/rah/ai";
import { toast } from "sonner";
import {
  bridgeStatusSnapshot, bridgePair, bridgeSystemStatus, bridgeCapabilities,
  bridgeEmergencyStop, bridgeResume, forgetCredentials, loadCredentials,
  bridgeDisconnect,
  type BridgeStatusSnapshot,
} from "@/lib/rah/bridge";
import type { BridgeSystemStatus, BridgeCapabilities } from "@/lib/rah/bridge-protocol";

export const Route = createFileRoute("/connections")({
  head: () => ({ meta: [
    { title: "Connections — RAH Listen Key" },
    { name: "description", content: "AI backend, multimodal vision, and RAH Desktop Bridge status for Raven Command." },
  ]}),
  component: Connections,
});

import bridgeManifest from "@/lib/rah/bridge-manifest.json";

const PACKAGE_URL = `/${bridgeManifest.file}`;
const PACKAGE_SHA256 = bridgeManifest.sha256;
const PACKAGE_VERSION = bridgeManifest.version;

function stateLabel(s: BridgeStatusSnapshot["ui"]) {
  switch (s) {
    case "offline": return "Offline — bridge not detected on 127.0.0.1";
    case "pairing_required": return "Pairing required";
    case "paired_online": return "Connected — read-only + approved actions";
    case "emergency_stopped": return "Emergency stopped";
    case "version_mismatch": return "Version mismatch";
    case "error": return "Error";
  }
}
function stateTone(s: BridgeStatusSnapshot["ui"]) {
  if (s === "paired_online") return "border-primary text-primary";
  if (s === "emergency_stopped" || s === "error") return "border-destructive text-destructive";
  if (s === "pairing_required") return "border-yellow-500 text-yellow-500";
  return "border-border text-muted-foreground";
}

function Connections() {
  const { health, loading, refresh } = useAiHealth(true);

  // Vision
  const [vision, setVision] = useState<VisionTestResult | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  async function runVisionTest() {
    setVisionLoading(true);
    const r = await testVision();
    setVision(r); setVisionLoading(false);
    if (r.ok) toast.success(`Vision ready · ${r.model ?? ""}`);
    else toast.error(`Vision test failed: ${r.message ?? r.state}`);
  }

  // Bridge
  const [snap, setSnap] = useState<BridgeStatusSnapshot | null>(null);
  const [sysStatus, setSysStatus] = useState<BridgeSystemStatus | null>(null);
  const [caps, setCaps] = useState<BridgeCapabilities | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [tokenAge, setTokenAge] = useState<string>("");

  const refreshBridge = useCallback(async () => {
    try {
      const s = await bridgeStatusSnapshot();
      setSnap(s);
      setPollErr(null);
      if (s.ui === "paired_online" || s.ui === "emergency_stopped") {
        try { setSysStatus(await bridgeSystemStatus()); } catch (e) { /* ignore */ }
        try { setCaps(await bridgeCapabilities()); } catch (e) { /* ignore */ }
      } else {
        setSysStatus(null); setCaps(null);
      }
      const c = await loadCredentials();
      if (c) {
        const days = Math.floor((Date.now() - c.pairedAt) / 86400000);
        setTokenAge(days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);
      } else setTokenAge("");
    } catch (err) {
      setPollErr(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshBridge();
    const id = setInterval(() => { void refreshBridge(); }, 5000);
    return () => clearInterval(id);
  }, [refreshBridge]);

  // Pairing wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  async function submitPair() {
    if (!/^\d{6}$/.test(pairCode)) { toast.error("Enter the 6-digit code shown by the bridge."); return; }
    setPairing(true);
    try {
      const r = await bridgePair(pairCode);
      toast.success(`Paired with bridge v${r.bridgeVersion}`);
      setWizardOpen(false); setPairCode("");
      await refreshBridge();
    } catch (err) {
      toast.error("Pairing failed: " + (err instanceof Error ? err.message : String(err)));
    } finally { setPairing(false); }
  }

  async function doEmergencyStop() {
    try { await bridgeEmergencyStop(); toast.success("Emergency stop engaged"); await refreshBridge(); }
    catch (e) { toast.error("Failed: " + (e instanceof Error ? e.message : String(e))); }
  }
  async function doResume() {
    try { await bridgeResume(); toast.success("Bridge resumed"); await refreshBridge(); }
    catch (e) { toast.error("Failed: " + (e instanceof Error ? e.message : String(e))); }
  }
  async function doForget() {
    await forgetCredentials();
    toast.success("Browser-side credentials cleared. The bridge still trusts this browser until you disconnect from the bridge too.");
    await refreshBridge();
  }
  async function doDisconnect() {
    try {
      await bridgeDisconnect();
      toast.success("Disconnected. Check the bridge console window for a new 6-digit pairing code.");
      await refreshBridge();
    } catch (e) {
      toast.error("Disconnect failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const ui = snap?.ui ?? "offline";
  const paired = snap?.paired ?? false;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl">Connections</h1>
        <p className="text-muted-foreground">Live status for the AI backend, multimodal vision, and the RAH Desktop Bridge.</p>
      </header>

      {/* AI backend */}
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
      </section>

      {/* Vision */}
      <section className="glass-panel gold-border p-5 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="display text-lg">Multimodal vision</h2>
          <span className={"rounded-full border px-3 py-1 text-xs " +
            (vision?.ok ? "border-primary text-primary" : vision ? "border-destructive text-destructive" : "border-border text-muted-foreground")}>
            {visionLoading ? "Testing…" : vision?.ok ? "Vision Ready" : vision ? "Failed" : "Not tested"}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void runVisionTest()} disabled={visionLoading}>Test Vision</Button>
        </div>
        {vision && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Provider: <span className="text-foreground">{vision.provider}</span></div>
            {vision.model && <div>Model: <span className="text-foreground">{vision.model}</span></div>}
            {typeof vision.latencyMs === "number" && <div>Latency: <span className="text-foreground">{vision.latencyMs} ms</span></div>}
            {vision.reply && <div>Reply: <span className="text-foreground">"{vision.reply}"</span></div>}
          </div>
        )}
      </section>

      {/* Desktop Bridge */}
      <section className="glass-panel gold-border p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="display text-lg">RAH Desktop Bridge</h2>
          <span className={"rounded-full border px-3 py-1 text-xs " + stateTone(ui)}>
            {stateLabel(ui)}
            {ui === "paired_online" && (
              <span className="ml-2 inline-block h-2 w-2 rounded-full bg-primary align-middle animate-pulse" aria-hidden />
            )}
          </span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void refreshBridge()}>Test connection</Button>
        </div>

        <div className="text-xs text-muted-foreground grid gap-1 md:grid-cols-2">
          <div>Endpoint: <span className="text-foreground">http://127.0.0.1:47824</span> (localhost-only)</div>
          {snap?.version && <div>Bridge version: <span className="text-foreground">{snap.version}</span></div>}
          {typeof snap?.latencyMs === "number" && <div>Heartbeat latency: <span className="text-foreground">{snap.latencyMs} ms</span></div>}
          {paired && <div>Device token age: <span className="text-foreground">{tokenAge || "just paired"}</span></div>}
          {sysStatus && (
            <>
              <div>Host: <span className="text-foreground">{sysStatus.hostname}</span></div>
              <div>User: <span className="text-foreground">{sysStatus.username}</span></div>
              <div>Platform: <span className="text-foreground">{sysStatus.platform} {sysStatus.release} · {sysStatus.arch}</span></div>
              <div>CPU: <span className="text-foreground">{sysStatus.cpu.cores} cores</span></div>
              <div>Memory: <span className="text-foreground">{(sysStatus.memory.usedBytes / 1e9).toFixed(1)} / {(sysStatus.memory.totalBytes / 1e9).toFixed(1)} GB</span></div>
              <div>Approved roots: <span className="text-foreground">{sysStatus.approvedRootsCount}</span></div>
            </>
          )}
          {pollErr && <div className="text-destructive md:col-span-2">Poll error: {pollErr}</div>}
        </div>

        {caps?.approvedRoots?.length ? (
          <div className="text-xs text-muted-foreground">
            <div className="font-medium text-foreground mb-1">Approved roots</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {caps.approvedRoots.map((r) => <li key={r} className="font-mono text-[11px]">{r}</li>)}
            </ul>
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {ui === "pairing_required" && (
            <Button size="sm" onClick={() => setWizardOpen(true)}>Pair Desktop Bridge</Button>
          )}
          {ui === "paired_online" && (
            <Button size="sm" variant="destructive" onClick={() => void doEmergencyStop()}>Emergency stop</Button>
          )}
          {ui === "emergency_stopped" && (
            <Button size="sm" onClick={() => void doResume()}>Resume</Button>
          )}
          {paired && (
            <Button size="sm" variant="destructive" onClick={() => void doDisconnect()}>
              Disconnect and re-pair
            </Button>
          )}
          {paired && (
            <Button size="sm" variant="secondary" onClick={() => void doForget()}>
              Forget browser credentials only
            </Button>
          )}
          <a href={PACKAGE_URL} download className="inline-block">
            <Button size="sm" variant="outline">Download bridge package (v{PACKAGE_VERSION})</Button>
          </a>
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">Setup wizard — 4 steps</summary>
          <ol className="list-decimal pl-5 mt-2 space-y-1">
            <li>Click <strong>Download bridge package</strong> above.</li>
            <li>Extract the ZIP anywhere (e.g. Documents).</li>
            <li>Double-click <code>Start RAH Desktop Bridge.cmd</code>. A black window shows a six-digit code.</li>
            <li>Click <strong>Pair Desktop Bridge</strong> above and type the code.</li>
          </ol>
          <div className="mt-2">Package SHA-256: <span className="font-mono text-[10px]">{PACKAGE_SHA256}</span></div>
          <div>Requires Node.js 22 LTS (Windows 10/11). The bridge listens only on 127.0.0.1 — never LAN or internet.</div>
        </details>

        <div className="text-[11px] text-muted-foreground border-t border-border pt-3">
          <strong className="text-foreground">Security notes (v0.1.0)</strong> —
          {" "}Read-only capabilities (system status, list/search/read-text) are allowed inside approved roots after pairing.
          {" "}All file modifications, launches, and URL opens require an approval card.
          {" "}Program launch, arbitrary shell, registry, keyboard automation, credential access, mic and webcam are DISABLED.
          {" "}Screenshot capture is intentionally not implemented in this release and returns a clear 501 response — use Raven Screen Vision in the browser instead.
          {" "}The bridge token is stored in IndexedDB (never localStorage) and in the PC's user-only config dir.
        </div>
      </section>

      {/* Pairing wizard modal */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !pairing && setWizardOpen(false)}>
          <div className="glass-panel gold-border p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="display text-xl">Pair Desktop Bridge</h3>
            <p className="text-sm text-muted-foreground">
              Look at the black window on your PC. Type the six-digit pairing code below. The code expires in 5 minutes and is single-use.
            </p>
            <Input
              inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="000000"
              value={pairCode} onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-2xl tracking-[0.5em] font-mono"
              autoFocus disabled={pairing}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setWizardOpen(false)} disabled={pairing}>Cancel</Button>
              <Button onClick={() => void submitPair()} disabled={pairing || pairCode.length !== 6}>
                {pairing ? "Pairing…" : "Pair"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
