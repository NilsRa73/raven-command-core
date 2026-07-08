#!/usr/bin/env node
// Prepares the Node 22 SEA (Single Executable Application) config for
// the bridge sidecar. Emits a sea-config.json in src-tauri/binaries/
// that the Windows CI turns into `rah-bridge-sidecar-<triple>.exe`
// via `node --experimental-sea-config` + `postject`.
//
// The actual .exe is produced only inside the Windows workflow; this
// script never fabricates one on other platforms.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const bridgeDir  = path.resolve(__dirname, "..", "desktop-bridge");
const outDir     = path.resolve(__dirname, "src-tauri", "binaries");
fs.mkdirSync(outDir, { recursive: true });

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) { console.error(`Node 22 LTS required, found ${process.versions.node}`); process.exit(1); }

const entry = path.join(bridgeDir, "src", "index.js");
if (!fs.existsSync(entry)) { console.error(`entry not found: ${entry}`); process.exit(2); }

const seaCfg = {
  main: entry,
  output: path.join(outDir, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
};
const cfgPath = path.join(outDir, "sea-config.json");
fs.writeFileSync(cfgPath, JSON.stringify(seaCfg, null, 2));
const cfgHash = crypto.createHash("sha256").update(fs.readFileSync(cfgPath)).digest("hex");

console.log("[sidecar] sea-config.json:", cfgPath);
console.log("[sidecar] sea-config sha256:", cfgHash);
console.log("[sidecar] next steps (run in CI):");
console.log("  node --experimental-sea-config " + cfgPath);
console.log("  copy node.exe rah-bridge-sidecar-x86_64-pc-windows-msvc.exe");
console.log("  npx postject <exe> NODE_SEA_BLOB sea-prep.blob \\");
console.log("    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");