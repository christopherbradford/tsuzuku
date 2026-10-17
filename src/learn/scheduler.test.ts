import type { VocabItem } from '../content/types';
import { CardFlag, hasFlag, type CardTuple } from '../shared/store-types';
import { mulberry32 } from '../shared/hash';
import { W } from './fsrs';
import {
  ARCHIVE_THRESHOLDS,
  KAIDEN_MAX_INTERVAL,
  UNLOCK_RULES,
  applyRating,
  facetsFor,
  hasPitchCard,
  initialFacets,
  isKaiden,
  kaidenQuota,
  kichiStart,
  newCard,
  shouldArchive,
  stepOffsetsFor,
  unlockableFacets,
  warmStart,
  withKaidenFlag,
} from './scheduler';

const TODAY = 20000;
const opts = { retention: 0.9, loadOnDay: () => 0, rng: () => 0.5 };
const card = (s: number, flags = 0, d = 5): CardTuple => [TODAY, s, d, 3, 0, 2, TODAY - 1, flags];

const vocab = (pitch?: number, conf?: 'high' | 'low'): VocabItem => ({
  id: 'v-n5-0001',
  word: '雨',
  kana: 'あめ',
  meanings: ['rain'],
  pos: 'n',
  jlpt: 5,
  tags: ['weather'],
  examples: [{ ja: '{雨|あめ}が{降|ふ}る。', kana: 'あめがふる。', en: 'It rains.' }],
  ...(pitch !== undefined ? { pitch } : {}),
  ...(conf !== undefined ? { pitchConfidence: conf } : {}),
});

describe('facets per kind (design 05 §2)', () => {
  it('initial facets', () => {
    expect(initialFacets('kana')).toEqual(['rec', 'prod']);
    expect(initialFacets('component')).toEqual(['rec']);
    expect(initialFacets('vocab')).toEqual(['rec']);
    expect(initialFacets('kanji')).toEqual(['comp']);
    expect(initialFacets('grammar')).toEqual(['cloze']);
    expect(initialFacets('chunk')).toEqual(['prod']);
  });
  it('all facets, pitch only with high confidence', () => {
    expect(facetsFor('vocab')).toEqual(['rec', 'listen', 'prod']);
    expect(facetsFor('vocab', vocab(1, 'low'))).toEqual(['rec', 'listen', 'prod']);
    expect(facetsFor('vocab', vocab(1, 'high'))).toEqual(['rec', 'listen', 'prod', 'pitch']);
    expect(facetsFor('kanji')).toEqual(['comp', 'read']);
    expect(facetsFor('grammar')).toEqual(['cloze', 'prod']);
    expect(facetsFor('kana')).toEqual(['rec', 'prod']);
    expect(facetsFor('chunk')).toEqual(['prod']);
    expect(hasPitchCard(undefined)).toBe(false);
    expect(hasPitchCard(vocab(0, 'high'))).toBe(true);
  });
});

describe('unlock thresholds and warm-start factors', () => {
  it('the rule table matches design 05 §2', () => {
    expect(UNLOCK_RULES.map((r) => [r.kind, r.facet, r.from, r.minS, r.factor])).toEqual([
      ['vocab', 'listen', 'rec', 2, 0.5],
      ['vocab', 'prod', 'rec', 4, 0.3],
      ['vocab', 'pitch', 'prod', 7, 0.5],
      ['kanji', 'read', 'comp', 1, 0.5],
      ['grammar', 'prod', 'cloze', 7, 0.4],
    ]);
  });
  it('vocab: listen at rec S ≥ 2, prod at rec S ≥ 4', () => {
    expect(unlockableFacets('v', 'vocab', undefined, { rec: card(1.99) })).toEqual([]);
    expect(unlockableFacets('v', 'vocab', undefined, { rec: card(2) })).toEqual([{ facet: 'listen', from: 'rec', factor: 0.5 }]);
    expect(unlockableFacets('v', 'vocab', undefined, { rec: card(4) })).toEqual([
      { facet: 'listen', from: 'rec', factor: 0.5 },
      { facet: 'prod', from: 'rec', factor: 0.3 },
    ]);
    expect(unlockableFacets('v', 'vocab', undefined, { rec: card(4), listen: card(1) })).toEqual([{ facet: 'prod', from: 'rec', factor: 0.3 }]);
  });
  it('pitch only when prod S ≥ 7 and pitchConfidence is high', () => {
    const cards = { rec: card(30), listen: card(10), prod: card(7) };
    expect(unlockableFacets('v', 'vocab', vocab(1, 'high'), cards)).toEqual([{ facet: 'pitch', from: 'prod', factor: 0.5 }]);
    expect(unlockableFacets('v', 'vocab', vocab(1, 'low'), cards)).toEqual([]);
    expect(unlockableFacets('v', 'vocab', vocab(), cards)).toEqual([]);
    expect(unlockableFacets('v', 'vocab', undefined, cards)).toEqual([]);
    expect(unlockableFacets('v', 'vocab', vocab(1, 'high'), { ...cards, prod: card(6.9) })).toEqual([]);
  });
  it('kanji read at comp S ≥ 1; grammar prod at cloze S ≥ 7', () => {
    expect(unlockableFacets('j', 'kanji', undefined, { comp: card(0.9) })).toEqual([]);
    expect(unlockableFacets('j', 'kanji', undefined, { comp: card(1) })).toEqual([{ facet: 'read', from: 'comp', factor: 0.5 }]);
    expect(unlockableFacets('g', 'grammar', undefined, { cloze: card(6.99) })).toEqual([]);
    expect(unlockableFacets('g', 'grammar', undefined, { cloze: card(7) })).toEqual([{ facet: 'prod', from: 'cloze', factor: 0.4 }]);
  });
  it('kana, component and chunk never unlock more facets; a retired parent unlocks nothing', () => {
    expect(unlockableFacets('k', 'kana', undefined, { rec: card(100), prod: card(100) })).toEqual([]);
    expect(unlockableFacets('c', 'component', undefined, { rec: card(100) })).toEqual([]);
    expect(unlockableFacets('v', 'chunk', undefined, { prod: card(100) })).toEqual([]);
    expect(unlockableFacets('v', 'vocab', undefined, { rec: card(100, CardFlag.archived) })).toEqual([]);
  });
});

