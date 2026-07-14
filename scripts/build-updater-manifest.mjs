#!/usr/bin/env node
// Native companion v0.3 — generate the release manifest for updater +
// Tauri `latest.json`. Uses REAL artifact metadata only. If the
// installer is missing, writes `null` — never fake a URL, checksum, or
// signature.
//
// Inputs (env):
//   RELEASE_CHANNEL   - one of stable|beta|dev  (default: stable)
//   RELEASE_BASE_URL  - HTTPS base URL where the installer will be
//                       hosted (e.g. https://releases.rah.studios)
//   RELEASE_SIGNATURE - optional minisign signature over the installer
//                       (base64, produced externally). Never invented.
//   RELEASE_KEY_ID    - identifier of the minisign key used
//
// Outputs:
//   public/updater-manifest.json  — internal, schemaVersion 3
//   public/latest.json            — Tauri-updater format (only when
//                                    endpoint+signature are provided)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateReleaseManifest } from "../src/lib/rah/updater.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(repoRoot, "public");
const tauriConf = JSON.parse(fs.readFileSync(path.join(repoRoot, "desktop-bridge-native", "src-tauri", "tauri.conf.json"), "utf8"));
const version = tauriConf.version;

const channel   = process.env.RELEASE_CHANNEL || "stable";
const baseUrl   = process.env.RELEASE_BASE_URL || "";
const signature = process.env.RELEASE_SIGNATURE || null;
const keyId     = process.env.RELEASE_KEY_ID || null;
const releasedAt = new Date().toISOString();

const installerName = `rah-desktop-bridge-${version}-x64.exe`;
const installerPath = path.join(publicDir, installerName);

let installer = null;
if (fs.existsSync(installerPath)) {
  const buf = fs.readFileSync(installerPath);
  installer = {
    file: installerName,
    bytes: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

const manifest = {
  schemaVersion: 3,
  version,
  channel,
  target: { os: "windows", arch: "x86_64" },
  url: installer && baseUrl ? `${baseUrl.replace(/\/$/, "")}/${installerName}` : null,
  sha256: installer?.sha256 ?? null,
  bytes: installer?.bytes ?? null,
  releasedAt,
  file: installerName,
  signature: signature && keyId ? { type: "minisign", value: signature, keyId } : null,
};

// Fail-closed self-check. We accept "not yet built" (null url/sha) as a
// distinct STATE — write a placeholder manifest but mark ok=false in the
// exit code so CI does not publish it.
const validation = validateReleaseManifest(manifest);

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "updater-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Tauri latest.json is only written when we actually have BOTH a signature
// and an installer URL. Otherwise Tauri's updater plugin would fail-open.
if (installer && baseUrl && signature) {
  const tauriLatest = {
    version,
    notes: process.env.RELEASE_NOTES || "",
    pub_date: releasedAt,
    platforms: {
      "windows-x86_64": {
        signature,
        url: manifest.url,
      },
    },
  };
  fs.writeFileSync(path.join(publicDir, "latest.json"), JSON.stringify(tauriLatest, null, 2) + "\n");
  console.log("[updater-manifest] wrote public/latest.json (signed)");
} else {
  console.log("[updater-manifest] latest.json NOT written — requires installer + baseUrl + signature");
}

console.log("[updater-manifest] wrote public/updater-manifest.json");
console.log(`  version=${version} channel=${channel} signed=${!!signature} installer=${installer ? installer.file : "(none)"}`);

if (!installer) {
  console.error("[updater-manifest] no installer artifact — manifest is a placeholder");
  process.exit(2);
}
if (!validation.ok) {
  console.error("[updater-manifest] validation errors:", validation.errors);
  process.exit(3);
}
process.exit(0);