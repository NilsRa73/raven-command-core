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

test("prepare launch.url with unsafe scheme rejected at execute", async () => {
  // prepare
  const body1 = JSON.stringify({ capability: "launch.url" });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  assert.equal(r1.status, 200); const jobId = j1.job.id;
  // execute with file:// URL
  const body2 = JSON.stringify({ jobId, approvalId: "test-approval", url: "file:///etc/passwd" });
  const r2 = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: body2, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: body2, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 400);
});

test("execute without approvalId is rejected for approval-required capability", async () => {
  const body1 = JSON.stringify({ capability: "files.createFolder", target: path.join(approvedRoot, "should-not-be-created") });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  const body2 = JSON.stringify({ jobId: j1.job.id, target: path.join(approvedRoot, "should-not-be-created") });
  const r2 = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: body2, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: body2, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 403);
  assert.ok(!fs.existsSync(path.join(approvedRoot, "should-not-be-created")));
});

test("execute files.createFolder with approval succeeds", async () => {
  const target = path.join(approvedRoot, "new-folder");
  const body1 = JSON.stringify({ capability: "files.createFolder", target });
  const r1 = await fetch(baseUrl + "/v1/actions/prepare", { method: "POST", body: body1, headers: signedHeaders({ method: "POST", path: "/v1/actions/prepare", body: body1, token: deviceToken, secret: hmacSecret }) });
  const j1 = await r1.json();
  const body2 = JSON.stringify({ jobId: j1.job.id, approvalId: "test-approval", target });
  const r2 = await fetch(baseUrl + "/v1/actions/execute", { method: "POST", body: body2, headers: signedHeaders({ method: "POST", path: "/v1/actions/execute", body: body2, token: deviceToken, secret: hmacSecret }) });
  assert.equal(r2.status, 200);
  assert.ok(fs.statSync(target).isDirectory());
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
