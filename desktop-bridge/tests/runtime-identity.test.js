import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRuntimeIdentityPrompt,
  RUNTIME_IDENTITY_MARKER,
} from "../../src/lib/rah/runtimeIdentity.js";

// Verified user runtime values (issue: model self-identified as "cloud/API").
const LMSTUDIO_BRIDGE = {
  engine: "lmstudio",
  engineLabel: "LM Studio (local)",
  model: "google/gemma-4-e4b",
  transport: "bridge",
  bridgeVersion: "0.2.1",
  bridgeStatus: "paired_online",
  persona: "RAH Master Brain",
};

test("runtime identity: LM Studio via Bridge — includes engine, model, transport, version verbatim", () => {
  const out = buildRuntimeIdentityPrompt(LMSTUDIO_BRIDGE);
  assert.match(out, new RegExp(RUNTIME_IDENTITY_MARKER.replace(/[()]/g, "\\$&")));
  assert.match(out, /Engine\/Provider: LM Studio \(local\) \(id: lmstudio\)/);
  assert.match(out, /Model: google\/gemma-4-e4b/);
  assert.match(out, /Transport: RAH Desktop Bridge/);
  assert.match(out, /127\.0\.0\.1:47824/);
  assert.match(out, /Bridge version: 0\.2\.1/);
  assert.match(out, /Bridge status: paired_online/);
  assert.match(out, /Active persona label: RAH Master Brain/);
});

test("runtime identity: LM Studio prompt FORBIDS claiming cloud / gateway routing", () => {
  const out = buildRuntimeIdentityPrompt(LMSTUDIO_BRIDGE);
  // The rule must literally forbid cloud/API self-identification for local
  // engines and must name the concrete engine so the model cannot wriggle.
  assert.match(out, /NEVER claim you are running via a cloud API/i);
  assert.match(out, /Lovable AI Gateway/);
  assert.match(out, /Local execution is authoritative/i);
  assert.match(out, /Engine is "lmstudio"/);
});

test("runtime identity: persona is distinguished from model", () => {
  const out = buildRuntimeIdentityPrompt(LMSTUDIO_BRIDGE);
  assert.match(out, /persona.*is a character label/i);
  assert.match(out, /answer with the Model field above, not the persona name/);
});

test("runtime identity: unknown fields are reported as 'unknown', not invented", () => {
  const out = buildRuntimeIdentityPrompt({
    engine: "lmstudio",
    engineLabel: "LM Studio (local)",
    model: "",
    transport: "bridge",
    bridgeVersion: undefined,
    bridgeStatus: undefined,
  });
  assert.match(out, /Model: unknown/);
  // Rule 2 must be present so the model surfaces "unknown" verbatim.
  assert.match(out, /literally "unknown"/);
  // No bridge version line when version wasn't supplied at all.
  assert.doesNotMatch(out, /Bridge version:/);
});

test("runtime identity: Ollama direct transport labels transport correctly", () => {
  const out = buildRuntimeIdentityPrompt({
    engine: "ollama",
    engineLabel: "Ollama (local)",
    model: "llama3.1",
    transport: "direct",
  });
  assert.match(out, /Engine\/Provider: Ollama \(local\) \(id: ollama\)/);
  assert.match(out, /Transport: Direct browser fetch to local server/);
  assert.match(out, /Engine is "ollama"/);
});