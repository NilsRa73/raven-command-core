import { SAFE_URL_SCHEMES, BLOCKED_URL_SCHEMES } from "./protocol.js";

export class UnsafeUrlError extends Error { constructor(m) { super(m); this.code = "UNSAFE_URL"; } }

export function assertSafeUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new UnsafeUrlError("Not a valid URL"); }
  const scheme = u.protocol.toLowerCase();
  if (BLOCKED_URL_SCHEMES.includes(scheme)) throw new UnsafeUrlError("Blocked scheme: " + scheme);
  if (!SAFE_URL_SCHEMES.includes(scheme)) throw new UnsafeUrlError("Scheme not in allowlist: " + scheme);
  return u.toString();
}
