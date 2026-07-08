// Validates the sidecar bundle + SEA config produced by
// desktop-bridge-native/package-sidecar.mjs. Skips gracefully if the
// developer has not run the bundler yet (so this test never blocks a
// fresh clone), but the Windows workflow always runs the bundler
// before invoking `node --test`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(here, "..", "..", "desktop-bridge-native", "src-tauri", "binaries");
const bundlePath = path.join(binDir, "rah-bridge-sidecar.bundle.cjs");
const cfgPath = path.join(binDir, "sea-config.json");

const skip = !fs.existsSync(cfgPath) || !fs.existsSync(bundlePath);

test("sea-config points at the bundled CJS entry", { skip }, () => {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.equal(path.resolve(cfg.main), path.resolve(bundlePath),
    "sea-config.main must be the bundled CJS file, never raw ESM entry");
  assert.match(cfg.main, /\.cjs$/, "SEA main must be a .cjs bundle");
  assert.equal(cfg.useSnapshot, false);
});

test("bundle is CJS, non-empty, and has no unresolved relative imports", { skip }, () => {
  const src = fs.readFileSync(bundlePath, "utf8");
  assert.ok(src.length > 4096, "bundle is suspiciously small");
  const bad = src.split("\n").find((l) =>
    /^\s*(?:import\s.+\sfrom\s+["']\.{1,2}\/|require\(["']\.{1,2}\/)/.test(l)
  );
  assert.equal(bad, undefined, `bundle still contains a project-relative import/require: ${bad}`);
});

test("bundle exposes the machine-readable startup markers", { skip }, () => {
  const src = fs.readFileSync(bundlePath, "utf8");
  assert.ok(src.includes("RAH_BRIDGE_READY"), "bundle missing READY marker");
  assert.ok(src.includes("RAH_PAIRING_CODE"), "bundle missing PAIRING marker");
});