# Raven One — Master Plan

Version: Raven One · Alpha 0.2 — Workflow Engine + Fast/Deep hardening + Raven Home v0.2 + Voice v0.2
Owner: Nils (RAH AI Studios)
Status: Living document — single source of truth for the Raven One product line.

## Mission

Give Nils a calm, local-first, daily-driver AI workspace that resumes
context automatically, respects consent, and never fabricates activity,
progress, or telemetry.

## Architecture

- Web app: TanStack Start v1 (React 19 + Vite 7).
- Local AI: LM Studio / Ollama on the user's PC, proxied through the
  authenticated RAH Desktop Bridge (v0.2.1) at `127.0.0.1:47824`.
- Cloud AI: Lovable AI Gateway as a manual fallback.
- Storage: IndexedDB v7 with stores for commands, memory, files, approvals,
  workflows, workflowRuns, deviceHistory, roadmapMilestones, decisions,
  decisionVersions, focusSessions, voiceProfiles, voiceSessions, and
  voiceTranscripts; plus localStorage for lightweight settings (devices,
  focus mode, engine).
- Native companion: `desktop-bridge-native/` (Tauri 2 + Node SEA sidecar).
- Bridge protocol: HTTPS/loopback, HMAC-signed, one-time approval tokens,
  Private Network Access, path containment, feature manifest.

## Module ownership

| Module              | Location                                     |
| ------------------- | -------------------------------------------- |
| Raven Home          | `src/routes/index.tsx`                       |
| Project DNA         | `src/routes/projects.$id.tsx`, `src/lib/rah/projectDna.js` |
| Device Center       | `src/routes/devices.tsx`, `src/lib/rah/devices.js`, `src/lib/rah/deviceRolesV2.js`, `src/lib/rah/deviceHistory.js`, `src/lib/rah/deviceHistoryDb.ts` |
| Raven Chronicle     | `src/routes/chronicle.tsx`, `src/lib/rah/chronicle.js` |
| Voice Assistant     | `src/routes/voice.tsx`, `src/routes/voice-profiles.tsx`, `src/lib/rah/voiceAssistant.js`, `src/lib/rah/voiceProfiles.js` |
| Screen Vision       | `src/routes/vision.tsx`, `src/lib/rah/screenVision.js` |
| Project Memory      | `src/routes/memory.tsx`, `src/lib/rah/projectMemory.js` |
| AI Council / Agents | `src/routes/agents.tsx`, `src/lib/rah/orchestrator.js` |
| Workflow Engine     | `src/routes/automations.tsx`, `src/lib/rah/workflow.js`, `src/lib/rah/workflowExecutor.js` |
| Bridge client       | `src/lib/rah/bridge.ts`, `src/lib/rah/bridgeStatus.ts` |
| Bridge server       | `desktop-bridge/src/`                        |
| Native supervisor   | `desktop-bridge-native/src-tauri/src/`       |

## Alpha 0.2 — Workflow Engine

**Operational (verified by tests):**
- Deterministic state machine and hash-chained event log (SHA-256 chained;
  test-deterministic when `now`/`rng` are injected).
- Dependency-injected `workflowExecutor` running steps sequentially with
  per-step approval gating, exactly-once resume, and AbortController-based
  cancel/emergency stop.
- AI steps route through the existing `streamChat` path (real provider /
  model / transport / latency captured).
- `save_memory` writes to Project Memory; `chronicle_entry` writes a
  `daily_log`-typed memory. Both only after per-step approval.
- `bridge_read_file` uses `files.readText`; `bridge_write_file` uses
  `files.copy` and is surfaced in the UI as **Copy File (Bridge)** with
  explicit Source and Destination fields; validation rejects missing or
  identical source/dest (backward-compatible: legacy `path` is interpreted as
  the destination `dest` when `dest` is absent; a distinct `source` is still
  mandatory);
  `bridge_launch_url` requires `https://`; `bridge_launch_app` uses
  `launch.program`. Executor asserts paired-online status and capability
  presence before any bridge call.
- Manual checkpoint pauses; Resume, Cancel, Retry-Failed-Step, Start-New-Run
  wired through the executor. Reload reconciles orphaned `running` runs to
  `paused`. **Emergency Stop** cancels every non-terminal run — `draft`,
  `queued`, `awaiting_approval`, `paused`, and `running` — through a single
  executor code path with an explicit `emergency_stop` reason and exactly-
  once terminal cancellation events.
