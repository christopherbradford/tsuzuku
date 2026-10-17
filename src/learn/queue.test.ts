import { signal } from '@preact/signals';
import type { CardKey, Facet, StoryItem, VocabItem } from '../content/types';
import { ERROR_TAGS } from '../content/types';
import { CardFlag, type CardTuple, type CardsApi, type ItemKind, type LogEntry, type Settings } from '../shared/store-types';
import { parseCardKey } from '../shared/ids';
import { mulberry32, shuffle } from '../shared/hash';
import { dayStartMs } from '../shared/time';
import {
  RECHECK_FLAG,
  WAVE_PATTERN,
  buildQueue,
  dueCards,
  exerciseFor,
  gojuonPool,
  insertSteps,
  interleave,
  interleaveViolations,
  kagePools,
  orderWave,
  prodPrompt,
  prodPrompts,
  rapidFirePool,
  recheckCards,
  waveBand,
  weakPointSet,
  type QueueCard,
} from './queue';

const TODAY = 20000;

function fakeCards(init: Record<string, CardTuple> = {}): CardsApi {
  const map = new Map<CardKey, CardTuple>(Object.entries(init) as [CardKey, CardTuple][]);
  const version = signal(0);
  return {
    get: (k) => map.get(k),
    set: (k, t) => {
      map.set(k, t);
      version.value++;
    },
    delete: (k) => {
      map.delete(k);
      version.value++;
    },
    byItem: (id) => {
      const out: Partial<Record<Facet, CardTuple>> = {};
      for (const [k, t] of map) {
        const p = parseCardKey(k);
        if (p.itemId === id) out[p.facet] = t;
      }
      return out;
    },
    dueOn: (day) => [...map].filter(([, t]) => t[0] <= day).map(([k]) => k),
    forEach: (fn) => {
      for (const [k, t] of map) fn(k, t);
    },
    count: () => map.size,
    version,
  };
}

/** Review card: stability `s`, due `overdue` days ago, last reviewed `ago` days ago. */
const rc = (s: number, overdue: number, ago: number, flags = 0, reps = 5): CardTuple => [TODAY - overdue, s, 5, reps, 0, 2, TODAY - ago, flags];

const qc = (itemId: string, facet: Facet, kind: ItemKind, r = 0.9, extra: Partial<QueueCard> = {}): QueueCard => ({
  cardKey: `${itemId}#${facet}`,
  itemId,
  kind,
  facet,
  r,
  mature: true,
  exposures: 5,
  ...extra,
});

const settings = { jj: false } as Settings;

