import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Send, Paperclip, MonitorPlay, Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRah } from "@/lib/rah/context";
import { AGENTS } from "@/lib/rah/agents";
import { createRecognizer, isSpeechSupported } from "@/lib/rah/speech";
import { getDB, uid } from "@/lib/rah/db";
import { Link } from "@tanstack/react-router";

export function CommandBar() {
  const rah = useRah();
  const [text, setText] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(["brain"]);
  const [mode, setMode] = useState(rah.prefs.defaultMode);
  const [approvalMode, setApprovalMode] = useState(rah.prefs.approvalMode);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceSupported] = useState(() => isSpeechSupported());
  const recRef = useRef<any>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => rah.registerCommandBarFocus(() => ref.current?.focus()), [rah]);
  useEffect(() => {
    const cancel = () => stopListening();
    window.addEventListener("rah:cancel", cancel);
    return () => window.removeEventListener("rah:cancel", cancel);
  }, []);

  function startListening() {
    if (!voiceSupported) {
      toast.error("Speech recognition is not available in this browser. Use text input.");
      return;
    }
    const r = createRecognizer(rah.prefs.voiceLang || "en-US");
    if (!r) return;
    recRef.current = r;
    let finalTxt = "";
    r.onresult = (e: any) => {
      let i = "";
      for (let idx = e.resultIndex; idx < e.results.length; idx++) {
        const res = e.results[idx];
        if (res.isFinal) finalTxt += res[0].transcript;
        else i += res[0].transcript;
      }
      setInterim(i);
      if (finalTxt) {
        setText((t) => (t ? t + " " : "") + finalTxt.trim());
        finalTxt = "";
      }
    };
    r.onerror = (e: any) => {
      toast.error("Speech recognition error: " + (e?.error ?? "unknown"));
      setListening(false);
    };
    r.onend = () => setListening(false);
    try { r.start(); setListening(true); } catch { /* already started */ }
  }
  function stopListening() {
    try { recRef.current?.stop(); } catch {}
    setListening(false); setInterim("");
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files; if (!files?.length) return;
    const db = await getDB();
    for (const f of Array.from(files)) {
      await db.put("files", {
        id: uid(), name: f.name, mime: f.type || "application/octet-stream",
        size: f.size, createdAt: Date.now(), blob: f, projectId: rah.activeProject?.id,
        tags: [], folder: undefined, favorite: false,
      });
    }
    toast.success(`Attached ${files.length} file${files.length > 1 ? "s" : ""}`);
    e.target.value = "";
  }

  async function send() {
    const prompt = text.trim();
    if (!prompt) { toast.error("Type or dictate a command first."); return; }
    stopListening();
    const needsApproval = approvalMode !== "advisory";
    await rah.addCommand({
      prompt, agents: selectedAgents, mode, fileIds: [],
      projectId: rah.activeProject?.id, inputType: listening ? "voice" : "text",
      status: needsApproval ? "awaiting_approval" : "done",
      resultSummary: rah.prefs.provider
        ? "Awaiting provider response."
        : "Local demonstration — configure an AI provider in Settings for real analysis.",
      demo: !rah.prefs.provider,
    });
    if (needsApproval) {
      await rah.requestApproval({
        title: `Run "${prompt.slice(0, 60)}"`,
        reason: `Execute across agents: ${selectedAgents.join(", ")}.`,
        tools: selectedAgents,
        dataShared: rah.activeProject ? [`Project: ${rah.activeProject.name}`] : [],
        expectedResult: "Agents produce a plan and (if configured) real results.",
        risk: "low",
        category: "agent-run",
      });
    }
    setText(""); setInterim("");
    toast.success(needsApproval ? "Queued for approval." : "Command recorded.");
  }

  const toggleAgent = (id: string) =>
    setSelectedAgents((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="glass-panel gold-border p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Select value={rah.activeProject?.id ?? "none"} onValueChange={(v) => void rah.setActiveProject(v === "none" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No project</SelectItem>
            {rah.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.icon} {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={mode} onValueChange={(v) => setMode(v as any)}>
          <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Fast Answer</SelectItem>
            <SelectItem value="expert">Expert Team</SelectItem>
            <SelectItem value="debate">Debate Mode</SelectItem>
            <SelectItem value="deep_project">Deep Project</SelectItem>
          </SelectContent>
        </Select>
        <Select value={approvalMode} onValueChange={(v) => setApprovalMode(v as any)}>
          <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="advisory">Advisory Only</SelectItem>
            <SelectItem value="ask_every">Ask Before Every Action</SelectItem>
            <SelectItem value="trusted_low_risk">Trusted Low-Risk</SelectItem>
          </SelectContent>
        </Select>
        {!rah.prefs.provider && (
          <Link to="/settings" className="ml-auto text-primary hover:underline">
            No AI provider configured — Settings →
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {AGENTS.map((a) => {
          const on = selectedAgents.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggleAgent(a.id)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                (on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")
              }
              aria-pressed={on}
            >
              <span>{a.emoji}</span>
              <span>{a.name.replace("RAH ", "")}</span>
            </button>
          );
        })}
      </div>

      <Textarea
        ref={ref}
        value={interim ? `${text}${text ? " " : ""}${interim}` : text}
        onChange={(e) => { setText(e.target.value); setInterim(""); }}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
        placeholder='Try: "Ask the coding, design, and business agents to review this project."'
        rows={4}
        className="resize-y bg-background/60"
        aria-label="Command input"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => (listening ? stopListening() : startListening())}
          variant={listening ? "destructive" : "default"}
          className={listening ? "pulse-gold" : ""}
          aria-pressed={listening}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {listening ? "Stop listening" : "Push to talk"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
          <Paperclip className="h-4 w-4" /> Attach
        </Button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFiles} />
        <Button asChild type="button" variant="secondary">
          <Link to="/vision"><MonitorPlay className="h-4 w-4" /> Share screen</Link>
        </Button>
        <Button asChild type="button" variant="secondary">
          <Link to="/vision"><Camera className="h-4 w-4" /> Screenshot</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={() => { setText(""); setInterim(""); }}>
          <Trash2 className="h-4 w-4" /> Clear
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {voiceSupported ? (
            <span className="text-[11px] text-muted-foreground">
              {listening ? "Listening…" : "Voice ready (browser)"}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Voice unsupported — text only</span>
          )}
          <Button type="button" onClick={() => void send()} className="min-w-24">
            <Send className="h-4 w-4" /> Send
          </Button>
        </div>
      </div>
    </div>
  );
}