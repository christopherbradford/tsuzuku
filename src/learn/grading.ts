/**
 * TSUZUKU — grading map (design 05 §4; ARCHITECTURE §8 "mature").
 *
 * Pure: `AttemptResult` + context → FSRS `Rating | null`. `isMature` is THE
 * one definition of maturity (tested facet S ≥ 14 d) used by timers, speed
 * rings, Flash/Strike sampling, Kage and Rapid Fire.
 *
 * `toRating` is the contract entry point; `grade` returns the same rating
 * plus the side facts the writer (`learn/apply.ts`) and the kiai reducer
 * need (learning-step miss, recheck flag, honest guard, slow).
 */
import type { DrillId } from '../content/types';
import type { ExerciseMeta } from '../shared/exercise-types';
import type { AttemptResult } from '../shared/session-types';
import { CardFlag, hasFlag, type CardTuple, type EpochDay, type Rating } from '../shared/store-types';

/** Tested facet S ≥ 14 d (design 05 §2, ARCHITECTURE §8). */
export const MATURE_S = 14;
/** "Slow" = latency > 3 × the personal median for the exercise type … */
export const SLOW_FACTOR = 3;
/** … and only once the median rests on ≥ 50 samples. */
export const SLOW_MIN_N = 50;

/** Dictation bands (sentence-listen): ≥ 0.95 Good, ≥ 0.80 Hard, else Again. */
export const SCORE_BANDS: { good: number; hard: number } = { good: 0.95, hard: 0.8 };
/** Shadow bands: ≥ 0.80 Good, 0.60–0.79 Hard ("Blocked"), else Again. */
export const SHADOW_BANDS: { good: number; hard: number } = { good: 0.8, hard: 0.6 };

/** Arcade modes: correct writes nothing (Good on a Kaiden card), a miss only sets `recheck`. */
export const ARCADE_EXERCISES: readonly DrillId[] = ['rapid-fire', 'gojuon-fighter'];
/** Never produce a card rating of their own (XP / stats / implicit grades only). */
export const UNGRADED_EXERCISES: readonly DrillId[] = [
  'listening-set',
  'minimal-pair',
  'monologue',
  'speed-read',
  'writing-dojo',
  'field-mission',
  'say-three-ways',
];
/** Exercises whose rating comes from `score` bands. */
export const SCORED_EXERCISES: readonly DrillId[] = ['sentence-listen', 'shadow'];
/** Exercises where a second replay caps the rating at Hard. */
export const REPLAY_CEILING_EXERCISES: readonly DrillId[] = ['sentence-listen'];

const ARCADE: ReadonlySet<string> = new Set(ARCADE_EXERCISES);
const UNGRADED: ReadonlySet<string> = new Set(UNGRADED_EXERCISES);
const REPLAY_CEIL: ReadonlySet<string> = new Set(REPLAY_CEILING_EXERCISES);

export interface GradeContext {
  /** The tested card, or `null` before its first grade. */
  card: CardTuple | null;
  /** Rolling personal median latency for this drill, ms. */
  medianMs: number | undefined;
  /** Samples behind `medianMs`. */
  medianN: number;
  today: EpochDay;
  exercise: DrillId;
  keys: ExerciseMeta['keys'];
  /** Inside a Gatekeeper Flash/Strike phase (timeouts graded Hard). */
  boss: boolean;
  /** Classic four-button mode: `selfRating` passes straight through. */
  classic: boolean;
  /** Speed ring visible (Dojo/Arcade feel). */
  speedRingShown: boolean;
  /** `settings.speedGrading`. */
  speedGrading: boolean;
  /** This step is the untimed re-test of an arcade miss. */
  recheck: boolean;
  /** story-read: the episode's first read (gloss taps are free). */
  firstRead?: boolean;
  /** Additive: `Step.exposures` (Guard in a card's first 2 MC exposures is a step miss). */
  exposures?: number;
  /** Additive: outcome of a Judge check on a self-rated Good (`fail` forces Again). */
  judge?: 'pass' | 'fail';
  /** Additive: Chikaradameshi pretest — a miss carries no FSRS penalty. */
  pretest?: boolean;
}

export type GradeReason =
  | 'ungraded'
  | 'arcade-correct'
  | 'arcade-kaiden'
  | 'arcade-miss'
  | 'pretest-miss'
  | 'gloss-tap'
  | 'gloss-free'
  | 'judge-fail'
  | 'classic'
  | 'self'
  | 'guard-step'
  | 'guard'
  | 'timeout'
  | 'score'
  | 'near-miss'
  | 'wrong'
  | 'hint'
  | 'replay'
  | 'slow'
  | 'good';

export interface GradeOutcome {
  rating: Rating | null;
  reason: GradeReason;
  /** Learning-step miss: re-queue at +3, no lapse (Guard on a card with < 3 reviews). */
  stepMiss: boolean;
  /** Arcade miss: set the card's `recheck` flag instead of rating it. */
  recheck: boolean;
  /** Honest Guard (either branch). */
  honest: boolean;
  /** Correct but slower than 3 × median on a mature card with speed grading on. */
  slow: boolean;
}

/** THE maturity definition: the tested facet's stability is ≥ 14 days. */
export function isMature(card: CardTuple | null | undefined): boolean {
  return !!card && card[1] >= MATURE_S;
}

