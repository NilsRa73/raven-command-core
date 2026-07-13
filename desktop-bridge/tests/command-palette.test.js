import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPaletteCommands, groupBySection, isFreeformPrompt, PALETTE_COMMANDS } from "../../src/lib/rah/commandPalette.js";

test("empty query returns full palette", () => {
  assert.equal(filterPaletteCommands("").length, PALETTE_COMMANDS.length);
});

test("exact title match ranks first", () => {
  const r = filterPaletteCommands("Device Center");
  assert.equal(r[0].id, "nav:devices");
});

test("keywords match", () => {
  const r = filterPaletteCommands("cluster");
  assert.ok(r.find((c) => c.id === "nav:devices"), "devices matched via keyword");
});

test("no-match returns empty and is offered as freeform prompt", () => {
  const q = "zzz please help me refactor this";
  assert.equal(filterPaletteCommands(q).length, 0);
  assert.equal(isFreeformPrompt(q), true);
});

test("groupBySection preserves order", () => {
  const groups = groupBySection(filterPaletteCommands(""));
  assert.equal(groups[0].section, "Navigate");
});

test("> prefix is always freeform", () => {
  assert.equal(isFreeformPrompt("> summarize today"), true);
});
