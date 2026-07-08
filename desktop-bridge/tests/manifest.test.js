// Verifies src/lib/rah/bridge-manifest.json matches the v0.2.0 schema.
// This runs in the same `node --test` suite as the other 44 bridge tests.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, "..", "..", "src", "lib", "rah", "bridge-manifest.json");
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

test("manifest: schemaVersion is 2", () => {
  assert.equal(m.schemaVersion, 2);
});

test("manifest: core v0.2.0 fields present", () => {
  assert.match(m.companionVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(m.protocol, "v1");
  assert.match(m.bridgeMinVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(typeof m.updatedAt === "string" && !isNaN(Date.parse(m.updatedAt)));
});

test("manifest: sourcePackage has file+sha256+bytes", () => {
  assert.ok(m.sourcePackage);
  assert.match(m.sourcePackage.file, /^rah-desktop-bridge-\d+\.\d+\.\d+\.zip$/);
  assert.match(m.sourcePackage.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(m.sourcePackage.bytes) && m.sourcePackage.bytes > 0);
});

test("manifest: windowsInstaller is null OR fully populated (never partial)", () => {
  if (m.windowsInstaller === null) return;
  const w = m.windowsInstaller;
  assert.match(w.file, /^rah-desktop-bridge-\d+\.\d+\.\d+-x64\.exe$/);
  assert.match(w.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(w.bytes) && w.bytes > 0);
  assert.equal(typeof w.signed, "boolean");
  assert.equal(w.arch, "x86_64");
});

test("manifest: never claims signed=true without a real installer", () => {
  if (m.windowsInstaller === null) return;
  // Belt-and-suspenders: even if a future edit sets signed=true, refuse
  // any manifest that flips the flag without a matching signature block.
  // Placeholder — extend when signature metadata is added.
  if (m.windowsInstaller.signed) {
    assert.ok(m.windowsInstaller.signature, "signed=true requires signature metadata");
  }
});