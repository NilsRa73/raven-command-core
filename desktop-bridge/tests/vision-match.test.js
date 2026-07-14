import { test } from "node:test";
import assert from "node:assert/strict";
import * as mod from "../../src/lib/rah/visionMatch.js";

test("classifyMatchStrength: identical sha256 → hash", () => {
  const a = { frame: { hash: "abc", sizeBytes: 1, width: 1, height: 1, capturedAt: 5 } };
  const b = { frame: { hash: "ABC", sizeBytes: 999, width: 2, height: 2, capturedAt: 6 } };
  const r = mod.classifyMatchStrength(a, b);
  assert.equal(r.strength, "hash");
  assert.equal(r.reason, "sha256_equal");
});

test("classifyMatchStrength: prefix-stripped sha256 equality", () => {
  const a = { frame: { hash: "sha256:AA" } };
  const b = { frame: { hash: "aa" } };
  assert.equal(mod.classifyMatchStrength(a, b).strength, "hash");
});

test("classifyMatchStrength: differing hashes → none, not metadata", () => {
  const a = { frame: { hash: "aa", sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const b = { frame: { hash: "bb", sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const r = mod.classifyMatchStrength(a, b);
  assert.equal(r.strength, "none");
  assert.equal(r.reason, "sha256_differ");
});

test("classifyMatchStrength: metadata quad match when hashes absent", () => {
  const a = { frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const b = { frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const r = mod.classifyMatchStrength(a, b);
  assert.equal(r.strength, "metadata");
});

test("classifyMatchStrength: any metadata field differs → none", () => {
  const a = { frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const b = { frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 2 } };
  assert.equal(mod.classifyMatchStrength(a, b).strength, "none");
});

test("classifyMatchStrength: missing frame → none, never throws", () => {
  assert.equal(mod.classifyMatchStrength(null, null).strength, "none");
  assert.equal(mod.classifyMatchStrength({}, {}).strength, "none");
});

test("classifyMatchStrength: NEVER fabricates a hash from metadata", () => {
  const a = { frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const b = { frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const r = mod.classifyMatchStrength(a, b);
  assert.notEqual(r.strength, "hash");
});

test("matchStrengthLabel: renders honest labels", () => {
  assert.equal(mod.matchStrengthLabel("hash"), "hash match");
  assert.equal(mod.matchStrengthLabel("metadata"), "metadata match");
  assert.equal(mod.matchStrengthLabel("none"), "no match");
  assert.equal(mod.matchStrengthLabel("bogus"), "no match");
});

test("findStrongestMatch: prefers hash > metadata > none, records targetId", () => {
  const cand = { frame: { hash: "aa", sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const existing = [
    { id: "m1", frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } }, // metadata match (no hash)
    { id: "h1", frame: { hash: "aa" } }, // hash match
    { id: "n1", frame: { hash: "zz" } },
  ];
  const r = mod.findStrongestMatch(cand, existing);
  assert.equal(r.strength, "hash");
  assert.equal(r.targetId, "h1");
});

test("findStrongestMatch: falls back to first metadata match", () => {
  const cand = { frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } };
  const existing = [
    { id: "n1", frame: { hash: "zz" } },
    { id: "m1", frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } },
    { id: "m2", frame: { sizeBytes: 10, width: 4, height: 4, capturedAt: 1 } },
  ];
  const r = mod.findStrongestMatch(cand, existing);
  assert.equal(r.strength, "metadata");
  assert.equal(r.targetId, "m1"); // first occurrence
});

test("findStrongestMatch: empty list → none/null", () => {
  const r = mod.findStrongestMatch({ frame: { hash: "aa" } }, []);
  assert.equal(r.strength, "none");
  assert.equal(r.targetId, null);
});