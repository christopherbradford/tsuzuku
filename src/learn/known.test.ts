import { signal } from '@preact/signals';
import type { CardKey, Facet } from '../content/types';
import { CardFlag, type CardTuple, type CardsApi } from '../shared/store-types';
import { parseCardKey } from '../shared/ids';
import { KNOWN_R, createKnownSetCache, groupByItem, isKnown, kindOfCards, knownSet } from './known';

function fakeCards(init: Record<string, CardTuple>): CardsApi {
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

const TODAY = 20000;
/** Reviewed `ago` days ago with stability `s`. */
const card = (s: number, ago: number, flags = 0): CardTuple => [TODAY + 1, s, 5, 4, 0, 2, TODAY - ago, flags];

describe('isKnown', () => {
  it('threshold at R ≥ 0.85 (t/S ≤ 1.637)', () => {
    expect(KNOWN_R).toBe(0.85);
    expect(isKnown({ rec: card(10, 16) }, 'vocab', TODAY)).toBe(true);
    expect(isKnown({ rec: card(10, 17) }, 'vocab', TODAY)).toBe(false);
    expect(isKnown({ rec: card(10, 0) }, 'vocab', TODAY)).toBe(true);
  });
  it('uses the base facet per kind', () => {
    expect(isKnown({ comp: card(10, 0) }, 'kanji', TODAY)).toBe(true);
    expect(isKnown({ read: card(10, 0) }, 'kanji', TODAY)).toBe(false);
    expect(isKnown({ cloze: card(10, 0) }, 'grammar', TODAY)).toBe(true);
    expect(isKnown({ prod: card(10, 0) }, 'chunk', TODAY)).toBe(true);
    expect(isKnown({ listen: card(10, 0), prod: card(10, 0) }, 'vocab', TODAY)).toBe(false);
  });
  it('never-reviewed cards are not known', () => {
    expect(isKnown({ rec: [TODAY, 0, 0, 0, 0, 0, TODAY, 0] }, 'vocab', TODAY)).toBe(false);
  });
  it('archived cards still count', () => {
    expect(isKnown({ rec: card(200, 10, CardFlag.archived) }, 'kana', TODAY)).toBe(true);
  });
});

describe('kindOfCards', () => {
  it('detects chunks: vocab id with prod and no rec', () => {
    expect(kindOfCards('v-n5-0001', ['prod'])).toBe('chunk');
    expect(kindOfCards('v-n5-0001', ['rec', 'prod'])).toBe('vocab');
    expect(kindOfCards('v-n5-0001', ['listen'])).toBe('vocab');
    expect(kindOfCards('j-食', ['comp'])).toBe('kanji');
    expect(kindOfCards('g-n5-001', ['cloze'])).toBe('grammar');
    expect(kindOfCards('k-h-a', ['rec'])).toBe('kana');
    expect(kindOfCards('c-person', ['rec'])).toBe('component');
    expect(kindOfCards('s-07-1', ['rec'])).toBeUndefined();
    expect(kindOfCards('zzz', ['rec'])).toBeUndefined();
  });
});

describe('knownSet', () => {
  const cards = fakeCards({
    'v-n5-0001#rec': card(10, 16),
    'v-n5-0001#listen': card(1, 40),
    'v-n5-0002#rec': card(10, 17),
    'v-n5-0003#listen': card(100, 0),
    'v-n5-0004#prod': card(10, 0),
    'j-食#comp': card(10, 0),
    'j-食#read': card(0.5, 0),
    'j-日#read': card(100, 0),
    'g-n5-001#cloze': card(5, 0),
    'k-h-a#rec': card(300, 50, CardFlag.archived),
    'c-person#rec': card(100, 0),
  });
  it('groups cards by item', () => {
    const g = groupByItem(cards);
    expect(Object.keys(g.get('v-n5-0001') ?? {}).sort()).toEqual(['listen', 'rec']);
    expect(g.size).toBe(9);
  });
  it('includes items at R ≥ 0.85 on their base facet, excludes items without a receptive facet', () => {
    const s = knownSet(cards, TODAY);
    expect(s.has('v-n5-0001')).toBe(true);
    expect(s.has('v-n5-0002')).toBe(false);
    expect(s.has('v-n5-0003')).toBe(false);
    // prod-only vocab id = chunk: its base facet is prod, so it is known through production
    expect(s.has('v-n5-0004')).toBe(true);
    expect(s.has('j-食')).toBe(true);
    expect(s.has('j-日')).toBe(false);
    expect(s.has('g-n5-001')).toBe(true);
    expect(s.has('k-h-a')).toBe(true);
    expect(s.has('c-person')).toBe(true);
  });
  it('cache recomputes only when the version or the day changes', () => {
    const cached = createKnownSetCache();
    const a = cached(cards, TODAY);
    expect(cached(cards, TODAY)).toBe(a);
    const b = cached(cards, TODAY + 1);
    expect(b).not.toBe(a);
    cards.set('v-n5-0002#rec', card(100, 0));
    const c = cached(cards, TODAY + 1);
    expect(c).not.toBe(b);
    expect(c.has('v-n5-0002')).toBe(true);
  });
});
