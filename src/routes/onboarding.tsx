import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRah } from "@/lib/rah/context";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Get started — RAH Listen Key" }] }),
  component: Onboarding,
});

const steps = ["Welcome", "Language", "Mode", "Microphone", "Screen", "Approvals", "Memory", "Project", "Done"] as const;

function Onboarding() {
  const rah = useRah();
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const step = steps[i];

  async function finish() {
    await rah.updatePrefs({ onboardingComplete: true });
    toast.success("Setup complete. Welcome to RAH.");
    nav({ to: "/" });
  }

  return (
    <div className="mx-auto max-w-2xl glass-panel p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-2">
        {steps.map((s, idx) => (
          <div key={s} className={"h-1.5 flex-1 rounded-full " + (idx <= i ? "bg-primary" : "bg-border")} />
        ))}
      </div>
      <h1 className="display text-2xl">{step}</h1>

      {step === "Welcome" && (
        <p className="text-sm text-muted-foreground">RAH Listen Key gives you voice, vision and multi-agent tools. Everything runs locally until you connect a provider.</p>
      )}
      {step === "Language" && (
        <Select value={rah.prefs.voiceLang} onValueChange={(v) => rah.updatePrefs({ voiceLang: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="en-US">English</SelectItem>
            <SelectItem value="nb-NO">Norsk</SelectItem>
            <SelectItem value="bn-BD">বাংলা</SelectItem>
          </SelectContent>
        </Select>
      )}
      {step === "Mode" && (
        <div className="text-sm text-muted-foreground">Local mode: everything on this device. Cloud mode: enable in Settings later. This first version stays local.</div>
      )}
      {step === "Microphone" && (
        <div className="space-y-2">
          <p className="text-sm">Request microphone permission now?</p>
          <Button onClick={async () => {
            try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); toast.success("Microphone allowed"); }
            catch { toast.error("Denied — you can enable later in browser settings"); }
          }}>Request microphone</Button>
        </div>
      )}
      {step === "Screen" && <p className="text-sm text-muted-foreground">Screen sharing is asked each time on the Vision page — never automatic.</p>}
      {step === "Approvals" && (
        <Select value={rah.prefs.approvalMode} onValueChange={(v) => rah.updatePrefs({ approvalMode: v as any })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="advisory">Advisory only</SelectItem>
            <SelectItem value="ask_every">Ask before every action</SelectItem>
            <SelectItem value="trusted_low_risk">Trusted low-risk</SelectItem>
          </SelectContent>
        </Select>
      )}
      {step === "Memory" && (
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={rah.prefs.memoryEnabled} onChange={(e) => rah.updatePrefs({ memoryEnabled: e.target.checked })} />
          Enable memory (three explicit layers, never automatic)
        </label>
      )}
      {step === "Project" && (
        <Select value={rah.prefs.activeProjectId ?? "none"} onValueChange={(v) => rah.setActiveProject(v === "none" ? undefined : v)}>
          <SelectTrigger><SelectValue placeholder="Pick or skip" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No project yet</SelectItem>
            {rah.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.icon} {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {step === "Done" && (
        <p className="text-sm">Try this: press the gold microphone and say <em>“RAH Brain, help me organize my next project.”</em></p>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="ghost" onClick={finish}>Skip and configure later</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={i === 0} onClick={() => setI((n) => n - 1)}>Back</Button>
          {i < steps.length - 1
            ? <Button onClick={() => setI((n) => n + 1)}>Next</Button>
            : <Button onClick={finish}>Enter Command Center</Button>}
        </div>
      </div>
    </div>
  );
}