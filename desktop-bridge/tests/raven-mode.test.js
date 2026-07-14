import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePriority, scoreRelevance, selectContextForMode,
  truncateForMode, buildContextPacket, classifyRoute,
  healthCheck, RAVEN_MODE_META,
} from "../../src/lib/rah/ravenMode.js";

const NOW = 1_700_000_000_000;
const day = 86_400_000;

function rec(over = {}) {
  return {
    id: over.id ?? "id",
    projectId: over.projectId ?? null,
    title: over.title ?? "t",
    content: over.content ?? "c",
    type: over.type ?? "note",
    tags: over.tags ?? [],
    createdAt: over.createdAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
    source: "user",
    archived: over.archived ?? false,
    pinned: over.pinned ?? false,
  };
}

test("derivePriority — pinned live is critical; archived beats pinned", () => {
  assert.equal(derivePriority(rec({ pinned: true })), "critical");
  assert.equal(derivePriority(rec({ pinned: true, archived: true })), "archived");
  assert.equal(derivePriority(rec({ type: "blocker" })), "active");
  assert.equal(derivePriority(rec({ type: "next_action" })), "active");
  assert.equal(derivePriority(rec({ type: "note" })), "supporting");
});

test("Fast Mode excludes supporting; Deep Mode includes it", () => {
  const list = [
    rec({ id: "a", pinned: true, updatedAt: NOW }),
    rec({ id: "b", type: "blocker", updatedAt: NOW - day }),
    rec({ id: "c", type: "note", updatedAt: NOW - 2 * day }),
  ];
  const fast = selectContextForMode(list, { mode: "fast", now: NOW });
  const deep = selectContextForMode(list, { mode: "deep", now: NOW });
  assert.deepEqual(fast.map((x) => x.rec.id), ["a", "b"]);
  assert.deepEqual(deep.map((x) => x.rec.id).sort(), ["a", "b", "c"]);
});

test("forced pin overrides supporting exclusion in Fast Mode", () => {
  const list = [
    rec({ id: "note", type: "note", updatedAt: NOW }),
  ];
  const fast = selectContextForMode(list, { mode: "fast", now: NOW, pinnedIds: ["note"] });
  assert.equal(fast.length, 1);
  assert.equal(fast[0].forcedPin, true);
});

test("excluded ids never appear", () => {
  const list = [rec({ id: "a", pinned: true })];
  const sel = selectContextForMode(list, { mode: "deep", excludedIds: ["a"] });
  assert.equal(sel.length, 0);
});

test("archived items excluded even in Deep Mode", () => {
  const list = [rec({ id: "a", archived: true, pinned: true })];
  assert.equal(selectContextForMode(list, { mode: "deep" }).length, 0);
});

test("scoreRelevance prefers critical > active > supporting", () => {
  const c = scoreRelevance(rec({ pinned: true, updatedAt: NOW }), { now: NOW });
  const a = scoreRelevance(rec({ type: "blocker", updatedAt: NOW }), { now: NOW });
  const s = scoreRelevance(rec({ type: "note", updatedAt: NOW }), { now: NOW });
  assert.ok(c > a && a > s, `expected c>a>s got ${c},${a},${s}`);
});

test("truncateForMode respects per-mode budget", () => {
  const big = "x".repeat(1000);
  assert.ok(truncateForMode(big, "fast").length <= RAVEN_MODE_META.fast.perItemChars);
  assert.ok(truncateForMode(big, "deep").length <= RAVEN_MODE_META.deep.perItemChars);
});

test("buildContextPacket emits header/footer and token estimate", () => {
  const p = buildContextPacket([rec({ pinned: true, title: "T", content: "body" })], { mode: "fast", now: NOW });
  assert.match(p.text, /RAH RAVEN CONTEXT · FAST MODE/);
  assert.match(p.text, /END RAH RAVEN CONTEXT/);
  assert.equal(p.mode, "fast");
  assert.equal(p.approxTokens, Math.ceil(p.approxChars / 4));
});

test("classifyRoute — mutation verbs require approval unless advisory", () => {
  assert.equal(classifyRoute("delete the file", { mode: "fast" }).lane, "approval_required");
  assert.equal(classifyRoute("delete the file", { mode: "fast", approvalMode: "advisory" }).lane, "raven_agent");
});

test("classifyRoute — Deep Mode routes to planning even for simple prompts", () => {
  assert.equal(classifyRoute("hello", { mode: "deep" }).lane, "planning_deep");
});

test("classifyRoute — planning verbs trigger deep lane", () => {
  assert.equal(classifyRoute("please analyze this system", { mode: "fast" }).lane, "planning_deep");
});

test("classifyRoute — short informational prompts stay quick", () => {
  assert.equal(classifyRoute("what is the status", { mode: "fast" }).lane, "local_quick_action");
});

test("healthCheck flags missing storage", () => {
  const h = healthCheck({ list: [], storageAvailable: false, modePersisted: true });
  assert.equal(h.ok, false);
  assert.ok(h.problems.join(" ").includes("localStorage"));
});

test("respects contextLimit cap in Deep Mode", () => {
  const list = Array.from({ length: 40 }, (_, i) =>
    rec({ id: `n${i}`, type: "note", updatedAt: NOW - i * 1000 }));
  const sel = selectContextForMode(list, { mode: "deep", now: NOW });
  assert.ok(sel.length <= RAVEN_MODE_META.deep.contextLimit);
});
