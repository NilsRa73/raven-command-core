// Unit tests for classifyOverall pure logic mirrored from
// src/lib/rah/systemCheck.ts so we can exercise it under node:test
// without the browser stack. Kept in sync by hand — the shape is tiny.

import { test } from "node:test";
import assert from "node:assert/strict";

function classifyOverall(checks) {
  const required = checks.filter((c) => c.id === "web" || c.id === "bridge" || c.id === "lmstudio" || c.id === "audit");
  const anyBad = required.some((c) => c.severity === "bad");
  const anyWarn = required.some((c) => c.severity === "warn");
  const engine = checks.find((c) => c.id === "engine")?.meta?.engine;
  if (engine === "demo") return "demo";
  if (anyBad) {
    const bridgeBad = required.find((c) => c.id === "bridge")?.severity === "bad";
    const lmBad = required.find((c) => c.id === "lmstudio")?.severity === "bad";
    if (bridgeBad && lmBad) return "offline";
    return "attention";
  }
  if (anyWarn) return "attention";
  return "ready";
}

const ok = (id) => ({ id, severity: "ok" });
const bad = (id) => ({ id, severity: "bad" });
const warn = (id) => ({ id, severity: "warn" });

test("ready when web+bridge+lmstudio+audit all ok", () => {
  assert.equal(classifyOverall([ok("web"), ok("bridge"), ok("lmstudio"), ok("audit")]), "ready");
});

test("demo when engine=demo regardless of others", () => {
  assert.equal(
    classifyOverall([bad("web"), { id: "engine", severity: "ok", meta: { engine: "demo" } }]),
    "demo"
  );
});

test("offline when bridge AND lmstudio both bad", () => {
  assert.equal(classifyOverall([ok("web"), bad("bridge"), bad("lmstudio"), ok("audit")]), "offline");
});

test("attention when only bridge bad", () => {
  assert.equal(classifyOverall([ok("web"), bad("bridge"), ok("lmstudio"), ok("audit")]), "attention");
});

test("attention when warn only", () => {
  assert.equal(classifyOverall([ok("web"), warn("bridge"), ok("lmstudio"), ok("audit")]), "attention");
});

test("optional checks (ollama/permissions) do not decide overall", () => {
  assert.equal(
    classifyOverall([ok("web"), ok("bridge"), ok("lmstudio"), ok("audit"), bad("ollama"), warn("permissions")]),
    "ready"
  );
});