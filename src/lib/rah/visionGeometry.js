// Deterministic pure helpers for Screen Vision v0.3 redaction geometry.
// No DOM, no React. All coordinates are in SOURCE-IMAGE pixel space unless
// explicitly labelled as display space. Every function returns plain data
// (never throws for user-supplied input) so the Node test suite can pin
// behavior. Policy contracts asserted by tests:
//   * Regions always have positive width/height (normalized from any drag
//     direction) and integer coordinates.
//   * Regions must fit inside the source frame; out-of-bounds or zero-area
//     regions are rejected — never silently clamped away to nothing.
//   * Move/resize operations clamp against frame bounds and enforce a
//     minimum size (default 4x4 source-image pixels).
//   * Undo/redo is capped so the history cannot grow without bound; the
//     "present" state is always the top of the past stack, and every push
//     clears the redo stack.
//   * Stable region ordering is by created-at (ascending), then id, so two
//     collections with identical semantic content serialize identically.
//   * Duplicate detection prefers cryptographic hash equality; metadata-
//     only matches are labelled `metadata` so the UI can qualify the claim.

export const MIN_REGION_EDGE = 4;               // source-image pixels
export const DEFAULT_HISTORY_LIMIT = 100;       // capped undo/redo depth
export const HIT_TEST_HANDLE = 8;               // display-space handle radius

function toInt(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? v : null;
}
function toPosInt(n) {
  const v = toInt(n);
  return v != null && v > 0 ? v : null;
}
function id(prefix = "rr") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// ─── Coordinate transforms ────────────────────────────────────────────

/**
 * Compute the transform from display space (the rendered <img>/<canvas>)
 * to source-image space. Handles letterboxing when the display box is
 * larger than the intrinsic size. Returns `null` when inputs are invalid.
 */
export function computeDisplayTransform({ displayWidth, displayHeight, sourceWidth, sourceHeight, fit = "contain" } = {}) {
  const dW = Number(displayWidth), dH = Number(displayHeight);
  const sW = Number(sourceWidth), sH = Number(sourceHeight);
  if (!(dW > 0 && dH > 0 && sW > 0 && sH > 0)) return null;
  let scale;
  if (fit === "contain") scale = Math.min(dW / sW, dH / sH);
  else if (fit === "cover") scale = Math.max(dW / sW, dH / sH);
  else if (fit === "stretch") scale = 1;
  else scale = Math.min(dW / sW, dH / sH);
  const drawnW = fit === "stretch" ? dW : sW * scale;
  const drawnH = fit === "stretch" ? dH : sH * scale;
  const offsetX = (dW - drawnW) / 2;
  const offsetY = (dH - drawnH) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    displayWidth: dW,
    displayHeight: dH,
    sourceWidth: sW,
    sourceHeight: sH,
    drawnWidth: drawnW,
    drawnHeight: drawnH,
  };
}

