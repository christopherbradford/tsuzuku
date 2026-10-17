/**
 * kage.ts — the ghost rival: weekly determinism, speed index, beat rule, availability.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import { FIXTURE_IDS, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { StepResult } from '../shared/session-types';
import { dayStartMs, epochDay, weekOf } from '../shared/time';
import type { CardTuple, KageState } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { S } from './engine-strings';
import {
  FACTORY_TABLE,
  SCORE_SCALE,
  SPEED_INDEX_MAX,
  SPEED_INDEX_MIN,
  beatsKage,
  buildKage,
  exerciseOfKageStep,
  factoryRows,
  finishKage,
  hiScoreTable,
  isMatureKageStep,
  kageDueThisWeek,
  kageResultLine,
  kageStanding,
  kageWeekStart,
  matureStepId,
  recentStepId,
  scoreKage,
} from './kage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const WEEK = weekOf(TODAY);
const loader = createFakeLoader();
const all = (): boolean => true;

function matureCard(): CardTuple {
  return card({ due: TODAY + 10, s: 30, d: 5, reps: 12, lapses: 0, state: 2, last: TODAY - 2 });
}
function youngCard(): CardTuple {
  return card({ due: TODAY + 1, s: 2, d: 5, reps: 2, lapses: 0, state: 1, last: TODAY - 1 });
}

/** 7 mature station-4 vocab rec + 3 grammar cloze cards, and 4 recently introduced kanji comp cards (log rows inside 14 days). */
function kageCards(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of STATION_4.vocabIds) out[`${id}#rec`] = matureCard();
  for (const id of STATION_4.kanjiIds) out[`${id}#comp`] = youngCard();
  for (const id of STATION_4.grammarIds) out[`${id}#cloze`] = matureCard();
  return out;
}

function logRecent(): void {
  const t = dayStartMs(TODAY - 3, 'UTC') + 1000;
  for (const id of STATION_4.kanjiIds) store.log.push([t, `${id}#comp`, 3, 4000, 11, 0]);
}

function res(stepId: string, o: Partial<StepResult> = {}): StepResult {
  return { stepId, cardKey: null, rating: 3, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 0, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 4000, errorTags: [], ...o };
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('buildKage', () => {
  it('is deterministic per (seed, week) and changes with the week', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: kageCards() });
    logRecent();
    const a = await buildKage(TODAY, 'seed-a', { loader, available: all });
    const b = await buildKage(TODAY + 2, 'seed-a', { loader, available: all });
    expect(a.steps.map((s) => s.cardKey)).toEqual(b.steps.map((s) => s.cardKey));
    expect(a.steps.map((s) => s.id)).toEqual(b.steps.map((s) => s.id));
    const nextWeek = await buildKage(TODAY + 7, 'seed-a', { loader, available: all });
    const other = await buildKage(TODAY, 'seed-b', { loader, available: all });
    const sig = (p: typeof a) => p.steps.map((s) => s.cardKey).join(',');
    expect(sig(nextWeek) === sig(a) && sig(other) === sig(a)).toBe(false);
    expect(a.mode).toBe('kage');
    expect(a.blocks).toHaveLength(1);
    expect(a.blocks[0]!.label).toBe(S.blockKage);
  });

  it('samples the recent half and the mature half, marking mature steps by id and typing them', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: kageCards() });
    logRecent();
    const plan = await buildKage(TODAY, 'seed', { loader, available: all });
    const recent = plan.steps.filter((s) => s.id.startsWith('kage:r:'));
    const mature = plan.steps.filter((s) => isMatureKageStep(s.id));
    expect(recent.length).toBe(4);
    expect(recent.every((s) => s.cardKey?.endsWith('#comp'))).toBe(true);
    expect(mature.length).toBe(10);
    for (const s of mature) {
      expect(exerciseOfKageStep(s.id)).toBe(s.exercise);
      expect(store.cards.get(s.cardKey!)![1]).toBeGreaterThanOrEqual(14);
      expect(s.params.choices).toBeUndefined();
    }
    expect(plan.steps.length).toBe(14);
    expect(plan.meta.dueTaken).toBe(14);
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(14);
  });

  it('yields an empty set honestly when nothing qualifies', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const plan = await buildKage(TODAY, 'seed', { loader, available: all });
    expect(plan.steps).toHaveLength(0);
  });
});

