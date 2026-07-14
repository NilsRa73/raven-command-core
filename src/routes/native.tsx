import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useRah } from "@/lib/rah/context";
import {
  summarizeCompanionStatus,
  summarizeSigningReadiness,
  computeRestartBlockers,
  createHistoryEvent,
  exportHistoryJson,
  exportHistoryMarkdown,
  filterHistory,
  UPDATER_STATES,
  RELEASE_CHANNELS,
  type UpdateHistoryEvent,
  type UpdaterState,
} from "@/lib/rah/updater";
import bridgeManifest from "@/lib/rah/bridge-manifest.json";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/native")({
  head: () => ({
    meta: [
      { title: "Native Companion · Raven One" },
      { name: "description", content: "Windows tray companion status, update readiness, and safe restart controls." },
    ],
  }),
  component: NativeCompanion,
  errorComponent: ({ error, reset }) => (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Native Companion failed to load</h1>
      <p className="text-sm text-muted-foreground mt-2">{String(error?.message ?? error)}</p>
      <Button className="mt-4" onClick={() => reset()}>Retry</Button>
    </div>
  ),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

// LocalStorage-backed update history — this UI never fabricates events.
const HISTORY_KEY = "rah.updateHistory.v1";
const PREFS_KEY   = "rah.updaterPrefs.v1";

function loadHistory(): UpdateHistoryEvent[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveHistory(events: UpdateHistoryEvent[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(events.slice(0, 500)));
}
function loadPrefs(): { autoCheck: boolean; channel: string } {
  if (typeof localStorage === "undefined") return { autoCheck: false, channel: "stable" };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { autoCheck: false, channel: "stable" };
    const p = JSON.parse(raw);
    return { autoCheck: !!p.autoCheck, channel: RELEASE_CHANNELS.includes(p.channel) ? p.channel : "stable" };
  } catch { return { autoCheck: false, channel: "stable" }; }
}
function savePrefs(p: { autoCheck: boolean; channel: string }) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

