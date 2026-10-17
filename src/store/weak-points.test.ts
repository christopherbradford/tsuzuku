import { ERROR_TAGS, type ErrorTag } from '../content/types';
import { bus, type Events } from '../shared/events';
import type { WeakPoints } from '../shared/store-types';
import { freshWeakPoints } from './defaults';
import { resetStoreForTests, store } from './store';
import { captureEvents, makeTestStore } from './testing';
import {
  EWMA_ALPHA,
  TAG_EXERCISES,
  WEAK_ACTIVATE,
  WEAK_CLEAR,
  WEAK_MIN_N,
  activeTags,
  conqueredTags,
  startWeakPoints,
  stepWeakPoint,
  tagsForExercise,
  topWeakPoints,
  updateWeakPoints,
} from './weak-points';

function attempt(exercise: Events['attempt:graded']['exercise'], correct: boolean, errorTags: ErrorTag[] = [], guard = false): Pick<Events['attempt:graded'], 'exercise' | 'correct' | 'guard' | 'errorTags'> {
  return { exercise, correct, guard, errorTags };
}

function graded(o: Partial<Events['attempt:graded']>): Events['attempt:graded'] {
  return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1000, errorTags: [], sessionId: 's', exercise: 'particle-duel', itemId: 'g-n5-002', kind: 'grammar', facet: 'cloze', cardKey: 'g-n5-002#cloze', rating: 3, mature: false, ippon: false, kiai: false, combo: 1, recovery: false, firstProd: false, ...o };
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('TAG_EXERCISES', () => {
  it('covers every tag with real drill ids and never arcade modes', () => {
    for (const tag of ERROR_TAGS) {
      expect(TAG_EXERCISES[tag].length).toBeGreaterThan(0);
      expect(TAG_EXERCISES[tag]).not.toContain('rapid-fire');
      expect(TAG_EXERCISES[tag]).not.toContain('gojuon-fighter');
    }
    expect(tagsForExercise('particle-duel')).toContain('particle');
    expect(tagsForExercise('rapid-fire')).toEqual([]);
    expect(tagsForExercise('role-play')).toContain('aizuchi');
  });
});

describe('EWMA math', () => {
  it('moves by α toward 1 on a hit and toward 0 on a clean attempt', () => {
    const w0 = { n: 0, ewma: 0, active: false, peak: 0 };
    const w1 = stepWeakPoint(w0, true);
    expect(w1).toEqual({ n: 1, ewma: EWMA_ALPHA, active: false, peak: 0 });
    const w2 = stepWeakPoint(w1, false);
    expect(w2.ewma).toBeCloseTo(EWMA_ALPHA * (1 - EWMA_ALPHA), 6);
    expect(w2.n).toBe(2);
  });

  it('activates at 20 % only once n ≥ 15; three early misses never fire', () => {
    let w = { n: 0, ewma: 0, active: false, peak: 0 };
    for (let i = 0; i < 3; i++) w = stepWeakPoint(w, true);
    expect(w.ewma).toBeGreaterThan(WEAK_ACTIVATE);
    expect(w.active).toBe(false);
    // Alternate so the rate stays high while n climbs past 15.
    for (let i = 0; i < 12; i++) w = stepWeakPoint(w, i % 2 === 0);
    expect(w.n).toBe(15);
    expect(w.ewma).toBeGreaterThan(WEAK_ACTIVATE);
    expect(w.active).toBe(true);
    expect(w.peak).toBeGreaterThan(WEAK_ACTIVATE);
  });

  it('clears below 8 % with hysteresis (stays active between 8 % and 20 %)', () => {
    let w = { n: 20, ewma: 0.5, active: true, peak: 0.5 };
    while (w.ewma >= WEAK_CLEAR) {
      w = stepWeakPoint(w, false);
      if (w.ewma >= WEAK_CLEAR) expect(w.active).toBe(true);
    }
    expect(w.active).toBe(false);
    expect(w.peak).toBe(0.5);
    // Between 8 % and 20 % an inactive tag stays inactive; above 20 % with n ≥ 15 it fires again.
    const mid = stepWeakPoint({ n: 20, ewma: 0.15, active: false, peak: 0.5 }, false);
    expect(mid.ewma).toBeCloseTo(0.12, 6);
    expect(mid.active).toBe(false);
    const hit = stepWeakPoint({ n: 20, ewma: 0.15, active: false, peak: 0.5 }, true);
    expect(hit.ewma).toBeCloseTo(0.32, 6);
    expect(hit.active).toBe(true);
  });
});