- Approvals extended with `workflowRunId` / `workflowStepId`;
  `resolveApproval` dispatches to the executor exactly once.
- `exportAll` includes `projectMemory`, `workflows`, and `workflowRuns`.

## Alpha 0.2 — Fast/Deep + Hardening (complete)

- Fast/Deep mode with deterministic packet builder in `ravenMode.js`.
  Fast Mode is bounded, not empty: it always includes pinned + task-scoped
  memories plus a small cap of recent, high-scoring supporting memories
  (default cap 2, min relevance 30) so short answers still have context.
- Every AI step (chat + workflow) receives the exact packet used at run
  time. The returned `packet` object carries `mode`, `selectedIds`,
  `estimatedTokens`, `generatedAt`, `packetHash` (SHA-256 via `sha256HexSync`)
  and `parityId`; the hash is a parity/identity check over the exact packet
  text, while the event chain uses WebCrypto SHA-256; workflow step results persist those metadata without duplicating memory
  contents.
- Workflow AI context prepends real project name + goals when the run has
  a `projectId`.
- `planDryRun` fails **closed** on missing / unknown / empty bridge
  capability manifests; an empty array is never treated as permission.
  Automations pulls capabilities from the authenticated `/v1/capabilities`
  and filters to enabled entries.
- Automations: New Workflow is a true in-memory draft (nothing hits
  IndexedDB until Save); dirty drafts guard route navigation (TanStack
  `useBlocker`), sidebar switching, import, and hard reload
  (`beforeunload`).
- Run Inspector: full expandable outputs / errors, approval refs,
  route/provider/model/transport/engine, timestamps + elapsed duration,
  current step + %, full event metadata, Verify Chain, and Export Run JSON.
- Context Packet Preview surfaces the exact packet that will be sent to
  the AI before running.

**Known limitations (still true after this batch):**
- The append-only local log is tamper-evident, **not** cryptographically
  signed. The local IndexedDB can still be replaced or wiped externally.
  UI copy consistently says "append-only, hash-chained, tamper-evident
  local log".
- The bridge exposes `files.copy`, not `files.writeText`. That is why the
  workflow step is labelled Copy File; arbitrary text writes are
  intentionally unavailable, not silently emulated.
- Native companion auto-update / signed installer are still planned, not
  shipped.

## Design principles

1. Local-first. Nothing leaves the machine without a visible, revocable
   consent surface.
2. No silent saves. Memory, summaries, and briefs require an explicit click.
3. Honest telemetry. If a datum is not live, show `—` — never invent it.
4. Approvals are immutable. One-time tokens, no overrides.
5. Deterministic UI logic in pure `.js` modules; React only renders.
6. Visual identity: matte black, deep charcoal glass panels, restrained
   gold accents, subtle motion, strong contrast, generous spacing.

## Current sprint — Raven One Alpha 0.2 hardening

- [x] Raven Home as landing page with mission, status, devices, chronicle
      preview, agent team, quick actions, readiness score.
- [x] Project DNA tabs: Overview, Goals, Decisions, Timeline, Roadmap,
      Assets, Memory, Open Issues + Continue Project.
- [x] Device Center v0.1 with live bridge device + manual planned devices.
- [x] Raven Chronicle with day grouping, filter, MD/JSON export, explicit
      "Save today's summary" workflow.
- [x] Raven One · Alpha 0.1 branding badge.
- [x] Test coverage for tabs, devices, chronicle, mission control.

## Backlog

## Sprint 2 — In progress

- [x] Raven Morning: dynamic greeting phase, Welcome Back card with
      current / next / blocker / ETA fields sourced from the active project
      (falls back to memory). Deterministic in `src/lib/rah/morning.js`.
- [x] Global Command Palette (`Ctrl+Space` or `Ctrl/Cmd+K`) with
      navigation, actions, and freeform `> prompt` handoff to the Command
      Bar. Pure catalog + fuzzy filter in `src/lib/rah/commandPalette.js`.
- [x] Project DNA task tracking: `currentTask`, `nextTask`, `blocker`,
      `estimatedCompletionAt` on `Project`, edited in Goals tab with
      explicit Save (no silent writes).
- [x] Device Center Cluster overview: counts by status and role,
      foundation for multi-device Raven. Planned nodes stay honestly
      labelled Planned / Offline.
