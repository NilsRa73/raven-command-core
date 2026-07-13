// Global Command Palette — deterministic command list + fuzzy filter.
// Pure logic so Node tests can exercise ranking without React or DOM.

/**
 * A palette command may either navigate (path) or invoke an action key
 * that the host component handles (e.g. "focus_command_bar").
 * @typedef {{
 *   id: string, title: string, hint?: string, section: string,
 *   keywords?: string[], to?: string, action?: string, shortcut?: string,
 * }} PaletteCommand
 */

/** The static command catalog. Kept small and honest — no hidden actions. */
export const PALETTE_COMMANDS = /** @type {PaletteCommand[]} */ ([
  // Navigation
  { id: "nav:home",         section: "Navigate", title: "Raven Home",        to: "/",            keywords: ["dashboard", "welcome"] },
  { id: "nav:projects",     section: "Navigate", title: "Projects",          to: "/projects" },
  { id: "nav:devices",      section: "Navigate", title: "Device Center",     to: "/devices",     keywords: ["cluster", "bridge", "hardware"] },
  { id: "nav:agents",       section: "Navigate", title: "Agent Team",        to: "/agents",      keywords: ["council", "team"] },
  { id: "nav:voice",        section: "Navigate", title: "Voice Assistant",   to: "/voice",       keywords: ["speech", "listen"] },
  { id: "nav:vision",       section: "Navigate", title: "Screen Vision",     to: "/vision",      keywords: ["screen", "share"] },
  { id: "nav:memory",       section: "Navigate", title: "Project Memory",    to: "/memory" },
  { id: "nav:chronicle",    section: "Navigate", title: "Raven Chronicle",   to: "/chronicle",   keywords: ["timeline", "history"] },
  { id: "nav:history",      section: "Navigate", title: "Command History",   to: "/history" },
  { id: "nav:approvals",    section: "Navigate", title: "Approvals",         to: "/approvals" },
  { id: "nav:files",        section: "Navigate", title: "Files & Knowledge", to: "/files" },
  { id: "nav:automations",  section: "Navigate", title: "Automations",       to: "/automations" },
  { id: "nav:connections",  section: "Navigate", title: "Connections",       to: "/connections", keywords: ["bridge", "pair"] },
  { id: "nav:privacy",      section: "Navigate", title: "Privacy",           to: "/privacy" },
  { id: "nav:settings",     section: "Navigate", title: "Settings",          to: "/settings" },

  // Actions
  { id: "act:focus_command_bar",  section: "Actions", title: "Focus Command Bar",       action: "focus_command_bar",  shortcut: "Ctrl+Alt+R", keywords: ["prompt", "ask", "run"] },
  { id: "act:continue_project",   section: "Actions", title: "Continue active project", action: "continue_project",   keywords: ["resume", "today", "welcome"] },
  { id: "act:emergency_stop",     section: "Actions", title: "Emergency stop",          action: "emergency_stop",     shortcut: "Alt+Shift+X" },
  { id: "act:test_bridge",        section: "Actions", title: "Test Desktop Bridge",     action: "test_bridge" },
  { id: "act:toggle_focus_mode",  section: "Actions", title: "Toggle Focus mode",       action: "toggle_focus_mode" },
]);

/** Rank commands against a query. Higher score = better match. */
function scoreCommand(cmd, query) {
  const q = query.trim().toLowerCase();
  if (!q) return 1; // include everything
  const hay = [cmd.title, cmd.section, cmd.hint ?? "", ...(cmd.keywords ?? [])].join(" ").toLowerCase();
  if (!hay.includes(q[0])) {
    // Try loose fuzzy: all chars appear in order
    let i = 0;
    for (const ch of hay) { if (ch === q[i]) i++; if (i >= q.length) break; }
    return i >= q.length ? 1 : 0;
  }
  let score = 0;
  if (cmd.title.toLowerCase() === q) score += 100;
  if (cmd.title.toLowerCase().startsWith(q)) score += 50;
  if (cmd.title.toLowerCase().includes(q)) score += 20;
  if ((cmd.keywords ?? []).some((k) => k.toLowerCase().includes(q))) score += 10;
  if (cmd.section.toLowerCase().includes(q)) score += 3;
  return score;
}

/**
 * Filter+rank the palette commands for a given query. Ties broken by
 * original order (stable sort).
 * @param {string} query
 * @param {PaletteCommand[]} [list]
 */
export function filterPaletteCommands(query, list) {
  const src = list ?? PALETTE_COMMANDS;
  const scored = src.map((c, i) => ({ c, s: scoreCommand(c, query), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i));
  return scored.map((x) => x.c);
}

/** Group results by section, preserving the order returned by filter. */
export function groupBySection(commands) {
  const groups = new Map();
  for (const c of commands) {
    if (!groups.has(c.section)) groups.set(c.section, []);
    groups.get(c.section).push(c);
  }
  return [...groups.entries()].map(([section, items]) => ({ section, items }));
}

/** Detect whether a query should be offered as "Send as prompt". */
export function isFreeformPrompt(query) {
  const q = String(query ?? "").trim();
  if (!q) return false;
  if (q.startsWith(">")) return true;
  if (q.length < 4) return false;
  return filterPaletteCommands(q).length === 0;
}
