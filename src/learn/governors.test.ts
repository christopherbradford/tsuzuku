import { BELT_IDS, type Belt } from '../content/types';
import {
  EXPECTED_MAX_MINUTES,
  NEW_RATE_BY_BELT,
  PRESET_RETENTION,
  REVIEW_CAPS,
  capFor,
  capTierOf,
  governor,
  presetRate,
  retentionWorkload,
  steadyStateReviews,
  type GovernorInput,
  type NamedPreset,
} from './governors';

const PRESETS: NamedPreset[] = ['casual', 'standard', 'intense'];

const base: GovernorInput = {
  due: 40,
  cap: 160,
  acc7: 0.9,
  acc7n: 120,
  retention: 0.9,
  halved: false,
  recoveredDays: 0,
  newToday: 0,
  target: 9,
  minutesToday: 20,
  expectedMaxMinutes: 60,
  awayDays: 0,
};

describe('capFor (design 03 §4)', () => {
  it('tiers belts White–Orange / Green / Blue–Purple / Brown–Black', () => {
    expect(['white', 'yellow', 'orange'].map((b) => capTierOf(b as Belt))).toEqual([0, 0, 0]);
    expect(capTierOf('green')).toBe(1);
    expect(capTierOf('blue')).toBe(2);
    expect(capTierOf('purple')).toBe(2);
    expect(capTierOf('brown')).toBe(3);
    expect(capTierOf('black')).toBe(3);
  });
  it('returns the preset table', () => {
    expect([capFor('standard', 'white', 160), capFor('standard', 'green', 160), capFor('standard', 'blue', 160), capFor('standard', 'black', 160)]).toEqual([160, 200, 240, 320]);
    expect([capFor('casual', 'orange', 80), capFor('casual', 'green', 80), capFor('casual', 'purple', 80), capFor('casual', 'brown', 80)]).toEqual([80, 110, 130, 170]);
    expect([capFor('intense', 'yellow', 300), capFor('intense', 'green', 300), capFor('intense', 'blue', 300), capFor('intense', 'black', 300)]).toEqual([300, 360, 420, 540]);
  });
  it('custom scales the base by the Standard ratios', () => {
    expect(capFor('custom', 'white', 100)).toBe(100);
    expect(capFor('custom', 'green', 100)).toBe(125);
    expect(capFor('custom', 'blue', 100)).toBe(150);
    expect(capFor('custom', 'black', 100)).toBe(200);
    expect(capFor('custom', 'black', 0)).toBe(1);
  });
});

describe('steady-state load model (design 05 §2)', () => {
  it('reproduces ≈ 130 reviews/day at the N5 Standard rate', () => {
    const n5 = steadyStateReviews({ vocab: 7, kanji: 1, grammar: 0.75 }, 0.9);
    expect(n5).toBeGreaterThan(120);
    expect(n5).toBeLessThan(140);
  });
  it('retention workload: 0.9 → 1, lower retention → fewer reviews, higher → more', () => {
    expect(retentionWorkload(0.9)).toBeCloseTo(1, 12);
    expect(retentionWorkload(0.85)).toBeLessThan(0.7);
    expect(retentionWorkload(0.95)).toBeGreaterThan(1.5);
  });
  it('fits under the cap for every preset × belt', () => {
    for (const preset of PRESETS) {
      for (const belt of BELT_IDS) {
        const load = steadyStateReviews(presetRate(preset, belt), PRESET_RETENTION[preset]);
        const cap = capFor(preset, belt, REVIEW_CAPS[preset][0]);
        expect(load, `${preset}/${belt}: ${load.toFixed(1)} > ${cap}`).toBeLessThanOrEqual(cap);
      }
    }
  });
  it('belt rates are the 02 §6.1 table', () => {
    expect(NEW_RATE_BY_BELT.yellow).toEqual({ vocab: 7, kanji: 1, grammar: 0.75 });
    expect(NEW_RATE_BY_BELT.brown).toEqual({ vocab: 14, kanji: 3, grammar: 0.8 });
    expect(presetRate('casual', 'yellow').vocab).toBeCloseTo(4, 10);
    expect(presetRate('intense', 'yellow').vocab).toBeCloseTo(12.8, 10);
  });
});

describe('governor: backlog mode', () => {
  it('triggers above 2 × cap and shows exactly the cap', () => {
    expect(governor({ ...base, due: 320 }).backlog).toBe(false);
    expect(governor({ ...base, due: 320 }).showDue).toBe(160);
    const g = governor({ ...base, due: 321 });
    expect(g.backlog).toBe(true);
    expect(g.showDue).toBe(160);
    expect(g.newAllowed).toBe(0);
    expect(g.newTarget).toBe(0);
    expect(g.newPaused).toBe(true);
  });
  it('shows min(due, cap) otherwise', () => {
    expect(governor({ ...base, due: 40 }).showDue).toBe(40);
    expect(governor({ ...base, due: 200 }).showDue).toBe(160);
  });
});