describe('dueCards', () => {
  it('Kata order: overdue × (1 − R) descending, lowest R breaks ties; excludes archived, new and future cards', () => {
    const cards = fakeCards({
      'v-n5-0001#rec': rc(10, 0, 10), // r 0.9, overdue 0 → score 0
      'v-n5-0002#rec': rc(10, 5, 15), // overdue 5, r(15,10) ≈ 0.845 → 0.77
      'v-n5-0003#rec': rc(100, 5, 105), // overdue 5, r ≈ 0.90 → 0.5
      'v-n5-0004#rec': rc(2, 1, 3), // overdue 1, r(3,2) ≈ 0.86 → 0.14
      'v-n5-0005#rec': rc(10, 0, 20), // overdue 0, r(20,10) ≈ 0.81 → 0 (tie, lower r first)
      'v-n5-0006#rec': rc(10, 30, 40, CardFlag.archived),
      'v-n5-0007#rec': [TODAY, 0, 0, 0, 0, 0, TODAY, 0],
      'v-n5-0008#rec': [TODAY + 1, 10, 5, 3, 0, 2, TODAY - 1, 0],
    });
    const out = dueCards({ cards, today: TODAY, limit: 100, backlog: false });
    expect(out.map((c) => c.itemId)).toEqual(['v-n5-0002', 'v-n5-0003', 'v-n5-0004', 'v-n5-0005', 'v-n5-0001']);
    expect(out[0]?.mature).toBe(false);
    expect(out[1]?.mature).toBe(true);
    expect(out[0]?.exposures).toBe(5);
    expect(dueCards({ cards, today: TODAY, limit: 2, backlog: false }).map((c) => c.itemId)).toEqual(['v-n5-0002', 'v-n5-0003']);
  });
  it('backlog: most overdue first, then lowest R', () => {
    const cards = fakeCards({
      'v-n5-0001#rec': rc(10, 2, 12),
      'v-n5-0002#rec': rc(300, 9, 309),
      'v-n5-0003#rec': rc(5, 9, 14),
    });
    const out = dueCards({ cards, today: TODAY, limit: 10, backlog: true });
    expect(out.map((c) => c.itemId)).toEqual(['v-n5-0003', 'v-n5-0002', 'v-n5-0001']);
  });
  it('caps the Kaiden lane at its quota and fills the rest from the main lane', () => {
    const init: Record<string, CardTuple> = {};
    for (let i = 1; i <= 20; i++) init[`v-n5-${String(i).padStart(4, '0')}#rec`] = rc(200, 10, 210, CardFlag.kaiden);
    for (let i = 21; i <= 25; i++) init[`v-n5-${String(i).padStart(4, '0')}#rec`] = rc(10, 1, 11);
    const cards = fakeCards(init);
    const out = dueCards({ cards, today: TODAY, limit: 12, backlog: false, kaidenQuota: 3 });
    expect(out).toHaveLength(8);
    expect(out.filter((c) => Number(c.itemId.slice(-4)) <= 20)).toHaveLength(3);
    const unlimited = dueCards({ cards, today: TODAY, limit: 12, backlog: false });
    expect(unlimited).toHaveLength(12);
  });
  it('classifies chunks (vocab with prod and no rec)', () => {
    const cards = fakeCards({ 'v-n5-0001#prod': rc(10, 0, 10), 'v-n5-0002#prod': rc(10, 0, 10), 'v-n5-0002#rec': rc(10, 0, 10) });
    const out = dueCards({ cards, today: TODAY, limit: 10, backlog: false });
    expect(out.find((c) => c.itemId === 'v-n5-0001')?.kind).toBe('chunk');
    expect(out.find((c) => c.cardKey === 'v-n5-0002#prod')?.kind).toBe('vocab');
  });
});

describe('pools', () => {
  const cards = fakeCards({
    'k-h-a#rec': rc(14, 0, 1),
    'k-h-i#rec': rc(13.9, 0, 1),
    'k-h-u#rec': rc(200, 0, 1, CardFlag.archived),
    'k-h-a#prod': rc(50, 0, 1),
    'v-n5-0001#rec': rc(20, 0, 1),
    'v-n5-0001#listen': rc(20, 0, 1),
    'v-n5-0001#prod': rc(20, 0, 1, RECHECK_FLAG),
    'j-食#read': rc(20, 0, 1),
    'j-食#comp': rc(20, 0, 1),
    'g-n5-001#cloze': rc(20, 0, 1),
    'g-n5-002#cloze': rc(3, 0, 1, RECHECK_FLAG),
    'v-n5-0009#rec': [TODAY, 0, 0, 0, 0, 0, TODAY, 0],
  });
  it('gojuonPool: kana rec with S ≥ 14, archived included', () => {
    expect(gojuonPool(cards, TODAY).map((c) => c.cardKey)).toEqual(['k-h-a#rec', 'k-h-u#rec']);
  });
  it('rapidFirePool: rec / read / cloze with S ≥ 14', () => {
    expect(rapidFirePool(cards, TODAY).map((c) => c.cardKey)).toEqual(['g-n5-001#cloze', 'j-食#read', 'k-h-a#rec', 'k-h-u#rec', 'v-n5-0001#rec']);
  });
  it('recheckCards: the arcade-miss flag', () => {
    expect(recheckCards(cards).map((c) => c.cardKey)).toEqual(['g-n5-002#cloze', 'v-n5-0001#prod']);
  });
});

