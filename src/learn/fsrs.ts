/**
 * TSUZUKU — FSRS-5 in pure TypeScript (design 05 §1).
 *
 * No runtime dependency: the 19 default weights, retrievability, the interval
 * for a desired retention, initial S/D, the mean-reverting difficulty update,
 * success / lapse / same-day stability and `schedule()` over a `CardTuple`.
 *
 * Conventions
 *  - Time is in epoch days (04:00 boundary, `shared/time.ts`); `due` and `last`
 *    are integers. Two reviews on the same epoch day take the short-term path.
 *  - The stability update uses the difficulty *before* this review (py-fsrs
 *    convention); difficulty is updated independently.
 *  - `schedule()` is pure: `rng` and `loadOnDay` are injected. Fuzz is ±5 % of
 *    the interval; within that window the least-loaded day wins and ties are
 *    broken by `rng` (so a constant rng is fully deterministic).
 *  - Stored `s`/`d` are rounded to 2 decimals (store contract, ARCHITECTURE §1).
 *  - CardTuple state: 0 new · 1 learning · 2 review · 3 relearning; flag 8
 *    (`CardFlag.stepPending`) marks in-session steps owed (+3/+10, relearn +5).
 *
 * The formulas follow design 05 §1 verbatim; the golden table in
 * `fsrs-golden.ts` was generated from this implementation and frozen (see there).
 */
import { CardFlag, hasFlag, withFlag, withoutFlag, type CardState, type CardTuple, type EpochDay, type Rating } from '../shared/store-types';

/** FSRS-5 default weights w[0..18] (design 05 §1). */
export const W: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698,
  0.2315, 2.9898, 0.51655, 0.6621,
];

export const DECAY = -0.5;
export const FACTOR = 19 / 81;
/** Design 05 §1: intervals never exceed one year. */
export const MAX_INTERVAL = 365;
export const MIN_INTERVAL = 1;
/** ±5 % of the interval (design 05 §1). */
export const FUZZ_RATIO = 0.05;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

export const RATING_AGAIN = 1 as const;
export const RATING_HARD = 2 as const;
export const RATING_GOOD = 3 as const;
export const RATING_EASY = 4 as const;

const w = (i: number): number => W[i] as number;

export function clampDifficulty(d: number): number {
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, d));
}

/** Two-decimal rounding used for every stored `s` / `d`. */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** R(t, S) = (1 + FACTOR · t / S) ^ DECAY. A card with no stability has R = 0. */
export function retrievability(elapsedDays: number, s: number): number {
  if (!(s > 0)) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + (FACTOR * t) / s, DECAY);
}

/**
 * I(r, S) = (S / FACTOR) · (r ^ (1/DECAY) − 1), rounded to whole days and
 * clamped to [1, maxInterval]. At r = 0.9 the interval equals S.
 */
export function nextInterval(r: number, s: number, maxInterval: number = MAX_INTERVAL): number {
  const rr = Math.min(0.9999, Math.max(0.0001, r));
  const raw = (s / FACTOR) * (Math.pow(rr, 1 / DECAY) - 1);
  const days = Math.round(raw);
  return Math.min(Math.max(MIN_INTERVAL, maxInterval), Math.max(MIN_INTERVAL, days));
}

/** S0(g) = w[g − 1]. */
export function initialStability(g: Rating): number {
  return w(g - 1);
}

/** D0(g) = w4 − e^(w5 · (g − 1)) + 1, clamped 1..10. */
export function initialDifficulty(g: Rating): number {
  return clampDifficulty(w(4) - Math.exp(w(5) * (g - 1)) + 1);
}

/** D' = w7 · D0(4) + (1 − w7) · (D − w6 · (g − 3)), clamped 1..10 (mean reversion toward the Easy start). */
export function nextDifficulty(d: number, g: Rating): number {
  const shifted = d - w(6) * (g - 3);
  return clampDifficulty(w(7) * initialDifficulty(RATING_EASY) + (1 - w(7)) * shifted);
}

/** S'_success = S · (e^w8 · (11 − D) · S^(−w9) · (e^(w10 · (1 − R)) − 1) · [g=2 ? w15 : 1] · [g=4 ? w16 : 1] + 1). */
export function successStability(s: number, d: number, r: number, g: Rating): number {
  const hard = g === RATING_HARD ? w(15) : 1;
  const easy = g === RATING_EASY ? w(16) : 1;
  const growth = Math.exp(w(8)) * (11 - d) * Math.pow(s, -w(9)) * (Math.exp(w(10) * (1 - r)) - 1) * hard * easy;
  return s * (growth + 1);
}

/** S'_lapse = min(S, w11 · D^(−w12) · ((S + 1)^w13 − 1) · e^(w14 · (1 − R))). */
export function lapseStability(s: number, d: number, r: number): number {
  const next = w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r));
  return Math.min(s, next);
}

/** Stability after a review on a later day: lapse formula for Again, success formula otherwise. */
export function nextStability(s: number, d: number, r: number, g: Rating): number {
  return g === RATING_AGAIN ? lapseStability(s, d, r) : successStability(s, d, r, g);
}

