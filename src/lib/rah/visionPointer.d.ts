import type { DisplayTransform, Frame, Point, Region, History } from "./visionGeometry";

export const KEY_NUDGE_STEP: number;
export const KEY_NUDGE_LARGE: number;

export type PointerMode = "idle" | "drawing" | "moving" | "resizing";

export interface DragState {
  originImage: Point | null;
  currentImage: Point | null;
  handle?: string;
  id?: string;
  startRegion?: Region;
}

export interface PointerState {
  regions: Region[];
  selectedId: string | null;
  history: History;
  mode: PointerMode;
  drag: DragState | null;
  dirty: boolean;
}

export type PointerAction =
  | { type: "pointer-down"; point: Point; transform: DisplayTransform; frame: Frame; modifiers?: { spaceOnly?: boolean } }
  | { type: "pointer-move"; point: Point; transform: DisplayTransform; frame: Frame }
  | { type: "pointer-up"; point: Point; transform: DisplayTransform; frame: Frame }
  | { type: "pointer-cancel" }
  | { type: "key"; key: string; shift?: boolean; frame: Frame }
  | { type: "select"; id: string | null }
  | { type: "remove"; id: string }
  | { type: "clear-all" }
  | { type: "relabel"; id: string; label: string | null }
  | { type: "set-regions"; regions: Region[]; frame?: Frame }
  | { type: "undo" }
  | { type: "redo" };

export function createPointerState(initialRegions?: Region[]): PointerState;
export function reducePointer(state: PointerState, action: PointerAction): PointerState;
export function canUndo(state: PointerState): boolean;
export function canRedo(state: PointerState): boolean;
export function draftDrawRect(state: PointerState, frame: Frame): { x: number; y: number; w: number; h: number } | null;
export function shortcutsAreSuppressed(target: EventTarget | null | undefined): boolean;