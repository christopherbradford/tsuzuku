import type { CardKey } from '../content/types';
import { civilToDay } from '../shared/time';
import { CARDS_SCHEMA, type CardShard, type CardTuple, type LogEntry, type SaveMeta, type StorageState } from '../shared/store-types';
import { freshSave } from './defaults';
import {
  CARDS_KEY,
  CEILING_BYTES,
  DEBOUNCE_MS,
  GZIP_PREFIX,
  LOG_KEY,
  LOG_RING_COMPACT,
  META_KEY,
  SESSION_KEY,
  SHARD_SPECS,
  WARN_BYTES,
  compactLog,
  compactMeta,
  createPersist,
  gunzipText,
  gzipText,
  hasCompression,
  isQuotaError,
  levelForBytes,
  levelForStation,
  shardIdFor,
  shardKey,
  slotKey,
  utf16Bytes,
} from './persist';
import { MemoryStorage } from './testing';

const NOW = Date.UTC(2026, 0, 15, 12);

function tuple(i: number): CardTuple {
  return [20500 + (i % 90), Math.round((1 + (i % 300)) * 1.13 * 100) / 100, Math.round((3 + (i % 7)) * 1.07 * 100) / 100, i % 40, i % 5, 2, 20480 + (i % 20), 0];
}

describe('keys (ARCHITECTURE §1 spelling)', () => {
  it('spells the four bases and the slot suffix', () => {
    expect(META_KEY).toBe('tsuzuku.meta.v1');
    expect(CARDS_KEY).toBe('tsuzuku.cards.v1');
    expect(LOG_KEY).toBe('tsuzuku.log.v1');
    expect(SESSION_KEY).toBe('tsuzuku.session.v1');
    expect(slotKey(META_KEY, 0)).toBe('tsuzuku.meta.v1');
    expect(slotKey(META_KEY, 2)).toBe('tsuzuku.meta.v1.2');
    expect(shardKey('vocab', 'n5')).toBe('tsuzuku.cards.v1.vocab.n5');
    expect(shardKey('misc', 'kana', 1)).toBe('tsuzuku.cards.v1.misc.kana.1');
  });

  it('lists the 16 shards: vocab n5–n1, kanji n5–n2, grammar n5–n1, kana.kana, misc.kana', () => {
    const ids = SHARD_SPECS.map((s) => `${s.kind}.${s.level}`);
    expect(ids).toHaveLength(16);
    expect(ids).toEqual(
      expect.arrayContaining(['vocab.n5', 'vocab.n1', 'kanji.n5', 'kanji.n2', 'grammar.n5', 'grammar.n1', 'kana.kana', 'misc.kana']),
    );
    expect(ids).not.toContain('kanji.n1');
  });

  it('a persist instance qualifies keys by slot', () => {
    const p = createPersist(new MemoryStorage(), 3, { hooks: null });
    expect(p.key(META_KEY)).toBe('tsuzuku.meta.v1.3');
    expect(p.shardKey('grammar', 'n4')).toBe('tsuzuku.cards.v1.grammar.n4.3');
    p.dispose();
  });
});

describe('shardIdFor', () => {
  it('routes by kind and level', () => {
    expect(shardIdFor('v-n5-0001#rec')).toBe('vocab.n5');
    expect(shardIdFor('v-n2-0001#prod')).toBe('vocab.n2');
    expect(shardIdFor('g-n3-001#cloze')).toBe('grammar.n3');
    expect(shardIdFor('k-h-a#rec')).toBe('kana.kana');
    expect(shardIdFor('k-k-shi#prod')).toBe('kana.kana');
    expect(shardIdFor('c-person#rec')).toBe('misc.kana');
  });

  it('places kanji by the station they are introduced at, clamped to n5–n2', () => {
    expect(levelForStation(4)).toBe('n5');
    expect(levelForStation(16)).toBe('n4');
    expect(shardIdFor('j-食#comp', { station: 5 })).toBe('kanji.n5');
    expect(shardIdFor('j-食#comp', { station: 16 })).toBe('kanji.n4');
    expect(shardIdFor('j-食#read', { station: 30 })).toBe('kanji.n3');
    expect(shardIdFor('j-食#comp', { station: 40 })).toBe('kanji.n2');
    expect(shardIdFor('j-食#comp', { station: 50 })).toBe('kanji.n2');
    expect(shardIdFor('j-食#comp', { station: 0 })).toBe('kanji.n5');
    expect(shardIdFor('j-食#comp')).toBe('kanji.n5');
    expect(shardIdFor('j-食#comp', { level: 'n3', station: 5 })).toBe('kanji.n3');
  });

  it('falls back to misc.kana for anything else', () => {
    expect(shardIdFor('x-unknown#rec')).toBe('misc.kana');
    expect(shardIdFor('v-dan-0001#rec')).toBe('misc.kana');
  });
});

