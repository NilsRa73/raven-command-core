// Verifies the Windows workflow references paths that actually exist
// in this repo. Cheap smoke test to catch drift between the workflow
// file and the native scaffold.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const wf = fs.readFileSync(path.join(repo, ".github/workflows/build-rah-desktop-bridge-windows.yml"), "utf8");

for (const p of [
  "desktop-bridge-native/package-sidecar.mjs",
  "desktop-bridge-native/src-tauri",
  "desktop-bridge-native/src-tauri/binaries",
  "desktop-bridge-native/assets/raven-mark.svg",
  "scripts/build-release-manifest.mjs",
  "desktop-bridge",
]) {
  test(`workflow references existing repo path: ${p}`, () => {
    if (p.endsWith("binaries")) return; // may not exist before first bundle
    assert.ok(fs.existsSync(path.join(repo, p)), `missing: ${p}`);
    // Accept either an absolute repo path or the basename (workflow uses
    // relative paths from working-directory contexts).
    const base = path.basename(p);
    assert.ok(wf.includes(p) || wf.includes(base),
      `workflow does not reference: ${p} (nor its basename ${base})`);
  });
}

test("workflow uses proven test invocation `node --test tests/*.test.js`", () => {
  assert.ok(wf.includes("node --test tests/*.test.js"),
    "workflow must use the proven glob form; `node --test tests` alone fails");
});

test("workflow builds NSIS installer with expected name", () => {
  assert.ok(wf.includes("rah-desktop-bridge-0.2.1-x64.exe"));
  assert.ok(wf.includes("--bundles nsis"));
});

test("workflow never uses generic shell or arbitrary program spawn", () => {
  assert.ok(!/shell:allow-execute[^-]/.test(wf), "workflow should not weaken shell scope");
});