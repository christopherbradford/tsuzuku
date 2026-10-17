/**
 * TSUZUKU — load governors (design 03 §4–§5, §7–§8).
 *
 * Pure, table-driven. B's day roll and E's builder call `governor()` with the
 * numbers they hold; nothing here reads the store.
 *
 *  - Review caps are belt-scaled per preset: White–Orange → Green → Blue–Purple
 *    → Brown–Black (`REVIEW_CAPS`). `capFor` returns the preset table for the
 *    three named presets and scales `baseCap` by the Standard ratios for
 *    `custom` (`Settings.maxReviews` stores the White–Orange base).
 *  - Backlog mode when due > 2 × cap: new items pause, only `cap` reviews show.
 *  - Adaptive new rate: halves when acc7 < retention − 0.07 over ≥ 50 reviews
 *    or backlog > 1.2 × cap; restored when acc7 ≥ retention − 0.03 for 3 days
 *    AND backlog ≤ 1.2 × cap (hysteresis).
 *  - Cramming cap 2 × target; overtraining note at 1.5 × the preset's expected
 *    daily maximum; away-day backlog (≥ 7 days) spread over 7 days with new
 *    items paused for the first 2 days back.
 */
import type { Belt } from '../content/types';
import type { Intensity } from '../shared/store-types';

export type NamedPreset = Exclude<Intensity, 'custom'>;
/** 0 White–Orange · 1 Green · 2 Blue–Purple · 3 Brown–Black. */
export type CapTier = 0 | 1 | 2 | 3;

export const REVIEW_CAPS: Record<NamedPreset, readonly [number, number, number, number]> = {
  casual: [80, 110, 130, 170],
  standard: [160, 200, 240, 320],
  intense: [300, 360, 420, 540],
};

export const PRESET_RETENTION: Record<NamedPreset, number> = { casual: 0.85, standard: 0.9, intense: 0.9 };

/** Upper end of design 03 §4 "expected minutes/day"; the overtraining note fires at 1.5 × this. */
export const EXPECTED_MAX_MINUTES: Record<NamedPreset, number> = { casual: 35, standard: 60, intense: 95 };

/** New items/day relative to Standard (03 §4: 5 / 8.75 / 16 at N5). */
export const PRESET_RATE_SCALE: Record<NamedPreset, number> = { casual: 5 / 8.75, standard: 1, intense: 16 / 8.75 };

export interface NewRate {
  vocab: number;
  kanji: number;
  grammar: number;
  /** Kana items/day (White only). */
  kana?: number;
}

/** Standard new-item rates per belt (design 02 §6.1). */
export const NEW_RATE_BY_BELT: Record<Belt, NewRate> = {
  white: { vocab: 4, kanji: 0, grammar: 0, kana: 20 },
  yellow: { vocab: 7, kanji: 1, grammar: 0.75 },
  orange: { vocab: 7, kanji: 1, grammar: 0.75 },
  green: { vocab: 8, kanji: 2.5, grammar: 1 },
  blue: { vocab: 12, kanji: 2.5, grammar: 0.8 },
  purple: { vocab: 12, kanji: 2.5, grammar: 0.8 },
  brown: { vocab: 14, kanji: 3, grammar: 0.8 },
  black: { vocab: 14, kanji: 0, grammar: 0.7 },
};

/** Year-one lifetime reviews per item at retention 0.9 (design 05 §2 load model). */
export const REVIEWS_PER_ITEM = { vocab: 15, kanji: 12, grammar: 14, kana: 3 } as const;

export const BACKLOG_FACTOR = 2;
export const HALVE_BACKLOG_FACTOR = 1.2;
export const ACC_HALVE_DELTA = 0.07;
export const ACC_RESTORE_DELTA = 0.03;
export const RESTORE_DAYS = 3;
export const MIN_REVIEWS_FOR_HALVING = 50;
export const CRAMMING_FACTOR = 2;
export const OVERTRAINING_FACTOR = 1.5;
export const SPREAD_DAYS = 7;
/** Away days from which the backlog is spread (03 §8 "Back from the Mountain"). */
export const AWAY_SPREAD_MIN = 7;
/** New items paused for this many days after a ≥ 7-day absence. */
export const AWAY_NEW_PAUSE_DAYS = 2;
/** Away days from which the first session is a Welcome Back set. */
export const WELCOME_BACK_AWAY = 30;

export function capTierOf(belt: Belt): CapTier {
  switch (belt) {
    case 'white':
    case 'yellow':
    case 'orange':
      return 0;
    case 'green':
      return 1;
    case 'blue':
    case 'purple':
      return 2;
    case 'brown':
    case 'black':
      return 3;
  }
}

/**
 * Belt-scaled review cap. Named presets use their table; `custom` scales
 * `baseCap` (the learner's White–Orange base) by the Standard tier ratios.
 */
export function capFor(preset: Intensity, belt: Belt, baseCap: number): number {
  const tier = capTierOf(belt);
  if (preset !== 'custom') return REVIEW_CAPS[preset][tier];
  const std = REVIEW_CAPS.standard;
  return Math.max(1, Math.round((Math.max(0, baseCap) * std[tier]) / std[0]));
}

