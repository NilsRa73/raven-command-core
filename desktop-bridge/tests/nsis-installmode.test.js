// Static invariant: Tauri 2 rejects `perUser` and requires `currentUser`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const confPath = path.join(repo, "desktop-bridge-native", "src-tauri", "tauri.conf.json");
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));

test("tauri.conf.json nsis.installMode is currentUser", () => {
  assert.equal(conf.bundle?.windows?.nsis?.installMode, "currentUser",
    "Tauri 2 requires installMode 'currentUser'; 'perUser' is rejected");
});

test("tauri.conf.json never uses deprecated perUser", () => {
  const raw = fs.readFileSync(confPath, "utf8");
  assert.ok(!raw.includes('"perUser"'),
    "raw config must not contain the deprecated 'perUser' value");
});
