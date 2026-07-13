// Pure helpers for turning a shared bridge snapshot into UI labels.
// Kept as .js so it can be imported directly by Node tests without a TS runtime.
//
// A "snapshot" here is a BridgeStatusSnapshot | null. `null` means "no result
// yet" (still loading for the first time). Consumers MUST NOT label a null
// snapshot as "offline" — that was the source of the Command Center
// contradiction where the shared bridge state was actually paired_online but
// each component's private poller was still on its initial null tick.

/**
 * @param {{ui:string}|null} snapshot
 * @param {boolean} loading
 * @returns {"checking"|"connected"|"offline"|"pair_required"|"update_required"|"emergency"|"error"}
 */
export function bridgeUiKind(snapshot, loading) {
  if (snapshot == null) return "checking";
  switch (snapshot.ui) {
    case "paired_online": return "connected";
    case "pairing_required": return "pair_required";
    case "version_mismatch":
    case "feature_missing": return "update_required";
    case "emergency_stopped": return "emergency";
    case "error": return "error";
    case "offline":
    default: return loading ? "checking" : "offline";
  }
}

/** Short label for the Command Center status strip. */
export function bridgeShortLabel(snapshot, loading) {
  switch (bridgeUiKind(snapshot, loading)) {
    case "checking": return "checking…";
    case "connected": return "connected";
    case "pair_required": return "pair required";
    case "update_required": return "update required";
    case "emergency": return "emergency stop";
    case "error": return "error";
    case "offline": return "offline";
  }
}

/**
 * Should the red "bridge/local server offline" banner fire?
 * Only when:
 *   - engine is a local engine (lmstudio/ollama)
 *   - user hasn't forced Direct transport
 *   - we actually have a snapshot AND it is genuinely not paired_online
 * A null/checking snapshot must never trigger the banner.
 *
 * @param {{engine:string, transport:string}} settings
 * @param {{ui:string}|null} snapshot
 */
export function shouldShowBridgeOfflineBanner(settings, snapshot) {
  const isLocal = settings.engine === "lmstudio" || settings.engine === "ollama";
  if (!isLocal) return false;
  if (settings.transport === "direct") return false;
  if (snapshot == null) return false;
  return snapshot.ui !== "paired_online";
}

/**
 * Route text used in the CommandBar under the engine dropdown. This must
 * reflect ACTUAL resolved transport based on the shared snapshot, never
 * claim "via Bridge" while the shared snapshot says the bridge is offline.
 *
 * @param {{engine:string, transport:string, lmStudioModel?:string, ollamaModel?:string}} settings
 * @param {{ui:string, version?:string}|null} snapshot
 */
export function routeText(settings, snapshot) {
  const eng = settings.engine;
  if (eng === "cloud") return "Lovable AI Gateway · Lovable AI Gateway";
  if (eng === "demo") return "Local Demo Engine";
  const model = eng === "lmstudio"
    ? (settings.lmStudioModel || "no model")
    : (settings.ollamaModel || "no model");
  const label = eng === "lmstudio" ? "LM Studio (local)" : "Ollama (local)";
  if (settings.transport === "direct") return `${label} · ${model} · direct`;
  // Bridge-preferred transports: reflect the truth.
  if (snapshot == null) return `${label} · ${model} · Checking bridge…`;
  if (snapshot.ui === "paired_online") {
    const v = snapshot.version ? ` v${snapshot.version}` : "";
    return `${label} · ${model} · via Bridge${v}`;
  }
  return `${label} · ${model} · Bridge required`;
}