describe('updateWeakPoints', () => {
  it('tagged attempts raise their tags; untagged correct attempts lower only applicable tags', () => {
    const w0 = freshWeakPoints();
    const w1 = updateWeakPoints(w0, attempt('particle-duel', false, ['particle']));
    expect(w1.particle.ewma).toBeCloseTo(0.2, 6);
    expect(w1.particle.n).toBe(1);
    expect(w1.conjugation.n).toBe(0);
    const w2 = updateWeakPoints(w1, attempt('particle-duel', true));
    expect(w2.particle.ewma).toBeCloseTo(0.16, 6);
    expect(w2.particle.n).toBe(2);
    // meaning-recall cannot raise `particle`: a correct answer there says nothing about it.
    const w3 = updateWeakPoints(w2, attempt('meaning-recall', true));
    expect(w3.particle).toEqual(w2.particle);
    expect(w3['word-choice'].n).toBe(1);
  });

  it('untagged misses, Guards and arcade reps change nothing', () => {
    const w0 = freshWeakPoints();
    expect(updateWeakPoints(w0, attempt('particle-duel', false))).toBe(w0);
    expect(updateWeakPoints(w0, attempt('particle-duel', true, [], true))).toBe(w0);
    expect(updateWeakPoints(w0, attempt('rapid-fire', true))).toBe(w0);
    expect(updateWeakPoints(w0, attempt('meaning-recall', false, ['particle'])).particle.n).toBe(1);
  });

  it('a tag the save lacks (older save) starts fresh', () => {
    const partial = {} as WeakPoints;
    const w = updateWeakPoints(partial, attempt('pitch-ear', false, ['pitch']));
    expect(w.pitch).toEqual({ n: 1, ewma: 0.2, active: false, peak: 0 });
  });
});

describe('top-N and conquered', () => {
  it('activeTags and topWeakPoints order by severity', () => {
    const w = freshWeakPoints();
    w.particle = { n: 30, ewma: 0.3, active: true, peak: 0.4 };
    w.voicing = { n: 30, ewma: 0.45, active: true, peak: 0.45 };
    w.pitch = { n: 30, ewma: 0.15, active: false, peak: 0.25 };
    w.register = { n: 3, ewma: 0.6, active: false, peak: 0 };
    expect(activeTags(w)).toEqual(['voicing', 'particle']);
    expect(topWeakPoints(w, 1).map((r) => r.tag)).toEqual(['voicing']);
    expect(topWeakPoints(w, 5).map((r) => r.tag)).toEqual(['voicing', 'particle']);
    expect(topWeakPoints(w, 5, { includeInactive: true }).map((r) => r.tag)).toEqual(['voicing', 'particle', 'pitch']);
  });

  it('conqueredTags = peaked above 20 % and now under 5 %', () => {
    const w = freshWeakPoints();
    w.particle = { n: 60, ewma: 0.04, active: false, peak: 0.35 };
    w.voicing = { n: 60, ewma: 0.04, active: false, peak: 0.1 };
    w.pitch = { n: 60, ewma: 0.06, active: false, peak: 0.3 };
    expect(conqueredTags(w)).toEqual(['particle']);
  });
});

describe('startWeakPoints reducer', () => {
  it('patches the slice and emits weak-point:cleared on the active → inactive transition only', async () => {
    const w = freshWeakPoints();
    w.particle = { n: 40, ewma: 0.09, active: true, peak: 0.3 };
    await makeTestStore({ save: { weakPoints: w } });
    const stop = startWeakPoints(store);
    const cap = captureEvents();
    bus.emit('attempt:graded', graded({ correct: true }));
    expect(store.weakPoints.value.particle.ewma).toBeCloseTo(0.072, 6);
    expect(store.weakPoints.value.particle.active).toBe(false);
    bus.emit('attempt:graded', graded({ correct: true }));
    bus.emit('attempt:graded', graded({ exercise: 'rapid-fire', rating: null }));
    cap.stop();
    expect(cap.events.filter(([n]) => n === 'weak-point:cleared')).toEqual([['weak-point:cleared', { tag: 'particle' }]]);
    expect(store.weakPoints.value.particle.n).toBe(42);
    stop();
    bus.emit('attempt:graded', graded({ correct: true }));
    expect(store.weakPoints.value.particle.n).toBe(42);
    expect(WEAK_MIN_N).toBe(15);
  });
});
