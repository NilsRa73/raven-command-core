import { useGlobalShortcuts } from "@/lib/rah/shortcuts";
export function GlobalShortcutsMount() {
  useGlobalShortcuts();
  return null;
}