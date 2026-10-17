/**
 * builder.ts — plans over the fixture corpus and a test store (design 03 §2.4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey, Facet } from '../content/types';
import { FIXTURE_IDS, G, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { SessionPlan, Step } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { interleaveViolations, type QueueCard } from '../learn';
import { isIntroCheck, isPretestStep } from './scroll';
import { MICHIKUSA_AFTER_REP } from './blocks';
import { accuracy7, buildPlan, itemKindOf, loadPlanContext, michikusaFor, pickStories, pitchPattern, resolveParams, storyCoverage } from './builder';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

/** A reviewed card due today (R ≈ 0.98 after one day at S 5). */
function due(s = 5, extra: Partial<{ reps: number; last: number; due: number; flags: number }> = {}): CardTuple {
  return card({ due: extra.due ?? TODAY, s, d: 5, reps: extra.reps ?? 6, lapses: 0, state: 2, last: extra.last ?? TODAY - 1, flags: extra.flags ?? 0 });
}

/** Base-facet cards for every fixture item (vocab rec, chunk prod, kanji comp, grammar cloze, component rec, kana rec). */
function allCards(o: { kana?: boolean; s?: number } = {}): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  const s = o.s ?? 5;
  for (const id of FIXTURE_IDS.vocab) out[`${id}#${id === V.おはよう || id === V.はい ? 'prod' : 'rec'}`] = due(s);
  for (const id of FIXTURE_IDS.kanji) out[`${id}#comp`] = due(s);
  for (const id of FIXTURE_IDS.grammar) out[`${id}#cloze`] = due(s);
  for (const id of FIXTURE_IDS.component) out[`${id}#rec`] = due(s);
  if (o.kana) for (const id of FIXTURE_IDS.kana) out[`${id}#rec`] = due(s);
  return out;
}

