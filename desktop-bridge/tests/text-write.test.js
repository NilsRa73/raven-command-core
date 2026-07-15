// v0.2.2 — safe text-file capabilities.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeTextFile, appendTextFile, readTextFile } from "../src/files.js";
import { WRITE_TEXT_MAX_BYTES, BRIDGE_FEATURES, BRIDGE_VERSION, CAPABILITIES } from "../src/protocol.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rah-text-"));
const root = path.join(tmp, "root"); fs.mkdirSync(root);

test("BRIDGE_VERSION is 0.2.2 and advertises textFileWrite", () => {
  assert.equal(BRIDGE_VERSION, "0.2.2");
  assert.ok(BRIDGE_FEATURES.includes("textFileWrite"));
  assert.ok(CAPABILITIES["files.writeText"]);
  assert.ok(CAPABILITIES["files.appendText"]);
  assert.equal(CAPABILITIES["files.writeText"].requiresApproval, true);
});

test("writeText creates a new .md file inside approved root", () => {
  const target = path.join(root, "notes.md");
  const r = writeTextFile(target, "# hi\nhello", [root]);
  assert.equal(r.overwrote, false);
  assert.equal(fs.readFileSync(target, "utf8"), "# hi\nhello");
});

test("writeText createOnly refuses to overwrite existing file", () => {
  const target = path.join(root, "notes.md");
  assert.throws(() => writeTextFile(target, "again", [root]), /exists/);
});

test("writeText overwrite creates a sidecar backup", () => {
  const target = path.join(root, "notes.md");
  const r = writeTextFile(target, "replaced", [root], { mode: "overwrite" });
  assert.equal(r.overwrote, true);
  assert.ok(r.backupPath && fs.existsSync(r.backupPath));
  assert.equal(fs.readFileSync(r.backupPath, "utf8"), "# hi\nhello");
  assert.equal(fs.readFileSync(target, "utf8"), "replaced");
});

test("writeText rejects paths outside approved roots", () => {
  assert.throws(() => writeTextFile(path.join(tmp, "escape.md"), "x", [root]), /not inside/);
});

test("writeText rejects blocked basenames", () => {
  assert.throws(() => writeTextFile(path.join(root, ".env"), "SECRET=1", [root]), /Hidden|blocked/);
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  assert.throws(() => writeTextFile(path.join(root, "sub", "authorized_keys"), "x", [root]), /allowlist|blocked/);
});

test("writeText rejects non-allowlisted extensions", () => {
  assert.throws(() => writeTextFile(path.join(root, "bin.exe"), "x", [root]), /allowlist/);
});

test("writeText rejects NUL bytes and oversize content", () => {
  assert.throws(() => writeTextFile(path.join(root, "nul.txt"), "a\u0000b", [root]), /Null byte/);
  const big = "a".repeat(WRITE_TEXT_MAX_BYTES + 1);
  assert.throws(() => writeTextFile(path.join(root, "big.txt"), big, [root]), /too large/i);
});

test("appendText adds to existing file and round-trips via readText", () => {
  const target = path.join(root, "log.md");
  writeTextFile(target, "line1\n", [root]);
  const r = appendTextFile(target, "line2\n", [root]);
  assert.ok(r.totalBytes > r.appendedBytes);
  const read = readTextFile(target, [root]);
  assert.equal(read.text, "line1\nline2\n");
});

test("appendText refuses when file does not exist", () => {
  assert.throws(() => appendTextFile(path.join(root, "missing.md"), "x", [root]), /does not exist/);
});