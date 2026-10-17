/**
 * apply.ts — the impure writer, over `makeTestStore` + `bus.reset()`.
 */
import type { CardKey } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import { CardFlag, hasFlag, type CardTuple } from '../shared/store-types';
import type { AttemptResult, KiaiState, Step } from '../shared/session-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { W, round2 } from './fsrs';
import { kiaiInit } from './kiai';
import { NEMESIS_LAPSES } from './leech';
import { ARCHIVE_THRESHOLDS } from './scheduler';
import {
  IMPLICIT_DUE_WINDOW,
  defeatNemesis,
  introduceItem,
  markKnown,
  recordAttempt,
  recordImplicit,
  retireItem,
} from './apply';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const SESSION = 'sess-1';

function step(o: Partial<Step> & { cardKey?: CardKey | null }): Step {
  const cardKey = o.cardKey ?? null;
  const itemId = o.itemId ?? (cardKey ? cardKey.split('#')[0]! : null);
  return {
    id: o.id ?? 'st-1',
    block: o.block ?? 'reviews',
    exercise: o.exercise ?? 'meaning-recall',
    itemId,
    cardKey,
    params: o.params ?? {},
    timed: o.timed ?? false,
    isNew: o.isNew ?? false,
    stepTag: o.stepTag ?? null,
    exposures: o.exposures ?? 5,
    estMs: o.estMs ?? 6000,
  };
}

function attempt(o: Partial<AttemptResult> = {}): AttemptResult {
  return {
    correct: true,
    nearMiss: false,
    hintUsed: false,
    guard: false,
    timedOut: false,
    ms: 2500,
    errorTags: [],
    ...o,
  };
}

/** A reviewed card in review state, last reviewed yesterday. */
function live(s: number, extra: Partial<{ due: number; reps: number; lapses: number; flags: number; d: number; last: number; state: 0 | 1 | 2 | 3 }> = {}): CardTuple {
  return card({
    due: extra.due ?? TODAY,
    s,
    d: extra.d ?? 5,
    reps: extra.reps ?? 5,
    lapses: extra.lapses ?? 0,
    state: extra.state ?? 2,
    last: extra.last ?? TODAY - 1,
    flags: extra.flags ?? 0,
  });
}

const named = (events: [string, unknown][], name: string): unknown[] => events.filter((e) => e[0] === name).map((e) => e[1]);

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('recordAttempt — new cards', () => {
  it('a Good on a new rec card creates the card, logs, emits attempt:graded with mature=false', async () => {
    await makeTestStore();
    const cap = captureEvents();
    const key: CardKey = 'v-n5-0001#rec';
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: key, isNew: true, stepTag: 'intro' }), result: attempt() });
    cap.stop();

    expect(r.rating).toBe(3);
    expect(r.logged).toBe(true);
    expect(r.mature).toBe(false);
    expect(r.prev).toBeNull();
    const c = store.cards.get(key)!;
    expect(c).toBeDefined();
    expect(c[1]).toBeCloseTo(W[2]!, 2);
    expect(c[3]).toBe(1);
    expect(c[5]).toBe(1);
    expect(hasFlag(c[7], CardFlag.stepPending)).toBe(true);
    expect(r.stepOffsets).toEqual([3, 10]);
    expect(store.log.forCard(key)).toHaveLength(1);
    expect(store.log.forCard(key)[0]![2]).toBe(3);

    const graded = named(cap.events, 'attempt:graded') as { rating: number; mature: boolean; kind: string; facet: string; itemId: string; firstProd: boolean }[];
    expect(graded).toHaveLength(1);
    expect(graded[0]).toMatchObject({ rating: 3, mature: false, kind: 'vocab', facet: 'rec', itemId: 'v-n5-0001', firstProd: false, cardKey: key });
  });

  it('a Good on a fresh rec card crosses S ≥ 2 d and warm-starts listen (0.5 × S_rec, D_rec, review state, due today)', async () => {
    await makeTestStore();
    const key: CardKey = 'v-n5-0001#rec';
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: key }), result: attempt() });
    const rec = store.cards.get(key)!;
    const listen = store.cards.get('v-n5-0001#listen');
    expect(r.unlocked).toEqual(['v-n5-0001#listen']);
    expect(listen).toBeDefined();
    expect(listen![1]).toBe(round2(rec[1] * 0.5));
    expect(listen![2]).toBe(rec[2]);
    expect(listen![5]).toBe(2);
    expect(listen![0]).toBe(TODAY);
    expect(listen![3]).toBe(0);
    // prod needs S ≥ 4 d; not yet
    expect(store.cards.get('v-n5-0001#prod')).toBeUndefined();
  });

  it('accepts the (step, result, ctx) call shape', async () => {
    await makeTestStore();
    const r = recordAttempt(step({ cardKey: 'v-n5-0002#rec' }), attempt(), { sessionId: SESSION });
    expect(r.rating).toBe(3);
    expect(r.stepId).toBe('st-1');
    expect(store.cards.get('v-n5-0002#rec')).toBeDefined();
  });
});

