/**
 * nemesis.ts — dossier → context → duel chain; defeat after 3 wins on 3 distinct days.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DRILL_IDS, type CardKey } from '../content/types';
import { V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { StepResult } from '../shared/session-types';
import { dayStartMs, epochDay } from '../shared/time';
import { CardFlag, type CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { isNemesis } from '../learn';
import { S } from './engine-strings';
import { DUEL_DRILL, afterDuel, dossierFor, duelsReady, nemesisItems, nemesisSteps, nemesisStepsAsync } from './nemesis';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const DUEL_IDX = DRILL_IDS.indexOf('nemesis-duel');

/** A Nemesis-flagged card whose flagging day (its `last`) was `daysAgo`. */
function nemesisCard(daysAgo: number, extra: Partial<{ lapses: number; s: number }> = {}): CardTuple {
  return card({ due: TODAY, s: extra.s ?? 1.5, d: 8, reps: 20, lapses: extra.lapses ?? 8, state: 2, last: TODAY - daysAgo, flags: CardFlag.nemesis });
}
function plain(s = 10): CardTuple {
  return card({ due: TODAY + 3, s, d: 5, reps: 8, lapses: 0, state: 2, last: TODAY - 1 });
}

function win(itemId: string, facet: string, day: number): void {
  store.log.push([dayStartMs(day, 'UTC') + 3_600_000, `${itemId}#${facet}` as CardKey, 3, 5000, DUEL_IDX, 0]);
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('phases', () => {
  it('day 0 is the dossier, days 1–13 are context only, from day 14 the duel', async () => {
    await makeTestStore({ cards: { [`${V.飲む}#prod`]: nemesisCard(0), [`${V.飲む}#rec`]: plain(), [`${V.飲む}#listen`]: plain() } });
    const [d] = nemesisItems(TODAY);
    expect(d).toMatchObject({ itemId: V.飲む, phase: 'dossier', next: null, wins: 0, line: S.nemesisDossier });
    const dossier = nemesisSteps(V.飲む, TODAY, { loader });
    expect(dossier).toHaveLength(1);
    expect(dossier[0]).toMatchObject({ exercise: DUEL_DRILL, block: 'weak', itemId: V.飲む, cardKey: `${V.飲む}#prod`, params: { phase: 1, pool: [`${V.飲む}#prod`] } });

    resetStoreForTests();
    await makeTestStore({ cards: { [`${V.飲む}#prod`]: nemesisCard(5), [`${V.飲む}#rec`]: plain() } });
    expect(nemesisItems(TODAY)[0]!.phase).toBe('context');
    expect(nemesisSteps(V.飲む, TODAY, { loader })).toEqual([]);

    resetStoreForTests();
    await makeTestStore({ cards: { [`${V.飲む}#prod`]: nemesisCard(14), [`${V.飲む}#rec`]: plain(), [`${V.飲む}#listen`]: plain() } });
    const [e] = nemesisItems(TODAY);
    expect(e!.phase).toBe('duel');
    expect(e!.next).toBe('prod');
    expect(e!.line).toBe(S.nemesisDuel);
    expect(duelsReady(TODAY).map((x) => x.itemId)).toEqual([V.飲む]);
  });

  it('an item without Nemesis cards has no steps; a defeated item reads none', async () => {
    await makeTestStore({ cards: { [`${V.水}#rec`]: plain() } });
    expect(nemesisItems(TODAY)).toEqual([]);
    expect(nemesisSteps(V.水, TODAY, { loader })).toEqual([]);
    expect(duelsReady(TODAY)).toEqual([]);
  });
});

describe('duel chain', () => {
  it('runs prod → listen → cloze filtered to the facets the item has, one win per day', async () => {
    await makeTestStore({ cards: { [`${V.飲む}#prod`]: nemesisCard(20), [`${V.飲む}#rec`]: plain(), [`${V.飲む}#listen`]: plain() } });
    const first = nemesisSteps(V.飲む, TODAY, { loader })[0]!;
    expect(first.cardKey).toBe(`${V.飲む}#prod`);
    expect(first.params.phase).toBe(3);
    expect(first.params.answer).toBe('飲む');
    expect(first.params.accept).toContain('のむ');
    expect(first.exercise).toBe(DUEL_DRILL);
    win(V.飲む, 'prod', TODAY - 2);
    const second = nemesisSteps(V.飲む, TODAY, { loader })[0]!;
    expect(second.cardKey).toBe(`${V.飲む}#listen`);
    expect(second.params.answer).toBe('to drink');
    win(V.飲む, 'listen', TODAY - 1);
    // no cloze facet on a vocab item: the chain wraps to prod
    const third = nemesisSteps(V.飲む, TODAY, { loader })[0]!;
    expect(third.cardKey).toBe(`${V.飲む}#prod`);
    expect(nemesisItems(TODAY)[0]!.wins).toBe(2);
    // a win today removes the item from today's ready list
    win(V.飲む, 'prod', TODAY);
    expect(duelsReady(TODAY)).toEqual([]);
  });

  it('a duel over a conjugated verb blanks the stem the sentence shows (findBlank), not [0, 0]', async () => {
    // 食べる never appears as its dictionary form in 「パンを食べます」; the shared blank finder lands on the stem 食べ.
    await makeTestStore({ cards: { [`${V.食べる}#prod`]: nemesisCard(20), [`${V.食べる}#rec`]: plain() } });
    const [s] = nemesisSteps(V.食べる, TODAY, { loader });
    expect(s!.cardKey).toBe(`${V.食べる}#prod`);
    expect(s!.params.sentence).toBe('パンを食べます。');
    expect(s!.params.blank).toEqual([3, 5]);
    expect(s!.params.answer).toBe('食べる');
  });

  it('the async variant resolves full params through the builder', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: { [`${V.飲む}#prod`]: nemesisCard(20), [`${V.飲む}#rec`]: plain() } });
    const [s] = await nemesisStepsAsync(V.飲む, TODAY, loader);
    expect(s!.cardKey).toBe(`${V.飲む}#prod`);
    expect(s!.params.candidates).toContain('飲む');
    // prompts rotate between the word's examples and story lines that carry it
    expect(s!.params.sentence).toMatch(/飲/);
    expect(s!.params.blank![1]).toBeGreaterThan(s!.params.blank![0]!);
    expect(s!.params.pool).toEqual([`${V.飲む}#prod`]);
  });
});