describe('prodPrompt', () => {
  const item: VocabItem = {
    id: 'v-n5-0001',
    word: '食べる',
    kana: 'たべる',
    meanings: ['to eat'],
    pos: 'v1',
    jlpt: 5,
    tags: ['food'],
    examples: [
      { ja: '{毎朝|まいあさ}パンを{食|た}べる。', kana: 'まいあさパンをたべる。', en: 'I eat bread every morning.' },
      { ja: '{何|なに}を{食|た}べますか。', kana: 'なにをたべますか。', en: 'What will you eat?' },
    ],
  };
  const story: StoryItem = {
    id: 's-07-1',
    stationId: 'st-07',
    titleJa: 't',
    titleEn: 't',
    kind: 'story',
    register: 'neutral',
    lines: [
      { ja: '{魚|さかな}を{食|た}べた。', kana: 'さかなをたべた。', en: 'I ate fish.', tokens: ['魚', 'を', '食べた', '。'], tokenIds: ['v-n5-0002', null, 'v-n5-0001', null] },
      { ja: '{水|みず}を{飲|の}む。', kana: 'みずをのむ。', en: 'I drink water.', tokens: ['水', 'を', '飲む', '。'], tokenIds: ['v-n5-0003', null, 'v-n5-0004', null] },
    ],
    vocabIds: [],
    grammarIds: [],
    comprehension: [],
    recapEn: '',
  };
  it('rotates through examples and story lines containing the word', () => {
    const all = prodPrompts(item, [story]);
    expect(all).toHaveLength(3);
    expect(all[0]?.sentence).toBe('毎朝パンを食べる。');
    expect(all[0]?.blank).toEqual([5, 8]);
    expect(all[1]?.sentence).toBe('何を食べますか。');
    expect(all[1]?.blank).toEqual([2, 4]);
    expect(all[2]?.sentence).toBe('魚を食べた。');
    expect(all[2]?.blank).toEqual([2, 5]);
    expect(prodPrompt(item, [story], 0)).toEqual(all[0]);
    expect(prodPrompt(item, [story], 1)).toEqual(all[1]);
    expect(prodPrompt(item, [story], 2)).toEqual(all[2]);
    expect(prodPrompt(item, [story], 3)).toEqual(all[0]);
    expect(prodPrompt(item, [], 5)).toEqual(all[1]);
  });
  it('falls back to the word itself when there is nothing else', () => {
    const bare = { ...item, examples: [] };
    expect(prodPrompt(bare, [], 0)).toEqual({ sentence: '食べる', kana: 'たべる', en: 'to eat', blank: [0, 3] });
  });
});

describe('orderWave', () => {
  it('follows E E E H M H M H M H E E on synthetic R and closes with two easy cards', () => {
    const cards: QueueCard[] = [];
    [0.99, 0.98, 0.97, 0.96, 0.95, 0.94].forEach((r, i) => cards.push(qc(`v-n5-${100 + i}`, 'rec', 'vocab', r)));
    [0.89, 0.86, 0.83, 0.81].forEach((r, i) => cards.push(qc(`v-n5-${200 + i}`, 'rec', 'vocab', r)));
    [0.79, 0.6, 0.5, 0.3, 0.1].forEach((r, i) => cards.push(qc(`v-n5-${300 + i}`, 'rec', 'vocab', r)));
    const out = orderWave(shuffle(mulberry32(1), cards));
    expect(out).toHaveLength(15);
    const bands = out.map((c) => waveBand(c.r)).join('');
    expect(bands.slice(0, 11)).toBe(WAVE_PATTERN.slice(0, 11));
    expect(out.slice(0, 3).map((c) => c.r)).toEqual([0.99, 0.98, 0.97]);
    expect(out.slice(-2).map((c) => waveBand(c.r))).toEqual(['E', 'E']);
    expect(out[3]?.r).toBe(0.1);
    expect(new Set(out.map((c) => c.cardKey)).size).toBe(15);
  });
  it('degrades gracefully when a band is empty', () => {
    const hard = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((r, i) => qc(`v-n5-${i}`, 'rec', 'vocab', r));
    const out = orderWave(hard);
    expect(out.map((c) => c.r).sort()).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(orderWave([])).toEqual([]);
    const two = [qc('a', 'rec', 'vocab', 0.5), qc('b', 'rec', 'vocab', 0.9)];
    expect(orderWave(two)).toEqual(two);
  });
});

