import type { CardKey } from '../content/types';
import { SESSION_SCHEMA, type SessionSnapshot } from '../shared/session-types';
import { epochDay } from '../shared/time';
import { CardFlag, type CardShard, type LogEntry, type ReviewLog, type SaveMeta } from '../shared/store-types';
import { CEILING_BYTES, GZIP_PREFIX, LOG_RING, hasCompression } from './persist';
import { initStore, registerReducer, resetStoreForTests, shardOfKey, shardSizes, store, storeCards } from './store';
import { MemoryStorage, card } from './testing';

const NOW = Date.UTC(2026, 0, 15, 12);
const TODAY = epochDay(NOW, 'UTC');

function snapshot(cursor = 0): SessionSnapshot {
  return {
    schema: SESSION_SCHEMA,
    plan: { id: 'p1', mode: 'kata', day: TODAY, createdAt: NOW, station: 1, steps: [], blocks: [], meta: { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] } },
    cursor,
    results: [],
    kiai: { ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] },
  };
}

afterEach(() => {
  resetStoreForTests();
  vi.useRealTimers();
});

describe('initStore', () => {
  it('on empty storage yields a fresh learner and ready', async () => {
    const s = new MemoryStorage();
    expect(store.ready.value).toBe(false);
    await initStore({ storage: s, now: () => NOW, reducers: false });
    expect(store.ready.value).toBe(true);
    expect(store.profile.value.name).toBe('無名');
    expect(store.profile.value.belt).toBe('white');
    expect(store.cards.count()).toBe(0);
    expect(store.log.recent(10)).toEqual([]);
    expect(store.session.load()).toBeNull();
    expect(store.storage.value.level).toBe('ok');
    expect(store.now()).toBe(NOW);
    expect(store.seed()).toMatch(/^[0-9a-f]{16}$/);
    expect(store.meta().schema).toBe('tsuzuku.save/1');
    expect(store.meta().createdAt).toBe(NOW);
    // Nothing is written until something changes.
    expect(s.length).toBe(0);
  });

  it('today() uses the 04:00 boundary in the profile zone', async () => {
    await initStore({ storage: new MemoryStorage(), now: () => NOW, reducers: false });
    store.patch('profile', (p) => ({ ...p, tz: 'Asia/Tokyo' }));
    expect(store.today()).toBe(epochDay(NOW, 'Asia/Tokyo'));
    store.patch('profile', (p) => ({ ...p, tz: 'Not/AZone' }));
    expect(store.today()).toBe(epochDay(NOW));
  });

  it('a corrupted meta document is ignored, an unreadable schema is stashed as .bak', async () => {
    const s = new MemoryStorage();
    s.setItem('tsuzuku.meta.v1', '{broken');
    await initStore({ storage: s, now: () => NOW, reducers: false });
    expect(store.profile.value.name).toBe('無名');

    const s2 = new MemoryStorage();
    s2.setItem('tsuzuku.meta.v1', JSON.stringify({ schema: 'tsuzuku.save/99', profile: { name: 'Future' } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await initStore({ storage: s2, now: () => NOW, reducers: false });
    warn.mockRestore();
    expect(store.profile.value.name).toBe('無名');
    expect(JSON.parse(s2.getItem('tsuzuku.meta.v1.bak') as string).profile.name).toBe('Future');
  });

  it('wires registered reducers unless reducers:false, and stops them on re-init', async () => {
    let started = 0;
    let stopped = 0;
    const off = registerReducer(() => {
      started++;
      return () => {
        stopped++;
      };
    });
    await initStore({ storage: new MemoryStorage(), now: () => NOW, reducers: false });
    expect(started).toBe(0);
    await initStore({ storage: new MemoryStorage(), now: () => NOW });
    expect(started).toBe(1);
    await initStore({ storage: new MemoryStorage(), now: () => NOW });
    expect(stopped).toBe(1);
    expect(started).toBe(2);
    off();
    resetStoreForTests();
    expect(stopped).toBe(2);
  });
});

describe('patch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('updates the signal immutably and schedules the meta write', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW + 5, reducers: false });
    const prev = store.profile.value;
    const prevCopy = JSON.parse(JSON.stringify(prev)) as SaveMeta['profile'];
    store.patch('profile', (p) => ({ ...p, name: 'つづき', xp: 120 }));
    expect(store.profile.value).not.toBe(prev);
    expect(store.profile.value.name).toBe('つづき');
    expect(prev).toEqual(prevCopy);
    expect(store.meta().updatedAt).toBe(NOW + 5);
    expect(s.getItem('tsuzuku.meta.v1')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    const saved = JSON.parse(s.getItem('tsuzuku.meta.v1') as string) as SaveMeta;
    expect(saved.profile.name).toBe('つづき');
    expect(saved.profile.xp).toBe(120);
    expect(saved.schema).toBe('tsuzuku.save/1');
  });

  it('returning the same object writes nothing', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW, reducers: false });
    store.patch('stats', (x) => x);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.length).toBe(0);
  });
});