function toQueue(steps: Step[]): QueueCard[] {
  return steps
    .filter((s) => s.cardKey !== null)
    .map((s) => {
      const [itemId, facet] = (s.cardKey as string).split('#') as [string, Facet];
      const qc: QueueCard = { cardKey: s.cardKey as CardKey, itemId, kind: itemKindOf(itemId, loader.get(itemId)) ?? 'vocab', facet, r: 0, mature: false, exposures: s.exposures, exercise: s.exercise };
      if (s.stepTag) qc.tag = s.stepTag;
      return qc;
    });
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('buildPlan — Kata', () => {
  it('reviews only, one Michikusa between reps 8 and 9, all ids unique', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('kata', { loader, available: all });
    expect(plan.mode).toBe('kata');
    expect(plan.station).toBe(4);
    const kinds = new Set(plan.blocks.map((b) => b.kind));
    expect(kinds).toEqual(new Set(['reviews']));
    const michikusa = plan.steps.filter((s) => s.block === 'michikusa');
    expect(michikusa).toHaveLength(1);
    expect(plan.steps.indexOf(michikusa[0]!)).toBe(MICHIKUSA_AFTER_REP);
    expect(plan.meta.michikusaId).toBe(michikusa[0]!.params.michikusaId);
    expect(FIXTURE_IDS.michikusa).toContain(plan.meta.michikusaId);
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(plan.steps.length);
    expect(plan.steps.filter((s) => s.block === 'reviews').length).toBeGreaterThanOrEqual(15);
    expect(plan.steps.filter((s) => s.block === 'reviews').every((s) => !s.isNew && s.stepTag === null)).toBe(true);
    expect(michikusa[0]!.isNew).toBe(true);
  });

  it('satisfies the composer invariants: no item within 4 reps, ≤ 3 same type, wave opens easy', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards({ kana: true }) });
    const plan = await buildPlan('kata', { loader, available: all });
    const reviews = plan.steps.filter((s) => s.block === 'reviews');
    expect(interleaveViolations(toQueue(reviews))).toBe(0);
    expect(reviews.length).toBe(25);
    expect(plan.meta.dueTaken).toBe(25);
    expect(plan.meta.dueTotal).toBe(Object.keys(allCards({ kana: true })).length);
  });

  it('is deterministic: the same store yields the same plan', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const a = await buildPlan('kata', { loader, available: all });
    const b = await buildPlan('kata', { loader, available: all });
    expect(JSON.stringify(a.steps)).toBe(JSON.stringify(b.steps));
    expect(a.id).toBe(b.id);
    const c = await buildPlan('kata', { loader, available: all, seed: 7 });
    expect(c.id).not.toBe(a.id);
  });

  it('skips cards whose drill (and fallbacks) are not registered', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('kata', { loader, available: (id) => id !== 'meaning-recall' && id !== 'meaning-guard' && id !== 'meaning-judge' });
    expect(plan.steps.some((s) => s.cardKey?.endsWith('#rec') && s.cardKey.startsWith('v-'))).toBe(false);
    expect(plan.steps.some((s) => s.exercise === 'component-assembly')).toBe(true);
    const none = await buildPlan('kata', { loader, available: () => false });
    expect(none.steps.filter((s) => s.block === 'reviews')).toHaveLength(0);
  });

  it('backlog mode caps reviews at the belt cap and sets meta.backlog', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, settings: { intensity: 'custom', maxReviews: 4 } }, cards: allCards() });
    const plan = await buildPlan('kata', { loader, available: all });
    expect(plan.meta.backlog).toBe(true);
    expect(plan.meta.dueTaken).toBeLessThanOrEqual(4);
    expect(plan.steps.filter((s) => s.block === 'reviews')).toHaveLength(4);
    expect(plan.meta.dueTotal).toBe(Object.keys(allCards()).length);
  });

  it('resolves typed params for mature cards and choices for first exposures', async () => {
    const cards = allCards();
    cards[`${V.水}#rec`] = due(5, { reps: 0 });
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildPlan('kata', { loader, available: all });
    const mizu = plan.steps.find((s) => s.cardKey === `${V.水}#rec`)!;
    expect(mizu.exercise).toBe('meaning-guard');
    expect(mizu.params.choices).toHaveLength(4);
    expect(mizu.params.choices).toContain('water');
    const inu = plan.steps.find((s) => s.cardKey === `${V.犬}#rec`)!;
    expect(inu.exercise).toBe('meaning-recall');
    expect(inu.params.answer).toBe('dog');
    const grammar = plan.steps.find((s) => s.cardKey === `${G.です}#cloze`)!;
    expect(grammar.exercise).toBe('pattern-cloze');
    expect(grammar.params.answer).toBe('です');
    expect(grammar.params.sentence).toContain('です');
    expect(grammar.params.blank![1]! - grammar.params.blank![0]!).toBe(2);
    const kanji = plan.steps.find((s) => s.cardKey === 'j-飲#comp')!;
    expect(kanji.params.answers).toEqual(['食', '欠']);
    expect(kanji.params.tiles).toContain('食');
  });

  it('includes an untimed recheck step for an arcade miss and clears nothing else', async () => {
    const cards = allCards();
    cards[`${V.人}#rec`] = due(20, { due: TODAY + 30, flags: 16 });
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildPlan('kata', { loader, available: all });
    const re = plan.steps.find((s) => s.cardKey === `${V.人}#rec`)!;
    expect(re.params.recheck).toBe(true);
    expect(re.timed).toBe(false);
  });
});

