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
| Bridge client       | `src/lib/rah/bridge.ts`, `src/lib/rah/bridgeStatus.ts` |
| Bridge server       | `desktop-bridge/src/`                        |
| Native supervisor   | `desktop-bridge-native/src-tauri/src/`       |

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
