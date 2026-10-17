/**
 * TSUZUKU — the Tsuzuku Flame (design 03 §7): a streak with forgiveness
 * built in. Pure state machine + the `startStreak` reducer.
 *
 *  A day counts      any finished session, a Kage run, a Welcome Back set,
 *                    or ≥ 20 graded reviews.
 *  Full day (gold)   all Three Kata done; derived from the quests slice,
 *                    never stored on the streak.
 *  Freeze tokens 氷  1 per 7 streak days, hold 3, auto-applied on a missed
 *                    day before anything else ("Rest is training").
 *  Planned rest 休み a fixed weekday never breaks the streak.
 *  Ember 残り火      with no token, a missed day turns the flame to embers
 *                    for 48 h (`ember` = the first ember day); a Kumite or
 *                    larger restores it; a second missed day breaks it.
 *  七転八起 repair   on a break, train 3 of the next 5 days and the previous
 *                    count returns; one repair per 30 days.
 *  Weekly Flame      weeks with ≥ 5 active days (counted on the 5th).
 *  Vacation          up to 30 days; the flame is frozen.
 *  Identity          `totalDays` and `longest` never decrease.
 *
 * Day judgments are driven by the day roll (`store/day.ts`): `onDayRolled(s,
 * d, restDay)` judges the day before `d` when it was missed, once per day,
 * so a long absence is a loop of cheap pure calls.
 */
import { bus } from '../shared/events';
import { weekOf, weekdayOf } from '../shared/time';
import type { DailyRow, EpochDay, Store, Streak } from '../shared/store-types';

export type FlameState = 'lit' | 'gold' | 'ember' | 'frozen' | 'rest' | 'broken';

export const FREEZE_EVERY = 7;
export const FREEZE_MAX = 3;
/** Days the flame stays in embers (48 h = the ember day and the next). */
export const EMBER_DAYS = 2;
export const REPAIR_WINDOW_DAYS = 5;
export const REPAIR_NEEDED = 3;
export const REPAIR_COOLDOWN_DAYS = 30;
export const VACATION_MAX_DAYS = 30;
export const WEEKLY_FLAME_DAYS = 5;
/** Graded reviews that make a day count without a finished session. */
export const REVIEWS_FOR_A_DAY = 20;

/** `Streak.repairWindow` with the count to restore (JSON-safe extra prop, like kiai's `lostCombo`). */
export interface RepairWindow {
  start: EpochDay;
  done: number;
  /** The streak count before the break. */
  prev?: number;
}

function repairOf(s: Streak): RepairWindow | undefined {
  return s.repairWindow as RepairWindow | undefined;
}

