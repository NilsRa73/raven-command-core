# Raven One — Master Plan

Version: Alpha 0.1
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
- Storage: IndexedDB v2 (commands, memory, files, approvals) + localStorage
  for lightweight settings (devices, focus mode, engine).
- Native companion: `desktop-bridge-native/` (Tauri 2 + Node SEA sidecar).
- Bridge protocol: HTTPS/loopback, HMAC-signed, one-time approval tokens,
  Private Network Access, path containment, feature manifest.

## Module ownership

| Module              | Location                                     |
| ------------------- | -------------------------------------------- |
| Raven Home          | `src/routes/index.tsx`                       |
| Project DNA         | `src/routes/projects.$id.tsx`, `src/lib/rah/projectDna.js` |
| Device Center       | `src/routes/devices.tsx`, `src/lib/rah/devices.js` |
| Raven Chronicle     | `src/routes/chronicle.tsx`, `src/lib/rah/chronicle.js` |
| Voice Assistant     | `src/routes/voice.tsx`, `src/lib/rah/voiceAssistant.js` |
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
  `files.copy` (the honest bridge capability — no `files.rename` proxy);
  `bridge_launch_url` requires `https://`; `bridge_launch_app` uses
  `launch.program`. Executor asserts paired-online status and capability
  presence before any bridge call.
- Manual checkpoint pauses; Resume, Cancel, Retry-Failed-Step, Start-New-Run
  wired through the executor. Reload reconciles orphaned `running` runs to
  `paused`.
- Approvals extended with `workflowRunId` / `workflowStepId`;
  `resolveApproval` dispatches to the executor exactly once.
- `exportAll` includes `projectMemory`, `workflows`, and `workflowRuns`.

**Known limitations (not operational in this alpha):**
- The append-only local log is tamper-evident, **not** cryptographically
  signed. The local IndexedDB can still be replaced or wiped externally.
  UI copy has been updated to say "append-only, hash-chained, tamper-evident
  local log" everywhere.
- Bridge `writeFile` is implemented via `files.copy`. The bridge protocol
  does not yet expose an atomic `files.writeText`; that is planned but not
  in v0.2.1.
- Workflow autosaves-on-create for now (new workflow persists immediately
  with an empty AI-prompt step). Full draft-only-in-memory is deferred.
- Run Inspector is minimal (event log, cancel, verify chain). A richer
  inspector with per-step provider/latency drill-down is planned for 0.3.

## Design principles

1. Local-first. Nothing leaves the machine without a visible, revocable
   consent surface.
2. No silent saves. Memory, summaries, and briefs require an explicit click.
3. Honest telemetry. If a datum is not live, show `—` — never invent it.
4. Approvals are immutable. One-time tokens, no overrides.
5. Deterministic UI logic in pure `.js` modules; React only renders.
6. Visual identity: matte black, deep charcoal glass panels, restrained
   gold accents, subtle motion, strong contrast, generous spacing.

## Current sprint — Raven One Alpha 0.1

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
      total 225 passing).

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
      total 236 passing). `bunx tsgo --noEmit` clean.

- Device Center v0.2: role-based dashboards, hardware history charts.
- Chronicle v0.2: per-project chronicle views, weekly summary drafts.
- Project DNA v0.2: roadmap milestone drag-and-drop, decisions changelog.
- Raven Home v0.2: mission timer, "focus block" workflow, keyboard-first
  command palette.
- Native companion v0.3: auto-update via Tauri updater, signed installer.
- Voice v0.2: per-project voice profiles, wake-phrase tuning.

## Definition of done (per sprint)

1. All new UI backed by deterministic pure helpers in `src/lib/rah/*.js`.
2. Tests added or updated in `desktop-bridge/tests/`.
3. `bunx tsgo --noEmit` passes.
4. Production build passes (`npm run build` via harness).
5. No fabricated data, no silent memory writes, no bypassed approvals.
6. Bridge tests remain green.
