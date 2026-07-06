import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useRah } from "./context";

export function useGlobalShortcuts() {
  const { prefs, focusCommandBar, emergencyStop } = useRah();
  const router = useRouter();
  useEffect(() => {
    if (!prefs.shortcutsEnabled) return;
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); focusCommandBar(); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); router.navigate({ to: "/vision" }); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); router.navigate({ to: "/approvals" }); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); router.navigate({ to: "/memory" }); return; }
      if (e.key === "Escape") window.dispatchEvent(new CustomEvent("rah:cancel"));
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "x") { e.preventDefault(); void emergencyStop(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prefs.shortcutsEnabled, focusCommandBar, router, emergencyStop]);
}