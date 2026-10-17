import type { CardKey } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple, LogEntry, SaveMeta } from '../shared/store-types';
import { BACKUP_SCHEMA, applyImport, buildBackup, collectShards, exportSave, mergeSaves, previewImport, previewImportBlob, readBlobBytes, readBlobText, unionLogs, type BackupDocument } from './backup';
import { LOG_RING, hasCompression } from './persist';
import { initStore, resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, MemoryStorage, TEST_SEED, captureEvents, card, makeTestStore, testSave } from './testing';
import { S } from './strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function live(s: number, last = TODAY, reps = 3): CardTuple {
  return card({ due: last + 1, s, reps, state: 2, last });
}

const CARDS: Record<CardKey, CardTuple> = {
  'v-n5-0001#rec': live(10),
  'v-n5-0002#rec': live(3),
  'k-h-a#rec': live(40),
  'j-食#comp': live(8),
  'g-n5-001#cloze': live(5),
};

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('exportSave', () => {
  it('builds a versioned envelope with every slice, every shard and the log; counts exports; emits backup:exported', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { name: 'ハナ', xp: 1234 } } });
    store.log.push([DEFAULT_TEST_NOW - 1000, 'v-n5-0001#rec', 3, 1200, 5, 0]);
    const cap = captureEvents();
    const { blob, filename } = await exportSave();
    cap.stop();
    expect(filename).toBe('tsuzuku-backup-2026-01-15.json');
    expect(blob.type).toBe('application/json');
    const doc = JSON.parse(await readBlobText(blob)) as BackupDocument;
    expect(doc.schema).toBe(BACKUP_SCHEMA);
    expect(doc.exportedAt).toBe(DEFAULT_TEST_NOW);
    expect(doc.meta.profile.name).toBe('ハナ');
    expect(doc.meta.stats.exports).toBe(1);
    // Kanji ids carry no level: at station 0 the shard falls back to kanji.n5.
    expect(Object.keys(doc.shards).sort()).toEqual(['grammar.n5', 'kana.kana', 'kanji.n5', 'vocab.n5']);
    const all = Object.values(doc.shards).flatMap((s) => Object.keys(s.cards));
    expect(all.sort()).toEqual(Object.keys(CARDS).sort());
    expect(doc.log.entries.length).toBe(1);
    expect(store.stats.value.exports).toBe(1);
    expect(cap.events.filter(([n]) => n === 'backup:exported').length).toBe(1);
    expect(collectShards()['vocab.n5'].cards['v-n5-0001#rec']).toEqual(CARDS['v-n5-0001#rec']);
  });

  it('gzip yields real gzip bytes and previewImportBlob reads them back', async () => {
    if (!hasCompression()) return;
    await makeTestStore({ cards: CARDS });
    const { blob, filename } = await exportSave({ gzip: true });
    expect(filename).toBe('tsuzuku-backup-2026-01-15.tsuzuku.json.gz');
    expect(blob.type).toBe('application/gzip');
    const bytes = await readBlobBytes(blob);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const p = await previewImportBlob(blob);
    expect(p.valid).toBe(true);
    expect(p.summary.cards).toEqual([5, 5]);
    // The same bytes handed over as text are refused with a calm hint.
    const asText = new TextDecoder().decode(bytes);
    expect(previewImport(asText)).toMatchObject({ valid: false, errors: [S.importCompressed] });
  });
});

