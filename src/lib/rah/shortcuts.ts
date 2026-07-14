import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useRah } from "./context";
import { shouldSuppressShortcut } from "./focusSession";

export function useGlobalShortcuts() {
  const { prefs, focusCommandBar, emergencyStop } = useRah();
  const router = useRouter();
  useEffect(() => {
    if (!prefs.shortcutsEnabled) return;
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      // Suppress single-key/Alt shortcuts while typing so text fields work
      // as expected. Ctrl/Meta chords + Escape always pass through.
      const suppress = shouldSuppressShortcut(e.target as EventTarget | null, {
        key: e.key, escapeAllowed: true,
      });
      const chord = meta || e.key === "Escape";
      if (suppress && !chord) return;
      // Global Command Palette: Ctrl+Space or Ctrl/Cmd+K
      if ((meta && e.key.toLowerCase() === "k") || (e.ctrlKey && e.code === "Space")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("rah:command-palette-toggle"));
        return;
      }
      if (meta && e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); focusCommandBar(); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); router.navigate({ to: "/vision" }); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); router.navigate({ to: "/approvals" }); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); router.navigate({ to: "/memory" }); return; }
      if (e.key === "Escape") window.dispatchEvent(new CustomEvent("rah:cancel"));
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "x") { e.preventDefault(); void emergencyStop(); }
      // Focus block shortcuts (Alt-based; suppressed inside inputs).
      if (e.altKey && !e.shiftKey && !meta) {
        const k = e.key.toLowerCase();
        if (k === "f")         { e.preventDefault(); window.dispatchEvent(new CustomEvent("rah:focus:start")); return; }
        if (k === "p")         { e.preventDefault(); window.dispatchEvent(new CustomEvent("rah:focus:pause")); return; }
        if (k === "i")         { e.preventDefault(); window.dispatchEvent(new CustomEvent("rah:focus:interrupt")); return; }
        if (e.key === "Enter") { e.preventDefault(); window.dispatchEvent(new CustomEvent("rah:focus:complete")); return; }
      }
      // Keyboard help overlay: `?` when not in a text field.
      if (!chord && !suppress && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("rah:shortcut-help-toggle"));
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prefs.shortcutsEnabled, focusCommandBar, router, emergencyStop]);
}