// Central RAH Raven Hub module registry.
// Single source of truth for the nav rail, modules page, and command palette.

export type ModuleStatus = "active" | "prototype" | "planned";
export type ModuleGroup = "core" | "environment" | "play" | "system";

export interface HubModule {
  id: string;
  name: string;
  /** Emoji or single character glyph; keeps the rail free of raster icons. */
  glyph: string;
  status: ModuleStatus;
  /** 0-100. */
  progress: number;
  to: string;
  group: ModuleGroup;
  description: string;
  keywords?: string[];
}

export const HUB_MODULES: HubModule[] = [
  { id: "command",   name: "Command",         glyph: "⌘",  status: "active",    progress: 92, to: "/",              group: "core",        description: "Central command bar, Mission Control, quick actions.",         keywords: ["home", "prompt", "ask"] },
  { id: "browser",   name: "Raven Browser",   glyph: "🜲",  status: "prototype", progress: 20, to: "/browser",       group: "play",        description: "Bookmarked research surface, agent hooks planned.",             keywords: ["web", "bookmarks"] },
  { id: "vision",    name: "Screen Vision",   glyph: "👁", status: "active",    progress: 82, to: "/vision",        group: "core",        description: "Consent-first screen capture, drag redaction, review vault.",    keywords: ["screen", "capture"] },
  { id: "memory",    name: "Project Memory",  glyph: "🜃",  status: "active",    progress: 80, to: "/memory",        group: "core",        description: "Persistent context that Raven injects into every prompt.",       keywords: ["notes", "context"] },
  { id: "council",   name: "AI Council",      glyph: "🜛",  status: "active",    progress: 74, to: "/council",       group: "core",        description: "Multi-role synthesis with governance approvals.",                keywords: ["agents"] },
  { id: "mesh",      name: "Home Mesh",       glyph: "🜄",  status: "prototype", progress: 34, to: "/home-mesh",     group: "environment", description: "Rooms and devices you control from Raven.",                     keywords: ["rooms", "devices"] },
  { id: "routines",  name: "Routine Mode",    glyph: "🜍",  status: "active",    progress: 70, to: "/routines",      group: "environment", description: "Scheduled routines and one-tap Run Now.",                        keywords: ["schedule", "timer"] },
  { id: "shopping",  name: "Shopping",        glyph: "🜚",  status: "active",    progress: 60, to: "/shopping",      group: "environment", description: "Curated research with quality score and shortlist.",             keywords: ["gear", "buy"] },
  { id: "studio",    name: "Studio",          glyph: "🜋",  status: "prototype", progress: 46, to: "/rethink",       group: "core",        description: "Raven Re-think transforms, article distillation.",              keywords: ["writing", "rewrite"] },
  { id: "retro",     name: "Retro / Games",   glyph: "🎲",  status: "prototype", progress: 18, to: "/retro",         group: "play",        description: "Local game scoreboard; RAH Gammon integration planned.",         keywords: ["games", "score"] },
  { id: "vr",        name: "VR Room",         glyph: "🥽",  status: "planned",   progress: 8,  to: "/vr",            group: "play",        description: "Quest 3 spatial workspace for Raven agents.",                    keywords: ["quest"] },
  { id: "health",    name: "Health Dashboard",glyph: "🫀",  status: "prototype", progress: 24, to: "/health",        group: "environment", description: "Manual metric log; wearables integration planned.",              keywords: ["metrics", "wellness"] },
  { id: "settings",  name: "Settings",        glyph: "⚙️", status: "active",    progress: 95, to: "/settings",      group: "system",      description: "Appearance, voice, privacy, execution preferences." },
];

export const HUB_GROUP_LABEL: Record<ModuleGroup, string> = {
  core: "Core",
  environment: "Environment",
  play: "Play",
  system: "System",
};

export function moduleById(id: string): HubModule | undefined {
  return HUB_MODULES.find((m) => m.id === id);
}

export function filterModules(query: string): HubModule[] {
  const q = query.trim().toLowerCase();
  if (!q) return HUB_MODULES.slice();
  return HUB_MODULES.filter((m) => {
    const hay = [m.name, m.description, m.group, ...(m.keywords ?? [])].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

const PIN_KEY = "rah.modules.pins";

export function loadPinnedModuleIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

export function togglePinnedModule(id: string): string[] {
  const cur = loadPinnedModuleIds();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
