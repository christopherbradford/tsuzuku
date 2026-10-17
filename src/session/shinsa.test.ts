/**
 * shinsa.ts — belt exam composition, speed tiers, pass rule, Sensei's Notes (design 04 §12).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BELT_IDS, type Belt, type CardKey } from '../content/types';
import { FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, G, STATION_1, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { SHINSA_SECTIONS } from '../shared/catalog';
import { bus } from '../shared/events';
import type { SessionPlan, StepResult } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { S } from './engine-strings';
import {
  NOTES_PLAN_PREFIX,
  SHINSA_SPEED,
  buildNotesPlan,
  buildShinsa,
  completeNotesSession,
  finishShinsa,
  nextBelt,
  scoreShinsa,
  sectionOfStep,
  senseiNotes,
  shinsaEligible,
  shinsaEligibleAsync,
  speedTierFor,
} from './shinsa';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

function live(s: number, prodS = s): CardTuple {
  void prodS;
  return card({ due: TODAY + 5, s, d: 5, reps: 10, lapses: 0, state: 2, last: TODAY - 1 });
}

/** Belt items at Brown: base S 40 and production S 10 (vocab rec + prod, kanji comp + read, grammar cloze + prod). */
function brownCards(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of STATION_4.vocabIds) {
    out[`${id}#rec`] = live(40);
    out[`${id}#prod`] = live(10);
    out[`${id}#listen`] = live(10);
  }
  for (const id of STATION_4.kanjiIds) {
    out[`${id}#comp`] = live(40);
    out[`${id}#read`] = live(10);
  }
  for (const id of STATION_4.grammarIds) {
    out[`${id}#cloze`] = live(40);
    out[`${id}#prod`] = live(10);
  }
  for (const id of STATION_1.vocabIds) out[`${id}#${id === V.おはよう || id === V.はい ? 'prod' : 'rec'}`] = live(40);
  return out;
}

function res(stepId: string, cardKey: CardKey | null, o: Partial<StepResult> = {}): StepResult {
  return { stepId, cardKey, rating: 3, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 0, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2000, errorTags: [], ...o };
}

function answers(plan: SessionPlan, wrong: (id: string) => boolean = () => false, tags: (id: string) => StepResult['errorTags'] = () => []): StepResult[] {
  return plan.steps.map((s) => res(s.id, s.cardKey, wrong(s.id) ? { correct: false, rating: 1, errorTags: tags(s.id) } : {}));
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('speed table', () => {
  it.each([
    ['white', 0.9, 2],
    ['yellow', 0.9, 2],
    ['orange', 0.9, 2],
    ['green', 1.0, 3],
    ['blue', 1.1, 4],
    ['purple', 1.1, 4],
    ['brown', 1.25, 5],
    ['black', 1.25, 5],
  ] as const)('%s belt listens at %f× (tier %i)', (belt, rate, tier) => {
    expect(SHINSA_SPEED[belt]).toBe(rate);
    expect(speedTierFor(belt)).toBe(tier);
  });

  it('nextBelt walks the road', () => {
    expect(nextBelt('white')).toBe('yellow');
    expect(nextBelt('brown')).toBe('black');
    expect(nextBelt('black')).toBeNull();
  });
});

describe('eligibility', () => {
  it('needs every Gatekeeper, ≥ 85 % Green, ≥ 50 % Brown and no pending Notes; White has no exam', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4, 5, 6, 7, 8, 9] } }, cards: brownCards() });
    const ok = shinsaEligible('yellow', { bundles: [STATION_4] });
    expect(ok.eligible).toBe(true);
    expect(ok.reasons).toEqual([]);
    expect(ok.coverage?.green).toBe(1);
    expect(ok.coverage?.brown).toBe(1);
    expect(shinsaEligible('white').eligible).toBe(false);
    expect(shinsaEligible('white').reasons).toEqual([S.shinsaReasonWhite]);
    expect(shinsaEligible('yellow').eligible).toBe(false);
    expect(shinsaEligible('yellow').reasons).toEqual([S.shinsaReasonContent]);
    store.patch('progress', (p) => ({ ...p, stationsCleared: [4, 5, 6, 7, 8] }));
    const gates = shinsaEligible('yellow', { bundles: [STATION_4] });
    expect(gates.eligible).toBe(false);
    expect(gates.gatesDone).toBe(false);
    expect(gates.reasons[0]).toContain('Gatekeeper');
    store.patch('progress', (p) => ({ ...p, stationsCleared: [4, 5, 6, 7, 8, 9], shinsaNotes: { belt: 'yellow', items: [], tags: [] } }));
    expect(shinsaEligible('yellow', { bundles: [STATION_4] }).reasons).toEqual([S.shinsaReasonNotes]);
    store.patch('progress', (p) => ({ ...p, shinsaPassed: ['yellow'], shinsaNotes: undefined as never }));
    expect(shinsaEligible('yellow', { bundles: [STATION_4] }).reasons).toContain(S.shinsaReasonPassed);
  });

  it('coverage reasons name the percentages', async () => {
    const cards = brownCards();
    for (const id of STATION_4.vocabIds) cards[`${id}#prod`] = live(2);
    for (const id of STATION_4.kanjiIds) cards[`${id}#read`] = live(2);
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4, 5, 6, 7, 8, 9] } }, cards });
    const e = await shinsaEligibleAsync('yellow', loader);
    expect(e.eligible).toBe(false);
    expect(e.coverage?.green).toBe(1);
    expect(e.coverage!.brown).toBeLessThan(0.5);
    expect(e.reasons).toHaveLength(1);
    expect(e.reasons[0]).toMatch(/Brown/);
    expect(e.reasons[0]).toMatch(/\d+ percent now/);
  });
});

