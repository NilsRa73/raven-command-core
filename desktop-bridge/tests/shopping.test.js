import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG, landedCost, adjustedQuality,
  filterCatalog, buildComparison,
} from "../../src/lib/rah/shopping.js";

test("catalog has at least 10 curated products", () => {
  assert.ok(CATALOG.length >= 10);
  for (const p of CATALOG) {
    assert.ok(p.id && p.name && p.category);
    assert.ok(p.priceUsd >= 0);
  }
});

test("landedCost = price + shipping", () => {
  assert.equal(landedCost({ priceUsd: 100, shippingUsd: 25 }), 125);
});

test("adjustedQuality penalises risks", () => {
  const clean = { quality: 90, risks: [] };
  const risky = { quality: 90, risks: ["a", "b"] };
  assert.ok(adjustedQuality(risky) < adjustedQuality(clean));
});

test("filterCatalog by category + query", () => {
  const desk = filterCatalog(CATALOG, "", "Desk");
  assert.ok(desk.every((p) => p.category === "Desk"));
  const raven = filterCatalog(CATALOG, "raven", "All");
  assert.ok(raven.some((p) => /raven/i.test(p.name)));
});

test("buildComparison requires 2..4 items", () => {
  assert.throws(() => buildComparison([CATALOG[0]]));
  assert.throws(() => buildComparison(CATALOG.slice(0, 5)));
  const cmp = buildComparison(CATALOG.slice(0, 3));
  assert.equal(cmp.rows.length, 3);
  assert.ok(cmp.rows[0].landed >= cmp.rows[0].priceUsd);
});