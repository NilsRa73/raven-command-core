// Deterministic SHA-256 hashing helpers for Screen Vision v0.3 frame
// integrity. Isomorphic: prefers Web Crypto (browser + Node 20+) and falls
// back to node:crypto when Web Crypto is unavailable. Never throws on bad
// input — returns `null` so upstream code can decide whether to persist
// evidence with a hash gap and label it clearly.

const HEX = "0123456789abcdef";

function toHex(uint8) {
  let out = "";
  for (let i = 0; i < uint8.length; i++) {
    const b = uint8[i];
    out += HEX[b >> 4] + HEX[b & 0x0f];
  }
  return out;
}

function coerceBytes(input) {
  if (input == null) return null;
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView && ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === "string") {
    // Support "data:*;base64,..." and plain strings (UTF-8).
    const m = /^data:[^;,]*;base64,(.*)$/i.exec(input);
    if (m) {
      const b64 = m[1];
      if (typeof atob === "function") {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
      return null;
    }
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(input);
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(input, "utf8"));
    return null;
  }
  return null;
}

export async function sha256Hex(input) {
  const bytes = coerceBytes(input);
  if (!bytes) return null;
  try {
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
      const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return toHex(new Uint8Array(buf));
    }
  } catch { /* fall through */ }
  try {
    const nodeCrypto = await import("node:crypto");
    return nodeCrypto.createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

/** Hash a frame and produce metadata suitable for `FrameMetadata.hash`. */
export async function hashFrameBytes(input) {
  const hex = await sha256Hex(input);
  if (!hex) return { hash: null, algorithm: null, hashedAt: null };
  return { hash: `sha256:${hex}`, algorithm: "sha256", hashedAt: Date.now() };
}

/** True if two hash strings (either format `hex` or `sha256:hex`) match. */
export function hashesEqual(a, b) {
  if (!a || !b) return false;
  const norm = (h) => String(h).toLowerCase().replace(/^sha256:/, "");
  return norm(a) === norm(b) && norm(a).length === 64;
}