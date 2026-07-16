## RAH Raven Hub 1.0 — Central Shell Milestone

Turn the existing Raven Command app into the RAH Raven Hub with a premium black/gold visual system, persistent module rail, and 5 new functional modules. All existing features preserved.

### Scope

**Preserve:** All existing routes (Home/Mission Control, Command Bar, Voice, Vision, Memory, Council, Devices, Chronicle, Projects, Approvals, Workflows, Backup, System Check, etc.), Bridge integration, Local AI, voice, vision, existing IndexedDB stores.

**Add / Change:**

1. **Visual System Refresh** (`src/styles.css`)
   - Push background to near-black (#050505 / #0A0A0A / #111111)
   - Tighten gold tokens (`--gold` #D4AF37, `--gold-antique` #B8860B)
   - Add subtle gold hairline borders, restrained glass surfaces
   - Warm off-white text tokens; remove any pale gray surfaces
   - Add Kråkeby alt theme (warm original cartoon skin, still polished)
   - Theme picker persists in localStorage (extend existing `prefs` theme system)

2. **Persistent Left Rail** (`src/components/rah/AppShell.tsx`)
   - Replace/augment current sidebar with an app rail listing the 13 Hub modules
   - Group: Core (Command, Home, Vision, Memory, Council, Studio), Environment (Home Mesh, Routines, Shopping, Health), Play (Browser, Retro, VR), System (Settings)
   - Collapsible; active-state gold rune indicator

3. **Module Registry** (`src/lib/rah/moduleRegistry.ts` + `src/routes/modules.tsx`)
   - Central typed registry (id, name, icon, status: active|prototype|planned, progress, route, tags, description)
   - Registry page: cards, filter/search, pin favorites (localStorage `rah.modules.pins`), status badges, progress bar, Open button
   - Rail and Command Palette read from this registry

4. **Home / Overview Dashboard** (extend `src/routes/index.tsx`)
   - Keep Mission Control content but wrap in new Hub overview: Raven status tile, active agents, connected devices, routines due today, recent projects, memory vault status, quick commands, system activity
   - Pull real data from existing stores (bridgeStatus, agents, devices, projectMemory, chronicle, sessions) + new routines store
   - Editable quick commands persisted to localStorage

5. **Routine Mode** (`src/lib/rah/routines.ts` + `src/routes/routines.tsx`)
   - CRUD: id, name, time (HH:MM), days[], room, deviceId, action, requireConfirmation, enabled
   - localStorage persistence, seed examples (Runtime Funtime 17:00, News Reframe 19:00, Raven sleep)
   - "Run Now" with confirmation modal for `requireConfirmation`
   - "Due today" derivation used by Home
   - Basic in-tab scheduler that logs to Chronicle when a routine fires (no background workers)

6. **Raven Workstream** (`src/routes/workstream.tsx` + panel component)
   - Curated execution log: goal, current step, completed steps, files/events, agent activity, errors
   - Reads from existing orchestrator runs, workflow executor events, audit log
   - Full-screen presentation mode (Fullscreen API), calm gold pulse, mute-by-default sound toggle

7. **Shopping** (`src/lib/rah/shopping.ts` + `src/routes/shopping.tsx`)
   - Luxury card grid with local demo products (10-12 seeded items with realistic RAH-flavored gear)
   - Fields: name, image (placeholder gradient), quality score, review summary, landed cost, compatibility, risk flags, supplier/origin
   - Shortlist (localStorage `rah.shopping.shortlist`)
   - Comparison drawer for 2–4 products (side-by-side)
   - "View in Room" placeholder button (opens toast: "Room preview coming in VR module")
   - Transparency banner: nothing purchased automatically

8. **Placeholder-but-real routes** for Browser, Home Mesh, Retro/Games, VR, Health Dashboard
   - Each is a real routed page with a themed hero, status ("Prototype"/"Planned"), a real functional element (Health: manual metric log persisted to localStorage; Home Mesh: manual room+device list persisted; Browser: bookmark list persisted; Retro: local score log; VR: connection checklist)
   - Not dead — small but useful local functionality so no fake buttons

9. **Global Command Palette** (extend existing `CommandPalette.tsx`)
   - Ensure Ctrl/Cmd+K opens (already works); add: modules registry entries, routines, quick actions (Open Routine Mode, Start Workstream Fullscreen, Toggle Theme, Add Routine)

10. **Quality gates**
    - Update tests where needed; add `routines.test.js` and `shopping.test.js` and `module-registry.test.js`
    - Typecheck + production build; fix errors
    - No white surfaces anywhere; audit `bg-white`, `bg-gray-*`, `text-black` usages and replace with tokens

### Technical Details

- No new deps; use existing shadcn/ui, tanstack router, IndexedDB via existing db.ts is not extended (routines/shopping/modules use localStorage per spec)
- Route files use flat dot naming: `routines.tsx`, `shopping.tsx`, `workstream.tsx`, `modules.tsx`, `browser.tsx`, `home-mesh.tsx`, `retro.tsx`, `vr.tsx`, `health.tsx`
- Rail data source = moduleRegistry; single source of truth
- Theme skins: `raven-gold` (default), `kraakeby` — applied as class on `<html>` alongside existing dark/hc classes; extend `styles.css` with `.kraakeby` variant tokens
- Confirmation modals reuse existing shadcn AlertDialog
- All new components typed TS; small focused files under 200 LOC where possible

### Out of scope (explicit)

- No database, auth, payments, external APIs
- No real e-commerce transactions
- No background service workers for routines (in-tab scheduler only, chronicled)
- No new bridge endpoints or bridge version bump

### Deliverable

Coherent Hub milestone: black/gold shell, 13 addressable modules, functional Routine Mode + Shopping + Workstream + Registry, revamped Home overview, extended Command Palette, Kråkeby alt theme. All existing features intact, tests + build green.
