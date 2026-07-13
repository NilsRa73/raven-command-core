import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getLocalAiSettings, saveLocalAiSettings, subscribeLocalAi,
  listLmStudioModels, listOllamaModels, getLastDiagnostic,
  engineLabel, isLocalEngine, resolveTransport,
  type LocalAiSettings, type DiscoveredModel, type LocalDiagnostic,
} from "@/lib/rah/localAi";
import { checkHealth, type HealthResult } from "@/lib/rah/ai";
import { useBridgeStatus } from "@/lib/rah/bridgeStatus";

type Status = "idle" | "connecting" | "connected" | "offline" | "cors_blocked";

export function LocalAiBadge() {
  const [settings, setSettings] = useState<LocalAiSettings>(() => getLocalAiSettings());
  useEffect(() => subscribeLocalAi(setSettings), []);
  if (!isLocalEngine(settings.engine)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/60 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      LOCAL — prompts stay on this computer ({engineLabel(settings.engine)})
    </span>
  );
}

export function LocalAiPanel() {
  const [settings, setSettings] = useState<LocalAiSettings>(() => getLocalAiSettings());
  const [status, setStatus] = useState<Status>("idle");
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [diag, setDiag] = useState<LocalDiagnostic | null>(() => getLastDiagnostic());
  const [showGuide, setShowGuide] = useState(false);
  const { snapshot: bridge, loading: bridgeLoading } = useBridgeStatus();
  const [transportUsed, setTransportUsed] = useState<"bridge" | "direct" | null>(null);

  useEffect(() => subscribeLocalAi(setSettings), []);
  useEffect(() => {
    let cancelled = false;
    void resolveTransport(settings).then((t) => { if (!cancelled) setTransportUsed(t); });
    return () => { cancelled = true; };
  }, [settings]);

  useEffect(() => {
    // First-run guide when user first switches to a local engine.
    if (isLocalEngine(settings.engine) && !settings.firstRunDismissed) {
      setShowGuide(true);
    }
  }, [settings.engine, settings.firstRunDismissed]);

  function update(patch: Partial<LocalAiSettings>) {
    setSettings(saveLocalAiSettings(patch));
  }

  async function testConnection() {
    setStatus("connecting");
    setModels([]);
    try {
      if (settings.engine === "lmstudio") {
        const ms = await listLmStudioModels(settings);
        setModels(ms);
      } else if (settings.engine === "ollama") {
        const ms = await listOllamaModels(settings);
        setModels(ms);
      }
      const h = await checkHealth();
      setHealth(h);
      setDiag(getLastDiagnostic());
      if (h.ok) { setStatus("connected"); toast.success(`Connected · ${h.provider}`); }
      else if (h.message?.toLowerCase().includes("cors")) { setStatus("cors_blocked"); toast.error("Browser blocked (CORS)"); }
      else { setStatus("offline"); toast.error(h.message ?? "Offline"); }
    } catch (err) {
      setDiag(getLastDiagnostic());
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof TypeError) { setStatus("cors_blocked"); toast.error("Browser blocked (CORS/local server)"); }
      else { setStatus("offline"); toast.error(msg); }
    }
  }

  const statusLabel = ({
    idle: "Not tested",
    connecting: "Connecting…",
    connected: "Connected",
    offline: "Offline",
    cors_blocked: "CORS / Browser blocked",
  } as Record<Status, string>)[status];

  const bridgeLabel =
    !isLocalEngine(settings.engine) ? null :
    bridge == null ? "Checking bridge…"
    : transportUsed === "direct" && settings.transport !== "direct"
      ? "Bridge offline / unpaired — falling back to direct (dev only)"
      : transportUsed === "direct"
        ? "Direct mode (developer)"
        : bridge?.ui === "paired_online"
          ? `Bridge connected${bridge.version ? ` v${bridge.version}` : ""}`
          : bridge?.ui === "emergency_stopped"
            ? "Bridge emergency-stopped"
            : bridge?.ui === "version_mismatch"
              ? "Bridge version too old — update from Connections"
              : bridgeLoading ? "Checking bridge…" : "Bridge offline";

  const statusTone = status === "connected" ? "border-primary text-primary"
    : status === "connecting" ? "border-primary/60 text-primary animate-pulse"
    : status === "idle" ? "border-border text-muted-foreground"
    : "border-destructive text-destructive";

  return (
    <section className="glass-panel gold-border p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display text-lg">Local AI (LM Studio · Ollama)</h2>
        <span className={"rounded-full border px-3 py-1 text-xs " + statusTone}>{statusLabel}</span>
        {isLocalEngine(settings.engine) && (
          <span className="rounded-full border border-primary/60 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
            LOCAL — prompts stay on this computer
          </span>
        )}
        {bridgeLabel && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            {bridgeLabel}
          </span>
        )}
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setShowGuide(true)}>Setup guide</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Row label="AI Engine">
          <Select value={settings.engine} onValueChange={(v) => update({ engine: v as LocalAiSettings["engine"] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cloud">Lovable AI Gateway (cloud)</SelectItem>
              <SelectItem value="lmstudio">LM Studio (local · OpenAI-compatible)</SelectItem>
              <SelectItem value="ollama">Ollama (local)</SelectItem>
              <SelectItem value="demo">Demo / Offline</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        {settings.engine === "lmstudio" && (
          <>
            <Row label="LM Studio base URL">
              <Input value={settings.lmStudioUrl} onChange={(e) => update({ lmStudioUrl: e.target.value })} placeholder="http://127.0.0.1:1234/v1" />
            </Row>
            <Row label="Model">
              {models.length ? (
                <Select value={settings.lmStudioModel} onValueChange={(v) => update({ lmStudioModel: v })}>
                  <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent>
                    {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={settings.lmStudioModel} onChange={(e) => update({ lmStudioModel: e.target.value })} placeholder="google/gemma-4-e4b" />
              )}
            </Row>
          </>
        )}
        {settings.engine === "ollama" && (
          <>
            <Row label="Ollama base URL">
              <Input value={settings.ollamaUrl} onChange={(e) => update({ ollamaUrl: e.target.value })} placeholder="http://127.0.0.1:11434" />
            </Row>
            <Row label="Model">
              {models.length ? (
                <Select value={settings.ollamaModel} onValueChange={(v) => update({ ollamaModel: v })}>
                  <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent>
                    {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={settings.ollamaModel} onChange={(e) => update({ ollamaModel: e.target.value })} placeholder="llama3.1" />
              )}
            </Row>
          </>
        )}
        {isLocalEngine(settings.engine) && (
          <>
            <Row label="Transport">
              <Select value={settings.transport} onValueChange={(v) => update({ transport: v as LocalAiSettings["transport"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Bridge when paired, else direct)</SelectItem>
                  <SelectItem value="bridge">Bridge only (recommended for production)</SelectItem>
                  <SelectItem value="direct">Direct (developer / local dev only)</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label={`Temperature (${settings.temperature.toFixed(2)})`}>
              <Slider value={[settings.temperature]} min={0} max={2} step={0.05}
                onValueChange={(v) => update({ temperature: v[0] })} />
            </Row>
            <Row label={`Context length (${settings.contextLength})`}>
              <Slider value={[settings.contextLength]} min={512} max={32768} step={512}
                onValueChange={(v) => update({ contextLength: v[0] })} />
            </Row>
            <div className="md:col-span-2">
              <div className="text-xs mb-1 text-muted-foreground">Extra system prompt (optional)</div>
              <Textarea rows={2} value={settings.systemPromptExtra}
                onChange={(e) => update({ systemPromptExtra: e.target.value })}
                placeholder="Extra instructions appended to the RAH system prompt." />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void testConnection()}
          disabled={status === "connecting" || settings.engine === "cloud" || settings.engine === "demo"}>
          Test connection
        </Button>
        {settings.engine !== "cloud" && (
          <Button size="sm" variant="outline"
            onClick={() => update({ engine: "cloud", transport: "auto" })}>
            Switch to Lovable Cloud
          </Button>
        )}
      </div>

      {(health || diag) && (
        <div className="text-xs text-muted-foreground border-t border-border pt-3 space-y-1">
          <div className="font-medium text-foreground">Diagnostics</div>
          {health && (
            <>
              <div>Provider: <span className="text-foreground">{health.provider}</span></div>
              {health.model && <div>Model: <span className="text-foreground">{health.model}</span></div>}
              {typeof health.latencyMs === "number" && <div>Latency: <span className="text-foreground">{health.latencyMs} ms</span></div>}
              {health.sample && <div>{health.sample}</div>}
              {health.message && <div className="text-destructive">{health.message}</div>}
            </>
          )}
          {diag && (
            <div className="text-[11px]">
              Last call: <span className="font-mono">{diag.op}</span> → {diag.endpoint} ·
              {" "}status {diag.status ?? "n/a"}{diag.errorType ? ` · ${diag.errorType}` : ""} ·
              {" "}{new Date(diag.timestamp).toLocaleTimeString()}
            </div>
          )}
          <div className="text-[11px]">Prompt contents are never logged in diagnostics.</div>
        </div>
      )}

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { update({ firstRunDismissed: true }); setShowGuide(false); }}>
          <div className="glass-panel gold-border p-6 max-w-lg w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="display text-xl">Local AI setup</h3>
            <div className="text-sm space-y-2">
              <p className="font-medium text-foreground">Recommended: route through the RAH Desktop Bridge</p>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Open <em>Connections</em> → download and start the RAH Desktop Bridge (v0.2.1+).</li>
                <li>Pair the bridge with the 6-digit code.</li>
                <li>Set Transport to <em>Auto</em> or <em>Bridge only</em>. No CORS setup required.</li>
              </ol>
              <p className="font-medium text-foreground pt-2">LM Studio (Windows)</p>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Open LM Studio → <em>Local Server</em> tab. Load a model (e.g. <code>google/gemma-4-e4b</code>).</li>
                <li>Click <em>Start Server</em>. Default: <code>http://127.0.0.1:1234/v1</code>.</li>
                <li>The bridge proxies to that address — no CORS toggle needed.</li>
              </ol>
              <p className="font-medium text-foreground pt-2">Ollama (Windows)</p>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Install Ollama, run <code>ollama pull llama3.2:3b</code>.</li>
                <li>Start Ollama (listens on <code>http://127.0.0.1:11434</code>).</li>
                <li>The bridge proxies to that address — no <code>OLLAMA_ORIGINS</code> needed.</li>
              </ol>
              <p className="text-xs text-muted-foreground pt-2">
                Prompts never leave your computer. The bridge proxies only to loopback (127.0.0.1) LM Studio / Ollama;
                arbitrary hosts are rejected. Prompt contents are never audited.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => { update({ firstRunDismissed: true }); setShowGuide(false); }}>Got it</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs mb-1 text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}