describe('byte accounting', () => {
  it('counts UTF-16 code units × 2 for keys and values', () => {
    expect(utf16Bytes('abc')).toBe(6);
    expect(utf16Bytes('日本語')).toBe(6);
    const s = new MemoryStorage();
    s.setItem('a', 'bcd');
    const p = createPersist(s, 0, { hooks: null });
    expect(p.bytes()).toBe(8);
    p.dispose();
  });

  it('levels: ok < 3.5 MB ≤ warn < 4.5 MB ≤ ceiling', () => {
    expect(WARN_BYTES).toBe(3.5 * 1024 * 1024);
    expect(CEILING_BYTES).toBe(4.5 * 1024 * 1024);
    expect(levelForBytes(0)).toBe('ok');
    expect(levelForBytes(WARN_BYTES - 2)).toBe('ok');
    expect(levelForBytes(WARN_BYTES)).toBe('warn');
    expect(levelForBytes(CEILING_BYTES - 2)).toBe('warn');
    expect(levelForBytes(CEILING_BYTES)).toBe('ceiling');
  });

  it('a storage already near the quota reads as warn / ceiling', () => {
    const s = new MemoryStorage();
    s.setItem('filler', 'x'.repeat(WARN_BYTES / 2));
    const p = createPersist(s, 0, { hooks: null });
    expect(p.level()).toBe('warn');
    s.setItem('filler', 'x'.repeat(CEILING_BYTES / 2));
    expect(p.level()).toBe('ceiling');
    expect(p.state()).toEqual({ bytes: CEILING_BYTES + 12, level: 'ceiling' });
    p.dispose();
  });
});

describe('debounce and flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces writes within 1 s into one setItem carrying the latest value', async () => {
    const s = new MemoryStorage();
    const p = createPersist(s, 0, { hooks: null });
    let value = { n: 1 };
    p.schedule('k', () => value);
    value = { n: 2 };
    await vi.advanceTimersByTimeAsync(500);
    p.schedule('k', () => value);
    value = { n: 3 };
    await vi.advanceTimersByTimeAsync(999);
    expect(s.writes).toBe(0);
    expect(p.pending()).toEqual(['k']);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.writes).toBe(1);
    expect(JSON.parse(s.getItem('k') as string)).toEqual({ n: 3 });
    expect(p.pending()).toEqual([]);
    expect(DEBOUNCE_MS).toBe(1000);
    p.dispose();
  });

  it('flush writes every dirty key now and cancels the timers', async () => {
    const s = new MemoryStorage();
    const p = createPersist(s, 0, { hooks: null });
    p.schedule('a', () => 1);
    p.schedule('b', () => [2]);
    await p.flush();
    expect(s.writes).toBe(2);
    expect(s.getItem('a')).toBe('1');
    expect(s.getItem('b')).toBe('[2]');
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.writes).toBe(2);
    p.dispose();
  });

  it('reports state through onState only when it changes', async () => {
    const s = new MemoryStorage();
    const states: StorageState[] = [];
    const p = createPersist(s, 0, { hooks: null, onState: (st) => states.push(st) });
    p.schedule('a', () => 'x');
    await p.flush();
    await p.flush();
    expect(states).toEqual([{ bytes: (1 + 3) * 2, level: 'ok' }]);
    p.dispose();
  });

  it('flushes on visibilitychange (hidden) and pagehide, and dispose detaches', async () => {
    const doc = new EventTarget();
    Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
    const win = new EventTarget();
    const s = new MemoryStorage();
    const p = createPersist(s, 0, { hooks: { document: doc, window: win } });
    p.schedule('a', () => 1);
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    expect(s.getItem('a')).toBe('1');
    p.schedule('b', () => 2);
    win.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    await Promise.resolve();
    expect(s.getItem('b')).toBe('2');
    p.dispose();
    p.schedule('c', () => 3);
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(s.getItem('c')).toBeNull();
  });

  it('does not flush on visibilitychange while visible', async () => {
    const doc = new EventTarget();
    Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
    const s = new MemoryStorage();
    const p = createPersist(s, 0, { hooks: { document: doc, window: null } });
    p.schedule('a', () => 1);
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(s.getItem('a')).toBeNull();
    p.dispose();
  });
});