describe('previewImport', () => {
  it('invalid JSON and non-saves are refused without touching the store', async () => {
    await makeTestStore({ cards: CARDS });
    expect(previewImport('{nope')).toMatchObject({ valid: false, errors: [S.importNotJson] });
    expect(previewImport('')).toMatchObject({ valid: false, errors: [S.importNotJson] });
    expect(previewImport('[1,2]')).toMatchObject({ valid: false, errors: [S.importNotBackup] });
    expect(previewImport('{"hello":1}')).toMatchObject({ valid: false, errors: [S.importNotBackup] });
    expect(previewImport(JSON.stringify({ schema: 'tsuzuku.backup/9', meta: testSave() }))).toMatchObject({ valid: false, errors: [S.importNewer] });
    expect(previewImport(JSON.stringify({ meta: { ...testSave(), schema: 'tsuzuku.save/7' } }))).toMatchObject({ valid: false, errors: [S.importNewer] });
    expect(store.cards.count()).toBe(5);
    const bad = previewImport('{"hello":1}');
    expect(bad.summary.cards).toEqual([5, 0]);
    expect(bad.summary.cardsLost).toBe(5);
  });

  it('summarises streak, xp, cards, badges and days against the current save', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { xp: 100 }, streak: { current: 2, totalDays: 9 }, collections: { badges: { 'first-step': TODAY } } } });
    const incoming = testSave({ save: { profile: { xp: 500 }, streak: { current: 7, totalDays: 30 }, collections: { badges: { 'first-step': TODAY - 5, seven: TODAY - 1 } } } });
    const doc = {
      schema: BACKUP_SCHEMA,
      exportedAt: 123,
      meta: incoming,
      shards: {
        'vocab.n5': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n5', cards: { 'v-n5-0001#rec': live(20, TODAY + 1), 'v-n5-0009#rec': live(1) } },
        broken: { schema: 'tsuzuku.cards/1', cards: {} },
      },
      log: { schema: 'tsuzuku.log/1', entries: [[1, 'v-n5-0001#rec', 3, 900, 5, 0], ['bad']] },
    };
    const p = previewImport(JSON.stringify(doc));
    expect(p.valid).toBe(true);
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([S.importNoShard]);
    expect(p.summary).toEqual({ streak: [2, 7], xp: [100, 500], cards: [5, 2], badges: [1, 2], days: [9, 30], cardsGained: 1, cardsLost: 4 });
    expect(p.exportedAt).toBe(123);
    expect(p.data?.log).toEqual([[1, 'v-n5-0001#rec', 3, 900, 5, 0]]);
  });

  it('accepts a bare SaveMeta and the design-07 shape', async () => {
    await makeTestStore();
    const bare = previewImport(JSON.stringify(testSave({ save: { profile: { xp: 50 } } })));
    expect(bare.valid).toBe(true);
    expect(bare.summary.xp).toEqual([0, 50]);
    const d07 = previewImport(JSON.stringify({ meta: testSave(), shards: [], log: [] }));
    expect(d07.valid).toBe(true);
  });
});

describe('mergeSaves (pure)', () => {
  it('streak max, XP max, collections union, ledger union; settings stay local', () => {
    const cur = testSave({ save: { profile: { xp: 300, belt: 'yellow', name: 'A' }, settings: { feel: 'zen' }, streak: { current: 5, longest: 9, totalDays: 40, freezes: 3, lastDay: TODAY }, collections: { badges: { 'first-step': TODAY - 9 } }, ledger: { entries: [[TODAY, 10, 0, 1]] }, stats: { reviews: 100 }, progress: { station: 6, stationsCleared: [1, 2, 3, 4, 5] } } });
    const inc = testSave({ save: { profile: { xp: 2500, belt: 'orange', name: 'B' }, settings: { feel: 'arcade' }, streak: { current: 8, longest: 8, totalDays: 35, freezes: 1, lastDay: TODAY - 1 }, collections: { badges: { 'first-step': TODAY - 20, seven: TODAY - 3 } }, ledger: { entries: [[TODAY, 10, 0, 1], [TODAY - 1, 20, 1, 1]] }, stats: { reviews: 80, sessions: 9 }, progress: { station: 11, stationsCleared: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } } });
    const m = mergeSaves(cur, inc, 999);
    expect(m.profile).toMatchObject({ xp: 2500, level: 5, belt: 'orange', name: 'A' });
    expect(m.settings.feel).toBe('zen');
    expect(m.streak).toMatchObject({ current: 8, longest: 9, totalDays: 40, freezes: 3, lastDay: TODAY });
    expect(m.collections.badges).toEqual({ 'first-step': TODAY - 20, seven: TODAY - 3 });
    expect(m.ledger.entries).toEqual([[TODAY - 1, 20, 1, 1], [TODAY, 10, 0, 1]]);
    expect(m.stats.reviews).toBe(100);
    expect(m.stats.sessions).toBe(9);
    expect(m.progress.station).toBe(11);
    expect(m.progress.stationsCleared).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(m.updatedAt).toBe(999);
    expect(m.seed).toBe(cur.seed);
  });

  it('progress: gateAttemptDay and gateAttemptAt keep the later value per station', () => {
    const cur = testSave({ save: { progress: { gateAttemptDay: { 4: TODAY - 1 }, gateAttemptAt: { 4: 100 } } } });
    const inc = testSave({ save: { progress: { gateAttemptDay: { 4: TODAY, 7: TODAY - 2 }, gateAttemptAt: { 4: 500, 7: 50 } } } });
    const m = mergeSaves(cur, inc, 999);
    expect(m.progress.gateAttemptDay).toEqual({ 4: TODAY, 7: TODAY - 2 });
    expect(m.progress.gateAttemptAt).toEqual({ 4: 500, 7: 50 });
    expect(mergeSaves(inc, cur, 999).progress.gateAttemptAt).toEqual({ 4: 500, 7: 50 });
  });
});

