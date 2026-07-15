// Shared protocol constants between the RAH Desktop Bridge and Raven Command.
// Any change here must be reflected in src/lib/rah/bridge-protocol.ts on the web side.

export const BRIDGE_VERSION = "0.2.2";

// Feature flags advertised on GET /v1/health so the web client can gate
// behaviour on the presence of a capability instead of a version string
// alone. Never remove a flag once shipped; add new ones for new features.
export const BRIDGE_FEATURES = ["localAiProxy", "textFileWrite"];
export const PROTOCOL_VERSION = "v1";
export const DEFAULT_PORT = 47824;
export const MAX_REQUEST_TIMESTAMP_SKEW_MS = 60_000;
export const MAX_BODY_BYTES = 1_000_000;
export const PAIRING_CODE_TTL_MS = 5 * 60_000;

export const READ_TEXT_EXTENSIONS = [
  ".txt", ".md", ".json", ".csv", ".log",
  ".html", ".css", ".js", ".ts", ".tsx",
  ".py", ".ps1", ".yaml", ".yml",
];
export const READ_TEXT_MAX_BYTES = 512 * 1024;
// v0.2.2: writeText/appendText upper bound. Kept smaller than read to
// discourage using the bridge as a general file store; project notes,
// READMEs, and status files fit well within this cap.
export const WRITE_TEXT_MAX_BYTES = 256 * 1024;
// Basename patterns we always refuse — credential and system files.
export const BLOCKED_TEXT_BASENAMES = [
  ".env", ".env.local", ".env.production", ".env.development",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
  "authorized_keys", "known_hosts",
  ".npmrc", ".pypirc", ".netrc", ".pgpass",
  "credentials", "config",  // aws/gcloud-style
  "shadow", "passwd", "sudoers", "hosts",
];

// v0.1.1: HTTPS only. HTTP and mailto are explicitly rejected.
export const SAFE_URL_SCHEMES = ["https:"];
export const BLOCKED_URL_SCHEMES = [
  "http:", "mailto:",
  "file:", "javascript:", "data:", "vbscript:", "ftp:",
  "powershell:", "shell:", "ms-cxh:", "ms-cxh-full:",
];

// Approval / job lifetime constants
export const JOB_APPROVAL_TTL_MS = 5 * 60_000;

export const CAPABILITIES = {
  "system.status":      { risk: "low",    requiresApproval: false, category: "read" },
  "files.list":         { risk: "low",    requiresApproval: false, category: "read" },
  "files.search":       { risk: "low",    requiresApproval: false, category: "read" },
  "files.readText":     { risk: "low",    requiresApproval: false, category: "read" },
  "files.createFolder": { risk: "medium", requiresApproval: true,  category: "write" },
  "files.writeText":    { risk: "medium", requiresApproval: true,  category: "write" },
  "files.appendText":   { risk: "medium", requiresApproval: true,  category: "write" },
  "files.rename":       { risk: "medium", requiresApproval: true,  category: "write" },
  "files.copy":         { risk: "medium", requiresApproval: true,  category: "write" },
  "files.move":         { risk: "medium", requiresApproval: true,  category: "write" },
  "files.recycle":      { risk: "high",   requiresApproval: true,  category: "write" },
  "launch.explorer":    { risk: "low",    requiresApproval: true,  category: "launch" },
  "launch.url":         { risk: "low",    requiresApproval: true,  category: "launch" },
  "launch.program":     { risk: "high",   requiresApproval: true,  category: "launch", disabled: true },
  "screenshot.capture": { risk: "medium", requiresApproval: true,  category: "screen", disabled: true },
};

// v0.2.0 — authenticated Local AI proxy targets. Only loopback destinations,
// no arbitrary hosts. Enforced by src/localai.js at request time. The env
// overrides exist for tests (spinning fakes on ephemeral loopback ports) —
// they cannot escape loopback because assertLoopback() re-checks every call.
export const LOCAL_AI_LMSTUDIO_BASE =
  process.env.RAH_LMSTUDIO_BASE || "http://127.0.0.1:1234/v1";
export const LOCAL_AI_OLLAMA_BASE =
  process.env.RAH_OLLAMA_BASE || "http://127.0.0.1:11434";

export const DISABLED_CAPABILITIES = Object.entries(CAPABILITIES)
  .filter(([, v]) => v.disabled)
  .map(([k]) => k);