/** `ms > 3 × median` once the median rests on ≥ 50 samples; never slow without a median. */
export function isSlow(ms: number, median: number | undefined, n: number): boolean {
  if (median === undefined || !(median > 0) || n < SLOW_MIN_N) return false;
  return ms > SLOW_FACTOR * median;
}

/** Bands for a score-graded drill, or `null` when the drill is not score-based. */
export function scoreBandsFor(exercise: DrillId): { good: number; hard: number } | null {
  if (exercise === 'sentence-listen') return SCORE_BANDS;
  if (exercise === 'shadow') return SHADOW_BANDS;
  return null;
}

/** Maps a 0..1 score onto Again/Hard/Good with the given bands. */
export function scoreRating(score: number, bands: { good: number; hard: number } = SCORE_BANDS): Rating {
  if (score >= bands.good) return 3;
  if (score >= bands.hard) return 2;
  return 1;
}

function reviewsOf(card: CardTuple | null): number {
  return card ? card[3] : 0;
}

function clampRating(n: number, allowEasy: boolean): Rating {
  const r = Math.round(n);
  if (r <= 1) return 1;
  if (r === 2) return 2;
  if (r === 3 || !allowEasy) return 3;
  return 4;
}

function out(rating: Rating | null, reason: GradeReason, extra: Partial<Omit<GradeOutcome, 'rating' | 'reason'>> = {}): GradeOutcome {
  return { rating, reason, stepMiss: false, recheck: false, honest: false, slow: false, ...extra };
}

/**
 * Full grading outcome. Precedence (first match wins):
 *  1. ungraded drills → null
 *  2. arcade (unless `recheck`): correct → null / Good on Kaiden; miss → recheck
 *  3. story-read gloss tap: Hard only when due today and not the first read
 *  4. pretest miss → null
 *  5. Judge fail → Again
 *  6. self-rating (classic passes Easy through; otherwise clamped to Again..Good)
 *  7. Guard: ≥ 3 reviews → Again; else learning-step miss (Again, no lapse)
 *  8. timeout (boss or not) → Hard
 *  9. score bands (sentence-listen, shadow), then hint / second-replay ceiling
 * 10. near-miss → Hard; wrong → Again
 * 11. correct: hint → Hard; second replay (dictation) → Hard; slow mature → Hard; else Good
 */
export function grade(r: AttemptResult, ctx: GradeContext): GradeOutcome {
  const ex = ctx.exercise;
  const card = ctx.card;

  if (UNGRADED.has(ex)) return out(null, 'ungraded');

  if (ARCADE.has(ex) && !ctx.recheck) {
    if (r.correct) {
      if (card && hasFlag(card[7], CardFlag.kaiden)) return out(3, 'arcade-kaiden');
      return out(null, 'arcade-correct');
    }
    return out(null, 'arcade-miss', { recheck: true });
  }

  if (ex === 'story-read') {
    // A gloss tap is reported as a non-correct attempt on the word's rec card.
    if (r.correct) return out(null, 'ungraded');
    if (card && card[0] <= ctx.today && !ctx.firstRead) return out(2, 'gloss-tap');
    return out(null, 'gloss-free');
  }

  if (ctx.pretest && !r.correct && !r.nearMiss) return out(null, 'pretest-miss');

  if (ctx.judge === 'fail') return out(1, 'judge-fail');

  if (r.selfRating !== undefined && !r.guard) {
    if (ctx.classic) return out(clampRating(r.selfRating, true), 'classic');
    return out(clampRating(r.selfRating, false), 'self');
  }

  if (r.guard) {
    const firstMc = ctx.keys === 'choices' && (ctx.exposures ?? Number.POSITIVE_INFINITY) < 2;
    if (reviewsOf(card) < 3 || firstMc) return out(1, 'guard-step', { stepMiss: true, honest: true });
    return out(1, 'guard', { honest: true });
  }

  if (r.timedOut && !r.correct) return out(2, 'timeout');

  const bands = scoreBandsFor(ex);
  if (bands && r.score !== undefined) {
    let rating = scoreRating(r.score, bands);
    let reason: GradeReason = 'score';
    if (rating === 3 && r.hintUsed) {
      rating = 2;
      reason = 'hint';
    }
    if (rating === 3 && REPLAY_CEIL.has(ex) && (r.replays ?? 0) >= 2) {
      rating = 2;
      reason = 'replay';
    }
    return out(rating, reason);
  }

  if (r.nearMiss) return out(2, 'near-miss');
  if (!r.correct) return out(1, 'wrong');

  if (r.hintUsed) return out(2, 'hint');
  if (REPLAY_CEIL.has(ex) && (r.replays ?? 0) >= 2) return out(2, 'replay');

  const speedCounts = ctx.speedRingShown && ctx.speedGrading && (ctx.keys === 'choices' || ctx.keys === 'kana');
  if (speedCounts && isMature(card) && isSlow(r.ms, ctx.medianMs, ctx.medianN)) return out(2, 'slow', { slow: true });

  return out(3, 'good');
}

/** Contract entry point: `grade(r, ctx).rating`. */
export function toRating(r: AttemptResult, ctx: GradeContext): Rating | null {
  return grade(r, ctx).rating;
}