describe('afterDuel', () => {
  const ok = (stepId: string): StepResult => ({ stepId, cardKey: `${V.飲む}#prod`, rating: 3, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 0, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 3000, errorTags: [] });

  it('three wins on one day count once; three distinct days defeat the Nemesis and emit nemesis:defeated', async () => {
    await makeTestStore({ cards: { [`${V.飲む}#prod`]: nemesisCard(20), [`${V.飲む}#rec`]: plain(), [`${V.飲む}#listen`]: plain() } });
    const cap = captureEvents();
    win(V.飲む, 'prod', TODAY);
    win(V.飲む, 'listen', TODAY);
    win(V.飲む, 'prod', TODAY);
    const sameDay = afterDuel(V.飲む, [ok('d1')], TODAY);
    expect(sameDay).toMatchObject({ defeated: false, wins: 1, wonToday: true, next: 'listen' });
    expect(isNemesis(store.cards.get(`${V.飲む}#prod`)!)).toBe(true);
    win(V.飲む, 'listen', TODAY - 1);
    expect(afterDuel(V.飲む, [], TODAY).wins).toBe(2);
    win(V.飲む, 'prod', TODAY - 3);
    const done = afterDuel(V.飲む, [ok('d3')], TODAY);
    expect(done).toMatchObject({ defeated: true, wins: 3, next: null });
    const c = store.cards.get(`${V.飲む}#prod`)!;
    expect(isNemesis(c)).toBe(false);
    expect(c[1]).toBe(3);
    expect(c[4]).toBe(0);
    expect(cap.events.filter((e) => e[0] === 'nemesis:defeated')).toEqual([['nemesis:defeated', { itemId: V.飲む }]]);
    expect(nemesisItems(TODAY)).toEqual([]);
    // a second call changes nothing
    expect(afterDuel(V.飲む, [], TODAY).defeated).toBe(false);
    cap.stop();
  });

  it('a lost duel does not count', async () => {
    await makeTestStore({ cards: { [`${V.飲む}#prod`]: nemesisCard(20), [`${V.飲む}#rec`]: plain() } });
    store.log.push([DEFAULT_TEST_NOW, `${V.飲む}#prod`, 1, 5000, DUEL_IDX, 0]);
    expect(afterDuel(V.飲む, [], TODAY)).toMatchObject({ defeated: false, wins: 0, wonToday: false });
  });
});

describe('dossier', () => {
  it('shows the confusable side by side, the kanji behind the word and extra sentences', () => {
    const d = dossierFor(V.飲む, loader, [loader.get('s-04-1') as never])!;
    expect(d.head).toBe('飲む');
    expect(d.kana).toBe('のむ');
    expect(d.components).toEqual(['j-飲']);
    expect(d.confusable && 'word' in d.confusable ? d.confusable.word : null).toBe('食べる');
    expect(d.sentences.length).toBeGreaterThan(0);
    expect(d.sentences.length).toBeLessThanOrEqual(3);
    const k = dossierFor('j-飲', loader)!;
    expect(k.components).toEqual(['eat', 'yawn']);
    expect(k.mnemonic).toContain('DRINK');
    const g = dossierFor('g-n5-001', loader)!;
    expect(g.head).toBe('〜です');
    expect(g.confusable && 'pattern' in g.confusable ? g.confusable.pattern : null).toBe('〜は');
    expect(dossierFor('m-04-1', loader)).toBeNull();
    expect(dossierFor('v-n5-9999', loader)).toBeNull();
  });
});
