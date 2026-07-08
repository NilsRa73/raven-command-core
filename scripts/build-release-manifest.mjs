#!/usr/bin/env node
// Extends src/lib/rah/bridge-manifest.json with the v0.2.0 companion
// section. Honest: if no real Windows installer artifact exists yet,
// writes `windowsInstaller: null` so the dashboard shows the
// "pipeline ready, not yet published" state instead of a fake link.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const repoRoot    = path.resolve(__dirname, "..");
const manifestPath= path.join(repoRoot, "src", "lib", "rah", "bridge-manifest.json");
const publicDir   = path.join(repoRoot, "public");

const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Source-package block: prefer nested field if already migrated, else
// fall back to legacy top-level fields written by build-bridge-package.mjs.
const sp = existing.sourcePackage ?? {
  file: existing.file, version: existing.version, sha256: existing.sha256,
  bytes: existing.bytes, builtAt: existing.builtAt, nodeRequired: existing.nodeRequired,
};

let windowsInstaller = null;
for (const f of fs.readdirSync(publicDir)) {
  const m = /^rah-desktop-bridge-(\d+\.\d+\.\d+)-x64\.exe$/.exec(f);
  if (m) {
    const abs = path.join(publicDir, f);
    const buf = fs.readFileSync(abs);
    windowsInstaller = {
      file: f,
      version: m[1],
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      bytes: buf.length,
      signed: false,
      arch: "x86_64",
      builtAt: fs.statSync(abs).mtime.toISOString(),
    };
    break;
  }
}

const merged = {
  schemaVersion: 2,
  companionVersion: "0.2.1",
  protocol: "v1",
  bridgeMinVersion: "0.1.1",
  webMinVersion: "0.1.0",
  // Back-compat top-level fields consumed by any v0.1.1 dashboard cache:
  ...sp,
  sourcePackage: sp,
  windowsInstaller,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + "\n");
console.log(`[release-manifest] wrote ${manifestPath}`);
console.log(`[release-manifest] windowsInstaller: ${windowsInstaller ? windowsInstaller.file : "null (pipeline ready, not built)"}`);