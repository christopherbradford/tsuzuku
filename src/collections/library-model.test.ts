import { createFakeLoader, FIXTURE, G, V } from '../content/fixtures';
import type { CardKey } from '../content/types';
import type { CardTuple } from '../shared/store-types';
import { epochDay } from '../shared/time';
import { store } from '../store';
import { resetStoreForTests } from '../store/store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { filterItems, groupByStation, introducedItems, matchesQuery, michikusaGroups, placeItems, stationIndex, surfaceOf, type Surface } from './library-model';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

afterEach(() => {
  resetStoreForTests();
});

const CARDS: Record<CardKey, CardTuple> = {
  'k-h-a#rec': card({ s: 10, reps: 5, state: 2, due: TODAY + 3 }),
  [`${V.私}#rec`]: card({ s: 40, reps: 9, state: 2, due: TODAY + 20 }),
  [`${V.私}#prod`]: card({ s: 10, reps: 4, state: 2, due: TODAY + 5 }),
  [`${V.犬}#rec`]: card({ s: 2, reps: 2, state: 2, due: TODAY + 1 }),
  [`${V.おはよう}#prod`]: card({ s: 3, reps: 2, state: 2, due: TODAY + 2 }),
  'j-食#comp': card({ s: 2, reps: 1, state: 2, due: TODAY + 1 }),
  [`${G.です}#cloze`]: card({ s: 8, reps: 3, state: 2, due: TODAY + 4, flags: 1 }),
  'v-n3-0999#rec': card({ s: 0.5, reps: 0, state: 0, due: TODAY }),
};

describe('stationIndex', () => {
  it('indexes the bundles that load and lists the stations that do not', async () => {
    const idx = await stationIndex(loader, 4);
    expect(Array.from(idx.bundles.keys())).toEqual([1, 4]);
    expect(idx.failed).toEqual([2, 3]);
    expect(idx.map.get('k-h-a')).toBe(1);
    expect(idx.map.get(V.私)).toBe(1);
    expect(idx.map.get('j-食')).toBe(4);
    expect(idx.map.get(G.です)).toBe(4);
    expect(idx.map.get('c-eat')).toBe(4);
    expect((await stationIndex(loader, 0)).bundles.size).toBe(0);
  });
});

describe('placeItems / groupByStation', () => {
  it('derives kind, belt, archive flag and station for every introduced item, unplaced last', async () => {
    await makeTestStore({ cards: CARDS });
    const idx = await stationIndex(loader, 4);
    const items = placeItems(introducedItems(store.cards), store.cards, (id) => idx.map.get(id));
    const by = new Map(items.map((it) => [it.id, it]));
    expect(by.get(V.私)).toMatchObject({ kind: 'vocab', belt: 'brown', station: 1, archived: false });
    expect(by.get(V.犬)).toMatchObject({ kind: 'vocab', belt: 'yellow', station: 1 });
    expect(by.get(V.おはよう)).toMatchObject({ kind: 'chunk', belt: 'yellow', station: 1 });
    expect(by.get('k-h-a')).toMatchObject({ kind: 'kana', belt: 'green', station: 1 });
    expect(by.get('j-食')).toMatchObject({ kind: 'kanji', belt: 'yellow', station: 4 });
    expect(by.get(G.です)).toMatchObject({ kind: 'grammar', belt: 'green', station: 4, archived: true });
    expect(by.get('v-n3-0999')).toMatchObject({ kind: 'vocab', belt: 'white', station: 0 });
    const groups = groupByStation(items);
    expect(groups.map((g) => g.station)).toEqual([1, 4, 0]);
    expect(groups[0]?.def?.nameRomaji).toBe('Shinagawa');
    expect(groups[2]?.def).toBeUndefined();
    expect(groups[0]?.items.map((it) => it.kind)).toEqual(['kana', 'vocab', 'vocab', 'chunk']);
  });
});

