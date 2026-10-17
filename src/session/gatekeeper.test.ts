/**
 * gatekeeper.ts — availability, phases, timers, scoring, Grudge List, Assisted Gate (design 04 §11).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import { FIXTURE_IDS, G, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { SessionPlan, StepResult } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { isMature } from '../learn';
import {
  ASSISTED_AFTER_ATTEMPTS,
  FLASH_MS,
  GATE_ASSISTED_PASS,
  GATE_PASS,
  GRUDGE_REPS_FOR_REMATCH,
  STRIKE_MS,
  buildGate,
  finishGate,
  gateAvailable,
  gateOutcome,
  rematchAllowed,
  sampleLowR,
  scoreGate,
} from './gatekeeper';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

function live(s: number, extra: Partial<{ reps: number; d: number }> = {}): CardTuple {
  return card({ due: TODAY + 3, s, d: extra.d ?? 5, reps: extra.reps ?? 8, lapses: 0, state: 2, last: TODAY - 1 });
}

/** The 14 station-4 items (7 vocab · 4 kanji · 3 grammar), all introduced; `greenCount` of them with S ≥ 7 d. Vocab also gets prod cards (mature where `matureProd`). */
function stationCards(o: { greenCount?: number; matureProd?: boolean; matureRec?: boolean } = {}): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  const ids = [...STATION_4.vocabIds, ...STATION_4.kanjiIds, ...STATION_4.grammarIds];
  const greenCount = o.greenCount ?? ids.length;
  ids.forEach((id, i) => {
    const s = i < greenCount ? (o.matureRec ? 20 : 8) : 2;
    if (id.startsWith('v-')) {
      out[`${id}#rec`] = live(s);
      out[`${id}#prod`] = live(o.matureProd ? 15 : 3);
    } else if (id.startsWith('j-')) {
      out[`${id}#comp`] = live(s);
      out[`${id}#read`] = live(o.matureRec ? 16 : 4);
    } else {
      out[`${id}#cloze`] = live(s);
      out[`${id}#prod`] = live(o.matureProd ? 15 : 3);
    }
  });
  // station-1 vocab (cumulative pool)
  for (const id of [V.私, V.犬, V.水]) out[`${id}#rec`] = live(20);
  return out;
}

function res(stepId: string, cardKey: CardKey | null, o: Partial<StepResult> = {}): StepResult {
  return { stepId, cardKey, rating: 3, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 0, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2000, errorTags: [], ...o };
}

function answerAll(plan: SessionPlan, wrong: (i: number, stepId: string) => boolean = () => false): StepResult[] {
  return plan.steps.map((s, i) => res(s.id, s.cardKey, wrong(i, s.id) ? { correct: false, rating: 1 } : {}));
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('gateAvailable', () => {
  it('needs every item introduced and ≥ 80 % Green', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards() });
    const a = gateAvailable(4, STATION_4, store.cards, TODAY);
    expect(a).toEqual({ ready: true, introduced: 14, green: 14, total: 14 });
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ greenCount: 11 }) });
    const b = gateAvailable(4, STATION_4, store.cards, TODAY);
    expect(b.ready).toBe(false);
    expect(b.green).toBe(11);
    expect(b.green).toBeLessThan(Math.ceil(0.8 * 14));
    resetStoreForTests();
    const partial = stationCards();
    delete partial[`${V.人}#rec`];
    delete partial[`${V.人}#prod`];
    await makeTestStore({ save: { progress: { station: 4 } }, cards: partial });
    const c = gateAvailable(4, STATION_4, store.cards, TODAY);
    expect(c.ready).toBe(false);
    expect(c.introduced).toBe(13);
  });

  it('⌈80 %⌉ Green passes (12 of 14)', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ greenCount: 12 }) });
    expect(gateAvailable(4, STATION_4, store.cards, TODAY).ready).toBe(true);
  });
});