describe('buildPlan — Kumite and Shugyō', () => {
  it('Kumite: warm-up, Scrolls with pretests and intro checks, sparring with ≥ 2 listen, output, cooldown', async () => {
    const cards = allCards();
    for (const id of FIXTURE_IDS.grammar) delete cards[`${id}#cloze`];
    for (const id of FIXTURE_IDS.component) delete cards[`${id}#rec`];
    for (const id of STATION_4.vocabIds) cards[`${id}#listen`] = due(3);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildPlan('kumite', { loader, available: all });
    const kinds = plan.blocks.map((b) => b.kind);
    expect(kinds[0]).toBe('warmup');
    expect(kinds).toContain('scroll');
    expect(kinds).toContain('sparring');
    expect(kinds).toContain('michikusa');
    expect(kinds).toContain('cooldown');
    expect(plan.meta.scrollIds.length).toBeGreaterThanOrEqual(1);
    expect(plan.meta.scrollIds.length).toBeLessThanOrEqual(2);
    const scrollSteps = plan.steps.filter((s) => s.block === 'scroll');
    const pre = scrollSteps.filter(isPretestStep);
    const checks = scrollSteps.filter(isIntroCheck);
    expect(checks.length).toBe(plan.meta.newCount);
    expect(checks.every((s) => s.isNew && s.stepTag === 'intro' && s.exposures === 0)).toBe(true);
    expect(pre.length).toBeLessThanOrEqual(3 * plan.meta.scrollIds.length);
    expect(pre.every((s) => s.isNew && s.stepTag === null)).toBe(true);
    for (const id of plan.meta.scrollIds) expect(checks.some((s) => s.params.scrollId === id)).toBe(true);
    const sparring = plan.steps.filter((s) => s.block === 'sparring');
    expect(sparring.length).toBeGreaterThanOrEqual(5);
    expect(sparring.filter((s) => s.cardKey?.endsWith('#listen')).length).toBeGreaterThanOrEqual(2);
    expect(interleaveViolations(toQueue(sparring))).toBe(0);
    const taken = new Set(plan.steps.filter((s) => s.cardKey && !s.isNew).map((s) => s.cardKey));
    expect(taken.size).toBe(plan.steps.filter((s) => s.cardKey && !s.isNew).length);
  });

  it('Kumite output is a shadow set over known sentences when stories are covered', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('kumite', { loader, available: all });
    const output = plan.steps.filter((s) => s.block === 'output');
    expect(output.length).toBeGreaterThan(0);
    expect(output.every((s) => s.exercise === 'shadow')).toBe(true);
    expect(output[0]!.params.sentence).toBeTruthy();
    expect(output[0]!.params.rate).toBeGreaterThan(0);
  });

  it('Shugyō: input picks a covered story, output rotates, no block repeats a due card', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan = await buildPlan('shugyo', { loader, available: all });
    const input = plan.steps.filter((s) => s.block === 'input');
    expect(input).toHaveLength(1);
    expect(['story-read', 'listening-set']).toContain(input[0]!.exercise);
    expect(input[0]!.params.storyId).toBe(plan.meta.storyId);
    const keys = plan.steps.filter((s) => s.cardKey && !s.isNew && s.stepTag === null).map((s) => s.cardKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.blocks.every((b) => b.stepIds.length > 0)).toBe(true);
  });

  it('Shugyō with an active Weak Point tag inserts a weak block over tagged cards', async () => {
    await makeTestStore({
      save: { progress: { station: 4 }, weakPoints: { particle: { n: 20, ewma: 0.3, active: true, peak: 0.3 } } },
      cards: allCards(),
    });
    const bit = 1 << 0; // 'particle' is ERROR_TAGS[0]
    store.log.push([DEFAULT_TEST_NOW - 1000, `${G.は}#cloze`, 1, 4000, 15, bit]);
    store.log.push([DEFAULT_TEST_NOW - 2000, `${G.です}#cloze`, 1, 4000, 15, bit]);
    const plan = await buildPlan('shugyo', { loader, available: all });
    const weak = plan.steps.filter((s) => s.block === 'weak');
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.every((s) => s.params.tag === 'particle')).toBe(true);
    expect(new Set(weak.map((s) => s.cardKey))).toEqual(new Set([`${G.は}#cloze`, `${G.です}#cloze`]));
  });
});

describe('buildPlan — other modes', () => {
  it('weak mode builds a set for the tag', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    store.log.push([DEFAULT_TEST_NOW - 1000, `${V.犬}#rec`, 1, 4000, 5, 1 << 7]); // word-choice
    const plan = await buildPlan('weak', { loader, available: all, tag: 'word-choice' });
    expect(plan.mode).toBe('weak');
    expect(plan.steps.map((s) => s.cardKey)).toEqual([`${V.犬}#rec`]);
    expect(plan.steps[0]!.params.tag).toBe('word-choice');
  });

  it('welcome mode picks the 20 best-known cards', async () => {
    await makeTestStore({ save: { progress: { station: 4, welcomeBackDue: true } }, cards: allCards({ kana: true, s: 40 }) });
    const plan = await buildPlan('welcome', { loader, available: all });
    expect(plan.steps.filter((s) => s.block === 'reviews')).toHaveLength(20);
    expect(plan.steps.some((s) => s.block === 'michikusa')).toBe(true);
  });

  it('rapid / gojuon are single arcade steps with pools', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards({ kana: true, s: 20 }) });
    const rapid = await buildPlan('rapid', { loader, available: all });
    expect(rapid.steps).toHaveLength(1);
    expect(rapid.steps[0]!.exercise).toBe('rapid-fire');
    expect(rapid.steps[0]!.params.pool!.length).toBeGreaterThan(0);
    const gojuon = await buildPlan('gojuon', { loader, available: all });
    expect(gojuon.steps[0]!.exercise).toBe('gojuon-fighter');
    expect(gojuon.steps[0]!.params.pool!.every((k) => k.startsWith('k-'))).toBe(true);
  });

  it('rejects boss / exam / Kage / Dan modes with the right builder’s name', async () => {
    await makeTestStore();
    await expect(buildPlan('gate', { loader })).rejects.toThrow(/buildGate/);
    await expect(buildPlan('shinsa', { loader })).rejects.toThrow(/buildShinsa/);
    await expect(buildPlan('kage', { loader })).rejects.toThrow(/buildKage/);
    await expect(buildPlan('dan', { loader })).rejects.toThrow(/buildGauntlet/);
  });

  it('a missing station yields an honest empty plan', async () => {
    await makeTestStore({ save: { progress: { station: 9 } } });
    const plan = await buildPlan('kata', { loader, available: all });
    expect(plan.steps).toHaveLength(0);
    expect(plan.station).toBe(9);
  });
});

