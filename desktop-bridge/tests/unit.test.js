import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { assertContained, PathContainmentError } from "../src/paths.js";
import { assertSafeUrl, UnsafeUrlError } from "../src/urlCheck.js";
import { redact } from "../src/audit.js";
import { signRequest, verifyRequest, AuthError, _resetNonceCacheForTests } from "../src/auth.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rah-bridge-test-"));
const root = path.join(tmp, "root"); fs.mkdirSync(root);
fs.writeFileSync(path.join(root, "a.txt"), "hi");
fs.mkdirSync(path.join(root, "sub"));

test("assertContained: allows path inside approved root", () => {
  const p = assertContained(path.join(root, "sub"), [root]);
  assert.equal(p, path.join(root, "sub"));
});

test("assertContained: blocks parent traversal via ..", () => {
  assert.throws(() => assertContained(path.join(root, "..", "outside.txt"), [root]), PathContainmentError);
});

test("assertContained: blocks absolute path outside root", () => {
  assert.throws(() => assertContained("/etc/passwd", [root]), PathContainmentError);
});

test("assertContained: rejects null byte", () => {
  assert.throws(() => assertContained(path.join(root, "a\u0000b"), [root]), PathContainmentError);
});

test("assertSafeUrl: allows https", () => {
  assert.equal(assertSafeUrl("https://example.com/path?q=1"), "https://example.com/path?q=1");
});

test("assertSafeUrl: blocks file://", () => {
  assert.throws(() => assertSafeUrl("file:///etc/passwd"), UnsafeUrlError);
});

test("assertSafeUrl: blocks javascript:", () => {
  assert.throws(() => assertSafeUrl("javascript:alert(1)"), UnsafeUrlError);
});

test("assertSafeUrl: blocks powershell:", () => {
  assert.throws(() => assertSafeUrl("powershell:whatever"), UnsafeUrlError);
});

test("assertSafeUrl: blocks http://", () => {
  assert.throws(() => assertSafeUrl("http://example.com"), UnsafeUrlError);
});

test("assertSafeUrl: blocks mailto:", () => {
  assert.throws(() => assertSafeUrl("mailto:someone@example.com"), UnsafeUrlError);
});

test("assertSafeUrl: blocks URLs with embedded credentials", () => {
  assert.throws(() => assertSafeUrl("https://user:pass@example.com/"), UnsafeUrlError);
});

test("assertSafeUrl: blocks control characters", () => {
  assert.throws(() => assertSafeUrl("https://example.com/\n"), UnsafeUrlError);
  assert.throws(() => assertSafeUrl("https://example.com/ path"), UnsafeUrlError);
});

test("assertContained: blocks symlink-ancestor escape for new file", () => {
  // Create a real dir outside the approved root, symlink into the approved
  // root, then try to create a file under the symlink. Containment must
  // resolve through the symlink and reject the write.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rah-outside-"));
  const linkName = path.join(root, "link-to-outside");
  try { fs.symlinkSync(outside, linkName, "dir"); }
  catch (err) { if (err.code === "EPERM") { console.log("skipping symlink test: no privilege"); return; } throw err; }
  const evilTarget = path.join(linkName, "new-file.txt");
  assert.throws(() => assertContained(evilTarget, [root]), PathContainmentError);
  fs.unlinkSync(linkName);
  fs.rmSync(outside, { recursive: true, force: true });
});

test("redact: masks tokens and 6-digit codes and secret-like keys", () => {
  const r = redact({ token: "abc", pairingCode: "123456", body: "Bearer " + "x".repeat(40) + " code 654321" });
  assert.equal(r.token, "[REDACTED]");
  assert.equal(r.pairingCode, "[REDACTED]");
  assert.match(r.body, /\[REDACTED_TOKEN\]/);
  assert.match(r.body, /\[REDACTED_CODE\]/);
});

test("verifyRequest: happy path", () => {
  _resetNonceCacheForTests();
  const secret = "s"; const token = "t";
  const body = JSON.stringify({ hello: "world" });
  const ts = String(Date.now()); const nonce = crypto.randomUUID();
  const sig = signRequest({ method: "POST", path: "/v1/system/status", timestamp: ts, nonce, body, secret });
  const req = {
    method: "POST", url: "/v1/system/status",
    headers: { authorization: "Bearer " + token, "x-rah-timestamp": ts, "x-rah-nonce": nonce, "x-rah-signature": sig },
  };
  verifyRequest({ req, rawBody: body, expectedToken: token, expectedSecret: secret });
});

test("verifyRequest: rejects wrong token", () => {
  _resetNonceCacheForTests();
  const secret = "s"; const token = "t";
  const body = "{}";
  const ts = String(Date.now()); const nonce = crypto.randomUUID();
  const sig = signRequest({ method: "GET", path: "/v1/system/status", timestamp: ts, nonce, body: "", secret });
  const req = { method: "GET", url: "/v1/system/status",
    headers: { authorization: "Bearer WRONG", "x-rah-timestamp": ts, "x-rah-nonce": nonce, "x-rah-signature": sig } };
  assert.throws(() => verifyRequest({ req, rawBody: "", expectedToken: token, expectedSecret: secret }), AuthError);
});

test("verifyRequest: rejects stale timestamp", () => {
  _resetNonceCacheForTests();
  const secret = "s"; const token = "t";
  const ts = String(Date.now() - 10 * 60_000);
  const nonce = crypto.randomUUID();
  const sig = signRequest({ method: "GET", path: "/v1/x", timestamp: ts, nonce, body: "", secret });
  const req = { method: "GET", url: "/v1/x",
    headers: { authorization: "Bearer " + token, "x-rah-timestamp": ts, "x-rah-nonce": nonce, "x-rah-signature": sig } };
  assert.throws(() => verifyRequest({ req, rawBody: "", expectedToken: token, expectedSecret: secret }), AuthError);
});

test("verifyRequest: rejects replayed nonce", () => {
  _resetNonceCacheForTests();
  const secret = "s"; const token = "t";
  const ts = String(Date.now()); const nonce = "same-nonce";
  const sig = signRequest({ method: "GET", path: "/v1/x", timestamp: ts, nonce, body: "", secret });
  const req = { method: "GET", url: "/v1/x",
    headers: { authorization: "Bearer " + token, "x-rah-timestamp": ts, "x-rah-nonce": nonce, "x-rah-signature": sig } };
  verifyRequest({ req, rawBody: "", expectedToken: token, expectedSecret: secret });
  assert.throws(() => verifyRequest({ req, rawBody: "", expectedToken: token, expectedSecret: secret }), AuthError);
});

test("verifyRequest: rejects tampered body", () => {
  _resetNonceCacheForTests();
  const secret = "s"; const token = "t";
  const ts = String(Date.now()); const nonce = crypto.randomUUID();
  const sig = signRequest({ method: "POST", path: "/v1/x", timestamp: ts, nonce, body: "{}", secret });
  const req = { method: "POST", url: "/v1/x",
    headers: { authorization: "Bearer " + token, "x-rah-timestamp": ts, "x-rah-nonce": nonce, "x-rah-signature": sig } };
  assert.throws(() => verifyRequest({ req, rawBody: '{"tampered":true}', expectedToken: token, expectedSecret: secret }), AuthError);
});
