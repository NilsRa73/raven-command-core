#!/usr/bin/env node
// Reproducible bridge-package builder.
// - Requires Node 22 LTS
// - Zips desktop-bridge/ excluding secrets/config/logs/node_modules/tmp
// - Writes public/rah-desktop-bridge-<version>.zip
// - Writes src/lib/rah/bridge-manifest.json  { file, version, sha256, builtAt }
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`[build-bridge] Node.js 22 LTS required, found ${process.versions.node}`);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bridgeDir = path.join(repoRoot, "desktop-bridge");
const publicDir = path.join(repoRoot, "public");
const pkg = JSON.parse(fs.readFileSync(path.join(bridgeDir, "package.json"), "utf8"));
const version = pkg.version;
const zipName = `rah-desktop-bridge-${version}.zip`;
const zipPath = path.join(publicDir, zipName);

fs.mkdirSync(publicDir, { recursive: true });
for (const f of fs.readdirSync(publicDir)) {
  if (/^rah-desktop-bridge-.*\.zip$/.test(f)) fs.rmSync(path.join(publicDir, f));
}

const EXCLUDES = [
  ".env", ".env.*", "config.json", "*.log", "*.jsonl",
  "audit.jsonl", "node_modules/*", "node_modules",
  ".DS_Store", "Thumbs.db", "*.tmp", "tmp/*",
];

let usedNativeZip = false;
try {
  const args = ["-r", "-X", zipPath, ".", "-x", ...EXCLUDES];
  execFileSync("zip", args, { cwd: bridgeDir, stdio: "inherit" });
  usedNativeZip = true;
} catch {
  console.log("[build-bridge] zip binary unavailable; using pure-JS fallback");
  await buildStoreZip(bridgeDir, zipPath, EXCLUDES);
}

const buf = fs.readFileSync(zipPath);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
const manifest = {
  file: zipName,
  version,
  sha256,
  bytes: buf.length,
  builtAt: new Date().toISOString(),
  nodeRequired: ">=22",
};
const manifestPath = path.join(repoRoot, "src", "lib", "rah", "bridge-manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`[build-bridge] wrote ${zipPath}`);
console.log(`[build-bridge] size ${buf.length} bytes`);
console.log(`[build-bridge] sha256 ${sha256}`);
console.log(`[build-bridge] manifest ${manifestPath}`);
console.log(`[build-bridge] usedNativeZip=${usedNativeZip}`);

async function buildStoreZip(root, outPath, excludes) {
  const files = [];
  walk(root, "", excludes, files);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const rel of files.sort()) {
    const abs = path.join(root, rel);
    const data = fs.readFileSync(abs);
    const nameBuf = Buffer.from(rel.replace(/\\/g, "/"));
    const crc = crc32(data);
    const size = data.length;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    parts.push(localHeader, nameBuf, data);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(outPath, Buffer.concat([...parts, centralBuf, eocd]));
}
function walk(root, rel, excludes, out) {
  const abs = rel ? path.join(root, rel) : root;
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const e of entries) {
    const childRel = rel ? path.join(rel, e.name) : e.name;
    if (isExcluded(childRel, e.isDirectory(), excludes)) continue;
    if (e.isDirectory()) walk(root, childRel, excludes, out);
    else if (e.isFile()) out.push(childRel);
  }
}
function isExcluded(rel, isDir, patterns) {
  const norm = rel.replace(/\\/g, "/");
  const base = path.basename(norm);
  for (const p of patterns) {
    if (p.endsWith("/*")) {
      const dir = p.slice(0, -2);
      if (norm === dir || norm.startsWith(dir + "/")) return true;
    } else if (p.includes("*")) {
      const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if (re.test(base)) return true;
    } else {
      if (base === p || norm === p) return true;
    }
  }
  return false;
}
function crc32(buf) {
  let c = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ (-1)) >>> 0;
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
