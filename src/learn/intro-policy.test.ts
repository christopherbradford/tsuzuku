import { signal } from '@preact/signals';
import type { CardKey, ComponentDef, ContentItem, Facet, KanjiItem, StationBundle } from '../content/types';
import type { CardTuple, CardsApi } from '../shared/store-types';
import { parseCardKey } from '../shared/ids';
import {
  CAPTURED_SHARE,
  componentIdFor,
  componentReady,
  isKanjiUnlockable,
  kanjiUnlocksIn,
  learnerBeltAtLeast,
  nextScrolls,
  partition,
  pretestFor,
  scrollSizes,
  scrollsForStation,
  stationBelt,
  type NextScrollsInput,
} from './intro-policy';

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

const ids = (prefix: string, n: number, pad: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}`);

function bundle(number: number, o: Partial<Pick<StationBundle, 'kanaIds' | 'vocabIds' | 'kanjiIds' | 'grammarIds' | 'componentIds'>>): StationBundle {
  return {
    schema: 'tsuzuku.station/1',
    number,
    kanaIds: o.kanaIds ?? [],
    vocabIds: o.vocabIds ?? [],
    kanjiIds: o.kanjiIds ?? [],
    grammarIds: o.grammarIds ?? [],
    componentIds: o.componentIds ?? [],
    storyIds: [],
    michikusaIds: [],
    files: [],
    surfaces: {},
  };
}

const KANJI: Record<string, KanjiItem> = {
  'j-食': { id: 'j-食', char: '食', meanings: ['eat'], on: ['ショク'], kun: ['た.べる'], strokes: 9, jlpt: 5, components: ['person', 'good'], mnemonic: 'a person finds good food', examples: [] },
  'j-休': { id: 'j-休', char: '休', meanings: ['rest'], on: ['キュウ'], kun: ['やす.む'], strokes: 6, jlpt: 5, components: ['person', 'tree'], mnemonic: 'a person rests by a tree', examples: [] },
  'j-木': { id: 'j-木', char: '木', meanings: ['tree'], on: ['モク'], kun: ['き'], strokes: 4, jlpt: 5, components: ['tree'], mnemonic: 'a tree', examples: [] },
};
const COMPONENTS = new Map<string, ComponentDef>([
  ['c-person', { id: 'c-person', char: '人', name: 'person' }],
  ['c-good', { id: 'c-good', char: '良', name: 'good' }],
  ['c-tree', { id: 'c-tree', char: '木', name: 'tree' }],
]);
const get = (id: string): ContentItem | undefined => KANJI[id];

/** Component rec card with stability `s`, last reviewed `ago` days ago, `reps` reviews. */
const comp = (s: number, ago = 0, reps = 2): CardTuple => [TODAY + 1, s, 5, reps, 0, 2, TODAY - ago, 0];

describe('partition and sizes', () => {
  it('splits evenly within the belt bounds', () => {
    const sizes60 = partition(ids('v', 60, 4), 8).map((g) => g.length);
    expect(sizes60).toHaveLength(8);
    sizes60.forEach((n) => expect(n).toBeGreaterThanOrEqual(6));
    sizes60.forEach((n) => expect(n).toBeLessThanOrEqual(8));
    expect(partition(ids('v', 20, 4), 8).map((g) => g.length)).toEqual([7, 7, 6]);
    const sizes121 = partition(ids('v', 121, 4), 10).map((g) => g.length);
    sizes121.forEach((n) => expect(n).toBeGreaterThanOrEqual(8));
    sizes121.forEach((n) => expect(n).toBeLessThanOrEqual(10));
    expect(partition([], 8)).toEqual([]);
    expect(partition(ids('j', 8, 1), 3).map((g) => g.length)).toEqual([3, 3, 2]);
    expect(partition(ids('g', 8, 3), 1)).toHaveLength(8);
  });
  it('scroll sizes scale by belt', () => {
    expect(scrollSizes('yellow').vocab).toEqual({ min: 6, max: 8 });
    expect(scrollSizes('green').kanji).toBe(3);
    expect(scrollSizes('blue').vocab).toEqual({ min: 8, max: 10 });
    expect(scrollSizes('brown').kanji).toBe(4);
    expect(scrollSizes('black').grammar).toBe(1);
    expect(stationBelt(7)).toBe('yellow');
    expect(stationBelt(25)).toBe('blue');
    expect(stationBelt(0)).toBe('white');
    expect(learnerBeltAtLeast('green', 'yellow')).toBe(true);
    expect(learnerBeltAtLeast('orange', 'green')).toBe(false);
  });
});

describe('scrollsForStation', () => {
  const b7 = bundle(7, { vocabIds: ids('v-n5-', 60, 4), kanjiIds: ['j-食', 'j-休', 'j-木', 'j-一', 'j-二', 'j-三', 'j-四', 'j-五'], grammarIds: ids('g-n5-', 8, 3), componentIds: ['c-person', 'c-good', 'c-tree', 'c-sun', 'c-moon', 'c-fire'] });
  it('yields deterministic stable ids `<station>-<n>`', () => {
    const a = scrollsForStation(b7, get);
    const b = scrollsForStation(b7, get);
    expect(a).toEqual(b);
    a.forEach((s, i) => expect(s.id).toBe(`7-${i + 1}`));
    a.forEach((s) => expect(s.station).toBe(7));
  });
  it('partitions by kind at belt size and interleaves vocab / kanji / grammar', () => {
    const scrolls = scrollsForStation(b7, get);
    const kinds = scrolls.map((s) => s.kind);
    expect(kinds.filter((k) => k === 'vocab')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'kanji')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'grammar')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'component')).toHaveLength(2);
    expect(kinds.slice(0, 2)).toEqual(['component', 'component']);
    // interleaved: no run of more than 2 vocab scrolls between grammar scrolls
    const firstGrammar = kinds.indexOf('grammar');
    expect(firstGrammar).toBeLessThan(5);
    expect(scrolls.flatMap((s) => s.itemIds)).toHaveLength(60 + 8 + 8 + 6);
  });
  it('kana stations get kana scrolls of ≤ 10', () => {
    const b2 = bundle(2, { kanaIds: ids('k-h-', 79, 2), vocabIds: ids('v-n5-', 20, 4) });
    const scrolls = scrollsForStation(b2, get);
    const kana = scrolls.filter((s) => s.kind === 'kana');
    expect(kana).toHaveLength(8);
    kana.forEach((s) => expect(s.itemIds.length).toBeLessThanOrEqual(10));
    expect(scrolls[0]?.kind).toBe('kana');
  });
  it('pretest picks ≤ 3 items of the scroll, deterministically', () => {
    const scrolls = scrollsForStation(b7, get);
    for (const s of scrolls) {
      expect(s.pretestIds.length).toBe(Math.min(3, s.itemIds.length));
      s.pretestIds.forEach((id) => expect(s.itemIds).toContain(id));
      expect(new Set(s.pretestIds).size).toBe(s.pretestIds.length);
      expect(pretestFor(s.id, s.itemIds)).toEqual(s.pretestIds);
    }
    const grammar = scrolls.find((s) => s.kind === 'grammar');
    expect(grammar?.pretestIds).toEqual(grammar?.itemIds);
  });
});

describe('kanji gate: components Green or introduced ≥ 7 days ago', () => {
  it('resolves component names to ids', () => {
    expect(componentIdFor('person', COMPONENTS)).toBe('c-person');
    expect(componentIdFor('c-person', COMPONENTS)).toBe('c-person');
    expect(componentIdFor('rice field', new Map([['c-rice-field', { id: 'c-rice-field', char: '田', name: 'rice field' }]]))).toBe('c-rice-field');
    expect(componentIdFor('nope', COMPONENTS)).toBeUndefined();
  });
  it('blocks until the component is introduced; Green passes', () => {
    expect(componentReady('c-person', { cards: fakeCards(), components: COMPONENTS, today: TODAY })).toBe(false);
    expect(componentReady('c-person', { cards: fakeCards({ 'c-person#rec': comp(7) }), components: COMPONENTS, today: TODAY })).toBe(true);
    expect(componentReady('c-person', { cards: fakeCards({ 'c-person#rec': comp(6.9) }), components: COMPONENTS, today: TODAY })).toBe(false);
  });
  it('the 7-day lag is exact with introducedOn and a lower bound without it', () => {
    const cards = fakeCards({ 'c-person#rec': comp(2, 0, 3) });
    const base = { cards, components: COMPONENTS, today: TODAY };
    expect(componentReady('c-person', { ...base, introducedOn: () => TODAY - 6 })).toBe(false);
    expect(componentReady('c-person', { ...base, introducedOn: () => TODAY - 7 })).toBe(true);
    expect(componentReady('c-person', base)).toBe(false);
    expect(componentReady('c-person', { cards: fakeCards({ 'c-person#rec': comp(2, 7, 3) }), components: COMPONENTS, today: TODAY })).toBe(true);
    expect(componentReady('c-person', { cards: fakeCards({ 'c-person#rec': comp(2, 0, 7) }), components: COMPONENTS, today: TODAY })).toBe(true);
  });
  it('a kanji needs every component ready; unknown names never block', () => {
    const cards = fakeCards({ 'c-person#rec': comp(10), 'c-good#rec': comp(1) });
    const o = { cards, components: COMPONENTS, today: TODAY, introducedOn: (id: string) => (id === 'c-good' ? TODAY - 2 : TODAY - 30) };
    expect(isKanjiUnlockable(KANJI['j-食'] as KanjiItem, o)).toBe(false);
    expect(kanjiUnlocksIn(KANJI['j-食'] as KanjiItem, o)).toBe(5);
    expect(isKanjiUnlockable(KANJI['j-休'] as KanjiItem, o)).toBe(false);
    expect(kanjiUnlocksIn(KANJI['j-休'] as KanjiItem, o)).toBeNull();
    const weird: KanjiItem = { ...(KANJI['j-木'] as KanjiItem), components: ['not-a-component'] };
    expect(isKanjiUnlockable(weird, o)).toBe(true);
    cards.set('c-good#rec', comp(7));
    expect(isKanjiUnlockable(KANJI['j-食'] as KanjiItem, o)).toBe(true);
    expect(kanjiUnlocksIn(KANJI['j-食'] as KanjiItem, o)).toBe(0);
  });
});

describe('nextScrolls', () => {
  const b = bundle(7, { vocabIds: ids('v-n5-', 60, 4), kanjiIds: ['j-食', 'j-休', 'j-木'], grammarIds: ids('g-n5-', 8, 3), componentIds: ['c-person', 'c-good', 'c-tree'] });
  const input = (over: Partial<NextScrollsInput> = {}): NextScrollsInput => ({
    bundle: b,
    cards: fakeCards(),
    captured: [],
    newPerDay: { vocab: 7, kanji: 1, grammar: 1 },
    introducedToday: { vocab: 0, kanji: 0, grammar: 0 },
    belt: 'yellow',
    components: COMPONENTS,
    get,
    today: TODAY,
    ...over,
  });

  it('schedules components before their kanji, and blocks kanji until components are ready', () => {
    const out = nextScrolls(input());
    const kinds = out.map((s) => s.kind);
    expect(kinds).toContain('component');
    expect(kinds).not.toContain('kanji');
    expect(kinds.indexOf('component')).toBeLessThan(kinds.indexOf('vocab'));
    const ready = nextScrolls(input({ cards: fakeCards({ 'c-person#rec': comp(7), 'c-good#rec': comp(7), 'c-tree#rec': comp(7) }) }));
    const kanji = ready.find((s) => s.kind === 'kanji');
    expect(kanji?.itemIds).toEqual(['j-食', 'j-休', 'j-木']);
    expect(ready.map((s) => s.kind)).not.toContain('component');
    const partial = nextScrolls(input({ cards: fakeCards({ 'c-person#rec': comp(7), 'c-tree#rec': comp(7), 'c-good#rec': comp(1) }) }));
    expect(partial.find((s) => s.kind === 'kanji')?.itemIds).toEqual(['j-休', 'j-木']);
  });
  it('mix respects the remaining budget per kind', () => {
    const noKanji = nextScrolls(input({ newPerDay: { vocab: 7, kanji: 0, grammar: 1 }, componentsPerDay: 0 }));
    expect(noKanji.map((s) => s.kind)).toEqual(['vocab', 'grammar']);
    expect(noKanji[0]?.itemIds.length).toBeGreaterThanOrEqual(6);
    const spent = nextScrolls(input({ introducedToday: { vocab: 7, kanji: 1, grammar: 1 }, componentsPerDay: 0 }));
    expect(spent).toEqual([]);
    const two = nextScrolls(input({ newPerDay: { vocab: 16, kanji: 0, grammar: 0 }, componentsPerDay: 0 }));
    expect(two.map((s) => s.kind)).toEqual(['vocab', 'vocab']);
    const carry = nextScrolls(input({ newPerDay: { vocab: 0, kanji: 0, grammar: 0.75 }, componentsPerDay: 0 }));
    expect(carry).toEqual([]);
  });
  it('skips introduced items and fully taught scrolls', () => {
    const first = scrollsForStation(b, get).find((s) => s.kind === 'vocab');
    const cards = fakeCards();
    for (const id of (first?.itemIds ?? []).slice(0, 5)) cards.set(`${id}#rec`, comp(1));
    const out = nextScrolls(input({ cards, componentsPerDay: 0 }));
    const v = out.find((s) => s.kind === 'vocab');
    expect(v?.id).toBe(first?.id);
    expect(v?.itemIds).toEqual(first?.itemIds.slice(5));
    v?.pretestIds.forEach((id) => expect(v.itemIds).toContain(id));
    for (const id of first?.itemIds ?? []) cards.set(`${id}#rec`, comp(1));
    const next = nextScrolls(input({ cards, componentsPerDay: 0 })).find((s) => s.kind === 'vocab');
    expect(next?.id).not.toBe(first?.id);
  });
  it('captured words take ≤ 40 % of the vocab budget, from Green only', () => {
    const captured = ids('v-n4-', 20, 4);
    const yellow = nextScrolls(input({ captured, componentsPerDay: 0 }));
    expect(yellow.some((s) => s.id.endsWith('-cap'))).toBe(false);
    const green = nextScrolls(input({ captured, belt: 'green', newPerDay: { vocab: 10, kanji: 0, grammar: 0 }, componentsPerDay: 0 }));
    const cap = green[0];
    expect(cap?.id).toBe('7-cap');
    expect(cap?.kind).toBe('vocab');
    expect(cap?.itemIds).toHaveLength(Math.floor(CAPTURED_SHARE * 10));
    expect(cap?.itemIds).toEqual(captured.slice(0, 4));
    const total = green.filter((s) => s.kind === 'vocab').reduce((n, s) => n + s.itemIds.length, 0);
    expect(total).toBeGreaterThanOrEqual(10);
    const few = nextScrolls(input({ captured: ['v-n4-0001', 'v-n4-0001', 'j-食'], belt: 'green', newPerDay: { vocab: 10, kanji: 0, grammar: 0 }, componentsPerDay: 0 }));
    expect(few[0]?.itemIds).toEqual(['v-n4-0001']);
  });
});
