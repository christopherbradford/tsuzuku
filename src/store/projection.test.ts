import type { CardKey, StationBundle } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple, LogEntry, SaveMeta, Settings } from '../shared/store-types';
import { defaultSettings } from './defaults';
import {
  ADHERENCE_FLOOR,
  KANA_PER_STATION,
  MIN_ACTIVE_DAYS,
  SHINSA_STATIONS,
  activeDaysIn,
  beltOfStation,
  expectedMinutes,
  fullRateFor,
  gateWait,
  itemsIntroducedIn,
  lifetimeActiveDays,
  onboardingEstimate,
  presetScale,
  projectRoad,
  projectedArrival,
  remainingFor,
  stationQuota,
} from './projection';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, card, makeTestStore, testSave, type DeepPartial } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const DAY_MS = 86_400_000;

function bundle(n: number, o: { kana?: number; vocab?: number; kanji?: number; grammar?: number } = {}): StationBundle {
  const id = (p: string, i: number): string => `${p}-${String(n * 100 + i).padStart(4, '0')}`;
  return {
    schema: 'tsuzuku.station/1',
    number: n,
    kanaIds: Array.from({ length: o.kana ?? 0 }, (_, i) => `k-h-s${n}x${i}`),
    vocabIds: Array.from({ length: o.vocab ?? 0 }, (_, i) => id(n <= 15 ? 'v-n5' : 'v-n4', i)),
    kanjiIds: Array.from({ length: o.kanji ?? 0 }, (_, i) => `j-${String.fromCharCode(0x4e00 + n * 100 + i)}`),
    grammarIds: Array.from({ length: o.grammar ?? 0 }, (_, i) => `g-n5-${String(n * 10 + i).padStart(3, '0')}`),
    componentIds: [],
    storyIds: [],
    michikusaIds: [],
    files: [],
    surfaces: {},
  };
}

function live(s: number, extra: Partial<{ due: number; reps: number; last: number }> = {}): CardTuple {
  return card({ due: extra.due ?? TODAY + 1, s, reps: extra.reps ?? 3, state: 2, last: extra.last ?? TODAY });
}

function activeSave(days = 28, totalDays = 30, station = 1): DeepPartial<SaveMeta> {
  const daily: Record<number, { reps: number; ok: number; minutes: number; xp: number; input: number }> = {};
  for (let i = 0; i < days; i++) daily[TODAY - i] = { reps: 20, ok: 18, minutes: 10, xp: 50, input: 0 };
  return { daily, streak: { totalDays }, progress: { station } };
}

const WHITE = [bundle(1, { kana: 10, vocab: 10 }), bundle(2, { kana: 10, vocab: 10 }), bundle(3, { kana: 10, vocab: 10 })];
/** White at Standard: 4 words + 20 kana per day. */
const WHITE_FULL = 24;

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('building blocks', () => {
  it('station quotas come from STATIONS plus the design 02 kana counts', () => {
    expect(stationQuota(1)).toEqual({ kana: 71, vocab: 20, kanji: 0, grammar: 0, total: 91 });
    expect(stationQuota(4)).toEqual({ kana: 0, vocab: 60, kanji: 8, grammar: 8, total: 76 });
    expect(stationQuota(53).total).toBe(225);
    expect(stationQuota(99).total).toBe(0);
    expect(Object.values(KANA_PER_STATION).reduce((a, b) => a + b, 0)).toBe(238);
    expect(SHINSA_STATIONS).toEqual([9, 15, 24, 31, 38, 46, 53]);
    expect(beltOfStation(0)).toBe('white');
    expect(beltOfStation(25)).toBe('blue');
    expect(beltOfStation(60)).toBe('black');
  });

  it('full rates follow the setting; White adds the kana lane', () => {
    const s = defaultSettings();
    expect(fullRateFor(s, 'white')).toBe(WHITE_FULL);
    expect(fullRateFor(s, 'yellow')).toBe(8.75);
    expect(fullRateFor({ ...s, intensity: 'casual' }, 'yellow')).toBeCloseTo(5, 1);
    expect(fullRateFor({ ...s, intensity: 'custom', newPerDay: { vocab: 2, kanji: 0, grammar: 0 } }, 'green')).toBe(2);
    expect(presetScale(s)).toBe(1);
    expect(presetScale({ ...s, intensity: 'intense' })).toBeCloseTo(16 / 8.75);
    expect(presetScale({ ...s, intensity: 'custom', newPerDay: { vocab: 7, kanji: 1, grammar: 0.75 } })).toBe(1);
  });

  it('gate wait shrinks as days since the last introduction grow, floor 1', () => {
    expect(gateWait(null, TODAY)).toBe(7);
    expect(gateWait(TODAY, TODAY)).toBe(7);
    expect(gateWait(TODAY - 3, TODAY)).toBe(4);
    expect(gateWait(TODAY - 6, TODAY)).toBe(1);
    expect(gateWait(TODAY - 30, TODAY)).toBe(1);
  });

  it('activeDaysIn / lifetimeActiveDays', () => {
    const m = testSave({ save: activeSave(5, 3) });
    expect(activeDaysIn(m, TODAY)).toBe(5);
    expect(activeDaysIn(m, TODAY, 3)).toBe(3);
    expect(lifetimeActiveDays(m)).toBe(5);
    expect(lifetimeActiveDays(testSave({ save: { streak: { totalDays: 40 } } }))).toBe(40);
  });

  it('remainingFor counts uncarded items from a bundle, or the quota without one', async () => {
    const b = bundle(2, { vocab: 10 });
    const s = await makeTestStore({ cards: { [`${b.vocabIds[0]}#rec`]: live(2, { last: TODAY - 4 }), [`${b.vocabIds[1]}#rec`]: live(2, { last: TODAY - 1 }) } });
    expect(remainingFor(2, b, s.cards)).toEqual({ station: 2, remaining: 8, lastIntro: TODAY - 1, fromQuota: false });
    expect(remainingFor(4, undefined, s.cards)).toEqual({ station: 4, remaining: 76, lastIntro: null, fromQuota: true });
  });
});

