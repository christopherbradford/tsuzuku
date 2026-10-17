/**
 * TSUZUKU — sharded localStorage persistence (store group B, ARCHITECTURE §1).
 *
 * Keys (slot 0 has no suffix, slots ≥ 1 append `.<slot>`):
 *   tsuzuku.meta.v1[.slot]                  SaveMeta
 *   tsuzuku.cards.v1.<kind>.<level>[.slot]  CardShard — vocab.n5…n1, kanji.n5…n2,
 *                                           grammar.n5…n1, kana.kana, misc.kana
 *   tsuzuku.log.v1[.slot]                   ReviewLog (ring 5,000)
 *   tsuzuku.session.v1[.slot]               SessionSnapshot (opaque to B)
 *
 * Writes are debounced 1 s per key and flushed on `visibilitychange` (hidden)
 * and `pagehide`. Bytes are UTF-16 (`str.length * 2`): warn at 3.5 MB, ceiling
 * at 4.5 MB. The compaction ladder is: log ring → 2,000; daily rows and ledger
 * entries older than 2 years → monthly; then gzip the largest card shard via
 * `CompressionStream('gzip')`, stored base64 behind `GZIP_PREFIX` and decoded
 * on load. Every storage call is wrapped in try/catch; a `QuotaExceededError`
 * on a debounced key records that key in a per-key `failed` set, keeps the
 * write dirty for a retry and never throws into the caller. The level reads
 * `ceiling` while ANY key is still failing (a later successful write of a
 * small key never masks a meta document that keeps failing), and `onState`
 * re-fires after every flush while something fails so the UI stays told.
 * `readRaw`/`writeRaw` move the stored text untouched (the `.bak` stash of a
 * document the store cannot read). Only this module (through `store.ts`)
 * touches storage; the `Storage` is injectable for tests.
 */
import { BELTS, type CardKey, type Level } from '../content/types';
import { levelOfId, parseCardKey, tryKindOfId } from '../shared/ids';
import { civilToDay, dayToCivil, epochDay, type CivilDate } from '../shared/time';
import type {
  DailyRow,
  EpochDay,
  LedgerEntry,
  LogEntry,
  SaveMeta,
  ShardKind,
  StorageLevel,
  StorageState,
} from '../shared/store-types';

/* ────────────────────────────────────────────────────────────────────────── */
/* Keys                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export const META_KEY = 'tsuzuku.meta.v1';
export const CARDS_KEY = 'tsuzuku.cards.v1';
export const LOG_KEY = 'tsuzuku.log.v1';
export const SESSION_KEY = 'tsuzuku.session.v1';

/** `base` → `base[.slot]`. */
export function slotKey(base: string, slot: number): string {
  return slot > 0 ? `${base}.${slot}` : base;
}

export interface ShardSpec {
  kind: ShardKind;
  level: Level;
}

/** Every shard, in a fixed order (16). */
export const SHARD_SPECS: readonly ShardSpec[] = [
  { kind: 'kana', level: 'kana' },
  { kind: 'vocab', level: 'n5' },
  { kind: 'vocab', level: 'n4' },
  { kind: 'vocab', level: 'n3' },
  { kind: 'vocab', level: 'n2' },
  { kind: 'vocab', level: 'n1' },
  { kind: 'kanji', level: 'n5' },
  { kind: 'kanji', level: 'n4' },
  { kind: 'kanji', level: 'n3' },
  { kind: 'kanji', level: 'n2' },
  { kind: 'grammar', level: 'n5' },
  { kind: 'grammar', level: 'n4' },
  { kind: 'grammar', level: 'n3' },
  { kind: 'grammar', level: 'n2' },
  { kind: 'grammar', level: 'n1' },
  { kind: 'misc', level: 'kana' },
];

/** `vocab.n5` — the shard id used in memory; the storage key adds the prefix and slot. */
export type ShardId = `${ShardKind}.${Level}`;

export function shardIdOf(kind: ShardKind, level: Level): ShardId {
  return `${kind}.${level}`;
}

const SHARD_ID_SET: ReadonlySet<string> = new Set(SHARD_SPECS.map((s) => shardIdOf(s.kind, s.level)));

export function isShardId(s: string): s is ShardId {
  return SHARD_ID_SET.has(s);
}

