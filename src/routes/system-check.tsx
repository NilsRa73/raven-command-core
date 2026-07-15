import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  runSystemCheck, WINDOWS_STARTUP_GUIDE,
  type SystemCheckReport, type CheckResult, type OverallState,
} from "@/lib/rah/systemCheck";
import { useRah } from "@/lib/rah/context";
import {
  ShieldCheck, RefreshCw, Copy, Check, Download, Play, AlertTriangle,
  CircleDashed, XCircle, Info, FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import { bridgePrepare, bridgeExecute } from "@/lib/rah/bridge";

export const Route = createFileRoute("/system-check")({
  head: () => ({
    meta: [
      { title: "System Check · Raven Command" },
      { name: "description", content: "One-click end-to-end diagnostic for the Raven Command desktop stack." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SystemCheckPage,
});

function overallTone(o: OverallState): { label: string; className: string; icon: React.ReactNode } {
  switch (o) {
    case "ready":     return { label: "Ready", className: "border-primary/60 bg-primary/10 text-primary", icon: <Check className="h-4 w-4" /> };
    case "attention": return { label: "Needs attention", className: "border-yellow-500/60 bg-yellow-500/10 text-yellow-400", icon: <AlertTriangle className="h-4 w-4" /> };
    case "offline":   return { label: "Offline", className: "border-destructive/60 bg-destructive/10 text-destructive", icon: <XCircle className="h-4 w-4" /> };
    case "demo":      return { label: "Demo-only", className: "border-border/60 bg-background/40 text-muted-foreground", icon: <Info className="h-4 w-4" /> };
  }
}

function severityIcon(s: CheckResult["severity"]) {
  if (s === "ok") return <Check className="h-4 w-4 text-primary" />;
  if (s === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
  if (s === "bad") return <XCircle className="h-4 w-4 text-destructive" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-[11px] hover:bg-accent"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { toast.error("Clipboard blocked"); }
      }}
      title={text}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CheckRow({ c }: { c: CheckResult }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex items-center gap-2">
        {severityIcon(c.severity)}
        <div className="font-medium text-sm">{c.label}</div>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{c.detail}</div>
      {c.hint && <div className="mt-1 text-xs text-yellow-400/90">{c.hint}</div>}
      {c.copy && c.copy.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {c.copy.map((a) => (
            <div key={a.label} className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px]">
              <span className="text-muted-foreground">{a.label}:</span>
              <code className="font-mono">{a.text}</code>
              <CopyButton text={a.text} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SystemCheckPage() {
  const [report, setReport] = useState<SystemCheckReport | null>(null);
  const [running, setRunning] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [e2eBusy, setE2eBusy] = useState(false);
  const [e2eLog, setE2eLog] = useState<string[]>([]);
  const { requestApproval } = useRah();
  const navigate = useNavigate();

  const run = useCallback(async () => {
    setRunning(true);
    try { setReport(await runSystemCheck()); }
    finally { setRunning(false); }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const downloadGuide = () => {
    const blob = new Blob([WINDOWS_STARTUP_GUIDE], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "raven-command-windows-startup.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const runSafeE2E = useCallback(async () => {
    if (!report?.approvedRoots?.length) {
      toast.error("Bridge must be paired online to run the safe test.");
      return;
    }
    setE2eBusy(true);
    setE2eLog([]);
    const log = (line: string) => setE2eLog((l) => [...l, line]);
    try {
      const documents = report.approvedRoots.find((r) => /Documents$/i.test(r));
      if (!documents) { log("No Documents root available. Aborting."); return; }
      const folderName = "RavenCommand-SystemCheck-" + Date.now();
      const targetPath = documents + "\\" + folderName;
      log("Preparing safe folder: " + targetPath);

      const prep = await bridgePrepare("files.createFolder", { path: targetPath });
      log("Bridge prepared job " + prep.job.id + " · approval required.");
      const approval = await requestApproval({
        title: "System Check safe test — create folder " + folderName,
        reason: "Creates a temporary folder in Documents, verifies it, and recycles it. Nothing else is touched.",
        tools: ["files.createFolder"],
        dataShared: [targetPath],
        expectedResult: "New empty folder " + folderName + " under Documents.",
        risk: "medium",
        category: "files",
        undo: "Recycle the folder from the Recycle Bin.",
      });
      log("Awaiting your approval in Approvals: " + approval.id);
      log("Once approved, re-run this test to execute the creation and recycle steps.");
      toast.success("Safe test staged. Approve in Approvals to continue.");

      // Best-effort: if user approves before component unmounts, complete flow.
      const start = Date.now();
      let approvedNow: typeof approval | null = null;
      while (Date.now() - start < 60_000) {
        await new Promise((r) => setTimeout(r, 1500));
        const { getDB } = await import("@/lib/rah/db");
        const db = await getDB();
        const cur = await db.get("approvals", approval.id);
        if (cur && cur.status !== "pending") { approvedNow = cur; break; }
      }
      if (!approvedNow) { log("Timed out waiting for approval. Try again later."); return; }
      if (approvedNow.status !== "approved") { log("Approval " + approvedNow.status + " — no changes made."); return; }

      await bridgeExecute(prep.job.id, approval.id, prep.confirmationToken);
      log("Folder created. Verifying via files.list…");

      const { bridgeListFolder } = await import("@/lib/rah/bridge");
      const listed = await bridgeListFolder(documents);
      const found = listed.items.some((i) => i.name === folderName);
      log(found ? "Verified folder present." : "Folder NOT found. Aborting cleanup for safety.");
      if (!found) return;

      const recyclePrep = await bridgePrepare("files.recycle", { path: targetPath });
      const recycleAppr = await requestApproval({
        title: "System Check cleanup — recycle " + folderName,
        reason: "Recycles the temporary folder created by the safe test.",
        tools: ["files.recycle"],
        dataShared: [targetPath],
        expectedResult: "Folder moved to Recycle Bin.",
        risk: "medium",
        category: "files",
        undo: "Restore from the Recycle Bin.",
      });
      log("Awaiting cleanup approval in Approvals: " + recycleAppr.id);
      toast.success("Cleanup staged. Approve in Approvals to finish.");
      const start2 = Date.now();
      let cleanupOk: typeof recycleAppr | null = null;
      while (Date.now() - start2 < 60_000) {
        await new Promise((r) => setTimeout(r, 1500));
        const { getDB } = await import("@/lib/rah/db");
        const db = await getDB();
        const cur = await db.get("approvals", recycleAppr.id);
        if (cur && cur.status !== "pending") { cleanupOk = cur; break; }
      }
      if (!cleanupOk || cleanupOk.status !== "approved") { log("Cleanup not approved — folder remains at " + targetPath); return; }
      await bridgeExecute(recyclePrep.job.id, recycleAppr.id, recyclePrep.confirmationToken);
      log("Folder recycled. Safe end-to-end test complete.");
      toast.success("Safe end-to-end test passed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("ERROR: " + msg);
      toast.error(msg);
    } finally {
      setE2eBusy(false);
    }
  }, [report, requestApproval]);

  const startWork = () => {
    if (!report?.canStartWorkSession) return;
    void navigate({ to: "/", search: { readiness: 1 } as never });
  };

  const tone = report ? overallTone(report.overall) : null;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="display text-2xl gold-text">System Check</h1>
          <p className="text-sm text-muted-foreground">Make everything work · honest real-vs-demo indicators · no service is claimed working while offline.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void run()} disabled={running}>
            {running ? <CircleDashed className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {running ? "Checking…" : "Re-run"}
          </Button>
          <Button size="sm" onClick={startWork} disabled={!report?.canStartWorkSession}>
            <Play className="h-4 w-4" /> Start Work Session
          </Button>
        </div>
      </header>

      {report && tone && (
        <div className={"rounded-lg border p-4 " + tone.className}>
          <div className="flex items-center gap-2 text-sm font-medium">
            {tone.icon}
            <span className="uppercase tracking-widest text-[11px]">{tone.label}</span>
            <span className="ml-auto text-[11px] opacity-80">
              Host: Omen · Bridge port: {report.bridgePortDetected ?? "—"} · Ran {new Date(report.ts).toLocaleTimeString()}
            </span>
          </div>
          <div className="mt-1 text-sm">{report.summary}</div>
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {report?.checks.map((c) => <CheckRow key={c.id} c={c} />)}
        {!report && !running && <div className="text-sm text-muted-foreground">No report yet.</div>}
      </section>

      <section className="glass-panel border border-border/60 p-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          <h2 className="display text-sm uppercase tracking-widest">Safe end-to-end test</h2>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={() => void runSafeE2E()} disabled={e2eBusy || !report?.approvedRoots?.length}>
              {e2eBusy ? <CircleDashed className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run safe test
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Creates a temporary folder in <code>Documents\RavenCommand-SystemCheck-…</code>, verifies it via <code>files.list</code>,
          then recycles it — each step goes through the normal Approvals flow. Nothing else is touched.
          (The bridge does not expose <code>files.writeText</code>, so we exercise the closest safe capability: folder create + verify + recycle.)
        </p>
        {e2eLog.length > 0 && (
          <pre className="mt-3 rounded-md border border-border/60 bg-background/60 p-3 text-xs whitespace-pre-wrap">{e2eLog.join("\n")}</pre>
        )}
      </section>

      <section className="glass-panel border border-border/60 p-4">
        <div className="flex items-center gap-2">
          <h2 className="display text-sm uppercase tracking-widest">Windows startup guide</h2>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowGuide((s) => !s)}>
              {showGuide ? "Hide" : "Show"} inline
            </Button>
            <Button size="sm" variant="outline" onClick={downloadGuide}>
              <Download className="h-4 w-4" /> Download .md
            </Button>
            <a
              href="/rah-desktop-bridge-0.2.1.zip"
              className="inline-flex h-9 items-center gap-1 rounded-md border border-border/60 bg-background/40 px-3 text-sm hover:bg-accent"
              download
            >
              <Download className="h-4 w-4" /> Bridge package
            </a>
          </div>
        </div>
        {showGuide && (
          <pre className="mt-3 rounded-md border border-border/60 bg-background/60 p-3 text-xs whitespace-pre-wrap">{WINDOWS_STARTUP_GUIDE}</pre>
        )}
      </section>

      <div className="text-xs text-muted-foreground">
        See also <Link to="/connections" className="underline">Connections</Link>,{" "}
        <Link to="/approvals" className="underline">Approvals</Link>,{" "}
        <Link to="/audit" className="underline">Audit Log</Link>.
      </div>
    </div>
  );
}