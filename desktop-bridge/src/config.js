import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

function configDir() {
  if (process.env.RAH_BRIDGE_CONFIG_DIR) return process.env.RAH_BRIDGE_CONFIG_DIR;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "RAH", "DesktopBridge");
  }
  return path.join(os.homedir(), ".config", "rah-desktop-bridge");
}

function configFile() { return path.join(configDir(), "config.json"); }
function auditFile() { return path.join(configDir(), "audit.jsonl"); }

function ensureDir() {
  const d = configDir();
  fs.mkdirSync(d, { recursive: true });
  try { fs.chmodSync(d, 0o700); } catch { /* best effort on windows */ }
}

const DEFAULT_ROOTS_WIN = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"];

function defaultApprovedRoots() {
  const home = os.homedir();
  return DEFAULT_ROOTS_WIN
    .map((n) => path.join(home, n))
    .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

export function loadConfig() {
  ensureDir();
  const file = configFile();
  if (!fs.existsSync(file)) {
    const cfg = {
      deviceToken: null,           // set after successful pairing
      hmacSecret: null,            // set after successful pairing
      approvedRoots: defaultApprovedRoots(),
      pairedAt: null,
      pairedOrigin: null,
      createdAt: new Date().toISOString(),
    };
    saveConfig(cfg);
    return cfg;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveConfig(cfg) {
  ensureDir();
  const file = configFile();
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* windows best effort */ }
}

export function resetConfig() {
  const file = configFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function generatePairingCode() {
  // Six digits, cryptographically random.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function paths() {
  return { configDir: configDir(), configFile: configFile(), auditFile: auditFile() };
}
