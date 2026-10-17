import type { CardKey, StationBundle } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import { CardFlag, type CardTuple, type DailyRow, type EpochDay } from '../shared/store-types';
import { activityDays, beltEligibility, dueCount, dueShownToday, homeSummary, isBacklog, ledgerSummary, recordsSummary, retention, stationNameJa, stationProgress, streakSummary } from './selectors';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function bundle(n: number, o: { kana?: number; vocab?: number; kanji?: number; grammar?: number } = {}): StationBundle {
  const id = (p: string, i: number): string => `${p}-${String(n * 100 + i).padStart(4, '0')}`;
  return {
    schema: 'tsuzuku.station/1',
    number: n,
    kanaIds: Array.from({ length: o.kana ?? 0 }, (_, i) => `k-h-s${n}x${i}`),
    vocabIds: Array.from({ length: o.vocab ?? 0 }, (_, i) => id('v-n5', i)),
    kanjiIds: Array.from({ length: o.kanji ?? 0 }, (_, i) => `j-${String.fromCharCode(0x4e00 + n * 100 + i)}`),
    grammarIds: Array.from({ length: o.grammar ?? 0 }, (_, i) => `g-n5-${String(n * 10 + i).padStart(3, '0')}`),
    componentIds: [],
    storyIds: [],
    michikusaIds: [],
    files: [],
    surfaces: {},
  };
}

function live(s: number, extra: Partial<{ due: number; flags: number }> = {}): CardTuple {
  return card({ due: extra.due ?? TODAY + 1, s, reps: 3, state: 2, last: TODAY, flags: extra.flags ?? 0 });
}