describe('governor: adaptive new rate (hysteresis)', () => {
  it('thresholds are relative to retention: 0.78 Casual, 0.83 Standard', () => {
    expect(governor({ ...base, retention: 0.85, acc7: 0.78 }).rateFactor).toBe(1);
    expect(governor({ ...base, retention: 0.85, acc7: 0.779 }).rateFactor).toBe(0.5);
    expect(governor({ ...base, retention: 0.9, acc7: 0.83 }).rateFactor).toBe(1);
    expect(governor({ ...base, retention: 0.9, acc7: 0.829 }).rateFactor).toBe(0.5);
  });
  it('never halves on accuracy under 50 reviews', () => {
    expect(governor({ ...base, acc7: 0.5, acc7n: 49 }).rateFactor).toBe(1);
    expect(governor({ ...base, acc7: 0.5, acc7n: 50 }).rateFactor).toBe(0.5);
  });
  it('halves when backlog > 1.2 × cap even with good accuracy', () => {
    expect(governor({ ...base, due: 192 }).rateFactor).toBe(1);
    expect(governor({ ...base, due: 193 }).rateFactor).toBe(0.5);
  });
  it('restores only after 3 recovered days with backlog ≤ 1.2 × cap', () => {
    expect(governor({ ...base, halved: true, recoveredDays: 2 }).rateFactor).toBe(0.5);
    expect(governor({ ...base, halved: true, recoveredDays: 3 }).rateFactor).toBe(1);
    expect(governor({ ...base, halved: true, recoveredDays: 5, due: 193 }).rateFactor).toBe(0.5);
    // acc7 between the two thresholds keeps the halved state (hysteresis band)
    expect(governor({ ...base, halved: true, acc7: 0.85, recoveredDays: 0 }).rateFactor).toBe(0.5);
    expect(governor({ ...base, halved: false, acc7: 0.85 }).rateFactor).toBe(1);
  });
  it('halved target is rounded and new budget follows it', () => {
    const g = governor({ ...base, acc7: 0.5, target: 9 });
    expect(g.rateFactor).toBe(0.5);
    expect(g.newTarget).toBe(5);
    expect(g.newAllowed).toBe(18);
  });
});

describe('governor: cramming cap and overtraining', () => {
  it('stops introduction at 2 × target', () => {
    expect(governor({ ...base, newToday: 17 }).crammingCap).toBe(false);
    expect(governor({ ...base, newToday: 17 }).newAllowed).toBe(1);
    const g = governor({ ...base, newToday: 18 });
    expect(g.crammingCap).toBe(true);
    expect(g.newAllowed).toBe(0);
    expect(g.newTarget).toBe(0);
  });
  it('overtraining fires at 1.5 × the preset maximum', () => {
    expect(EXPECTED_MAX_MINUTES).toEqual({ casual: 35, standard: 60, intense: 95 });
    expect(governor({ ...base, minutesToday: 89 }).overtraining).toBe(false);
    expect(governor({ ...base, minutesToday: 90 }).overtraining).toBe(true);
    expect(governor({ ...base, minutesToday: 52, expectedMaxMinutes: 35 }).overtraining).toBe(false);
    expect(governor({ ...base, minutesToday: 53, expectedMaxMinutes: 35 }).overtraining).toBe(true);
  });
});

describe('governor: welcome back spreading (design 03 §8)', () => {
  it('spreads a 7–29 day absence over 7 days and pauses new items for 2 days', () => {
    for (const away of [7, 12, 29]) {
      const g = governor({ ...base, due: 700, awayDays: away });
      expect(g.spreadDays).toBe(7);
      expect(g.showDue).toBe(100);
      expect(g.backlog).toBe(false);
      expect(g.newPaused).toBe(true);
      expect(g.newAllowed).toBe(0);
    }
    expect(governor({ ...base, due: 700, awayDays: 10, daysBack: 1 }).newPaused).toBe(true);
    const back2 = governor({ ...base, due: 500, awayDays: 10, daysBack: 2 });
    expect(back2.newPaused).toBe(false);
    expect(back2.showDue).toBe(100);
  });
  it('does not spread short absences', () => {
    const g = governor({ ...base, due: 700, awayDays: 6 });
    expect(g.spreadDays).toBe(0);
    expect(g.backlog).toBe(true);
  });
  it('a 30+ day absence also spreads (the Welcome Back set comes first, by the builder)', () => {
    const g = governor({ ...base, due: 1400, awayDays: 45 });
    expect(g.spreadDays).toBe(7);
    expect(g.showDue).toBe(160);
    expect(g.backlog).toBe(false);
  });
  it('a spread that still exceeds 2 × cap is backlog mode', () => {
    const g = governor({ ...base, due: 7 * 321, awayDays: 20 });
    expect(g.backlog).toBe(true);
    expect(g.showDue).toBe(160);
  });
});