export function parseShardId(id: ShardId): ShardSpec {
  const i = id.indexOf('.');
  return { kind: id.slice(0, i) as ShardKind, level: id.slice(i + 1) as Level };
}

export function shardKey(kind: ShardKind, level: Level, slot = 0): string {
  return slotKey(`${CARDS_KEY}.${kind}.${level}`, slot);
}

/** Curriculum level of the station a kanji is introduced at (kanji ids carry no level). */
export function levelForStation(station: number): Level {
  for (const b of BELTS) if (station >= b.stations[0] && station <= b.stations[1]) return b.level;
  return station <= 0 ? 'kana' : 'n1';
}

/**
 * Which shard a card key lives in. Vocab/grammar read the level from the id;
 * kana → `kana.kana`; components → `misc.kana`; kanji take `hint.level`, else
 * the level of `hint.station` (the station the learner is at when the kanji
 * is introduced), clamped to the kanji shards (n5–n2). Anything else → `misc.kana`.
 * Chunk cards are vocab ids and therefore live in the vocab shards.
 */
export function shardIdFor(key: CardKey, hint?: { level?: Level; station?: number }): ShardId {
  const { itemId } = parseCardKey(key);
  const kind = tryKindOfId(itemId);
  switch (kind) {
    case 'kana':
      return 'kana.kana';
    case 'component':
      return 'misc.kana';
    case 'vocab':
    case 'grammar': {
      const level = hint?.level ?? levelOfId(itemId);
      const id = level ? shardIdOf(kind, level) : null;
      return id && isShardId(id) ? id : 'misc.kana';
    }
    case 'kanji': {
      const level = hint?.level ?? (hint?.station !== undefined ? levelForStation(hint.station) : 'n5');
      const id = shardIdOf('kanji', level);
      if (isShardId(id)) return id;
      return level === 'n1' || level === 'dan' ? 'kanji.n2' : 'kanji.n5';
    }
    default:
      return 'misc.kana';
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Budget                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const WARN_BYTES = 3.5 * 1024 * 1024;
export const CEILING_BYTES = 4.5 * 1024 * 1024;
export const DEBOUNCE_MS = 1000;
export const LOG_RING = 5000;
export const LOG_RING_COMPACT = 2000;
/** Daily rows / ledger entries older than this aggregate to monthly. */
export const KEEP_DAYS = 730;
/** A compressed value is `GZIP_PREFIX + base64(gzip(utf8(json)))`; JSON never starts with `g`. */
export const GZIP_PREFIX = 'gz1:';

/** localStorage counts UTF-16 code units. */
export function utf16Bytes(s: string): number {
  return s.length * 2;
}

export function levelForBytes(bytes: number): StorageLevel {
  if (bytes >= CEILING_BYTES) return 'ceiling';
  if (bytes >= WARN_BYTES) return 'warn';
  return 'ok';
}

export function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { name?: unknown; code?: unknown };
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* gzip                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export function hasCompression(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

function bytesToBase64(u8: Bytes): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Bytes {
  const bin = atob(b64);
  const out: Bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Bytes = Uint8Array<ArrayBuffer>;

async function pump(stream: ReadableStream<Bytes>): Promise<Bytes> {
  const reader = stream.getReader();
  const chunks: Bytes[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out: Bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function fromBytes(bytes: Bytes): ReadableStream<Bytes> {
  return new ReadableStream<Bytes>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

/** `text` → `GZIP_PREFIX + base64(gzip)`. */
export async function gzipText(text: string): Promise<string> {
  const input: Bytes = new TextEncoder().encode(text);
  const out = await pump(fromBytes(input).pipeThrough(new CompressionStream('gzip') as ReadableWritablePair<Bytes, Bytes>));
  return GZIP_PREFIX + bytesToBase64(out);
}

/** Inverse of `gzipText`; accepts the value with or without the prefix. */
export async function gunzipText(payload: string): Promise<string> {
  const b64 = payload.startsWith(GZIP_PREFIX) ? payload.slice(GZIP_PREFIX.length) : payload;
  const out = await pump(fromBytes(base64ToBytes(b64)).pipeThrough(new DecompressionStream('gzip') as ReadableWritablePair<Bytes, Bytes>));
  return new TextDecoder().decode(out);
}

export function isCompressed(raw: string): boolean {
  return raw.startsWith(GZIP_PREFIX);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Compaction (pure)                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function monthFirstDay(day: EpochDay): EpochDay {
  const c = dayToCivil(day);
  const first: CivilDate = { year: c.year, month: c.month, day: 1 };
  return civilToDay(first);
}

function monthKeyOf(day: EpochDay): string {
  const c = dayToCivil(day);
  return `${c.year}-${String(c.month).padStart(2, '0')}`;
}

function addRows(a: DailyRow | undefined, b: DailyRow): DailyRow {
  if (!a) return { ...b };
  return { reps: a.reps + b.reps, ok: a.ok + b.ok, minutes: a.minutes + b.minutes, xp: a.xp + b.xp, input: a.input + b.input };
}

/**
 * Daily rows older than `KEEP_DAYS` collapse into one row per month keyed at
 * the month's first EpochDay (the `daily` shape is unchanged); ledger entries
 * older than `KEEP_DAYS` move into `ledger.monthly` (`YYYY-MM` → minutes).
 */
export function compactMeta(meta: SaveMeta, today: EpochDay): SaveMeta {
  const cutoff = today - KEEP_DAYS;
  let changed = false;

  const daily: Record<EpochDay, DailyRow> = {};
  const merged = new Map<EpochDay, DailyRow>();
  for (const [k, row] of Object.entries(meta.daily)) {
    const d = Number(k);
    if (d < cutoff) {
      const first = monthFirstDay(d);
      if (first !== d) changed = true;
      merged.set(first, addRows(merged.get(first), row));
    } else {
      daily[d] = row;
    }
  }
  for (const [d, row] of merged) daily[d] = row;

  const entries: LedgerEntry[] = [];
  const monthly: Record<string, number> = { ...meta.ledger.monthly };
  for (const e of meta.ledger.entries) {
    if (e[0] < cutoff) {
      changed = true;
      const mk = monthKeyOf(e[0]);
      monthly[mk] = (monthly[mk] ?? 0) + e[1];
    } else {
      entries.push(e);
    }
  }

  if (!changed) return meta;
  return { ...meta, daily, ledger: { ...meta.ledger, entries, monthly } };
}

export function compactLog(log: LogEntry[]): LogEntry[] {
  return log.length > LOG_RING_COMPACT ? log.slice(log.length - LOG_RING_COMPACT) : log;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Persist                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PersistOptions {
  /** Called after every flush whose `{bytes, level}` changed (and after a quota hit). */
  onState?: (s: StorageState) => void;
  /** Where to listen for `visibilitychange` / `pagehide`; `null` disables; default `document`/`window`. */
  hooks?: { document?: EventTarget | null; window?: EventTarget | null } | null;
  /** Allow the gzip rung of the ladder (default: when `CompressionStream` exists). */
  compression?: boolean;
}

export interface Persist {
  /** Slot-qualified key for one of the four bases. */
  key(base: string): string;
  shardKey(kind: ShardKind, level: Level): string;
  /** Parsed value; `null` when absent or corrupt; a Promise when the value is gzip-compressed. */
  read<T>(key: string): T | null | Promise<T | null>;
  /** Synchronous read; `null` for a compressed value (use `read`). */
  readSync<T>(key: string): T | null;
  /** The stored text as is (`null` when absent or unreadable); for stashing what `read` could not parse. */
  readRaw(key: string): string | null;
  /** Immediate write (try/catch; a failure returns `false` and is not retried, so it does not pin the level). */
  write(key: string, value: unknown): boolean;
  /** Immediate write of text as is (same failure semantics as `write`). */
  writeRaw(key: string, text: string): boolean;
  remove(key: string): void;
  /** Debounced write: `getValue` is called at flush time. */
  schedule(key: string, getValue: () => unknown): void;
  /** Keys with a pending write. */
  pending(): string[];
  /** Debounced keys whose last write failed (quota); the level is `ceiling` while non-empty. */
  failing(): string[];
  /** Write every pending key now. */
  flush(): Promise<void>;
  bytes(): number;
  level(): StorageLevel;
  state(): StorageState;
  /** Rungs 1–2 of the ladder (pure). `today` defaults to `epochDay(meta.updatedAt, meta.profile.tz)`. */
  compact(meta: SaveMeta, log: LogEntry[], today?: EpochDay): { meta: SaveMeta; log: LogEntry[] };
  /** Rung 3: gzip the largest uncompressed card shard in storage. Resolves `true` if one was compressed. */
  compressLargest(): Promise<boolean>;
  /** Keys currently stored compressed (writes to them stay compressed). */
  compressedKeys(): string[];
  dispose(): void;
}

export function createPersist(storage: Storage, slot = 0, opts: PersistOptions = {}): Persist {
  const dirty = new Map<string, () => unknown>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const compressed = new Set<string>();
  const compression = opts.compression ?? hasCompression();
  /** Debounced keys whose last write threw; cleared per key on the next success. */
  const failed = new Set<string>();
  let last: StorageState | null = null;
  let disposed = false;

  const key = (base: string): string => slotKey(base, slot);

  function parse<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  function getItem(k: string): string | null {
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  }

  function read<T>(k: string): T | null | Promise<T | null> {
    const raw = getItem(k);
    if (raw === null) return null;
    if (isCompressed(raw)) {
      compressed.add(k);
      if (!compression) return null;
      return gunzipText(raw).then(
        (text) => parse<T>(text),
        () => null,
      );
    }
    return parse<T>(raw);
  }

  function readSync<T>(k: string): T | null {
    const raw = getItem(k);
    if (raw === null || isCompressed(raw)) return null;
    return parse<T>(raw);
  }

  /** `track` = a debounced key that stays dirty and is retried; only those count toward the `ceiling` level. */
  function setItem(k: string, str: string, track = false): boolean {
    try {
      storage.setItem(k, str);
      if (track) failed.delete(k);
      return true;
    } catch (e) {
      if (track) failed.add(k);
      if (!isQuotaError(e)) console.warn(`[persist] setItem(${k}) failed`, e);
      return false;
    }
  }

  async function encode(k: string, value: unknown): Promise<string> {
    const json = JSON.stringify(value);
    if (compression && compressed.has(k)) {
      try {
        return await gzipText(json);
      } catch {
        compressed.delete(k);
      }
    }
    return json;
  }

  function bytes(): number {
    let total = 0;
    try {
      const n = storage.length;
      for (let i = 0; i < n; i++) {
        const k = storage.key(i);
        if (k === null) continue;
        const v = storage.getItem(k);
        total += utf16Bytes(k) + (v === null ? 0 : utf16Bytes(v));
      }
    } catch {
      /* unreadable storage counts as empty */
    }
    return total;
  }

  function level(): StorageLevel {
    return failed.size > 0 ? 'ceiling' : levelForBytes(bytes());
  }

  function state(): StorageState {
    const b = bytes();
    return { bytes: b, level: failed.size > 0 ? 'ceiling' : levelForBytes(b) };
  }

  /** Notify on a change — and on every flush while a key is still failing, so a repeated failure is never silent. */
  function settle(): void {
    const s = state();
    if (failed.size === 0 && last && last.bytes === s.bytes && last.level === s.level) return;
    last = s;
    opts.onState?.(s);
  }

  async function writeKey(k: string, getValue: () => unknown): Promise<boolean> {
    const str = await encode(k, getValue());
    const ok = setItem(k, str, true);
    // Keep the write dirty so the next flush retries after the ladder ran.
    if (!ok && !dirty.has(k)) dirty.set(k, getValue);
    return ok;
  }

  function clearTimer(k: string): void {
    const t = timers.get(k);
    if (t !== undefined) {
      clearTimeout(t);
      timers.delete(k);
    }
  }

  async function flushKey(k: string): Promise<void> {
    const get = dirty.get(k);
    if (!get) return;
    dirty.delete(k);
    await writeKey(k, get);
    settle();
  }

  function schedule(k: string, getValue: () => unknown): void {
    if (disposed) return;
    dirty.set(k, getValue);
    clearTimer(k);
    timers.set(
      k,
      setTimeout(() => {
        timers.delete(k);
        void flushKey(k);
      }, DEBOUNCE_MS),
    );
  }

  async function flush(): Promise<void> {
    const keys = Array.from(dirty.keys());
    for (const k of keys) clearTimer(k);
    for (const k of keys) {
      const get = dirty.get(k);
      if (!get) continue;
      dirty.delete(k);
      await writeKey(k, get);
    }
    settle();
  }

  function write(k: string, value: unknown): boolean {
    clearTimer(k);
    dirty.delete(k);
    let str: string;
    try {
      str = JSON.stringify(value);
    } catch {
      return false;
    }
    const ok = setItem(k, str);
    settle();
    return ok;
  }

  function writeRaw(k: string, text: string): boolean {
    clearTimer(k);
    dirty.delete(k);
    const ok = setItem(k, String(text));
    settle();
    return ok;
  }

  function remove(k: string): void {
    clearTimer(k);
    dirty.delete(k);
    compressed.delete(k);
    failed.delete(k);
    try {
      storage.removeItem(k);
    } catch {
      /* ignore */
    }
    settle();
  }

  function compact(meta: SaveMeta, log: LogEntry[], today?: EpochDay): { meta: SaveMeta; log: LogEntry[] } {
    let day = today;
    if (day === undefined) {
      try {
        day = epochDay(meta.updatedAt, meta.profile.tz);
      } catch {
        day = epochDay(meta.updatedAt);
      }
    }
    return { meta: compactMeta(meta, day), log: compactLog(log) };
  }

  async function compressLargest(): Promise<boolean> {
    if (!compression) return false;
    let bestKey: string | null = null;
    let bestLen = 0;
    for (const spec of SHARD_SPECS) {
      const k = shardKey(spec.kind, spec.level, slot);
      const raw = getItem(k);
      if (raw === null || isCompressed(raw)) continue;
      if (raw.length > bestLen) {
        bestLen = raw.length;
        bestKey = k;
      }
    }
    if (bestKey === null) return false;
    const raw = getItem(bestKey);
    if (raw === null) return false;
    try {
      const packed = await gzipText(raw);
      if (packed.length >= raw.length) return false;
      if (!setItem(bestKey, packed)) return false;
      compressed.add(bestKey);
      settle();
      return true;
    } catch {
      return false;
    }
  }

  // Flush hooks.
  const hooks = opts.hooks === undefined ? defaultHooks() : opts.hooks;
  const onVisibility = (): void => {
    const vs = (hooks?.document as { visibilityState?: string } | null | undefined)?.visibilityState;
    if (vs === undefined || vs === 'hidden') void flush();
  };
  const onPageHide = (): void => {
    void flush();
  };
  hooks?.document?.addEventListener('visibilitychange', onVisibility);
  hooks?.window?.addEventListener('pagehide', onPageHide);

  function dispose(): void {
    disposed = true;
    for (const k of Array.from(timers.keys())) clearTimer(k);
    dirty.clear();
    hooks?.document?.removeEventListener('visibilitychange', onVisibility);
    hooks?.window?.removeEventListener('pagehide', onPageHide);
  }

  return {
    key,
    shardKey: (kind, lvl) => shardKey(kind, lvl, slot),
    read,
    readSync,
    readRaw: getItem,
    write,
    writeRaw,
    remove,
    schedule,
    pending: () => Array.from(dirty.keys()),
    failing: () => Array.from(failed),
    flush,
    bytes,
    level,
    state,
    compact,
    compressLargest,
    compressedKeys: () => Array.from(compressed),
    dispose,
  };
}

function defaultHooks(): PersistOptions['hooks'] {
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  return doc || win ? { document: doc, window: win } : null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* In-memory Storage (fallback when localStorage is unavailable)              */
/* ────────────────────────────────────────────────────────────────────────── */

/** Minimal `Storage` over a Map; `store/testing.ts` ships the richer `MemoryStorage` with a quota. */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  const s = {
    get length(): number {
      return map.size;
    },
    key(i: number): string | null {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k: string): string | null {
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(k: string, v: string): void {
      map.set(k, String(v));
    },
    removeItem(k: string): void {
      map.delete(k);
    },
    clear(): void {
      map.clear();
    },
  };
  return s as unknown as Storage;
}

/** `localStorage` when readable, else an in-memory fallback (private mode, sandboxed iframes). */
export function defaultStorage(): Storage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls && typeof ls.getItem === 'function') {
      ls.getItem('tsuzuku.probe');
      return ls;
    }
  } catch {
    /* fall through */
  }
  return createMemoryStorage();
}