function rows(spec: Record<number, Partial<DailyRow>>): Record<EpochDay, DailyRow> {
  const out: Record<EpochDay, DailyRow> = {};
  for (const [k, r] of Object.entries(spec)) out[Number(k)] = { reps: 0, ok: 0, minutes: 0, xp: 0, input: 0, ...r };
  return out;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('module-plan selectors (via derived)', () => {
  it('dueCount excludes archived cards; backlog threshold is 2 × the belt-scaled cap', async () => {
    const cards: Record<CardKey, CardTuple> = {
      'v-n5-0001#rec': live(1, { due: TODAY - 1 }),
      'v-n5-0002#rec': live(1, { due: TODAY }),
      'v-n5-0003#rec': live(1, { due: TODAY + 1 }),
      'v-n5-0004#rec': live(1, { due: TODAY, flags: CardFlag.archived }),
    };
    await makeTestStore({ cards });
    expect(dueCount()).toBe(2);
    expect(isBacklog()).toBe(false);
    expect(dueShownToday()).toBe(2);
    const many: Record<CardKey, CardTuple> = {};
    for (let i = 0; i < 321; i++) many[`v-n5-${String(i).padStart(4, '0')}#rec`] = live(1, { due: TODAY });
    resetStoreForTests();
    await makeTestStore({ cards: many });
    expect(dueCount()).toBe(321);
    expect(isBacklog()).toBe(true); // Standard White cap 160 → 2 × 160 = 320
    expect(dueShownToday()).toBe(160);
  });

  it('beltEligibility thresholds at 85 % Green and 50 % Brown; stationProgress gateReady at 80 % Green', async () => {
    const b = bundle(4, { vocab: 20 });
    const cards: Record<CardKey, CardTuple> = {};
    b.vocabIds.forEach((id, i) => {
      // 18 of 20 Green (90 %), 10 of 20 Brown (50 %).
      if (i < 10) {
        cards[`${id}#rec`] = live(40);
        cards[`${id}#prod`] = live(10);
      } else if (i < 18) cards[`${id}#rec`] = live(10);
      else cards[`${id}#rec`] = live(0.5);
    });
    await makeTestStore({ cards, save: { progress: { stationsCleared: [4, 5, 6, 7, 8, 9] } } });
    const e = beltEligibility('yellow', [b]);
    expect(e.coverageRec).toBeCloseTo(0.9, 6);
    expect(e.coverageProd).toBeCloseTo(0.5, 6);
    expect(e.gatesDone).toBe(true);
    expect(e.eligible).toBe(true);
    const p = stationProgress(4, b);
    expect(p).toMatchObject({ introduced: 20, total: 20, green: 18, gateReady: true, cleared: true });
  });
});

describe('homeSummary', () => {
  it('bundles the Dojo numbers from one store read', async () => {
    await makeTestStore({
      save: {
        profile: { xp: 2380, level: 5, belt: 'yellow' },
        progress: { station: 5, awayDays: 0 },
        streak: { current: 3, longest: 6, lastDay: TODAY - 1, totalDays: 40, freezes: 1 },
        quests: { day: TODAY, ids: ['learn-scroll', 'michikusa-one'], done: ['learn-scroll'] },
      },
    });
    const h = homeSummary();
    expect(h.today).toBe(TODAY);
    expect(h.belt).toBe('yellow');
    expect(h.station).toBe(5);
    expect(h.stationJa).toBe('戸塚');
    expect(h.titleJa).toBe('入門');
    expect(h.level).toMatchObject({ level: 5, into: 380, needed: 760 });
    expect(h.streak).toMatchObject({ state: 'lit', current: 3, longest: 6, totalDays: 40, freezes: 1, repair: null, fullDay: false });
    expect(h.quests.map((q) => q.done)).toEqual([true, false]);
    expect(h.backlog).toEqual({ active: false, due: 0, shown: 0 });
    expect(h.forecast.due).toBe(0);
    expect(h.away).toEqual({ awayDays: 0, returnedDaysAgo: 0, newPaused: false, spreadDaysLeft: 0, welcomeBackDue: false });
    expect(h.resume).toBe(false);
    expect(stationNameJa(0)).toBe('日本橋');
    expect(stationNameJa(99)).toBe('三条大橋');
  });

  it('gold flame when all Three Kata are done; repair window surfaces its countdown', async () => {
    await makeTestStore({
      save: {
        streak: { current: 0, longest: 6, lastDay: TODAY - 3, totalDays: 40, repairWindow: { start: TODAY - 1, done: 1 } },
        quests: { day: TODAY, ids: ['learn-scroll'], done: ['learn-scroll'] },
      },
    });
    let s = streakSummary();
    expect(s.state).toBe('broken');
    expect(s.repair).toEqual({ done: 1, needed: 3, daysLeft: 4 });
    store.patch('streak', (x) => ({ ...x, lastDay: TODAY, current: 1 }));
    s = streakSummary();
    expect(s.state).toBe('gold');
    expect(s.fullDay).toBe(true);
  });
});

describe('records and ledger summaries', () => {
  it('activityDays, retention and recordsSummary read the daily rows', async () => {
    const daily = rows({
      [TODAY]: { reps: 10, ok: 9, minutes: 5 },
      [TODAY - 1]: { reps: 20, ok: 15, minutes: 10 },
      [TODAY - 10]: { reps: 10, ok: 10, minutes: 3 },
    });
    await makeTestStore({ save: { daily, stats: { judgeChecks: 10, honesty: 0.9, reviews: 40 }, streak: { totalDays: 3 } } });
    const days = activityDays(3);
    expect(days.map((d) => d.day)).toEqual([TODAY - 2, TODAY - 1, TODAY]);
    expect(days.map((d) => d.active)).toEqual([false, true, true]);
    expect(retention(7)).toBe(0.8);
    expect(retention(30)).toBe(0.85);
    expect(retention(1, TODAY - 5)).toBeNull();
    const r = recordsSummary();
    expect(r.activeDays28).toBe(3);
    expect(r.honesty).toBe(0.9);
    expect(r.judgeChecks).toBe(10);
    expect(r.reviews).toBe(40);
    expect(r.totalDays).toBe(3);
    expect(r.weakPoints).toEqual([]);
    expect(r.conquered).toEqual([]);
  });

  it('ledgerSummary: hours, goal ratio, this week vs target, missions', async () => {
    await makeTestStore({
      save: {
        profile: { belt: 'green' },
        ledger: {
          entries: [
            [TODAY, 60, 0, 1],
            [TODAY, 30, 1, 0],
          ],
          missions: [
            { day: TODAY - 1, tier: 5, conversation: true },
            { day: TODAY - 2, tier: 1, conversation: false },
          ],
        },
      },
    });
    const l = ledgerSummary(4);
    expect(l.hours.total).toBe(1.5);
    expect(l.goalHours).toBe(1500);
    expect(l.goalRatio).toBeCloseTo(1.5 / 1500, 8);
    expect(l.week).toEqual({ minutes: 60, targetHours: 3, ratio: 60 / 180 });
    expect(l.weeks.length).toBe(4);
    expect(l.weeks[3].total).toBe(90);
    expect(l.missions).toBe(2);
    expect(l.conversations).toBe(1);
  });
});