describe('cards', () => {
  it('set bumps version once per write and marks the shard dirty with kind and level', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW, reducers: false });
    const v0 = store.cards.version.value;
    store.cards.set('v-n5-0001#rec', card({ due: TODAY, s: 2 }));
    expect(store.cards.version.value).toBe(v0 + 1);
    store.cards.set('v-n5-0001#rec', card({ due: TODAY + 1, s: 3 }));
    expect(store.cards.version.value).toBe(v0 + 2);
    expect(store.cards.get('v-n5-0001#rec')).toEqual(card({ due: TODAY + 1, s: 3 }));
    await store.flush();
    const shard = JSON.parse(s.getItem('tsuzuku.cards.v1.vocab.n5') as string) as CardShard;
    expect(shard.schema).toBe('tsuzuku.cards/1');
    expect(shard.kind).toBe('vocab');
    expect(shard.level).toBe('n5');
    expect(shard.cards['v-n5-0001#rec']).toEqual(card({ due: TODAY + 1, s: 3 }));
    expect(s.keys()).toEqual(['tsuzuku.cards.v1.vocab.n5']);
  });

  it('splits shards by kind and level; kanji follow the current station; hints override', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW, reducers: false });
    store.patch('progress', (p) => ({ ...p, station: 16 }));
    store.cards.set('v-n5-0001#rec', card());
    store.cards.set('v-n4-0001#prod', card());
    store.cards.set('g-n3-001#cloze', card());
    store.cards.set('k-h-a#rec', card());
    store.cards.set('c-person#rec', card());
    store.cards.set('j-食#comp', card());
    storeCards.set('j-水#comp', card(), { level: 'n5' });
    expect(shardOfKey('v-n5-0001#rec')).toBe('vocab.n5');
    expect(shardOfKey('v-n4-0001#prod')).toBe('vocab.n4');
    expect(shardOfKey('g-n3-001#cloze')).toBe('grammar.n3');
    expect(shardOfKey('k-h-a#rec')).toBe('kana.kana');
    expect(shardOfKey('c-person#rec')).toBe('misc.kana');
    expect(shardOfKey('j-食#comp')).toBe('kanji.n4');
    expect(shardOfKey('j-水#comp')).toBe('kanji.n5');
    // A later write to a placed key stays in its shard even if the station moved on.
    store.patch('progress', (p) => ({ ...p, station: 40 }));
    store.cards.set('j-食#comp', card({ s: 9 }));
    expect(shardOfKey('j-食#comp')).toBe('kanji.n4');
    expect(shardSizes()).toEqual({ 'vocab.n5': 1, 'vocab.n4': 1, 'grammar.n3': 1, 'kana.kana': 1, 'misc.kana': 1, 'kanji.n4': 1, 'kanji.n5': 1 });
    await store.flush();
    expect(s.keys().filter((k) => k.startsWith('tsuzuku.cards.')).sort()).toEqual(
      [
        'tsuzuku.cards.v1.grammar.n3',
        'tsuzuku.cards.v1.kana.kana',
        'tsuzuku.cards.v1.kanji.n4',
        'tsuzuku.cards.v1.kanji.n5',
        'tsuzuku.cards.v1.misc.kana',
        'tsuzuku.cards.v1.vocab.n4',
        'tsuzuku.cards.v1.vocab.n5',
      ].sort(),
    );
  });

  it('dueOn returns due keys excluding archived and kaiden unless asked', async () => {
    await initStore({ storage: new MemoryStorage(), now: () => NOW, reducers: false });
    store.cards.set('v-n5-0001#rec', card({ due: TODAY - 3 }));
    store.cards.set('v-n5-0002#rec', card({ due: TODAY }));
    store.cards.set('v-n5-0003#rec', card({ due: TODAY + 1 }));
    store.cards.set('v-n5-0004#rec', card({ due: TODAY, flags: CardFlag.archived }));
    store.cards.set('v-n5-0005#rec', card({ due: TODAY, flags: CardFlag.kaiden }));
    store.cards.set('v-n5-0006#rec', card({ due: TODAY, flags: CardFlag.nemesis }));
    expect(store.cards.dueOn(TODAY).sort()).toEqual(['v-n5-0001#rec', 'v-n5-0002#rec', 'v-n5-0006#rec']);
    expect(store.cards.dueOn(TODAY - 1)).toEqual(['v-n5-0001#rec']);
    expect(storeCards.dueOn(TODAY, { includeKaiden: true }).sort()).toEqual(['v-n5-0001#rec', 'v-n5-0002#rec', 'v-n5-0005#rec', 'v-n5-0006#rec']);
    expect(storeCards.dueOn(TODAY, { includeArchived: true, includeKaiden: true })).toHaveLength(5);
  });

  it('byItem, forEach, count and delete', async () => {
    await initStore({ storage: new MemoryStorage(), now: () => NOW, reducers: false });
    store.cards.set('v-n5-0001#rec', card({ s: 1 }));
    store.cards.set('v-n5-0001#prod', card({ s: 2 }));
    store.cards.set('v-n5-0002#rec', card({ s: 3 }));
    expect(store.cards.byItem('v-n5-0001')).toEqual({ rec: card({ s: 1 }), prod: card({ s: 2 }) });
    expect(store.cards.byItem('v-n5-0009')).toEqual({});
    expect(store.cards.count()).toBe(3);
    const seen: CardKey[] = [];
    store.cards.forEach((k) => seen.push(k));
    expect(seen.sort()).toEqual(['v-n5-0001#prod', 'v-n5-0001#rec', 'v-n5-0002#rec']);
    const v = store.cards.version.value;
    store.cards.delete('v-n5-0002#rec');
    expect(store.cards.version.value).toBe(v + 1);
    store.cards.delete('v-n5-0002#rec');
    expect(store.cards.version.value).toBe(v + 1);
    expect(store.cards.count()).toBe(2);
    expect(store.cards.get('v-n5-0002#rec')).toBeUndefined();
  });
});

