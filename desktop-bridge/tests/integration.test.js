import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Use isolated config dir for tests.
const testCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "rah-bridge-cfg-"));
process.env.RAH_BRIDGE_CONFIG_DIR = testCfgDir;

const { createServer, newPairing } = await import("../src/server.js");
const { loadConfig } = await import("../src/config.js");
const { signRequest, _resetNonceCacheForTests } = await import("../src/auth.js");
const emergency = await import("../src/emergency.js");

const cfg = loadConfig();
// Set an approved root for file tests
const approvedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rah-approved-"));
fs.writeFileSync(path.join(approvedRoot, "hello.txt"), "hello world");
cfg.approvedRoots = [approvedRoot];
const { saveConfig } = await import("../src/config.js");
saveConfig(cfg);

const server = createServer(cfg);
let baseUrl;

before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => { server.close(); fs.rmSync(testCfgDir, { recursive: true, force: true }); fs.rmSync(approvedRoot, { recursive: true, force: true }); });

const ORIGIN = "http://localhost:8080";
function signedHeaders({ method, path: p, body, token, secret }) {
  const ts = String(Date.now()); const nonce = crypto.randomUUID();
  const sig = signRequest({ method, path: p, timestamp: ts, nonce, body: body ?? "", secret });
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token,
    "X-RAH-Timestamp": ts, "X-RAH-Nonce": nonce, "X-RAH-Signature": sig,
    "Origin": ORIGIN,
  };
}

test("health returns pairingActive=false initially and paired=false", async () => {
  const r = await fetch(baseUrl + "/v1/health", { headers: { Origin: ORIGIN } });
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.paired, false);
});

test("wrong pairing code is rejected", async () => {
  newPairing(); // generate code, we don't know it
  const r = await fetch(baseUrl + "/v1/pair", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ code: "000000" }) });
  assert.notEqual(r.status, 200);
});

let deviceToken, hmacSecret;
test("correct pairing code succeeds and returns token+secret", async () => {
  const code = newPairing();
  const r = await fetch(baseUrl + "/v1/pair", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ code }) });
  const j = await r.json();
  assert.equal(r.status, 200); assert.ok(j.deviceToken); assert.ok(j.hmacSecret);
  deviceToken = j.deviceToken; hmacSecret = j.hmacSecret;
});

test("authenticated system status", async () => {
  _resetNonceCacheForTests();
  const r = await fetch(baseUrl + "/v1/system/status", { headers: signedHeaders({ method: "GET", path: "/v1/system/status", token: deviceToken, secret: hmacSecret }) });
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.paired, true); assert.ok(j.bridgeVersion);
});

test("files.list works inside approved root", async () => {
  const body = JSON.stringify({ path: approvedRoot });
  const r = await fetch(baseUrl + "/v1/files/list", { method: "POST", body, headers: signedHeaders({ method: "POST", path: "/v1/files/list", body, token: deviceToken, secret: hmacSecret }) });
  const j = await r.json();
  assert.equal(r.status, 200); assert.ok(j.items.find((i) => i.name === "hello.txt"));
});