describe('cards', () => {
  it('newCard is due today, state 0, nothing reviewed', () => {
    expect(newCard(TODAY)).toEqual([TODAY, 0, 0, 0, 0, 0, TODAY, 0]);
  });
  it('warmStart copies 0.5 × S and the parent difficulty into a review-state card due today', () => {
    const parent: CardTuple = [TODAY + 9, 12.345, 6.2, 8, 1, 2, TODAY - 3, CardFlag.kaiden];
    expect(warmStart(parent, 0.5, TODAY)).toEqual([TODAY, 6.17, 6.2, 0, 0, 2, TODAY, 0]);
    expect(warmStart(parent, 0.3, TODAY)[1]).toBe(3.7);
    expect(warmStart([TODAY, 0.01, 0, 0, 0, 0, TODAY, 0], 0.5, TODAY)[1]).toBeGreaterThan(0);
  });
});

describe('archive thresholds (design 05 §8)', () => {
  it('kana > 180, component > 90, pitch > 90, nothing else', () => {
    expect(ARCHIVE_THRESHOLDS).toEqual({ kana: 180, component: 90, pitch: 90 });
    expect(shouldArchive('kana', 'rec', card(180))).toBe(false);
    expect(shouldArchive('kana', 'prod', card(180.01))).toBe(true);
    expect(shouldArchive('component', 'rec', card(90))).toBe(false);
    expect(shouldArchive('component', 'rec', card(91))).toBe(true);
    expect(shouldArchive('vocab', 'pitch', card(91))).toBe(true);
    expect(shouldArchive('vocab', 'pitch', card(90))).toBe(false);
    expect(shouldArchive('vocab', 'rec', card(5000))).toBe(false);
    expect(shouldArchive('kanji', 'read', card(5000))).toBe(false);
    expect(shouldArchive('grammar', 'cloze', card(5000))).toBe(false);
  });
});

describe('Kaiden lane', () => {
  it('isKaiden when every present facet has S ≥ 120', () => {
    expect(isKaiden({})).toBe(false);
    expect(isKaiden({ rec: card(120) })).toBe(true);
    expect(isKaiden({ rec: card(120), listen: card(119.99) })).toBe(false);
    expect(isKaiden({ rec: card(300), listen: card(120), prod: card(121), pitch: card(500) })).toBe(true);
  });
  it('quota is max(10, 15 % of the cap)', () => {
    expect(kaidenQuota(240)).toBe(36);
    expect(kaidenQuota(160)).toBe(24);
    expect(kaidenQuota(320)).toBe(48);
    expect(kaidenQuota(40)).toBe(10);
    expect(kaidenQuota(0)).toBe(10);
  });
  it('withKaidenFlag toggles bit 4 only', () => {
    const c = card(200, CardFlag.archived);
    const k = withKaidenFlag(c, true);
    expect(hasFlag(k[7], CardFlag.kaiden)).toBe(true);
    expect(hasFlag(k[7], CardFlag.archived)).toBe(true);
    expect(withKaidenFlag(k, false)[7]).toBe(CardFlag.archived);
    expect(withKaidenFlag(c, false)).toBe(c);
  });
});