describe('buildGate', () => {
  it('four phases in order with the right sizes, caps and labels', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 1, loader, available: all });
    expect(plan.mode).toBe('gate');
    expect(plan.blocks.map((b) => b.kind)).toEqual(['phase', 'phase', 'phase', 'phase']);
    const sizes = plan.blocks.map((b) => b.stepIds.length);
    expect(sizes[0]).toBeLessThanOrEqual(20);
    expect(sizes[0]).toBeGreaterThanOrEqual(12);
    expect(sizes[1]).toBeLessThanOrEqual(20);
    expect(sizes[1]).toBeGreaterThanOrEqual(10);
    expect(sizes[2]).toBe(12);
    expect(sizes[3]).toBe(3);
    for (const [i, b] of plan.blocks.entries()) for (const id of b.stepIds) expect(plan.steps.find((s) => s.id === id)!.params.phase).toBe(i + 1);
    expect(plan.steps.filter((s) => s.params.phase === 3).every((s) => s.exercise === 'sentence-listen' && !s.timed && s.params.rate === 0.9)).toBe(true);
    expect(plan.steps.filter((s) => s.params.phase === 4).every((s) => s.exercise === 'writing-dojo' && s.params.patternIds?.length === 1 && !s.timed)).toBe(true);
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(plan.steps.length);
  });

  it('no timed step has a card whose tested facet is younger than 14 d; mature cards get 4 s / 12 s', async () => {
    const cards = stationCards({ matureProd: false, matureRec: false });
    cards[`${V.飲む}#rec`] = live(30);
    cards[`${V.飲む}#prod`] = live(30);
    cards[`${G.です}#cloze`] = live(30);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 2, loader, available: all });
    for (const s of plan.steps) {
      if (!s.timed) {
        expect(s.timerMs).toBeUndefined();
        continue;
      }
      const c = store.cards.get(s.cardKey!)!;
      expect(isMature(c)).toBe(true);
      expect(s.timerMs).toBe(s.params.phase === 1 ? FLASH_MS : STRIKE_MS);
    }
    const timed = plan.steps.filter((s) => s.timed);
    expect(timed.length).toBeGreaterThan(0);
    const young = plan.steps.filter((s) => s.cardKey && !isMature(store.cards.get(s.cardKey)!) && (s.params.phase === 1 || s.params.phase === 2));
    expect(young.length).toBeGreaterThan(0);
    expect(young.every((s) => !s.timed)).toBe(true);
  });

  it('Flash is recognition (meaning-guard / kanji-read / component) and Strike is production (forge / cloze), mature cards typed', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 3, loader, available: all });
    const flash = plan.steps.filter((s) => s.params.phase === 1);
    expect(flash.every((s) => ['meaning-guard', 'kanji-read', 'component-flash', 'component-assembly'].includes(s.exercise))).toBe(true);
    expect(flash.filter((s) => s.exercise === 'meaning-guard').every((s) => s.params.choices?.length === 4)).toBe(true);
    const strike = plan.steps.filter((s) => s.params.phase === 2);
    expect(strike.every((s) => ['production-forge', 'pattern-cloze', 'form-forge', 'transform', 'kana-forge', 'shadow'].includes(s.exercise))).toBe(true);
    expect(strike.filter((s) => s.exercise === 'pattern-cloze').every((s) => s.params.tiles === undefined)).toBe(true);
    const stationShare = flash.filter((s) => STATION_4.vocabIds.includes(s.itemId!) || STATION_4.kanjiIds.includes(s.itemId!)).length / flash.length;
    expect(stationShare).toBeGreaterThanOrEqual(0.6);
  });

  it('the Assisted Gate has no timers and three cloze instead of Final Form', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: true, revenge: false, seed: 4, loader, available: all });
    expect(plan.steps.every((s) => !s.timed && s.timerMs === undefined)).toBe(true);
    const final = plan.steps.filter((s) => s.params.phase === 4);
    expect(final).toHaveLength(3);
    expect(final.every((s) => s.exercise === 'pattern-cloze')).toBe(true);
    expect(plan.blocks[3]!.label).toContain('assisted');
  });

  it('is deterministic per seed and skips unregistered drills', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true }) });
    const a = await buildGate(4, { assisted: false, revenge: false, seed: 9, loader, available: all });
    const b = await buildGate(4, { assisted: false, revenge: false, seed: 9, loader, available: all });
    expect(a.steps.map((s) => s.id + s.cardKey)).toEqual(b.steps.map((s) => s.id + s.cardKey));
    const c = await buildGate(4, { assisted: false, revenge: false, seed: 9, loader, available: (id) => id !== 'sentence-listen' && id !== 'writing-dojo' && id !== 'transform' && id !== 'pattern-cloze' });
    expect(c.steps.some((s) => s.params.phase === 3)).toBe(false);
    expect(c.steps.some((s) => s.params.phase === 4)).toBe(false);
  });
});

