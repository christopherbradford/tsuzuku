/**
 * TSUZUKU — day roll (design 03 §1, §7, §8). The 04:00 boundary is
 * `store.today()`; `quests.day` is the last day the roll ran (0 = never).
 *
 * `rollIfNeeded(store)` runs on init, when the tab becomes visible, at the
 * next 04:00 while the tab stays open, and before any session starts. It
 *  1. judges every day since the last roll through `streak.onDayRolled`
 *     (freeze tokens, planned rest, embers, repair window, vacation);
 *  2. measures the absence: 7–29 missed days → `progress.awayDays` (E's
 *     builder spreads the backlog over 7 days and pauses new items for 2);
 *     30+ → `progress.welcomeBackDue` (cleared by `welcome-back:done`);
 *  3. draws today's Three Kata (`quests.pickDailyQuests`);
 *  4. emits `day:rolled`. The Perapera month snapshot needs `@/learn`, which
 *     this barrel may not import, so `store/perapera.ts` takes it on
 *     `day:rolled` (see `monthRolled`).
 *
 * Idempotent: a second call on the same day returns `false` and changes nothing.
 */
import { bus } from '../shared/events';
import { dayEndMs, monthKey } from '../shared/time';
import type { DailyRow, EpochDay, Store } from '../shared/store-types';
import { pickDailyQuests, questsForDay } from './quests';
import { onDayRolled } from './streak';

/** Design 03 §8 (mirrors `learn/governors` AWAY_SPREAD_MIN / AWAY_NEW_PAUSE_DAYS / WELCOME_BACK_AWAY). */
export const AWAY_SPREAD_MIN = 7;
export const AWAY_SPREAD_DAYS = 7;
export const AWAY_NEW_PAUSE_DAYS = 2;
export const WELCOME_BACK_AWAY = 30;
/** Judging more than this many missed days one by one is pointless: everything before is a plain break. */
const MAX_JUDGED_DAYS = 400;

function isActive(row: DailyRow | undefined): boolean {
  return !!row && (row.reps > 0 || row.minutes > 0);
}

export interface AwayStatus {
  /** Missed days of the most recent absence of ≥ 7 days, while its 7-day spread window is open; else 0. */
  awayDays: number;
  /** Days trained since the return, not counting today (0 = returning today). */
  returnedDaysAgo: number;
  /** New items paused (first 2 days back). */
  newPaused: boolean;
  /** Days left in the backlog spread. */
  spreadDaysLeft: number;
}

/**
 * The absence as the daily rows show it (pure). The active run ending
 * yesterday is the "back" period; the inactive run before it, bounded by an
 * earlier active day, is the absence. A learner who never trained before is
 * not "away".
 */
export function awayStatus(daily: Record<EpochDay, DailyRow>, today: EpochDay): AwayStatus {
  let d = today - 1;
  let active = 0;
  while (isActive(daily[d]) && active < AWAY_SPREAD_DAYS) {
    active++;
    d--;
  }
  const none: AwayStatus = { awayDays: 0, returnedDaysAgo: active, newPaused: false, spreadDaysLeft: 0 };
  if (active >= AWAY_SPREAD_DAYS) return none;
  let inactive = 0;
  while (!isActive(daily[d]) && inactive <= MAX_JUDGED_DAYS) {
    inactive++;
    d--;
  }
  if (!isActive(daily[d]) || inactive < AWAY_SPREAD_MIN) return none;
  return {
    awayDays: inactive,
    returnedDaysAgo: active,
    newPaused: active < AWAY_NEW_PAUSE_DAYS,
    spreadDaysLeft: Math.max(0, AWAY_SPREAD_DAYS - active),
  };
}

/** `true` when `today` is the first day of a new month compared with the last roll. */
export function monthRolled(lastRollDay: EpochDay, today: EpochDay): boolean {
  return lastRollDay > 0 && monthKey(lastRollDay) !== monthKey(today);
}

/**
 * Roll the day if `store.today()` has moved past the last roll. Returns
 * whether a roll happened.
 */
export function rollIfNeeded(store: Store): boolean {
  const today = store.today();
  const q = store.quests.value;
  if (q.day >= today) return false;

  const restDay = store.settings.value.restDay;
  const streak0 = store.streak.value;
  let s = streak0;
  const judgedThrough = Math.max(q.day, s.lastDay);
  let from = judgedThrough > 0 ? judgedThrough + 1 : today;
  if (today - from > MAX_JUDGED_DAYS) from = today - MAX_JUDGED_DAYS;
  for (let d = from; d <= today; d++) s = onDayRolled(s, d, restDay);
  if (s !== streak0) store.patch('streak', () => s);

  // Absence (design 03 §8).
  const missed = s.lastDay > 0 ? Math.max(0, today - s.lastDay - 1) : 0;
  const fromRows = awayStatus(store.daily.value, today);
  const awayDays = missed >= AWAY_SPREAD_MIN ? missed : fromRows.awayDays;
  store.patch('progress', (p) => {
    const welcomeBackDue = p.welcomeBackDue || missed >= WELCOME_BACK_AWAY;
    if (p.awayDays === awayDays && p.welcomeBackDue === welcomeBackDue) return p;
    return { ...p, awayDays, welcomeBackDue };
  });

  // Three Kata for today.
  const picked = pickDailyQuests(store, today);
  store.patch('quests', (prev) => questsForDay(prev, today, picked));

  bus.emit('day:rolled', { day: today, awayDays: missed });
  return true;
}

/** Milliseconds until the next 04:00 boundary in the profile's zone. */
export function msUntilNextDay(store: Store): number {
  const tz = store.profile.value.tz;
  const now = store.now();
  let end: number;
  try {
    end = dayEndMs(store.today(), tz);
  } catch {
    end = dayEndMs(store.today());
  }
  return Math.max(1000, end - now + 1000);
}

/**
 * Roll now, then keep rolling: when the tab becomes visible, when a session
 * starts, and at the next 04:00 while the page stays open. Clears
 * `welcomeBackDue` when the Welcome Back set is done.
 */
export function startDayRoll(store: Store): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function arm(): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      rollIfNeeded(store);
      arm();
    }, msUntilNextDay(store));
  }

  const onVisible = (): void => {
    const vs = (typeof document !== 'undefined' ? document : null)?.visibilityState;
    if (vs === undefined || vs === 'visible') rollIfNeeded(store);
  };
  const doc = typeof document !== 'undefined' ? document : null;
  doc?.addEventListener('visibilitychange', onVisible);

  const offs = [
    bus.on('session:started', () => {
      rollIfNeeded(store);
    }),
    bus.on('welcome-back:done', () => {
      store.patch('progress', (p) => (p.welcomeBackDue ? { ...p, welcomeBackDue: false } : p));
    }),
  ];

  rollIfNeeded(store);
  arm();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    doc?.removeEventListener('visibilitychange', onVisible);
    for (const off of offs) off();
  };
}
