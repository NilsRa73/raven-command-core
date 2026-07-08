// Actively runs the sidecar bundle step and validates its outputs.
// This test invokes desktop-bridge-native/package-sidecar.mjs and
// then asserts:
//   1. the CJS bundle file exists and is non-empty
//   2. the SEA config file exists and points at the bundled .cjs file
//      (never at the raw ESM entry)
//   3. the bundle contains no unresolved project-relative
//      import/require statements
//   4. the bundle exposes the machine-readable startup markers
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here       = path.dirname(fileURLToPath(import.meta.url));
const repoRoot   = path.resolve(here, "..", "..");
const bundlerJs  = path.join(repoRoot, "desktop-bridge-native", "package-sidecar.mjs");
const binDir     = path.join(repoRoot, "desktop-bridge-native", "src-tauri", "binaries");
const bundlePath = path.join(binDir, "rah-bridge-sidecar.bundle.cjs");
const cfgPath    = path.join(binDir, "sea-config.json");

// esbuild is a repo-root devDependency; skip only if it isn't installed
// yet (fresh clone without `bun install`) so this test never blocks a
// clean checkout. The Windows workflow installs deps before running tests.
let esbuildAvailable = true;
try {
  await import("esbuild");
} catch {
  esbuildAvailable = false;
}

test("package-sidecar.mjs runs and produces bundle + SEA config", { skip: !esbuildAvailable }, () => {
  for (const f of [bundlePath, cfgPath, path.join(binDir, "sea-prep.blob")]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const res = spawnSync(process.execPath, [bundlerJs], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(res.status, 0, `bundler exited ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
  assert.ok(fs.existsSync(bundlePath), "bundle file was not created");
  assert.ok(fs.existsSync(cfgPath), "sea-config.json was not created");
  assert.ok(fs.statSync(bundlePath).size > 4096, "bundle is suspiciously small");
});

test("sea-config.main points at the bundled CJS entry, not raw ESM", { skip: !esbuildAvailable }, () => {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.equal(path.resolve(cfg.main), path.resolve(bundlePath),
    "sea-config.main must be the bundled CJS file");
  assert.match(cfg.main, /\.cjs$/, "SEA main must be a .cjs bundle");
  assert.ok(!/desktop-bridge[\\/]src[\\/]index\.js$/.test(cfg.main),
    "SEA main must never point at the raw ESM source entry");
  assert.equal(cfg.useSnapshot, false);
  assert.equal(cfg.disableExperimentalSEAWarning, true);
});

test("bundle contains no unresolved relative import/require statements", { skip: !esbuildAvailable }, () => {
  const src = fs.readFileSync(bundlePath, "utf8");
  const bad = src.split("\n").find((l) =>
    /^\s*(?:import\s.+\sfrom\s+["']\.{1,2}\/|require\(["']\.{1,2}\/)/.test(l)
  );
  assert.equal(bad, undefined, `bundle still contains a project-relative import/require: ${bad}`);
});

test("bundle exposes the machine-readable startup markers", { skip: !esbuildAvailable }, () => {
  const src = fs.readFileSync(bundlePath, "utf8");
  assert.ok(src.includes("RAH_BRIDGE_READY"), "bundle missing READY marker");
  assert.ok(src.includes("RAH_PAIRING_CODE"), "bundle missing PAIRING marker");
});