describe('helpers', () => {
  it('michikusa pool is stations ≤ current + 1, un-collected first, then a collected one flagged again', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, collections: { michikusa: ['m-04-1'] } } });
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(michikusaFor(ctx)).toEqual({ id: 'm-04-2', isNew: true });
    store.patch('collections', (c) => ({ ...c, michikusa: ['m-04-1', 'm-04-2'] }));
    const again = michikusaFor(ctx);
    expect(again?.isNew).toBe(false);
    expect(FIXTURE_IDS.michikusa).toContain(again?.id);
  });

  it('story coverage counts resolved tokens against the known set', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const story = loader.get(FIXTURE_IDS.story[0]!)!;
    expect(storyCoverage(story as never, ctx.known)).toBe(1);
    expect(pickStories(ctx, { kind: 'story' }).map((s) => s.id)).toEqual([FIXTURE_IDS.story[0]]);
    expect(storyCoverage(story as never, new Set())).toBe(0);
  });

  it('pitch patterns and production-forge params', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(pitchPattern(0, 'みず')).toBe('平板');
    expect(pitchPattern(1, 'のむ')).toBe('頭高');
    expect(pitchPattern(2, 'いぬ')).toBe('尾高');
    expect(pitchPattern(2, 'たべる')).toBe('中高');
    const p = resolveParams(ctx, 'production-forge', loader.get(V.飲む)!, { rep: 0 });
    expect(p.answer).toBe('飲む');
    expect(p.accept).toContain('のむ');
    expect(p.candidates![0]).toBe('飲む');
    expect(p.kanaOnlyPolicy).toBe('good');
    expect(p.sentence).toContain('コーヒー');
    const ff = resolveParams(ctx, 'form-forge', loader.get(G.ます)!, { rep: 0 });
    expect(ff.targetForm).toBe('masu');
    expect(ff.answer).toMatch(/ます$/);
    const chain = resolveParams(ctx, 'form-chain', loader.get(G.ます)!, { rep: 0 });
    expect(chain.forms).toEqual(['masu', 'masen', 'mashita']);
    expect(chain.answers).toHaveLength(3);
    const pd = resolveParams(ctx, 'particle-duel', loader.get(G.は)!, { rep: 0 });
    expect(pd.answers![0]).toBe('は');
    expect(pd.blanks!.length).toBeGreaterThanOrEqual(1);
    const sc = resolveParams(ctx, 'scramble', loader.get(G.です)!, { rep: 0 });
    expect(sc.tiles!.length).toBeGreaterThan(1);
    expect(Array.from(sc.tiles!.join('')).sort().join('')).toBe(Array.from(sc.answer!).sort().join(''));
  });

  it('7-day accuracy comes from the daily rows', () => {
    expect(accuracy7({}, TODAY)).toEqual({ acc7: 1, n: 0 });
    expect(accuracy7({ [TODAY]: { reps: 10, ok: 8, minutes: 5, xp: 10, input: 0 }, [TODAY - 6]: { reps: 10, ok: 6, minutes: 5, xp: 10, input: 0 }, [TODAY - 7]: { reps: 10, ok: 0, minutes: 5, xp: 10, input: 0 } }, TODAY)).toEqual({ acc7: 0.7, n: 20 });
  });

  it('plan ids and createdAt come from the store clock, not the wall clock', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const plan: SessionPlan = await buildPlan('kata', { loader, available: all });
    expect(plan.createdAt).toBe(DEFAULT_TEST_NOW);
    expect(plan.day).toBe(TODAY);
    expect(plan.id.startsWith('kata-')).toBe(true);
  });
});
