// Local AI proxy tests — RAH Desktop Bridge v0.2.0.
// Verifies authentication is required, the route table is loopback-only,
// model discovery + streaming chat are proxied, and the browser client
// cannot force an arbitrary upstream host.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const testCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "rah-bridge-localai-"));
process.env.RAH_BRIDGE_CONFIG_DIR = testCfgDir;

const { createServer, newPairing } = await import("../src/server.js");
const { loadConfig, saveConfig } = await import("../src/config.js");
const { signRequest, _resetNonceCacheForTests } = await import("../src/auth.js");
const { matchLocalAiRoute, listLocalAiRoutes } = await import("../src/localai.js");

const ORIGIN = "http://localhost:8080";
const cfg = loadConfig();
cfg.approvedRoots = [];
saveConfig(cfg);

// Fake LM Studio + Ollama on ephemeral loopback ports.
let lmPort, olPort, lmSeen = [], olSeen = [];
const lmServer = http.createServer((req, res) => {
  lmSeen.push({ method: req.method, url: req.url });
  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "google/gemma-4-e4b" }] }));
  } else if (req.url === "/v1/chat/completions") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    res.end("data: [DONE]\n\n");
  } else res.writeHead(404).end();
});
const olServer = http.createServer((req, res) => {
  olSeen.push({ method: req.method, url: req.url });
  if (req.url === "/api/tags") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }] }));
  } else if (req.url === "/api/chat") {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ message: { content: "hi" } }) + "\n");
    res.end(JSON.stringify({ done: true }) + "\n");
  } else res.writeHead(404).end();
});

// Override protocol constants before the bridge starts by rewriting the
// module — instead, we point the shared constants at the fake servers by
// monkey-patching after import.
const proto = await import("../src/protocol.js");

let bridge;
let baseUrl;
let deviceToken, hmacSecret;

before(async () => {
  await new Promise((r) => lmServer.listen(0, "127.0.0.1", r));
  await new Promise((r) => olServer.listen(0, "127.0.0.1", r));
  lmPort = lmServer.address().port;
  olPort = olServer.address().port;
  // Redirect the fixed loopback bases to our fakes.
  proto.LOCAL_AI_LMSTUDIO_BASE; // touch to ensure loaded
  // We can't reassign an ES module binding — instead, rebuild the route
  // table via a module replacement. Use env-injected overrides supported
  // by the module by re-importing after setting URL constants via a shim.
  // Simplest: replace the getter by re-requiring after patching the module
  // exports object using Object.defineProperty.
  Object.defineProperty(proto, "LOCAL_AI_LMSTUDIO_BASE", { value: `http://127.0.0.1:${lmPort}/v1`, configurable: true });
  Object.defineProperty(proto, "LOCAL_AI_OLLAMA_BASE",  { value: `http://127.0.0.1:${olPort}`, configurable: true });

  bridge = createServer(cfg);
  await new Promise((r) => bridge.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${bridge.address().port}`;

  const code = newPairing();
  const r = await fetch(baseUrl + "/v1/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ code }),
  });
  const j = await r.json();
  deviceToken = j.deviceToken; hmacSecret = j.hmacSecret;
});

after(() => {
  bridge.close(); lmServer.close(); olServer.close();
  fs.rmSync(testCfgDir, { recursive: true, force: true });
});

function signedHeaders({ method, path: p, body }) {
  const ts = String(Date.now()); const nonce = crypto.randomUUID();
  const sig = signRequest({ method, path: p, timestamp: ts, nonce, body: body ?? "", secret: hmacSecret });
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + deviceToken,
    "X-RAH-Timestamp": ts, "X-RAH-Nonce": nonce, "X-RAH-Signature": sig,
    "Origin": ORIGIN,
  };
}

test("route table contains only the four fixed loopback endpoints", () => {
  const routes = listLocalAiRoutes().sort();
  assert.deepEqual(routes, [
    "GET /v1/localai/lmstudio/models",
    "GET /v1/localai/ollama/tags",
    "POST /v1/localai/lmstudio/chat",
    "POST /v1/localai/ollama/chat",
  ]);
});

test("arbitrary path is not routable (no open proxy)", () => {
  assert.equal(matchLocalAiRoute("POST", "/v1/localai/http://evil.com"), null);
  assert.equal(matchLocalAiRoute("POST", "/v1/localai/lmstudio/chat?url=http://evil.com"), null);
  assert.equal(matchLocalAiRoute("GET",  "/v1/proxy"), null);
});

test("unauthenticated proxy call is rejected", async () => {
  const r = await fetch(baseUrl + "/v1/localai/lmstudio/models", { headers: { Origin: ORIGIN } });
  assert.notEqual(r.status, 200);
});

test("LM Studio model discovery via bridge", async () => {
  _resetNonceCacheForTests();
  const r = await fetch(baseUrl + "/v1/localai/lmstudio/models", {
    headers: signedHeaders({ method: "GET", path: "/v1/localai/lmstudio/models" }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.data?.some((m) => m.id === "google/gemma-4-e4b"));
});

test("Ollama tags via bridge", async () => {
  _resetNonceCacheForTests();
  const r = await fetch(baseUrl + "/v1/localai/ollama/tags", {
    headers: signedHeaders({ method: "GET", path: "/v1/localai/ollama/tags" }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.models?.some((m) => m.name === "llama3.2:3b"));
});

test("LM Studio chat streams SSE through bridge", async () => {
  _resetNonceCacheForTests();
  const body = JSON.stringify({ model: "google/gemma-4-e4b", stream: true, messages: [{ role: "user", content: "hi" }] });
  const r = await fetch(baseUrl + "/v1/localai/lmstudio/chat", {
    method: "POST", body,
    headers: signedHeaders({ method: "POST", path: "/v1/localai/lmstudio/chat", body }),
  });
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.match(txt, /"delta"/);
});

test("Ollama chat streams NDJSON through bridge", async () => {
  _resetNonceCacheForTests();
  const body = JSON.stringify({ model: "llama3.2:3b", stream: true, messages: [{ role: "user", content: "hi" }] });
  const r = await fetch(baseUrl + "/v1/localai/ollama/chat", {
    method: "POST", body,
    headers: signedHeaders({ method: "POST", path: "/v1/localai/ollama/chat", body }),
  });
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.match(txt, /"content":"hi"/);
});

test("upstream offline returns local_ai_offline JSON, not a hang", async () => {
  // Close the LM Studio fake and confirm a clean 502.
  await new Promise((r) => lmServer.close(r));
  _resetNonceCacheForTests();
  const r = await fetch(baseUrl + "/v1/localai/lmstudio/models", {
    headers: signedHeaders({ method: "GET", path: "/v1/localai/lmstudio/models" }),
  });
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.equal(j.error, "local_ai_offline");
  assert.equal(j.provider, "lmstudio");
});