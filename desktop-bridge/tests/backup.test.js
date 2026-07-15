import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}
function sha(x) { return createHash("sha256").update(x).digest("hex"); }

test("canonicalize is order-independent", () => {
  const a = { b: 1, a: 2, c: [{ y: 1, x: 2 }] };
  const b = { c: [{ x: 2, y: 1 }], a: 2, b: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(sha(canonicalize(a)), sha(canonicalize(b)));
});
test("canonicalize distinguishes different data", () => {
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 2 }));
});

function sanitizePrefs(prefs) {
  if (!prefs) return null;
  const SECRET = ["provider"];
  const out = {};
  for (const [k, v] of Object.entries(prefs)) if (!SECRET.includes(k)) out[k] = v;
  return out;
}
test("sanitizePrefs strips provider secrets", () => {
  const out = sanitizePrefs({ engine: "bridge", model: "x", provider: { apiKey: "SECRET" } });
  assert.ok(!("provider" in out));
  assert.equal(out.engine, "bridge");
});
test("sanitizePrefs null/empty", () => {
  assert.equal(sanitizePrefs(null), null);
  assert.deepEqual(sanitizePrefs({}), {});
});

function snapshotsToDelete(existing, retention) {
  const sorted = [...existing].sort((a, b) => b.createdAt - a.createdAt);
  return sorted.slice(retention).map((s) => s.id);
}
test("snapshotsToDelete keeps N newest", () => {
  const snaps = Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, createdAt: i * 1000 }));
  const drop = snapshotsToDelete(snaps, 10);
  assert.deepEqual(drop.sort(), ["s0", "s1", "s2", "s3", "s4"]);
});
test("snapshotsToDelete drops nothing when under retention", () => {
  assert.deepEqual(snapshotsToDelete([{ id: "a", createdAt: 1 }], 10), []);
});

function shouldTakeDailySnapshot(existing, now, ms = 86_400_000) {
  const daily = existing.filter((s) => s.reason === "daily-auto");
  if (!daily.length) return true;
  return now - Math.max(...daily.map((s) => s.createdAt)) >= ms;
}
test("shouldTakeDailySnapshot when no daily", () => {
  assert.equal(shouldTakeDailySnapshot([{ reason: "manual", createdAt: 1 }], 100), true);
});
test("shouldTakeDailySnapshot false within 24h", () => {
  const now = 1_700_000_000_000;
  assert.equal(shouldTakeDailySnapshot([{ reason: "daily-auto", createdAt: now - 3_600_000 }], now), false);
});
test("shouldTakeDailySnapshot true after 24h", () => {
  const now = 1_700_000_000_000;
  assert.equal(shouldTakeDailySnapshot([{ reason: "daily-auto", createdAt: now - 86_400_001 }], now), true);
});
test("checksum round-trip detects tampering", () => {
  const data = { projects: [{ id: "p1", name: "X" }] };
  const sig = sha(canonicalize(data));
  assert.notEqual(sha(canonicalize({ projects: [{ id: "p1", name: "Y" }] })), sig);
  assert.equal(sha(canonicalize(data)), sig);
});