describe('applyImport', () => {
  it('export → replace into an empty store round-trips the save, the cards and the log', async () => {
    const storageA = new MemoryStorage();
    await makeTestStore({ cards: CARDS, storage: storageA, save: { seed: 'feedfacefeedface', profile: { name: 'ハナ', xp: 4321 }, streak: { current: 3, totalDays: 12 } } });
    expect(store.seed()).toBe('feedfacefeedface');
    store.log.push([DEFAULT_TEST_NOW - 5000, 'k-h-a#rec', 3, 800, 0, 0]);
    const { blob } = await exportSave();
    const json = await readBlobText(blob);
    const before: SaveMeta = JSON.parse(JSON.stringify(store.meta()));

    resetStoreForTests();
    await makeTestStore({ storage: new MemoryStorage() });
    const p = previewImport(json);
    expect(p.valid).toBe(true);
    expect(applyImport(p, 'replace')).toBe(true);
    const after = store.meta();
    expect(after.profile).toEqual(before.profile);
    expect(after.streak).toEqual(before.streak);
    expect(after.stats.imports).toBe(1);
    expect({ ...after.stats, imports: 0 }).toEqual({ ...before.stats, imports: 0 });
    expect(after.seed).toBe(before.seed);
    expect(store.seed()).toBe('feedfacefeedface');
    expect(store.cards.count()).toBe(5);
    for (const [k, t] of Object.entries(CARDS) as [CardKey, CardTuple][]) expect(store.cards.get(k)).toEqual(t);
    expect(store.log.recent(10)).toEqual([[DEFAULT_TEST_NOW - 5000, 'k-h-a#rec', 3, 800, 0, 0]]);
    expect(applyImport({ ...p, valid: false }, 'replace')).toBe(false);
  });

  it('replace drops cards the backup lacks; merge keeps them and takes the newer copy', async () => {
    await makeTestStore({ cards: CARDS, save: { profile: { xp: 10 } } });
    const incomingCards: Record<CardKey, CardTuple> = {
      'v-n5-0001#rec': live(99, TODAY + 2), // newer
      'v-n5-0002#rec': live(1, TODAY - 5), // older
      'v-n5-0777#rec': live(2), // new
    };
    const doc = { schema: BACKUP_SCHEMA, meta: testSave({ save: { profile: { xp: 5 } } }), shards: { 'vocab.n5': { schema: 'tsuzuku.cards/1', kind: 'vocab', level: 'n5', cards: incomingCards } }, log: { schema: 'tsuzuku.log/1', entries: [] } };
    const json = JSON.stringify(doc);

    expect(applyImport(previewImport(json), 'merge')).toBe(true);
    expect(store.cards.count()).toBe(6);
    expect(store.cards.get('v-n5-0001#rec')).toEqual(incomingCards['v-n5-0001#rec']);
    expect(store.cards.get('v-n5-0002#rec')).toEqual(CARDS['v-n5-0002#rec']);
    expect(store.cards.get('k-h-a#rec')).toEqual(CARDS['k-h-a#rec']);
    expect(store.profile.value.xp).toBe(10);
    expect(store.stats.value.imports).toBe(1);

    expect(applyImport(previewImport(json), 'replace')).toBe(true);
    expect(store.cards.count()).toBe(3);
    expect(store.cards.get('k-h-a#rec')).toBeUndefined();
    expect(store.cards.get('v-n5-0002#rec')).toEqual(incomingCards['v-n5-0002#rec']);
    expect(store.profile.value.xp).toBe(5);
    expect(store.stats.value.imports).toBe(1);
    expect(buildBackup().meta.profile.xp).toBe(5);
  });

  it('replace carries the backup\'s header (seed, createdAt, contentVersion) into the live store and the persisted save', async () => {
    const storage = new MemoryStorage();
    await makeTestStore({ storage });
    const doc = buildBackup();
    doc.meta.seed = 'feedfacefeedface';
    doc.meta.createdAt = DEFAULT_TEST_NOW - 86_400_000;
    doc.meta.contentVersion = 'c-2026.01';
    const p = previewImport(JSON.stringify(doc));
    expect(p.valid).toBe(true);
    expect(applyImport(p, 'replace')).toBe(true);
    expect(store.seed()).toBe('feedfacefeedface');
    expect(store.meta().createdAt).toBe(DEFAULT_TEST_NOW - 86_400_000);
    expect(store.meta().contentVersion).toBe('c-2026.01');
    expect(store.stats.value.imports).toBe(1);
    await store.flush();
    await initStore({ storage, now: () => DEFAULT_TEST_NOW, reducers: false });
    expect(store.seed()).toBe('feedfacefeedface');
    expect(store.meta().createdAt).toBe(DEFAULT_TEST_NOW - 86_400_000);
  });

  it('merge keeps this browser\'s seed but takes the earlier createdAt and a missing contentVersion', async () => {
    await makeTestStore();
    const doc = buildBackup();
    doc.meta.seed = 'feedfacefeedface';
    doc.meta.createdAt = DEFAULT_TEST_NOW - 86_400_000;
    doc.meta.contentVersion = 'c-2026.01';
    expect(applyImport(previewImport(JSON.stringify(doc)), 'merge')).toBe(true);
    expect(store.seed()).toBe(TEST_SEED);
    expect(store.meta().createdAt).toBe(DEFAULT_TEST_NOW - 86_400_000);
    expect(store.meta().contentVersion).toBe('c-2026.01');
  });

  it('merge unions the review log without duplicates, in time order', async () => {
    await makeTestStore();
    const mine: LogEntry[] = [
      [100, 'v-n5-0001#rec', 3, 900, 0, 0],
      [200, 'v-n5-0002#rec', 2, 900, 0, 0],
      [300, 'v-n5-0001#rec', 3, 900, 0, 0],
    ];
    for (const e of mine) store.log.push(e);
    const doc = { schema: BACKUP_SCHEMA, meta: buildBackup().meta, shards: {}, log: { schema: 'tsuzuku.log/1', entries: [...mine, [50, 'v-n5-0003#rec', 1, 900, 0, 0], [250, 'v-n5-0001#rec', 4, 900, 0, 0]] } };
    expect(applyImport(previewImport(JSON.stringify(doc)), 'merge')).toBe(true);
    const all = store.log.recent(10);
    expect(all.map((e) => e[0])).toEqual([50, 100, 200, 250, 300]);
    expect(store.log.forCard('v-n5-0001#rec')).toHaveLength(3);
  });

  it('a full ring plus an older backup keeps this browser\'s newest 5,000 by time, not by push order', async () => {
    await makeTestStore();
    for (let i = 0; i < LOG_RING; i++) store.log.push([2_000_000 + i, 'v-n5-0001#rec', 3, 100, 0, 0]);
    const entries: LogEntry[] = [];
    for (let i = 0; i < LOG_RING; i++) entries.push([1_000_000 + i, 'v-n5-0002#rec', 3, 100, 0, 0]);
    const doc = { schema: BACKUP_SCHEMA, meta: buildBackup().meta, shards: {}, log: { schema: 'tsuzuku.log/1', entries } };
    expect(applyImport(previewImport(JSON.stringify(doc)), 'merge')).toBe(true);
    const r = store.log.recent(LOG_RING + 100);
    expect(r).toHaveLength(LOG_RING);
    expect(r.every((e) => e[0] >= 2_000_000)).toBe(true);
    for (let i = 1; i < r.length; i++) expect(r[i][0]).toBeGreaterThan(r[i - 1][0]);
    // The pure union: the newer half wins whichever side it comes from.
    const u = unionLogs(entries, r);
    expect(u).toHaveLength(LOG_RING);
    expect(u[0][0]).toBe(2_000_000);
  });

  it('fields of the wrong type are repaired to defaults with one warning, so a replaced save can still boot', async () => {
    await makeTestStore();
    const json = '{"schema":"tsuzuku.backup/1","meta":{"schema":"tsuzuku.save/1","profile":{"name":null,"xp":1e999,"level":"abc","belt":"rainbow","goals":"notarray","kanaKnown":"abc","tz":"UTC"},"settings":{"newPerDay":null,"restDay":3},"streak":{"current":"7","longest":{}},"progress":{"station":"7"},"bookmarks":[{"a":1},null,5],"stats":{"reviews":"x"}},"shards":{},"log":{"entries":[]}}';
    const p = previewImport(json);
    expect(p.valid).toBe(true);
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([S.importRepaired]);
    expect(p.summary.xp).toEqual([0, 0]);
    expect(p.summary.streak).toEqual([0, 0]);
    expect(applyImport(p, 'replace')).toBe(true);
    const prof = store.profile.value;
    expect(typeof prof.name).toBe('string');
    expect(prof.name.trim().length).toBeGreaterThan(0);
    expect(prof).toMatchObject({ xp: 0, level: 1, belt: 'white', goals: [], kanaKnown: [] });
    expect(typeof store.settings.value.newPerDay.vocab).toBe('number');
    expect(store.settings.value.restDay).toBe(3);
    expect(store.streak.value).toMatchObject({ current: 0, longest: 0 });
    expect(store.progress.value.station).toBe(0);
    expect(store.bookmarks.value).not.toContain(null);
    expect(store.stats.value.reviews).toBe(0);
    // A well-typed backup carries no warning.
    expect(previewImport(JSON.stringify(buildBackup())).warnings).toEqual([]);
  });
});
