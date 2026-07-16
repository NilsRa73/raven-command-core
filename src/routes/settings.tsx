import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useRah } from "@/lib/rah/context";
import { getVoices, speak } from "@/lib/rah/speech";
import { AiStatusBadge, useAiHealth } from "@/components/rah/AiStatusBadge";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — RAH Listen Key" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const rah = useRah();
  const [voices] = useState(() => getVoices());
  const { health, loading, refresh } = useAiHealth(true);

  return (
    <div className="space-y-6">
      <header><h1 className="display text-3xl">Settings</h1></header>

      <section className="glass-panel p-4 space-y-4">
        <h2 className="display text-lg">Appearance</h2>
        <Row label="Theme">
          <Select value={rah.prefs.theme} onValueChange={(v) => rah.updatePrefs({ theme: v as any })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="raven">RAH Raven Gold</SelectItem>
              <SelectItem value="kraakeby">Kråkeby (warm cartoon)</SelectItem>
              <SelectItem value="forest">Yggdrasil Forest Gold</SelectItem>
              <SelectItem value="arctic">Arctic Blue Raven</SelectItem>
              <SelectItem value="hc">High-Contrast Accessibility</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Text size">
          <Select value={rah.prefs.textSize} onValueChange={(v) => rah.updatePrefs({ textSize: v as any })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">Small</SelectItem>
              <SelectItem value="md">Default</SelectItem>
              <SelectItem value="lg">Large</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Reduced motion">
          <Switch checked={rah.prefs.reducedMotion} onCheckedChange={(v) => rah.updatePrefs({ reducedMotion: v })} />
        </Row>
      </section>

      <section className="glass-panel p-4 space-y-4">
        <h2 className="display text-lg">Voice & speech</h2>
        <Row label="Voice input language">
          <Select value={rah.prefs.voiceLang} onValueChange={(v) => rah.updatePrefs({ voiceLang: v })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en-US">English (US)</SelectItem>
              <SelectItem value="en-GB">English (UK)</SelectItem>
              <SelectItem value="nb-NO">Norsk</SelectItem>
              <SelectItem value="bn-BD">বাংলা</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Text-to-speech (off by default)">
          <Switch checked={rah.prefs.ttsEnabled} onCheckedChange={(v) => rah.updatePrefs({ ttsEnabled: v })} />
        </Row>
        {rah.prefs.ttsEnabled && (
          <>
            <Row label="TTS voice">
              <Select value={rah.prefs.ttsVoice ?? "default"} onValueChange={(v) => rah.updatePrefs({ ttsVoice: v === "default" ? undefined : v })}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System default</SelectItem>
                  {voices.map((v) => <SelectItem key={v.name} value={v.name}>{v.name} ({v.lang})</SelectItem>)}
                </SelectContent>
              </Select>
            </Row>
            <Row label={`Speed (${rah.prefs.ttsRate.toFixed(1)}×)`}>
              <Slider value={[rah.prefs.ttsRate]} min={0.5} max={2} step={0.1} onValueChange={(v) => rah.updatePrefs({ ttsRate: v[0] })} className="w-56" />
            </Row>
            <Button size="sm" variant="secondary" onClick={() => speak("RAH Listen Key voice check.", { rate: rah.prefs.ttsRate, voiceName: rah.prefs.ttsVoice })}>Test voice</Button>
          </>
        )}
      </section>

      <section className="glass-panel p-4 space-y-4">
        <h2 className="display text-lg">Behaviour</h2>
        <Row label="Default agent mode">
          <Select value={rah.prefs.defaultMode} onValueChange={(v) => rah.updatePrefs({ defaultMode: v as any })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">Fast Answer</SelectItem>
              <SelectItem value="expert">Expert Team</SelectItem>
              <SelectItem value="debate">Debate Mode</SelectItem>
              <SelectItem value="deep_project">Deep Project</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Approval mode">
          <Select value={rah.prefs.approvalMode} onValueChange={(v) => rah.updatePrefs({ approvalMode: v as any })}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="advisory">Advisory only</SelectItem>
              <SelectItem value="ask_every">Ask before every action</SelectItem>
              <SelectItem value="trusted_low_risk">Trusted low-risk actions</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Enable memory"><Switch checked={rah.prefs.memoryEnabled} onCheckedChange={(v) => rah.updatePrefs({ memoryEnabled: v })} /></Row>
        <Row label="Keyboard shortcuts"><Switch checked={rah.prefs.shortcutsEnabled} onCheckedChange={(v) => rah.updatePrefs({ shortcutsEnabled: v })} /></Row>
        <p className="text-xs text-muted-foreground">
          Browser apps cannot reliably register system-wide shortcuts when the browser is closed or unfocused.
          Global Windows shortcuts require the future RAH Desktop Bridge.
        </p>
      </section>

      <section className="glass-panel p-4 space-y-4">
        <h2 className="display text-lg">AI provider</h2>
        <div className="flex flex-wrap items-center gap-3">
          <AiStatusBadge health={health} loading={loading} />
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>Test AI Connection</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Raven Command uses the built-in Lovable AI Gateway. The API key is stored server-side in the workspace secret store
          (<code>LOVABLE_API_KEY</code>) and is never sent to the browser.
          When the gateway is unreachable, rate-limited, or unauthenticated, the Command Center automatically falls back to the
          clearly labelled Local Demo engine.
        </p>
        {health?.ok && (
          <div className="text-xs text-muted-foreground">
            Provider: <span className="text-foreground">{health.provider}</span> · Model: <span className="text-foreground">{health.model ?? "openai/gpt-5.5"}</span> · Latency: <span className="text-foreground">{health.latencyMs} ms</span>
          </div>
        )}
        {health && !health.ok && (
          <div className="text-xs text-destructive">{health.state}: {health.message}</div>
        )}
        <div className="pt-2">
          <Button size="sm" variant="ghost" onClick={() => { rah.updatePrefs({ provider: undefined }); toast.success("Cleared any legacy provider config."); }}>
            Reset legacy provider settings
          </Button>
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-56 text-sm">{label}</div>
      <div className="flex-1 flex justify-end md:justify-start">{children}</div>
    </div>
  );
}