describe('recordAttempt — promotion', () => {
  it('emits item:promoted once when the base facet crosses a belt threshold', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(6.5, { due: TODAY, last: TODAY - 7 }) } });
    const cap = captureEvents();
    const r1 = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt() });
    expect(r1.promoted).toEqual({ from: 'yellow', to: 'green' });
    expect(r1.promotion).toBe('green');
    // Same-day second Good: no second promotion.
    const r2 = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt() });
    expect(r2.promoted).toBeUndefined();
    cap.stop();
    const promos = named(cap.events, 'item:promoted');
    expect(promos).toHaveLength(1);
    expect(promos[0]).toEqual({ itemId: 'v-n5-0001', kind: 'vocab', from: 'yellow', to: 'green' });
  });

  it('a first Good on a new card promotes white → yellow (S₀ = w[2] ≥ 1 d)', async () => {
    await makeTestStore();
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt() });
    expect(r.promoted).toEqual({ from: 'white', to: 'yellow' });
  });

  it('demotions are never announced', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(8, { due: TODAY, last: TODAY - 8 }) } });
    const cap = captureEvents();
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt({ correct: false }) });
    cap.stop();
    expect(r.rating).toBe(1);
    expect(r.promoted).toBeUndefined();
    expect(named(cap.events, 'item:promoted')).toHaveLength(0);
  });
});

describe('recordAttempt — arcade and recheck', () => {
  it('Rapid Fire correct writes nothing (no card change, no log) but still emits attempt:graded with rating null', async () => {
    const before = live(30, { due: TODAY + 10, last: TODAY - 20 });
    await makeTestStore({ cards: { 'v-n5-0001#rec': before } });
    const cap = captureEvents();
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec', exercise: 'rapid-fire', timed: true }), result: attempt({ ms: 900 }) });
    cap.stop();
    expect(r.rating).toBeNull();
    expect(r.logged).toBe(false);
    expect(store.cards.get('v-n5-0001#rec')).toEqual(before);
    expect(store.log.forCard('v-n5-0001#rec')).toHaveLength(0);
    const graded = named(cap.events, 'attempt:graded') as { rating: number | null }[];
    expect(graded).toHaveLength(1);
    expect(graded[0]!.rating).toBeNull();
  });

  it('Rapid Fire correct on a Kaiden card logs Good', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(200, { due: TODAY + 100, last: TODAY - 100, flags: CardFlag.kaiden }) } });
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec', exercise: 'rapid-fire' }), result: attempt({ ms: 900 }) });
    expect(r.rating).toBe(3);
    expect(r.logged).toBe(true);
  });

  it('an arcade miss sets the recheck flag and rates nothing', async () => {
    const before = live(30, { due: TODAY + 10, last: TODAY - 20 });
    await makeTestStore({ cards: { 'k-h-a#rec': before } });
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'k-h-a#rec', exercise: 'gojuon-fighter' }), result: attempt({ correct: false, ms: 3500 }) });
    expect(r.rating).toBeNull();
    expect(r.recheckSet).toBe(true);
    expect(r.logged).toBe(false);
    const c = store.cards.get('k-h-a#rec')!;
    expect(hasFlag(c[7], CardFlag.recheck)).toBe(true);
    expect(c.slice(0, 7)).toEqual(before.slice(0, 7));
  });

  it('the untimed recheck step clears the flag: correct → Good, wrong → Again', async () => {
    await makeTestStore({
      cards: {
        'k-h-a#rec': live(30, { due: TODAY, last: TODAY - 30, flags: CardFlag.recheck }),
        'k-h-i#rec': live(30, { due: TODAY, last: TODAY - 30, flags: CardFlag.recheck }),
      },
    });
    const ok = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'k-h-a#rec', exercise: 'kana-flash', params: { recheck: true } }), result: attempt() });
    expect(ok.rating).toBe(3);
    expect(hasFlag(store.cards.get('k-h-a#rec')![7], CardFlag.recheck)).toBe(false);
    const bad = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'k-h-i#rec', exercise: 'kana-flash', params: { recheck: true } }), result: attempt({ correct: false }) });
    expect(bad.rating).toBe(1);
    expect(hasFlag(store.cards.get('k-h-i#rec')![7], CardFlag.recheck)).toBe(false);
    expect(store.cards.get('k-h-i#rec')![4]).toBe(1);
  });
});

