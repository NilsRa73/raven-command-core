import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getDB, uid } from "@/lib/rah/db";
import type { FocusSession } from "@/lib/rah/focusSession";
import {
  newFocusDraft, isFocusDraftDirty, start, pause, resume, complete, cancel,
  logInterruption, computeTiming, restoreAfterReload, formatDuration,
  buildCompletionDraft, isActive,
} from "@/lib/rah/focusSession";
import { shouldConfirmDiscard } from "@/lib/rah/draftGuard";
import { useRah } from "@/lib/rah/context";

const DURATION_OPTIONS: { label: string; ms: number | null }[] = [
  { label: "15 min", ms: 15 * 60_000 },
  { label: "25 min", ms: 25 * 60_000 },
  { label: "50 min", ms: 50 * 60_000 },
  { label: "90 min", ms: 90 * 60_000 },
  { label: "Count-up", ms: null },
];

/**
 * Raven Home focus block: builder + live timer + completion draft.
 * State is persisted to IndexedDB v6 (`focusSessions`). No silent
 * side-effects — completion turns into a review draft the user must
 * explicitly Save to Chronicle / Project Memory or Discard.
 */
export function FocusBlockCard() {
  const rah = useRah();
  const projectId = rah.activeProject?.id ?? null;

  const [draft, setDraft] = useState<FocusSession>(() => newFocusDraft({ projectId }));
  const [active, setActive] = useState<FocusSession | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<FocusSession | null>(null);
  const [history, setHistory] = useState<FocusSession[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const bootstrappedRef = useRef(false);

  // 1-second tick while a timer is running/paused; otherwise idle.
  useEffect(() => {
    if (!isActive(active)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active?.id, active?.status]);

  // Load persisted state on mount.
  const reloadHistory = useCallback(async () => {
    try {
      const db = await getDB();
      const all = await db.getAll("focusSessions");
      all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setHistory(all);
      return all;
    } catch { return []; }
  }, []);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    (async () => {
      const all = await reloadHistory();
      const live = all.find((r) => r.status === "running" || r.status === "paused");
      if (live) {
        const restored = restoreAfterReload(live, Date.now())!;
        setActive(restored);
        if (restored !== live) {
          try {
            const db = await getDB();
            await db.put("focusSessions", restored);
          } catch { /* ignore */ }
        }
      }
    })();
  }, [reloadHistory]);

  // Update draft's projectId when active project changes and no dirty draft.
  useEffect(() => {
    setDraft((d) => (isFocusDraftDirty(d, d.projectId) ? d : { ...d, projectId }));
  }, [projectId]);

  const persist = useCallback(async (rec: FocusSession) => {
    const db = await getDB();
    await db.put("focusSessions", rec);
    await reloadHistory();
  }, [reloadHistory]);

  // ── Actions ────────────────────────────────────────────────────────
  const onStart = useCallback(async () => {
    if (!draft.title.trim()) {
      toast.error("Give the focus block a title first.");
      return;
    }
    if (active) { toast.message("Another focus block is already active."); return; }
    const started = start({ ...draft, id: uid() }, Date.now());
    setActive(started);
    setDraft(newFocusDraft({ projectId }));
    await persist(started);
    toast.success(`Focus block started · ${started.mode.toUpperCase()}`);
  }, [draft, active, projectId, persist]);

  const onPauseResume = useCallback(async () => {
    if (!active) return;
    const next = active.status === "running" ? pause(active, Date.now()) : resume(active, Date.now());
    setActive(next);
    await persist(next);
  }, [active, persist]);

  const onComplete = useCallback(async () => {
    if (!active) return;
    const done = complete(active, Date.now());
    setActive(null);
    setPendingCompletion(done);
    await persist(done);
  }, [active, persist]);

  const onCancel = useCallback(async () => {
    if (!active) return;
    if (!confirm("Cancel this focus block? Elapsed time will still be recorded.")) return;
    const cancelled = cancel(active, Date.now());
    setActive(null);
    await persist(cancelled);
    toast.message("Focus block cancelled.");
  }, [active, persist]);

  const onInterrupt = useCallback(async () => {
    if (!active) return;
    const note = prompt("Interruption note (optional)") ?? "";
    const upd = logInterruption(active, note, Date.now());
    setActive(upd);
    await persist(upd);
  }, [active, persist]);

  const onDiscardDraft = useCallback(() => {
    if (shouldConfirmDiscard({ dirty: isFocusDraftDirty(draft, projectId) })) {
      if (!confirm("Discard focus block draft?")) return;
    }
    setDraft(newFocusDraft({ projectId }));
  }, [draft, projectId]);

  const onSaveCompletionToMemory = useCallback(async () => {
    if (!pendingCompletion) return;
    const c = buildCompletionDraft(pendingCompletion, Date.now());
    const lines = [
      `Focus block: ${c.title}`,
      `Mode: ${c.mode.toUpperCase()} · Status: ${c.status}`,
      `Elapsed: ${formatDuration(c.elapsedMs)}${c.plannedDurationMs != null ? ` / planned ${formatDuration(c.plannedDurationMs)}` : ""}`,
      c.interruptionCount ? `Interruptions: ${c.interruptionCount}` : null,
      c.notes ? `Notes: ${c.notes}` : null,
    ].filter(Boolean).join("\n");
    await rah.createProjectMemory({
      projectId: pendingCompletion.projectId,
      title: `Focus block · ${pendingCompletion.title}`,
      content: lines,
      type: "daily_log",
      tags: ["focus-block", pendingCompletion.mode],
      source: "focus-block",
      archived: false,
      pinned: false,
    });
    toast.success("Saved to Project Memory / Chronicle.");
    setPendingCompletion(null);
  }, [pendingCompletion, rah]);

  const onDiscardCompletion = useCallback(() => {
    if (!confirm("Discard this completion note? The session itself stays in your focus history.")) return;
    setPendingCompletion(null);
  }, []);

  // ── Keyboard events from palette / shortcuts ──────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).type;
      if (detail === "rah:focus:start") { void onStart(); return; }
      if (detail === "rah:focus:pause" || detail === "rah:focus:resume") { void onPauseResume(); return; }
      if (detail === "rah:focus:complete") { void onComplete(); return; }
      if (detail === "rah:focus:cancel") { void onCancel(); return; }
      if (detail === "rah:focus:interrupt") { void onInterrupt(); return; }
    };
    const events = [
      "rah:focus:start", "rah:focus:pause", "rah:focus:resume",
      "rah:focus:complete", "rah:focus:cancel", "rah:focus:interrupt",
    ];
    events.forEach((ev) => window.addEventListener(ev, handler));
    return () => events.forEach((ev) => window.removeEventListener(ev, handler));
  }, [onStart, onPauseResume, onComplete, onCancel, onInterrupt]);

  const timing = useMemo(() => computeTiming(active, now), [active, now]);
  const dirty = isFocusDraftDirty(draft, projectId);

  return (
    <section className="glass-panel gold-border p-4" aria-label="Focus block">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="display text-sm uppercase tracking-widest text-muted-foreground">Focus block</h2>
        <div className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">
          {active ? `Live · ${active.mode.toUpperCase()}` : pendingCompletion ? "Review completion" : "Idle"}
        </div>
      </div>

      {active ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-4">
            <div className="font-mono text-4xl md:text-5xl text-primary tabular-nums" aria-live="polite">
              {formatDuration(timing.elapsedMs)}
            </div>
            {timing.remainingMs != null && (
              <div className={"text-sm " + (timing.overdue ? "text-yellow-400" : "text-muted-foreground")}>
                {timing.overdue ? "over by " : "remaining "}
                <span className="tabular-nums">{formatDuration(Math.abs(timing.remainingMs))}</span>
              </div>
            )}
            {timing.warning && (
              <span className="text-[11px] text-destructive" title={timing.warning}>clock warning</span>
            )}
          </div>
          <div className="text-sm truncate">
            <span className="text-muted-foreground">Task:</span> <span className="text-foreground">{active.title}</span>
          </div>
          {active.interruptions.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              Interruptions logged: {active.interruptions.length}
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={onPauseResume}
              className="inline-flex h-8 items-center rounded-md border border-primary/60 bg-primary/10 px-3 text-primary hover:bg-primary/20">
              {active.status === "running" ? "Pause" : "Resume"} <kbd className="ml-2 text-[10px] rounded border border-border/60 px-1">Alt+P</kbd>
            </button>
            <button type="button" onClick={onInterrupt}
              className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 hover:border-primary/60">
              Log interruption <kbd className="ml-2 text-[10px] rounded border border-border/60 px-1">Alt+I</kbd>
            </button>
            <button type="button" onClick={onComplete}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90">
              Complete <kbd className="ml-2 text-[10px] rounded border border-primary-foreground/40 px-1">Alt+Enter</kbd>
            </button>
            <button type="button" onClick={onCancel}
              className="inline-flex h-8 items-center rounded-md border border-destructive/60 px-3 text-destructive hover:bg-destructive/10">
              Cancel
            </button>
          </div>
        </div>
      ) : pendingCompletion ? (
        <CompletionReview
          record={pendingCompletion}
          onSave={onSaveCompletionToMemory}
          onDiscard={onDiscardCompletion}
        />
      ) : (
        <FocusBuilder
          draft={draft}
          setDraft={setDraft}
          dirty={dirty}
          onStart={onStart}
          onDiscard={onDiscardDraft}
        />
      )}

      {history.length > 0 && !active && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Recent focus sessions</div>
          <ul className="divide-y divide-border/60">
            {history.slice(0, 5).map((r) => (
              <li key={r.id} className="py-1.5 flex items-center gap-2 text-xs">
                <span className="min-w-[54px] text-muted-foreground">
                  {r.createdAt ? new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.title || "(untitled)"}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {r.mode} · {r.status} · {formatDuration(computeTiming(r, Date.now()).elapsedMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FocusBuilder({
  draft, setDraft, dirty, onStart, onDiscard,
}: {
  draft: FocusSession;
  setDraft: (updater: (d: FocusSession) => FocusSession) => void;
  dirty: boolean;
  onStart: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs md:col-span-2">
        <span className="text-muted-foreground">Focus task</span>
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="e.g. Finish Raven Home v0.2 focus block"
          className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none focus:border-primary/60"
        />
      </label>
      <div className="text-xs">
        <div className="text-muted-foreground">Duration</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {DURATION_OPTIONS.map((o) => {
            const on = draft.plannedDurationMs === o.ms;
            return (
              <button
                key={o.label} type="button"
                onClick={() => setDraft((d) => ({ ...d, plannedDurationMs: o.ms }))}
                className={
                  "rounded-md border px-2 py-1 text-xs " +
                  (on ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/60")
                }
              >{o.label}</button>
            );
          })}
        </div>
      </div>
      <div className="text-xs">
        <div className="text-muted-foreground">Mode</div>
        <div className="mt-1 flex gap-1">
          {(["fast", "deep"] as const).map((m) => (
            <button
              key={m} type="button"
              onClick={() => setDraft((d) => ({ ...d, mode: m }))}
              className={
                "rounded-md border px-3 py-1 text-xs uppercase tracking-widest " +
                (draft.mode === m ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-primary/60")
              }
            >{m}</button>
          ))}
        </div>
      </div>
      <label className="text-xs md:col-span-2">
        <span className="text-muted-foreground">Notes (optional)</span>
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          rows={2}
          className="mt-1 w-full resize-y rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none focus:border-primary/60"
        />
      </label>
      <div className="md:col-span-2 flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={onStart}
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          disabled={!draft.title.trim()}>
          Start focus block <kbd className="ml-2 text-[10px] rounded border border-primary-foreground/40 px-1">Alt+F</kbd>
        </button>
        <button type="button" onClick={onDiscard}
          className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 hover:border-destructive/60 disabled:opacity-50"
          disabled={!dirty}>
          Discard draft
        </button>
        <span className="ml-auto self-center text-[11px] text-muted-foreground">
          Nothing is saved until you Start. Completion prompts you to save a Chronicle entry.
        </span>
      </div>
    </div>
  );
}

function CompletionReview({
  record, onSave, onDiscard,
}: { record: FocusSession; onSave: () => void; onDiscard: () => void }) {
  const t = computeTiming(record, Date.now());
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3 text-xs">
        <KV label="Task" value={record.title || "(untitled)"} />
        <KV label="Elapsed" value={formatDuration(t.elapsedMs)} />
        <KV label="Interruptions" value={String(record.interruptions.length)} />
      </div>
      {record.notes && (
        <div className="text-xs">
          <div className="text-muted-foreground">Notes</div>
          <div className="mt-1 whitespace-pre-wrap rounded-md border border-border/60 bg-background/40 p-2 text-foreground">{record.notes}</div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={onSave}
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90">
          Save to Chronicle / Memory
        </button>
        <button type="button" onClick={onDiscard}
          className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 hover:border-destructive/60">
          Discard note
        </button>
        <span className="ml-auto self-center text-[11px] text-muted-foreground">
          The session itself is already stored in focus history. This step decides whether to add a Chronicle entry.
        </span>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-foreground" title={value}>{value}</div>
    </div>
  );
}