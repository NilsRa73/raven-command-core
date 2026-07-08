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
import { createJob, getJob, approveJob, updateJob, publicJob } from "./jobs.js";
import { PathContainmentError, assertContained } from "./paths.js";
import { UnsafeUrlError, assertSafeUrl } from "./urlCheck.js";

// Strict origin allowlist (no env-based expansion — the bridge only trusts
// these fixed browser origins):
//  - exact production Raven Command URL
//  - exact Lovable preview URL for this project
//  - localhost / 127.0.0.1 with any port (local dev)
const ALLOWED_ORIGINS = new Set([
  "https://raven-command-core.lovable.app",
  "https://id-preview--07b00439-0796-4d84-82a8-74f3aef8cb74.lovable.app",
]);
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  return false;
}

// Base CORS headers for actual responses. Never emits an empty
// Access-Control-Allow-Origin (that confuses browsers); when the caller has
// no Origin — e.g. the local status.cmd curl script — we omit the ACAO
// header entirely.
function corsHeaders(origin, extra = {}) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-RAH-Timestamp, X-RAH-Nonce, X-RAH-Signature",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin, Access-Control-Request-Private-Network",
    ...extra,
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Preflight response headers. Access-Control-Allow-Private-Network is
// emitted ONLY when the browser explicitly asks for PNA on this preflight.
function preflightHeaders(origin, req) {
  const headers = corsHeaders(origin);
  if (String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true") {
    headers["Access-Control-Allow-Private-Network"] = "true";
  }
  return headers;
}

let pairingSession = null; // { code, expiresAt }

function newPairing() {
  const code = generatePairingCode();
  pairingSession = { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS };
  return code;
}