describe('log', () => {
  it('keeps a ring of 5,000 entries, newest last; forCard filters', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW, reducers: false });
    for (let i = 0; i < LOG_RING + 10; i++) store.log.push([i, i % 2 ? 'v-n5-0001#rec' : 'v-n5-0002#rec', 3, 1000, 0, 0]);
    const all = store.log.recent(LOG_RING + 100);
    expect(all).toHaveLength(LOG_RING);
    expect(all[0][0]).toBe(10);
    expect(all.at(-1)?.[0]).toBe(LOG_RING + 9);
    expect(store.log.recent(3).map((e) => e[0])).toEqual([LOG_RING + 7, LOG_RING + 8, LOG_RING + 9]);
    expect(store.log.recent(0)).toEqual([]);
    expect(store.log.forCard('v-n5-0001#rec')).toHaveLength(LOG_RING / 2);
    await store.flush();
    const doc = JSON.parse(s.getItem('tsuzuku.log.v1') as string) as ReviewLog;
    expect(doc.schema).toBe('tsuzuku.log/1');
    expect(doc.entries).toHaveLength(LOG_RING);
  });
});

describe('session', () => {
  it('save/load round-trip, persisted on flush, cleared on clear', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW, reducers: false });
    expect(store.session.load()).toBeNull();
    const snap = snapshot(3);
    store.session.save(snap);
    expect(store.session.load()).toBe(snap);
    await store.flush();
    expect(JSON.parse(s.getItem('tsuzuku.session.v1') as string).cursor).toBe(3);

    await initStore({ storage: s, now: () => NOW, reducers: false });
    expect(store.session.load()).toEqual(snap);
    store.session.clear();
    expect(store.session.load()).toBeNull();
    expect(s.getItem('tsuzuku.session.v1')).toBeNull();
  });

  it('ignores a snapshot with a foreign schema', async () => {
    const s = new MemoryStorage();
    s.setItem('tsuzuku.session.v1', JSON.stringify({ schema: 'tsuzuku.session/0', cursor: 1 }));
    await initStore({ storage: s, now: () => NOW, reducers: false });
    expect(store.session.load()).toBeNull();
  });
});

