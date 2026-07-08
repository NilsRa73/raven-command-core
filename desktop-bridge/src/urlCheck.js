import { SAFE_URL_SCHEMES, BLOCKED_URL_SCHEMES } from "./protocol.js";

export class UnsafeUrlError extends Error { constructor(m) { super(m); this.code = "UNSAFE_URL"; } }

// Reject C0/C1 control chars, whitespace, backslashes.
// Even a single \n or \r in an argv value can enable argument-injection tricks
// on some spawners; we refuse them outright.
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\s\\]/;

export function assertSafeUrl(input) {
  if (typeof input !== "string" || input.length === 0) throw new UnsafeUrlError("Missing URL");
  if (input.length > 2048) throw new UnsafeUrlError("URL too long");
  if (CONTROL_RE.test(input)) throw new UnsafeUrlError("URL contains control or whitespace characters");
  let u;
  try { u = new URL(input); } catch { throw new UnsafeUrlError("Not a valid URL"); }
  const scheme = u.protocol.toLowerCase();
  if (BLOCKED_URL_SCHEMES.includes(scheme)) throw new UnsafeUrlError("Blocked scheme: " + scheme);
  if (!SAFE_URL_SCHEMES.includes(scheme)) throw new UnsafeUrlError("Scheme not in allowlist: " + scheme);
  if (scheme !== "https:") throw new UnsafeUrlError("Only https:// URLs are allowed");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
  if (!u.hostname) throw new UnsafeUrlError("URL missing hostname");
  return u.toString();
}