describe('recordAttempt — Guard and lapses', () => {
  it('Guard on a card with < 3 reviews is a learning-step miss: no lapse, learning state, returns at +3', async () => {
    // A warm-started facet: review state, 0 reps.
    await makeTestStore({ cards: { 'v-n5-0001#listen': live(1.5, { reps: 0, state: 2, due: TODAY, last: TODAY - 1 }) } });
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#listen', exercise: 'audio-flash' }), result: attempt({ correct: false, guard: true }) });
    expect(r.rating).toBe(1);
    expect(r.grade.stepMiss).toBe(true);
    expect(r.stepOffsets).toEqual([3]);
    const c = store.cards.get('v-n5-0001#listen')!;
    expect(c[4]).toBe(0);
    expect(c[5]).toBe(1);
    expect(hasFlag(c[7], CardFlag.stepPending)).toBe(true);
    expect(c[3]).toBe(1);
  });

  it('Guard on a card with ≥ 3 reviews is Again: lapse counted, relearning, returns at +5', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(20, { reps: 6, due: TODAY, last: TODAY - 20 }) } });
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt({ correct: false, guard: true }) });
    expect(r.rating).toBe(1);
    expect(r.grade.stepMiss).toBe(false);
    expect(r.stepOffsets).toEqual([5]);
    const c = store.cards.get('v-n5-0001#rec')!;
    expect(c[4]).toBe(1);
    expect(c[5]).toBe(3);
  });

  it('the 8th lapse marks the card a Nemesis', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(5, { reps: 20, lapses: NEMESIS_LAPSES - 1, due: TODAY, last: TODAY - 5 }) } });
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt({ correct: false }) });
    expect(r.nemesis).toBe(true);
    const c = store.cards.get('v-n5-0001#rec')!;
    expect(c[4]).toBe(NEMESIS_LAPSES);
    expect(hasFlag(c[7], CardFlag.nemesis)).toBe(true);
  });

  it('Judge fail forces Again on a self-rated Good', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(10, { due: TODAY, last: TODAY - 10 }) } });
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec', exercise: 'meaning-judge' }), result: attempt({ selfRating: 3 }), judge: 'fail' });
    expect(r.rating).toBe(1);
    expect(store.cards.get('v-n5-0001#rec')![4]).toBe(1);
  });
});

