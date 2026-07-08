import http from "node:http";
import crypto from "node:crypto";
import { BRIDGE_VERSION, PROTOCOL_VERSION, DEFAULT_PORT, MAX_BODY_BYTES, PAIRING_CODE_TTL_MS, CAPABILITIES, DISABLED_CAPABILITIES } from "./protocol.js";
import { loadConfig, saveConfig, resetConfig, generatePairingCode, generateToken } from "./config.js";
import { verifyRequest, AuthError } from "./auth.js";
import { auditLog, readRecent } from "./audit.js";
import { rateLimit } from "./rateLimit.js";
import * as emergency from "./emergency.js";
import * as files from "./files.js";
import * as launch from "./launch.js";
import { systemStatus } from "./system.js";
import { createJob, getJob, approveJob, updateJob } from "./jobs.js";
import { PathContainmentError } from "./paths.js";
import { UnsafeUrlError } from "./urlCheck.js";

const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/raven-command-core\.lovable\.app$/,
  /^https:\/\/id-preview--[a-f0-9-]+\.lovable\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/,
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-RAH-Timestamp, X-RAH-Nonce, X-RAH-Signature",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

let pairingSession = null; // { code, expiresAt }

function newPairing() {
  const code = generatePairingCode();
  pairingSession = { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS };
  return code;
}

function json(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...extraHeaders });
  res.end(data);
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let total = 0; const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function requireAuth(req, rawBody, cfg) {
  if (!cfg.deviceToken || !cfg.hmacSecret) throw new AuthError("Pairing required", 428);
  verifyRequest({ req, rawBody, expectedToken: cfg.deviceToken, expectedSecret: cfg.hmacSecret });
}

