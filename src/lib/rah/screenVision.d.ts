export const MAX_ANALYZE_EDGE: number;
export const PRIVACY_NOTE: string;
export interface ScreenVisionPreset { id: string; label: string; question: string }
export const SCREEN_VISION_PRESETS: ScreenVisionPreset[];
export function presetById(id: string): ScreenVisionPreset | null;
export function computeCaptureSize(
  sourceW: number, sourceH: number, maxEdge?: number,
): { width: number; height: number; scale: number };
export type SharingState =
  | "idle" | "requesting" | "active" | "stream-connected" | "waiting-frame"
  | "ready" | "capturing" | "analyzing"
  | "ended" | "denied" | "unsupported" | "error";
export function sharingStateLabel(state: SharingState | string): string;
export function isCaptureReady(state: SharingState | string): boolean;
export type ReadinessEvent =
  | "request" | "grant" | "metadata" | "frame"
  | "capture-start" | "capture-done" | "analyze-done"
  | "deny" | "unsupported" | "end" | "error" | "reset";
export function nextReadiness(current: SharingState | string, event: ReadinessEvent): SharingState;
export function computeSamplePoints(width: number, height: number): { x: number; y: number }[];
export interface FrameStats { avgLuma: number; maxLuma: number; nonBlackRatio: number; count: number }
export function analyzeSamples(samples: { r: number; g: number; b: number }[]): FrameStats;
export function isLikelyBlankFrame(stats: FrameStats, opts?: { maxLumaFloor?: number; nonBlackRatioFloor?: number }): boolean;
export function estimateFps(timestamps: number[]): number;
export const NO_FRAME_RECOVERY_HINT: string;
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