- [x] Tests: `morning.test.js`, `command-palette.test.js` (10 new tests,
      total 225 passing at that milestone).

## Alpha 0.2 — Workflow Engine (shipped)

- [x] Deterministic core in `src/lib/rah/workflow.js`: step catalog, Fast/Deep
      execution profiles, run state machine (draft → queued → awaiting_approval
      → running → paused → completed/failed/cancelled) with validated
      transitions, dry-run planner that flags blocked bridge steps, and
      Fast/Deep context selector.
- [x] Hash-chained event log (SHA-256, prevHash + payload) with
      `appendEvent` and `verifyEventChain`; tamper-evident and locally
      verifiable — never described as cryptographic signing.
- [x] IndexedDB v3 migration adds `workflows` and `workflowRuns` stores.
- [x] `src/routes/automations.tsx` rewritten as Workflow Builder + Execution
      Center: explicit Save, Dry Run, Run, Cancel, Import/Export,
      side-effecting workflows gated by one-shot `requestApproval`, run log
      viewer with chain verification.
- [x] Tests: `desktop-bridge/tests/workflow.test.js` (11 new tests,
      total 236 passing at that milestone). `bunx tsgo --noEmit` clean.

## Alpha 0.2 hardening — Workflow Engine + Fast/Deep (complete)

- [x] `bridge_write_file` is exposed as **Copy File (Bridge)** with explicit
      Source and Destination inputs; validation requires both and rejects
      identical source/dest. Backward-safe: legacy `path` is interpreted as the
      destination `dest` when `dest` is absent, but a distinct `source` is
      mandatory. Implemented via bridge `files.copy` — arbitrary write-text
      is not supported and is not silently emulated.
- [x] Emergency Stop cancels every non-terminal run — `draft`, `queued`,
      `awaiting_approval`, `paused`, `running` — through one executor code
      path with an explicit `emergency_stop` reason and exactly-once
      terminal cancellation events.
- [x] Fast Mode is bounded, not empty: pinned + task-scoped memories plus a
      small cap of recent high-scoring Supporting memories
      (`fastSupportingCap = 2`, `fastSupportingMinScore = 30`).
- [x] Fast/Deep context packet parity: executor and chat consume the exact
      object returned by `buildContextPacket`; workflow step results persist
      `mode`, `selectedIds`, `estimatedTokens`, `generatedAt`, `packetHash`
      (SHA-256 via `sha256HexSync`) and `parityId` — no duplicated memory
      content; the hash is a parity/identity check over the exact packet text,
      while the event chain uses WebCrypto SHA-256.
- [x] `planDryRun` fails **closed** on missing / unknown / empty bridge
      capability manifests; Automations feeds it the authenticated
      `/v1/capabilities` manifest filtered to enabled entries.
- [x] Unsaved-navigation guard extracted to
      `src/lib/rah/draftGuard.js#shouldConfirmDiscard` and used by
      Automations for create, sidebar select, import, and route/unload
      navigation (TanStack `useBlocker` + `beforeunload`). New workflows
      live only in memory until explicit Save.
- [x] Run Inspector: full expandable step outputs and errors, approval
      references and status, route/provider/model/transport/engine,
      created/started/finished timestamps and elapsed duration, current
      step and % progress, full event metadata, Verify Chain, Export Run
      JSON, and Context Packet Preview before Run.
- [x] Tests: `hardening-batch.test.js`, `copy-file-and-fast-supporting.test.js`,
      and `draft-guard.test.js` added.

## Device Center v0.2 — Role dashboards + hardware history (complete)

- [x] New pure helpers in `src/lib/rah/deviceRolesV2.js` (role definitions,
      legacy mapping, grouping, per-role summaries, capability coverage) and
      `src/lib/rah/deviceHistory.js` (snapshot capture from live bridge
      health/system status, range filtering, gap detection, sparkline
      normalization, JSON import validation + merge). All deterministic —
      React components render helper output only.
- [x] Seven v2 roles: **Command Node**, **AI Compute Node**, **Display / VR
      Node**, **Storage Node**, **Bridge / Automation Node**, **Planned
      Device**, and **Unassigned**. Legacy manual roles (`ai_core`,
      `development`, `media`, `vr`, `pocket`, `other`) map safely into v2
      buckets; unknown roles land in **Unassigned** — never guessed.