describe('interleave (design 03 §2.4 wording)', () => {
  const KINDS: [ItemKind, Facet[]][] = [
    ['vocab', ['rec', 'listen', 'prod']],
    ['kanji', ['comp', 'read']],
    ['grammar', ['cloze', 'prod']],
    ['kana', ['rec', 'prod']],
  ];
  function randomInput(seed: number): QueueCard[] {
    const rng = mulberry32(seed);
    const n = 12 + Math.floor(rng() * 49);
    const out: QueueCard[] = [];
    for (let i = 0; i < n; i++) {
      const [kind, facets] = KINDS[Math.floor(rng() * KINDS.length)] as [ItemKind, Facet[]];
      const facet = facets[Math.floor(rng() * facets.length)] as Facet;
      out.push(qc(`${kind}-${i}`, facet, kind, rng()));
    }
    // a few items get a second facet card (the realistic case)
    const dups = Math.floor(n / 6);
    for (let i = 0; i < dups; i++) {
      const src = out[Math.floor(rng() * n)] as QueueCard;
      const facets = (KINDS.find(([k]) => k === src.kind) as [ItemKind, Facet[]])[1];
      const other = facets.find((f) => f !== src.facet) ?? src.facet;
      out.push(qc(src.itemId, other, src.kind, rng()));
    }
    return shuffle(rng, out);
  }
  it('no item within 4 reps of itself, ≤ 3 same exercise type in a row, listen never follows listen of the same word — 1,000 seeded inputs', () => {
    let failures = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const input = randomInput(seed);
      const out = interleave(input);
      expect(out).toHaveLength(input.length);
      expect(new Set(out.map((c) => c.cardKey)).size).toBe(new Set(input.map((c) => c.cardKey)).size);
      if (interleaveViolations(out) !== 0) failures++;
    }
    expect(failures).toBe(0);
  });
  it('steps and recovery are exempt from the gap rule; the listen rule still holds', () => {
    const a = qc('v-n5-0001', 'rec', 'vocab');
    const seq = [a, qc('j-食', 'read', 'kanji'), { ...a, tag: '+3' as const }, qc('g-n5-001', 'cloze', 'grammar'), { ...a, tag: 'recovery' as const }];
    expect(interleaveViolations(seq)).toBe(0);
    const sameTypeRun = [a, qc('v-n5-0002', 'rec', 'vocab'), { ...a, tag: '+3' as const }, qc('v-n5-0003', 'rec', 'vocab'), { ...a, tag: 'recovery' as const }];
    expect(interleaveViolations(sameTypeRun)).toBe(2);
    const plain = [a, qc('v-n5-0002', 'rec', 'vocab'), { ...a }];
    expect(interleaveViolations(plain)).toBe(1);
    const l = qc('v-n5-0001', 'listen', 'vocab');
    expect(interleaveViolations([l, { ...l, tag: '+3' }])).toBe(1);
    expect(interleaveViolations([l, qc('v-n5-0002', 'listen', 'vocab')])).toBe(0);
  });
  it('breaks runs of the same exercise type', () => {
    const input = [
      ...[1, 2, 3, 4, 5].map((i) => qc(`v-n5-000${i}`, 'rec', 'vocab')),
      qc('j-食', 'read', 'kanji'),
      qc('g-n5-001', 'cloze', 'grammar'),
    ];
    const out = interleave(input);
    expect(interleaveViolations(out)).toBe(0);
    expect(interleaveViolations(input)).toBeGreaterThan(0);
  });
  it('uses the resolved exercise as the type when present', () => {
    const input = [1, 2, 3, 4].map((i) => qc(`v-n5-000${i}`, 'rec', 'vocab', 0.9, { exercise: i % 2 ? 'meaning-guard' : 'meaning-recall' }));
    expect(interleaveViolations(input)).toBe(0);
  });
});

describe('insertSteps', () => {
  it('places intro, +3 and +10 exactly 3 and 10 reps apart and keeps the base order', () => {
    const base = Array.from({ length: 30 }, (_, i) => qc(`v-n5-${1000 + i}`, 'rec', 'vocab'));
    const fresh = [qc('v-n5-0001', 'rec', 'vocab', 0, { exposures: 0 }), qc('v-n5-0002', 'rec', 'vocab', 0, { exposures: 0 })];
    const out = insertSteps(base, fresh);
    expect(out).toHaveLength(36);
    for (const n of fresh) {
      const intro = out.findIndex((c) => c.itemId === n.itemId && c.tag === 'intro');
      const p3 = out.findIndex((c) => c.itemId === n.itemId && c.tag === '+3');
      const p10 = out.findIndex((c) => c.itemId === n.itemId && c.tag === '+10');
      expect(intro).toBeGreaterThanOrEqual(0);
      expect(p3 - intro).toBe(3);
      expect(p10 - intro).toBe(10);
    }
    expect(out.filter((c) => !c.tag).map((c) => c.cardKey)).toEqual(base.map((c) => c.cardKey));
    expect(insertSteps(base, [])).toEqual(base);
  });
  it('appends steps when the sequence is short', () => {
    const out = insertSteps([qc('v-n5-0009', 'rec', 'vocab')], [qc('v-n5-0001', 'rec', 'vocab')]);
    expect(out.map((c) => c.tag ?? 'due')).toEqual(['intro', 'due', '+3', '+10']);
  });
});