test("path traversal is blocked", async () => {
  const body = JSON.stringify({ path: "/etc/passwd" });
  const r = await fetch(baseUrl + "/v1/files/list", { method: "POST", body, headers: signedHeaders({ method: "POST", path: "/v1/files/list", body, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r.status, 400);
});

test("prepare launch.url with unsafe scheme rejected at prepare time", async () => {
  const body1 = JSON.stringify({ capability: "launch.url", params: { url: "file:///etc/passwd" } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r1.status, 400);
});

test("prepare launch.url rejects http://", async () => {
  const body1 = JSON.stringify({ capability: "launch.url", params: { url: "http://example.com" } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r1.status, 400);
});

test("execute without approvalId is rejected for approval-required capability", async () => {
  const target = path.join(approvedRoot, "should-not-be-created");
  const body1 = JSON.stringify({ capability: "files.createFolder", params: { target } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  const body2 = JSON.stringify({ jobId: j1.job.id, confirmationToken: j1.confirmationToken });
  const r2 = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: body2, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: body2, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 403);
  assert.ok(!fs.existsSync(target));
});

test("execute files.createFolder with approval + token succeeds", async () => {
  const target = path.join(approvedRoot, "new-folder");
  const body1 = JSON.stringify({ capability: "files.createFolder", params: { target } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  assert.ok(j1.confirmationToken);
  const body2 = JSON.stringify({ jobId: j1.job.id, approvalId: "test-approval", confirmationToken: j1.confirmationToken });
  const r2 = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: body2, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: body2, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 200);
  assert.ok(fs.statSync(target).isDirectory());
});

test("execute rejects extra override fields (path swap attempt)", async () => {
  const goodTarget = path.join(approvedRoot, "approved-folder");
  const evilTarget = path.join(approvedRoot, "evil-folder");
  const body1 = JSON.stringify({ capability: "files.createFolder", params: { target: goodTarget } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  const body2 = JSON.stringify({ jobId: j1.job.id, approvalId: "a", confirmationToken: j1.confirmationToken, target: evilTarget });
  const r2 = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: body2, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: body2, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 400);
  assert.ok(!fs.existsSync(evilTarget));
  assert.ok(!fs.existsSync(goodTarget));
});

test("execute rejects missing/wrong/reused confirmation token", async () => {
  const target = path.join(approvedRoot, "token-folder");
  const body1 = JSON.stringify({ capability: "files.createFolder", params: { target } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  // Missing token
  const bMissing = JSON.stringify({ jobId: j1.job.id, approvalId: "a" });
  const rMissing = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: bMissing, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: bMissing, token: deviceToken, secret: hmacSecret }) });
  assert.equal(rMissing.status, 403);
  // Wrong token
  const bWrong = JSON.stringify({ jobId: j1.job.id, approvalId: "a", confirmationToken: "not-the-real-token" });
  const rWrong = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: bWrong, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: bWrong, token: deviceToken, secret: hmacSecret }) });
  assert.equal(rWrong.status, 403);
  // Correct → succeeds
  const bOk = JSON.stringify({ jobId: j1.job.id, approvalId: "a", confirmationToken: j1.confirmationToken });
  const rOk = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: bOk, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: bOk, token: deviceToken, secret: hmacSecret }) });
  assert.equal(rOk.status, 200);
  // Reused → job no longer pending
  const rReuse = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: bOk, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: bOk, token: deviceToken, secret: hmacSecret }) });
  assert.notEqual(rReuse.status, 200);
});

test("actions/cancel blocks subsequent execute", async () => {
  const target = path.join(approvedRoot, "cancel-folder");
  const body1 = JSON.stringify({ capability: "files.createFolder", params: { target } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  const bc = JSON.stringify({ jobId: j1.job.id });
  const rc = await fetch(baseUrl + "/v1/actions/cancel", { method: "POST", body: bc, headers: signedHeaders({ method: "POST", path: "/v1/actions/cancel", body: bc, token: deviceToken, secret: hmacSecret }) });
  assert.equal(rc.status, 200);
  const bx = JSON.stringify({ jobId: j1.job.id, approvalId: "a", confirmationToken: j1.confirmationToken });
  const rx = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: bx, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: bx, token: deviceToken, secret: hmacSecret }) });
  assert.equal(rx.status, 409);
  assert.ok(!fs.existsSync(target));
});

