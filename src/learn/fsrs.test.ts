import { CardFlag, hasFlag, type CardTuple, type Rating } from '../shared/store-types';
import {
  DECAY,
  FACTOR,
  MAX_INTERVAL,
  W,
  balancedDue,
  cardRetrievability,
  fuzzWindow,
  initialDifficulty,
  initialStability,
  lapseStability,
  nextDifficulty,
  nextInterval,
  nextStability,
  retrievability,
  sameDayStability,
  schedule,
  stepPending,
  successStability,
} from './fsrs';
import { GOLDEN, GOLDEN_OPTS } from './fsrs-golden';

const RATINGS: Rating[] = [1, 2, 3, 4];
const opts = { retention: 0.9, loadOnDay: () => 0, rng: () => 0.5 };
const fresh = (day: number): CardTuple => [day, 0, 0, 0, 0, 0, day, 0];

describe('weights and constants', () => {
  it('has the 19 FSRS-5 defaults from design 05 §1', () => {
    expect(W).toHaveLength(19);
    expect(W[0]).toBe(0.40255);
    expect(W[3]).toBe(15.69105);
    expect(W[18]).toBe(0.6621);
    expect(DECAY).toBe(-0.5);
    expect(FACTOR).toBeCloseTo(19 / 81, 12);
    expect(MAX_INTERVAL).toBe(365);
  });
});

describe('golden vectors', () => {
  it('has at least 30 frozen sequences', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(30);
  });
  it('replays every golden sequence within 1e-6', () => {
    for (const row of GOLDEN) {
      let card = fresh(row.days[0] as number);
      row.seq.forEach((g, i) => {
        card = schedule(card, g, row.days[i] as number, { retention: GOLDEN_OPTS.retention, loadOnDay: () => GOLDEN_OPTS.loadOnDay, rng: () => GOLDEN_OPTS.rng });
        const e = row.expect[i] as { s: number; d: number; due: number };
        expect(Math.abs(card[1] - e.s)).toBeLessThan(1e-6);
        expect(Math.abs(card[2] - e.d)).toBeLessThan(1e-6);
        expect(card[0]).toBe(e.due);
      });
    }
  });
});

describe('retrievability', () => {
  it('is 1 at t = 0 and decreases in t', () => {
    expect(retrievability(0, 10)).toBeCloseTo(1, 12);
    let prev = 1;
    for (let t = 1; t <= 400; t += 7) {
      const r = retrievability(t, 10);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });
  it('is 0.9 after exactly S days', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 12);
    expect(retrievability(123, 123)).toBeCloseTo(0.9, 12);
  });
  it('grows with S and is 0 for an empty card', () => {
    expect(retrievability(10, 20)).toBeGreaterThan(retrievability(10, 10));
    expect(retrievability(5, 0)).toBe(0);
    expect(cardRetrievability(fresh(100), 100)).toBe(0);
    expect(cardRetrievability([110, 10, 5, 1, 0, 2, 100, 0], 110)).toBeCloseTo(0.9, 12);
  });
});

describe('nextInterval', () => {
  it('equals S at the 0.9 target', () => {
    expect(nextInterval(0.9, 10)).toBe(10);
    expect(nextInterval(0.9, 42.4)).toBe(42);
  });
  it('clamps to [1, 365] and honours a custom maximum', () => {
    expect(nextInterval(0.9, 0.01)).toBe(1);
    expect(nextInterval(0.9, 5000)).toBe(365);
    expect(nextInterval(0.9, 5000, 730)).toBe(730);
    expect(nextInterval(0.9, 0.3, 730)).toBe(1);
  });
  it('is longer at lower retention and monotone in S', () => {
    expect(nextInterval(0.85, 100)).toBeGreaterThan(nextInterval(0.9, 100));
    expect(nextInterval(0.95, 100)).toBeLessThan(nextInterval(0.9, 100));
    expect(nextInterval(0.9, 50)).toBeLessThan(nextInterval(0.9, 60));
  });
});

describe('initial values', () => {
  it('S0 = w[g−1], increasing in g', () => {
    RATINGS.forEach((g) => expect(initialStability(g)).toBe(W[g - 1]));
    expect(initialStability(1)).toBeLessThan(initialStability(2));
    expect(initialStability(2)).toBeLessThan(initialStability(3));
    expect(initialStability(3)).toBeLessThan(initialStability(4));
  });
  it('D0 decreases in g and stays within 1..10', () => {
    let prev = 11;
    for (const g of RATINGS) {
      const d = initialDifficulty(g);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
      expect(d).toBeLessThan(prev);
      prev = d;
    }
    expect(initialDifficulty(1)).toBeCloseTo((W[4] as number) - Math.exp(0) + 1, 10);
  });
});

