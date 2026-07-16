import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  filterPaletteCommands, groupBySection, isFreeformPrompt,
  type PaletteCommand,
} from "@/lib/rah/commandPalette";
import { useRah } from "@/lib/rah/context";
import { bridgeHealth } from "@/lib/rah/bridge";
import { saveFocusMode, loadFocusMode } from "@/lib/rah/missionControl";

/** Fire this custom event anywhere to toggle the palette. */
export const PALETTE_TOGGLE_EVENT = "rah:command-palette-toggle";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const rah = useRah();

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    window.addEventListener(PALETTE_TOGGLE_EVENT, onToggle);
    window.addEventListener("rah:command-palette-open", onOpen);
    window.addEventListener("rah:command-palette-close", onClose);
    return () => {
      window.removeEventListener(PALETTE_TOGGLE_EVENT, onToggle);
      window.removeEventListener("rah:command-palette-open", onOpen);
      window.removeEventListener("rah:command-palette-close", onClose);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ(""); setCursor(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const results = useMemo(() => filterPaletteCommands(q), [q]);
  const groups = useMemo(() => groupBySection(results), [results]);
  const freeform = useMemo(() => isFreeformPrompt(q), [q]);
  useEffect(() => { setCursor(0); }, [q]);

  if (!open) return null;

  const flat: PaletteCommand[] = groups.flatMap((g) => g.items);
  const activeIndex = Math.min(cursor, Math.max(0, flat.length - 1));

  async function runAction(action: string) {
    switch (action) {
      case "focus_command_bar":
        setOpen(false);
        await nav({ to: "/" });
        setTimeout(() => rah.focusCommandBar(), 40);
        break;
      case "continue_project":
        setOpen(false);
        if (!rah.activeProject) { toast.message("No active project", { description: "Pick one in Projects first." }); return; }
        await nav({ to: "/" });
        setTimeout(() => rah.focusCommandBar(), 40);
        break;
      case "emergency_stop":
        setOpen(false);
        await rah.emergencyStop();
        toast.success("Emergency stop issued.");
        break;
      case "test_bridge": {
        setOpen(false);
        const h = await bridgeHealth();
        if (h.state === "online") toast.success(`Bridge OK · ${h.latencyMs ?? "?"} ms`);
        else toast.error(`Bridge unreachable: ${h.message ?? h.state}`);
        break;
      }
      case "toggle_focus_mode": {
        setOpen(false);
        const next = !loadFocusMode();
        saveFocusMode(next);
        window.dispatchEvent(new CustomEvent("rah:focus-mode-changed"));
        toast.success(next ? "Focus mode on" : "Focus mode off");
        break;
      }
      case "focus_start":
      case "focus_pause":
      case "focus_resume":
      case "focus_complete":
      case "focus_cancel":
      case "focus_interrupt": {
        setOpen(false);
        const ev = action === "focus_resume" ? "rah:focus:pause" : "rah:focus:" + action.replace(/^focus_/, "");
        await nav({ to: "/" });
        setTimeout(() => window.dispatchEvent(new CustomEvent(ev)), 40);
        break;
      }
      case "shortcut_help":
        setOpen(false);
        window.dispatchEvent(new CustomEvent("rah:shortcut-help-toggle"));
        break;
      case "present_workstream":
        setOpen(false);
        await nav({ to: "/workstream" });
        break;
      case "add_routine":
        setOpen(false);
        await nav({ to: "/routines" });
        break;
      case "toggle_theme": {
        setOpen(false);
        const next = rah.prefs.theme === "raven" ? "kraakeby" : "raven";
        await rah.updatePrefs({ theme: next });
        toast.success(`Theme: ${next === "raven" ? "Raven Gold" : "Kråkeby"}`);
        break;
      }
      default:
        toast.error("Unknown action: " + action);
    }
  }

  async function pick(cmd: PaletteCommand) {
    if (cmd.to) { setOpen(false); await nav({ to: cmd.to as any }); return; }
    if (cmd.action) { await runAction(cmd.action); return; }
  }

  function sendFreeform() {
    const text = (q.startsWith(">") ? q.slice(1) : q).trim();
    if (!text) return;
    setOpen(false);
    void nav({ to: "/" }).then(() => {
      setTimeout(() => {
        rah.focusCommandBar();
        window.dispatchEvent(new CustomEvent("rah:prefill-command", { detail: { text } }));
      }, 40);
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-background/70 backdrop-blur-sm flex items-start justify-center p-4 sm:p-16"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
    >
      <div
        className="glass-panel gold-border w-full max-w-xl overflow-hidden rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border/60 p-2 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground pl-2">Raven</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command, page, or > prompt…"
            className="flex-1 bg-transparent outline-none text-sm px-2 py-2"
            aria-label="Command palette search"
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); return; }
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); return; }
              if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
              if (e.key === "Enter") {
                e.preventDefault();
                if (flat[activeIndex]) void pick(flat[activeIndex]);
                else if (freeform) sendFreeform();
              }
            }}
          />
          <kbd className="hidden sm:inline text-[10px] rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground">esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {flat.length === 0 && !freeform && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">No matches. Prefix with <kbd className="mx-1 rounded border border-border/60 px-1">&gt;</kbd> to send as a prompt.</div>
          )}
          {freeform && (
            <button
              type="button"
              onClick={sendFreeform}
              className="w-full text-left px-3 py-2 text-sm bg-primary/10 border-y border-primary/40 hover:bg-primary/20"
            >
              <span className="text-primary">→</span> Send to Command Bar: <span className="text-foreground">{(q.startsWith(">") ? q.slice(1) : q).trim()}</span>
            </button>
          )}
          {groups.map((g) => (
            <div key={g.section} className="py-1">
              <div className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">{g.section}</div>
              <ul>
                {g.items.map((cmd) => {
                  const idx = flat.indexOf(cmd);
                  const active = idx === activeIndex;
                  return (
                    <li key={cmd.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => void pick(cmd)}
                        className={
                          "w-full flex items-center gap-2 px-3 py-2 text-left text-sm " +
                          (active ? "bg-accent text-foreground" : "hover:bg-accent/60 text-foreground")
                        }
                      >
                        <span className="flex-1 truncate">{cmd.title}</span>
                        {cmd.shortcut && <kbd className="text-[10px] rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground">{cmd.shortcut}</kbd>}
                        {cmd.to && <span className="text-[10px] text-muted-foreground">{cmd.to}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground flex justify-between gap-2">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>Ctrl+Space or Ctrl+K anywhere</span>
        </div>
      </div>
    </div>
  );
}
