import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB rotation

function redact(obj) {
  if (obj == null) return obj;
  if (typeof obj === "string") {
    // Redact anything that looks like a token or pairing code.
    return obj
      .replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED_TOKEN]")
      .replace(/\b\d{6}\b/g, "[REDACTED_CODE]");
  }
  if (Array.isArray(obj)) return obj.map(redact);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/token|secret|code|authorization|signature|hmac|password/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return obj;
}

export function auditLog(entry) {
  try {
    const { auditFile } = paths();
    const dir = path.dirname(auditFile);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(auditFile)) {
      const st = fs.statSync(auditFile);
      if (st.size > MAX_BYTES) {
        fs.renameSync(auditFile, auditFile + ".1");
      }
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...redact(entry) }) + "\n";
    fs.appendFileSync(auditFile, line, { mode: 0o600 });
  } catch (err) {
    // Never let audit failure crash the bridge.
    console.error("[audit] failed", err.message);
  }
}

export function readRecent(limit = 100) {
  const { auditFile } = paths();
  if (!fs.existsSync(auditFile)) return [];
  const text = fs.readFileSync(auditFile, "utf8");
  const lines = text.trim().split("\n").slice(-limit);
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export { redact };
