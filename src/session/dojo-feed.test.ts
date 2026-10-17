/**
 * dojo-feed.ts — the home screen's one line and its company.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import { FIXTURE_IDS, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import { SESSION_SCHEMA, type SessionPlan } from '../shared/session-types';
import { epochDay, weekOf } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { kiaiInit } from '../learn';
import { S } from './engine-strings';
import { loadPlanContext } from './builder';
import { dojoFeed, forecastLine, resumeInfo, sentenceOfDay, welcomeState } from './dojo-feed';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

function live(s: number, due = TODAY): CardTuple {
  return card({ due, s, d: 5, reps: 8, lapses: 0, state: 2, last: TODAY - 1 });
}

/** Station-4 vocab at Brown (rec S 40, prod S 10), kanji and grammar Green, due in the future. */
function brownVocab(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of STATION_4.vocabIds) {
    out[`${id}#rec`] = live(40, TODAY + 10);
    out[`${id}#prod`] = live(10, TODAY + 5);
  }
  for (const id of STATION_4.kanjiIds) out[`${id}#comp`] = live(8, TODAY + 5);
  for (const id of STATION_4.grammarIds) out[`${id}#cloze`] = live(8, TODAY + 5);
  return out;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('forecastLine', () => {
  it('reads like the design: "42 reviews · 1 scroll · 1 episode · ~18 min"', () => {
    expect(forecastLine(42, 1, 1, 18)).toBe('42 reviews · 1 scroll · 1 episode · ~18 min');
    expect(forecastLine(1, 2, 0, 3.4)).toBe('1 review · 2 scrolls · ~3 min');
    expect(forecastLine(0, 0, 1, 7)).toBe('0 reviews · 1 episode · ~7 min');
    expect(forecastLine(0, 0, 0, 0)).toBe(S.forecastRest);
    expect(forecastLine(5, 0, 0, 0.2)).toBe('5 reviews · ~1 min');
  });
});

describe('sentenceOfDay', () => {
  it('is deterministic per day and drawn from Brown items with examples', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: brownVocab() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const a = sentenceOfDay(ctx, TODAY)!;
    const b = sentenceOfDay(ctx, TODAY)!;
    expect(a).toEqual(b);
    const brownExamples = STATION_4.vocabIds.flatMap((id) => (loader.get(id) as { examples: { ja: string }[] }).examples.map((e) => e.ja));
    expect(brownExamples).toContain(a.ja);
    const week = new Set(Array.from({ length: 7 }, (_, i) => sentenceOfDay(ctx, TODAY + i)!.ja));
    expect(week.size).toBeGreaterThan(1);
  });

  it('falls back to Green items and to nothing', async () => {
    const cards: Record<CardKey, CardTuple> = { [`${V.犬}#rec`]: live(8, TODAY + 3) };
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(sentenceOfDay(ctx)!.ja).toBe((loader.get(V.犬) as { examples: { ja: string }[] }).examples[0]!.ja);
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 4 } } });
    const empty = await loadPlanContext({ loader, station: 4 });
    expect(sentenceOfDay(empty)).toBeUndefined();
  });
});

describe('welcome and resume', () => {
  it('welcome is comeback when a Welcome Back set is owed, mountain after 7+ days away, else none', async () => {
    await makeTestStore({ save: { progress: { welcomeBackDue: true, awayDays: 40 } } });
    expect(welcomeState()).toBe('comeback');
    store.patch('progress', (p) => ({ ...p, welcomeBackDue: false }));
    expect(welcomeState()).toBe('mountain');
    store.patch('progress', (p) => ({ ...p, awayDays: 3 }));
    expect(welcomeState()).toBe('none');
  });

  it('resume reports the reps left of a saved session, nothing when it is spent', async () => {
    await makeTestStore();
    expect(resumeInfo()).toBeUndefined();
    const plan: SessionPlan = { id: 'p', mode: 'kata', day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 4, steps: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, block: 'reviews', exercise: 'meaning-recall', itemId: null, cardKey: null, params: {}, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 0 })), blocks: [], meta: { dueTotal: 5, dueTaken: 5, backlog: false, newCount: 0, scrollIds: [] } };
    store.session.save({ schema: SESSION_SCHEMA, plan, cursor: 2, results: [], kiai: kiaiInit() });
    expect(resumeInfo()).toEqual({ stepsLeft: 3 });
    store.session.save({ schema: SESSION_SCHEMA, plan, cursor: 5, results: [], kiai: kiaiInit() });
    expect(resumeInfo()).toBeUndefined();
  });
});

