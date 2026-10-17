import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, MemoryStorage, TEST_SEED, captureEvents, card, deepMerge, makeTestStore, shardDocuments } from './testing';

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('makeTestStore', () => {
  it('resolves a ready store with no reducers and a deterministic clock', async () => {
    const s = await makeTestStore();
    expect(s).toBe(store);
    expect(s.ready.value).toBe(true);
    expect(s.now()).toBe(DEFAULT_TEST_NOW);
    expect(s.today()).toBe(epochDay(DEFAULT_TEST_NOW, 'UTC'));
    expect(s.seed()).toBe(TEST_SEED);
    expect(s.profile.value.tz).toBe('UTC');
    expect(s.cards.count()).toBe(0);
  });

  it('applies deep-partial save overrides and places cards into shards', async () => {
    const s = await makeTestStore({
      save: { profile: { name: 'Kumo', belt: 'green' }, settings: { intensity: 'intense' }, progress: { station: 17 }, stats: { reviews: 9 } },
      cards: { 'v-n4-0001#rec': card({ s: 8 }), 'j-食#comp': card({ s: 2 }), 'k-h-a#rec': card() },
      now: 1_000_000,
    });
    expect(s.profile.value.name).toBe('Kumo');
    expect(s.profile.value.belt).toBe('green');
    expect(s.profile.value.nameKana).toBe('むめい');
    expect(s.settings.value.intensity).toBe('intense');
    expect(s.settings.value.feel).toBe('dojo');
    expect(s.stats.value.reviews).toBe(9);
    expect(s.stats.value.sessions).toBe(0);
    expect(s.now()).toBe(1_000_000);
    expect(s.cards.count()).toBe(3);
    expect(s.cards.get('v-n4-0001#rec')).toEqual(card({ s: 8 }));
  });

  it('accepts a clock function and a caller-supplied storage', async () => {
    let t = 5;
    const storage = new MemoryStorage();
    const s = await makeTestStore({ now: () => t, storage });
    expect(s.now()).toBe(5);
    t = 6;
    expect(s.now()).toBe(6);
    expect(storage.getItem('tsuzuku.meta.v1')).not.toBeNull();
  });

  it('shardDocuments groups cards under the right keys', () => {
    const docs = shardDocuments({ 'v-n5-0001#rec': card(), 'v-n5-0002#rec': card(), 'j-食#comp': card() }, { station: 20 });
    expect(Object.keys(docs).sort()).toEqual(['tsuzuku.cards.v1.kanji.n4', 'tsuzuku.cards.v1.vocab.n5']);
    expect(docs['tsuzuku.cards.v1.vocab.n5'].kind).toBe('vocab');
    expect(Object.keys(docs['tsuzuku.cards.v1.vocab.n5'].cards)).toHaveLength(2);
  });
});

describe('card()', () => {
  it('defaults and overrides', () => {
    expect(card()).toEqual([0, 0, 5, 0, 0, 0, 0, 0]);
    expect(card({ due: 7, s: 1.5, state: 2, flags: 4 })).toEqual([7, 1.5, 5, 0, 0, 2, 0, 4]);
  });
});

describe('deepMerge', () => {
  it('merges nested plain objects, replaces arrays and primitives, skips undefined', () => {
    const out = deepMerge({ a: { b: 1, c: [1, 2], d: 'x' }, e: 2 }, { a: { c: [3], d: undefined }, e: 5 });
    expect(out).toEqual({ a: { b: 1, c: [3], d: 'x' }, e: 5 });
  });
});

describe('MemoryStorage', () => {
  it('behaves like localStorage incl. length and key', () => {
    const s = new MemoryStorage();
    expect(s.length).toBe(0);
    expect(s.key(0)).toBeNull();
    s.setItem('a', '1');
    s.setItem('b', '2');
    expect(s.length).toBe(2);
    expect(s.key(0)).toBe('a');
    expect(s.key(1)).toBe('b');
    expect(s.getItem('a')).toBe('1');
    expect(s.getItem('zz')).toBeNull();
    s.removeItem('a');
    expect(s.length).toBe(1);
    expect(s.key(0)).toBe('b');
    s.clear();
    expect(s.length).toBe(0);
    expect(s.writes).toBe(2);
  });

  it('throws QuotaExceededError when the UTF-16 quota would be exceeded', () => {
    const s = new MemoryStorage(20);
    s.setItem('ab', 'cdefgh'); // (2 + 6) * 2 = 16
    expect(s.bytes()).toBe(16);
    expect(() => s.setItem('x', 'yyy')).toThrow(DOMException);
    try {
      s.setItem('x', 'yyy');
    } catch (e) {
      expect((e as DOMException).name).toBe('QuotaExceededError');
    }
    // Overwriting with a shorter value is always allowed.
    s.setItem('ab', 'c');
    expect(s.bytes()).toBe(6);
  });
});

describe('captureEvents', () => {
  it('records emits in order until stop(), nestable, and still delivers to subscribers', () => {
    const got: number[] = [];
    bus.on('level:up', (p) => got.push(p.level));
    const outer = captureEvents();
    bus.emit('level:up', { level: 1 });
    const inner = captureEvents();
    bus.emit('level:up', { level: 2 });
    inner.stop();
    bus.emit('xp:gained', { amount: 5, reason: 'test', total: 5 });
    outer.stop();
    bus.emit('level:up', { level: 3 });
    expect(outer.events).toEqual([
      ['level:up', { level: 1 }],
      ['level:up', { level: 2 }],
      ['xp:gained', { amount: 5, reason: 'test', total: 5 }],
    ]);
    expect(inner.events).toEqual([['level:up', { level: 2 }]]);
    expect(got).toEqual([1, 2, 3]);
  });
});