async function handleRoute(req, res, url, rawBody, cfg, origin) {
  const p = url.pathname;
  const method = req.method || "GET";
  const clientKey = origin + "|" + (req.socket?.remoteAddress ?? "");

  // Unauthenticated: health, pair
  if (p === `/${PROTOCOL_VERSION}/health` && method === "GET") {
    return json(res, 200, {
      ok: true,
      bridgeVersion: BRIDGE_VERSION,
      protocol: PROTOCOL_VERSION,
      paired: !!cfg.deviceToken,
      pairingActive: !!pairingSession && pairingSession.expiresAt > Date.now(),
      emergencyStopped: emergency.isStopped(),
    }, corsHeaders(origin));
  }

  if (p === `/${PROTOCOL_VERSION}/pair` && method === "POST") {
    if (!rateLimit("pair:" + clientKey, 5, 60_000)) return json(res, 429, { error: "rate_limited" }, corsHeaders(origin));
    let body; try { body = JSON.parse(rawBody || "{}"); } catch { return json(res, 400, { error: "bad_json" }, corsHeaders(origin)); }
    const code = String(body.code || "");
    if (!pairingSession || pairingSession.expiresAt < Date.now()) {
      auditLog({ event: "pair.failed", reason: "no_active_session" });
      return json(res, 403, { error: "no_active_pairing" }, corsHeaders(origin));
    }
    const a = Buffer.from(code); const b = Buffer.from(pairingSession.code);
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
      auditLog({ event: "pair.failed", reason: "wrong_code" });
      return json(res, 403, { error: "wrong_code" }, corsHeaders(origin));
    }
    const token = generateToken(); const secret = generateToken();
    cfg.deviceToken = token; cfg.hmacSecret = secret;
    cfg.pairedAt = new Date().toISOString(); cfg.pairedOrigin = origin;
    saveConfig(cfg);
    pairingSession = null;
    auditLog({ event: "pair.success", origin });
    return json(res, 200, { ok: true, deviceToken: token, hmacSecret: secret, bridgeVersion: BRIDGE_VERSION }, corsHeaders(origin));
  }

  // Everything below requires auth.
  try { requireAuth(req, rawBody, cfg); }
  catch (err) {
    if (err instanceof AuthError) return json(res, err.status || 401, { error: err.message }, corsHeaders(origin));
    throw err;
  }

  if (!rateLimit("auth:" + clientKey, 60, 10_000)) return json(res, 429, { error: "rate_limited" }, corsHeaders(origin));

  if (p === `/${PROTOCOL_VERSION}/capabilities` && method === "GET") {
    return json(res, 200, { capabilities: CAPABILITIES, disabled: DISABLED_CAPABILITIES, approvedRoots: cfg.approvedRoots }, corsHeaders(origin));
  }

  if (p === `/${PROTOCOL_VERSION}/system/status` && method === "GET") {
    const status = systemStatus();
    status.paired = true; status.emergencyStopped = emergency.isStopped();
    status.approvedRootsCount = cfg.approvedRoots.length;
    auditLog({ event: "system.status" });
    return json(res, 200, status, corsHeaders(origin));
  }

  if (p === `/${PROTOCOL_VERSION}/emergency-stop` && method === "POST") {
    emergency.stop(); auditLog({ event: "emergency.stop" });
    return json(res, 200, { ok: true, stopped: true }, corsHeaders(origin));
  }
  if (p === `/${PROTOCOL_VERSION}/resume` && method === "POST") {
    emergency.resume(); auditLog({ event: "emergency.resume" });
    return json(res, 200, { ok: true, stopped: false }, corsHeaders(origin));
  }
  if (p === `/${PROTOCOL_VERSION}/audit/recent` && method === "GET") {
    return json(res, 200, { entries: readRecent(100) }, corsHeaders(origin));
  }

  // Blocked when emergency stopped, except stop/resume/status/health above.
  if (emergency.isStopped()) {
    return json(res, 423, { error: "emergency_stopped" }, corsHeaders(origin));
  }

  let body = {}; try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { return json(res, 400, { error: "bad_json" }, corsHeaders(origin)); }

  try {
    if (p === `/${PROTOCOL_VERSION}/files/list` && method === "POST") {
      const r = files.listFolder(body.path, cfg.approvedRoots);
      auditLog({ event: "files.list", target: body.path, count: r.items.length });
      return json(res, 200, r, corsHeaders(origin));
    }
    if (p === `/${PROTOCOL_VERSION}/files/search` && method === "POST") {
      const r = files.searchFiles(body, cfg.approvedRoots);
      auditLog({ event: "files.search", root: body.root, count: r.results.length });
      return json(res, 200, r, corsHeaders(origin));
    }
    if (p === `/${PROTOCOL_VERSION}/files/read-text` && method === "POST") {
      const r = files.readTextFile(body.path, cfg.approvedRoots);
      auditLog({ event: "files.readText", target: body.path, size: r.size });
      return json(res, 200, { ...r, text: r.text }, corsHeaders(origin));
    }

    // ACTIONS: prepare / execute / cancel
    if (p === `/${PROTOCOL_VERSION}/actions/prepare` && method === "POST") {
      const cap = String(body.capability || "");
      const spec = CAPABILITIES[cap];
      if (!spec) return json(res, 400, { error: "unknown_capability" }, corsHeaders(origin));
      if (spec.disabled) return json(res, 403, { error: "capability_disabled" }, corsHeaders(origin));
      const j = createJob(cap, body.target ?? null);
      auditLog({ event: "actions.prepare", capability: cap, jobId: j.id });
      return json(res, 200, { job: j, risk: spec.risk, requiresApproval: spec.requiresApproval }, corsHeaders(origin));
    }
    if (p === `/${PROTOCOL_VERSION}/actions/execute` && method === "POST") {
      const j = getJob(String(body.jobId || ""));
      if (!j) return json(res, 404, { error: "unknown_job" }, corsHeaders(origin));
      const spec = CAPABILITIES[j.capability];
      if (!spec) return json(res, 400, { error: "unknown_capability" }, corsHeaders(origin));
      if (spec.disabled) return json(res, 403, { error: "capability_disabled" }, corsHeaders(origin));
      if (spec.requiresApproval && !body.approvalId) return json(res, 403, { error: "approval_required" }, corsHeaders(origin));
      approveJob(j.id, body.approvalId ?? "auto");
      updateJob(j.id, { status: "running", startedAt: Date.now() });
      let result;
      try {
        const t = body.target ?? j.target;
        switch (j.capability) {
          case "files.createFolder": result = files.createFolder(t, cfg.approvedRoots); break;
          case "files.rename":       result = files.renameEntry(body.from, body.to, cfg.approvedRoots); break;
          case "files.copy":         result = files.copyEntry(body.from, body.to, cfg.approvedRoots); break;
          case "files.move":         result = files.moveEntry(body.from, body.to, cfg.approvedRoots); break;
          case "files.recycle":      result = await files.recycleEntry(t, cfg.approvedRoots); break;
          case "launch.explorer":    result = await launch.openInExplorer(t, cfg.approvedRoots); break;
          case "launch.url":         result = await launch.openUrl(body.url); break;
          default: throw new Error("Capability not executable: " + j.capability);
        }
        updateJob(j.id, { status: "done", finishedAt: Date.now(), result });
        auditLog({ event: "actions.execute", capability: j.capability, jobId: j.id, ok: true });
        return json(res, 200, { job: getJob(j.id) }, corsHeaders(origin));
      } catch (err) {
        updateJob(j.id, { status: "error", finishedAt: Date.now(), error: err.message });
        auditLog({ event: "actions.execute", capability: j.capability, jobId: j.id, ok: false, error: err.message });
        return json(res, 400, { error: err.message, job: getJob(j.id) }, corsHeaders(origin));
      }
    }
    if (p === `/${PROTOCOL_VERSION}/jobs/` && method === "GET") {
      return json(res, 400, { error: "missing_job_id" }, corsHeaders(origin));
    }
    const jobMatch = p.match(new RegExp(`^/${PROTOCOL_VERSION}/jobs/([\\w-]+)$`));
    if (jobMatch && method === "GET") {
      const j = getJob(jobMatch[1]);
      if (!j) return json(res, 404, { error: "unknown_job" }, corsHeaders(origin));
      return json(res, 200, { job: j }, corsHeaders(origin));
    }
    if (p === `/${PROTOCOL_VERSION}/screenshot/capture` && method === "POST") {
      auditLog({ event: "screenshot.capture", ok: false, reason: "not_implemented" });
      return json(res, 501, { error: "not_implemented", message: "Screenshot capture requires a native module and is not shipped in v0.1.0. Use Raven Screen Vision in the browser instead." }, corsHeaders(origin));
    }

    return json(res, 404, { error: "unknown_route", path: p }, corsHeaders(origin));
  } catch (err) {
    if (err instanceof PathContainmentError) return json(res, 400, { error: "path_not_allowed", message: err.message }, corsHeaders(origin));
    if (err instanceof UnsafeUrlError) return json(res, 400, { error: "unsafe_url", message: err.message }, corsHeaders(origin));
    return json(res, 500, { error: "internal_error", message: err.message }, corsHeaders(origin));
  }
}

export function createServer(cfg) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const origin = req.headers["origin"] || "";
      const allowed = isOriginAllowed(origin) || url.pathname === `/${PROTOCOL_VERSION}/health`;

      if (req.method === "OPTIONS") {
        if (!isOriginAllowed(origin)) { res.writeHead(403).end(); return; }
        res.writeHead(204, corsHeaders(origin)); res.end(); return;
      }
      if (!allowed) {
        res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "origin_not_allowed" }));
        return;
      }
      const rawBody = req.method === "GET" ? "" : await readBody(req);
      await handleRoute(req, res, url, rawBody, cfg, origin);
    } catch (err) {
      try {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "server_error", message: err.message }));
      } catch { /* headers already sent */ }
    }
  });
  return server;
}

export { newPairing };
