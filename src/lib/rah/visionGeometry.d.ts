export const MIN_REGION_EDGE: number;
export const DEFAULT_HISTORY_LIMIT: number;
export const HIT_TEST_HANDLE: number;

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type HandleOrBody = Handle | "body";
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Region extends Rect { id: string; label: string | null; createdAt: number }
export interface Frame { width: number; height: number }
export interface DisplayTransform {
  scale: number; offsetX: number; offsetY: number;
  displayWidth: number; displayHeight: number;
  sourceWidth: number; sourceHeight: number;
  drawnWidth: number; drawnHeight: number;
  fit?: "contain" | "cover" | "stretch";
}

export function computeDisplayTransform(args: { displayWidth: number; displayHeight: number; sourceWidth: number; sourceHeight: number; fit?: "contain" | "cover" | "stretch" }): DisplayTransform | null;
export function displayToImage(t: DisplayTransform | null, p: Point | null): Point | null;
export function imageToDisplay(t: DisplayTransform | null, p: Point | null): Point | null;
export function normalizeDrag(args: { start: Point; end: Point; frame: Frame; minEdge?: number }): { ok: boolean; rect?: Rect; reason?: string };
export function clampRegionToFrame(region: Region, frame: Frame, opts?: { minEdge?: number }): Region | null;
export function moveRegion(region: Region, delta: { dx: number; dy: number }, frame: Frame, opts?: { minEdge?: number }): Region;
export function resizeRegion(region: Region, handle: Handle, delta: { dx: number; dy: number }, frame: Frame, opts?: { minEdge?: number }): Region;
export function hitTestRegion(region: Region, point: Point): boolean;
export function hitTestHandle(region: Region, transform: DisplayTransform, displayPoint: Point, opts?: { handleSize?: number }): HandleOrBody | null;
export function sortRegionsStable(regions: Region[]): Region[];
export function regionsAreDirty(a: Region[], b: Region[]): boolean;
export function createRegion(args?: Partial<Region> & { now?: number; regionId?: string | null }): Region;
export interface History { past: Region[][]; future: Region[][]; limit: number }
export function createHistory(initial?: Region[], opts?: { limit?: number }): History;
export function historyPresent(history: History): Region[];
export function historyPush(history: History, next: Region[]): History;
export function canUndo(history: History): boolean;
export function canRedo(history: History): boolean;
export function historyUndo(history: History): History;
export function historyRedo(history: History): History;
export function frameDuplicateStrength(a: { hash?: string | null; width?: number; height?: number; sizeBytes?: number } | null, b: { hash?: string | null; width?: number; height?: number; sizeBytes?: number } | null): { duplicate: boolean; strength: "hash" | "metadata" | "none" };