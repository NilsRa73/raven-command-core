import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.resolve(here, "..");

function read(name) {
  return fs.readFileSync(path.join(bridge, name), "utf8");
}

test("Desktop Bridge runtime contract consistently requires Node 22+", () => {
  const pkg = JSON.parse(read("package.json"));
  const readme = read("README-FIRST.txt");
  const launcher = read("Start RAH Desktop Bridge.cmd");
  const installer = read("install.ps1");

  assert.equal(pkg.engines.node, ">=22");
  assert.match(readme, /Node\.js 22 or later/);
  assert.match(launcher, /LSS 22/);
  assert.match(launcher, /Node\.js 22 or later/);
  assert.match(installer, /\$major -lt 22/);
  assert.match(installer, /Node\.js 22 or later/);

  assert.doesNotMatch(readme, /Node\.js 20 or later/);
  assert.doesNotMatch(launcher, /Node\.js 20 or later/);
  assert.doesNotMatch(installer, /Node\.js 20 or later/);
});
