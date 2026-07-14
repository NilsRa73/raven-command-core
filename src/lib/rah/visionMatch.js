// Screen Vision v0.3 — duplicate-detection and receipt "match strength"
// classification. Pure and deterministic. Used by import planning UI and
// evidence-save receipts to tell the user how strongly two artifacts match:
//   "hash"     — SHA-256 of the exact frame bytes is identical (strongest)
//   "metadata" — hash absent on one/both sides but stable metadata
//                (byteLength AND width AND height AND capturedAt) matches
//   "none"     — no reliable overlap; treat as distinct
//
// The classifier NEVER fabricates a hash and NEVER upgrades "metadata" to
// "hash" — a missing hash is honestly reported as such.

function normHash(h) {
  if (typeof h !== "string") return null;
  const s = h.trim().toLowerCase().replace(/^sha256:/, "");
  return s.length ? s : null;
}

function frameOf(x) {
  if (!x || typeof x !== "object") return null;
  if (x.frame && typeof x.frame === "object") return x.frame;
  return x;
}

/**
 * Classify how strongly two evidence-like records match. Returns
 * `{ strength: "hash"|"metadata"|"none", reason }`. Never throws.
 */
export function classifyMatchStrength(a, b) {
  const fa = frameOf(a);
  const fb = frameOf(b);
  if (!fa || !fb) return { strength: "none", reason: "missing_frame" };
  const ha = normHash(fa.hash);
  const hb = normHash(fb.hash);
  if (ha && hb) {
    return ha === hb
      ? { strength: "hash", reason: "sha256_equal" }
      : { strength: "none", reason: "sha256_differ" };
  }
  const okNum = (n) => Number.isFinite(n) && n > 0;
  const metaEq =
    okNum(fa.sizeBytes) && okNum(fb.sizeBytes) && fa.sizeBytes === fb.sizeBytes &&
    okNum(fa.width) && okNum(fb.width) && fa.width === fb.width &&
    okNum(fa.height) && okNum(fb.height) && fa.height === fb.height &&
    okNum(fa.capturedAt) && okNum(fb.capturedAt) && fa.capturedAt === fb.capturedAt;
  if (metaEq) return { strength: "metadata", reason: "size_dims_time_equal" };
  return { strength: "none", reason: "no_overlap" };
}

/** Human label — safe for direct rendering. */
export function matchStrengthLabel(strength) {
  if (strength === "hash") return "hash match";
  if (strength === "metadata") return "metadata match";
  return "no match";
}

/**
 * Given an incoming candidate and a list of existing evidence records,
 * return the strongest match plus its target id (or null). Deterministic
 * order: hash > metadata > none; ties broken by first occurrence.
 */
export function findStrongestMatch(candidate, existingList = []) {
  const list = Array.isArray(existingList) ? existingList : [];
  let best = { strength: "none", reason: "no_candidates", targetId: null };
  for (const ex of list) {
    if (!ex || !ex.id) continue;
    const c = classifyMatchStrength(candidate, ex);
    if (c.strength === "hash") return { ...c, targetId: ex.id };
    if (c.strength === "metadata" && best.strength !== "metadata") {
      best = { ...c, targetId: ex.id };
    }
  }
  return best;
}