- [x] Role dashboard on `/devices` shows live / offline / planned / unknown
      counts, capability coverage, last-seen, and blocker chips. Missing
      telemetry renders as "—"; no CPU/GPU/RAM/network values are ever
      fabricated. Empty roles remain visible but muted.
- [x] Local-first hardware history in IndexedDB v4 (`deviceHistory` store,
      keyed by snapshot id, indexed by `deviceId` and `capturedAt`). Only
      real snapshots are stored; disk/network fields are `null` today
      because the Bridge does not report them yet.
- [x] Explicit **Capture live snapshot** action in the device drawer,
      disabled with an honest reason when the Bridge cannot supply
      telemetry (`captureDisabledReason`). No silent polling.
- [x] Device drawer detail view: role (v2 label), status, source label
      (**Bridge / Manual / Planned**), latest real snapshot, selectable
      range (24h / 7d / 30d / all), and simple accessible SVG sparklines
      for CPU load and RAM used.
- [x] Import / export device history as JSON (`raven-device-history/v1`).
      Import validates every row, filters to the current device, and asks
      the user (OK = replace, Cancel = skip) before overwriting entries
      with the same id. No silent overwrite.
- [x] IndexedDB upgraded from v3 → v4 with an additive `deviceHistory`
      store; all prior user data preserved. `exportAll` and `wipeAll`
      include the new store.
- [x] Tests: `device-roles-v2.test.js` (7 cases) and
      `device-history.test.js` (9 cases) added, covering role mapping,
      dashboard summaries, capability coverage, range filtering, gap
      detection, sparkline null-skip, import validation + merge modes,
      and fail-closed capture behaviour. Existing `devices.test.js`
      remains green — no regressions.
- [x] Verified: **309/309 bridge tests pass**, `bunx tsgo --noEmit` clean,
      `bun run build` succeeds.

**Known limitations (honest):** Disk (storage) and per-interface network
telemetry are not yet supplied by the Bridge, so the history stores those
fields as `null` and the UI renders "—". Live capture is only available
for the paired Bridge device; manual/planned nodes accept imported
snapshots but cannot be captured from Raven itself. Sparklines are simple
time-normalized SVG lines, not full charts. No cross-device aggregation
charts yet — role dashboard shows counts only.

- Chronicle v0.2: per-project chronicle views, weekly summary drafts.
- Raven Home v0.2: mission timer, "focus block" workflow, keyboard-first
  command palette.
- Native companion v0.3: auto-update via Tauri updater, signed installer.
- Voice v0.2: per-project voice profiles, wake-phrase tuning.

## Project DNA v0.2 — Roadmap DnD + Decisions changelog (shipped)

- Deterministic pure helpers under `src/lib/rah/roadmap.js` and
  `src/lib/rah/decisions.js`. React renders helper results; no business
  logic in components.
- Roadmap columns: **Backlog, Planned, In Progress, Blocked, Done**, plus
  **Unassigned** for unknown legacy statuses (never guessed).
- Drag-and-drop across and within columns, with keyboard-accessible Move
  Up/Down and Move-to-column selector as full fallback. DnD updates an
  in-memory draft only; nothing persists until explicit **Save roadmap**.
- Discard confirmation via `shouldConfirmDiscard`; Reset-to-saved is
  explicit. Validation blocks Save on empty title, invalid date, duplicate
  id, self dependency, circular dependency, missing dependency, or
  invalid status.
- Milestone fields: title, description, status, priority, target date,
  owner, dependencies, evidence ids, order, created/updated timestamps.
  Missing values render as "—"; nothing fabricated.
- Decisions are immutable-versioned: each edit creates a new
  `decisionVersion` with monotonically increasing `versionNumber`. Prior
  versions are preserved forever. Version timeline with deterministic
  field-level diff between any two selected versions.
- Duplicate-decision detection surfaces a warning based on normalized
  title/content Jaccard similarity; save requires explicit acknowledgment.
  Never auto-merges.
- Archive is preferred over delete; archive preserves audit history.
  Supersede / reverse links between decisions are explicit.
- Markdown and JSON export for both roadmap and decisions changelog,
  including project id/name, timestamps, ordering/status, full version
  history, evidence ids.
- Storage: **IndexedDB v5** adds `roadmapMilestones`, `decisions`, and
  `decisionVersions` stores with `by-project` / `by-decision` indexes.