/** Convert a display-space point to source-image pixel coordinates. */
export function displayToImage(transform, point) {
  if (!transform || !point) return null;
  const px = Number(point.x), py = Number(point.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const scale = transform.scale || 1;
  if (scale <= 0) return null;
  const dx = transform.fit === "stretch"
    ? px * (transform.sourceWidth / transform.displayWidth)
    : (px - transform.offsetX) / scale;
  const dy = transform.fit === "stretch"
    ? py * (transform.sourceHeight / transform.displayHeight)
    : (py - transform.offsetY) / scale;
  return {
    x: Math.max(0, Math.min(transform.sourceWidth, dx)),
    y: Math.max(0, Math.min(transform.sourceHeight, dy)),
  };
}

/** Convert source-image pixel coordinates back to display space. */
export function imageToDisplay(transform, point) {
  if (!transform || !point) return null;
  const scale = transform.scale || 1;
  return {
    x: (Number(point.x) * scale) + (transform.offsetX || 0),
    y: (Number(point.y) * scale) + (transform.offsetY || 0),
  };
}

// ─── Drag normalization ────────────────────────────────────────────────

/**
 * Turn any two source-image-space corners (start/end) into a positive-
 * dimension rectangle clamped inside the frame. Returns `{ ok, rect?, reason? }`.
 * Works for drags in every direction (top-left→bottom-right, right-to-left,
 * bottom-to-top, or any diagonal).
 */
export function normalizeDrag({ start, end, frame, minEdge = MIN_REGION_EDGE } = {}) {
  if (!start || !end || !frame) return { ok: false, reason: "missing_input" };
  const fw = toPosInt(frame.width);
  const fh = toPosInt(frame.height);
  if (fw == null || fh == null) return { ok: false, reason: "frame_dimensions_invalid" };
  const sx = Number(start.x), sy = Number(start.y);
  const ex = Number(end.x), ey = Number(end.y);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return { ok: false, reason: "coords_not_numeric" };
  const x0 = Math.max(0, Math.min(fw, Math.min(sx, ex)));
  const y0 = Math.max(0, Math.min(fh, Math.min(sy, ey)));
  const x1 = Math.max(0, Math.min(fw, Math.max(sx, ex)));
  const y1 = Math.max(0, Math.min(fh, Math.max(sy, ey)));
  const rx = Math.round(x0);
  const ry = Math.round(y0);
  const rw = Math.round(x1 - x0);
  const rh = Math.round(y1 - y0);
  if (rw < minEdge || rh < minEdge) return { ok: false, reason: "below_min_edge" };
  if (rx + rw > fw || ry + rh > fh) return { ok: false, reason: "out_of_bounds" };
  return { ok: true, rect: { x: rx, y: ry, w: rw, h: rh } };
}

// ─── Region operations (move/resize/clamp) ─────────────────────────────

export function clampRegionToFrame(region, frame, { minEdge = MIN_REGION_EDGE } = {}) {
  if (!region || !frame) return null;
  const fw = toPosInt(frame.width), fh = toPosInt(frame.height);
  if (fw == null || fh == null) return null;
  const w = Math.max(minEdge, Math.min(fw, toPosInt(region.w) ?? minEdge));
  const h = Math.max(minEdge, Math.min(fh, toPosInt(region.h) ?? minEdge));
  const x = Math.max(0, Math.min(fw - w, toInt(region.x) ?? 0));
  const y = Math.max(0, Math.min(fh - h, toInt(region.y) ?? 0));
  return { ...region, x, y, w, h };
}

export function moveRegion(region, delta, frame, opts) {
  if (!region || !delta) return region;
  const next = { ...region, x: (region.x || 0) + (toInt(delta.dx) ?? 0), y: (region.y || 0) + (toInt(delta.dy) ?? 0) };
  return clampRegionToFrame(next, frame, opts) || region;
}

/**
 * Resize a region by an anchor handle ("nw","n","ne","e","se","s","sw","w").
 * `delta` is in source-image pixels. Enforces min-edge and frame bounds.
 */
export function resizeRegion(region, handle, delta, frame, { minEdge = MIN_REGION_EDGE } = {}) {
  if (!region || !handle || !delta || !frame) return region;
  const dx = toInt(delta.dx) ?? 0, dy = toInt(delta.dy) ?? 0;
  let x = region.x || 0, y = region.y || 0, w = region.w || 0, h = region.h || 0;
  if (handle.includes("w")) { x += dx; w -= dx; }
  if (handle.includes("e")) { w += dx; }
  if (handle.includes("n")) { y += dy; h -= dy; }
  if (handle.includes("s")) { h += dy; }
  if (w < minEdge) { if (handle.includes("w")) x -= (minEdge - w); w = minEdge; }
  if (h < minEdge) { if (handle.includes("n")) y -= (minEdge - h); h = minEdge; }
  return clampRegionToFrame({ ...region, x, y, w, h }, frame, { minEdge }) || region;
}

// ─── Hit testing ──────────────────────────────────────────────────────

/** True if a source-image-space point falls inside a region. */
export function hitTestRegion(region, point) {
  if (!region || !point) return false;
  const px = Number(point.x), py = Number(point.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  return px >= region.x && px < region.x + region.w && py >= region.y && py < region.y + region.h;
}

/**
 * Which resize handle (if any) covers a display-space point for a given
 * region rendered through `transform`. Returns "nw"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"body"|null.
 */
export function hitTestHandle(region, transform, displayPoint, { handleSize = HIT_TEST_HANDLE } = {}) {
  if (!region || !transform || !displayPoint) return null;
  const tl = imageToDisplay(transform, { x: region.x, y: region.y });
  const br = imageToDisplay(transform, { x: region.x + region.w, y: region.y + region.h });
  if (!tl || !br) return null;
  const px = Number(displayPoint.x), py = Number(displayPoint.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const near = (a, b) => Math.abs(a - b) <= handleSize;
  const insideX = px >= tl.x - handleSize && px <= br.x + handleSize;
  const insideY = py >= tl.y - handleSize && py <= br.y + handleSize;
  if (!insideX || !insideY) return null;
  const nearL = near(px, tl.x), nearR = near(px, br.x);
  const nearT = near(py, tl.y), nearB = near(py, br.y);
  if (nearT && nearL) return "nw";
  if (nearT && nearR) return "ne";
  if (nearB && nearL) return "sw";
  if (nearB && nearR) return "se";
  if (nearT) return "n";
  if (nearB) return "s";
  if (nearL) return "w";
  if (nearR) return "e";
  if (px >= tl.x && px <= br.x && py >= tl.y && py <= br.y) return "body";
  return null;
}

// ─── Stable ordering + dirty detection ────────────────────────────────

export function sortRegionsStable(regions) {
  const list = Array.isArray(regions) ? regions.slice() : [];
  list.sort((a, b) => {
    const ac = Number(a?.createdAt) || 0, bc = Number(b?.createdAt) || 0;
    if (ac !== bc) return ac - bc;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  return list;
}

function serializeRegion(r) {
  return `${r.id}|${r.x}|${r.y}|${r.w}|${r.h}|${r.label || ""}`;
}

export function regionsAreDirty(a, b) {
  const A = sortRegionsStable(a).map(serializeRegion).join("\n");
  const B = sortRegionsStable(b).map(serializeRegion).join("\n");
  return A !== B;
}

// ─── Region factory ───────────────────────────────────────────────────

export function createRegion({ x, y, w, h, label = null, now = Date.now(), regionId = null } = {}) {
  return {
    id: regionId || id("rr"),
    x: toInt(x) ?? 0,
    y: toInt(y) ?? 0,
    w: toPosInt(w) ?? MIN_REGION_EDGE,
    h: toPosInt(h) ?? MIN_REGION_EDGE,
    label: label ? String(label) : null,
    createdAt: Number.isFinite(now) ? now : Date.now(),
  };
}

// ─── Undo/redo stack ──────────────────────────────────────────────────

export function createHistory(initial = [], { limit = DEFAULT_HISTORY_LIMIT } = {}) {
  return { past: [sortRegionsStable(initial)], future: [], limit: Math.max(1, limit | 0) };
}

export function historyPresent(history) {
  if (!history || !Array.isArray(history.past) || history.past.length === 0) return [];
  return history.past[history.past.length - 1];
}

/** Push a new "present" onto history. Clears redo. Caps depth. Coalesces no-ops. */
export function historyPush(history, nextRegions) {
  const h = history && history.past ? history : createHistory();
  const next = sortRegionsStable(nextRegions);
  const cur = historyPresent(h);
  if (!regionsAreDirty(cur, next)) return h;
  const past = h.past.concat([next]);
  const trimmed = past.length > h.limit ? past.slice(past.length - h.limit) : past;
  return { past: trimmed, future: [], limit: h.limit };
}

export function canUndo(history) { return !!(history && history.past && history.past.length > 1); }
export function canRedo(history) { return !!(history && history.future && history.future.length > 0); }

export function historyUndo(history) {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const future = [history.past[history.past.length - 1], ...history.future];
  return { past, future, limit: history.limit };
}

export function historyRedo(history) {
  if (!canRedo(history)) return history;
  const [head, ...rest] = history.future;
  return { past: history.past.concat([head]), future: rest, limit: history.limit };
}

// ─── Duplicate detection (hash-first) ─────────────────────────────────

/**
 * Compare two frames. Returns { duplicate, strength } where strength is:
 *   "hash"     — both have hashes and they match (strongest)
 *   "metadata" — no hash on one/both; matches on w/h/sizeBytes (weaker)
 *   "none"     — not a duplicate.
 */
export function frameDuplicateStrength(a, b) {
  if (!a || !b) return { duplicate: false, strength: "none" };
  if (a.hash && b.hash) {
    return a.hash === b.hash
      ? { duplicate: true, strength: "hash" }
      : { duplicate: false, strength: "hash" };
  }
  const sameShape = a.width === b.width && a.height === b.height && a.sizeBytes === b.sizeBytes;
  return { duplicate: sameShape, strength: sameShape ? "metadata" : "none" };
}