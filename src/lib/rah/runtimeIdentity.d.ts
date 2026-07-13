export interface RahRuntimeIdentity {
  engine: "lmstudio" | "ollama" | "cloud" | "demo";
  engineLabel: string;
  model: string;
  transport: "bridge" | "direct" | "cloud" | "demo";
  bridgeVersion?: string;
  bridgeStatus?: string;
  persona?: string;
}

export function buildRuntimeIdentityPrompt(id: RahRuntimeIdentity): string;
export const RUNTIME_IDENTITY_MARKER: string;