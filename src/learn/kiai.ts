/**
 * TSUZUKU — Kiai (気合): ki, combo, Ippon as a pure reducer (design 05 §5).
 *
 *  Ki 0–100, no time decay: correct +8 · mature & fast +12 · Ippon +20 ·
 *  wrong −10 · Guard −4 (0 on a training dummy) · hint −6 · Block −4.
 *  At 100: Kiai state for exactly 10 reps (XP × 1.5), then ki resets to 30.
 *  Combo: consecutive corrects; training dummy (< 3 reviews) misses never
 *  break it; Guard halves it (unchanged on a dummy); Block holds it;
 *  a clean miss on a non-dummy card resets it and queues a Recovery 3–8 reps
 *  later which restores half of the lost combo. Speed never touches the combo.
 */
import type { CardKey } from '../content/types';
import type { KiaiState } from '../shared/session-types';
import { range, type Rng } from '../shared/hash';

export const KIAI_RULES = {
  ki: { correct: 8, fast: 12, ippon: 20, wrong: -10, guard: -4, hint: -6, block: -4 },
  kiMax: 100,
  kiMin: 0,
  /** Reps spent in Kiai state once ki hits 100. */
  kiaiReps: 10,
  /** Ki after Kiai state ends. */
  kiReset: 30,
  /** Cards with fewer reviews than this are training dummies. */
  dummyReviews: 3,
  /** Guard in a card's first N multiple-choice exposures is also free. */
  freeGuardExposures: 2,
  milestones: [10, 25, 50, 100] as const,
  /** A Recovery re-test returns 3–8 reps after the miss. */
  recovery: { min: 3, max: 8 },
  /** XP side effects decided by B; listed here as the public criteria. */
  xp: { ippon: 3, recovery: 2, kiaiMultiplier: 1.5 },
} as const;

export type Milestone = (typeof KIAI_RULES.milestones)[number];

/** Per-rep input to the reducer; derived by the runner from the grade and the card. */
export interface KiaiRep {
  correct: boolean;
  nearMiss: boolean;
  guard: boolean;
  hintUsed: boolean;
  /** `isMature(card)` — the tested facet S ≥ 14 d. */
  mature: boolean;
  /** Faster than 0.8 × the personal median for the drill. */
  fast: boolean;
  /** D ≥ 7 or lapsed within 30 d (Ippon criterion). */
  difficultOrLapsed: boolean;
  /** `card[3]` — reviews so far (0 for a new card). */
  cardReviews: number;
  /** This rep is a Recovery re-test. */
  isRecovery: boolean;
  /** Additive: the card, so a clean miss can be queued for Recovery. */
  cardKey?: CardKey | null;
  /** Additive: index of this rep in the session (the queue's `at` is relative to it). */
  repIndex?: number;
  /** Additive: multiple-choice drill in the card's first 2 exposures (free Guard). */
  mcFirstExposures?: boolean;
  /** Additive: seeded rng for the Recovery offset; without it the offset is the midpoint (5). */
  rng?: Rng;
}

export interface KiaiStepResult {
  state: KiaiState;
  ippon: boolean;
  /** This rep was spent inside Kiai state (XP × 1.5). */
  kiaiActive: boolean;
  /** Ki reached 100 on this rep (emit `kiai:entered`). */
  kiaiEntered: boolean;
  milestone: Milestone | null;
  /** A Recovery succeeded and half the lost combo came back. */
  restoredHalf: boolean;
  /** Ki change applied this rep (0 while pinned at 100 inside Kiai). */
  kiDelta: number;
  /** The combo was reset (clean miss on a non-dummy card). */
  comboBroken: boolean;
}

/** `KiaiState` plus the private memory the reducer keeps between a miss and its Recovery. */
export interface KiaiMemory extends KiaiState {
  /** Combo lost on the most recent reset, by card (or `*` when no key was given). */
  lostCombo?: Record<string, number>;
}

export function kiaiInit(): KiaiState {
  return { ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] };
}

function clampKi(ki: number): number {
  return Math.max(KIAI_RULES.kiMin, Math.min(KIAI_RULES.kiMax, ki));
}

/** Highest milestone crossed going from `prev` to `next`, or `null`. */
export function milestoneCrossed(prev: number, next: number): Milestone | null {
  let hit: Milestone | null = null;
  for (const m of KIAI_RULES.milestones) if (prev < m && next >= m) hit = m;
  return hit;
}

/** Combo tier for the HUD: 0 (< 10) · 1 (10–24) · 2 (25–49) · 3 (≥ 50). */
export function comboTier(combo: number): 0 | 1 | 2 | 3 {
  if (combo >= 50) return 3;
  if (combo >= 25) return 2;
  if (combo >= 10) return 1;
  return 0;
}

/** True when `r` is a training-dummy rep (< 3 reviews, or an MC drill in the first 2 exposures). */
export function isDummy(r: Pick<KiaiRep, 'cardReviews' | 'mcFirstExposures'>): boolean {
  return r.cardReviews < KIAI_RULES.dummyReviews || r.mcFirstExposures === true;
}

