/**
 * builder.ts — the Grudge List block on the day of a lost fight (design 04 §11) and the
 * re-routing of untestable steps (empty Form Forge, one-tile Scramble, timed self-graded drills).
 * Split from builder.test.ts to keep that file readable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey, GrammarItem } from '../content/types';
import { FIXTURE, FIXTURE_IDS, G, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import type { QueueCard } from '../learn';
import { GRUDGE_BLOCK_REPS, buildPlan, grudgeBlockSteps, loadPlanContext, makeStep, resolveParams, stepForCard } from './builder';
import { S as ES } from './engine-strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

/** A reviewed card due today (builder.test pattern). */
function due(s = 5): CardTuple {
  return card({ due: TODAY, s, d: 5, reps: 6, lapses: 0, state: 2, last: TODAY - 1, flags: 0 });
}

/** Base-facet cards for every fixture item. */
function allCards(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of FIXTURE_IDS.vocab) out[`${id}#${id === V.おはよう || id === V.はい ? 'prod' : 'rec'}`] = due();
  for (const id of FIXTURE_IDS.kanji) out[`${id}#comp`] = due();
  for (const id of FIXTURE_IDS.grammar) out[`${id}#cloze`] = due();
  for (const id of FIXTURE_IDS.component) out[`${id}#rec`] = due();
  return out;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('Grudge List block (design 04 §11 same-day rematch)', () => {
  const grudge = (): CardKey[] => [`${V.犬}#rec`, `${V.水}#rec`, `${V.人}#rec`, `${V.日}#rec`, `${G.です}#cloze`];

  it('on the day of a lost fight a Kata / Kumite / Shugyō opens with the Grudge cards, held out of the review draws', async () => {
    await makeTestStore({ save: { progress: { station: 4, gateAttempts: { 4: 1 }, gateAttemptDay: { 4: TODAY }, grudge: grudge() } }, cards: allCards() });
    for (const mode of ['kata', 'kumite', 'shugyo'] as const) {
      const plan = await buildPlan(mode, { loader, available: all });
      const block = plan.blocks.find((b) => b.label === ES.blockGrudge);
      expect(block, mode).toBeDefined();
      expect(block!.kind).toBe('weak');
      expect(plan.blocks[0]).toBe(block);
      const steps = plan.steps.filter((s) => block!.stepIds.includes(s.id));
      expect(steps).toHaveLength(Math.min(GRUDGE_BLOCK_REPS, grudge().length));
      expect(steps.every((s) => s.cardKey !== null && grudge().includes(s.cardKey))).toBe(true);
      const elsewhere = plan.steps.filter((s) => !block!.stepIds.includes(s.id) && s.cardKey !== null && grudge().includes(s.cardKey));
      expect(elsewhere, mode).toHaveLength(0);
    }
  });

  it('no block on another day, after the station is cleared, or with an empty / malformed list', async () => {
    await makeTestStore({ save: { progress: { station: 4, gateAttempts: { 4: 1 }, gateAttemptDay: { 4: TODAY - 1 }, grudge: grudge() } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4, available: all });
    expect(grudgeBlockSteps(ctx)).toEqual([]);
    store.patch('progress', (p) => ({ ...p, gateAttemptDay: { 4: TODAY }, stationsCleared: [4] }));
    expect(grudgeBlockSteps(ctx)).toEqual([]);
    store.patch('progress', (p) => ({ ...p, stationsCleared: [], grudge: ['not-a-key' as CardKey] }));
    expect(grudgeBlockSteps(ctx)).toEqual([]);
    store.patch('progress', (p) => ({ ...p, grudge: grudge() }));
    expect(grudgeBlockSteps(ctx)).toHaveLength(grudge().length);
    const kata = await buildPlan('kata', { loader, available: all });
    expect(kata.blocks[0]!.label).toBe(ES.blockGrudge);
  });
});

describe('untestable steps are re-routed (design 04 §4)', () => {
  const masu = loader.get<GrammarItem>(G.ます)!;
  const qc = (id: string): QueueCard => ({ cardKey: `${id}#prod`, itemId: id, kind: 'grammar', facet: 'prod', r: 0.9, mature: false, exposures: 6 });

  it('an adjective-only point drills an adjective; without one in the pool the step becomes cloze, never an empty Form Forge', async () => {
    const adjOnly = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [G.ます]: { ...masu, unlocksForms: ['adj-neg'] } } });
    await makeTestStore({ save: { progress: { station: 10 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader: adjOnly, station: 10, available: all });
    const forge = stepForCard(ctx, qc(G.ます), 'reviews', { exercise: 'form-forge' })!;
    expect(forge.exercise).toBe('form-forge');
    expect(forge.params.targetForm).toBe('adj-neg');
    expect(forge.params.pos).toBe('adj-i');
    expect(forge.params.sentence).toBe('おいしい');
    expect(forge.params.answer).toBe('おいしくない');
    const noAdj = { ...ctx, vocabPool: ctx.vocabPool.filter((v) => v.pos !== 'adj-i' && v.pos !== 'adj-na') };
    expect(resolveParams(noAdj, 'form-forge', adjOnly.get(G.ます)!, { rep: 0 })).toEqual({});
    expect(stepForCard(noAdj, qc(G.ます), 'reviews', { exercise: 'form-forge' })!.exercise).toBe('pattern-cloze');
    expect(stepForCard(noAdj, qc(G.ます), 'reviews', { exercise: 'form-chain' })!.exercise).toBe('pattern-cloze');
    expect(stepForCard({ ...noAdj, station: 16 }, qc(G.ます), 'reviews', { exercise: 'form-forge' })!.exercise).toBe('transform');
  });

  it('a Scramble with one movable tile becomes cloze', async () => {
    const desu = loader.get<GrammarItem>(G.です)!;
    const oneTile = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [G.です]: { ...desu, examples: [{ ja: 'はい。', kana: 'はい。', en: 'Yes.' }] } } });
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader: oneTile, station: 4, available: all });
    const plain = { ...ctx, stories: [] };
    expect(stepForCard(plain, { ...qc(G.です), facet: 'cloze', cardKey: `${G.です}#cloze` }, 'reviews', { exercise: 'scramble' })!.exercise).toBe('pattern-cloze');
    const real = await loadPlanContext({ loader, station: 4, available: all });
    expect(stepForCard({ ...real, stories: [] }, { ...qc(G.です), facet: 'cloze', cardKey: `${G.です}#cloze` }, 'reviews', { exercise: 'scramble' })!.exercise).toBe('scramble');
  });

  it('makeStep never puts a hard timer on a self-graded drill', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4, available: all });
    const shadow = makeStep(ctx, { block: 'phase', exercise: 'shadow', itemId: V.おはよう, cardKey: `${V.おはよう}#prod`, params: {}, timed: true, timerMs: 12_000 });
    expect(shadow.timed).toBe(false);
    expect(shadow.timerMs).toBeUndefined();
    const forge = makeStep(ctx, { block: 'phase', exercise: 'production-forge', itemId: V.水, cardKey: `${V.水}#prod`, params: {}, timed: true, timerMs: 12_000 });
    expect(forge.timed).toBe(true);
    expect(forge.timerMs).toBe(12_000);
  });
});