describe('buildShinsa', () => {
  it('composes five sections for Yellow: 10 ear, reading, 30 form (typed), role-play + 5 shadow, no writing', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4, 5, 6, 7, 8, 9] } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 1, { loader, available: all });
    expect(plan.mode).toBe('shinsa');
    const bySection = (sec: string) => plan.steps.filter((s) => sectionOfStep(s.id) === sec);
    expect(bySection('ear')).toHaveLength(10);
    expect(bySection('ear').every((s) => s.exercise === 'sentence-listen' && s.params.rate === 0.9 && s.params.storyId !== undefined && s.timerMs === 20_000 && !s.timed)).toBe(true);
    expect(bySection('read').length).toBeGreaterThanOrEqual(1);
    expect(bySection('read').every((s) => s.exercise === 'story-read' && !s.timed)).toBe(true);
    const form = bySection('form');
    expect(form.length).toBeGreaterThan(0);
    expect(form.length).toBeLessThanOrEqual(30);
    expect(form.every((s) => ['production-forge', 'pattern-cloze', 'form-forge', 'kanji-read', 'transform', 'kana-forge', 'shadow'].includes(s.exercise))).toBe(true);
    expect(form.every((s) => s.params.tiles === undefined && s.params.choices === undefined)).toBe(true);
    const mouth = bySection('mouth');
    expect(mouth.filter((s) => s.exercise === 'role-play')).toHaveLength(1);
    expect(mouth.find((s) => s.exercise === 'role-play')!.params.storyId).toBe(FIXTURE_DIALOGUE_ID);
    expect(mouth.filter((s) => s.exercise === 'shadow')).toHaveLength(5);
    expect(mouth.some((s) => s.exercise === 'monologue')).toBe(false);
    expect(bySection('write')).toHaveLength(0);
    expect(plan.blocks.every((b) => b.kind === 'phase')).toBe(true);
    expect(plan.blocks.map((b) => b.label)).not.toContain('書 Writing');
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(plan.steps.length);
  });

  it('Black adds the 2-minute monologue and 400 cpm timed reading; Green adds writing', async () => {
    await makeTestStore({ save: { progress: { station: 53 } }, cards: brownCards() });
    const black = await buildShinsa('black', 2, { loader, available: all });
    const mono = black.steps.find((s) => s.exercise === 'monologue');
    // the fixture has no Black stations, so the sections draw on nothing but the monologue
    expect(mono?.params.seconds).toBe(120);
    expect(black.steps.filter((s) => sectionOfStep(s.id) === 'read').every((s) => s.timed && s.params.rate === 400)).toBe(true);
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 24 } }, cards: brownCards() });
    const green = await buildShinsa('green', 3, { loader, available: all });
    const write = green.steps.filter((s) => sectionOfStep(s.id) === 'write');
    expect(write).toHaveLength(1);
    expect(write[0]!.exercise).toBe('writing-dojo');
    expect(write[0]!.params.promptEn).toContain('3 sentences');
  });

  it('is deterministic per seed and honors the registry', async () => {
    await makeTestStore({ save: { progress: { station: 9 } }, cards: brownCards() });
    const a = await buildShinsa('yellow', 5, { loader, available: all });
    const b = await buildShinsa('yellow', 5, { loader, available: all });
    expect(a.steps.map((s) => s.id + s.cardKey)).toEqual(b.steps.map((s) => s.id + s.cardKey));
    const c = await buildShinsa('yellow', 5, { loader, available: (id) => id !== 'role-play' && id !== 'shadow' && id !== 'story-read' });
    expect(c.steps.some((s) => sectionOfStep(s.id) === 'mouth')).toBe(false);
    expect(c.steps.some((s) => sectionOfStep(s.id) === 'read')).toBe(false);
  });
});

