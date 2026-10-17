/**
 * dan.ts — criteria tables (design 02 §3) and the 10-minute gauntlet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey, DrillId } from '../content/types';
import { FIXTURE_IDS, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple, SaveMeta } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore, testSave } from '../store/testing';
import { DAN_MODULES, JUDAN_DAYS, JUDAN_HOURS, MAX_DAN, buildGauntlet, danModuleFor, danProgress, danTitle, gauntletOutputKind, ledgerHoursOf, nextDanReady, promoteDan } from './dan';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

function meta(o: { stats?: Partial<SaveMeta['stats']>; hours?: number; days?: number; dan?: number; kageWins?: number } = {}): SaveMeta {
  const m = testSave();
  Object.assign(m.stats, o.stats ?? {});
  if (o.hours !== undefined) m.ledger.entries = [[TODAY, Math.round(o.hours * 60), 0, 1]];
  if (o.days !== undefined) m.streak.totalDays = o.days;
  if (o.dan !== undefined) m.profile.dan = o.dan;
  if (o.kageWins !== undefined) m.kage.wins = o.kageWins;
  return m;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('criteria tables', () => {
  it('lists 二段 … 五段 with the design’s thresholds', () => {
    expect(DAN_MODULES.map((m) => m.dan)).toEqual([2, 3, 4, 5]);
    const fresh = danProgress(testSave());
    expect(fresh.map((p) => p.dan)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(fresh.every((p) => !p.ready && p.criteria.every((c) => !c.ok))).toBe(true);
    const nidan = fresh[0]!;
    expect(nidan.criteria.map((c) => c.target)).toEqual([90, 80, 100]);
    expect(nidan.criteria[0]!.label).toMatch(/90 percent over the last 60/);
  });

  it('二段: register accuracy ≥ 90 % over 60, 20 role-plays ≥ 80 % best, ledger ≥ 100 h', () => {
    const m = meta({ stats: { threeWays: 60, threeWaysCorrect: 54, rolePlays: 20, rolePlaysAllBest: 16 }, hours: 100, dan: 1 });
    const p = danProgress(m)[0]!;
    expect(p.ready).toBe(true);
    expect(p.criteria.map((c) => c.now)).toEqual([90, 80, 100]);
    expect(nextDanReady(m)).toBe(2);
    const short = meta({ stats: { threeWays: 59, threeWaysCorrect: 59, rolePlays: 20, rolePlaysAllBest: 16 }, hours: 100, dan: 1 });
    expect(danProgress(short)[0]!.criteria[0]!.ok).toBe(false);
    expect(nextDanReady(short)).toBeNull();
  });

  it('三段 and 四段 read role-play aizuchi, episodes, monologues, fast listening and shadow lines', () => {
    const sandan = meta({ stats: { rolePlays: 30, rolePlaysAizuchi: 26, episodesRead: 50 }, hours: 250, dan: 2 });
    expect(danProgress(sandan)[1]!.ready).toBe(true);
    expect(nextDanReady(sandan)).toBe(3);
    const yondan = meta({ stats: { monologues: 30, monologueBestWords: 100, listeningFastPasses: 20, shadowLines: 500 }, hours: 450, dan: 3 });
    expect(danProgress(yondan)[2]!.ready).toBe(true);
    expect(danProgress(yondan)[2]!.criteria).toHaveLength(5);
    const godan = meta({ stats: { vocabBrown: 4000, speedReadBestCpm: 450 }, hours: 1000, dan: 4 });
    expect(danProgress(godan)[3]!.ready).toBe(true);
  });

  it('六段+ needs 300 ledger hours and 100 training days per dan plus Kage wins; 十段 is 1,000 days + 1,500 h', () => {
    const roku = danModuleFor(6)!;
    expect(roku.criteria.map((c) => c.check(meta({ hours: 1300, days: 100, kageWins: 10 })).ok)).toEqual([true, true, true]);
    expect(roku.criteria[0]!.check(meta({ hours: 1299 })).ok).toBe(false);
    const nana = danModuleFor(7)!;
    expect(nana.criteria[0]!.check(meta({ hours: 1600 })).target).toBe(1600);
    expect(nana.criteria[1]!.check(meta({ days: 200 })).ok).toBe(true);
    const judan = danModuleFor(MAX_DAN)!;
    expect(judan.criteria.map((c) => c.check(meta({ days: JUDAN_DAYS, hours: JUDAN_HOURS })).ok)).toEqual([true, true]);
    expect(judan.criteria[0]!.check(meta({ days: 999 })).ok).toBe(false);
    expect(danModuleFor(1)).toBeNull();
    expect(danModuleFor(11)).toBeNull();
    expect(danTitle(10)).toContain('十段');
  });

  it('ledger hours sum entries and monthly aggregates', () => {
    const m = testSave();
    m.ledger.entries = [[TODAY, 30, 0, 1], [TODAY - 1, 90, 1, 0]];
    m.ledger.monthly = { '2025-01': 120 };
    expect(ledgerHoursOf(m)).toBe(4);
  });

  it('promoteDan applies only the next rank whose criteria hold', async () => {
    await makeTestStore({ save: { profile: { dan: 1 }, stats: { threeWays: 60, threeWaysCorrect: 54, rolePlays: 20, rolePlaysAllBest: 16 }, ledger: { entries: [[TODAY, 6000, 0, 1]] } } });
    expect(promoteDan(3)).toBe(false);
    expect(promoteDan(2)).toBe(true);
    expect(store.profile.value.dan).toBe(2);
    expect(promoteDan(2)).toBe(false);
    expect(promoteDan(3)).toBe(false);
  });
});

describe('buildGauntlet', () => {
  function cards(): Record<CardKey, CardTuple> {
    const out: Record<CardKey, CardTuple> = {};
    for (const id of FIXTURE_IDS.vocab) if (id !== V.おはよう && id !== V.はい) {
      out[`${id}#rec`] = card({ due: TODAY + 20, s: 60, d: 4, reps: 20, lapses: 0, state: 2, last: TODAY - 1 });
      out[`${id}#prod`] = card({ due: TODAY + 20, s: 30, d: 4, reps: 12, lapses: 0, state: 2, last: TODAY - 1 });
    }
    for (const id of STATION_4.kanjiIds) out[`${id}#comp`] = card({ due: TODAY + 20, s: 60, d: 4, reps: 20, lapses: 0, state: 2, last: TODAY - 1 });
    for (const id of STATION_4.grammarIds) out[`${id}#cloze`] = card({ due: TODAY + 20, s: 60, d: 4, reps: 20, lapses: 0, state: 2, last: TODAY - 1 });
    return out;
  }

  it('is a 10-minute plan over input, production and output using only available drills', async () => {
    await makeTestStore({ save: { progress: { station: 53 }, profile: { dan: 1, belt: 'black' }, captured: [V.飲む, V.食べる] }, cards: cards() });
    const available = new Set<DrillId>(['story-read', 'production-forge', 'pattern-cloze', 'say-three-ways', 'shadow', 'kanji-read']);
    const plan = await buildGauntlet(2, 1, { loader, available: (id) => available.has(id) });
    expect(plan.mode).toBe('dan');
    expect(plan.blocks.reduce((a, b) => a + b.estMinutes, 0)).toBe(10);
    expect(plan.blocks.map((b) => b.kind)).toEqual(['input', 'reviews', 'output']);
    expect(plan.steps.every((s) => available.has(s.exercise))).toBe(true);
    const form = plan.steps.filter((s) => s.block === 'reviews');
    expect(form.slice(0, 2).map((s) => s.cardKey)).toEqual([`${V.飲む}#prod`, `${V.食べる}#prod`]);
    expect(form.every((s) => s.params.choices === undefined)).toBe(true);
    expect(plan.steps.find((s) => s.block === 'input')!.exercise).toBe('story-read');
    expect(plan.steps.find((s) => s.block === 'output')!.exercise).toBe('say-three-ways');
    expect(plan.meta.storyId).toBeDefined();
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(plan.steps.length);
  });

  it('falls back to a shadow set when the module’s output drill is missing, and drops blocks with nothing available', async () => {
    await makeTestStore({ save: { progress: { station: 53 }, profile: { dan: 3, belt: 'black' } }, cards: cards() });
    const plan = await buildGauntlet(4, 2, { loader, available: (id) => id === 'shadow' || id === 'production-forge' });
    expect(plan.blocks.map((b) => b.kind)).toEqual(['reviews', 'output']);
    expect(plan.steps.filter((s) => s.block === 'output').every((s) => s.exercise === 'shadow')).toBe(true);
    const none = await buildGauntlet(5, 3, { loader, available: () => false });
    expect(none.steps).toHaveLength(0);
  });

  it('output kinds follow the module and rotate past 五段', () => {
    expect(gauntletOutputKind(2, 0)).toBe('three-ways');
    expect(gauntletOutputKind(3, 0)).toBe('role-play');
    expect(gauntletOutputKind(4, 0)).toBe('monologue');
    expect(gauntletOutputKind(5, 0)).toBe('writing');
    expect(new Set([0, 1, 2, 3, 4].map((r) => gauntletOutputKind(6, r))).size).toBe(5);
  });
});