describe('applyRating', () => {
  it('reports step-pending on new and lapsed cards, not after Easy or a graduation', () => {
    const fresh = applyRating(newCard(TODAY), 3, TODAY, opts);
    expect(fresh.stepPending).toBe(true);
    expect(fresh.card[5]).toBe(1);
    const easy = applyRating(newCard(TODAY), 4, TODAY, opts);
    expect(easy.stepPending).toBe(false);
    expect(easy.card[5]).toBe(2);
    const lapsed = applyRating(card(20), 1, TODAY, opts);
    expect(lapsed.stepPending).toBe(true);
    expect(lapsed.card[4]).toBe(1);
    expect(lapsed.card[5]).toBe(3);
    const relearned = applyRating(lapsed.card, 3, TODAY + 1, opts);
    expect(relearned.stepPending).toBe(false);
    expect(relearned.card[5]).toBe(2);
  });
  it('step offsets: +3/+10 on intro, +3 on a learning miss, +5 on a lapse, none on Easy', () => {
    expect(stepOffsetsFor(newCard(TODAY), 3)).toEqual([3, 10]);
    expect(stepOffsetsFor(newCard(TODAY), 4)).toEqual([]);
    expect(stepOffsetsFor(card(20), 1)).toEqual([5]);
    expect(stepOffsetsFor(card(20), 3)).toEqual([]);
    const learning: CardTuple = [TODAY, 0.4, 7, 1, 0, 1, TODAY - 1, CardFlag.stepPending];
    expect(stepOffsetsFor(learning, 1)).toEqual([3]);
    expect(stepOffsetsFor(learning, 3)).toEqual([]);
  });
  it('Kaiden-flagged cards may schedule past 365 days; others never do', () => {
    const big = (flags: number): CardTuple => [TODAY, 1500, 3, 30, 0, 2, TODAY - 365, flags];
    const plain = applyRating(big(0), 3, TODAY, opts).card;
    expect(plain[0] - TODAY).toBeLessThanOrEqual(365);
    const kaiden = applyRating(big(CardFlag.kaiden), 3, TODAY, opts).card;
    expect(kaiden[0] - TODAY).toBeGreaterThan(365);
    expect(kaiden[0] - TODAY).toBeLessThanOrEqual(KAIDEN_MAX_INTERVAL);
    const forced = applyRating(big(CardFlag.kaiden), 3, TODAY, { ...opts, maxInterval: 365 }).card;
    expect(forced[0] - TODAY).toBeLessThanOrEqual(365);
  });
  it('既知 Easy start: S₀ = w[3], review state, no steps', () => {
    const c = kichiStart(TODAY, opts);
    expect(c[1]).toBeCloseTo(W[3] as number, 2);
    expect(c[5]).toBe(2);
    expect(hasFlag(c[7], CardFlag.stepPending)).toBe(false);
    expect(c[0]).toBeGreaterThan(TODAY);
  });
});

/**
 * Steady-state Kaiden simulation: 15,000 Kaiden cards, review cap 240
 * (quota 36/day), most-overdue first, every answer Good. With the lane's
 * 730-day ceiling the oldest due card is never more than 7 days overdue;
 * the same setup under the generic 365-day cap builds a permanent backlog,
 * which is why `KAIDEN_MAX_INTERVAL` exists.
 */
function simulateKaiden(maxInterval: number, days: number): number {
  const N = 15_000;
  const quota = kaidenQuota(240);
  const rng = mulberry32(42);
  const buckets = new Map<number, CardTuple[]>();
  const push = (c: CardTuple): void => {
    const b = buckets.get(c[0]);
    if (b) b.push(c);
    else buckets.set(c[0], [c]);
  };
  for (let i = 0; i < N; i++) {
    const s = 800 + Math.floor(rng() * 2200);
    const due = TODAY + Math.floor(rng() * maxInterval);
    push([due, s, 4, 20, 0, 2, due - maxInterval, CardFlag.kaiden]);
  }
  const o = { ...opts, maxInterval };
  let worst = 0;
  for (let day = TODAY; day < TODAY + days; day++) {
    const dueDays = [...buckets.keys()].filter((d) => d <= day).sort((a, b) => a - b);
    if (dueDays.length) worst = Math.max(worst, day - (dueDays[0] as number));
    let served = 0;
    for (const d of dueDays) {
      const list = buckets.get(d) as CardTuple[];
      while (list.length && served < quota) {
        const c = list.pop() as CardTuple;
        push(applyRating(c, 3, day, o).card);
        served++;
      }
      if (list.length === 0) buckets.delete(d);
      if (served >= quota) break;
    }
  }
  return worst;
}

describe('Kaiden steady state (15k cards, cap 240)', () => {
  it('keeps the lane ≤ 7 days overdue at the 730-day ceiling', () => {
    expect(simulateKaiden(KAIDEN_MAX_INTERVAL, 400)).toBeLessThanOrEqual(7);
  });
  it('would fall behind under the generic 365-day cap (documents the deviation)', () => {
    expect(simulateKaiden(365, 400)).toBeGreaterThan(7);
  });
});