- Tests: `desktop-bridge/tests/roadmap.test.js` and
  `desktop-bridge/tests/decisions.test.js` cover status normalization,
  grouping, cross-column move/reorder, keyboard reorder, validation
  (including circular dependencies), draft dirty detection, immutable
  version creation, field diffs, supersede/reverse linkage, duplicate
  warnings, and export metadata.
- Verified: **346/346 bridge tests pass**, `bunx tsgo --noEmit` clean,
  production build passes.

## Definition of done (per sprint)

1. All new UI backed by deterministic pure helpers in `src/lib/rah/*.js`.
2. Tests added or updated in `desktop-bridge/tests/`.
3. `bunx tsgo --noEmit` passes.
4. Production build passes (`npm run build` via harness).
5. No fabricated data, no silent memory writes, no bypassed approvals.
6. Bridge tests remain green.

## Raven Home v0.2 — Mission timer + Focus Block workflow (complete)

- [x] Deterministic pure helper `src/lib/rah/focusSession.js` (+ `.d.ts`)
      owns every timer transition: `newFocusDraft`, `start`, `pause`,
      `resume`, `complete`, `cancel`, `reset`, `logInterruption`,
      `computeTiming`, `restoreAfterReload`, `formatDuration`,
      `buildCompletionDraft`, `filterHistory`, `shapeHistoryForExport`.
      React renders helper output only.
- [x] `FocusSession` shape carries id, projectId, title, mode
      (`fast`/`deep`), `plannedDurationMs` (null = count-up), `startedAt` /
      `pausedAt` / `completedAt` / `cancelledAt`, `accumulatedPausedMs`,
      ordered `interruptions[]`, notes, agents, and `linkedWorkflowId` /
      `linkedRunId` slots for future workflow handoff.
- [x] Elapsed / remaining computed honestly; overdue is surfaced explicitly.
      Backwards or missing clocks return `status: "invalid"` with a warning —
      the UI never fabricates ticks. `restoreAfterReload` folds a live
      session back into `paused` when the wall clock is inconsistent.
- [x] IndexedDB upgraded v5 → v6 with an additive `focusSessions` store
      keyed by id and indexed by `projectId`, `createdAt`, `status`.
      `exportAll` and `wipeAll` include the new store.
- [x] `FocusBlockCard` on Raven Home (`src/components/rah/FocusBlockCard.tsx`)
      renders three explicit states: **Builder** (title, duration preset,
      Fast/Deep mode, notes; Discard guarded by
      `draftGuard.shouldConfirmDiscard`), **Live timer** (large tabular
      elapsed + remaining/overdue, Pause/Resume, Log interruption,
      Complete, Cancel), and **Completion review** (elapsed, interruptions,
      notes, explicit **Save to Chronicle / Memory** or **Discard note**).
      No silent saves — the session is persisted, the Chronicle entry is
      only added on click.
- [x] Keyboard-first: `Alt+F` start, `Alt+P` pause/resume, `Alt+I` log
      interruption, `Alt+Enter` complete, `Alt+Shift+X` emergency stop,
      `Ctrl+Space` / `Ctrl+K` palette, `?` opens the new
      `ShortcutHelpOverlay`. All Alt-based shortcuts are suppressed while
      typing (`shouldSuppressShortcut`) so form fields work normally.
- [x] `commandPalette.js` gains a Focus section with the same actions,
      and `CommandPalette.tsx` routes them to window events
      (`rah:focus:start` / `pause` / `complete` / `cancel` / `interrupt`)
      that the card subscribes to.
- [x] Header badge updated to **Raven Home · Alpha 0.2**.
- [x] Tests: `desktop-bridge/tests/focus-session.test.js` (17 cases)
      cover dirty detection, start/pause/resume math, backward-clock
      invalidation, completion pause-fold, cancel symmetry, reset,
      interruption ordering, restore, duration formatting, completion
      draft, history filtering, export manifest, ranking, and shortcut
      suppression.
- [x] Verified: **363/363 bridge tests pass**, `bunx tsgo --noEmit`
      clean, `bun run build` succeeds.

**Known limitations (honest):** the timer relies on `Date.now()` — clock
skew between save and restore is detected but not corrected. Focus
history is per-device (IndexedDB); cross-device sync is not implemented.
Completion → Chronicle is a single memory entry per session, not a
per-interruption timeline.