describe('projectedArrival (design 02 §6.2)', () => {
  it('is null before 14 active days', async () => {
    const s = await makeTestStore({ save: activeSave(13, 13) });
    expect(projectedArrival(s.meta(), s.cards, WHITE, 3, TODAY)).toBeNull();
    expect(projectRoad(s.meta(), s.cards, WHITE, TODAY)).toBeNull();
    expect(MIN_ACTIVE_DAYS).toBe(14);
    store.patch('streak', (x) => ({ ...x, totalDays: 14 }));
    expect(projectedArrival(store.meta(), store.cards, WHITE, 3, TODAY)).not.toBeNull();
  });

  it('formula on fixtures: 1-item/day floor without realized introductions, full rate on the daily line', async () => {
    const s = await makeTestStore({ save: activeSave() });
    const p = projectedArrival(s.meta(), s.cards, WHITE, 3, TODAY);
    expect(p).not.toBeNull();
    // 3 × (20 / 1 + 7) = 81 at adherence 1.
    expect(p?.adherence).toBe(1);
    expect(p?.realizedRate).toBe(0);
    expect(p?.activeDays).toBe(28);
    expect(p?.remainingItems).toBe(60);
    expect(p?.fromQuota).toBe(false);
    expect(p?.atPace).toBe(TODAY + 81);
    expect(p?.band).toEqual([TODAY + Math.ceil(81 * 0.8), TODAY + Math.ceil(81 * 1.2)]);
    // Daily: 3 × (20 / 24 + 7) = 23.5 → 24.
    expect(p?.daily).toBe(TODAY + Math.ceil(3 * (20 / WHITE_FULL + 7)));
  });

  it('adherence is clamped to 0.3..1 and stretches the pace line only', async () => {
    const sparse = { ...activeSave(1, 20), progress: { station: 1 } };
    const s = await makeTestStore({ save: sparse });
    const p = projectedArrival(s.meta(), s.cards, WHITE, 3, TODAY);
    expect(p?.adherence).toBe(ADHERENCE_FLOOR);
    expect(p?.atPace).toBe(TODAY + Math.ceil(81 / 0.3));
    expect(p?.daily).toBe(TODAY + Math.ceil(3 * (20 / WHITE_FULL + 7)));
    const half = testSave({ save: activeSave(14, 20) });
    expect(projectedArrival(half, s.cards, WHITE, 3, TODAY)?.adherence).toBe(0.5);
  });

  it('realized pace from the log shortens the estimate; monotone in realized logs; never below the floor', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    const log: LogEntry[] = [];
    // 56 items introduced over the last 28 days → 2 per active day.
    for (let i = 0; i < 56; i++) {
      const id = `v-n4-${String(i).padStart(4, '0')}`;
      cards[`${id}#rec`] = live(1, { reps: 1, last: TODAY - (i % 28) });
      log.push([DEFAULT_TEST_NOW - (i % 28) * DAY_MS, `${id}#rec`, 3, 1000, 0, 0]);
    }
    // An old item whose history predates the ring must not count.
    cards['v-n4-9999#rec'] = live(30, { reps: 12 });
    log.push([DEFAULT_TEST_NOW, 'v-n4-9999#rec', 3, 1000, 0, 0]);
    const s = await makeTestStore({ save: activeSave(), cards });
    expect(itemsIntroducedIn(log, s.cards, TODAY, 'UTC')).toBe(56);

    const slow = projectedArrival(s.meta(), s.cards, WHITE, 3, TODAY, []) as NonNullable<ReturnType<typeof projectedArrival>>;
    const fast = projectedArrival(s.meta(), s.cards, WHITE, 3, TODAY, log) as NonNullable<ReturnType<typeof projectedArrival>>;
    expect(fast.realizedRate).toBe(2);
    // rate clamps to 2 (< 24 full): 3 × (20 / 2 + 7) = 51.
    expect(fast.atPace).toBe(TODAY + 51);
    expect(fast.atPace).toBeLessThan(slow.atPace);
    expect(fast.daily).toBe(slow.daily);

    // More introductions never push the date later, and the setting caps the rate.
    const faster: LogEntry[] = [...log];
    for (let i = 100; i < 1500; i++) {
      const id = `v-n4-${String(i).padStart(4, '0')}`;
      store.cards.set(`${id}#rec`, live(1, { reps: 1, last: TODAY - (i % 28) }));
      faster.push([DEFAULT_TEST_NOW - (i % 28) * DAY_MS, `${id}#rec`, 3, 1000, 0, 0]);
    }
    const capped = projectedArrival(store.meta(), store.cards, WHITE, 3, TODAY, faster) as NonNullable<ReturnType<typeof projectedArrival>>;
    expect(capped.realizedRate).toBeGreaterThan(WHITE_FULL);
    expect(capped.atPace).toBeLessThanOrEqual(fast.atPace);
    // Never earlier than the floor: remaining / full + the gate waits.
    expect(capped.atPace).toBe(TODAY + Math.ceil(3 * (20 / WHITE_FULL + 7)));
    expect(capped.atPace).toBeGreaterThanOrEqual(TODAY + Math.ceil(60 / WHITE_FULL + 3));
  });

  it('is monotone in remaining items', async () => {
    const s = await makeTestStore({ save: activeSave() });
    const few = [bundle(1, { kana: 5, vocab: 5 })];
    const many = [bundle(1, { kana: 10, vocab: 20 })];
    const a = projectedArrival(s.meta(), s.cards, few, 1, TODAY) as NonNullable<ReturnType<typeof projectedArrival>>;
    const b = projectedArrival(s.meta(), s.cards, many, 1, TODAY) as NonNullable<ReturnType<typeof projectedArrival>>;
    expect(a.remainingItems).toBe(10);
    expect(b.remainingItems).toBe(30);
    expect(a.atPace).toBeLessThan(b.atPace);
    expect(a.daily).toBeLessThanOrEqual(b.daily);
    expect(a.band[0]).toBeLessThanOrEqual(a.atPace);
    expect(a.band[1]).toBeGreaterThanOrEqual(a.atPace);
  });

  it('cleared stations drop out; a Shinsa station adds two days; gate wait follows the last intro', async () => {
    const b = [bundle(2, { vocab: 10 })];
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of b[0]!.vocabIds) cards[`${id}#rec`] = live(5, { last: TODAY - 3, reps: 2 });
    const s = await makeTestStore({ save: activeSave(28, 30, 2), cards });
    // Everything introduced three days ago → gateWait 4, nothing remaining.
    expect(projectedArrival(s.meta(), s.cards, b, 2, TODAY)?.atPace).toBe(TODAY + 4);
    store.patch('progress', (p) => ({ ...p, stationsCleared: [2] }));
    expect(projectedArrival(store.meta(), store.cards, b, 2, TODAY)?.atPace).toBe(TODAY);

    const nine = [bundle(9, { vocab: 10 })];
    const m9 = { ...store.meta(), progress: { ...store.progress.value, station: 9, stationsCleared: [] } };
    // 10 items at the floor rate 1 + gate wait 7 + Shinsa 2 = 19.
    expect(projectedArrival(m9, store.cards, nine, 9, TODAY)?.atPace).toBe(TODAY + 19);
    // Station 8 (no Shinsa) with the same shape: 17.
    const eight = [bundle(8, { vocab: 10 })];
    const m8 = { ...m9, progress: { ...m9.progress, station: 8 } };
    expect(projectedArrival(m8, store.cards, eight, 8, TODAY)?.atPace).toBe(TODAY + 17);
  });

  it('stations without a loaded bundle are counted from their quota and flagged', async () => {
    const s = await makeTestStore({ save: activeSave(28, 30, 4) });
    const p = projectedArrival(s.meta(), s.cards, [], 4, TODAY) as NonNullable<ReturnType<typeof projectedArrival>>;
    expect(p.fromQuota).toBe(true);
    expect(p.remainingItems).toBe(76);
    // 76 / 1 + 7 at the floor; daily at Yellow Standard 8.75/day.
    expect(p.atPace).toBe(TODAY + 83);
    expect(p.daily).toBe(TODAY + Math.ceil(76 / 8.75 + 7));
    const withBundle = projectedArrival(s.meta(), s.cards, [bundle(4, { vocab: 10 })], 4, TODAY) as NonNullable<ReturnType<typeof projectedArrival>>;
    expect(withBundle.fromQuota).toBe(false);
    expect(withBundle.remainingItems).toBe(10);
  });

  it('projectRoad: arrival at Sanjō Ōhashi plus per-belt ETAs in road order, belts already passed left out', async () => {
    const s = await makeTestStore({ save: { ...activeSave(28, 30, 10), progress: { station: 10, stationsCleared: Array.from({ length: 9 }, (_, i) => i + 1), shinsaPassed: ['yellow'] } } });
    const road = projectRoad(s.meta(), s.cards, [], TODAY) as NonNullable<ReturnType<typeof projectRoad>>;
    expect(road.arrival).toEqual(projectedArrival(s.meta(), s.cards, [], 53, TODAY));
    expect(road.belts.map((b) => b.belt)).toEqual(['orange', 'green', 'blue', 'purple', 'brown', 'black']);
    expect(road.belts.map((b) => b.station)).toEqual([15, 24, 31, 38, 46, 53]);
    for (let i = 1; i < road.belts.length; i++) {
      expect(road.belts[i]!.atPace).toBeGreaterThanOrEqual(road.belts[i - 1]!.atPace);
      expect(road.belts[i]!.daily).toBeGreaterThanOrEqual(road.belts[i - 1]!.daily);
    }
    expect(road.belts[road.belts.length - 1]!.atPace).toBe(road.arrival.atPace);
    expect(road.belts[0]!.band[0]).toBeLessThanOrEqual(road.belts[0]!.atPace);
    // White (passed by position) is not listed even though it has no Shinsa.
    expect(road.belts.find((b) => b.belt === 'white')).toBeUndefined();
  });
});