describe('scoring and Sensei’s Notes', () => {
  it('pass = ≥ 80 % in every present section; absent sections do not fail the exam', async () => {
    await makeTestStore({ save: { progress: { station: 9 } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 7, { loader, available: all });
    const clean = scoreShinsa(plan, answers(plan));
    expect(clean.passed).toBe(true);
    expect(clean.present).toEqual(['ear', 'read', 'form', 'mouth']);
    expect(clean.sections.write).toBe(1);
    for (const sec of SHINSA_SECTIONS) expect(clean.sections[sec]).toBe(1);
    const earIds = plan.steps.filter((s) => sectionOfStep(s.id) === 'ear').map((s) => s.id);
    const threeEar = scoreShinsa(plan, answers(plan, (id) => earIds.slice(0, 3).includes(id)));
    expect(threeEar.sections.ear).toBe(0.7);
    expect(threeEar.passed).toBe(false);
    const twoEar = scoreShinsa(plan, answers(plan, (id) => earIds.slice(0, 2).includes(id)));
    expect(twoEar.sections.ear).toBe(0.8);
    expect(twoEar.passed).toBe(true);
    expect(scoreShinsa(plan, []).passed).toBe(false);
    const scored = scoreShinsa(plan, plan.steps.map((s) => res(s.id, s.cardKey, { correct: false, score: 0.85 })));
    expect(scored.passed).toBe(true);
  });

  it('notes list the missed cards and the dominant tags, most frequent first', () => {
    const steps = [
      res('a', `${V.飲む}#prod`, { correct: false, rating: 1, errorTags: ['particle', 'conjugation'] }),
      res('b', `${V.食べる}#prod`, { correct: false, rating: 1, errorTags: ['conjugation'] }),
      res('c', `${G.です}#cloze`, { correct: false, rating: 1, errorTags: ['conjugation', 'word-order'] }),
      res('d', `${V.飲む}#prod`, { correct: false, rating: 1 }),
      res('e', `${V.人}#rec`, { correct: true, errorTags: ['particle'] }),
      res('f', null, { correct: false, rating: null }),
    ];
    const n = senseiNotes(steps);
    expect(n.items).toEqual([`${V.飲む}#prod`, `${V.食べる}#prod`, `${G.です}#cloze`]);
    expect(n.tags).toEqual(['conjugation', 'particle', 'word-order']);
  });

  it('finishShinsa: a fail writes Sensei’s Notes; a pass records the belt and emits shinsa:result', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4, 5, 6, 7, 8, 9] } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 8, { loader, available: all });
    const cap = captureEvents();
    const formIds = plan.steps.filter((s) => sectionOfStep(s.id) === 'form').map((s) => s.id);
    const fail = scoreShinsa(plan, answers(plan, (id) => formIds.includes(id), () => ['conjugation']));
    expect(fail.passed).toBe(false);
    finishShinsa('yellow', fail);
    const notes = store.progress.value.shinsaNotes!;
    expect(notes.belt).toBe('yellow');
    expect(notes.items.length).toBeGreaterThan(0);
    expect(notes.tags).toEqual(['conjugation']);
    expect(store.profile.value.belt).toBe('white');
    expect(cap.events.filter((e) => e[0] === 'shinsa:result')[0]![1]).toMatchObject({ belt: 'yellow', passed: false });
    expect(shinsaEligible('yellow', { bundles: [STATION_4] }).notesPending).toBe(true);

    const pass = scoreShinsa(plan, answers(plan));
    finishShinsa('yellow', pass);
    expect(store.progress.value.shinsaPassed).toEqual(['yellow']);
    expect(store.progress.value.shinsaNotes).toBeUndefined();
    expect(store.profile.value.belt).toBe('yellow');
    expect(cap.events.filter((e) => e[0] === 'shinsa:result')[1]![1]).toMatchObject({ belt: 'yellow', passed: true, sections: pass.sections });
    // a lower belt never demotes
    finishShinsa('white', pass);
    expect(store.profile.value.belt).toBe('yellow');
    cap.stop();
  });

  it('Black promotes to 初段', async () => {
    await makeTestStore({ save: { progress: { station: 53 }, profile: { belt: 'brown' } } });
    const sections = Object.fromEntries(SHINSA_SECTIONS.map((s) => [s, 1])) as Record<(typeof SHINSA_SECTIONS)[number], number>;
    finishShinsa('black', { sections, passed: true, notes: { items: [], tags: [] }, present: ['form'] });
    expect(store.profile.value.belt).toBe('black');
    expect(store.profile.value.dan).toBe(1);
    expect(BELT_IDS.indexOf('black' as Belt)).toBe(7);
  });

  it('a Notes session plan covers the noted cards and clearing it reopens the exam', async () => {
    await makeTestStore({ save: { progress: { station: 9, shinsaNotes: { belt: 'yellow', items: [`${V.飲む}#prod`, `${G.です}#cloze`], tags: ['conjugation'] } } }, cards: brownCards() });
    const plan = (await buildNotesPlan({ loader, available: all }))!;
    expect(plan).not.toBeNull();
    expect(plan.mode).toBe('weak');
    expect(plan.id.startsWith(NOTES_PLAN_PREFIX)).toBe(true);
    expect(plan.steps.map((s) => s.cardKey)).toEqual([`${V.飲む}#prod`, `${G.です}#cloze`]);
    expect(plan.steps.every((s) => s.params.tag === 'conjugation' && s.block === 'weak')).toBe(true);
    completeNotesSession();
    expect(store.progress.value.shinsaNotes).toBeUndefined();
    expect(await buildNotesPlan({ loader })).toBeNull();
    expect(FIXTURE_STORY_ID).toBe('s-04-1');
  });
});