describe('surfaceOf', () => {
  it('reads each kind, and gives an honest id-only placeholder while an item is not loaded', () => {
    const kana = surfaceOf(FIXTURE.items['k-h-a'], 'k-h-a');
    expect(kana).toMatchObject({ text: 'あ', meaning: 'a', speak: { text: 'あ', kana: 'あ' }, loaded: true });
    const vocab = surfaceOf(FIXTURE.items[V.私], V.私);
    expect(vocab).toMatchObject({ text: '私', reading: 'わたし', meaning: 'I', speak: { text: '私', kana: 'わたし' } });
    expect(vocab.example?.ja).toContain('{私|わたし}');
    const kana2 = surfaceOf(FIXTURE.items[V.おいしい], V.おいしい);
    expect(kana2.reading).toBeUndefined();
    const kanji = surfaceOf(FIXTURE.items['j-食'], 'j-食');
    expect(kanji).toMatchObject({ text: '食', meaning: 'eat', speak: { text: '食べる', kana: 'たべる' } });
    expect(kanji.reading).toContain('た.べる');
    const grammar = surfaceOf(FIXTURE.items[G.です], G.です);
    expect(grammar).toMatchObject({ text: '〜です', meaning: 'is …', speak: { text: '私はハナです。', kana: 'わたしはハナです。' } });
    const comp = surfaceOf(FIXTURE.items['c-eat'], 'c-eat');
    expect(comp).toMatchObject({ text: '食', meaning: 'eat', speak: null });
    expect(surfaceOf(undefined, 'v-n5-0001')).toMatchObject({ text: 'v-n5-0001', meaning: '', speak: null, loaded: false });
  });
});

describe('matchesQuery / filterItems', () => {
  const inu: Surface = surfaceOf(FIXTURE.items[V.犬], V.犬);
  const coffee: Surface = surfaceOf(FIXTURE.items[V.コーヒー], V.コーヒー);
  it('matches kana (katakana folded, IME variants), romaji and English substrings; empty matches all', () => {
    expect(matchesQuery(inu, '')).toBe(true);
    expect(matchesQuery(inu, 'いぬ')).toBe(true);
    expect(matchesQuery(inu, 'イヌ')).toBe(true);
    expect(matchesQuery(inu, 'inu')).toBe(true);
    expect(matchesQuery(inu, 'dog')).toBe(true);
    expect(matchesQuery(inu, 'DOG')).toBe(true);
    expect(matchesQuery(inu, 'cat')).toBe(false);
    expect(matchesQuery(inu, 'ねこ')).toBe(false);
    expect(matchesQuery(coffee, 'こーひー')).toBe(true);
    expect(matchesQuery(coffee, 'koohii')).toBe(true);
    expect(matchesQuery(coffee, 'coffee')).toBe(true);
  });

  it('filterItems combines kind, belt and query', async () => {
    await makeTestStore({ cards: CARDS });
    const idx = await stationIndex(loader, 4);
    const items = placeItems(introducedItems(store.cards), store.cards, (id) => idx.map.get(id));
    const surface = (id: string): Surface => surfaceOf(loader.get(id), id);
    expect(filterItems(items, { kind: 'kanji', belt: '', query: '' }, surface).map((i) => i.id)).toEqual(['j-食']);
    expect(filterItems(items, { kind: '', belt: 'brown', query: '' }, surface).map((i) => i.id)).toEqual([V.私]);
    expect(filterItems(items, { kind: '', belt: '', query: 'eat' }, surface).map((i) => i.id).sort()).toEqual(['j-食']);
    expect(filterItems(items, { kind: 'vocab', belt: 'yellow', query: 'inu' }, surface).map((i) => i.id)).toEqual([V.犬]);
    expect(filterItems(items, { kind: 'grammar', belt: 'brown', query: '' }, surface)).toEqual([]);
  });
});

describe('michikusaGroups', () => {
  it('counts collected and missing fragments per station, falling back to four when a bundle is missing', async () => {
    const idx = await stationIndex(loader, 4);
    const groups = michikusaGroups(idx.bundles, ['m-04-2'], 4);
    expect(groups.map((g) => g.station)).toEqual([1, 2, 3, 4]);
    expect(groups[0]).toMatchObject({ total: 0, missing: 0, collected: [] });
    expect(groups[1]).toMatchObject({ total: 4, missing: 4, collected: [] });
    expect(groups[3]).toMatchObject({ total: 2, missing: 1, collected: ['m-04-2'], ids: ['m-04-1', 'm-04-2'] });
    expect(groups[3]?.def?.nameRomaji).toBe('Hodogaya');
    // a collected fragment beyond the current station extends the range; unknown ids are ignored
    const far = michikusaGroups(idx.bundles, ['m-07-3', 'bogus', 'm-07-3'], 4);
    expect(far).toHaveLength(7);
    expect(far[6]).toMatchObject({ total: 4, missing: 3, collected: ['m-07-3'] });
  });
});
