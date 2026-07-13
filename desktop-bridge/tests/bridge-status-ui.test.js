import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bridgeUiKind, bridgeShortLabel, shouldShowBridgeOfflineBanner, routeText,
} from "../../src/lib/rah/bridgeStatusLabels.js";

const LOCAL_BRIDGE = { engine: "lmstudio", transport: "bridge", lmStudioModel: "google/gemma-4-e4b" };
const LOCAL_DIRECT = { engine: "lmstudio", transport: "direct", lmStudioModel: "google/gemma-4-e4b" };
const CLOUD = { engine: "cloud", transport: "auto" };

const PAIRED = { ui: "paired_online", version: "0.2.1", paired: true };
const OFFLINE = { ui: "offline", paired: false };

test("initial checking state: null snapshot is never labelled offline", () => {
  assert.equal(bridgeUiKind(null, true), "checking");
  assert.equal(bridgeShortLabel(null, true), "checking…");
  // Route text must also not claim "via Bridge" or "offline".
  assert.match(routeText(LOCAL_BRIDGE, null), /Checking bridge…/);
  // Banner must be suppressed until we actually know.
  assert.equal(shouldShowBridgeOfflineBanner(LOCAL_BRIDGE, null), false);
});

test("paired_online: consistent connected label + via Bridge with version everywhere", () => {
  assert.equal(bridgeUiKind(PAIRED, false), "connected");
  assert.equal(bridgeShortLabel(PAIRED, false), "connected");
  assert.equal(shouldShowBridgeOfflineBanner(LOCAL_BRIDGE, PAIRED), false);
  assert.match(routeText(LOCAL_BRIDGE, PAIRED), /LM Studio \(local\) · google\/gemma-4-e4b · via Bridge v0\.2\.1/);
});

test("offline banner gating: only fires for local engine with bridge transport and a real offline snapshot", () => {
  assert.equal(shouldShowBridgeOfflineBanner(LOCAL_BRIDGE, OFFLINE), true);
  // Cloud engine — never show bridge-offline banner.
  assert.equal(shouldShowBridgeOfflineBanner(CLOUD, OFFLINE), false);
  // User explicitly chose Direct — don't nag about the bridge.
  assert.equal(shouldShowBridgeOfflineBanner(LOCAL_DIRECT, OFFLINE), false);
  // Null snapshot (still loading) — never fire.
  assert.equal(shouldShowBridgeOfflineBanner(LOCAL_BRIDGE, null), false);
});

test("route label: offline snapshot says 'Bridge required', not 'via Bridge'", () => {
  const t = routeText(LOCAL_BRIDGE, OFFLINE);
  assert.match(t, /Bridge required/);
  assert.doesNotMatch(t, /via Bridge/);
});

test("route label: direct transport is honest about not going through the bridge", () => {
  assert.match(routeText(LOCAL_DIRECT, PAIRED), /· direct$/);
});