describe('scoreKage', () => {
  it('accuracy over the set × the mean speed index on the mature half, clamped 0.5..1.5', () => {
    const median = { 'meaning-recall': 4000 };
    const fast = [res(recentStepId(0)), res(recentStepId(1)), res(matureStepId(0, 'meaning-recall'), { ms: 1000 }), res(matureStepId(1, 'meaning-recall'), { ms: 1000 })];
    const f = scoreKage(fast, median);
    expect(f.accuracy).toBe(1);
    expect(f.speedIndex).toBe(SPEED_INDEX_MAX);
    expect(f.score).toBe(Math.round(1 * 1.5 * SCORE_SCALE));
    expect(f.matureReps).toBe(2);
    const slow = [res(matureStepId(0, 'meaning-recall'), { ms: 40_000 }), res(recentStepId(0), { correct: false, rating: 1 })];
    const s = scoreKage(slow, median);
    expect(s.speedIndex).toBe(SPEED_INDEX_MIN);
    expect(s.accuracy).toBe(0.5);
    expect(s.score).toBe(250);
    const even = scoreKage([res(matureStepId(0, 'meaning-recall'), { ms: 4000 }), res(matureStepId(1, 'meaning-recall'), { ms: 2000 })], median);
    expect(even.speedIndex).toBe(1.25);
    const mixed = scoreKage([res(matureStepId(0, 'meaning-recall'), { ms: 4000 }), res(matureStepId(1, 'meaning-recall'), { ms: 8000 })], median);
    expect(mixed.speedIndex).toBe(0.75);
  });

  it('falls back to the 8 s rep budget without a median and treats plain results as the whole set', () => {
    const s = scoreKage([res(matureStepId(0, 'pitch-ear'), { ms: 8000 })], {});
    expect(s.speedIndex).toBe(1);
    const plain = scoreKage([res('x', { correct: true }), res('y', { correct: false })], {});
    expect(plain).toMatchObject({ accuracy: 0.5, speedIndex: 1, score: 500, reps: 2, matureReps: 0 });
    expect(scoreKage([], {})).toMatchObject({ score: 0, accuracy: 0, speedIndex: 1 });
    // guards are misses
    expect(scoreKage([res('g', { correct: true, guard: true })], {}).accuracy).toBe(0);
  });
});

describe('beat rule and finishKage', () => {
  const k = (o: Partial<KageState> = {}): KageState => ({ week: 0, best4: [], wins: 0, history: [], ...o });

  it('beats the Kage only above the best of the last 4 weeks, never on the first run', () => {
    expect(beatsKage(k(), 900)).toBe(false);
    expect(beatsKage(k({ best4: [500, 700] }), 701)).toBe(true);
    expect(beatsKage(k({ best4: [500, 700] }), 700)).toBe(false);
  });

  it('records the week, keeps best4 as the last 4 weeks, counts wins, emits kage:result; a rerun in the same week is free play', async () => {
    await makeTestStore({ save: { kage: { week: WEEK - 1, best4: [600, 650], wins: 1, history: [[WEEK - 2, 600], [WEEK - 1, 650]] } } });
    const cap = captureEvents();
    const first = finishKage(700, WEEK);
    expect(first).toEqual({ beat: true, counted: true });
    const s = store.kage.value;
    expect(s.week).toBe(WEEK);
    expect(s.wins).toBe(2);
    expect(s.beatenWeek).toBe(WEEK);
    expect(s.history).toEqual([[WEEK - 2, 600], [WEEK - 1, 650], [WEEK, 700]]);
    expect(s.best4).toEqual([600, 650, 700]);
    expect(cap.events.filter((e) => e[0] === 'kage:result')).toEqual([['kage:result', { week: WEEK, score: 700, beat: true }]]);
    const again = finishKage(900, WEEK);
    expect(again).toEqual({ beat: true, counted: false });
    expect(store.kage.value.history).toHaveLength(3);
    expect(cap.events.filter((e) => e[0] === 'kage:result')).toHaveLength(1);
    cap.stop();
    // best4 slides
    for (let w = 1; w <= 5; w++) finishKage(100 * w, WEEK + w);
    expect(store.kage.value.best4).toEqual([200, 300, 400, 500]);
    expect(store.kage.value.history).toHaveLength(8);
  });

  it('a lower score is not a win and leaves beatenWeek alone', async () => {
    await makeTestStore({ save: { kage: { week: WEEK - 1, best4: [800], wins: 3, history: [[WEEK - 1, 800]], beatenWeek: WEEK - 1 } } });
    expect(finishKage(500, WEEK)).toEqual({ beat: false, counted: true });
    expect(store.kage.value.wins).toBe(3);
    expect(store.kage.value.beatenWeek).toBe(WEEK - 1);
  });
});