describe('recordAttempt — archive, Kaiden, firstProd', () => {
  it('a kana card crossing S > 180 d is archived', async () => {
    await makeTestStore({ cards: { 'k-h-a#rec': live(ARCHIVE_THRESHOLDS.kana - 1, { reps: 12, due: TODAY, last: TODAY - 170 }) } });
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'k-h-a#rec', exercise: 'kana-flash' }), result: attempt() });
    expect(r.archived).toBe(true);
    expect(hasFlag(store.cards.get('k-h-a#rec')![7], CardFlag.archived)).toBe(true);
  });

  it('the Kaiden flag is set on every facet once all facets reach S ≥ 120 d', async () => {
    await makeTestStore({
      cards: {
        'v-n5-0001#rec': live(119, { reps: 10, due: TODAY, last: TODAY - 119 }),
        'v-n5-0001#listen': live(130, { reps: 10, due: TODAY + 10, last: TODAY - 100 }),
        'v-n5-0001#prod': live(125, { reps: 10, due: TODAY + 10, last: TODAY - 100 }),
      },
    });
    recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt() });
    for (const f of ['rec', 'listen', 'prod'] as const) {
      expect(hasFlag(store.cards.get(`v-n5-0001#${f}`)![7], CardFlag.kaiden)).toBe(true);
    }
  });

  it('firstProd is true on the first Good of the production facet and false afterwards', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(10, { due: TODAY + 5, last: TODAY - 5 }), 'v-n5-0001#prod': live(3, { reps: 0, due: TODAY, last: TODAY - 1 }) } });
    const cap = captureEvents();
    const r1 = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#prod', exercise: 'production-forge' }), result: attempt() });
    const r2 = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#prod', exercise: 'production-forge' }), result: attempt() });
    cap.stop();
    expect(r1.firstProd).toBe(true);
    expect(r2.firstProd).toBe(false);
    const graded = named(cap.events, 'attempt:graded') as { firstProd: boolean }[];
    expect(graded.map((g) => g.firstProd)).toEqual([true, false]);
  });

  it('a chunk (vocab id with only a prod card) is graded as kind chunk', async () => {
    await makeTestStore({ cards: { 'v-n5-0100#prod': live(2, { due: TODAY, last: TODAY - 1 }) } });
    const cap = captureEvents();
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0100#prod', exercise: 'shadow' }), result: attempt({ score: 0.9 }) });
    cap.stop();
    expect(r.kind).toBe('chunk');
    expect(r.rating).toBe(3);
    expect((named(cap.events, 'attempt:graded')[0] as { kind: string }).kind).toBe('chunk');
  });
});

describe('recordAttempt — steps without a card', () => {
  it('ungraded steps emit attempt:graded with null card facts and write nothing', async () => {
    await makeTestStore();
    const cap = captureEvents();
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: null, itemId: 's-04-1', exercise: 'listening-set', block: 'input' }), result: attempt() });
    cap.stop();
    expect(r.rating).toBeNull();
    expect(r.card).toBeNull();
    expect(store.cards.count()).toBe(0);
    expect(named(cap.events, 'attempt:graded')[0]).toMatchObject({ itemId: 's-04-1', kind: null, facet: null, cardKey: null, rating: null });
  });
});

describe('recordAttempt — implicit side grades', () => {
  it('applies implicit grades to cards due within 3 days and skips the rest', async () => {
    await makeTestStore({
      cards: {
        'v-n5-0001#listen': live(5, { due: TODAY + IMPLICIT_DUE_WINDOW, last: TODAY - 2 }),
        'v-n5-0002#listen': live(5, { due: TODAY + IMPLICIT_DUE_WINDOW + 1, last: TODAY - 2 }),
      },
    });
    const r = recordAttempt({
      sessionId: SESSION,
      step: step({ cardKey: null, itemId: 's-04-1', exercise: 'sentence-listen', block: 'input' }),
      result: attempt({
        score: 0.97,
        implicit: [
          { cardKey: 'v-n5-0001#listen', rating: 3 },
          { cardKey: 'v-n5-0002#listen', rating: 3 },
          { cardKey: 'v-n5-9999#listen', rating: 3 },
        ],
      }),
    });
    expect(r.implicitApplied).toEqual(['v-n5-0001#listen']);
    expect(store.cards.get('v-n5-0001#listen')![3]).toBe(6);
    expect(store.cards.get('v-n5-0002#listen')![3]).toBe(5);
    expect(store.log.forCard('v-n5-0001#listen')).toHaveLength(1);
    expect(store.cards.get('v-n5-9999#listen')).toBeUndefined();
  });

  it('recordImplicit writes card + log and announces a promotion but never attempt:graded', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(6.5, { due: TODAY, last: TODAY - 7 }) } });
    const cap = captureEvents();
    const r = recordImplicit({ cardKey: 'v-n5-0001#rec', rating: 3, exercise: 'story-read', sessionId: SESSION });
    cap.stop();
    expect(r).not.toBeNull();
    expect(r!.promoted).toEqual({ from: 'yellow', to: 'green' });
    expect(named(cap.events, 'attempt:graded')).toHaveLength(0);
    expect(named(cap.events, 'item:promoted')).toHaveLength(1);
    expect(store.log.forCard('v-n5-0001#rec')).toHaveLength(1);
  });

  it('recordImplicit on a missing card is a no-op', async () => {
    await makeTestStore();
    expect(recordImplicit({ cardKey: 'v-n5-0001#rec', rating: 3, exercise: 'story-read', sessionId: SESSION })).toBeNull();
    expect(store.cards.count()).toBe(0);
  });
});