function windowOver(w: RepairWindow, day: EpochDay): boolean {
  return day > w.start + REPAIR_WINDOW_DAYS - 1;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Visible state                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The flame as the Dojo shows it. `fullDay` (all Three Kata done today) turns
 * a lit flame gold; the quests slice knows it, the streak does not.
 */
export function flameState(s: Streak, today: EpochDay, restDay: number | null, fullDay = false): FlameState {
  if (s.vacationUntil !== undefined && s.vacationUntil >= today) return 'frozen';
  if (s.lastDay === today) return fullDay ? 'gold' : 'lit';
  if (s.ember !== undefined && today - s.ember < EMBER_DAYS && s.lastDay < s.ember) return 'ember';
  const w = repairOf(s);
  if (w && !windowOver(w, today)) return 'broken';
  if (s.current <= 0) return 'broken';
  if (restDay !== null && weekdayOf(today) === restDay && s.lastDay === today - 1) return 'rest';
  if (s.lastDay === today - 1) return 'lit';
  // Yesterday was missed yet the count survived: a planned rest or a freeze token held it.
  if (restDay !== null && s.lastDay === today - 2 && weekdayOf(today - 1) === restDay) return 'lit';
  return 'frozen';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Day roll: judge the day before `today` when it was missed                 */
/* ────────────────────────────────────────────────────────────────────────── */

function breakStreak(s: Streak, day: EpochDay): Streak {
  const eligible = s.lastRepairDay === undefined || day - s.lastRepairDay >= REPAIR_COOLDOWN_DAYS;
  const next: Streak = { ...s, current: 0 };
  delete next.ember;
  delete next.repairWindow;
  if (eligible && s.current > 0) {
    const w: RepairWindow = { start: day, done: 0, prev: s.current };
    next.repairWindow = w;
  }
  return next;
}

/**
 * Roll into `today`. Judges yesterday if it was missed (not trained, not yet
 * judged). Returns the same object when nothing changes, so a repeated roll
 * on the same day is a no-op. Call once per calendar day in order.
 */
export function onDayRolled(s: Streak, today: EpochDay, restDay: number | null): Streak {
  const y = today - 1;
  let out = s;

  // Vacation over?
  if (out.vacationUntil !== undefined && out.vacationUntil < y) {
    out = { ...out };
    delete out.vacationUntil;
  }

  if (out.lastDay >= y) {
    // Yesterday was trained (or is in the future on a clock jump): nothing to judge.
    // A stale ember whose window closed goes out quietly.
    if (out.ember !== undefined && today - out.ember >= EMBER_DAYS) {
      out = { ...out };
      delete out.ember;
    }
    return out;
  }

  // Yesterday was missed.
  if (out.vacationUntil !== undefined && y <= out.vacationUntil) return out; // frozen

  const w = repairOf(out);
  if (w) {
    if (windowOver(w, y)) {
      // The five days passed without three training days: the window closes.
      out = { ...out };
      delete out.repairWindow;
    } else {
      // Inside the window a missed day only resets the small new count.
      return out.current === 0 ? out : { ...out, current: 0 };
    }
  }

  if (out.current <= 0) {
    if (out.ember !== undefined) {
      out = { ...out };
      delete out.ember;
    }
    return out;
  }

  if (restDay !== null && weekdayOf(y) === restDay) return { ...out, restDaysTaken: out.restDaysTaken + 1 };
  if (out.freezes > 0) return { ...out, freezes: out.freezes - 1 };

  if (out.ember === undefined) return { ...out, ember: today };
  if (out.lastDay >= out.ember) return { ...out, ember: today }; // trained during the embers (a Kata): a fresh miss
  if (y === out.ember) return out; // first ember day missed: still embers for one more day
  if (y < out.ember + EMBER_DAYS) return breakStreak(out, today); // both ember days missed
  return { ...out, ember: today };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Training day                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TrainingDayOptions {
  /** A Kumite or larger relights embers (a Kata keeps the day but not the flame). */
  restore?: boolean;
  /** Active days in `today`'s week including today (Weekly Flame credits on the 5th). */
  activeDaysThisWeek?: number;
}

/**
 * Credit `today` as a training day. Idempotent: a second call on the same
 * day returns the same object. `full` (all Three Kata) is accepted for the
 * API shape; gold is derived from the quests slice, not stored here.
 */
export function onTrainingDay(s: Streak, today: EpochDay, full = false, o: TrainingDayOptions = {}): Streak {
  void full;
  if (s.lastDay === today) return s;
  const out: Streak = { ...s };

  if (out.vacationUntil !== undefined && out.vacationUntil < today) delete out.vacationUntil;

  let w = repairOf(out);
  if (w && windowOver(w, today)) {
    delete out.repairWindow;
    w = undefined;
  }

  out.current = out.current > 0 ? out.current + 1 : 1;
  out.totalDays = out.totalDays + 1;
  out.lastDay = today;

  if (out.ember !== undefined) {
    const inWindow = today - out.ember < EMBER_DAYS;
    if (inWindow && o.restore) {
      delete out.ember;
      out.emberRestores = out.emberRestores + 1;
    } else if (!inWindow) {
      delete out.ember;
    }
  }

  if (w) {
    const done = w.done + 1;
    if (done >= REPAIR_NEEDED) {
      out.current = (w.prev ?? 0) + done;
      out.repairs = out.repairs + 1;
      out.lastRepairDay = today;
      delete out.repairWindow;
    } else {
      const next: RepairWindow = { ...w, done };
      out.repairWindow = next;
    }
  }

  if (out.current % FREEZE_EVERY === 0) out.freezes = Math.min(FREEZE_MAX, out.freezes + 1);
  if (o.activeDaysThisWeek === WEEKLY_FLAME_DAYS) out.weekly = out.weekly + 1;
  out.longest = Math.max(out.longest, out.current);
  return out;
}

/** Freeze the flame until `until` (≤ 30 days from `today` when given). */
export function startVacation(s: Streak, until: EpochDay, today?: EpochDay): Streak {
  const cap = today === undefined ? until : Math.min(until, today + VACATION_MAX_DAYS);
  if (today !== undefined && cap < today) return s;
  return { ...s, vacationUntil: cap };
}

export function endVacation(s: Streak): Streak {
  if (s.vacationUntil === undefined) return s;
  const out = { ...s };
  delete out.vacationUntil;
  return out;
}

/** Active days (reps or minutes) in the week of `today`, counting today as active. */
export function activeDaysInWeek(daily: Record<EpochDay, DailyRow>, today: EpochDay): number {
  const week = weekOf(today);
  let n = 1;
  for (let d = week * 7 - 3; d < week * 7 + 4; d++) {
    if (d === today) continue;
    const row = daily[d];
    if (row && (row.reps > 0 || row.minutes > 0)) n++;
  }
  return n;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducer                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const RESTORING_MODES: ReadonlySet<string> = new Set(['kumite', 'shugyo', 'gate', 'shinsa', 'kage', 'welcome', 'dan', 'weak', 'scroll']);
const ARCADE: ReadonlySet<string> = new Set(['rapid-fire', 'gojuon-fighter']);

export function startStreak(store: Store): () => void {
  let repsDay: EpochDay = Number.NaN;
  let repsToday = 0;

  function fullDayToday(today: EpochDay): boolean {
    const q = store.quests.value;
    return q.day === today && q.ids.length > 0 && q.ids.every((id) => q.done.includes(id));
  }

  function announce(): void {
    const today = store.today();
    const s = store.streak.value;
    bus.emit('streak:changed', { current: s.current, state: flameState(s, today, store.settings.value.restDay, fullDayToday(today)) });
  }

  function credit(restore: boolean): void {
    const today = store.today();
    const before = store.streak.value;
    if (before.lastDay === today) return;
    const after = onTrainingDay(before, today, fullDayToday(today), {
      restore,
      activeDaysThisWeek: activeDaysInWeek(store.daily.value, today),
    });
    if (after === before) return;
    store.patch('streak', () => after);
    announce();
  }

  const offs = [
    bus.on('session:finished', (p) => credit(RESTORING_MODES.has(p.mode))),
    bus.on('kage:result', () => credit(true)),
    bus.on('welcome-back:done', () => credit(true)),
    bus.on('attempt:graded', (p) => {
      if (ARCADE.has(p.exercise) || p.rating === null) return;
      const today = store.today();
      if (repsDay !== today) {
        repsDay = today;
        repsToday = 0;
      }
      repsToday++;
      if (repsToday >= REVIEWS_FOR_A_DAY) credit(false);
    }),
    bus.on('quest:completed', (p) => {
      if (p.allDone) announce();
    }),
    bus.on('day:rolled', () => announce()),
  ];

  return () => {
    for (const off of offs) off();
  };
}