describe('availability and standing', () => {
  it('a Ghost Set is due when this week has not been run', () => {
    expect(kageDueThisWeek({ week: 0, best4: [], wins: 0, history: [] }, TODAY)).toBe(true);
    expect(kageDueThisWeek({ week: WEEK - 1, best4: [], wins: 0, history: [] }, TODAY)).toBe(true);
    expect(kageDueThisWeek({ week: WEEK, best4: [], wins: 0, history: [] }, TODAY)).toBe(false);
    expect(kageDueThisWeek({ week: WEEK, best4: [], wins: 0, history: [] }, TODAY + 7)).toBe(true);
  });

  it('standing lines are respectful and reflect the week', () => {
    const fresh = kageStanding({ week: 0, best4: [], wins: 0, history: [] }, TODAY);
    expect(fresh).toMatchObject({ due: true, beatenThisWeek: false, best: 0, lastScore: null, line: S.kageFirstRun });
    const due = kageStanding({ week: WEEK - 1, best4: [700], wins: 0, history: [[WEEK - 1, 700]] }, TODAY);
    expect(due.line).toBe(S.kageIntro);
    expect(due.best).toBe(700);
    expect(due.lastScore).toBe(700);
    const beaten = kageStanding({ week: WEEK, best4: [700, 800], wins: 1, history: [[WEEK - 1, 700], [WEEK, 800]], beatenWeek: WEEK }, TODAY);
    expect(beaten.line).toBe(S.kageBeat);
    const held = kageStanding({ week: WEEK, best4: [800, 700], wins: 1, history: [[WEEK - 1, 800], [WEEK, 700]] }, TODAY);
    expect(held.line).toBe(S.kageDone);
    expect(kageResultLine(true, false)).toBe(S.kageBeat);
    expect(kageResultLine(false, false)).toBe(S.kageHeld);
    expect(kageResultLine(false, true)).toBe(S.kageFirstRun);
    for (const line of [S.kageIntro, S.kageFirstRun, S.kageBeat, S.kageHeld, S.kageNotEnough, S.kageDone]) expect(line).not.toMatch(/!|loser|pathetic|hurry/i);
  });

  it('the factory table is derived from the learner’s first result and replaced by history', () => {
    expect(FACTORY_TABLE.map((f) => f.score)).toEqual([1.1, 1.0, 0.9, 0.8, 0.7, 0.6]);
    expect(FACTORY_TABLE.every((f) => /^[ァ-ヺー]+$/u.test(f.initials))).toBe(true);
    expect(factoryRows(undefined)).toEqual([]);
    expect(factoryRows(1000).map((r) => r.score)).toEqual([1100, 1000, 900, 800, 700, 600]);
    const table = hiScoreTable({ week: WEEK, best4: [1000, 1200], wins: 1, history: [[WEEK - 1, 1000], [WEEK, 1200]] });
    expect(table).toHaveLength(6);
    expect(table[0]).toMatchObject({ score: 1200, factory: false, week: WEEK, initials: S.kageYou });
    expect(table.filter((r) => !r.factory)).toHaveLength(2);
    expect(table.filter((r) => r.factory).every((r) => r.score <= 1100)).toBe(true);
    expect(hiScoreTable({ week: 0, best4: [], wins: 0, history: [] })).toEqual([]);
    expect(FIXTURE_IDS.vocab).toContain(V.飲む);
  });
});

describe('Ghost Set anchoring (design 03 §11)', () => {
  it('items first seen 13 days before the Monday stay in the set all week: Monday and Wednesday build the same keys', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: kageCards() });
    const monday = kageWeekStart(TODAY);
    const t = dayStartMs(monday - 13, 'UTC') + 1000;
    for (const id of STATION_4.kanjiIds) store.log.push([t, `${id}#comp`, 3, 4000, 11, 0]);
    const a = await buildKage(monday, 'seed-w', { loader, available: all });
    const b = await buildKage(monday + 2, 'seed-w', { loader, available: all });
    expect(a.steps.filter((s) => s.id.startsWith('kage:r:')).length).toBe(4);
    expect(b.steps.map((s) => s.cardKey)).toEqual(a.steps.map((s) => s.cardKey));
    expect(b.steps.map((s) => s.id)).toEqual(a.steps.map((s) => s.id));
  });
});
