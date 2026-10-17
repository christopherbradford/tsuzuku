import type { DrillId } from '../content/types';
import type { AttemptResult } from '../shared/session-types';
import { CardFlag, type CardTuple } from '../shared/store-types';
import {
  ARCADE_EXERCISES,
  SCORE_BANDS,
  SHADOW_BANDS,
  UNGRADED_EXERCISES,
  grade,
  isMature,
  isSlow,
  scoreBandsFor,
  scoreRating,
  toRating,
  type GradeContext,
} from './grading';

const TODAY = 20_000;

function card(o: Partial<{ s: number; reps: number; lapses: number; flags: number; due: number; state: 0 | 1 | 2 | 3 }> = {}): CardTuple {
  return [o.due ?? TODAY, o.s ?? 1, 5, o.reps ?? 0, o.lapses ?? 0, o.state ?? 1, TODAY - 1, o.flags ?? 0];
}
const mature = (reps = 10) => card({ s: 14, reps, state: 2 });
const young = (reps = 10) => card({ s: 13.99, reps, state: 2 });

function res(o: Partial<AttemptResult> = {}): AttemptResult {
  return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1000, errorTags: [], ...o };
}

function ctx(o: Partial<GradeContext> = {}): GradeContext {
  return {
    card: mature(),
    medianMs: 1000,
    medianN: 100,
    today: TODAY,
    exercise: 'meaning-recall',
    keys: 'text',
    boss: false,
    classic: false,
    speedRingShown: true,
    speedGrading: true,
    recheck: false,
    ...o,
  };
}

describe('isMature — the one definition', () => {
  it('is S ≥ 14 on the tested facet', () => {
    expect(isMature(card({ s: 14 }))).toBe(true);
    expect(isMature(card({ s: 13.99 }))).toBe(false);
    expect(isMature(card({ s: 200 }))).toBe(true);
  });
  it('a missing card is never mature', () => {
    expect(isMature(null)).toBe(false);
    expect(isMature(undefined)).toBe(false);
  });
});

describe('isSlow', () => {
  it('needs a median over ≥ 50 samples and > 3× it', () => {
    expect(isSlow(3001, 1000, 50)).toBe(true);
    expect(isSlow(3000, 1000, 50)).toBe(false);
    expect(isSlow(9000, 1000, 49)).toBe(false);
    expect(isSlow(9000, undefined, 500)).toBe(false);
    expect(isSlow(9000, 0, 500)).toBe(false);
  });
});