describe('recordAttempt — kiai and XP capture', () => {
  it('runs kiaiStep when a KiaiState is given: combo climbs on a correct, resets on a clean miss', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(20, { reps: 8, due: TODAY, last: TODAY - 20 }), 'v-n5-0002#rec': live(20, { reps: 8, due: TODAY, last: TODAY - 20 }) } });
    const k0: KiaiState = { ...kiaiInit(), combo: 4, ki: 20 };
    const r1 = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt(), kiai: k0, repIndex: 3 });
    expect(r1.combo).toBe(5);
    expect(r1.ki).toBe(28);
    expect(r1.kiaiState!.combo).toBe(5);
    const r2 = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0002#rec' }), result: attempt({ correct: false }), kiai: r1.kiaiState!, repIndex: 4 });
    expect(r2.combo).toBe(0);
    expect(r2.kiaiResult!.comboBroken).toBe(true);
    expect(r2.kiaiState!.recoveryQueue.map((q) => q.cardKey)).toEqual(['v-n5-0002#rec']);
    expect(r2.kiaiState!.recoveryQueue[0]!.at).toBeGreaterThanOrEqual(7);
    expect(r2.kiaiState!.recoveryQueue[0]!.at).toBeLessThanOrEqual(12);
  });

  it('emits kiai:entered when ki reaches 100 and attempt:graded carries the kiai facts', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(20, { reps: 8, due: TODAY, last: TODAY - 20 }) } });
    const cap = captureEvents();
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt(), kiai: { ...kiaiInit(), ki: 95, combo: 9 } });
    cap.stop();
    expect(r.kiaiResult!.kiaiEntered).toBe(true);
    expect(named(cap.events, 'kiai:entered')).toHaveLength(1);
    expect(named(cap.events, 'attempt:graded')[0]).toMatchObject({ combo: 10, kiai: false, ippon: false, recovery: false });
  });

  it('without a KiaiState the kiai fields are zero/false', async () => {
    await makeTestStore();
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt() });
    expect(r.ki).toBe(0);
    expect(r.combo).toBe(0);
    expect(r.ippon).toBe(false);
    expect(r.kiai).toBe(false);
    expect(r.kiaiState).toBeUndefined();
  });

  it('xpDelta is the XP B grants synchronously during the emits (0 with no reducers)', async () => {
    await makeTestStore();
    const r0 = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0001#rec' }), result: attempt() });
    expect(r0.xpDelta).toBe(0);
    // A fake XP reducer.
    bus.on('attempt:graded', (p) => {
      if (p.rating !== null) bus.emit('xp:gained', { amount: 2, reason: 'review', total: 2 });
    });
    bus.on('item:promoted', () => bus.emit('xp:gained', { amount: 5, reason: 'promotion', total: 7 }));
    const r = recordAttempt({ sessionId: SESSION, step: step({ cardKey: 'v-n5-0002#rec' }), result: attempt() });
    expect(r.promoted).toEqual({ from: 'white', to: 'yellow' });
    expect(r.xpDelta).toBe(7);
    // Later XP is not attributed to this rep.
    bus.emit('xp:gained', { amount: 100, reason: 'other', total: 107 });
    expect(r.xpDelta).toBe(7);
  });
});

