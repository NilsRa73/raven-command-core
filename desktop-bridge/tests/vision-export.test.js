import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJsonExport, buildMarkdownExport, validateImportPayload, EXPORT_SCHEMA } from "../../src/lib/rah/visionExport.js";

const sampleEvidence = [{
  id: "ev_1",
  frame: { width: 800, height: 600, hash: "sha256:aa", dataUrl: "data:image/jpeg;base64,AAA" },
  redactedFrame: { width: 800, height: 600, hash: "sha256:bb", dataUrl: "data:image/jpeg;base64,BBB" },
  privacy: { class: "confidential" },
}];

test("JSON export strips dataUrl by default and reports includeImages=false", () => {
  const out = buildJsonExport({ evidence: sampleEvidence });
  assert.equal(out.schema, EXPORT_SCHEMA);
  assert.equal(out.includeImages, false);
  assert.equal(out.evidence[0].frame.dataUrl, undefined);
  assert.equal(out.evidence[0].redactedFrame.dataUrl, undefined);
  assert.equal(out.evidence[0]._imagesIncluded, false);
  assert.equal(out.counts.evidence, 1);
});

test("JSON export keeps dataUrl only when includeImages=true AND bytes exist", () => {
  const out = buildJsonExport({ evidence: sampleEvidence }, { includeImages: true });
  assert.equal(out.includeImages, true);
  assert.equal(out.evidence[0].frame.dataUrl, "data:image/jpeg;base64,AAA");
  assert.equal(out.evidence[0]._imagesIncluded, true);
});

test("Markdown export never embeds base64/dataUrl regardless of input", () => {
  const md = buildMarkdownExport({ evidence: sampleEvidence, results: [{ id: "r1", rawText: "hello", route: { provider: "lovable-ai", model: "gemini" }, createdAt: 1_700_000_000_000 }] });
  assert.ok(md.includes("Raven Screen Vision export"));
  assert.ok(!md.includes("base64"));
  assert.ok(!md.includes("data:image"));
  assert.ok(md.includes("sha256:aa"));
  assert.ok(md.includes("hello"));
});

test("validateImportPayload rejects wrong schema", () => {
  const bad = validateImportPayload({ schema: "other/1", sessions: [], evidence: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.startsWith("schema_mismatch")));
});

test("validateImportPayload accepts a well-shaped payload", () => {
  const raw = { schema: EXPORT_SCHEMA, generatedAt: 1, includeImages: false, sessions: [], evidence: [], results: [] };
  const res = validateImportPayload(raw);
  assert.equal(res.ok, true);
  assert.equal(res.payload.schema, EXPORT_SCHEMA);
  assert.equal(Array.isArray(res.payload.results), true);
});

test("validateImportPayload rejects non-array sessions/evidence", () => {
  const res = validateImportPayload({ schema: EXPORT_SCHEMA, sessions: null, evidence: {} });
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes("sessions_not_array"));
  assert.ok(res.errors.includes("evidence_not_array"));
});