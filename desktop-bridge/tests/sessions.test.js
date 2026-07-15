import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveTaskQueue, findResumable } from "../../src/lib/rah/sessions.js";

test("deriveTaskQueue: maps command statuses and sorts by priority", () => {
  const rows = deriveTaskQueue({
    commands: [
      { id: "a", prompt: "old done",   status: "done",    createdAt: 1 },
      { id: "b", prompt: "running now", status: "running", createdAt: 2 },
      { id: "c", prompt: "pending",    status: "awaiting_approval", createdAt: 3 },
      { id: "d", prompt: "queued",     status: "queued",  createdAt: 4 },
      { id: "e", prompt: "boom",       status: "error",   createdAt: 5 },
      { id: "f", prompt: "ignored",    status: "unknown", createdAt: 6 },
    ],
    approvals: [
      { id: "ap1", title: "Approve me", status: "pending", createdAt: 10 },
      { id: "ap2", title: "Already done", status: "approved" },
    ],
  });
  assert.equal(rows[0].status, "running");
  const orderedStatuses = rows.map((r) => r.status);
  assert.deepEqual(
    orderedStatuses,
    ["running", "awaiting_approval", "awaiting_approval", "queued", "failed", "completed"],
  );
  assert.ok(!rows.some((r) => r.id === "f"), "unknown statuses are dropped");
});

test("deriveTaskQueue: respects limit", () => {
  const rows = deriveTaskQueue({
    commands: Array.from({ length: 20 }, (_, i) => ({ id: "c" + i, status: "queued", createdAt: i, prompt: "x" })),
    limit: 5,
  });
  assert.equal(rows.length, 5);
});

test("findResumable: null when no sessions", () => {
  assert.equal(findResumable([], []), null);
});

test("findResumable: picks newest non-completed session and freshest checkpoint", () => {
  const sessions = [
    { id: "s1", projectId: null, title: "old", objective: "", createdAt: 1, updatedAt: 1, status: "completed" },
    { id: "s2", projectId: null, title: "keep", objective: "obj", createdAt: 2, updatedAt: 100, status: "paused", lastRoute: "/memory" },
    { id: "s3", projectId: null, title: "older active", objective: "", createdAt: 3, updatedAt: 50, status: "active" },
  ];
  const cps = [
    { id: "c1", sessionId: "s2", projectId: null, createdAt: 90, note: "old note", resumeRoute: "/x" },
    { id: "c2", sessionId: "s2", projectId: null, createdAt: 99, note: "recent", resumeRoute: "/vision", nextAction: "review capture" },
    { id: "c3", sessionId: "s3", projectId: null, createdAt: 40, note: "for s3" },
  ];
  const r = findResumable(sessions, cps);
  assert.ok(r);
  assert.equal(r.session.id, "s2");
  assert.equal(r.checkpoint.id, "c2");
  assert.equal(r.resumeRoute, "/vision");
  assert.match(r.reason, /Resume "keep"/);
  assert.match(r.reason, /next: review capture/);
});

test("findResumable: falls back to session.lastRoute when no checkpoints", () => {
  const sessions = [
    { id: "s1", projectId: null, title: "bare", objective: "", createdAt: 1, updatedAt: 10, status: "active", lastRoute: "/projects" },
  ];
  const r = findResumable(sessions, []);
  assert.equal(r.resumeRoute, "/projects");
  assert.equal(r.checkpoint, null);
});

test("findResumable: defaults to / when nothing recorded", () => {
  const r = findResumable([{ id: "s1", projectId: null, title: "x", objective: "", createdAt: 1, updatedAt: 1, status: "active" }], []);
  assert.equal(r.resumeRoute, "/");
});