import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Eye, EyeOff, RefreshCw, Search, ShieldAlert, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDB } from "@/lib/rah/db";
import {
  filterVisionHistory,
  exportVisionHistoryJson,
  exportVisionHistoryMarkdown,
  classIsSensitive,
  PRIVACY_CLASS_LABEL,
  validateImportPayload,
} from "@/lib/rah/visionSessions";
import { buildResultChain, filterVisionArtifacts, planImportApply } from "@/lib/rah/visionLifecycle";
import { findStrongestMatch, matchStrengthLabel } from "@/lib/rah/visionMatch";

export const Route = createFileRoute("/vision-history")({
  head: () => ({
    meta: [
      { title: "Vision History — Raven Screen Vision" },
      { name: "description", content: "Review past screen-vision sessions, evidence, and results. Sensitive frames stay hidden until you explicitly reveal them." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VisionHistoryPage,
});

// Minimal shapes — matches what visionSessions.js normalizes.
interface Session { id: string; projectId: string | null; title: string; question: string; sourceLabel: string; status: string; startedAt: number; stoppedAt: number | null; captureCount: number; evidenceIds: string[] }
interface Evidence { id: string; sessionId: string | null; createdAt: number; frame: { width: number; height: number; sizeBytes: number; hash: string | null; mime: string; capturedAt: number | null }; redactedFrame: unknown | null; privacy: { class: string; reasons: string[] }; notes: string; version: number; linkedResultId: string | null }
interface ResultRec { id: string; sessionId?: string | null; evidenceId?: string | null; question?: string; text?: string; provider?: string; model?: string; latencyMs?: number; createdAt?: number }

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleString(); } catch { return "—"; }
}

function fmtSize(bytes: number | undefined | null): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function VisionHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [results, setResults] = useState<ResultRec[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [privacyFilter, setPrivacyFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [sinceFilter, setSinceFilter] = useState<string>("");
  const [untilFilter, setUntilFilter] = useState<string>("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Import Preview/Apply UI state — metadata-only; no silent overwrite.
  const importFileRef = useRef<HTMLInputElement | null>(null);
  interface ImportPlanItem { id: string | null; action: "create" | "replace" | "skip"; reason: string | null }
  interface ImportPreview {
    fileName: string;
    parsed: { schemaVersion: number; sessions: Array<{ id: string }>; evidence: Array<{ id: string; frame?: { hash?: string | null } }>; results: unknown[] } | null;
    plan: { sessions: ImportPlanItem[]; evidence: ImportPlanItem[]; conflicts: { kind: string; id: string; reason: string }[] } | null;
    error: string | null;
  }
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [conflictActions, setConflictActions] = useState<Record<string, "replace" | "skip">>({});
  const [applying, setApplying] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const [s, e, r] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db.getAll("visionSessions" as any).catch(() => []),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db.getAll("visionEvidence" as any).catch(() => []),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db.getAll("visionResults" as any).catch(() => []),
      ]);
      setSessions((s as Session[]).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)));
      setEvidence(e as Evidence[]);
      setResults(r as ResultRec[]);
    } catch (err) {
      console.error("Vision history load failed", err);
      toast.error("Failed to load vision history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const recomputePlan = (
    parsed: NonNullable<ImportPreview["parsed"]>,
    actions: Record<string, "replace" | "skip">,
  ) => {
    return planImportApply({
      existing: { sessions: sessions as unknown as { id: string }[], evidence: evidence as unknown as { id: string; frame?: { hash?: string | null } }[] },
      incoming: { sessions: parsed.sessions, evidence: parsed.evidence },
      conflictActions: actions,
    });
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      let raw: unknown;
      try { raw = JSON.parse(text); } catch (e) {
        setImportPreview({ fileName: file.name, parsed: null, plan: null, error: "Invalid JSON: " + (e as Error).message });
        return;
      }
      const v = validateImportPayload(raw);
      if (!v.ok || !v.parsed) {
        setImportPreview({ fileName: file.name, parsed: null, plan: null, error: "Import rejected: " + (v.reason || "invalid") });
        return;
      }
      const parsed = v.parsed as NonNullable<ImportPreview["parsed"]>;
      const plan = recomputePlan(parsed, {});
      setConflictActions({});
      setImportPreview({ fileName: file.name, parsed, plan, error: null });
    } catch (err) {
      setImportPreview({ fileName: file.name, parsed: null, plan: null, error: (err as Error).message });
    }
  };

  const setConflictAction = (id: string, action: "replace" | "skip") => {
    const next = { ...conflictActions, [id]: action };
    setConflictActions(next);
    if (importPreview?.parsed) {
      const plan = recomputePlan(importPreview.parsed, next);
      setImportPreview({ ...importPreview, plan });
    }
  };

  const applyImport = async () => {
    if (!importPreview?.parsed || !importPreview.plan) return;
    setApplying(true);
    try {
      const db = await getDB();
      const { parsed, plan } = importPreview;
      let created = 0, replaced = 0, skipped = 0;
      const incSessById = new Map(parsed.sessions.map((s) => [s.id, s]));
      const incEvById = new Map(parsed.evidence.map((e) => [e.id, e]));
      for (const it of plan.sessions) {
        if (!it.id) { skipped++; continue; }
        if (it.action === "skip") { skipped++; continue; }
        const rec = incSessById.get(it.id);
        if (!rec) { skipped++; continue; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.put("visionSessions" as any, rec as any);
        if (it.action === "replace") replaced++; else created++;
      }
      for (const it of plan.evidence) {
        if (!it.id) { skipped++; continue; }
        if (it.action === "skip") { skipped++; continue; }
        const rec = incEvById.get(it.id);
        if (!rec) { skipped++; continue; }
        // Metadata-only default: strip any embedded image dataUrl fields.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clean: any = { ...(rec as any) };
        if (clean.frame) delete clean.frame.dataUrl;
        if (clean.redactedFrame) delete clean.redactedFrame.dataUrl;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.put("visionEvidence" as any, clean);
        if (it.action === "replace") replaced++; else created++;
      }
      toast.success(`Import applied: ${created} created, ${replaced} replaced, ${skipped} skipped`);
      setImportPreview(null);
      setConflictActions({});
      if (importFileRef.current) importFileRef.current.value = "";
      await reload();
    } catch (err) {
      toast.error("Apply failed: " + (err as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const filtered = useMemo(() => {
    const opts = {
      q: q || undefined,
      status: (statusFilter || null) as unknown as "active" | "ended" | "cancelled" | null,
      privacyClass: (privacyFilter || null),
      projectId: projectFilter || null,
      source: sourceFilter || null,
      since: sinceFilter ? Date.parse(sinceFilter) : undefined,
      until: untilFilter ? Date.parse(untilFilter) : undefined,
    };
    // Use extended cross-artifact filter for consistency; return sessions view.
    const cross = filterVisionArtifacts(
      { sessions: sessions as unknown[], evidence: evidence as unknown[], results: results as unknown[] },
      opts as never,
    );
    // Also intersect with the original filter (which understands legacy fields).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = (filterVisionHistory as any)(cross.sessions as unknown[], {
      q: q || undefined,
      status: (statusFilter || null) as unknown,
      privacyClass: (privacyFilter || null) as unknown,
    }) as Session[];
    return legacy;
  }, [sessions, evidence, results, q, statusFilter, privacyFilter, projectFilter, sourceFilter, sinceFilter, untilFilter]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) if (s.projectId) set.add(s.projectId);
    return Array.from(set).sort();
  }, [sessions]);

  const evidenceBySession = useMemo(() => {
    const map = new Map<string, Evidence[]>();
    for (const ev of evidence) {
      const key = ev.sessionId || "__orphan__";
      const arr = map.get(key) || [];
      arr.push(ev);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return map;
  }, [evidence]);

  const resultsByEvidence = useMemo(() => {
    const map = new Map<string, ResultRec[]>();
    for (const r of results) {
      const key = r.evidenceId || "";
      if (!key) continue;
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }, [results]);

  // Precompute the strongest historical match for each evidence row —
  // used by the receipt badge below. A row's match ignores itself so
  // we only surface genuine duplicates.
  const matchByEvidence = useMemo(() => {
    const map = new Map<string, { strength: string; targetId: string | null }>();
    for (const e of evidence) {
      const others = evidence.filter((x) => x && x.id !== e.id);
      const r = findStrongestMatch(e as unknown, others as unknown[]);
      map.set(e.id, { strength: r.strength, targetId: r.targetId });
    }
    return map;
  }, [evidence]);

  const doExport = (kind: "json" | "md") => {
    const payload = { sessions: filtered, evidence, results };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = kind === "json" ? (exportVisionHistoryJson as any)(payload) : (exportVisionHistoryMarkdown as any)(payload);
    const blob = new Blob([text], { type: kind === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `raven-vision-history-${Date.now()}.${kind === "json" ? "json" : "md"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl display gold-text">Vision History</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every screen-sharing session and evidence capture you saved locally. Nothing on this
            page is uploaded. Sensitive captures stay hidden until you explicitly reveal them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("json")} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" /> Export JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("md")} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" /> Export Markdown
          </Button>
          <Link to="/vision" className="text-xs underline text-muted-foreground hover:text-foreground">
            Back to Screen Vision
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm flex-1 min-w-[240px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            className="bg-transparent outline-none flex-1"
            placeholder="Search title, question, or source…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          className="rounded-md border border-border/60 bg-transparent px-2 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="ended">Ended</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="rounded-md border border-border/60 bg-transparent px-2 py-2 text-sm"
          value={privacyFilter}
          onChange={(e) => setPrivacyFilter(e.target.value)}
        >
          <option value="">All privacy classes</option>
          {Object.entries(PRIVACY_CLASS_LABEL as Record<string, string>).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          className="rounded-md border border-border/60 bg-transparent px-2 py-2 text-sm"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projectOptions.map((pid) => (
            <option key={pid} value={pid}>{pid}</option>
          ))}
        </select>
        <input
          className="rounded-md border border-border/60 bg-transparent px-2 py-2 text-sm min-w-[120px]"
          placeholder="source contains…"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        />
        <input
          type="date"
          className="rounded-md border border-border/60 bg-transparent px-2 py-2 text-sm"
          value={sinceFilter}
          onChange={(e) => setSinceFilter(e.target.value)}
          aria-label="since"
        />
        <input
          type="date"
          className="rounded-md border border-border/60 bg-transparent px-2 py-2 text-sm"
          value={untilFilter}
          onChange={(e) => setUntilFilter(e.target.value)}
          aria-label="until"
        />
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading vision history…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border/60 p-8 text-center text-sm text-muted-foreground">
          No sessions match. When you capture and save evidence in Screen Vision, it will appear here.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((s) => {
            const ev = evidenceBySession.get(s.id) || [];
            const isOpen = !!expanded[s.id];
            return (
              <li key={s.id} className="rounded-lg border border-border/60 bg-card/40">
                <button
                  className="w-full text-left px-4 py-3 flex items-start justify-between gap-4"
                  onClick={() => setExpanded((m) => ({ ...m, [s.id]: !isOpen }))}
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.title || "Untitled vision session"}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {fmtTime(s.startedAt)} · {s.sourceLabel || "—"} · {ev.length} evidence · status: {s.status}
                    </div>
                    {s.question && (
                      <div className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">Q: {s.question}</div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{isOpen ? "Hide" : "Show"}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-border/60 p-4 space-y-3">
                    {ev.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No evidence saved for this session.</div>
                    ) : ev.map((e) => {
                      const isSensitive = classIsSensitive(e.privacy?.class);
                      const isRevealed = !!revealed[e.id];
                      const evResults = resultsByEvidence.get(e.id) || [];
                      return (
                        <div key={e.id} className="rounded-md border border-border/50 p-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full border border-border/60 px-2 py-0.5">
                              {PRIVACY_CLASS_LABEL[e.privacy?.class] || e.privacy?.class || "unknown"}
                            </span>
                            <span className="text-muted-foreground">{fmtTime(e.createdAt)}</span>
                            <span className="text-muted-foreground">{e.frame?.width}×{e.frame?.height} · {fmtSize(e.frame?.sizeBytes)}</span>
                            {e.frame?.hash && (
                              <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[240px]" title={e.frame.hash}>
                                {e.frame.hash}
                              </span>
                            )}
                            {!e.frame?.hash && (
                              <span className="text-amber-500/90 inline-flex items-center gap-1">
                                <ShieldAlert className="h-3 w-3" /> no integrity hash
                              </span>
                            )}
                            {(() => {
                              const m = matchByEvidence.get(e.id);
                              if (!m || m.strength === "none") return null;
                              const cls = m.strength === "hash"
                                ? "border-emerald-500/40 text-emerald-500/90"
                                : "border-amber-500/40 text-amber-500/90";
                              return (
                                <span
                                  className={`rounded-full border px-2 py-0.5 ${cls}`}
                                  title={m.targetId ? `Duplicate of ${m.targetId}` : matchStrengthLabel(m.strength)}
                                >
                                  {matchStrengthLabel(m.strength)}
                                </span>
                              );
                            })()}
                            <span className="ml-auto">v{e.version || 1}</span>
                          </div>
                          {isSensitive && !isRevealed ? (
                            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 p-3 text-xs">
                              <span className="text-muted-foreground">
                                This capture is marked sensitive ({e.privacy?.reasons?.join(", ") || "user-marked"}). Details are hidden.
                              </span>
                              <Button size="sm" variant="outline" onClick={() => setRevealed((m) => ({ ...m, [e.id]: true }))}>
                                <Eye className="h-3.5 w-3.5 mr-1" /> Reveal
                              </Button>
                            </div>
                          ) : (
                            <>
                              {isSensitive && (
                                <div className="flex justify-end">
                                  <Button size="sm" variant="ghost" onClick={() => setRevealed((m) => ({ ...m, [e.id]: false }))}>
                                    <EyeOff className="h-3.5 w-3.5 mr-1" /> Hide
                                  </Button>
                                </div>
                              )}
                              {e.notes && (
                                <div className="text-xs whitespace-pre-wrap">{e.notes}</div>
                              )}
                              {evResults.length > 0 && (
                                <div className="space-y-2">
                                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Saved results</div>
                                  {evResults.map((r) => {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    const chain = (buildResultChain as any)(evResults as unknown[], r.id) as ResultRec[];
                                    return (
                                    <div key={r.id} className="rounded-sm border border-border/40 p-2 text-xs">
                                      <div className="text-muted-foreground">
                                        {fmtTime(r.createdAt)} · {r.provider || "—"} / {r.model || "—"}{typeof r.latencyMs === "number" ? ` · ${(r.latencyMs / 1000).toFixed(2)}s` : ""}
                                        {chain.length > 1 && (
                                          <span className="ml-2 text-primary">· {chain.length} versions</span>
                                        )}
                                      </div>
                                      {r.question && <div className="mt-1"><span className="text-muted-foreground">Q:</span> {r.question}</div>}
                                      {r.text && <div className="mt-1 whitespace-pre-wrap">{r.text}</div>}
                                    </div>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section className="rounded-lg border border-border/60 p-4 space-y-3" aria-labelledby="rah-vision-import">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" />
          <h2 id="rah-vision-import" className="text-sm font-semibold">Import (Preview &amp; Apply)</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Select an exported <code>raven-vision-history-*.json</code> file. Nothing is written until you press <strong>Apply</strong>.
          Metadata only — embedded image bytes (if any) are dropped. Sensitive originals stay hidden.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            className="text-xs"
            onChange={(e) => void onImportFile(e.target.files?.[0] || null)}
          />
          {importPreview && (
            <Button size="sm" variant="ghost" onClick={() => { setImportPreview(null); setConflictActions({}); if (importFileRef.current) importFileRef.current.value = ""; }}>
              Clear preview
            </Button>
          )}
        </div>
        {importPreview?.error && (
          <div className="rounded-md border border-destructive/60 bg-destructive/10 p-2 text-xs text-destructive">
            {importPreview.error}
          </div>
        )}
        {importPreview?.parsed && importPreview.plan && (() => {
          const p = importPreview.plan;
          const sCreate = p.sessions.filter((x) => x.action === "create").length;
          const sReplace = p.sessions.filter((x) => x.action === "replace").length;
          const sSkip = p.sessions.filter((x) => x.action === "skip").length;
          const eCreate = p.evidence.filter((x) => x.action === "create").length;
          const eReplace = p.evidence.filter((x) => x.action === "replace").length;
          const eSkip = p.evidence.filter((x) => x.action === "skip").length;
          const incEvById = new Map(importPreview.parsed!.evidence.map((e) => [e.id, e]));
          return (
            <div className="space-y-3">
              <div className="text-xs">
                <strong>{importPreview.fileName}</strong> — schema v{importPreview.parsed!.schemaVersion} ·
                {" "}sessions: {sCreate} create / {sReplace} replace / {sSkip} skip ·
                {" "}evidence: {eCreate} create / {eReplace} replace / {eSkip} skip
              </div>
              {p.conflicts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Conflicts ({p.conflicts.length}) — choose per row</div>
                  <ul className="space-y-1">
                    {p.conflicts.map((c) => {
                      const cur = conflictActions[c.id] || "skip";
                      let matchBadge: string | null = null;
                      if (c.kind === "evidence") {
                        const inc = incEvById.get(c.id);
                        if (inc) {
                          const m = findStrongestMatch(inc as unknown, evidence as unknown[]);
                          if (m.strength !== "none") matchBadge = matchStrengthLabel(m.strength);
                        }
                      }
                      return (
                        <li key={`${c.kind}:${c.id}`} className="flex flex-wrap items-center gap-2 text-xs rounded border border-border/50 p-2">
                          <span className="rounded-full border border-border/60 px-2 py-0.5">{c.kind}</span>
                          <code className="text-[10px]">{c.id}</code>
                          <span className="text-muted-foreground">{c.reason}</span>
                          {matchBadge && <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-amber-500/90">{matchBadge}</span>}
                          <div className="ml-auto flex gap-3">
                            <label className="flex items-center gap-1">
                              <input type="radio" name={`ca-${c.id}`} checked={cur === "skip"} onChange={() => setConflictAction(c.id, "skip")} />
                              Skip
                            </label>
                            <label className="flex items-center gap-1">
                              <input type="radio" name={`ca-${c.id}`} checked={cur === "replace"} onChange={() => setConflictAction(c.id, "replace")} />
                              Replace
                            </label>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void applyImport()} disabled={applying}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> {applying ? "Applying…" : "Apply import"}
                </Button>
              </div>
            </div>
          );
        })()}
      </section>

      <div className="rounded-md border border-border/50 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Trash2 className="h-3.5 w-3.5 mt-0.5" />
        <span>
          To delete captures, use the Privacy page's wipe controls. This history view is read-only —
          it never modifies stored evidence.
        </span>
      </div>
    </div>
  );
}