/**
 * Review-count multiplier of a retention target relative to 0.9: the ratio of
 * FSRS intervals I(0.9, S) / I(r, S) = (0.9⁻² − 1) / (r⁻² − 1). 0.85 → 0.61, 0.95 → 2.17.
 */
export function retentionWorkload(retention: number): number {
  const r = Math.min(0.99, Math.max(0.5, retention));
  return (Math.pow(0.9, -2) - 1) / (Math.pow(r, -2) - 1);
}

/** Steady-state reviews/day for a new-item rate at a retention target (design 05 §2 model). */
export function steadyStateReviews(rate: NewRate, retention: number): number {
  const base =
    rate.vocab * REVIEWS_PER_ITEM.vocab +
    rate.kanji * REVIEWS_PER_ITEM.kanji +
    rate.grammar * REVIEWS_PER_ITEM.grammar +
    (rate.kana ?? 0) * REVIEWS_PER_ITEM.kana;
  return base * retentionWorkload(retention);
}

/** The belt's Standard rate scaled to a preset (`custom` → Standard). */
export function presetRate(preset: Intensity, belt: Belt): NewRate {
  const scale = preset === 'custom' ? 1 : PRESET_RATE_SCALE[preset];
  const r = NEW_RATE_BY_BELT[belt];
  const out: NewRate = { vocab: r.vocab * scale, kanji: r.kanji * scale, grammar: r.grammar * scale };
  if (r.kana !== undefined) out.kana = r.kana * scale;
  return out;
}

export interface GovernorInput {
  /** Cards due today (after any welcome-back spreading is applied by this function). */
  due: number;
  /** Today's belt-scaled review cap (`capFor`). */
  cap: number;
  /** 7-day accuracy 0–1 and the number of graded reviews behind it. */
  acc7: number;
  acc7n: number;
  retention: number;
  /** New rate currently halved (state kept by B). */
  halved: boolean;
  /** Consecutive days (incl. today) with acc7 ≥ retention − 0.03. */
  recoveredDays: number;
  newToday: number;
  /** Today's new-item target (sum over kinds, or one kind). */
  target: number;
  minutesToday: number;
  /** `EXPECTED_MAX_MINUTES[preset]`. */
  expectedMaxMinutes: number;
  /** Days away detected at the last day roll (0 when none). */
  awayDays: number;
  /** Days since the return day (0 = the first day back). Default 0. */
  daysBack?: number;
}

export interface GovernorResult {
  /** Backlog mode: new items paused, only `cap` reviews shown. */
  backlog: boolean;
  /** Reviews to show today. */
  showDue: number;
  /** New items still allowed today under the cramming cap (0 when paused). */
  newAllowed: number;
  /** New items still owed under today's adaptive target (0 when paused). */
  newTarget: number;
  rateFactor: 0.5 | 1;
  /** The cramming cap (2 × target) has been reached. */
  crammingCap: boolean;
  /** Overtraining note on the end card. */
  overtraining: boolean;
  /** 7 when a ≥ 7-day absence is being spread, else 0. */
  spreadDays: number;
  /** New items paused (backlog or first two days back). */
  newPaused: boolean;
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

export function governor(o: GovernorInput): GovernorResult {
  const daysBack = Math.max(0, o.daysBack ?? 0);
  const spreading = o.awayDays >= AWAY_SPREAD_MIN;
  const spreadDays = spreading ? SPREAD_DAYS : 0;
  const daysLeft = spreading ? Math.max(1, SPREAD_DAYS - daysBack) : 1;
  const dueToday = spreading ? Math.ceil(o.due / daysLeft) : o.due;

  const backlog = dueToday > BACKLOG_FACTOR * o.cap;
  const showDue = backlog ? o.cap : Math.min(dueToday, o.cap);

  const halveAt = round4(o.retention - ACC_HALVE_DELTA);
  const lowAcc = o.acc7n >= MIN_REVIEWS_FOR_HALVING && round4(o.acc7) < halveAt;
  const heavy = o.due > HALVE_BACKLOG_FACTOR * o.cap;
  let rateFactor: 0.5 | 1;
  if (!o.halved) rateFactor = lowAcc || heavy ? 0.5 : 1;
  else rateFactor = o.recoveredDays >= RESTORE_DAYS && !heavy ? 1 : 0.5;

  const newPaused = backlog || (spreading && daysBack < AWAY_NEW_PAUSE_DAYS);
  const target = Math.max(0, o.target);
  const crammingLimit = Math.round(CRAMMING_FACTOR * target);
  const adaptiveTarget = Math.round(target * rateFactor);
  const crammingCap = target > 0 && o.newToday >= crammingLimit;
  const newTarget = newPaused ? 0 : Math.max(0, adaptiveTarget - o.newToday);
  const newAllowed = newPaused ? 0 : Math.max(0, crammingLimit - o.newToday);

  const overtraining = o.expectedMaxMinutes > 0 && o.minutesToday >= OVERTRAINING_FACTOR * o.expectedMaxMinutes;

  return { backlog, showDue, newAllowed, newTarget, rateFactor, crammingCap, overtraining, spreadDays, newPaused };
}