describe('exerciseFor (design 04 §13)', () => {
  const ex = (kind: ItemKind, facet: Facet, exposures: number, station: number, over: Partial<QueueCard> = {}, s: Settings = settings): string =>
    exerciseFor(qc('x', facet, kind, 0.9, { exposures, ...over }), station, s);
  it('multiple choice only for the first 2 exposures', () => {
    expect(ex('vocab', 'rec', 0, 4)).toBe('meaning-guard');
    expect(ex('vocab', 'rec', 1, 4)).toBe('meaning-guard');
    expect(ex('vocab', 'rec', 2, 4)).toBe('meaning-recall');
    expect(ex('vocab', 'rec', 50, 53)).toBe('meaning-recall');
    expect(ex('kana', 'prod', 0, 1)).toBe('kana-ear');
    expect(ex('kana', 'prod', 2, 1)).toBe('kana-forge');
    expect(ex('kana', 'rec', 0, 1)).toBe('kana-flash');
    expect(ex('grammar', 'cloze', 0, 4)).toBe('pattern-cloze');
  });
  it('J-J self-grading is opt-in from Station 34', () => {
    const jj = { jj: true } as Settings;
    expect(ex('vocab', 'rec', 5, 34, {}, jj)).toBe('meaning-judge');
    expect(ex('vocab', 'rec', 5, 33, {}, jj)).toBe('meaning-recall');
    expect(ex('vocab', 'rec', 5, 34)).toBe('meaning-recall');
  });
  it('other vocab facets, chunks, components, kanji', () => {
    expect(ex('vocab', 'listen', 0, 4)).toBe('audio-flash');
    expect(ex('vocab', 'prod', 0, 4)).toBe('production-forge');
    expect(ex('vocab', 'pitch', 0, 7)).toBe('pitch-ear');
    expect(ex('chunk', 'prod', 0, 3)).toBe('shadow');
    expect(ex('component', 'rec', 0, 2)).toBe('component-flash');
    expect(ex('kanji', 'comp', 0, 4)).toBe('component-assembly');
    expect(ex('kanji', 'read', 2, 15)).toBe('kanji-read');
    expect(ex('kanji', 'read', 2, 16)).toBe('lookalike-duel');
    expect(ex('kanji', 'read', 2, 16, { mature: false })).toBe('kanji-read');
    expect(ex('kanji', 'read', 3, 16)).toBe('kanji-read');
  });
  it('grammar: station unlocks and retirements', () => {
    expect(ex('grammar', 'cloze', 2, 4)).toBe('scramble');
    expect(ex('grammar', 'cloze', 2, 24)).toBe('scramble');
    expect(ex('grammar', 'cloze', 2, 25)).toBe('pattern-cloze');
    expect(ex('grammar', 'cloze', 2, 39)).toBe('judgment-call');
    expect(ex('grammar', 'cloze', 3, 39)).toBe('pattern-cloze');
    expect(ex('grammar', 'prod', 0, 9)).toBe('pattern-cloze');
    expect(ex('grammar', 'prod', 0, 10)).toBe('form-forge');
    expect(ex('grammar', 'prod', 0, 16)).toBe('form-forge');
    expect(ex('grammar', 'prod', 1, 16)).toBe('transform');
  });
});