test("emergency stop blocks actions until resume", async () => {
  // stop
  const r0 = await fetch(baseUrl + "/v1/emergency-stop", { method: "POST", body: "", headers: signedHeaders({ method: "POST", path: "/v1/emergency-stop", body: "", token: deviceToken, secret: hmacSecret }) });
  assert.equal(r0.status, 200);
  const body = JSON.stringify({ path: approvedRoot });
  const r1 = await fetch(baseUrl + "/v1/files/list", { method: "POST", body, headers: signedHeaders({ method: "POST", path: "/v1/files/list", body, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r1.status, 423);
  const r2 = await fetch(baseUrl + "/v1/resume", { method: "POST", body: "", headers: signedHeaders({ method: "POST", path: "/v1/resume", body: "", token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 200);
  const r3 = await fetch(baseUrl + "/v1/files/list", { method: "POST", body, headers: signedHeaders({ method: "POST", path: "/v1/files/list", body, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r3.status, 200);
  assert.equal(emergency.isStopped(), false);
});

test("screenshot.capture returns not_implemented", async () => {
  const body = JSON.stringify({});
  // Need prepare -> execute for a disabled capability: prepare should refuse
  const r = await fetch(baseUrl + "/v1/screenshot/capture", { method: "POST", body, headers: signedHeaders({ method: "POST", path: "/v1/screenshot/capture", body, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r.status, 501);
});

test("origin not on allowlist is rejected", async () => {
  const r = await fetch(baseUrl + "/v1/system/status", { headers: { Origin: "https://evil.example.com" } });
  assert.equal(r.status, 403);
});

test("health without Origin is allowed (local status.cmd script)", async () => {
  const r = await fetch(baseUrl + "/v1/health");
  assert.equal(r.status, 200);
});

test("health with disallowed Origin is rejected", async () => {
  const r = await fetch(baseUrl + "/v1/health", { headers: { Origin: "https://evil.example.com" } });
  assert.equal(r.status, 403);
});

test("OPTIONS preflight includes Private Network Access header", async () => {
  const r = await fetch(baseUrl + "/v1/system/status", { method: "OPTIONS", headers: { Origin: "http://localhost:8080", "Access-Control-Request-Method": "GET", "Access-Control-Request-Private-Network": "true" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-private-network"), "true");
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:8080");
});

test("OPTIONS preflight WITHOUT PNA request header omits PNA response header", async () => {
  const r = await fetch(baseUrl + "/v1/system/status", { method: "OPTIONS", headers: { Origin: "http://localhost:8080", "Access-Control-Request-Method": "GET" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-private-network"), null);
});

test("no-Origin health response does not emit an empty ACAO header", async () => {
  const r = await fetch(baseUrl + "/v1/health");
  assert.equal(r.status, 200);
  // Header must be absent (not an empty string) for CLI callers with no Origin.
  assert.equal(r.headers.get("access-control-allow-origin"), null);
});

test("prepare canonicalizes relative/lexical path into stored job params", async () => {
  const rel = path.join(approvedRoot, "subdir", "..", "canon-folder");
  const expected = path.join(approvedRoot, "canon-folder");
  const body1 = JSON.stringify({ capability: "files.createFolder", params: { target: rel } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.job.params.target, expected);
  const body2 = JSON.stringify({ jobId: j1.job.id, approvalId: "a", confirmationToken: j1.confirmationToken });
  const r2 = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: body2, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: body2, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 200);
  assert.ok(fs.statSync(expected).isDirectory());
});

test("prepare rejects out-of-root path at prepare time", async () => {
  const body1 = JSON.stringify({ capability: "files.createFolder", params: { target: "/etc/rah-should-not-exist" } });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r1.status, 400);
  const j = await r1.json();
  assert.equal(j.error, "path_not_allowed");
});

test("prepare rejects symlink-ancestor destination at prepare time", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rah-outside-prep-"));
  const link = path.join(approvedRoot, "prep-link");
  try { fs.symlinkSync(outside, link, "dir"); }
  catch (e) { if (e.code === "EPERM") return; throw e; }
  try {
    const evil = path.join(link, "escaped");
    const body1 = JSON.stringify({ capability: "files.createFolder", params: { target: evil } });
    const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
    assert.equal(r1.status, 400);
    const j = await r1.json();
    assert.equal(j.error, "path_not_allowed");
    assert.ok(!fs.existsSync(path.join(outside, "escaped")));
  } finally {
    try { fs.unlinkSync(link); } catch { /* */ }
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("disconnect revokes credentials", async () => {
  const r = await fetch(baseUrl + "/v1/disconnect", { method: "POST", body: "", headers: signedHeaders({ method: "POST", path: "/v1/disconnect", body: "", token: deviceToken, secret: hmacSecret }) });
  assert.equal(r.status, 200);
  // Any subsequent authenticated call with old token must fail (428 pairing required)
  const r2 = await fetch(baseUrl + "/v1/system/status", { headers: signedHeaders({ method: "GET", path: "/v1/system/status", token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 428);
  // Response must not leak the new pairing code
  const body = await r.json();
  assert.equal(body.disconnected, true);
  assert.ok(!("code" in body) && !("pairingCode" in body));
});
