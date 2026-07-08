// Static invariants for the Tauri 2 capability file. The Rust code
// spawns the sidecar via `Command::spawn()` (from the shell plugin),
// so the exposed permission MUST be `shell:allow-spawn` — using
// `shell:allow-execute` would be wrong for spawn() AND would leak a
// broader capability than we intend.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const capPath = path.join(repo, "desktop-bridge-native", "src-tauri", "capabilities", "default.json");
const cap = JSON.parse(fs.readFileSync(capPath, "utf8"));

function findScopedShell(id) {
  return cap.permissions.find(
    (p) => typeof p === "object" && p !== null && p.identifier === id
  );
}

test("capability uses shell:allow-spawn for the named sidecar", () => {
  const entry = findScopedShell("shell:allow-spawn");
  assert.ok(entry, "shell:allow-spawn permission missing");
  assert.ok(Array.isArray(entry.allow) && entry.allow.length === 1,
    "expected exactly one scoped shell allow entry");
  const rule = entry.allow[0];
  assert.equal(rule.name, "rah-bridge-sidecar",
    "scoped shell entry must target the named sidecar");
  assert.equal(rule.sidecar, true, "sidecar flag must be true");
  assert.deepEqual(rule.args, [],
    "sidecar argv scope must be exactly [] — no user-controlled args");
});

test("capability does NOT include shell:allow-execute", () => {
  const bad = findScopedShell("shell:allow-execute");
  assert.equal(bad, undefined,
    "shell:allow-execute is wrong for Command::spawn() and widens the surface");
  // Also assert the raw string form is absent (defense in depth).
  const raw = JSON.stringify(cap);
  assert.ok(!/shell:allow-execute/.test(raw),
    "capability file must not mention shell:allow-execute at all");
});

test("capability never uses wildcard args or generic shell surface", () => {
  const raw = JSON.stringify(cap);
  assert.ok(!/"args"\s*:\s*true/.test(raw),
    "wildcard args (`args: true`) would allow arbitrary argv — forbidden");
  assert.ok(!/"validator"\s*:\s*".\*"/.test(raw),
    "wildcard argv validators are forbidden");
  for (const forbidden of [
    "shell:default",
    "shell:allow-open",
    "shell:allow-kill",
    "shell:allow-stdin-write",
  ]) {
    assert.ok(!raw.includes(forbidden),
      `capability must not include broad shell permission: ${forbidden}`);
  }
});