// Deterministic pointer + keyboard reducer for the Screen Vision v0.3
// drag-to-redact overlay. Pure functions only — no DOM, no React. The
// overlay component owns pointer events, but all state transitions and
// coordinate math flow through this reducer so behaviour is unit-testable.
//
// All persisted coordinates live in SOURCE-IMAGE pixel space; the reducer
// composes `visionGeometry` helpers (transform, drag normalization, hit
// tests, history) to translate display-space input.
//
// Actions:
//   { type: "pointer-down", point (display), transform, frame, modifiers }
//   { type: "pointer-move", point (display), transform, frame }
//   { type: "pointer-up",   point (display), transform, frame }
//   { type: "pointer-cancel" }
//   { type: "key",          key, shift, frame }
//   { type: "select",       id | null }
//   { type: "remove",       id }
//   { type: "clear-all" }
//   { type: "relabel",      id, label }
//   { type: "undo" } | { type: "redo" }
//   { type: "set-regions",  regions }   // e.g. numeric fallback commit
//
// State:
//   { regions, selectedId, history, mode: "idle"|"drawing"|"moving"|"resizing", drag, dirty }

import {
  createHistory, historyPresent, historyPush, historyUndo, historyRedo,
  canUndo as canUndoH, canRedo as canRedoH,
  normalizeDrag, hitTestHandle, moveRegion, resizeRegion,
  clampRegionToFrame, createRegion, sortRegionsStable, displayToImage,
  regionsAreDirty, MIN_REGION_EDGE,
} from "./visionGeometry.js";

export const KEY_NUDGE_STEP = 1;   // source-image pixels per arrow tap
export const KEY_NUDGE_LARGE = 10; // pixels when Shift is held (without a handle)

export function createPointerState(initialRegions = []) {
  const regions = sortRegionsStable(initialRegions);
  return {
    regions,
    selectedId: null,
    history: createHistory(regions),
    mode: "idle",
    drag: null,   // { originImage, currentImage, handle?, id?, startRegion? }
    dirty: false,
  };
}

function withRegions(state, nextRegions, { pushHistory = true } = {}) {
  const sorted = sortRegionsStable(nextRegions);
  const cur = state.regions;
  const changed = regionsAreDirty(cur, sorted);
  const history = pushHistory && changed ? historyPush(state.history, sorted) : state.history;
  return {
    ...state,
    regions: sorted,
    history,
    dirty: state.dirty || changed,
  };
}

function selectedRegion(state) {
  if (!state.selectedId) return null;
  return state.regions.find((r) => r.id === state.selectedId) || null;
}

