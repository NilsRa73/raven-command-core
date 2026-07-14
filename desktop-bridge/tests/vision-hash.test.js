import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, hashFrameBytes, hashesEqual } from "../../src/lib/rah/visionHash.js";

test("sha256Hex is deterministic for identical bytes", async () => {
  const a = await sha256Hex(new Uint8Array([1, 2, 3]));
  const b = await sha256Hex(new Uint8Array([1, 2, 3]));
  assert.equal(typeof a, "string");
  assert.equal(a.length, 64);
  assert.equal(a, b);
});

test("sha256Hex distinguishes different byte payloads", async () => {
  const a = await sha256Hex(new Uint8Array([1, 2, 3]));
  const b = await sha256Hex(new Uint8Array([1, 2, 4]));
  assert.notEqual(a, b);
});

test("sha256Hex known vector for empty and 'abc'", async () => {
  // Standard NIST test vectors.
  const empty = await sha256Hex(new Uint8Array([]));
  assert.equal(empty, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const abc = await sha256Hex("abc");
  assert.equal(abc, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex accepts data: URLs (base64) and matches raw bytes", async () => {
  // "abc" base64 = "YWJj"
  const fromDataUrl = await sha256Hex("data:image/png;base64,YWJj");
  const fromString = await sha256Hex("abc");
  assert.equal(fromDataUrl, fromString);
});

test("sha256Hex returns null for null/undefined without throwing", async () => {
  assert.equal(await sha256Hex(null), null);
  assert.equal(await sha256Hex(undefined), null);
});

test("hashFrameBytes returns a labelled hash string", async () => {
  const meta = await hashFrameBytes(new Uint8Array([9, 9, 9]));
  assert.match(meta.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(meta.algorithm, "sha256");
  assert.equal(typeof meta.hashedAt, "number");
});

test("hashesEqual is prefix-agnostic and length-strict", () => {
  const hex = "a".repeat(64);
  assert.equal(hashesEqual(hex, `sha256:${hex}`), true);
  assert.equal(hashesEqual(`SHA256:${hex}`, hex), true);
  assert.equal(hashesEqual(hex, "a".repeat(63)), false);
  assert.equal(hashesEqual(null, hex), false);
  assert.equal(hashesEqual(hex, null), false);
});