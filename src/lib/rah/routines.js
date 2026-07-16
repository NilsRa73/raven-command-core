// Routine Mode — scheduled + on-demand routines persisted to localStorage.
// Pure logic + a thin storage layer so Node tests can exercise scheduling.

/**
 * @typedef {"mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun"} Weekday
 * @typedef {{
 *   id: string,
 *   name: string,
 *   time: string,            // "HH:MM"
 *   days: Weekday[],         // empty = every day
 *   room: string,
 *   deviceId?: string,
 *   action: string,
 *   requireConfirmation: boolean,
 *   enabled: boolean,
 *   lastRunTs?: number,
 *   createdAt: number,
 *   updatedAt: number,
 * }} Routine
 */

export const ROUTINES_KEY = "rah.routines.v1";

/** All weekday keys in order Sun..Sat matches JS getDay(). */
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Validate + normalize a routine input. Throws on invalid time. */
export function normalizeRoutine(input, now = Date.now()) {
  const time = String(input?.time ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("routine: invalid time (HH:MM)");
  const [h, m] = time.split(":").map((x) => Number(x));
  if (h < 0 || h > 23 || m < 0 || m > 59) throw new Error("routine: time out of range");
  const days = Array.isArray(input?.days) ? input.days.filter((d) => WEEKDAYS.includes(d)) : [];
  return {
    id: String(input?.id ?? `r_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`),
    name: String(input?.name ?? "Untitled routine").slice(0, 120),
    time,
    days,
    room: String(input?.room ?? "").slice(0, 80),
    deviceId: input?.deviceId ? String(input.deviceId).slice(0, 80) : undefined,
    action: String(input?.action ?? "").slice(0, 400),
    requireConfirmation: Boolean(input?.requireConfirmation),
    enabled: input?.enabled !== false,
    lastRunTs: typeof input?.lastRunTs === "number" ? input.lastRunTs : undefined,
    createdAt: typeof input?.createdAt === "number" ? input.createdAt : now,
    updatedAt: now,
  };
}

/** Is a routine scheduled for today (given local Date.now())? */
export function isRoutineForDay(routine, at = new Date()) {
  if (!routine?.enabled) return false;
  if (!routine.days || routine.days.length === 0) return true;
  return routine.days.includes(WEEKDAYS[at.getDay()]);
}

/** True if routine time has passed today and hasn't run yet today. */
export function isRoutineDueNow(routine, at = new Date()) {
  if (!isRoutineForDay(routine, at)) return false;
  const [h, m] = routine.time.split(":").map((x) => Number(x));
  const scheduled = new Date(at);
  scheduled.setHours(h, m, 0, 0);
  if (at.getTime() < scheduled.getTime()) return false;
  if (routine.lastRunTs) {
    const last = new Date(routine.lastRunTs);
    if (last.toDateString() === at.toDateString() && last.getTime() >= scheduled.getTime()) return false;
  }
  return true;
}

/** Routines whose scheduled time is later today. */
export function routinesDueToday(list, at = new Date()) {
  return list.filter((r) => isRoutineForDay(r, at));
}

/** Format helper — "17:00 · Living Room". */
export function routineLabel(r) {
  return `${r.time}${r.room ? ` · ${r.room}` : ""}`;
}

/** localStorage — safe on Node (returns []). */
export function loadRoutines() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(ROUTINES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveRoutines(list) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(ROUTINES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function seedRoutinesIfEmpty(now = Date.now()) {
  const cur = loadRoutines();
  if (cur.length > 0) return cur;
  const seed = [
    normalizeRoutine({ name: "Runtime Funtime",    time: "17:00", room: "Living Room", action: "Start evening playlist and dim lamps.",     requireConfirmation: false, enabled: true }, now),
    normalizeRoutine({ name: "News Reframe",       time: "19:00", room: "Study",       action: "Summarize the day's saved articles calmly.", requireConfirmation: false, enabled: true }, now),
    normalizeRoutine({ name: "Raven, sleep",       time: "23:30", room: "Bedroom",     action: "Silence notifications, lock work, dim screens.", requireConfirmation: true,  enabled: true }, now),
  ];
  saveRoutines(seed);
  return seed;
}
