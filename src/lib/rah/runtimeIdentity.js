/**
 * Pure, deterministic builder for the RAH "Runtime Identity" system prompt
 * block that is injected ahead of persona prompts whenever a Local AI
 * engine (LM Studio / Ollama) is answering. The block is authoritative:
 * the model MUST report the values here verbatim when asked what it is,
 * and MUST NOT claim cloud/API routing when the engine is local.
 *
 * Kept as plain ESM (no TS, no imports) so it can be unit-tested from the
 * bridge Node test runner without a TS toolchain, and so its output is a
 * stable string that snapshot-style assertions can pin exactly.
 */

/**
 * @typedef {Object} RahRuntimeIdentity
 * @property {"lmstudio"|"ollama"|"cloud"|"demo"} engine
 * @property {string} engineLabel        Human label, e.g. "LM Studio (local)"
 * @property {string} model              Model identifier or "unknown"
 * @property {"bridge"|"direct"|"cloud"|"demo"} transport
 * @property {string=} bridgeVersion     Bridge version string or "unknown"
 * @property {string=} bridgeStatus      e.g. "paired_online"
 * @property {string=} persona           Optional persona label (e.g. "RAH Master Brain")
 */

const TRANSPORT_LABEL = {
  bridge: "RAH Desktop Bridge (authenticated loopback proxy on 127.0.0.1:47824)",
  direct: "Direct browser fetch to local server (development mode)",
  cloud: "Lovable AI Gateway (cloud)",
  demo: "Local Demo Engine (canned, no model call)",
};

function fmt(value) {
  if (value === undefined || value === null || value === "") return "unknown";
  return String(value);
}

/**
 * @param {RahRuntimeIdentity} id
 * @returns {string}
 */
export function buildRuntimeIdentityPrompt(id) {
  const engine = fmt(id?.engine);
  const engineLabel = fmt(id?.engineLabel);
  const model = fmt(id?.model);
  const transport = fmt(id?.transport);
  const transportLabel = TRANSPORT_LABEL[transport] || transport;
  const bridgeVersion = id?.bridgeVersion !== undefined ? fmt(id.bridgeVersion) : null;
  const bridgeStatus = id?.bridgeStatus !== undefined ? fmt(id.bridgeStatus) : null;
  const persona = id?.persona ? String(id.persona) : null;

  const lines = [
    "=== RAH RUNTIME IDENTITY (authoritative) ===",
    "This block is supplied by the Raven Command runtime configuration, NOT",
    "self-reported by the model. Treat every field as ground truth for",
    "self-identification questions.",
    "",
    `- Engine/Provider: ${engineLabel} (id: ${engine})`,
    `- Model: ${model}`,
    `- Transport: ${transportLabel}`,
  ];
  if (bridgeVersion !== null) lines.push(`- Bridge version: ${bridgeVersion}`);
  if (bridgeStatus !== null) lines.push(`- Bridge status: ${bridgeStatus}`);
  if (persona) lines.push(`- Active persona label: ${persona}`);

  lines.push(
    "",
    "Self-identification rules (MUST follow):",
    "1. When the user asks which model, engine, provider, backend, or transport is answering, report the values above exactly. Do NOT hedge, and do NOT claim uncertainty about any field whose value is filled in above.",
    "2. If a specific field above is literally \"unknown\", say that specific field is unknown — do NOT invent a substitute value.",
    `3. NEVER claim you are running via a cloud API, OpenAI, Anthropic, Google Gemini API, or the Lovable AI Gateway when the Engine is "${engine}". Local execution is authoritative — if the block above says LM Studio or Ollama, that is what is answering.`,
    "4. Your persona (e.g. \"RAH Raven\", \"RAH Master Brain\") is a character label chosen by the Raven Command orchestrator. It is NOT the underlying model. When asked \"what model are you?\", answer with the Model field above, not the persona name. You may still speak in-persona.",
    "5. If asked to prove the runtime, quote the Engine, Model, Transport, and (when present) Bridge version fields verbatim from this block.",
    "=== END RAH RUNTIME IDENTITY ===",
  );
  return lines.join("\n");
}

export const RUNTIME_IDENTITY_MARKER = "=== RAH RUNTIME IDENTITY (authoritative) ===";