describe('scoreGate', () => {
  it('pass needs ≥ 85 % overall AND ≥ 70 % in every phase; perfect at 100 %', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 5, loader, available: all });
    const perfect = scoreGate(plan, answerAll(plan));
    expect(perfect).toMatchObject({ overall: 1, passed: true, perfect: true, misses: [] });
    expect(perfect.phases.every((p) => p === 1)).toBe(true);
    // 2 Flash misses out of ~39 → ≥ 85 % overall and every phase ≥ 70 %
    const two = scoreGate(plan, answerAll(plan, (i) => i === 0 || i === 1));
    expect(two.passed).toBe(true);
    expect(two.perfect).toBe(false);
    expect(two.misses).toHaveLength(2);
    // every Ear step wrong: overall may still be high but phase 3 fails
    const earIds = new Set(plan.blocks[2]!.stepIds);
    const earFail = scoreGate(plan, answerAll(plan, (_, id) => earIds.has(id)));
    expect(earFail.phases[2]).toBe(0);
    expect(earFail.passed).toBe(false);
    // timeouts and guards are misses
    const t = scoreGate(plan, plan.steps.map((s, i) => res(s.id, s.cardKey, i % 2 === 0 ? { timedOut: true, correct: false, rating: 2 } : { guard: true, correct: false, rating: 1 })));
    expect(t.overall).toBe(0);
    expect(t.passed).toBe(false);
    // unanswered steps count as misses
    expect(scoreGate(plan, []).overall).toBe(0);
    expect(scoreGate(plan, []).answered).toBe(0);
  });

  it('the Assisted Gate passes at 80 % and is never perfect', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: true, revenge: false, seed: 6, loader, available: all });
    const n = plan.steps.length;
    // Misses spread over Ear, Flash and Strike (each phase stays ≥ 70 %) until the overall score dips under 85 %.
    const candidates = [...plan.blocks[2]!.stepIds.slice(0, 3), ...plan.blocks[0]!.stepIds.slice(0, 4), ...plan.blocks[1]!.stepIds.slice(0, 3)];
    const wrong = new Set<string>();
    for (const id of candidates) {
      if ((n - wrong.size) / n < GATE_PASS) break;
      wrong.add(id);
    }
    const results = answerAll(plan, (_, id) => wrong.has(id));
    const s = scoreGate(plan, results, { assisted: true });
    expect(s.overall).toBeGreaterThanOrEqual(GATE_ASSISTED_PASS);
    expect(s.overall).toBeLessThan(GATE_PASS);
    expect(s.passed).toBe(true);
    expect(scoreGate(plan, results).passed).toBe(false);
    expect(scoreGate(plan, answerAll(plan), { assisted: true }).perfect).toBe(false);
    expect(n).toBeGreaterThan(20);
  });
});