/** Public Ippon criteria: correct, mature, fast, and difficult-or-lapsed; never with a hint. */
export function isIppon(r: Pick<KiaiRep, 'correct' | 'mature' | 'fast' | 'difficultOrLapsed' | 'hintUsed' | 'nearMiss'>): boolean {
  return r.correct && !r.nearMiss && !r.hintUsed && r.mature && r.fast && r.difficultOrLapsed;
}

/** One rep through the reducer. Never mutates `s`. */
export function kiaiStep(s: KiaiState, r: KiaiRep): KiaiStepResult {
  const mem = s as KiaiMemory;
  const inKiai = s.kiaiLeft > 0;
  const dummy = isDummy(r);
  const key = r.cardKey ?? '*';
  const lost: Record<string, number> = { ...(mem.lostCombo ?? {}) };
  let queue = s.recoveryQueue.slice();

  // 1. Ki delta (speed affects ki, never the combo).
  let kiDelta = 0;
  let ippon = false;
  if (r.guard) {
    kiDelta = dummy ? 0 : KIAI_RULES.ki.guard;
  } else if (r.correct && !r.nearMiss) {
    ippon = isIppon(r);
    if (ippon) kiDelta = KIAI_RULES.ki.ippon;
    else if (r.mature && r.fast && !r.hintUsed) kiDelta = KIAI_RULES.ki.fast;
    else kiDelta = KIAI_RULES.ki.correct;
    if (r.hintUsed) kiDelta += KIAI_RULES.ki.hint;
  } else if (r.nearMiss) {
    kiDelta = KIAI_RULES.ki.block + (r.hintUsed ? KIAI_RULES.ki.hint : 0);
  } else {
    kiDelta = KIAI_RULES.ki.wrong + (r.hintUsed ? KIAI_RULES.ki.hint : 0);
  }

  // 2. Combo.
  const prevCombo = s.combo;
  let combo = s.combo;
  let comboBroken = false;
  let restoredHalf = false;
  if (r.guard) {
    if (!dummy) combo = Math.floor(combo / 2);
  } else if (r.correct && !r.nearMiss) {
    combo += 1;
    if (r.isRecovery) {
      const half = Math.floor((lost[key] ?? lost['*'] ?? 0) / 2);
      if (half > 0) {
        combo += half;
        restoredHalf = true;
      }
      delete lost[key];
      if (key !== '*') queue = queue.filter((q) => q.cardKey !== key);
    }
  } else if (r.nearMiss) {
    // Block: combo holds.
  } else if (!dummy) {
    comboBroken = true;
    if (prevCombo > 0) lost[key] = prevCombo;
    combo = 0;
    if (r.cardKey) {
      const offset = r.rng ? range(r.rng, KIAI_RULES.recovery.min, KIAI_RULES.recovery.max) : 5;
      const at = (r.repIndex ?? 0) + offset;
      queue = queue.filter((q) => q.cardKey !== r.cardKey).concat([{ cardKey: r.cardKey, at }]);
    }
  }
  // A failed Recovery rep forgets the lost combo (only one shot at half).
  if (r.isRecovery && !(r.correct && !r.nearMiss)) {
    delete lost[key];
    if (key !== '*') queue = queue.filter((q) => q.cardKey !== key);
  }

  // 3. Ki / Kiai state.
  let ki = s.ki;
  let kiaiLeft = s.kiaiLeft;
  let kiaiEntered = false;
  let appliedDelta = kiDelta;
  if (inKiai) {
    appliedDelta = 0; // pinned at 100 while Kiai lasts
    kiaiLeft -= 1;
    if (kiaiLeft === 0) ki = KIAI_RULES.kiReset;
  } else {
    ki = clampKi(ki + kiDelta);
    if (ki >= KIAI_RULES.kiMax) {
      ki = KIAI_RULES.kiMax;
      kiaiLeft = KIAI_RULES.kiaiReps;
      kiaiEntered = true;
    }
  }

  const state: KiaiMemory = {
    ki,
    combo,
    bestCombo: Math.max(s.bestCombo, combo),
    kiaiLeft,
    ippon: s.ippon + (ippon ? 1 : 0),
    recoveryQueue: queue,
  };
  if (Object.keys(lost).length > 0) state.lostCombo = lost;

  return {
    state,
    ippon,
    kiaiActive: inKiai,
    kiaiEntered,
    milestone: milestoneCrossed(prevCombo, combo),
    restoredHalf,
    kiDelta: appliedDelta,
    comboBroken,
  };
}

/** Recovery entries whose `at` ≤ `repIndex` (ready to be served). */
export function dueRecoveries(s: KiaiState, repIndex: number): CardKey[] {
  return s.recoveryQueue.filter((q) => q.at <= repIndex).map((q) => q.cardKey);
}
