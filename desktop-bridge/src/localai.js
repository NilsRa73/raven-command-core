// Authenticated Local AI proxy — RAH Desktop Bridge v0.2.0.
//
// Proxies model discovery and streaming chat to LM Studio (OpenAI-compatible)
// and Ollama on THIS machine only. Destinations are hard-locked to loopback
// bases; no caller-supplied URL is ever forwarded.
//
// Prompt contents are NEVER logged. Audit records provider, endpoint type,
// upstream status, latency, and (if present) the model identifier.

import { auditLog } from "./audit.js";
import { LOCAL_AI_LMSTUDIO_BASE, LOCAL_AI_OLLAMA_BASE, PROTOCOL_VERSION } from "./protocol.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function assertLoopback(urlString) {
  const u = new URL(urlString);
  if (u.protocol !== "http:") throw new Error("non_http_upstream");
  if (!LOOPBACK_HOSTS.has(u.hostname)) throw new Error("non_loopback_upstream:" + u.hostname);
}

// Fixed routing table. Keys are `${method} ${path}`.
// Nothing here accepts a caller URL — the upstream is a closure over the
// baked-in constant so tests can prove no arbitrary destination is reachable.
function routeTable() {
  const P = `/${PROTOCOL_VERSION}/localai`;
  return {
    [`GET ${P}/lmstudio/models`]: {
      provider: "lmstudio", opType: "discover", method: "GET",
      upstream: () => `${LOCAL_AI_LMSTUDIO_BASE}/models`,
    },
    [`POST ${P}/lmstudio/chat`]: {
      provider: "lmstudio", opType: "chat", method: "POST",
      upstream: () => `${LOCAL_AI_LMSTUDIO_BASE}/chat/completions`,
    },
    [`GET ${P}/ollama/tags`]: {
      provider: "ollama", opType: "discover", method: "GET",
      upstream: () => `${LOCAL_AI_OLLAMA_BASE}/api/tags`,
    },
    [`POST ${P}/ollama/chat`]: {
      provider: "ollama", opType: "chat", method: "POST",
      upstream: () => `${LOCAL_AI_OLLAMA_BASE}/api/chat`,
    },
  };
}

export function matchLocalAiRoute(method, path) {
  const table = routeTable();
  return table[`${method} ${path}`] || null;
}

export function listLocalAiRoutes() {
  return Object.keys(routeTable());
}

export async function handleLocalAiProxy(route, req, res, rawBody, corsHeaders) {
  const started = Date.now();
  let upstreamUrl;
  try {
    upstreamUrl = route.upstream();
    assertLoopback(upstreamUrl);
  } catch (err) {
    const body = JSON.stringify({ error: "invalid_upstream", message: err.message });
    res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  // Extract just the model identifier for the audit log. Prompt bodies are
  // never inspected beyond this and never persisted.
  let model = null;
  if (route.method === "POST" && rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed.model === "string") model = parsed.model;
    } catch { /* opaque body — do not log */ }
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: route.method,
      headers: { "Content-Type": "application/json", "Accept": "*/*" },
      body: route.method === "POST" ? rawBody : undefined,
    });
  } catch (err) {
    auditLog({
      event: "localai.proxy",
      provider: route.provider, op: route.opType, model,
      status: null, ok: false, latencyMs: Date.now() - started,
      error: "upstream_unreachable",
    });
    const body = JSON.stringify({
      error: "local_ai_offline",
      provider: route.provider,
      message: `Bridge could not reach ${route.provider} at ${upstreamUrl}. Is the local server running?`,
      detail: err.message,
    });
    res.writeHead(502, { ...corsHeaders, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  res.writeHead(upstream.status, {
    ...corsHeaders,
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });

  if (upstream.body) {
    try {
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
      }
    } catch { /* client disconnect */ }
  }
  res.end();

  auditLog({
    event: "localai.proxy",
    provider: route.provider, op: route.opType, model,
    status: upstream.status, ok: upstream.ok, latencyMs: Date.now() - started,
  });
}