describe('retake after a card-less fail (design 04 §12)', () => {
  it('failing only Reading / Speaking / Writing leaves no Notes to drill, so the retake is open at once', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4, 5, 6, 7, 8, 9] } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 1, { loader, available: all });
    expect(plan.steps.some((s) => s.cardKey === null)).toBe(true);
    const cardless = new Set(plan.steps.filter((s) => s.cardKey === null).map((s) => s.id));
    const sc = scoreShinsa(plan, answers(plan, (id) => cardless.has(id)));
    expect(sc.passed).toBe(false);
    expect(sc.notes.items).toEqual([]);
    finishShinsa('yellow', sc);
    expect(store.progress.value.shinsaNotes).toBeUndefined();
    const e = shinsaEligible('yellow', { bundles: [STATION_4] });
    expect(e.notesPending).toBe(false);
    expect(e.reasons).not.toContain(S.shinsaReasonNotes);
    expect(await buildNotesPlan({ loader, available: all })).toBeNull();
  });

  it('a card-less fail also clears stale Notes left by an older build', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: [4, 5, 6, 7, 8, 9], shinsaNotes: { belt: 'yellow', items: [], tags: ['particle'] } } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 1, { loader, available: all });
    const cardless = new Set(plan.steps.filter((s) => s.cardKey === null).map((s) => s.id));
    finishShinsa('yellow', scoreShinsa(plan, answers(plan, (id) => cardless.has(id))));
    expect(store.progress.value.shinsaNotes).toBeUndefined();
  });
});
