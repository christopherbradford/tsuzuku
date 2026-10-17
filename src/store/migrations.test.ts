import { CARDS_SCHEMA, LOG_SCHEMA, type CardShard, type CardTuple, type LogEntry } from '../shared/store-types';
import { freshSave } from './defaults';
import {
  CURRENT,
  MigrationError,
  applyRedirects,
  migrateLog,
  migrateMeta,
  migrateShard,
  redirectKey,
  resolveRedirect,
} from './migrations';

const NOW = Date.UTC(2026, 0, 1);

describe('CURRENT', () => {
  it('is version 1 for every document', () => {
    expect(CURRENT).toEqual({ meta: 1, cards: 1, log: 1 });
  });
});

describe('migrateMeta', () => {
  it('passes a complete v1 save through unchanged', () => {
    const s = freshSave(NOW, 'UTC');
    s.profile.name = 'テスト';
    s.stats.reviews = 42;
    const out = migrateMeta(JSON.parse(JSON.stringify(s)));
    expect(out).toEqual(s);
  });

  it('is idempotent', () => {
    const s = freshSave(NOW, 'UTC');
    const once = migrateMeta(s);
    expect(migrateMeta(once)).toEqual(once);
  });

  it('migrates a v0 document (no schema) to v1 and fills defaults', () => {
    const v0 = { profile: { name: 'Old', tz: 'Asia/Tokyo' }, settings: { intensity: 'casual' } };
    const out = migrateMeta(v0);
    expect(out.schema).toBe('tsuzuku.save/1');
    expect(out.profile.name).toBe('Old');
    expect(out.profile.tz).toBe('Asia/Tokyo');
    expect(out.profile.kanaKnown).toEqual([]);
    expect(out.settings.intensity).toBe('casual');
    expect(out.settings.speedGrading).toBe(true);
    expect(out.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(out.stats.reviews).toBe(0);
    expect(out.daily).toEqual({});
  });

  it('fills additive fields a newer build added to a slice', () => {
    const s = freshSave(NOW, 'UTC') as unknown as Record<string, Record<string, unknown>>;
    delete s.stats.rapidBest;
    delete s.settings.verticalText;
    delete s.weakPoints.aizuchi;
    const out = migrateMeta(s);
    expect(out.stats.rapidBest).toBe(0);
    expect(out.settings.verticalText).toBe(false);
    expect(out.weakPoints.aizuchi).toEqual({ n: 0, ewma: 0, active: false, peak: 0 });
  });

  it('throws a typed MigrationError on an unknown schema', () => {
    expect(() => migrateMeta({ schema: 'somebody.else/1' })).toThrow(MigrationError);
    try {
      migrateMeta({ schema: 'somebody.else/1' });
    } catch (e) {
      expect(e).toBeInstanceOf(MigrationError);
      expect((e as MigrationError).doc).toBe('meta');
      expect((e as MigrationError).schema).toBe('somebody.else/1');
    }
  });

  it('throws on a save newer than this build', () => {
    expect(() => migrateMeta({ ...freshSave(NOW, 'UTC'), schema: 'tsuzuku.save/2' })).toThrow(/newer/);
  });

  it('throws on non-objects and on schema-less junk', () => {
    expect(() => migrateMeta(null)).toThrow(MigrationError);
    expect(() => migrateMeta('x')).toThrow(MigrationError);
    expect(() => migrateMeta({ hello: 1 })).toThrow(MigrationError);
  });
});

describe('migrateShard', () => {
  const good: CardTuple = [20500, 12.34, 5.67, 12, 1, 2, 20488, 0];

  it('passes a v1 shard through and keeps only valid tuples under valid keys', () => {
    const raw = {
      schema: CARDS_SCHEMA,
      kind: 'vocab',
      level: 'n5',
      cards: {
        'v-n5-0001#rec': good,
        'v-n5-0002#prod': [1, 2, 3],
        'v-n5-0003#rec': [20500, 1, 1, 1, 1, 7, 1, 0],
        'v-n5-0004': good,
        'v-n5-0005#nope': good,
      },
    };
    const out = migrateShard(raw);
    expect(out.schema).toBe(CARDS_SCHEMA);
    expect(out.kind).toBe('vocab');
    expect(out.level).toBe('n5');
    expect(Object.keys(out.cards)).toEqual(['v-n5-0001#rec']);
  });

  it('stamps the schema on a v0 shard', () => {
    const out = migrateShard({ kind: 'kana', level: 'kana', cards: { 'k-h-a#rec': good } });
    expect(out.schema).toBe(CARDS_SCHEMA);
    expect(out.cards['k-h-a#rec']).toEqual(good);
  });

  it('throws on unknown schema or missing kind/level', () => {
    expect(() => migrateShard({ schema: 'tsuzuku.cards/9', kind: 'vocab', level: 'n5', cards: {} })).toThrow(MigrationError);
    expect(() => migrateShard({ schema: CARDS_SCHEMA, cards: {} })).toThrow(/kind/);
    expect(() => migrateShard({ schema: CARDS_SCHEMA, kind: 'bogus', level: 'n5', cards: {} })).toThrow(MigrationError);
    expect(() => migrateShard(7)).toThrow(MigrationError);
  });
});

describe('migrateLog', () => {
  const e6: LogEntry = [1_700_000_000_000, 'v-n5-0001#rec', 3, 2345, 5, 0];

  it('keeps valid 6-tuples and fills the 5-tuple tagsMask with 0', () => {
    const out = migrateLog({ schema: LOG_SCHEMA, entries: [e6, [1, 'g-n5-001#cloze', 2, 10, 1], ['bad'], [1, 'nokey', 3, 1, 1, 0], [1, 'v-n5-0001#rec', 9, 1, 1, 0]] });
    expect(out).toEqual([e6, [1, 'g-n5-001#cloze', 2, 10, 1, 0]]);
  });

  it('accepts a bare v0 array', () => {
    expect(migrateLog([e6])).toEqual([e6]);
  });

  it('throws on unknown schema and non-objects', () => {
    expect(() => migrateLog({ schema: 'tsuzuku.log/2', entries: [] })).toThrow(MigrationError);
    expect(() => migrateLog(3)).toThrow(MigrationError);
  });
});

describe('applyRedirects', () => {
  const t = (last: number, reps = 1): CardTuple => [last + 5, 3, 5, reps, 0, 2, last, 0];
  const shard = (cards: CardShard['cards']): CardShard => ({ schema: CARDS_SCHEMA, kind: 'vocab', level: 'n5', cards });

  it('rewrites keys through redirects and follows chains', () => {
    expect(resolveRedirect('a', { a: 'b', b: 'c' })).toBe('c');
    expect(resolveRedirect('a', { a: 'b', b: 'a' })).toBe('a');
    expect(redirectKey('v-n5-0001#rec', { 'v-n5-0001': 'v-n5-0100' })).toBe('v-n5-0100#rec');
    const out = applyRedirects(shard({ 'v-n5-0001#rec': t(10), 'v-n5-0001#prod': t(11) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(Object.keys(out.cards).sort()).toEqual(['v-n5-0100#prod', 'v-n5-0100#rec']);
  });

  it('merges collisions by newer lastReview, ties by more reps', () => {
    const out = applyRedirects(shard({ 'v-n5-0001#rec': t(10), 'v-n5-0100#rec': t(20) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(out.cards['v-n5-0100#rec']).toEqual(t(20));
    const tie = applyRedirects(shard({ 'v-n5-0001#rec': t(10, 9), 'v-n5-0100#rec': t(10, 2) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(tie.cards['v-n5-0100#rec']).toEqual(t(10, 9));
  });

  it('is idempotent and returns the same shard when nothing matches', () => {
    const s = shard({ 'v-n5-0002#rec': t(1) });
    expect(applyRedirects(s, { 'v-n5-0001': 'v-n5-0100' })).toBe(s);
    const once = applyRedirects(shard({ 'v-n5-0001#rec': t(1) }), { 'v-n5-0001': 'v-n5-0100' });
    expect(applyRedirects(once, { 'v-n5-0001': 'v-n5-0100' })).toBe(once);
  });
});