describe('introduceItem / markKnown / retireItem / defeatNemesis', () => {
  it('introduceItem creates the initial facets due today and emits item:introduced; idempotent', async () => {
    await makeTestStore();
    const cap = captureEvents();
    const keys = introduceItem('k-h-a', 'kana', 1);
    expect(keys).toEqual(['k-h-a#rec', 'k-h-a#prod']);
    expect(store.cards.get('k-h-a#rec')).toEqual([TODAY, 0, 0, 0, 0, 0, TODAY, 0]);
    expect(introduceItem('k-h-a', 'kana', 1)).toEqual([]);
    expect(introduceItem('j-食', 'kanji', 4)).toEqual(['j-食#comp']);
    expect(introduceItem('g-n5-001', 'grammar', 4)).toEqual(['g-n5-001#cloze']);
    expect(introduceItem('v-n5-0100', 'chunk', 4)).toEqual(['v-n5-0100#prod']);
    cap.stop();
    const intro = named(cap.events, 'item:introduced');
    expect(intro).toHaveLength(4);
    expect(intro[0]).toEqual({ itemId: 'k-h-a', kind: 'kana', station: 1 });
  });

  it('markKnown starts every initial facet Easy (S₀ = w[3], review state, no steps) and records kana as 既知', async () => {
    await makeTestStore();
    const cap = captureEvents();
    const keys = markKnown('k-h-a', 'kana');
    cap.stop();
    expect(keys).toEqual(['k-h-a#rec', 'k-h-a#prod']);
    const c = store.cards.get('k-h-a#rec')!;
    expect(c[1]).toBeCloseTo(W[3]!, 2);
    expect(c[5]).toBe(2);
    expect(hasFlag(c[7], CardFlag.stepPending)).toBe(false);
    expect(c[0]).toBeGreaterThan(TODAY);
    expect(store.profile.value.kanaKnown).toEqual(['k-h-a']);
    expect(named(cap.events, 'item:introduced')).toEqual([{ itemId: 'k-h-a', kind: 'kana', station: store.progress.value.station }]);
    // Reviewed cards are left alone; kanaKnown stays unique.
    markKnown('k-h-a', 'kana');
    expect(store.profile.value.kanaKnown).toEqual(['k-h-a']);
    expect(store.cards.get('k-h-a#rec')).toEqual(c);
  });

  it('retireItem archives every card (reversible)', async () => {
    await makeTestStore({ cards: { 'v-n5-0001#rec': live(10), 'v-n5-0001#listen': live(5) } });
    expect(retireItem('v-n5-0001')).toEqual(['v-n5-0001#rec', 'v-n5-0001#listen']);
    expect(hasFlag(store.cards.get('v-n5-0001#rec')![7], CardFlag.archived)).toBe(true);
    expect(retireItem('v-n5-0001')).toEqual([]);
    expect(retireItem('v-n5-0001', false)).toHaveLength(2);
    expect(hasFlag(store.cards.get('v-n5-0001#listen')![7], CardFlag.archived)).toBe(false);
  });

  it('defeatNemesis rewrites the flagged cards and emits nemesis:defeated', async () => {
    await makeTestStore({
      cards: {
        'v-n5-0001#rec': live(2, { lapses: 9, flags: CardFlag.nemesis }),
        'v-n5-0001#listen': live(5),
      },
    });
    const cap = captureEvents();
    expect(defeatNemesis('v-n5-0001')).toEqual(['v-n5-0001#rec']);
    cap.stop();
    const c = store.cards.get('v-n5-0001#rec')!;
    expect(hasFlag(c[7], CardFlag.nemesis)).toBe(false);
    expect(c[1]).toBe(3);
    expect(c[4]).toBe(0);
    expect(named(cap.events, 'nemesis:defeated')).toEqual([{ itemId: 'v-n5-0001' }]);
    expect(defeatNemesis('v-n5-0002')).toEqual([]);
  });
});