export function reducePointer(state, action) {
  if (!state || !action || !action.type) return state;
  switch (action.type) {
    case "pointer-down": {
      const { point, transform, frame, modifiers } = action;
      if (!transform || !frame || !point) return state;
      // Handle hit test against currently selected region first (so drag on
      // its handles resizes rather than starting a new draw).
      const sel = selectedRegion(state);
      if (sel) {
        const hit = hitTestHandle(sel, transform, point);
        if (hit && hit !== "body") {
          const startImage = displayToImage(transform, point);
          return {
            ...state,
            mode: "resizing",
            drag: { originImage: startImage, currentImage: startImage, handle: hit, id: sel.id, startRegion: sel },
          };
        }
        if (hit === "body") {
          const startImage = displayToImage(transform, point);
          return {
            ...state,
            mode: "moving",
            drag: { originImage: startImage, currentImage: startImage, id: sel.id, startRegion: sel },
          };
        }
      }
      // Otherwise: check body-hit on any region for selection.
      for (let i = state.regions.length - 1; i >= 0; i--) {
        const r = state.regions[i];
        const hit = hitTestHandle(r, transform, point);
        if (hit === "body") {
          const startImage = displayToImage(transform, point);
          return {
            ...state,
            selectedId: r.id,
            mode: "moving",
            drag: { originImage: startImage, currentImage: startImage, id: r.id, startRegion: r },
          };
        }
      }
      // Nothing hit — begin drawing (unless modifier prevents it).
      if (modifiers?.spaceOnly) return state;
      const startImage = displayToImage(transform, point);
      return {
        ...state,
        selectedId: null,
        mode: "drawing",
        drag: { originImage: startImage, currentImage: startImage },
      };
    }
    case "pointer-move": {
      const { point, transform, frame } = action;
      if (state.mode === "idle" || !state.drag || !transform || !frame) return state;
      const nowImage = displayToImage(transform, point);
      return { ...state, drag: { ...state.drag, currentImage: nowImage } };
    }
    case "pointer-up": {
      const { transform, frame } = action;
      if (!state.drag || !frame) return { ...state, mode: "idle", drag: null };
      if (state.mode === "drawing") {
        const res = normalizeDrag({
          start: state.drag.originImage,
          end: state.drag.currentImage,
          frame,
        });
        if (!res.ok) return { ...state, mode: "idle", drag: null };
        const region = createRegion({ ...res.rect, label: null });
        const next = state.regions.concat([region]);
        const advanced = withRegions(state, next);
        return { ...advanced, mode: "idle", drag: null, selectedId: region.id };
      }
      if (state.mode === "moving" && state.drag.startRegion) {
        const dx = Math.round((state.drag.currentImage?.x ?? 0) - (state.drag.originImage?.x ?? 0));
        const dy = Math.round((state.drag.currentImage?.y ?? 0) - (state.drag.originImage?.y ?? 0));
        const moved = moveRegion(state.drag.startRegion, { dx, dy }, frame);
        const next = state.regions.map((r) => (r.id === moved.id ? moved : r));
        const advanced = withRegions(state, next);
        return { ...advanced, mode: "idle", drag: null };
      }
      if (state.mode === "resizing" && state.drag.startRegion && state.drag.handle) {
        const dx = Math.round((state.drag.currentImage?.x ?? 0) - (state.drag.originImage?.x ?? 0));
        const dy = Math.round((state.drag.currentImage?.y ?? 0) - (state.drag.originImage?.y ?? 0));
        const resized = resizeRegion(state.drag.startRegion, state.drag.handle, { dx, dy }, frame);
        const next = state.regions.map((r) => (r.id === resized.id ? resized : r));
        const advanced = withRegions(state, next);
        return { ...advanced, mode: "idle", drag: null };
      }
      return { ...state, mode: "idle", drag: null };
    }
    case "pointer-cancel":
      return { ...state, mode: "idle", drag: null };
    case "key": {
      const { key, shift, frame } = action;
      const sel = selectedRegion(state);
      if (!sel || !frame) return state;
      if (key === "Delete" || key === "Backspace") {
        const next = state.regions.filter((r) => r.id !== sel.id);
        return { ...withRegions(state, next), selectedId: null };
      }
      const step = shift ? KEY_NUDGE_LARGE : KEY_NUDGE_STEP;
      let region = sel;
      if (key === "ArrowLeft") region = shift
        ? resizeRegion(sel, "e", { dx: -step, dy: 0 }, frame)
        : moveRegion(sel, { dx: -step, dy: 0 }, frame);
      else if (key === "ArrowRight") region = shift
        ? resizeRegion(sel, "e", { dx: step, dy: 0 }, frame)
        : moveRegion(sel, { dx: step, dy: 0 }, frame);
      else if (key === "ArrowUp") region = shift
        ? resizeRegion(sel, "s", { dx: 0, dy: -step }, frame)
        : moveRegion(sel, { dx: 0, dy: -step }, frame);
      else if (key === "ArrowDown") region = shift
        ? resizeRegion(sel, "s", { dx: 0, dy: step }, frame)
        : moveRegion(sel, { dx: 0, dy: step }, frame);
      else return state;
      const next = state.regions.map((r) => (r.id === region.id ? region : r));
      return withRegions(state, next);
    }
    case "select":
      return { ...state, selectedId: action.id || null };
    case "remove": {
      const next = state.regions.filter((r) => r.id !== action.id);
      const advanced = withRegions(state, next);
      return { ...advanced, selectedId: state.selectedId === action.id ? null : state.selectedId };
    }
    case "clear-all": {
      if (state.regions.length === 0) return state;
      const advanced = withRegions(state, []);
      return { ...advanced, selectedId: null };
    }
    case "relabel": {
      const next = state.regions.map((r) => r.id === action.id ? { ...r, label: action.label ? String(action.label) : null } : r);
      return withRegions(state, next);
    }
    case "set-regions": {
      const cleaned = (action.regions || [])
        .map((r) => clampRegionToFrame(r, action.frame || { width: 1e6, height: 1e6 }, { minEdge: MIN_REGION_EDGE }))
        .filter(Boolean);
      return withRegions(state, cleaned);
    }
    case "undo": {
      if (!canUndoH(state.history)) return state;
      const history = historyUndo(state.history);
      return { ...state, history, regions: historyPresent(history), dirty: true };
    }
    case "redo": {
      if (!canRedoH(state.history)) return state;
      const history = historyRedo(state.history);
      return { ...state, history, regions: historyPresent(history), dirty: true };
    }
    default:
      return state;
  }
}

export function canUndo(state) { return !!state && canUndoH(state.history); }
export function canRedo(state) { return !!state && canRedoH(state.history); }

/**
 * Live drag rectangle preview in source-image pixels. Returns null when
 * there is no in-progress drawing drag. Used by the overlay renderer to
 * paint a dashed "ghost" rectangle while the user is dragging.
 */
export function draftDrawRect(state, frame) {
  if (!state || state.mode !== "drawing" || !state.drag || !frame) return null;
  const res = normalizeDrag({
    start: state.drag.originImage,
    end: state.drag.currentImage,
    frame,
  });
  return res.ok ? res.rect : null;
}

/** True if focus is inside a text-editing element and shortcuts must be muted. */
export function shortcutsAreSuppressed(target) {
  if (!target || typeof target !== "object") return false;
  const tag = (target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}