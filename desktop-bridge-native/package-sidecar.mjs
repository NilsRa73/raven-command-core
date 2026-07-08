#!/usr/bin/env node
// Bundles desktop-bridge/src/index.js and every project-relative
// import into ONE self-contained CommonJS file that Node SEA can
// embed. Node built-ins remain external. Fails hard if bundling
// fails or if the resulting file still contains project-relative
// import/require statements.
//
// Then writes the SEA config pointing at the bundled CJS entry.
// The actual `.exe` step (postject + node.exe copy) runs in the
// Windows workflow and is not attempted on non-Windows hosts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const repoRoot    = path.resolve(__dirname, "..");
const bridgeDir   = path.join(repoRoot, "desktop-bridge");
const outDir      = path.resolve(__dirname, "src-tauri", "binaries");
fs.mkdirSync(outDir, { recursive: true });

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`[sidecar] Node 22 LTS required, found ${process.versions.node}`);
  process.exit(1);
}

const entry     = path.join(bridgeDir, "src", "index.js");
const bundlePath = path.join(outDir, "rah-bridge-sidecar.bundle.cjs");
const seaBlob   = path.join(outDir, "sea-prep.blob");
const seaCfg    = path.join(outDir, "sea-config.json");

if (!fs.existsSync(entry)) {
  console.error(`[sidecar] bridge entry not found: ${entry}`);
  process.exit(2);
}

try {
  await esbuild.build({
    entryPoints: [entry],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    minify: false,
    sourcemap: false,
    legalComments: "none",
    // Node built-ins remain external; SEA runtime provides them.
    external: [],
    banner: {
      js: "// RAH Desktop Bridge sidecar bundle — regenerate via desktop-bridge-native/package-sidecar.mjs",
    },
    logLevel: "warning",
  });
} catch (err) {
  console.error("[sidecar] esbuild failed:", err && err.message ? err.message : err);
  process.exit(3);
}

// Post-bundle sanity: no project-relative imports/requires may remain
// in the output — those would fail at SEA runtime with no fs to load.
const bundleSrc = fs.readFileSync(bundlePath, "utf8");
const badLine = bundleSrc.split("\n").findIndex((l) =>
  /^\s*(?:import\s.+\sfrom\s+["']\.{1,2}\/|require\(["']\.{1,2}\/)/.test(l)
);
if (badLine !== -1) {
  console.error(`[sidecar] bundle still contains relative import/require at line ${badLine + 1}`);
  console.error("         line:", bundleSrc.split("\n")[badLine]);
  process.exit(4);
}
const bundleBytes = fs.statSync(bundlePath).size;
if (bundleBytes < 4096) {
  console.error(`[sidecar] bundle suspiciously small (${bundleBytes} bytes)`);
  process.exit(5);
}

const cfg = {
  main: bundlePath,
  output: seaBlob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
};
fs.writeFileSync(seaCfg, JSON.stringify(cfg, null, 2));

const sha = crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex");
console.log(`[sidecar] bundled: ${bundlePath} (${bundleBytes} bytes, sha256 ${sha})`);
console.log(`[sidecar] sea-config: ${seaCfg}`);
console.log("[sidecar] Windows CI next steps:");
console.log(`  node --experimental-sea-config "${seaCfg}"`);
console.log("  copy node.exe rah-bridge-sidecar-x86_64-pc-windows-msvc.exe");
console.log("  npx postject <exe> NODE_SEA_BLOB sea-prep.blob \\");
console.log("    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");