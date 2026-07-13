export const MAX_ANALYZE_EDGE: number;
export const PRIVACY_NOTE: string;
export interface ScreenVisionPreset { id: string; label: string; question: string }
export const SCREEN_VISION_PRESETS: ScreenVisionPreset[];
export function presetById(id: string): ScreenVisionPreset | null;
export function computeCaptureSize(
  sourceW: number, sourceH: number, maxEdge?: number,
): { width: number; height: number; scale: number };
export type SharingState =
  | "idle" | "requesting" | "active" | "ended" | "denied" | "unsupported" | "error";
export function sharingStateLabel(state: SharingState | string): string;
export function buildScreenVisionRuntimeLine(input?: {
  provider?: string; model?: string; latencyMs?: number;
  capturedAt?: number | string; sourceLabel?: string;
}): string;
export const SCREEN_VISION_PRIVACY: Readonly<{
  autoStartOnMount: boolean;
  backgroundCapture: boolean;
  continuousFrameUpload: boolean;
  persistFramesToStorage: boolean;
  sendFramesToBridge: boolean;
  captureOnlyOnExplicitUserAction: boolean;
}>;