describe('dojoFeed', () => {
  it('assembles the forecast, minutes, milestone, quests, flame, Kage, gate and teaser', async () => {
    const cards = brownVocab();
    for (const id of [V.人, V.日]) cards[`${id}#rec`] = live(40, TODAY);
    await makeTestStore({ save: { progress: { station: 4, welcomeBackDue: true }, quests: { day: TODAY, ids: ['clear-due', 'read-episode', 'shadow-five'], done: ['clear-due'] }, streak: { current: 3, totalDays: 12, lastDay: TODAY } }, cards });
    const feed = await dojoFeed({ loader });
    expect(feed.due).toBe(2);
    expect(feed.forecastLine.startsWith('2 reviews')).toBe(true);
    expect(feed.forecastLine).toContain('~');
    expect(feed.minutes.kata).toBeGreaterThanOrEqual(0);
    expect(feed.minutes.shugyo).toBeGreaterThan(feed.minutes.kata);
    expect(feed.welcome).toBe('comeback');
    expect(feed.quests).toEqual([
      { id: 'clear-due', done: true },
      { id: 'read-episode', done: false },
      { id: 'shadow-five', done: false },
    ]);
    expect(feed.flame).toBe('lit');
    expect(feed.streak).toEqual({ current: 3, totalDays: 12 });
    expect(feed.kage.due).toBe(true);
    expect(feed.kage.week).toBe(weekOf(TODAY));
    expect(feed.nemesis).toEqual({ count: 0, itemIds: [], line: null });
    expect(feed.gate).toMatchObject({ station: 4, cleared: false, total: 14, introduced: 14, green: 14, ready: true });
    expect(feed.nextMilestone).toContain('ready');
    expect(feed.shinsa).toBeNull();
    expect(feed.backlog).toBe(false);
    expect(feed.backlogLine).toBeNull();
    expect(feed.nextMilestone.length).toBeGreaterThan(0);
    expect(feed.sentenceOfDay?.ja).toBeTruthy();
    expect(feed.sentenceOfDay?.kana).toMatch(/^[ぁ-ゖァ-ヺー・、。！？「」]+$/u);
    expect(feed.teaser?.words.length).toBeGreaterThan(0);
    expect(S.omikuji).toContain(feed.proverb);
    expect(feed.episodes).toBe(0);
    expect(feed.resume).toBeUndefined();
  });

  it('a Nemesis duel ready today is called out; a backlog day carries the honest line', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of FIXTURE_IDS.vocab) if (id !== V.おはよう && id !== V.はい) cards[`${id}#rec`] = live(5);
    cards[`${V.飲む}#prod`] = card({ due: TODAY, s: 1, d: 8, reps: 20, lapses: 8, state: 2, last: TODAY - 20, flags: 2 });
    await makeTestStore({ save: { progress: { station: 4 }, settings: { intensity: 'custom', maxReviews: 4 } }, cards });
    const feed = await dojoFeed({ loader, teaser: false });
    expect(feed.nemesis.count).toBe(1);
    expect(feed.nemesis.itemIds).toEqual([V.飲む]);
    expect(feed.nemesis.line).toBe('1 Nemesis duel ready');
    expect(feed.backlog).toBe(true);
    expect(feed.backlogLine).toBe(`The gatekeeper holds the line. 4 of your ${Object.keys(cards).length} reviews today; the rest wait without penalty.`);
    expect(feed.scrolls).toBe(0);
    expect(feed.teaser).toBeUndefined();
  });

  it('on a belt’s last station the Shinsa eligibility is reported', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4] } } });
    const feed = await dojoFeed({ loader, teaser: false });
    expect(feed.shinsa?.belt).toBe('yellow');
    expect(feed.shinsa?.eligibility.eligible).toBe(false);
    expect(feed.shinsa?.eligibility.reasons.length).toBeGreaterThan(0);
    expect(feed.gate).toBeNull();
  });
});
