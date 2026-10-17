import { mulberry32 } from '../shared/hash';
import type { KiaiState } from '../shared/session-types';
import { KIAI_RULES, comboTier, dueRecoveries, isIppon, kiaiInit, kiaiStep, milestoneCrossed, type KiaiRep } from './kiai';

function rep(o: Partial<KiaiRep> = {}): KiaiRep {
  return {
    correct: true,
    nearMiss: false,
    guard: false,
    hintUsed: false,
    mature: true,
    fast: false,
    difficultOrLapsed: false,
    cardReviews: 10,
    isRecovery: false,
    ...o,
  };
}

function run(s: KiaiState, reps: KiaiRep[]): KiaiState {
  let cur = s;
  for (const r of reps) cur = kiaiStep(cur, r).state;
  return cur;
}

describe('kiaiInit', () => {
  it('starts cold', () => {
    expect(kiaiInit()).toEqual({ ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] });
  });
});

describe('ki deltas (design 05 §5)', () => {
  it('correct +8', () => {
    const r = kiaiStep(kiaiInit(), rep());
    expect(r.kiDelta).toBe(8);
    expect(r.state.ki).toBe(8);
  });
  it('correct, mature, fast +12', () => {
    expect(kiaiStep(kiaiInit(), rep({ fast: true })).kiDelta).toBe(12);
    // speed only counts on mature cards
    expect(kiaiStep(kiaiInit(), rep({ fast: true, mature: false })).kiDelta).toBe(8);
  });
  it('Ippon +20 when correct, mature, fast and D ≥ 7 / lapsed within 30 d', () => {
    const r = kiaiStep(kiaiInit(), rep({ fast: true, difficultOrLapsed: true }));
    expect(r.ippon).toBe(true);
    expect(r.kiDelta).toBe(20);
    expect(r.state.ippon).toBe(1);
    expect(isIppon(rep({ fast: true, difficultOrLapsed: true, hintUsed: true }))).toBe(false);
    expect(kiaiStep(kiaiInit(), rep({ fast: false, difficultOrLapsed: true })).ippon).toBe(false);
  });
  it('wrong −10, Guard −4, hint −6, Block −4', () => {
    const s = { ...kiaiInit(), ki: 50 };
    expect(kiaiStep(s, rep({ correct: false })).kiDelta).toBe(-10);
    expect(kiaiStep(s, rep({ correct: false, guard: true })).kiDelta).toBe(-4);
    expect(kiaiStep(s, rep({ hintUsed: true })).kiDelta).toBe(8 - 6);
    expect(kiaiStep(s, rep({ correct: false, nearMiss: true })).kiDelta).toBe(KIAI_RULES.ki.block);
  });
  it('Guard on a training dummy costs ki 0', () => {
    const s = { ...kiaiInit(), ki: 50 };
    expect(kiaiStep(s, rep({ correct: false, guard: true, cardReviews: 2 })).kiDelta).toBe(0);
    expect(kiaiStep(s, rep({ correct: false, guard: true, mcFirstExposures: true })).kiDelta).toBe(0);
  });
  it('ki is clamped to 0..100', () => {
    expect(kiaiStep({ ...kiaiInit(), ki: 3 }, rep({ correct: false })).state.ki).toBe(0);
  });
});

describe('Kiai state', () => {
  it('enters at 100 and lasts exactly 10 reps, then ki resets to 30', () => {
    let s: KiaiState = { ...kiaiInit(), ki: 92 };
    const enter = kiaiStep(s, rep());
    expect(enter.kiaiEntered).toBe(true);
    expect(enter.kiaiActive).toBe(false);
    expect(enter.state.ki).toBe(100);
    expect(enter.state.kiaiLeft).toBe(10);
    s = enter.state;
    for (let i = 1; i <= 10; i++) {
      const r = kiaiStep(s, i % 3 === 0 ? rep({ correct: false }) : rep());
      expect(r.kiaiActive).toBe(true);
      expect(r.kiaiEntered).toBe(false);
      expect(r.kiDelta).toBe(0);
      s = r.state;
      if (i < 10) {
        expect(s.ki).toBe(100);
        expect(s.kiaiLeft).toBe(10 - i);
      }
    }
    expect(s.kiaiLeft).toBe(0);
    expect(s.ki).toBe(KIAI_RULES.kiReset);
    const after = kiaiStep(s, rep());
    expect(after.kiaiActive).toBe(false);
    expect(after.state.ki).toBe(38);
  });
  it('overshoot still pins at 100', () => {
    const r = kiaiStep({ ...kiaiInit(), ki: 95 }, rep({ fast: true, difficultOrLapsed: true }));
    expect(r.state.ki).toBe(100);
    expect(r.kiaiEntered).toBe(true);
  });
});