describe('read', () => {
  it('ignores corrupted JSON instead of throwing', () => {
    const s = new MemoryStorage();
    s.setItem('k', '{nope');
    const p = createPersist(s, 0, { hooks: null });
    expect(p.read('k')).toBeNull();
    expect(p.readSync('k')).toBeNull();
    expect(p.read('missing')).toBeNull();
    p.dispose();
  });

  it('round-trips a value through write/read synchronously', () => {
    const s = new MemoryStorage();
    const p = createPersist(s, 0, { hooks: null });
    expect(p.write('k', { a: [1, 2] })).toBe(true);
    expect(p.read('k')).toEqual({ a: [1, 2] });
    p.remove('k');
    expect(p.read('k')).toBeNull();
    p.dispose();
  });

  it('survives a storage whose getItem throws', () => {
    const broken = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('nope');
      },
      removeItem: () => undefined,
      clear: () => undefined,
    } as unknown as Storage;
    const p = createPersist(broken, 0, { hooks: null });
    expect(p.read('k')).toBeNull();
    expect(p.write('k', 1)).toBe(false);
    expect(p.bytes()).toBe(0);
    p.dispose();
  });
});

describe('quota', () => {
  it('a QuotaExceededError sets the level to ceiling, keeps the write dirty and retries later', async () => {
    const s = new MemoryStorage(200);
    const states: StorageState[] = [];
    const p = createPersist(s, 0, { hooks: null, onState: (st) => states.push(st) });
    p.schedule('big', () => 'y'.repeat(500));
    await p.flush();
    expect(p.level()).toBe('ceiling');
    expect(states.at(-1)?.level).toBe('ceiling');
    expect(p.pending()).toEqual(['big']);
    expect(s.getItem('big')).toBeNull();
    s.quota = undefined;
    await p.flush();
    expect(JSON.parse(s.getItem('big') as string)).toBe('y'.repeat(500));
    expect(p.level()).toBe('ok');
    expect(p.pending()).toEqual([]);
    p.dispose();
  });

  it('recognises browser quota errors', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe('compaction ladder (pure rungs)', () => {
  const today = civilToDay({ year: 2026, month: 1, day: 15 });

  it('shrinks the log ring to 2,000 keeping the newest entries', () => {
    const log: LogEntry[] = [];
    for (let i = 0; i < 5000; i++) log.push([i, 'v-n5-0001#rec', 3, 1000, 0, 0]);
    const out = compactLog(log);
    expect(out).toHaveLength(LOG_RING_COMPACT);
    expect(out[0][0]).toBe(3000);
    expect(out.at(-1)?.[0]).toBe(4999);
    expect(compactLog(out)).toBe(out);
  });

  it('aggregates daily rows older than 2 years into one row per month at the month\'s first day', () => {
    const meta = freshSave(NOW, 'UTC');
    const oldA = civilToDay({ year: 2023, month: 3, day: 5 });
    const oldB = civilToDay({ year: 2023, month: 3, day: 20 });
    const oldC = civilToDay({ year: 2023, month: 4, day: 2 });
    const recent = today - 10;
    meta.daily[oldA] = { reps: 10, ok: 8, minutes: 5, xp: 40, input: 0 };
    meta.daily[oldB] = { reps: 20, ok: 15, minutes: 7, xp: 60, input: 3 };
    meta.daily[oldC] = { reps: 1, ok: 1, minutes: 1, xp: 2, input: 0 };
    meta.daily[recent] = { reps: 5, ok: 5, minutes: 2, xp: 10, input: 0 };
    const out = compactMeta(meta, today);
    const march1 = civilToDay({ year: 2023, month: 3, day: 1 });
    const april1 = civilToDay({ year: 2023, month: 4, day: 1 });
    expect(Object.keys(out.daily).map(Number).sort((a, b) => a - b)).toEqual([march1, april1, recent]);
    expect(out.daily[march1]).toEqual({ reps: 30, ok: 23, minutes: 12, xp: 100, input: 3 });
    expect(out.daily[april1]).toEqual({ reps: 1, ok: 1, minutes: 1, xp: 2, input: 0 });
    expect(out.daily[recent]).toEqual(meta.daily[recent]);
    // idempotent
    expect(compactMeta(out, today)).toBe(out);
    // the input is untouched
    expect(Object.keys(meta.daily)).toHaveLength(4);
  });

  it('moves ledger entries older than 2 years into ledger.monthly', () => {
    const meta = freshSave(NOW, 'UTC');
    const old = civilToDay({ year: 2023, month: 6, day: 10 });
    meta.ledger.entries = [
      [old, 30, 0, 1],
      [old + 1, 15, 2, 1],
      [today - 1, 20, 1, 0],
    ];
    const out = compactMeta(meta, today);
    expect(out.ledger.entries).toEqual([[today - 1, 20, 1, 0]]);
    expect(out.ledger.monthly).toEqual({ '2023-06': 45 });
    expect(compactMeta(out, today)).toBe(out);
  });

  it('returns the same meta when nothing is old', () => {
    const meta = freshSave(NOW, 'UTC');
    meta.daily[today] = { reps: 1, ok: 1, minutes: 1, xp: 1, input: 0 };
    expect(compactMeta(meta, today)).toBe(meta);
  });

  it('persist.compact derives today from updatedAt when not given', () => {
    const p = createPersist(new MemoryStorage(), 0, { hooks: null });
    const meta = freshSave(NOW, 'UTC');
    const old = civilToDay({ year: 2020, month: 1, day: 5 });
    meta.daily[old] = { reps: 1, ok: 1, minutes: 1, xp: 1, input: 0 };
    const log: LogEntry[] = Array.from({ length: 2500 }, (_, i) => [i, 'v-n5-0001#rec', 3, 1, 0, 0] as LogEntry);
    const out = p.compact(meta, log);
    expect(out.log).toHaveLength(2000);
    expect(out.meta.daily[old]).toBeUndefined();
    expect(out.meta.daily[civilToDay({ year: 2020, month: 1, day: 1 })]).toEqual({ reps: 1, ok: 1, minutes: 1, xp: 1, input: 0 });
    p.dispose();
  });
});

describe.skipIf(!hasCompression())('gzip rung', () => {
  it('round-trips text through gzipText/gunzipText with the marker prefix', async () => {
    const text = JSON.stringify({ a: 'つづく'.repeat(50), b: [1, 2, 3] });
    const packed = await gzipText(text);
    expect(packed.startsWith(GZIP_PREFIX)).toBe(true);
    expect(packed.length).toBeLessThan(text.length);
    expect(await gunzipText(packed)).toBe(text);
    expect(await gunzipText(packed.slice(GZIP_PREFIX.length))).toBe(text);
  });

  it('compressLargest gzips the biggest card shard; read decodes it; later writes stay compressed', async () => {
    const s = new MemoryStorage();
    const p = createPersist(s, 0, { hooks: null });
    const small: CardShard = { schema: CARDS_SCHEMA, kind: 'kana', level: 'kana', cards: { 'k-h-a#rec': tuple(1) } };
    const bigCards: Record<CardKey, CardTuple> = {};
    for (let i = 0; i < 1500; i++) bigCards[`v-n3-${String(i).padStart(4, '0')}#rec`] = tuple(i);
    const big: CardShard = { schema: CARDS_SCHEMA, kind: 'vocab', level: 'n3', cards: bigCards };
    p.write(p.shardKey('kana', 'kana'), small);
    p.write(p.shardKey('vocab', 'n3'), big);
    const before = p.bytes();
    expect(await p.compressLargest()).toBe(true);
    const raw = s.getItem(p.shardKey('vocab', 'n3')) as string;
    expect(raw.startsWith(GZIP_PREFIX)).toBe(true);
    expect(p.bytes()).toBeLessThan(before / 2);
    expect(p.compressedKeys()).toEqual([p.shardKey('vocab', 'n3')]);
    expect(s.getItem(p.shardKey('kana', 'kana'))?.startsWith('{')).toBe(true);

    const decoded = await p.read<CardShard>(p.shardKey('vocab', 'n3'));
    expect(decoded).toEqual(big);
    expect(p.readSync(p.shardKey('vocab', 'n3'))).toBeNull();

    // A new persist over the same storage learns the compressed key on read.
    const p2 = createPersist(s, 0, { hooks: null });
    expect(await p2.read<CardShard>(p2.shardKey('vocab', 'n3'))).toEqual(big);
    bigCards['v-n3-9999#prod'] = tuple(7);
    p2.schedule(p2.shardKey('vocab', 'n3'), () => big);
    await p2.flush();
    const raw2 = s.getItem(p2.shardKey('vocab', 'n3')) as string;
    expect(raw2.startsWith(GZIP_PREFIX)).toBe(true);
    expect(await p2.read<CardShard>(p2.shardKey('vocab', 'n3'))).toEqual(big);
    p.dispose();
    p2.dispose();
  });

  it('compressLargest returns false when there is nothing uncompressed', async () => {
    const p = createPersist(new MemoryStorage(), 0, { hooks: null });
    expect(await p.compressLargest()).toBe(false);
    p.dispose();
  });
});

describe('synthetic full save (design 07 §4)', () => {
  function buildShards(): Record<string, CardShard> {
    const out: Record<string, CardShard> = {};
    const add = (kind: CardShard['kind'], level: CardShard['level'], key: CardKey, t: CardTuple): void => {
      const k = shardKey(kind, level);
      out[k] ??= { schema: CARDS_SCHEMA, kind, level, cards: {} };
      out[k].cards[key] = t;
    };
    // vocab 6,350 × (rec, listen, prod) + 1,000 pitch — spread over n5…n1 roughly as the road does.
    const vocabPerLevel: [CardShard['level'], number][] = [
      ['n5', 800],
      ['n4', 650],
      ['n3', 1700],
      ['n2', 1700],
      ['n1', 1500],
    ];
    let i = 0;
    let pitch = 0;
    for (const [lvl, n] of vocabPerLevel) {
      for (let j = 0; j < n; j++, i++) {
        const id = `v-${lvl}-${String(j).padStart(4, '0')}`;
        add('vocab', lvl, `${id}#rec`, tuple(i));
        add('vocab', lvl, `${id}#listen`, tuple(i + 1));
        add('vocab', lvl, `${id}#prod`, tuple(i + 2));
        if (pitch < 1000 && (lvl === 'n5' || lvl === 'n4')) {
          add('vocab', lvl, `${id}#pitch`, tuple(i + 3));
          pitch++;
        }
      }
    }
    // kanji 1,000 × (comp, read)
    const kanjiPerLevel: [CardShard['level'], number][] = [
      ['n5', 100],
      ['n4', 200],
      ['n3', 350],
      ['n2', 350],
    ];
    for (const [lvl, n] of kanjiPerLevel) {
      for (let j = 0; j < n; j++, i++) {
        const ch = String.fromCharCode(0x4e00 + i);
        add('kanji', lvl, `j-${ch}#comp`, tuple(i));
        add('kanji', lvl, `j-${ch}#read`, tuple(i + 1));
      }
    }
    // grammar 450 × (cloze, prod)
    const grammarPerLevel: [CardShard['level'], number][] = [
      ['n5', 100],
      ['n4', 90],
      ['n3', 110],
      ['n2', 90],
      ['n1', 60],
    ];
    for (const [lvl, n] of grammarPerLevel) {
      for (let j = 0; j < n; j++, i++) {
        const id = `g-${lvl}-${String(j).padStart(3, '0')}`;
        add('grammar', lvl, `${id}#cloze`, tuple(i));
        add('grammar', lvl, `${id}#prod`, tuple(i + 1));
      }
    }
    // kana 238 × (rec, prod) and 250 components
    for (let j = 0; j < 238; j++, i++) {
      add('kana', 'kana', `k-h-x${j}#rec`, tuple(i));
      add('kana', 'kana', `k-h-x${j}#prod`, tuple(i + 1));
    }
    for (let j = 0; j < 250; j++, i++) add('misc', 'kana', `c-part-${j}#rec`, tuple(i));
    return out;
  }

  it('23,700 cards + 5,000 log rows + 1,100 daily rows stay under the 3.5 MB warning in UTF-16 bytes', async () => {
    const s = new MemoryStorage();
    const p = createPersist(s, 0, { hooks: null });
    const shards = buildShards();
    let cards = 0;
    for (const sh of Object.values(shards)) cards += Object.keys(sh.cards).length;
    expect(cards).toBeGreaterThanOrEqual(23_600);

    const meta: SaveMeta = freshSave(NOW, 'UTC');
    const today = 20_740;
    for (let d = 0; d < 1100; d++) meta.daily[today - d] = { reps: 120 + (d % 50), ok: 100 + (d % 40), minutes: 25 + (d % 30), xp: 400 + (d % 200), input: d % 20 };
    for (let w = 0; w < 160; w++) meta.ledger.entries.push([today - w * 7, 20 + (w % 40), (w % 4) as 0 | 1 | 2 | 3, 1]);
    const log: LogEntry[] = [];
    const keys = Object.keys(shards['tsuzuku.cards.v1.vocab.n3'].cards) as CardKey[];
    for (let j = 0; j < 5000; j++) log.push([1_760_000_000_000 + j * 5000, keys[j % keys.length], ((j % 4) + 1) as 1 | 2 | 3 | 4, 2000 + (j % 3000), j % 35, j % 7 === 0 ? 1 << (j % 14) : 0]);

    for (const [k, sh] of Object.entries(shards)) p.schedule(k, () => sh);
    p.schedule(p.key(META_KEY), () => meta);
    p.schedule(p.key(LOG_KEY), () => ({ schema: 'tsuzuku.log/1', entries: log }));
    await p.flush();

    const total = p.bytes();
    expect(total).toBeLessThan(WARN_BYTES);
    expect(p.level()).toBe('ok');
    // Largest shard (vocab.n3, ≈ 5,100 cards) is "≈ 0.5 MB" in design 07 §4; the exact figure
    // depends on digit widths, so allow 10 % over the round number.
    const largest = Math.max(...Object.keys(shards).map((k) => utf16Bytes(s.getItem(k) as string)));
    expect(largest).toBeLessThanOrEqual(0.55 * 1024 * 1024);

    // One vocab.n3 review rewrites only its shard, in ≤ 20 ms (best of three).
    const n3 = shards['tsuzuku.cards.v1.vocab.n3'];
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      n3.cards[keys[r]] = tuple(999 + r);
      const t0 = performance.now();
      p.schedule('tsuzuku.cards.v1.vocab.n3', () => n3);
      await p.flush();
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThanOrEqual(20);
    p.dispose();
  });
});
