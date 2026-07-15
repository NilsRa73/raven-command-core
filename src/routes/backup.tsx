import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRah } from "@/lib/rah/context";
import { toast } from "sonner";
import {
  buildBackup, validateBackup, applyBackup, saveSnapshot, listSnapshots,
  deleteSnapshot, getSnapshot, computeDiff, canonicalize,
  type BackupPayload, type ImportMode, type ValidationResult, type SnapshotMeta, type StoreDiff,
  BACKUP_STORES,
} from "@/lib/rah/backup";
import { Download, Upload, RefreshCw, Save, Trash2, ShieldCheck, AlertTriangle } from "lucide-react";

const APP_VERSION = "0.3.0";

export const Route = createFileRoute("/backup")({
  head: () => ({
    meta: [
      { title: "Backup & Restore — Raven Command" },
      { name: "description", content: "Versioned local backups of your Raven Command workspace." },
    ],
  }),
  component: BackupPage,
});

function BackupPage() {
  useRah(); // Ensure RAH context (and IDB) is bootstrapped before we read stores.
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<BackupPayload | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [diff, setDiff] = useState<StoreDiff[] | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");

  const refreshSnapshots = useCallback(async () => {
    try { setSnapshots(await listSnapshots()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { void refreshSnapshots(); }, [refreshSnapshots]);

  const doExport = useCallback(async () => {
    setBusy("export");
    try {
      const b = await buildBackup(APP_VERSION);
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raven-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Backup exported (${Object.values(b.counts).reduce((s, n) => s + n, 0)} rows).`);
    } catch (e) {
      toast.error("Export failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(null); }
  }, []);

  const doSnapshot = useCallback(async (reason: string) => {
    setBusy("snapshot");
    try {
      const b = await buildBackup(APP_VERSION);
      await saveSnapshot(b, reason);
      toast.success("Snapshot saved locally.");
      await refreshSnapshots();
    } catch (e) {
      toast.error("Snapshot failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(null); }
  }, [refreshSnapshots]);

  const loadCandidate = useCallback(async (payload: BackupPayload) => {
    const v = await validateBackup(payload);
    setCandidate(payload);
    setValidation(v);
    if (v.ok) {
      const current = await buildBackup(APP_VERSION);
      const existing: Record<string, unknown[]> = {};
      for (const s of BACKUP_STORES) existing[s] = current.data[s];
      const incoming: Record<string, unknown[]> = {};
      for (const s of BACKUP_STORES) incoming[s] = payload.data[s] ?? [];
      setDiff(computeDiff(existing, incoming));
    } else {
      setDiff(null);
    }
  }, []);

  const onFile = useCallback(async (file: File) => {
    setBusy("validate");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupPayload;
      await loadCandidate(parsed);
    } catch (e) {
      toast.error("Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
      setCandidate(null); setValidation(null); setDiff(null);
    } finally { setBusy(null); }
  }, [loadCandidate]);

  const doApply = useCallback(async () => {
    if (!candidate || !validation?.ok) return;
    setBusy("apply");
    try {
      // Safety snapshot before any destructive import.
      const pre = await buildBackup(APP_VERSION);
      await saveSnapshot(pre, `pre-restore-${mode}`);
      const { imported } = await applyBackup(candidate, mode);
      const total = Object.values(imported).reduce((s, n) => s + n, 0);
      toast.success(`Restored ${total} rows in ${mode} mode. A pre-restore snapshot was saved.`);
      setCandidate(null); setValidation(null); setDiff(null);
      await refreshSnapshots();
    } catch (e) {
      toast.error("Restore failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(null); }
  }, [candidate, validation, mode, refreshSnapshots]);

  const loadSnapshot = useCallback(async (id: string) => {
    const s = await getSnapshot(id);
    if (!s) { toast.error("Snapshot not found."); return; }
    await loadCandidate(s.payload);
    toast.info("Snapshot loaded — review and click Restore to apply.");
  }, [loadCandidate]);

  const dropSnapshot = useCallback(async (id: string) => {
    await deleteSnapshot(id);
    await refreshSnapshots();
  }, [refreshSnapshots]);

  const totalDiff = useMemo(() => diff?.reduce(
    (acc, d) => ({ adds: acc.adds + d.adds, updates: acc.updates + d.updates, unchanged: acc.unchanged + d.unchanged }),
    { adds: 0, updates: 0, unchanged: 0 },
  ), [diff]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl gold-text">Backup & Restore</h1>
        <p className="text-muted-foreground">
          Local-first, versioned JSON backups. Secrets (bridge tokens, provider keys) are never exported.
        </p>
      </header>

      <section className="glass-panel gold-border p-4 space-y-3">
        <h2 className="font-semibold">Export</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={doExport} disabled={busy !== null}>
            <Download className="h-4 w-4" /> Export JSON
          </Button>
          <Button variant="outline" onClick={() => doSnapshot("manual")} disabled={busy !== null}>
            <Save className="h-4 w-4" /> Save local snapshot
          </Button>
        </div>
      </section>

      <section className="glass-panel gold-border p-4 space-y-3">
        <h2 className="font-semibold">Restore</h2>
        <input
          type="file"
          accept="application/json,.json"
          className="text-sm"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
        />
        {validation && (
          <div className={`rounded border p-3 text-sm ${validation.ok ? "border-green-700 bg-green-950/30" : "border-red-700 bg-red-950/30"}`}>
            <div className="flex items-center gap-2 font-medium">
              {validation.ok ? <ShieldCheck className="h-4 w-4 text-green-500" /> : <AlertTriangle className="h-4 w-4 text-red-500" />}
              {validation.ok ? "Backup validated" : "Backup invalid"}
              {validation.checksumOk === true && <span className="text-green-500 text-xs">checksum ok</span>}
              {validation.checksumOk === false && <span className="text-red-500 text-xs">checksum FAILED</span>}
            </div>
            {validation.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5">{validation.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
          </div>
        )}
        {diff && totalDiff && (
          <div className="rounded border border-border/60 p-3 text-sm">
            <div className="mb-2 font-medium">
              Preview: <span className="text-green-500">+{totalDiff.adds} new</span>,{" "}
              <span className="text-amber-500">{totalDiff.updates} updated</span>,{" "}
              <span className="text-muted-foreground">{totalDiff.unchanged} unchanged</span>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Per-store detail</summary>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 text-xs">
                {diff.filter((d) => d.incoming > 0 || d.existing > 0).map((d) => (
                  <li key={d.store}>
                    <span className="font-mono">{d.store}</span>: +{d.adds} / ~{d.updates} / ={d.unchanged}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        {candidate && validation?.ok && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">Mode:</label>
            <select
              className="rounded border border-border/60 bg-background px-2 py-1 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as ImportMode)}
            >
              <option value="merge">Merge (add new, update existing)</option>
              <option value="replace">Replace (clear each store first)</option>
            </select>
            <Button onClick={doApply} disabled={busy !== null}>
              <Upload className="h-4 w-4" /> Restore
            </Button>
            <span className="text-xs text-muted-foreground">A safety snapshot is taken before any restore.</span>
          </div>
        )}
      </section>

      <section className="glass-panel gold-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Local snapshots</h2>
          <Button size="sm" variant="ghost" onClick={refreshSnapshots}><RefreshCw className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground">Keeps the 10 most recent.</span>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No snapshots yet. Click <em>Save local snapshot</em> to create one.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {snapshots.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium">{s.reason}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString()} · {s.totalRows} rows · {(s.bytes / 1024).toFixed(1)} KB · {s.checksum.slice(0, 8)}…
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => loadSnapshot(s.id)}>Preview restore</Button>
                  <Button size="sm" variant="ghost" onClick={() => dropSnapshot(s.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tiny sanity display for the reducer/checksum helpers to prove they're wired. */}
      <div className="text-[10px] text-muted-foreground">
        canonicalize helper OK: {canonicalize({ a: 1, b: 2 }).length > 0 ? "yes" : "no"}
      </div>
    </div>
  );
}