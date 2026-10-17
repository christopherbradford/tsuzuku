import { FIXTURE, V, createFakeLoader } from '../content/fixtures';
import { bus, type Events } from '../shared/events';
import { mulberry32 } from '../shared/hash';
import { epochDay } from '../shared/time';
import { STAT_KEYS as CONTRACT_KEYS } from '../shared/store-types';
import { STAT_KEYS, honesty, rollingMean, startStats, updateMedian } from './stats';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function graded(o: Partial<Events['attempt:graded']> = {}): Events['attempt:graded'] {
  return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1500, errorTags: [], sessionId: 's', exercise: 'meaning-recall', itemId: V.水, kind: 'vocab', facet: 'rec', cardKey: `${V.水}#rec`, rating: 3, mature: false, ippon: false, kiai: false, combo: 1, recovery: false, firstProd: false, ...o };
}

function finished(o: Partial<Events['session:finished']> = {}): Events['session:finished'] {
  return { planId: 'p', mode: 'kumite', startedAt: DEFAULT_TEST_NOW - 600_000, endedAt: DEFAULT_TEST_NOW, steps: [], tally: { reps: 20, correct: 18, accuracy: 0.9, bestCombo: 12, ippon: 1, xp: 50, minutes: 10, promotions: [], questsDone: [], backlogWaiting: 0 }, zen: false, resumed: false, ...o };
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('pure helpers', () => {
  it('STAT_KEYS is the contract list', () => {
    expect(STAT_KEYS).toBe(CONTRACT_KEYS);
    expect(STAT_KEYS).toContain('kanjiBrown');
    expect(STAT_KEYS).toContain('rapidBest');
  });

  it('updateMedian tracks the median of a skewed distribution within 10 %', () => {
    const rng = mulberry32(42);
    // Log-normal latencies: median e^8 ≈ 2981 ms.
    const sample = (): number => {
      let u = 0;
      while (u === 0) u = rng();
      const v = rng();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.exp(8 + 0.5 * z);
    };
    const trueMedian = Math.exp(8);
    let est: number | undefined;
    const tail: number[] = [];
    for (let i = 0; i < 600; i++) {
      est = updateMedian(est, sample());
      if (i >= 400) tail.push(est);
    }
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(Math.abs(mean - trueMedian) / trueMedian).toBeLessThan(0.1);
    expect(Math.abs((est as number) - trueMedian) / trueMedian).toBeLessThan(0.12);
    // Converges from a wrong start.
    let e2 = 500;
    for (let i = 0; i < 300; i++) e2 = updateMedian(e2, sample());
    expect(Math.abs(e2 - trueMedian) / trueMedian).toBeLessThan(0.12);
    expect(updateMedian(undefined, 1234)).toBe(1234);
    expect(updateMedian(1000, 0)).toBe(1000);
    expect(updateMedian(1000, Number.NaN)).toBe(1000);
  });

  it('rollingMean is exact inside the window and honesty reads the counters', () => {
    let h = 0;
    const seq = [1, 1, 0, 1];
    seq.forEach((x, i) => {
      h = rollingMean(h, x, i + 1);
    });
    expect(h).toBeCloseTo(0.75, 10);
    const m = store.meta();
    expect(honesty(m)).toBeNull();
    expect(honesty({ ...m, stats: { ...m.stats, judgeChecks: 4, honesty: 0.75 } })).toBe(0.75);
  });
});

describe('startStats reducer', () => {
  let stop: () => void = () => undefined;
  afterEach(() => stop());

  it('a daily row appears on the first rep of the day; reviews/ippon/recoveries count; arcade is excluded', async () => {
    await makeTestStore();
    stop = startStats(store);
    expect(store.daily.value[TODAY]).toBeUndefined();
    bus.emit('attempt:graded', graded({ combo: 3 }));
    expect(store.daily.value[TODAY]).toEqual({ reps: 1, ok: 1, minutes: 0, xp: 0, input: 0 });
    bus.emit('attempt:graded', graded({ correct: false, rating: 1, combo: 0 }));
    bus.emit('attempt:graded', graded({ ippon: true, mature: true, combo: 1 }));
    bus.emit('attempt:graded', graded({ recovery: true, combo: 4 }));
    bus.emit('attempt:graded', graded({ exercise: 'rapid-fire', rating: null, combo: 99 }));
    bus.emit('attempt:graded', graded({ exercise: 'minimal-pair', rating: null, combo: 2 }));
    const s = store.stats.value;
    expect(s.reviews).toBe(4);
    expect(s.ippon).toBe(1);
    expect(s.recoveries).toBe(1);
    expect(s.bestCombo).toBe(4);
    expect(s.minimalPairTrials).toBe(1);
    expect(s.minimalPairCorrect).toBe(1);
    expect(store.daily.value[TODAY].reps).toBe(5);
    expect(store.daily.value[TODAY].ok).toBe(4);
    bus.emit('xp:gained', { amount: 7, reason: 'review', total: 7 });
    expect(store.daily.value[TODAY].xp).toBe(7);
  });

  it('sessions, zen, minutes, unscathed kata, bestCombo from the tally (arcade modes excluded)', async () => {
    await makeTestStore();
    stop = startStats(store);
    const ok = { stepId: 'x', cardKey: null, rating: 3 as const, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 2, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1, errorTags: [] };
    bus.emit('session:finished', finished({ mode: 'kata', zen: true, steps: Array.from({ length: 15 }, () => ok) }));
    bus.emit('session:finished', finished({ mode: 'rapid', tally: { ...finished().tally, bestCombo: 70 } }));
    const s = store.stats.value;
    expect(s.sessions).toBe(2);
    expect(s.zenSessions).toBe(1);
    expect(s.minutes).toBe(20);
    expect(s.katasUnscathed).toBe(1);
    expect(s.bestCombo).toBe(12);
    expect(store.daily.value[TODAY].minutes).toBe(20);
  });

  it('medianMs per drill, honesty window over Judge checks', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('attempt:graded', graded({ ms: 2000 }));
    expect(store.medianMs.value['meaning-recall']).toBe(2000);
    bus.emit('attempt:graded', graded({ ms: 4000 }));
    expect(store.medianMs.value['meaning-recall']).toBe(2100);
    bus.emit('attempt:graded', graded({ ms: 0 }));
    bus.emit('attempt:graded', graded({ ms: 9000, guard: true, correct: false, rating: 1 }));
    expect(store.medianMs.value['meaning-recall']).toBe(2100);
    bus.emit('attempt:graded', graded({ exercise: 'meaning-judge', judge: 'pass' }));
    bus.emit('attempt:graded', graded({ exercise: 'meaning-judge', judge: 'pass' }));
    bus.emit('attempt:graded', graded({ exercise: 'meaning-judge', judge: 'fail', correct: false, rating: 1 }));
    const s = store.stats.value;
    expect(s.judgeChecks).toBe(3);
    expect(s.judgePasses).toBe(2);
    expect(honesty(store.meta())).toBeCloseTo(2 / 3, 3);
  });

  it('item events: introduced, promoted to brown per kind (katakana via the loader), black', async () => {
    const fake = createFakeLoader();
    expect(fake.get(V.コーヒー)).toBeDefined();
    await makeTestStore();
    stop = startStats(store, { lookup: (id) => fake.get(id) });
    bus.emit('item:introduced', { itemId: V.水, kind: 'vocab', station: 1 });
    bus.emit('item:promoted', { itemId: V.水, kind: 'vocab', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: V.コーヒー, kind: 'vocab', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: 'j-食', kind: 'kanji', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: 'g-n5-001', kind: 'grammar', from: 'yellow', to: 'black' });
    bus.emit('item:promoted', { itemId: 'k-h-a', kind: 'kana', from: 'green', to: 'brown' });
    bus.emit('item:promoted', { itemId: V.水, kind: 'vocab', from: 'brown', to: 'black' });
    bus.emit('item:promoted', { itemId: V.犬, kind: 'vocab', from: 'white', to: 'yellow' });
    const s = store.stats.value;
    expect(s.itemsIntroduced).toBe(1);
    expect(s.vocabBrown).toBe(2);
    expect(s.katakanaBrown).toBe(1);
    expect(s.kanjiBrown).toBe(1);
    expect(s.grammarBrown).toBe(1);
    expect(s.kanaBrown).toBe(1);
    expect(s.itemsBlack).toBe(2);
    expect(FIXTURE.items[V.コーヒー]).toBeDefined();
  });

  it('input, output and arcade counters', async () => {
    await makeTestStore();
    stop = startStats(store);
    bus.emit('scroll:completed', { scrollId: '4-1', itemIds: [], flawless: true });
    bus.emit('michikusa:read', { id: 'm-04-1' });
    bus.emit('story:read', { storyId: 's', mode: 'read', chars: 350, cpm: 120, correct: 3, total: 3, glossTaps: 1, minutes: 4, bridge: false });
    bus.emit('story:read', { storyId: 's', mode: 'read', chars: 350, cpm: 120, correct: 1, total: 3, glossTaps: 5, minutes: 4, bridge: false });
    bus.emit('story:read', { storyId: 's', mode: 'speed', chars: 350, cpm: 320, correct: 1, total: 1, glossTaps: 0, minutes: 1, bridge: false });
    bus.emit('story:read', { storyId: 's', mode: 'speed', chars: 350, cpm: 900, correct: 0, total: 1, glossTaps: 0, minutes: 1, bridge: false });
    bus.emit('listening:set', { storyId: 's', correct: 3, total: 3, rate: 1.25, minutes: 5 });
    bus.emit('listening:set', { storyId: 's', correct: 1, total: 3, rate: 1.25, minutes: 5 });
    bus.emit('line:scored', { kind: 'dictation', score: 0.97, pass: true, tier: 3 });
    bus.emit('line:scored', { kind: 'dictation', score: 0.97, pass: true, tier: 1 });
    bus.emit('line:scored', { kind: 'shadow', score: 0.9, pass: true });
    bus.emit('line:scored', { kind: 'shadow', score: 0.3, pass: false });
    bus.emit('roleplay:done', { storyId: 's', best: 5, total: 5, aizuchiHit: 4, aizuchiTotal: 5, registerOk: true });
    bus.emit('output:done', { kind: 'three-ways', registersCorrect: 3 });
    bus.emit('output:done', { kind: 'monologue', seconds: 60, words: 85 });
    bus.emit('output:done', { kind: 'reduce-expand' });
    bus.emit('output:done', { kind: 'writing' });
    bus.emit('weak-point:set-done', { tag: 'particle' });
    bus.emit('arcade:done', { mode: 'rapid', correct: 33, misses: 2, ms: 60_000, recheck: [] });
    bus.emit('arcade:done', { mode: 'gojuon', correct: 46, misses: 0, ms: 55_000, recheck: [] });
    bus.emit('nemesis:defeated', { itemId: V.水 });
    bus.emit('kage:result', { week: 1, score: 1, beat: true });
    bus.emit('gate:result', { station: 4, outcome: 'revenge', score: 1, phases: [] });
    bus.emit('field-mission:done', { tier: 5, minutes: 15, conversation: true });
    bus.emit('welcome-back:done', {});
    bus.emit('quest:completed', { id: 'learn-scroll', allDone: true });
    bus.emit('ledger:entry', { minutes: 12, kind: 0, source: 1 });
    const s = store.stats.value;
    expect(s).toMatchObject({
      scrolls: 1,
      scrollsFlawless: 1,
      michikusaRead: 1,
      episodesRead: 1,
      episodesDictionaryFree: 1,
      speedReads: 2,
      speedReadBestCpm: 320,
      listeningSets: 2,
      listeningFastPasses: 1,
      dictationLines: 2,
      dictation95at1x: 1,
      shadowLines: 2,
      shadowPass: 1,
      rolePlays: 1,
      rolePlaysAllBest: 1,
      rolePlaysAizuchi: 1,
      threeWays: 1,
      threeWaysCorrect: 1,
      monologues: 1,
      monologueBestWords: 85,
      reduceExpand: 1,
      writings: 1,
      weakSetsCleared: 1,
      rapidRuns: 1,
      rapidBest: 33,
      gojuonRuns: 1,
      gojuonBest: 46,
      gojuonPerfects: 1,
      nemesisDefeated: 1,
      kageRuns: 1,
      revengeWins: 1,
      fieldMissions: 1,
      conversations: 1,
      comebacks: 1,
      fullDays: 1,
    });
    expect(store.daily.value[TODAY].input).toBe(12);
  });
});