describe('design 05 §4 grading table', () => {
  it('wrong → Again; timed out in a boss phase → Hard', () => {
    expect(toRating(res({ correct: false }), ctx({ boss: true }))).toBe(1);
    expect(toRating(res({ correct: false, timedOut: true }), ctx({ boss: true }))).toBe(2);
    expect(grade(res({ correct: false, timedOut: true }), ctx({ boss: true })).reason).toBe('timeout');
  });

  it('a late-but-correct boss answer is still graded on correctness', () => {
    expect(toRating(res({ correct: true, timedOut: true, ms: 1500 }), ctx({ boss: true, keys: 'choices' }))).toBe(3);
  });

  it('Guard on a card with ≥ 3 reviews → Again, honest, not a step miss', () => {
    const g = grade(res({ correct: false, guard: true }), ctx({ card: mature(3) }));
    expect(g.rating).toBe(1);
    expect(g.honest).toBe(true);
    expect(g.stepMiss).toBe(false);
    expect(g.reason).toBe('guard');
  });

  it('Guard on a card with < 3 reviews → learning-step miss (Again rating, stepMiss flag, honest)', () => {
    for (const reps of [0, 1, 2]) {
      const g = grade(res({ correct: false, guard: true }), ctx({ card: card({ reps }) }));
      expect(g.rating).toBe(1);
      expect(g.stepMiss).toBe(true);
      expect(g.honest).toBe(true);
      expect(g.reason).toBe('guard-step');
    }
    const fresh = grade(res({ correct: false, guard: true }), ctx({ card: null }));
    expect(fresh.stepMiss).toBe(true);
  });

  it('Guard in a card’s first 2 multiple-choice exposures is a step miss even with ≥ 3 reviews', () => {
    const g = grade(res({ correct: false, guard: true }), ctx({ card: mature(5), keys: 'choices', exposures: 1 }));
    expect(g.stepMiss).toBe(true);
    const later = grade(res({ correct: false, guard: true }), ctx({ card: mature(5), keys: 'choices', exposures: 2 }));
    expect(later.stepMiss).toBe(false);
    const typed = grade(res({ correct: false, guard: true }), ctx({ card: mature(5), keys: 'text', exposures: 1 }));
    expect(typed.stepMiss).toBe(false);
  });

  it('near-miss (Block) → Hard', () => {
    expect(toRating(res({ correct: false, nearMiss: true }), ctx())).toBe(2);
    expect(toRating(res({ correct: true, nearMiss: true }), ctx())).toBe(2);
  });

  it('correct with a hint → Hard ceiling', () => {
    expect(toRating(res({ hintUsed: true }), ctx())).toBe(2);
    expect(grade(res({ hintUsed: true }), ctx()).reason).toBe('hint');
  });

  it('second dictation replay → Hard ceiling (only for sentence-listen)', () => {
    expect(toRating(res({ replays: 2 }), ctx({ exercise: 'sentence-listen', keys: 'kana' }))).toBe(2);
    expect(toRating(res({ replays: 1 }), ctx({ exercise: 'sentence-listen', keys: 'kana' }))).toBe(3);
    expect(toRating(res({ replays: 2 }), ctx({ exercise: 'audio-flash', keys: 'choices' }))).toBe(3);
  });

  it('slow mature answer → Hard only with ring shown, speedGrading on, keys choices/kana, n ≥ 50', () => {
    const slow = res({ ms: 3001 });
    expect(toRating(slow, ctx({ keys: 'choices' }))).toBe(2);
    expect(toRating(slow, ctx({ keys: 'kana' }))).toBe(2);
    expect(grade(slow, ctx({ keys: 'kana' })).slow).toBe(true);
    // never for free English typing
    expect(toRating(slow, ctx({ keys: 'text' }))).toBe(3);
    expect(toRating(slow, ctx({ keys: 'none' }))).toBe(3);
    // never in Zen (ring hidden) or with the toggle off
    expect(toRating(slow, ctx({ keys: 'choices', speedRingShown: false }))).toBe(3);
    expect(toRating(slow, ctx({ keys: 'choices', speedGrading: false }))).toBe(3);
    // never on a young card, never under 50 samples, never without a median
    expect(toRating(slow, ctx({ keys: 'choices', card: young() }))).toBe(3);
    expect(toRating(slow, ctx({ keys: 'choices', medianN: 49 }))).toBe(3);
    expect(toRating(slow, ctx({ keys: 'choices', medianMs: undefined }))).toBe(3);
    // exactly 3× is not slow
    expect(toRating(res({ ms: 3000 }), ctx({ keys: 'choices' }))).toBe(3);
  });

  it('correct → Good; Easy is never auto-assigned', () => {
    expect(toRating(res({ ms: 1 }), ctx({ keys: 'choices' }))).toBe(3);
    expect(toRating(res({ ms: 1 }), ctx({ keys: 'kana', card: mature(200) }))).toBe(3);
  });

  it('self-graded: learner’s Again/Hard/Good pass through; Easy is clamped outside classic', () => {
    for (const sr of [1, 2, 3] as const) expect(toRating(res({ selfRating: sr }), ctx({ exercise: 'meaning-judge', keys: 'none' }))).toBe(sr);
    expect(toRating(res({ selfRating: 4 as unknown as 3 }), ctx({ exercise: 'meaning-judge', keys: 'none' }))).toBe(3);
  });

  it('classic mode passes the self rating through, including Easy', () => {
    expect(toRating(res({ selfRating: 2 }), ctx({ classic: true }))).toBe(2);
    expect(toRating(res({ selfRating: 4 as unknown as 3 }), ctx({ classic: true }))).toBe(4);
    expect(grade(res({ selfRating: 3 }), ctx({ classic: true })).reason).toBe('classic');
  });

  it('a failed Judge check forces Again on a self-rated Good', () => {
    expect(toRating(res({ selfRating: 3 }), ctx({ exercise: 'meaning-judge', keys: 'none', judge: 'fail' }))).toBe(1);
    expect(toRating(res({ selfRating: 3 }), ctx({ exercise: 'meaning-judge', keys: 'none', judge: 'pass' }))).toBe(3);
  });

  it('Rapid Fire / Gojūon: correct → null (Good on a Kaiden card); miss → recheck flag, no rating', () => {
    for (const exercise of ARCADE_EXERCISES) {
      const ok = grade(res(), ctx({ exercise, keys: 'kana' }));
      expect(ok.rating).toBeNull();
      expect(ok.recheck).toBe(false);
      const kaiden = grade(res(), ctx({ exercise, keys: 'kana', card: card({ s: 150, reps: 20, flags: CardFlag.kaiden }) }));
      expect(kaiden.rating).toBe(3);
      const miss = grade(res({ correct: false }), ctx({ exercise, keys: 'kana' }));
      expect(miss.rating).toBeNull();
      expect(miss.recheck).toBe(true);
    }
  });

  it('the untimed recheck step: miss → Again, correct → Good', () => {
    expect(toRating(res({ correct: false }), ctx({ exercise: 'kana-flash', keys: 'kana', recheck: true }))).toBe(1);
    expect(toRating(res(), ctx({ exercise: 'kana-flash', keys: 'kana', recheck: true, speedGrading: false }))).toBe(3);
    // even if the runner reuses the arcade drill id for the recheck
    expect(toRating(res({ correct: false }), ctx({ exercise: 'rapid-fire', keys: 'kana', recheck: true }))).toBe(1);
  });

  it('story gloss tap: Hard on rec only when due today and not the first read', () => {
    const tap = res({ correct: false });
    const base = { exercise: 'story-read' as DrillId, keys: 'none' as const };
    expect(toRating(tap, ctx({ ...base, card: card({ due: TODAY, reps: 5 }), firstRead: false }))).toBe(2);
    expect(toRating(tap, ctx({ ...base, card: card({ due: TODAY - 3, reps: 5 }), firstRead: false }))).toBe(2);
    expect(toRating(tap, ctx({ ...base, card: card({ due: TODAY + 1, reps: 5 }), firstRead: false }))).toBeNull();
    expect(toRating(tap, ctx({ ...base, card: card({ due: TODAY, reps: 5 }), firstRead: true }))).toBeNull();
    expect(toRating(tap, ctx({ ...base, card: null }))).toBeNull();
    expect(toRating(res(), ctx(base))).toBeNull();
  });

  it('dictation score bands: 0.95 / 0.80 boundaries', () => {
    const c = ctx({ exercise: 'sentence-listen', keys: 'kana' });
    expect(SCORE_BANDS).toEqual({ good: 0.95, hard: 0.8 });
    expect(toRating(res({ score: 0.95 }), c)).toBe(3);
    expect(toRating(res({ score: 0.949 }), c)).toBe(2);
    expect(toRating(res({ score: 0.8 }), c)).toBe(2);
    expect(toRating(res({ score: 0.799 }), c)).toBe(1);
    expect(toRating(res({ score: 1, replays: 2 }), c)).toBe(2);
    expect(toRating(res({ score: 1, hintUsed: true }), c)).toBe(2);
  });

  it('shadow score bands: 0.80 / 0.60', () => {
    const c = ctx({ exercise: 'shadow', keys: 'none' });
    expect(scoreBandsFor('shadow')).toBe(SHADOW_BANDS);
    expect(scoreBandsFor('meaning-recall')).toBeNull();
    expect(toRating(res({ score: 0.8 }), c)).toBe(3);
    expect(toRating(res({ score: 0.79 }), c)).toBe(2);
    expect(toRating(res({ score: 0.6 }), c)).toBe(2);
    expect(toRating(res({ score: 0.59 }), c)).toBe(1);
    expect(scoreRating(0.9)).toBe(2);
    expect(scoreRating(0.9, SHADOW_BANDS)).toBe(3);
  });

  it('ungraded drills never rate', () => {
    for (const exercise of UNGRADED_EXERCISES) {
      expect(toRating(res(), ctx({ exercise, keys: 'none' }))).toBeNull();
      expect(toRating(res({ correct: false }), ctx({ exercise, keys: 'none' }))).toBeNull();
    }
  });

  it('pretest (Chikaradameshi): a miss has no FSRS penalty, a hit is Good', () => {
    expect(toRating(res({ correct: false }), ctx({ card: null, pretest: true }))).toBeNull();
    expect(toRating(res(), ctx({ card: null, pretest: true }))).toBe(3);
  });

  it('a new card (null) grades like a fresh card', () => {
    expect(toRating(res(), ctx({ card: null }))).toBe(3);
    expect(toRating(res({ correct: false }), ctx({ card: null }))).toBe(1);
    expect(toRating(res({ ms: 99_999 }), ctx({ card: null, keys: 'choices' }))).toBe(3);
  });
});