describe('difficulty update', () => {
  it('Again raises, Easy lowers, Good mean-reverts toward D0(4)', () => {
    expect(nextDifficulty(5, 1)).toBeGreaterThan(5);
    expect(nextDifficulty(5, 4)).toBeLessThan(5);
    const d0 = initialDifficulty(4);
    const d = nextDifficulty(8, 3);
    expect(d).toBeLessThan(8);
    expect(d).toBeGreaterThan(d0);
  });
  it('clamps to 1..10', () => {
    expect(nextDifficulty(10, 1)).toBeLessThanOrEqual(10);
    expect(nextDifficulty(1, 4)).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 50; i++) expect(nextDifficulty(10, 1)).toBeLessThanOrEqual(10);
  });
});

describe('stability update', () => {
  it('higher rating → larger S on success', () => {
    for (const s of [0.5, 3, 20, 120]) {
      for (const d of [2, 5, 9]) {
        for (const r of [0.7, 0.9, 0.99]) {
          const hard = nextStability(s, d, r, 2);
          const good = nextStability(s, d, r, 3);
          const easy = nextStability(s, d, r, 4);
          expect(hard).toBeLessThan(good);
          expect(good).toBeLessThan(easy);
          expect(hard).toBeGreaterThan(0);
        }
      }
    }
  });
  it('success grows S more when R is lower (spacing effect) and when D is lower', () => {
    expect(successStability(10, 5, 0.7, 3)).toBeGreaterThan(successStability(10, 5, 0.9, 3));
    expect(successStability(10, 3, 0.9, 3)).toBeGreaterThan(successStability(10, 8, 0.9, 3));
  });
  it('lapse never exceeds S', () => {
    for (const s of [0.4, 1, 10, 100, 365]) {
      for (const d of [1, 5, 10]) {
        for (const r of [0.5, 0.9]) {
          const l = lapseStability(s, d, r);
          expect(l).toBeLessThanOrEqual(s);
          expect(l).toBeGreaterThan(0);
          expect(nextStability(s, d, r, 1)).toBe(l);
        }
      }
    }
  });
  it('same-day: Good/Easy grow, Again shrinks', () => {
    expect(sameDayStability(10, 3)).toBeGreaterThan(10);
    expect(sameDayStability(10, 4)).toBeGreaterThan(sameDayStability(10, 3));
    expect(sameDayStability(10, 1)).toBeLessThan(10);
    expect(sameDayStability(10, 2)).toBeLessThan(sameDayStability(10, 3));
  });
});

describe('fuzz window and load balancing', () => {
  it('is ±5 % floored to whole days, never below 1 or above the max', () => {
    expect(fuzzWindow(100)).toEqual([95, 105]);
    expect(fuzzWindow(10)).toEqual([10, 10]);
    expect(fuzzWindow(19)).toEqual([19, 19]);
    expect(fuzzWindow(20)).toEqual([19, 21]);
    expect(fuzzWindow(1)).toEqual([1, 1]);
    expect(fuzzWindow(365)).toEqual([347, 365]);
    expect(fuzzWindow(365, 730)).toEqual([347, 383]);
  });
  it('picks the least-loaded day in the window', () => {
    const today = 1000;
    const due = balancedDue(today, 100, { ...opts, loadOnDay: (d) => (d === today + 103 ? 0 : 50) });
    expect(due).toBe(today + 103);
  });
  it('breaks ties with the injected rng', () => {
    const today = 1000;
    expect(balancedDue(today, 100, { ...opts, rng: () => 0 })).toBe(today + 95);
    expect(balancedDue(today, 100, { ...opts, rng: () => 0.999 })).toBe(today + 105);
  });
});