describe('weakPointSet', () => {
  it('orders items carrying the tag by frequency and skips missing or archived cards', () => {
    const cards = fakeCards({
      'g-n5-001#cloze': rc(10, 0, 1),
      'g-n5-002#cloze': rc(10, 0, 1),
      'g-n5-003#cloze': rc(10, 0, 1, CardFlag.archived),
    });
    const bit = 1 << ERROR_TAGS.indexOf('particle');
    const other = 1 << ERROR_TAGS.indexOf('register');
    const log: LogEntry[] = [
      [1, 'g-n5-001#cloze', 1, 1000, 15, bit],
      [2, 'g-n5-002#cloze', 1, 1000, 15, bit],
      [3, 'g-n5-002#cloze', 2, 1000, 15, bit | other],
      [4, 'g-n5-003#cloze', 1, 1000, 15, bit],
      [5, 'g-n5-004#cloze', 1, 1000, 15, bit],
      [6, 'g-n5-001#cloze', 3, 1000, 15, other],
    ];
    expect(weakPointSet('particle', cards, log, TODAY).map((c) => c.cardKey)).toEqual(['g-n5-002#cloze', 'g-n5-001#cloze']);
    // equal counts → most recent first
    expect(weakPointSet('register', cards, log, TODAY).map((c) => c.cardKey)).toEqual(['g-n5-001#cloze', 'g-n5-002#cloze']);
    expect(weakPointSet('pitch', cards, log, TODAY)).toEqual([]);
  });
});

describe('kagePools', () => {
  const init: Record<string, CardTuple> = {};
  for (let i = 1; i <= 25; i++) {
    const id = `v-n5-${String(i).padStart(4, '0')}`;
    init[`${id}#rec`] = rc(3, 0, 1);
    init[`${id}#listen`] = rc(1, 0, 1);
  }
  for (let i = 26; i <= 60; i++) init[`v-n5-${String(i).padStart(4, '0')}#rec`] = rc(30, 0, 5);
  init['v-n5-0061#rec'] = rc(30, 0, 5, CardFlag.archived);
  init['v-n5-0062#rec'] = rc(13, 0, 5);
  const cards = fakeCards(init);
  const log: LogEntry[] = [];
  for (let i = 1; i <= 25; i++) {
    const id = `v-n5-${String(i).padStart(4, '0')}`;
    log.push([dayStartMs(TODAY - 3) + 1000, `${id}#rec`, 3, 2000, 4, 0]);
    log.push([dayStartMs(TODAY - 1) + 1000, `${id}#listen`, 3, 2000, 7, 0]);
  }
  for (let i = 26; i <= 62; i++) log.push([dayStartMs(TODAY - 40) + 1000, `v-n5-${String(i).padStart(4, '0')}#rec`, 3, 2000, 4, 0]);

  it('samples 15 recent base-facet cards and 15 mature cards, disjoint, no archived', () => {
    const { recent, mature } = kagePools(cards, log, TODAY, 7);
    expect(recent).toHaveLength(15);
    expect(mature).toHaveLength(15);
    recent.forEach((c) => expect(c.facet).toBe('rec'));
    recent.forEach((c) => expect(Number(c.itemId.slice(-4))).toBeLessThanOrEqual(25));
    mature.forEach((c) => expect(Number(c.itemId.slice(-4))).toBeGreaterThanOrEqual(26));
    mature.forEach((c) => expect(c.mature).toBe(true));
    expect(mature.some((c) => c.itemId === 'v-n5-0061')).toBe(false);
    expect(mature.some((c) => c.itemId === 'v-n5-0062')).toBe(false);
  });
  it('is deterministic per seed', () => {
    const a = kagePools(cards, log, TODAY, 7);
    const b = kagePools(cards, log, TODAY, 7);
    const c = kagePools(cards, log, TODAY, 8);
    expect(a).toEqual(b);
    expect(a.recent.map((x) => x.cardKey).join()).not.toBe(c.recent.map((x) => x.cardKey).join());
  });
});

describe('buildQueue', () => {
  it('composes due → wave → interleave → steps', () => {
    const init: Record<string, CardTuple> = {};
    for (let i = 1; i <= 30; i++) init[`v-n5-${String(i).padStart(4, '0')}#rec`] = rc(10 + i, i % 4, 10 + i + (i % 4));
    for (let i = 1; i <= 10; i++) init[`j-${String.fromCharCode(0x4e00 + i)}#read`] = rc(20, 2, 22);
    const cards = fakeCards(init);
    const out = buildQueue({ cards, today: TODAY, limit: 20, backlog: false, newOnes: [qc('v-n5-9999', 'rec', 'vocab', 0, { exposures: 0 })] });
    expect(out).toHaveLength(23);
    expect(out.filter((c) => c.tag).map((c) => c.tag)).toEqual(['intro', '+3', '+10']);
    expect(interleaveViolations(out)).toBe(0);
  });
});