/** S'_same_day = S · e^(w17 · (g − 3 + w18)) (short-term step). */
export function sameDayStability(s: number, g: Rating): number {
  return s * Math.exp(w(17) * (g - 3 + w(18)));
}

export interface FsrsScheduleOpts {
  /** Desired retention 0.85 / 0.90 / 0.95. */
  retention: number;
  /** Cards already due on `d` — the load-balancing hook. */
  loadOnDay: (d: EpochDay) => number;
  /** Uniform [0, 1); only used to break ties between equally loaded days. */
  rng: () => number;
  /** Defaults to `MAX_INTERVAL`. */
  maxInterval?: number;
}

/**
 * Fuzz window for an interval: ±5 %, never below 1 day, never above `maxInterval`.
 * Windows narrower than a day collapse to the interval itself.
 */
export function fuzzWindow(interval: number, maxInterval: number = MAX_INTERVAL): [lo: number, hi: number] {
  const span = Math.floor(interval * FUZZ_RATIO);
  const lo = Math.max(MIN_INTERVAL, interval - span);
  const hi = Math.min(Math.max(MIN_INTERVAL, maxInterval), interval + span);
  return hi < lo ? [lo, lo] : [lo, hi];
}

/**
 * Picks the due day inside the fuzz window with the fewest cards already due;
 * ties broken uniformly by `rng`.
 */
export function balancedDue(today: EpochDay, interval: number, o: FsrsScheduleOpts): EpochDay {
  const [lo, hi] = fuzzWindow(interval, o.maxInterval ?? MAX_INTERVAL);
  if (hi === lo) return today + lo;
  let best: number[] = [];
  let bestLoad = Infinity;
  for (let k = lo; k <= hi; k++) {
    const load = o.loadOnDay(today + k);
    if (load < bestLoad) {
      bestLoad = load;
      best = [k];
    } else if (load === bestLoad) {
      best.push(k);
    }
  }
  const idx = Math.min(best.length - 1, Math.floor(o.rng() * best.length));
  return today + (best[idx] as number);
}

/** Next FSRS state for a rating, before in-session step bookkeeping. */
function nextState(prev: CardState, g: Rating): { state: CardState; lapse: boolean; stepPending: boolean } {
  switch (prev) {
    case 0:
      return g === RATING_EASY ? { state: 2, lapse: false, stepPending: false } : { state: 1, lapse: false, stepPending: true };
    case 1:
      if (g >= RATING_GOOD) return { state: 2, lapse: false, stepPending: false };
      return { state: 1, lapse: false, stepPending: true };
    case 2:
      if (g === RATING_AGAIN) return { state: 3, lapse: true, stepPending: true };
      return { state: 2, lapse: false, stepPending: false };
    case 3:
      if (g >= RATING_GOOD) return { state: 2, lapse: false, stepPending: false };
      return { state: 3, lapse: false, stepPending: true };
  }
}

/**
 * Applies a rating on `today` and returns the new tuple. Pure.
 *
 *  - new card (state 0): S0/D0 from the rating; Easy (既知) goes straight to review.
 *  - same epoch day as `last`: short-term stability, difficulty still updated.
 *  - later day: R from the elapsed days, then the success/lapse stability formula.
 *  - Again on a review card is a lapse (`lapses + 1`, state 3); learning-state
 *    misses are not lapses (design 05 §4 "learning-step miss").
 *  - due = today + load-balanced fuzzed interval for `retention`.
 *  - flags: archived/nemesis/kaiden are preserved; step-pending is set/cleared.
 */
export function schedule(card: CardTuple, g: Rating, today: EpochDay, o: FsrsScheduleOpts): CardTuple {
  const [, s, d, reps, lapses, state, last, flags] = card;
  const maxInterval = o.maxInterval ?? MAX_INTERVAL;
  let s2: number;
  let d2: number;
  if (state === 0 || !(s > 0)) {
    s2 = initialStability(g);
    d2 = initialDifficulty(g);
  } else if (last === today) {
    s2 = sameDayStability(s, g);
    d2 = nextDifficulty(d, g);
  } else {
    const r = retrievability(today - last, s);
    s2 = nextStability(s, d, r, g);
    d2 = nextDifficulty(d, g);
  }
  const ns = nextState(state, g);
  const interval = nextInterval(o.retention, s2, maxInterval);
  const due = balancedDue(today, interval, { ...o, maxInterval });
  let flags2 = flags & ~CardFlag.stepPending;
  if (ns.stepPending) flags2 = withFlag(flags2, CardFlag.stepPending);
  else flags2 = withoutFlag(flags2, CardFlag.stepPending);
  return [due, round2(s2), round2(d2), reps + 1, lapses + (ns.lapse ? 1 : 0), ns.state, today, flags2];
}

/** True when the card owes in-session steps (flag 8). */
export function stepPending(card: CardTuple): boolean {
  return hasFlag(card[7], CardFlag.stepPending);
}

/** Retrievability of a card on `today` (0 for a never-reviewed card). */
export function cardRetrievability(card: CardTuple, today: EpochDay): number {
  if (card[5] === 0 || !(card[1] > 0)) return 0;
  return retrievability(today - card[6], card[1]);
}
