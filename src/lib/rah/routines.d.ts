export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export interface Routine {
  id: string;
  name: string;
  time: string;
  days: Weekday[];
  room: string;
  deviceId?: string;
  action: string;
  requireConfirmation: boolean;
  enabled: boolean;
  lastRunTs?: number;
  createdAt: number;
  updatedAt: number;
}
export const ROUTINES_KEY: string;
export const WEEKDAYS: Weekday[];
export function normalizeRoutine(input: Partial<Routine>, now?: number): Routine;
export function isRoutineForDay(routine: Routine, at?: Date): boolean;
export function isRoutineDueNow(routine: Routine, at?: Date): boolean;
export function routinesDueToday(list: Routine[], at?: Date): Routine[];
export function routineLabel(r: Routine): string;
export function loadRoutines(): Routine[];
export function saveRoutines(list: Routine[]): void;
export function seedRoutinesIfEmpty(now?: number): Routine[];