describe('finishGate and rematch', () => {
  it('a fail fills the Grudge List, counts the attempt and emits gate:result fail; the third non-pass offers the Assisted Gate', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 7, loader, available: all });
    const cap = captureEvents();
    const fail = scoreGate(plan, answerAll(plan, (i) => i % 2 === 0));
    expect(fail.passed).toBe(false);
    finishGate(4, fail, { assisted: false, revenge: false });
    const p = store.progress.value;
    expect(p.gateAttempts[4]).toBe(1);
    expect(p.stationsCleared).toEqual([]);
    expect(p.station).toBe(4);
    expect(p.grudge.length).toBe(fail.misses.length);
    expect(fail.misses.every((k) => p.grudge.includes(k))).toBe(true);
    const ev = cap.events.filter((e) => e[0] === 'gate:result');
    expect(ev).toHaveLength(1);
    expect(ev[0]![1]).toMatchObject({ station: 4, outcome: 'fail', score: fail.overall });
    // rematch needs 20 Grudge reps today
    let r = rematchAllowed(4);
    expect(r.allowed).toBe(false);
    expect(r.grudgeRepsNeeded).toBe(GRUDGE_REPS_FOR_REMATCH);
    expect(r.offerAssisted).toBe(false);
    for (let i = 0; i < GRUDGE_REPS_FOR_REMATCH; i++) store.log.push([DEFAULT_TEST_NOW - 1000 * i, p.grudge[i % p.grudge.length]!, 3, 3000, 5, 0]);
    r = rematchAllowed(4);
    expect(r.allowed).toBe(true);
    expect(r.grudgeRepsNeeded).toBe(0);
    finishGate(4, fail, { assisted: false, revenge: false });
    finishGate(4, fail, { assisted: false, revenge: false });
    expect(store.progress.value.gateAttempts[4]).toBe(ASSISTED_AFTER_ATTEMPTS);
    expect(rematchAllowed(4).offerAssisted).toBe(true);
    cap.stop();
  });

  it('a pass clears the station, advances progress.station, clears the Grudge List; perfect counts', async () => {
    await makeTestStore({ save: { progress: { station: 4, grudge: [`${V.人}#rec`] } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 8, loader, available: all });
    const cap = captureEvents();
    const score = scoreGate(plan, answerAll(plan));
    finishGate(4, score, { assisted: false, revenge: false });
    const p = store.progress.value;
    expect(p.stationsCleared).toEqual([4]);
    expect(p.station).toBe(5);
    expect(p.perfectGates).toBe(1);
    expect(p.grudge).toEqual([]);
    expect(p.assisted).toEqual([]);
    expect(cap.events.filter((e) => e[0] === 'gate:result')[0]![1]).toMatchObject({ station: 4, outcome: 'perfect', score: 1 });
    cap.stop();
    expect(rematchAllowed(4)).toEqual({ allowed: false, grudgeRepsNeeded: 0, offerAssisted: false });
  });

  it('an assisted pass is provisional (grey corner) until the Revenge Match; replaying an old gate never moves the station', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ matureProd: true, matureRec: true }) });
    const plan = await buildGate(4, { assisted: true, revenge: false, seed: 10, loader, available: all });
    const cap = captureEvents();
    const s = scoreGate(plan, answerAll(plan), { assisted: true });
    finishGate(4, s, { assisted: true, revenge: false });
    expect(store.progress.value.assisted).toEqual([4]);
    expect(store.progress.value.stationsCleared).toEqual([4]);
    expect(store.progress.value.perfectGates).toBe(0);
    expect(cap.events.filter((e) => e[0] === 'gate:result')[0]![1]).toMatchObject({ outcome: 'assisted' });
    expect(rematchAllowed(4).allowed).toBe(true);
    store.patch('progress', (p) => ({ ...p, station: 9 }));
    const full = await buildGate(4, { assisted: false, revenge: true, seed: 11, loader, available: all });
    finishGate(4, scoreGate(full, answerAll(full)), { assisted: false, revenge: true });
    expect(store.progress.value.assisted).toEqual([]);
    expect(store.progress.value.station).toBe(9);
    expect(cap.events.filter((e) => e[0] === 'gate:result')[1]![1]).toMatchObject({ outcome: 'revenge' });
    cap.stop();
  });

  it('gateOutcome maps scores and flags', () => {
    const base = { overall: 0.9, phases: [0.9], passed: true, perfect: false, misses: [], answered: 1, total: 1 };
    expect(gateOutcome(base, { assisted: false, revenge: false })).toBe('pass');
    expect(gateOutcome({ ...base, perfect: true }, { assisted: false, revenge: false })).toBe('perfect');
    expect(gateOutcome(base, { assisted: true, revenge: false })).toBe('assisted');
    expect(gateOutcome(base, { assisted: false, revenge: true })).toBe('revenge');
    expect(gateOutcome({ ...base, passed: false }, { assisted: true, revenge: true })).toBe('fail');
  });
});

describe('sampleLowR', () => {
  it('draws without replacement, favoring low retrievability, deterministically', () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({ cardKey: `v-n5-00${i}#rec` as CardKey, itemId: `v-n5-00${i}`, kind: 'vocab' as const, facet: 'rec' as const, r: i / 10, mature: false, exposures: 3 }));
    const mk = () => {
      let x = 12345;
      return () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x / 2147483648;
      };
    };
    const a = sampleLowR(mk(), pool, 5);
    const b = sampleLowR(mk(), pool, 5);
    expect(a.map((c) => c.cardKey)).toEqual(b.map((c) => c.cardKey));
    expect(new Set(a.map((c) => c.cardKey)).size).toBe(5);
    expect(sampleLowR(mk(), pool, 50)).toHaveLength(10);
    const lowCount = a.filter((c) => c.r < 0.5).length;
    expect(lowCount).toBeGreaterThanOrEqual(3);
  });
});