describe('onboardingEstimate (design 02 §6.1, 01 §2)', () => {
  const std = defaultSettings();

  it('Standard: ≈ 22 months at 100 %, ≈ 31 at 70 %, ≈ 450 in-app hours, computed from the quotas and the preset', () => {
    const e = onboardingEstimate(std, TODAY);
    expect(e.byBelt.map((b) => b.belt)).toEqual(['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']);
    expect(e.days100).toBeGreaterThan(600);
    expect(e.days100).toBeLessThan(740);
    expect(e.days70).toBe(Math.ceil(e.days100 / 0.7));
    expect(e.arrive100).toBe(TODAY + e.days100);
    expect(e.arrive70).toBe(TODAY + e.days70);
    expect(e.hoursInApp).toBeGreaterThan(400);
    expect(e.hoursInApp).toBeLessThan(550);
    // Days per belt = max over streams ÷ rate + gates + Shinsa: Yellow is grammar-bound (45 / 0.75 = 60) + 6 + 2.
    const yellow = e.byBelt.find((b) => b.belt === 'yellow')!;
    expect(yellow.items).toEqual({ kana: 0, vocab: 360, kanji: 48, grammar: 45, total: 453 });
    expect(yellow.days).toBe(Math.ceil(45 / 0.75 + 6 + 2));
    expect(yellow.minutesPerDay).toBe(25);
    const white = e.byBelt.find((b) => b.belt === 'white')!;
    expect(white.items.kana).toBe(238);
    expect(white.days).toBe(Math.ceil(80 / 4 + 3));
  });

  it('Casual takes longer than Standard, Intense is shorter; minutes/day scale with the preset', () => {
    const casual = onboardingEstimate({ ...std, intensity: 'casual' }, TODAY);
    const intense = onboardingEstimate({ ...std, intensity: 'intense' }, TODAY);
    const standard = onboardingEstimate(std, TODAY);
    expect(casual.days100).toBeGreaterThan(standard.days100);
    expect(intense.days100).toBeLessThan(standard.days100);
    expect(expectedMinutes(std, 'brown')).toBe(58);
    expect(expectedMinutes({ ...std, intensity: 'casual' }, 'brown')).toBeLessThan(58);
    expect(expectedMinutes({ ...std, intensity: 'intense' }, 'brown')).toBeGreaterThan(58);
    expect(intense.hoursInApp).toBeGreaterThan(0);
  });

  it('starts from the given station and honours a custom mix', () => {
    const e = onboardingEstimate(std, TODAY, 10);
    expect(e.byBelt.map((b) => b.belt)).toEqual(['orange', 'green', 'blue', 'purple', 'brown', 'black']);
    expect(e.byBelt[0]!.items.vocab).toBe(360);
    const custom: Settings = { ...std, intensity: 'custom', newPerDay: { vocab: 20, kanji: 4, grammar: 2 } };
    const c = onboardingEstimate(custom, TODAY);
    expect(c.days100).toBeLessThan(onboardingEstimate(std, TODAY).days100);
  });
});
