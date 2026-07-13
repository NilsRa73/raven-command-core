import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeReadiness,
  computePrivacyStatus,
  deriveTodaysMission,
  mergeRecentActivity,
  formatTelemetry,
  agentTeamCounts,
} from "../../src/lib/rah/missionControl.js";

test("computeReadiness: everything green → 100", () => {
  const r = computeReadiness({
    bridgeSnapshot: { ui: "paired_online" }, engine: "lmstudio",
    projectSelected: true, memoryEnabled: true, voiceSupported: true, visionSupported: true,
  });
  assert.equal(r.score, 100);
  assert.ok(r.checks.every((c) => c.ok));
});

test("computeReadiness: cloud engine passes engine check even with bridge offline", () => {
  const r = computeReadiness({
    bridgeSnapshot: { ui: "offline" }, engine: "cloud",
    projectSelected: false, memoryEnabled: true, voiceSupported: false, visionSupported: false,
  });
  assert.ok(r.checks.find((c) => c.id === "engine").ok);
  assert.ok(!r.checks.find((c) => c.id === "bridge").ok);
  assert.ok(r.score > 0 && r.score < 100);
});

test("computeReadiness: local engine fails engine check when bridge offline", () => {
  const r = computeReadiness({
    bridgeSnapshot: { ui: "offline" }, engine: "lmstudio",
    projectSelected: true, memoryEnabled: true, voiceSupported: true, visionSupported: true,
  });
  assert.ok(!r.checks.find((c) => c.id === "engine").ok);
});

test("computePrivacyStatus: local via bridge = LOCAL", () => {
  const s = computePrivacyStatus({ engine: "lmstudio", transport: "bridge",
    bridgeSnapshot: { ui: "paired_online" } });
  assert.equal(s.label, "LOCAL");
});

test("computePrivacyStatus: local without bridge = OFFLINE", () => {
  const s = computePrivacyStatus({ engine: "lmstudio", transport: "bridge",
    bridgeSnapshot: { ui: "offline" } });
  assert.equal(s.label, "OFFLINE");
});

test("computePrivacyStatus: cloud = CLOUD, demo = LOCAL", () => {
  assert.equal(computePrivacyStatus({ engine: "cloud", transport: "direct",
    bridgeSnapshot: null }).label, "CLOUD");
  assert.equal(computePrivacyStatus({ engine: "demo", transport: "direct",
    bridgeSnapshot: null }).label, "LOCAL");
});

test("deriveTodaysMission picks newest next_action and lists blocker + pinned", () => {
  const t = 1_700_000_000_000;
  const mem = [
    { id: "1", type: "next_action", title: "Ship v0.3",   updatedAt: t + 5, projectId: null },
    { id: "2", type: "next_action", title: "Older action", updatedAt: t,     projectId: null },
    { id: "3", type: "blocker",     title: "GPU driver",   updatedAt: t + 1, projectId: null },
    { id: "4", type: "note",        title: "Pinned note",  updatedAt: t + 2, pinned: true, projectId: null },
  ];
  const r = deriveTodaysMission({ projectMemory: mem, projectId: null });
  assert.equal(r.nextAction.title, "Ship v0.3");
  assert.equal(r.blocker.title, "GPU driver");
  assert.equal(r.suggestions[0].title, "Ship v0.3");
  assert.equal(r.suggestions[1].title, "Resolve blocker: GPU driver");
  assert.ok(r.suggestions.some((s) => s.title === "Pinned note"));
});

test("deriveTodaysMission includes awaiting-approval commands as suggestions", () => {
  const r = deriveTodaysMission({
    projectMemory: [], projectId: null,
    commands: [{ status: "awaiting_approval", prompt: "delete-tmp folder" }],
  });
  assert.ok(r.suggestions.find((s) => s.source === "command:awaiting"));
});

test("mergeRecentActivity sorts by ts desc and honors limit", () => {
  const rows = mergeRecentActivity({
    commands: [{ createdAt: 10, prompt: "a", status: "done" }, { createdAt: 30, prompt: "c", status: "done" }],
    projectMemory: [{ updatedAt: 20, title: "b", type: "note" }],
    limit: 2,
  });
  assert.deepEqual(rows.map((r) => r.title), ["c", "b"]);
  assert.equal(rows[0].kind, "command");
  assert.equal(rows[1].kind, "memory");
});

test("mergeRecentActivity skips archived memory", () => {
  const rows = mergeRecentActivity({
    commands: [], projectMemory: [{ updatedAt: 1, title: "x", archived: true }],
  });
  assert.equal(rows.length, 0);
});

test("formatTelemetry: no source returns explicit unavailable strings", () => {
  const t = formatTelemetry(null);
  assert.equal(t.available, false);
  assert.match(t.cpuLine, /unavailable/i);
  assert.match(t.memoryLine, /unavailable/i);
  assert.match(t.gpuLine, /unavailable/i);
  assert.match(t.latencyLine, /unavailable/i);
});

test("formatTelemetry: real snapshot never invents GPU data", () => {
  const t = formatTelemetry({
    cpu: { cores: 8, model: "Ryzen" },
    memory: { totalBytes: 16e9, usedBytes: 8e9 },
    platform: "win32", arch: "x64", release: "10.0",
    hostname: "PC", username: "ash",
  }, { latencyMs: 12 });
  assert.equal(t.available, true);
  assert.equal(t.cpuLine, "8 cores · Ryzen");
  assert.equal(t.memoryLine, "8.0 / 16.0 GB used");
  assert.equal(t.latencyLine, "12 ms");
  assert.equal(t.gpuLine, "GPU telemetry unavailable");
});

test("agentTeamCounts summarises live orchestration state", () => {
  const state = {
    phase: "running", runId: "run_1",
    tasks: [{ state: "running" }, { state: "queued" }, { state: "done" }],
  };
  const stats = { a: { runs: 2, completed: 2, failed: 0 }, b: { runs: 1, completed: 0, failed: 1 } };
  const c = agentTeamCounts(state, stats);
  assert.equal(c.active, true);
  assert.equal(c.runningTasks, 2);
  assert.equal(c.completedRuns, 2);
  assert.equal(c.failedRuns, 1);
  assert.equal(c.totalRuns, 3);
  assert.equal(c.currentRunId, "run_1");
});

test("agentTeamCounts with no state returns idle counts", () => {
  const c = agentTeamCounts(null, null);
  assert.equal(c.active, false);
  assert.equal(c.phase, "idle");
  assert.equal(c.runningTasks, 0);
  assert.equal(c.totalRuns, 0);
});