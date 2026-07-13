import type { BridgeStatusSnapshot } from "./bridge";

export type BridgeUiKind =
  | "checking" | "connected" | "offline"
  | "pair_required" | "update_required" | "emergency" | "error";

export function bridgeUiKind(snapshot: BridgeStatusSnapshot | null, loading: boolean): BridgeUiKind;
export function bridgeShortLabel(snapshot: BridgeStatusSnapshot | null, loading: boolean): string;
export function shouldShowBridgeOfflineBanner(
  settings: { engine: string; transport: string },
  snapshot: BridgeStatusSnapshot | null,
): boolean;
export function routeText(
  settings: { engine: string; transport: string; lmStudioModel?: string; ollamaModel?: string },
  snapshot: BridgeStatusSnapshot | null,
): string;
