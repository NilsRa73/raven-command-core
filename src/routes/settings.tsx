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

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — RAH Listen Key" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const rah = useRah();
  const [voices] = useState(() => getVoices());

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
        <p className="text-xs text-muted-foreground">
          API keys are never stored in client code. This form stores only the provider name and endpoint locally.
          A server-side function reads the real secret from your workspace's secure secret store.
        </p>
        <Row label="Name">
          <Input value={rah.prefs.provider?.name ?? ""} onChange={(e) => rah.updatePrefs({ provider: { ...(rah.prefs.provider ?? { baseUrl: "" }), name: e.target.value } })} placeholder="Lovable AI Gateway" className="max-w-md" />
        </Row>
        <Row label="Base URL">
          <Input value={rah.prefs.provider?.baseUrl ?? ""} onChange={(e) => rah.updatePrefs({ provider: { ...(rah.prefs.provider ?? { name: "" }), baseUrl: e.target.value } })} placeholder="https://ai.gateway.lovable.dev/v1" className="max-w-md" />
        </Row>
        <Row label="Model">
          <Input value={rah.prefs.provider?.model ?? ""} onChange={(e) => rah.updatePrefs({ provider: { ...(rah.prefs.provider ?? { name: "", baseUrl: "" }), model: e.target.value } })} placeholder="openai/gpt-5.5" className="max-w-md" />
        </Row>
        <Row label="Secret name">
          <Input value={rah.prefs.provider?.secretName ?? ""} onChange={(e) => rah.updatePrefs({ provider: { ...(rah.prefs.provider ?? { name: "", baseUrl: "" }), secretName: e.target.value } })} placeholder="LOVABLE_API_KEY" className="max-w-md" />
        </Row>
        <Button variant="secondary" onClick={() => { rah.updatePrefs({ provider: undefined }); toast.success("Provider cleared"); }}>Clear provider</Button>
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