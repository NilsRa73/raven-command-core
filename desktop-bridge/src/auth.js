import crypto from "node:crypto";
import { MAX_REQUEST_TIMESTAMP_SKEW_MS } from "./protocol.js";

// Simple LRU-ish nonce cache to defeat replay for the skew window.
const seen = new Map();
const NONCE_TTL_MS = MAX_REQUEST_TIMESTAMP_SKEW_MS * 2;

function pruneNonces(now) {
  for (const [n, t] of seen) if (now - t > NONCE_TTL_MS) seen.delete(n);
}

export class AuthError extends Error {
  constructor(msg, status = 401) { super(msg); this.status = status; }
}

export function signRequest({ method, path: p, timestamp, nonce, body, secret }) {
  const bodyHash = crypto.createHash("sha256").update(body ?? "").digest("hex");
  const canonical = [method.toUpperCase(), p, timestamp, nonce, bodyHash].join("\n");
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export function verifyRequest({ req, rawBody, expectedToken, expectedSecret }) {
  const now = Date.now();
  const auth = req.headers["authorization"];
  const ts = req.headers["x-rah-timestamp"];
  const nonce = req.headers["x-rah-nonce"];
  const sig = req.headers["x-rah-signature"];

  if (!auth || !auth.startsWith("Bearer ")) throw new AuthError("Missing bearer token");
  const token = auth.slice(7);
  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AuthError("Invalid token");

  if (!ts || !nonce || !sig) throw new AuthError("Missing signing headers");
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) throw new AuthError("Invalid timestamp");
  if (Math.abs(now - tsNum) > MAX_REQUEST_TIMESTAMP_SKEW_MS) throw new AuthError("Request too old or too new");

  pruneNonces(now);
  if (seen.has(nonce)) throw new AuthError("Replayed nonce", 401);
  seen.set(nonce, now);

  const expected = signRequest({
    method: req.method,
    path: new URL(req.url, "http://localhost").pathname,
    timestamp: ts,
    nonce,
    body: rawBody ?? "",
    secret: expectedSecret,
  });
  const sA = Buffer.from(sig);
  const sB = Buffer.from(expected);
  if (sA.length !== sB.length || !crypto.timingSafeEqual(sA, sB)) throw new AuthError("Invalid signature");
}

export function _resetNonceCacheForTests() { seen.clear(); }