describe('combo', () => {
  it('counts consecutive corrects and tracks the best', () => {
    const s = run(kiaiInit(), [rep(), rep(), rep()]);
    expect(s.combo).toBe(3);
    expect(s.bestCombo).toBe(3);
  });
  it('training dummy: a miss on a card with < 3 reviews keeps the combo', () => {
    const s = run(kiaiInit(), [rep(), rep(), rep({ correct: false, cardReviews: 2 })]);
    expect(s.combo).toBe(2);
    expect(kiaiStep(s, rep({ correct: false, cardReviews: 2 })).comboBroken).toBe(false);
  });
  it('a clean miss on a non-dummy card resets the combo and queues a Recovery 3–8 reps later', () => {
    const base = run(kiaiInit(), [rep(), rep(), rep(), rep()]);
    const r = kiaiStep(base, rep({ correct: false, cardKey: 'v-n5-0001#rec', repIndex: 4, rng: mulberry32(7) }));
    expect(r.comboBroken).toBe(true);
    expect(r.state.combo).toBe(0);
    expect(r.state.bestCombo).toBe(4);
    expect(r.state.recoveryQueue).toHaveLength(1);
    const at = r.state.recoveryQueue[0]!.at;
    expect(at - 4).toBeGreaterThanOrEqual(3);
    expect(at - 4).toBeLessThanOrEqual(8);
    expect(dueRecoveries(r.state, at - 1)).toEqual([]);
    expect(dueRecoveries(r.state, at)).toEqual(['v-n5-0001#rec']);
  });
  it('without an rng the Recovery offset is the midpoint 5', () => {
    const r = kiaiStep(kiaiInit(), rep({ correct: false, cardKey: 'v-n5-0001#rec', repIndex: 10 }));
    expect(r.state.recoveryQueue[0]!.at).toBe(15);
  });
  it('Guard halves the combo on a non-dummy card and leaves it unchanged on a dummy', () => {
    const base = run(kiaiInit(), Array.from({ length: 9 }, () => rep()));
    expect(kiaiStep(base, rep({ correct: false, guard: true })).state.combo).toBe(4);
    expect(kiaiStep(base, rep({ correct: false, guard: true, cardReviews: 1 })).state.combo).toBe(9);
    expect(kiaiStep(base, rep({ correct: false, guard: true, mcFirstExposures: true })).state.combo).toBe(9);
  });
  it('Block (near-miss) holds the combo', () => {
    const base = run(kiaiInit(), [rep(), rep(), rep()]);
    const r = kiaiStep(base, rep({ correct: false, nearMiss: true }));
    expect(r.state.combo).toBe(3);
    expect(r.comboBroken).toBe(false);
  });
  it('Recovery success restores half of the lost combo', () => {
    let s = run(kiaiInit(), Array.from({ length: 20 }, () => rep()));
    s = kiaiStep(s, rep({ correct: false, cardKey: 'v-n5-0002#prod', repIndex: 20 })).state;
    expect(s.combo).toBe(0);
    s = run(s, [rep(), rep(), rep(), rep()]);
    expect(s.combo).toBe(4);
    const r = kiaiStep(s, rep({ isRecovery: true, cardKey: 'v-n5-0002#prod' }));
    expect(r.restoredHalf).toBe(true);
    expect(r.state.combo).toBe(4 + 1 + 10);
    expect(r.state.recoveryQueue).toEqual([]);
    // only one shot: a second "recovery" has nothing left to restore
    expect(kiaiStep(r.state, rep({ isRecovery: true, cardKey: 'v-n5-0002#prod' })).restoredHalf).toBe(false);
  });
  it('a failed Recovery restores nothing and clears the memory', () => {
    let s = kiaiStep(run(kiaiInit(), [rep(), rep()]), rep({ correct: false, cardKey: 'k-h-a#prod', repIndex: 2 })).state;
    s = kiaiStep(s, rep({ isRecovery: true, correct: false, cardKey: 'k-h-a#prod' })).state;
    expect(s.recoveryQueue).toEqual([]);
    expect(kiaiStep(s, rep({ isRecovery: true, cardKey: 'k-h-a#prod' })).restoredHalf).toBe(false);
  });
  it('speed never affects the combo', () => {
    const slow = run(kiaiInit(), [rep({ fast: false }), rep({ fast: false })]);
    const fast = run(kiaiInit(), [rep({ fast: true }), rep({ fast: true })]);
    expect(slow.combo).toBe(fast.combo);
  });
  it('milestones fire at 10 / 25 / 50 / 100 and when a restore jumps over one', () => {
    let s = kiaiInit();
    const hits: number[] = [];
    for (let i = 0; i < 100; i++) {
      const r = kiaiStep(s, rep());
      if (r.milestone) hits.push(r.milestone);
      s = r.state;
    }
    expect(hits).toEqual([10, 25, 50, 100]);
    expect(milestoneCrossed(8, 12)).toBe(10);
    expect(milestoneCrossed(9, 60)).toBe(50);
    expect(milestoneCrossed(10, 11)).toBeNull();
  });
  it('comboTier', () => {
    expect(comboTier(0)).toBe(0);
    expect(comboTier(10)).toBe(1);
    expect(comboTier(25)).toBe(2);
    expect(comboTier(50)).toBe(3);
  });
  it('never mutates the input state', () => {
    const s = kiaiInit();
    const frozen = JSON.stringify(s);
    kiaiStep(s, rep({ correct: false, cardKey: 'v-n5-0001#rec', repIndex: 0 }));
    expect(JSON.stringify(s)).toBe(frozen);
  });
});