describe('persistence round trip', () => {
  it('everything written comes back after a re-init over the same storage', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW, reducers: false });
    const seed = store.seed();
    store.patch('profile', (p) => ({ ...p, name: 'Round', xp: 777 }));
    store.patch('progress', (p) => ({ ...p, station: 7, stationsCleared: [1, 2, 3, 4, 5, 6] }));
    store.cards.set('v-n5-0001#rec', card({ due: TODAY, s: 4.5, reps: 3 }));
    store.cards.set('j-食#comp', card({ due: TODAY, s: 1 }));
    store.cards.set('k-h-a#prod', card({ due: TODAY + 10, s: 40 }));
    const entry: LogEntry = [NOW, 'v-n5-0001#rec', 3, 1234, 5, 0];
    store.log.push(entry);
    store.session.save(snapshot(1));
    await store.flush();
    const metaBefore = store.meta();

    resetStoreForTests();
    expect(store.cards.count()).toBe(0);
    await initStore({ storage: s, now: () => NOW + 1000, reducers: false });
    expect(store.seed()).toBe(seed);
    expect(store.profile.value.name).toBe('Round');
    expect(store.profile.value.xp).toBe(777);
    expect(store.progress.value.stationsCleared).toEqual([1, 2, 3, 4, 5, 6]);
    expect(store.cards.count()).toBe(3);
    expect(store.cards.get('v-n5-0001#rec')).toEqual(card({ due: TODAY, s: 4.5, reps: 3 }));
    expect(store.cards.get('k-h-a#prod')).toEqual(card({ due: TODAY + 10, s: 40 }));
    expect(shardOfKey('j-食#comp')).toBe('kanji.n5');
    expect(store.log.recent(5)).toEqual([entry]);
    expect(store.session.load()?.cursor).toBe(1);
    expect(store.meta()).toEqual(metaBefore);
    expect(store.storage.value.bytes).toBeGreaterThan(0);
  });

  it('slots suffix every key', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, slot: 2, now: () => NOW, reducers: false });
    store.patch('profile', (p) => ({ ...p, name: 'Two' }));
    store.cards.set('v-n5-0001#rec', card());
    store.log.push([NOW, 'v-n5-0001#rec', 3, 1, 0, 0]);
    store.session.save(snapshot());
    await store.flush();
    expect(s.keys().sort()).toEqual(['tsuzuku.cards.v1.vocab.n5.2', 'tsuzuku.log.v1.2', 'tsuzuku.meta.v1.2', 'tsuzuku.session.v1.2']);
    await initStore({ storage: s, slot: 0, now: () => NOW, reducers: false });
    expect(store.profile.value.name).toBe('無名');
  });
});

describe('storage meter and ceiling ladder', () => {
  it('reports bytes/level after flushes', async () => {
    const s = new MemoryStorage();
    await initStore({ storage: s, now: () => NOW, reducers: false });
    store.cards.set('v-n5-0001#rec', card());
    await store.flush();
    expect(store.storage.value.level).toBe('ok');
    expect(store.storage.value.bytes).toBe(s.bytes());
  });

  it('at the ceiling: log ring → 2,000, then the largest shard is gzip-compressed', async () => {
    const s = new MemoryStorage();
    // Leave ~150 KB of headroom under the 4.5 MB ceiling.
    s.setItem('filler', 'x'.repeat((CEILING_BYTES - 150 * 1024) / 2 - 3));
    await initStore({ storage: s, now: () => NOW, reducers: false });
    for (let i = 0; i < 2000; i++) store.cards.set(`v-n5-${String(i).padStart(4, '0')}#rec`, card({ due: TODAY + (i % 30), s: (i % 200) + 0.25, reps: i % 9, last: TODAY - (i % 15) }));
    for (let i = 0; i < 5000; i++) store.log.push([NOW + i, 'v-n5-0001#rec', 3, 1500, 4, 0]);
    await store.flush();
    await vi.waitFor(() => {
      expect(store.log.recent(5000)).toHaveLength(2000);
    });
    await vi.waitFor(() => {
      expect(JSON.parse(s.getItem('tsuzuku.log.v1') as string).entries).toHaveLength(2000);
    });
    if (hasCompression()) {
      await vi.waitFor(() => {
        expect((s.getItem('tsuzuku.cards.v1.vocab.n5') as string).startsWith(GZIP_PREFIX)).toBe(true);
      });
      // The compressed shard reads back on the next init.
      await initStore({ storage: s, now: () => NOW, reducers: false });
      expect(store.cards.count()).toBe(2000);
      expect(store.cards.get('v-n5-1999#rec')).toEqual(card({ due: TODAY + (1999 % 30), s: (1999 % 200) + 0.25, reps: 1999 % 9, last: TODAY - (1999 % 15) }));
    }
  });
});
