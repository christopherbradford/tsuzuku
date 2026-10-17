/**
 * TSUZUKU — store test doubles (group B, contract tier; every group's tests
 * use these from day 1).
 *
 *  makeTestStore(o)  the real `store` singleton re-initialised over an
 *                    in-memory Storage, NO reducers wired unless `reducers: true`,
 *                    deterministic `now()`.
 *  card(o)           CardTuple factory.
 *  MemoryStorage     a `Storage` with `length`/`key` and an optional byte quota
 *                    that throws `QuotaExceededError` like a browser.
 *  captureEvents()   records every `bus.emit` until `stop()`.
 */
import type { CardKey } from '../content/types';
import { bus } from '../shared/events';
import {
  CARDS_SCHEMA,
  type CardShard,
  type CardState,
  type CardTuple,
  type SaveMeta,
  type Store,
} from '../shared/store-types';
import { freshSave } from './defaults';
import { META_KEY, parseShardId, shardIdFor, shardKey, slotKey, type ShardId } from './persist';
import { initStore, store } from './store';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** 2026-01-15T12:00:00Z — a Thursday, well inside every zone's daytime. */
export const DEFAULT_TEST_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
export const TEST_SEED = '0123456789abcdef';

/* ────────────────────────────────────────────────────────────────────────── */
/* MemoryStorage                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export class MemoryStorage implements Storage {
  [name: string]: unknown;
  private readonly map = new Map<string, string>();
  /** UTF-16 byte quota (keys + values); `undefined` = unlimited. */
  quota: number | undefined;
  /** Count of `setItem` calls (debounce tests). */
  writes = 0;

  constructor(quota?: number) {
    this.quota = quota;
  }

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    let i = 0;
    for (const k of this.map.keys()) {
      if (i === index) return k;
      i++;
    }
    return null;
  }

  getItem(key: string): string | null {
    const v = this.map.get(key);
    return v === undefined ? null : v;
  }

  setItem(key: string, value: string): void {
    const v = String(value);
    if (this.quota !== undefined) {
      const prev = this.map.get(key);
      const delta = (key.length + v.length) * 2 - (prev === undefined ? 0 : (key.length + prev.length) * 2);
      if (this.bytes() + delta > this.quota) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
    }
    this.writes++;
    this.map.set(key, v);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** UTF-16 bytes of every key + value. */
  bytes(): number {
    let n = 0;
    for (const [k, v] of this.map) n += (k.length + v.length) * 2;
    return n;
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Factories                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface CardOverrides {
  due: number;
  s: number;
  d: number;
  reps: number;
  lapses: number;
  state: CardState;
  last: number;
  flags: number;
}

export function card(o: Partial<CardOverrides> = {}): CardTuple {
  return [o.due ?? 0, o.s ?? 0, o.d ?? 5, o.reps ?? 0, o.lapses ?? 0, o.state ?? 0, o.last ?? 0, o.flags ?? 0];
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}

/** Recursive merge for plain objects; arrays and primitives in `patch` replace. */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as unknown as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const prev = out[k];
    out[k] = isPlainObject(prev) && isPlainObject(v) ? deepMerge(prev, v as DeepPartial<typeof prev>) : v;
  }
  return out as T;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* makeTestStore                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TestStoreOptions {
  save?: DeepPartial<SaveMeta>;
  cards?: Record<CardKey, CardTuple>;
  /** Fixed `now()` in ms, or a clock function. Default `DEFAULT_TEST_NOW`. */
  now?: number | (() => number);
  /** Wire the registered reducers (default `false`). */
  reducers?: boolean;
  /** Bring your own Storage (to inspect persistence); default a fresh `MemoryStorage`. */
  storage?: Storage;
  slot?: number;
}

/** Build the SaveMeta a test store starts from (fresh save + overrides, fixed seed, UTC). */
export function testSave(o: { save?: DeepPartial<SaveMeta>; now?: number } = {}): SaveMeta {
  const now = o.now ?? DEFAULT_TEST_NOW;
  const base = freshSave(now, 'UTC');
  base.seed = TEST_SEED;
  return deepMerge(base, o.save);
}

/** Group `cards` into shard documents keyed by storage key. */
export function shardDocuments(
  cards: Record<CardKey, CardTuple>,
  o: { station?: number; slot?: number } = {},
): Record<string, CardShard> {
  const byId = new Map<ShardId, CardShard>();
  for (const [k, t] of Object.entries(cards) as [CardKey, CardTuple][]) {
    const id = shardIdFor(k, { station: o.station });
    let shard = byId.get(id);
    if (!shard) {
      const { kind, level } = parseShardId(id);
      shard = { schema: CARDS_SCHEMA, kind, level, cards: {} };
      byId.set(id, shard);
    }
    shard.cards[k] = t;
  }
  const out: Record<string, CardShard> = {};
  for (const [id, shard] of byId) out[shardKey(shard.kind, shard.level, o.slot ?? 0)] = shard;
  return out;
}

export async function makeTestStore(o: TestStoreOptions = {}): Promise<Store> {
  const clock = typeof o.now === 'function' ? o.now : (): number => (o.now as number | undefined) ?? DEFAULT_TEST_NOW;
  const storage = o.storage ?? new MemoryStorage();
  const slot = o.slot ?? 0;
  const save = testSave({ save: o.save, now: clock() });
  storage.setItem(slotKey(META_KEY, slot), JSON.stringify(save));
  if (o.cards) {
    for (const [key, shard] of Object.entries(shardDocuments(o.cards, { station: save.progress.station, slot }))) {
      storage.setItem(key, JSON.stringify(shard));
    }
  }
  await initStore({ storage, slot, now: clock, reducers: o.reducers ?? false });
  return store;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* captureEvents                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

type Tap = (name: string, payload: unknown) => void;
type Emit = typeof bus.emit;

const taps = new Set<Tap>();
let originalEmit: Emit | null = null;

/** Records every event emitted on the bus (in order) until `stop()`. Nestable. */
export function captureEvents(): { events: [string, unknown][]; stop(): void } {
  const events: [string, unknown][] = [];
  const tap: Tap = (name, payload) => {
    events.push([name, payload]);
  };
  if (taps.size === 0) {
    const orig = bus.emit;
    originalEmit = orig;
    const wrapped: Emit = (name, payload) => {
      for (const t of Array.from(taps)) t(name, payload);
      orig.call(bus, name, payload);
    };
    (bus as { emit: Emit }).emit = wrapped;
  }
  taps.add(tap);
  return {
    events,
    stop() {
      taps.delete(tap);
      if (taps.size === 0 && originalEmit) {
        (bus as { emit: Emit }).emit = originalEmit;
        originalEmit = null;
      }
    },
  };
}
