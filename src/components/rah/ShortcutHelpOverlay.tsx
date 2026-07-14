import { useEffect, useState } from "react";

const SHORTCUTS: { section: string; rows: { keys: string; label: string }[] }[] = [
  {
    section: "Global",
    rows: [
      { keys: "Ctrl+Space / Ctrl+K", label: "Open command palette" },
      { keys: "Ctrl+Alt+R", label: "Focus Command Bar" },
      { keys: "Ctrl+Shift+A", label: "Approvals" },
      { keys: "Ctrl+Shift+M", label: "Project Memory" },
      { keys: "Ctrl+Shift+S", label: "Screen Vision" },
      { keys: "Alt+Shift+X", label: "Emergency stop" },
      { keys: "?", label: "Show this help" },
      { keys: "Esc", label: "Close overlay / cancel palette" },
    ],
  },
  {
    section: "Focus block",
    rows: [
      { keys: "Alt+F", label: "Start focus block (uses current draft)" },
      { keys: "Alt+P", label: "Pause or resume" },
      { keys: "Alt+I", label: "Log interruption" },
      { keys: "Alt+Enter", label: "Complete focus block" },
    ],
  },
];

/**
 * Keyboard shortcut help overlay. Fires on `?` and via the command
 * palette entry. Purely informational — never mutates state.
 */
export function ShortcutHelpOverlay() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    const close = () => setOpen(false);
    window.addEventListener("rah:shortcut-help-toggle", toggle);
    window.addEventListener("rah:shortcut-help-close", close);
    return () => {
      window.removeEventListener("rah:shortcut-help-toggle", toggle);
      window.removeEventListener("rah:shortcut-help-close", close);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
      role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
      onClick={() => setOpen(false)}
    >
      <div
        className="glass-panel gold-border w-full max-w-lg rounded-lg p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="display text-sm uppercase tracking-widest text-muted-foreground">Keyboard shortcuts</h2>
          <button
            type="button" onClick={() => setOpen(false)}
            className="ml-auto text-[11px] rounded border border-border/60 px-2 py-0.5 hover:border-primary/60"
          >Close (Esc)</button>
        </div>
        <div className="space-y-3">
          {SHORTCUTS.map((g) => (
            <div key={g.section}>
              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">{g.section}</div>
              <ul className="divide-y divide-border/60">
                {g.rows.map((r) => (
                  <li key={r.keys} className="flex items-center gap-3 py-1.5 text-sm">
                    <kbd className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground min-w-[8ch] text-center">{r.keys}</kbd>
                    <span>{r.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground">
          Alt-based shortcuts are suppressed while typing in text fields.
        </div>
      </div>
    </div>
  );
}