describe('schedule', () => {
  const today = 20000;
  it('new card: Again/Hard/Good enter learning with steps pending, Easy goes straight to review', () => {
    for (const g of [1, 2, 3] as Rating[]) {
      const c = schedule(fresh(today), g, today, opts);
      expect(c[5]).toBe(1);
      expect(stepPending(c)).toBe(true);
      expect(c[3]).toBe(1);
      expect(c[4]).toBe(0);
      expect(c[1]).toBeCloseTo(initialStability(g), 2);
      expect(c[2]).toBeCloseTo(initialDifficulty(g), 2);
      expect(c[6]).toBe(today);
    }
    const easy = schedule(fresh(today), 4, today, opts);
    expect(easy[5]).toBe(2);
    expect(stepPending(easy)).toBe(false);
    expect(easy[0] - today).toBe(nextInterval(0.9, easy[1]));
  });
  it('learning + Good graduates and clears the step flag; learning + Again stays', () => {
    const l = schedule(fresh(today), 1, today, opts);
    const g = schedule(l, 3, today + 1, opts);
    expect(g[5]).toBe(2);
    expect(stepPending(g)).toBe(false);
    const a = schedule(l, 1, today + 1, opts);
    expect(a[5]).toBe(1);
    expect(a[4]).toBe(0);
    expect(stepPending(a)).toBe(true);
  });
  it('review + Again is a lapse into relearning; relearning + Good returns to review', () => {
    const review: CardTuple = [today, 20, 5, 6, 0, 2, today - 20, 0];
    const lapsed = schedule(review, 1, today, opts);
    expect(lapsed[5]).toBe(3);
    expect(lapsed[4]).toBe(1);
    expect(lapsed[1]).toBeLessThanOrEqual(20);
    expect(stepPending(lapsed)).toBe(true);
    const back = schedule(lapsed, 3, today + 1, opts);
    expect(back[5]).toBe(2);
    expect(back[4]).toBe(1);
    expect(stepPending(back)).toBe(false);
  });
  it('same-day review takes the short-term path', () => {
    const c: CardTuple = [today + 5, 5, 5, 2, 0, 2, today, 0];
    const n = schedule(c, 3, today, opts);
    expect(n[1]).toBeCloseTo(Math.round(sameDayStability(5, 3) * 100) / 100, 6);
  });
  it('later-day review uses R from the elapsed days', () => {
    const c: CardTuple = [today, 10, 5, 2, 0, 2, today - 10, 0];
    const n = schedule(c, 3, today, opts);
    const expected = nextStability(10, 5, retrievability(10, 10), 3);
    expect(n[1]).toBeCloseTo(Math.round(expected * 100) / 100, 6);
    expect(n[2]).toBeCloseTo(Math.round(nextDifficulty(5, 3) * 100) / 100, 6);
  });
  it('due lands inside the fuzz window and never beyond the max interval', () => {
    const big: CardTuple = [today, 300, 3, 20, 0, 2, today - 300, 0];
    const n = schedule(big, 4, today, opts);
    expect(n[0] - today).toBeLessThanOrEqual(365);
    expect(n[0] - today).toBeGreaterThanOrEqual(347);
    const n2 = schedule(big, 4, today, { ...opts, maxInterval: 730 });
    expect(n2[0] - today).toBeGreaterThan(365);
    expect(n2[0] - today).toBeLessThanOrEqual(730);
    const mid: CardTuple = [today, 40, 5, 5, 0, 2, today - 40, 0];
    const m = schedule(mid, 3, today, opts);
    const [lo, hi] = fuzzWindow(nextInterval(0.9, m[1]));
    expect(m[0] - today).toBeGreaterThanOrEqual(lo);
    expect(m[0] - today).toBeLessThanOrEqual(hi);
  });
  it('rounds stored s and d to 2 decimals and preserves archived/nemesis/kaiden flags', () => {
    const c: CardTuple = [today, 10, 5, 2, 0, 2, today - 10, CardFlag.archived | CardFlag.kaiden];
    const n = schedule(c, 3, today, opts);
    expect(n[1]).toBe(Math.round(n[1] * 100) / 100);
    expect(n[2]).toBe(Math.round(n[2] * 100) / 100);
    expect(hasFlag(n[7], CardFlag.archived)).toBe(true);
    expect(hasFlag(n[7], CardFlag.kaiden)).toBe(true);
    expect(hasFlag(n[7], CardFlag.stepPending)).toBe(false);
  });
  it('is monotone: a better rating never yields a shorter interval', () => {
    const c: CardTuple = [today, 15, 6, 4, 0, 2, today - 15, 0];
    const due = RATINGS.map((g) => schedule(c, g, today, opts)[0]);
    expect(due[0]).toBeLessThanOrEqual(due[1] as number);
    expect(due[1]).toBeLessThanOrEqual(due[2] as number);
    expect(due[2]).toBeLessThanOrEqual(due[3] as number);
  });
});