// Called by /v1/disconnect. Prints the code to the LOCAL bridge console only;
// never returns it over HTTP.
function startFreshPairingSession() {
  const code = newPairing();
  process.stdout.write(
    "\n  RE-PAIRING REQUESTED FROM BROWSER\n" +
    "  Previous device credentials have been revoked.\n" +
    "  Enter this six-digit code in Raven Command -> Connections:\n\n" +
    "        " + code + "\n\n" +
    "  Code expires in 5 minutes.\n\n"
  );
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

// ---------- Per-capability parameter normalizers ----------
// Each returns the ONLY fields we will persist on the job and later act on.
// File/folder paths are canonicalized against the approved roots at prepare
// time — a relative or lexical path is resolved, an outside-root path is
// rejected, and a symlink-through-an-ancestor destination is rejected. The
// resolved absolute paths are what /actions/execute later runs, so the
// public job/approval preview shows exactly what will happen.
// Extra client fields are silently dropped here.
const CAP_NORMALIZERS = {
  "files.createFolder": (p, roots) => ({ target: assertContained(String(p?.target ?? ""), roots) }),
  "files.rename":       (p, roots) => ({
    from: assertContained(String(p?.from ?? ""), roots),
    to:   assertContained(String(p?.to   ?? ""), roots),
  }),
  "files.copy":         (p, roots) => ({
    from: assertContained(String(p?.from ?? ""), roots),
    to:   assertContained(String(p?.to   ?? ""), roots),
  }),
  "files.move":         (p, roots) => ({
    from: assertContained(String(p?.from ?? ""), roots),
    to:   assertContained(String(p?.to   ?? ""), roots),
  }),
  "files.recycle":      (p, roots) => ({ target: assertContained(String(p?.target ?? ""), roots) }),
  "launch.explorer":    (p, roots) => ({ target: assertContained(String(p?.target ?? ""), roots) }),
  "launch.url":         (p) => {
    const url = String(p?.url ?? "");
    assertSafeUrl(url); // fail early at prepare time
    return { url };
  },
};

// Whitelist of top-level fields we accept on /actions/execute.
// Anything else (target, url, from, to, etc.) is rejected — the caller
// must not be able to change what they approved.
const EXECUTE_ALLOWED_KEYS = new Set(["jobId", "approvalId", "confirmationToken"]);

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

  if (p === `/${PROTOCOL_VERSION}/disconnect` && method === "POST") {
    // Revoke on-disk credentials, then start a fresh pairing session whose
    // code is only printed on the local bridge console.
    cfg.deviceToken = null;
    cfg.hmacSecret = null;
    cfg.pairedAt = null;
    cfg.pairedOrigin = null;
    saveConfig(cfg);
    startFreshPairingSession();
    auditLog({ event: "disconnect", origin });
    return json(res, 200, { ok: true, disconnected: true, pairingRequired: true }, corsHeaders(origin));
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
      const normalizer = CAP_NORMALIZERS[cap];
      if (!normalizer) return json(res, 400, { error: "capability_not_executable" }, corsHeaders(origin));
      let normalized;
      try { normalized = normalizer(body.params ?? body, cfg.approvedRoots); }
      catch (err) {
        if (err instanceof UnsafeUrlError) return json(res, 400, { error: "unsafe_url", message: err.message }, corsHeaders(origin));
        if (err instanceof PathContainmentError) return json(res, 400, { error: "path_not_allowed", message: err.message }, corsHeaders(origin));
        throw err;
      }
      const j = createJob(cap, normalized);
      auditLog({ event: "actions.prepare", capability: cap, jobId: j.id, params: normalized });
      // Return the one-time confirmationToken here and only here.
      return json(res, 200, {
        job: publicJob(j),
        confirmationToken: j.confirmationToken,
        risk: spec.risk,
        requiresApproval: spec.requiresApproval,
        expiresAt: j.expiresAt,
      }, corsHeaders(origin));
    }
    if (p === `/${PROTOCOL_VERSION}/actions/cancel` && method === "POST") {
      const j = getJob(String(body.jobId || ""));
      if (!j) return json(res, 404, { error: "unknown_job" }, corsHeaders(origin));
      if (j.status === "done" || j.status === "running") {
        return json(res, 409, { error: "cannot_cancel_active_job", status: j.status }, corsHeaders(origin));
      }
      updateJob(j.id, { status: "cancelled", finishedAt: Date.now(), tokenConsumed: true, confirmationToken: null });
      auditLog({ event: "actions.cancel", jobId: j.id });
      return json(res, 200, { job: publicJob(getJob(j.id)) }, corsHeaders(origin));
    }
    if (p === `/${PROTOCOL_VERSION}/actions/execute` && method === "POST") {
      // Reject unknown override fields — nothing about the action may
      // change between prepare and execute.
      const extraKeys = Object.keys(body).filter((k) => !EXECUTE_ALLOWED_KEYS.has(k));
      if (extraKeys.length > 0) {
        auditLog({ event: "actions.execute", ok: false, reason: "extra_fields", extraKeys });
        return json(res, 400, { error: "extra_fields_not_allowed", fields: extraKeys }, corsHeaders(origin));
      }
      const j = getJob(String(body.jobId || ""));
      if (!j) return json(res, 404, { error: "unknown_job" }, corsHeaders(origin));
      if (j.status === "cancelled") return json(res, 409, { error: "job_cancelled" }, corsHeaders(origin));
      if (j.status !== "prepared") return json(res, 409, { error: "job_not_pending", status: j.status }, corsHeaders(origin));
      if (Date.now() > j.expiresAt) {
        updateJob(j.id, { status: "expired", finishedAt: Date.now(), tokenConsumed: true, confirmationToken: null });
        return json(res, 410, { error: "job_expired" }, corsHeaders(origin));
      }
      const spec = CAPABILITIES[j.capability];
      if (!spec) return json(res, 400, { error: "unknown_capability" }, corsHeaders(origin));
      if (spec.disabled) return json(res, 403, { error: "capability_disabled" }, corsHeaders(origin));
      if (spec.requiresApproval && !body.approvalId) return json(res, 403, { error: "approval_required" }, corsHeaders(origin));

      // Confirmation token — one-time, timing-safe compare, then consume.
      const provided = String(body.confirmationToken || "");
      if (!provided || j.tokenConsumed || !j.confirmationToken) {
        return json(res, 403, { error: "invalid_confirmation_token" }, corsHeaders(origin));
      }
      const a = Buffer.from(provided); const b = Buffer.from(j.confirmationToken);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return json(res, 403, { error: "invalid_confirmation_token" }, corsHeaders(origin));
      }
      updateJob(j.id, { tokenConsumed: true, confirmationToken: null });
      approveJob(j.id, body.approvalId ?? "auto");
      updateJob(j.id, { status: "running", startedAt: Date.now() });

      // Everything below reads ONLY the stored, normalized params.
      const params = j.params || {};
      let result;
      try {
        switch (j.capability) {
          case "files.createFolder": result = files.createFolder(params.target, cfg.approvedRoots); break;
          case "files.rename":       result = files.renameEntry(params.from, params.to, cfg.approvedRoots); break;
          case "files.copy":         result = files.copyEntry(params.from, params.to, cfg.approvedRoots); break;
          case "files.move":         result = files.moveEntry(params.from, params.to, cfg.approvedRoots); break;
          case "files.recycle":      result = await files.recycleEntry(params.target, cfg.approvedRoots); break;
          case "launch.explorer":    result = await launch.openInExplorer(params.target, cfg.approvedRoots); break;
          case "launch.url":         result = await launch.openUrl(params.url); break;
          default: throw new Error("Capability not executable: " + j.capability);
        }
        updateJob(j.id, { status: "done", finishedAt: Date.now(), result });
        auditLog({ event: "actions.execute", capability: j.capability, jobId: j.id, ok: true });
        return json(res, 200, { job: publicJob(getJob(j.id)) }, corsHeaders(origin));
      } catch (err) {
        updateJob(j.id, { status: "error", finishedAt: Date.now(), error: err.message });
        auditLog({ event: "actions.execute", capability: j.capability, jobId: j.id, ok: false, error: err.message });
        return json(res, 400, { error: err.message, job: publicJob(getJob(j.id)) }, corsHeaders(origin));
      }
    }
    if (p === `/${PROTOCOL_VERSION}/jobs/` && method === "GET") {
      return json(res, 400, { error: "missing_job_id" }, corsHeaders(origin));
    }
    const jobMatch = p.match(new RegExp(`^/${PROTOCOL_VERSION}/jobs/([\\w-]+)$`));
    if (jobMatch && method === "GET") {
      const j = getJob(jobMatch[1]);
      if (!j) return json(res, 404, { error: "unknown_job" }, corsHeaders(origin));
      return json(res, 200, { job: publicJob(j) }, corsHeaders(origin));
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
      const isHealth = url.pathname === `/${PROTOCOL_VERSION}/health`;

      // Preflight — must include Private Network Access grant so Chrome
      // permits the HTTPS dashboard to call this http://127.0.0.1 endpoint.
      if (req.method === "OPTIONS") {
        if (!isOriginAllowed(origin)) { res.writeHead(403).end(); return; }
        res.writeHead(204, preflightHeaders(origin, req)); res.end(); return;
      }

      // Health is reachable without an Origin (e.g. local status.cmd script
      // using curl). Browser requests from disallowed origins are rejected.
      if (isHealth) {
        if (origin && !isOriginAllowed(origin)) {
          res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "origin_not_allowed" }));
          return;
        }
      } else {
        if (!isOriginAllowed(origin)) {
          res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "origin_not_allowed" }));
          return;
        }
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