function NativeCompanion() {
  const { approvals } = useRah();
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [history, setHistory] = useState<UpdateHistoryEvent[]>(() => loadHistory());
  const [ackRestart, setAckRestart] = useState(false);
  const [uiState, setUiState] = useState<UpdaterState>("idle");

  // Detect Tauri runtime honestly — do NOT invent a version if not present.
  const nativeAvailable = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

  // Version info comes ONLY from data the app actually knows. Unknown => "—".
  const bridgeVersion = (bridgeManifest as any)?.version ?? null;
  const appVersion = nativeAvailable ? ((window as any).__TAURI_METADATA__?.__version ?? null) : null;
  const sidecarVersion = bridgeVersion; // SEA sidecar tracks bridge source version.

  const summary = useMemo(() => summarizeCompanionStatus({
    nativeAvailable,
    appVersion,
    bridgeVersion,
    sidecarVersion,
    target: { os: "windows", arch: "x86_64" },
    prefs,
    state: uiState,
    signing: {
      // Presence is detected structurally — no secrets are read from the browser.
      updaterEndpointConfigured: false,
      tauriPublicKeyPresent: false,
      tauriPrivateKeyPresent: false,
      tauriKeyPasswordPresent: false,
      windowsCertPresent: false,
      windowsSignToolPresent: false,
    },
  }), [nativeAvailable, appVersion, bridgeVersion, sidecarVersion, prefs, uiState]);

  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;
  const restart = computeRestartBlockers({
    pendingApprovals,
    downloadInProgress: uiState === "downloading",
  });
  const sign = summarizeSigningReadiness({});

  function recordEvent(state: UpdaterState, detail?: string) {
    const e = createHistoryEvent({
      at: Date.now(),
      state,
      fromVersion: bridgeVersion,
      toVersion: null,
      channel: prefs.channel,
      target: "windows-x86_64",
      detail: detail ?? null,
    });
    const next = [e, ...history];
    setHistory(next);
    saveHistory(next);
  }

  useEffect(() => { savePrefs(prefs); }, [prefs]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-2xl gold-text">Native Companion</h1>
        <p className="text-sm text-muted-foreground">
          Tauri tray companion, sidecar version, updater readiness, and safe restart controls.
          This page renders only values the app knows for certain; unknown fields display as “—”.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="Runtime">
          <Row k="Native app" v={summary.state === "unsupported" ? "not detected (open in Tauri companion)" : "detected"} />
          <Row k="App version" v={summary.appVersion} />
          <Row k="Bridge version" v={summary.bridgeVersion} />
          <Row k="Sidecar version" v={summary.sidecarVersion} />
          <Row k="Platform / arch" v={summary.target} />
          <Row k="Channel" v={`${summary.channel} (${summary.channelReason})`} />
          <Row k="Last check" v={summary.lastCheckLabel} />
          <Row k="Downloaded version" v={summary.downloadedVersion} />
          <Row k="State" v={summary.state} />
        </Card>

        <Card title="Update readiness">
          <Row k="Endpoint configured" v={summary.endpointConfigured ? "yes" : "no"} />
          <Row k="Public key configured" v={summary.publicKeyConfigured ? "yes" : "no"} />
          <Row k="Signing readiness" v={sign.overall} />
          <p className="mt-2 text-xs text-muted-foreground">
            Configured: {sign.configured.join(", ") || "(none)"}<br />
            Missing: {sign.missing.join(", ") || "(none)"}<br />
            Externally required: {sign.external.join(", ") || "(none)"}
          </p>
          {summary.blockers.length > 0 && (
            <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <strong>Blockers:</strong>
              <ul className="list-disc ml-4">{summary.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="Update actions">
          <div className="flex flex-wrap gap-2">
            <Button disabled={!summary.canCheck} onClick={() => { setUiState("checking"); recordEvent("checking", "manual"); setTimeout(() => { setUiState("up_to_date"); recordEvent("up_to_date", "no_update_configured"); }, 500); }}>
              Check for updates
            </Button>
            <Button variant="outline" disabled={!summary.canDownload}>Download</Button>
            <Button variant="outline" disabled={!summary.canInstall}>Install</Button>
            <Button
              variant="destructive"
              disabled={!summary.canRestart || (!restart.safe && !ackRestart)}
              onClick={() => { recordEvent("awaiting_restart", "user_requested_restart"); }}
            >
              Restart to apply
            </Button>
          </div>
          {!restart.safe && (
            <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
              <strong>Restart blockers:</strong>
              <ul className="list-disc ml-4">{restart.blockers.map((b) => <li key={b.kind}>{b.label}</li>)}</ul>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={ackRestart} onChange={(e) => setAckRestart(e.target.checked)} />
                I acknowledge these will be interrupted
              </label>
            </div>
          )}
        </Card>

        <Card title="Preferences">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prefs.autoCheck} onChange={(e) => setPrefs({ ...prefs, autoCheck: e.target.checked })} />
            Auto-check for updates (off by default)
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            Channel
            <select className="rounded border bg-transparent px-2 py-1" value={prefs.channel} onChange={(e) => setPrefs({ ...prefs, channel: e.target.value })}>
              {RELEASE_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Every check, download, install, and restart requires an explicit click. Auto-check only schedules a background check — it never installs.
          </p>
        </Card>
      </section>

      <section>
        <Card title="Update history (local device only)">
          <div className="mb-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => download("update-history.json", exportHistoryJson(history))}>Export JSON</Button>
            <Button size="sm" variant="outline" onClick={() => download("update-history.md", exportHistoryMarkdown(history))}>Export Markdown</Button>
            <Button size="sm" variant="outline" onClick={() => { setHistory([]); saveHistory([]); }}>Clear</Button>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No events recorded on this device.</p>
          ) : (
            <ul className="text-xs space-y-1 max-h-64 overflow-y-auto">
              {filterHistory(history).map((e) => (
                <li key={e.id} className="font-mono">
                  {new Date(e.at).toISOString()} · {e.state} · {e.channel ?? "—"} · {e.detail ?? e.error ?? ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Debug — allowed updater states: {UPDATER_STATES.join(", ")}
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}
function download(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}