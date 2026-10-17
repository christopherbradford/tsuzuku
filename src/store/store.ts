/**
 * TSUZUKU — the store (group B, ARCHITECTURE §1).
 *
 * One `Signal` per SaveMeta slice, `patch()` for immutable updates, a card
 * map sharded by kind + level, the 5,000-entry review log ring, the opaque
 * session snapshot slot, the storage meter and `flush()`. `cards.dueOn(day)`
 * lists due REVIEWS: a card created at introduction but never served
 * (state 0) is not due — Scrolls introduce it — unless `includeNew` is set;
 * archived and Kaiden cards are likewise opt-in (`./due.isDueReview`). `initStore()` reads
 * everything back through `persist.ts` (migrating on the way), then wires
 * the reducers registered in `REDUCERS` unless `reducers: false`. A document
 * the store cannot read (corrupt text, a newer schema) is stashed as
 * `<key>.bak` — meta, every card shard AND the review log — before a fresh
 * one takes its place; nothing is ever silently overwritten. When the stash
 * itself fails (quota), the store frees the disposable session key, gzips the
 * largest shard and retries once; if the `.bak` still cannot be written the
 * key is frozen in `persist` (the fresh document lives in memory only, the
 * unreadable text stays in place) and the storage level reads `ceiling` so
 * the shell's export prompt shows. Re-initialising flushes the outgoing
 * slot's pending writes first.
 *
 * B-internal extras for `backup.ts`: `replaceHeader` (seed/createdAt/
 * contentVersion on import) and `replaceLog` (bulk ring assignment).
 * `resetSave()` (Settings 「初めから」) wipes header, slices, cards, log and
 * session back to `freshSave()` in one signals batch; only the zone survives.
 *
 * `now()` is the one sanctioned `Date.now()` outside `shared/hash.ts`;
 * `today()` is the 04:00-boundary EpochDay in the profile's zone.
 */
import { batch, signal, type Signal } from '@preact/signals';
import { FACETS, type CardKey, type Facet, type Level } from '../content/types';
import type { SessionSnapshot } from '../shared/session-types';
import { SESSION_SCHEMA } from '../shared/session-types';
import { epochDay } from '../shared/time';
import {
  CARDS_SCHEMA,
  CardFlag,
  LOG_SCHEMA,
  SLICE_KEYS,
  hasFlag,
  type CardShard,
  type CardTuple,
  type CardsApi,
  type EpochDay,
  type InitStoreOptions,
  type LogApi,
  type LogEntry,
  type ReviewLog,
  type SaveMeta,
  type SessionApi,
  type SliceKey,
  type StorageState,
  type Store,
  type StoreSlices,
} from '../shared/store-types';
import { freshSave } from './defaults';
import { MigrationError, migrateLog, migrateMeta, migrateShard } from './migrations';
import {
  LOG_KEY,
  LOG_RING,
  META_KEY,
  SESSION_KEY,
  SHARD_SPECS,
  createPersist,
  defaultStorage,
  parseShardId,
  shardIdFor,
  shardIdOf,
  type Persist,
  type ShardId,
} from './persist';
import { startDayRoll } from './day';
import { startLedger } from './ledger';
import { startQuests } from './quests';
import { startStats } from './stats';
import { startStreak } from './streak';
import { startUnlocks } from './unlocks';
import { startWeakPoints } from './weak-points';
import { startXp } from './xp';

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** A reducer starter subscribes to the bus and returns its unsubscribe. */
export type ReducerStarter = (s: Store) => () => void;

/**
 * Reducers wired by `initStore()` (unless `reducers: false`), in this order:
 * XP first so `xp:gained` lands synchronously inside the emitting call, the
 * day roll before quests/stats so a session on a new day sees today's slice.
 * Arrow wrappers resolve the starters at init time, so the module cycle
 * (`ledger.ts` imports `store`) is harmless whichever file loads first.
 * `startUnlocks` (B-defs) runs last so badges see every counter of the event.
 */
const REDUCERS: ReducerStarter[] = [
  (s) => startXp(s),
  (s) => startStreak(s),
  (s) => startDayRoll(s),
  (s) => startQuests(s),
  (s) => startStats(s),
  (s) => startWeakPoints(s),
  (s) => startLedger(s),
  (s) => startUnlocks(s),
];

export function registerReducer(start: ReducerStarter): () => void {
  REDUCERS.push(start);
  return () => {
    const i = REDUCERS.indexOf(start);
    if (i >= 0) REDUCERS.splice(i, 1);
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* State                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

interface Header {
  seed: string;
  createdAt: number;
  updatedAt: number;
  contentVersion: string;
}

const initial = freshSave(0, 'UTC');
const header: Header = { seed: initial.seed, createdAt: 0, updatedAt: 0, contentVersion: '' };

function makeSlices(m: SaveMeta): StoreSlices {
  const out = {} as Record<SliceKey, Signal<unknown>>;
  for (const k of SLICE_KEYS) out[k] = signal<unknown>(m[k]);
  return out as unknown as StoreSlices;
}

const slices = makeSlices(initial);
const ready = signal(false);
const version = signal(0);
const storageSig = signal<StorageState>({ bytes: 0, level: 'ok' });

let persist: Persist | null = null;
let nowFn: () => number = () => Date.now();
let slot = 0;
let stops: (() => void)[] = [];
let laddering = false;

const cardMap = new Map<CardKey, CardTuple>();
const keyShard = new Map<CardKey, ShardId>();
const shards = new Map<ShardId, CardShard>();
let logEntries: LogEntry[] = [];
/** `undefined` = not read yet; `null` = none. */
let sessionCache: SessionSnapshot | null | undefined;

function sliceSignal<K extends SliceKey>(k: K): Signal<SaveMeta[K]> {
  return slices[k] as unknown as Signal<SaveMeta[K]>;
}

function applyMeta(m: SaveMeta): void {
  header.seed = m.seed;
  header.createdAt = m.createdAt;
  header.updatedAt = m.updatedAt;
  header.contentVersion = m.contentVersion;
  for (const k of SLICE_KEYS) (slices[k] as unknown as Signal<unknown>).value = m[k];
}

function meta(): SaveMeta {
  const out = {
    schema: initial.schema,
    seed: header.seed,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    contentVersion: header.contentVersion,
  } as Record<string, unknown>;
  for (const k of SLICE_KEYS) out[k] = (slices[k] as unknown as Signal<unknown>).value;
  return out as unknown as SaveMeta;
}

function now(): number {
  return nowFn();
}

function today(): EpochDay {
  const t = nowFn();
  try {
    return epochDay(t, sliceSignal('profile').value.tz);
  } catch {
    return epochDay(t);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Persistence scheduling                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function scheduleMeta(): void {
  persist?.schedule(persist.key(META_KEY), meta);
}

function scheduleShard(id: ShardId): void {
  if (!persist) return;
  const { kind, level } = parseShardId(id);
  persist.schedule(persist.shardKey(kind, level), () => shards.get(id));
}

function scheduleLog(): void {
  persist?.schedule(persist.key(LOG_KEY), (): ReviewLog => ({ schema: LOG_SCHEMA, entries: logEntries }));
}

function scheduleSession(): void {
  persist?.schedule(persist.key(SESSION_KEY), () => sessionCache);
}

/**
 * Ceiling ladder (ARCHITECTURE §1): ring → 2,000, old rows → monthly, then
 * gzip the largest shard. Holds the Persist it started on, so a re-init
 * mid-ladder never lets it touch the next slot.
 */
async function runLadder(): Promise<void> {
  const p = persist;
  if (!p || laddering) return;
  laddering = true;
  try {
    const { meta: m, log } = p.compact(meta(), logEntries, today());
    if (m.daily !== sliceSignal('daily').value) patch('daily', () => m.daily);
    if (m.ledger !== sliceSignal('ledger').value) patch('ledger', () => m.ledger);
    if (log !== logEntries) {
      logEntries = log;
      scheduleLog();
    }
    await p.flush();
    if (p.level() === 'ceiling') {
      const did = await p.compressLargest();
      if (did) await p.flush();
    }
  } finally {
    laddering = false;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* patch                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function patch<K extends SliceKey>(k: K, fn: (prev: SaveMeta[K]) => SaveMeta[K]): void {
  const sig = sliceSignal(k);
  const prev = sig.value;
  const next = fn(prev);
  if (Object.is(next, prev)) return;
  sig.value = next;
  header.updatedAt = nowFn();
  scheduleMeta();
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Cards                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DueOptions {
  includeArchived?: boolean;
  includeKaiden?: boolean;
  /** Also list never-reviewed (state-0) cards whose due day has arrived. */
  includeNew?: boolean;
}

/** Optional placement hint for a card's first write (kanji ids carry no level). */
export interface SetHint {
  level?: Level;
}

function shardFor(id: ShardId): CardShard {
  let s = shards.get(id);
  if (!s) {
    const { kind, level } = parseShardId(id);
    s = { schema: CARDS_SCHEMA, kind, level, cards: {} };
    shards.set(id, s);
  }
  return s;
}

function placeKey(k: CardKey, hint?: SetHint): ShardId {
  const known = keyShard.get(k);
  if (known) return known;
  const id = shardIdFor(k, { level: hint?.level, station: sliceSignal('progress').value.station });
  keyShard.set(k, id);
  return id;
}

/** The store's cards API with B-internal extras (`set` hint, `dueOn` options). */
export interface StoreCardsApi extends CardsApi {
  set(k: CardKey, t: CardTuple, hint?: SetHint): void;
  dueOn(day: EpochDay, o?: DueOptions): CardKey[];
}

export const storeCards: StoreCardsApi = {
  get(k) {
    return cardMap.get(k);
  },
  set(k, t, hint) {
    const id = placeKey(k, hint);
    shardFor(id).cards[k] = t;
    cardMap.set(k, t);
    scheduleShard(id);
    version.value = version.peek() + 1;
  },
  delete(k) {
    const id = keyShard.get(k);
    if (!id || !cardMap.has(k)) return;
    const s = shards.get(id);
    if (s) delete s.cards[k];
    cardMap.delete(k);
    keyShard.delete(k);
    scheduleShard(id);
    version.value = version.peek() + 1;
  },
  byItem(itemId) {
    const out: Partial<Record<Facet, CardTuple>> = {};
    for (const f of FACETS) {
      const t = cardMap.get(`${itemId}#${f}`);
      if (t) out[f] = t;
    }
    return out;
  },
  dueOn(day, o) {
    const out: CardKey[] = [];
    for (const [k, t] of cardMap) {
      if (t[0] > day) continue;
      if (!o?.includeNew && t[5] === 0) continue;
      const flags = t[7];
      if (!o?.includeArchived && hasFlag(flags, CardFlag.archived)) continue;
      if (!o?.includeKaiden && hasFlag(flags, CardFlag.kaiden)) continue;
      out.push(k);
    }
    return out;
  },
  forEach(fn) {
    for (const [k, t] of cardMap) fn(k, t);
  },
  count() {
    return cardMap.size;
  },
  version,
};

/** Shard id a key is (or would be) stored in. */
export function shardOfKey(k: CardKey): ShardId {
  return keyShard.get(k) ?? shardIdFor(k, { station: sliceSignal('progress').value.station });
}

/** Number of cards per shard (storage meter / About page). */
export function shardSizes(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, s] of shards) out[id] = Object.keys(s.cards).length;
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* B-internal bulk setters (backup import)                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SaveHeader {
  seed: string;
  createdAt: number;
  contentVersion: string;
}

/**
 * Replace the save header (`seed`, `createdAt`, `contentVersion`) — the
 * fields outside every slice, which `patch()` cannot reach. A restored
 * backup carries its own seed so wallpapers, Mon and stamps render as they
 * did on the original device. Schedules the meta write.
 */
export function replaceHeader(h: SaveHeader): void {
  if (header.seed === h.seed && header.createdAt === h.createdAt && header.contentVersion === h.contentVersion) return;
  header.seed = h.seed;
  header.createdAt = h.createdAt;
  header.contentVersion = h.contentVersion;
  header.updatedAt = nowFn();
  scheduleMeta();
}

/** Replace the review log ring wholesale (sorted by the caller; the newest `LOG_RING` are kept). */
export function replaceLog(entries: LogEntry[]): void {
  logEntries = entries.length > LOG_RING ? entries.slice(entries.length - LOG_RING) : entries.slice();
  scheduleLog();
}

/**
 * Wipe the save in place: a new header (seed, `createdAt` = now), every slice
 * back to `freshSave()`, every card, the review-log ring and the session
 * snapshot gone; only the profile's time zone survives. One signals `batch`,
 * so the unlock evaluator and the other slice/`cards.version` effects run once,
 * not once per card. Loaded shard keys are removed from storage (a frozen key
 * is left alone), the meta and log writes are scheduled and the session key is
 * removed; call `store.flush()` if the storage must be settled right away.
 */
export function resetSave(): void {
  batch(() => {
    const fresh = freshSave(nowFn(), sliceSignal('profile').value.tz);
    applyMeta(fresh);
    header.updatedAt = nowFn();
    scheduleMeta();
    if (persist) {
      const frozen = new Set(persist.frozen());
      for (const id of shards.keys()) {
        const { kind, level } = parseShardId(id);
        const key = persist.shardKey(kind, level);
        if (!frozen.has(key)) persist.remove(key);
      }
    }
    shards.clear();
    cardMap.clear();
    keyShard.clear();
    version.value = version.peek() + 1;
    logEntries = [];
    scheduleLog();
    session.clear();
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Log                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

const log: LogApi = {
  push(e) {
    logEntries.push(e);
    if (logEntries.length > LOG_RING) logEntries = logEntries.slice(logEntries.length - LOG_RING);
    scheduleLog();
  },
  recent(n) {
    return n <= 0 ? [] : logEntries.slice(Math.max(0, logEntries.length - n));
  },
  forCard(k) {
    return logEntries.filter((e) => e[1] === k);
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Session                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function isSnapshot(x: unknown): x is SessionSnapshot {
  return typeof x === 'object' && x !== null && (x as { schema?: unknown }).schema === SESSION_SCHEMA;
}

const session: SessionApi = {
  load() {
    if (sessionCache !== undefined) return sessionCache;
    const raw = persist ? persist.readSync<unknown>(persist.key(SESSION_KEY)) : null;
    sessionCache = isSnapshot(raw) ? raw : null;
    return sessionCache;
  },
  save(s) {
    sessionCache = s;
    scheduleSession();
  },
  clear() {
    sessionCache = null;
    persist?.remove(persist.key(SESSION_KEY));
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* The store                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

async function flush(): Promise<void> {
  await persist?.flush();
}

export const store: Store = {
  ...slices,
  ready,
  meta,
  seed: () => header.seed,
  now,
  today,
  patch,
  cards: storeCards,
  log,
  session,
  storage: storageSig,
  flush,
};

export interface InitOptions extends InitStoreOptions {
  /** Wire the registered reducers (default `true`; `makeTestStore` passes `false`). */
  reducers?: boolean;
}

function teardown(): void {
  for (const stop of stops) {
    try {
      stop();
    } catch {
      /* ignore */
    }
  }
  stops = [];
  persist?.dispose();
  persist = null;
  cardMap.clear();
  keyShard.clear();
  shards.clear();
  logEntries = [];
  sessionCache = undefined;
  laddering = false;
}

function resolveTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function ingestShard(id: ShardId, shard: CardShard): void {
  const target = shardFor(id);
  for (const [k, t] of Object.entries(shard.cards) as [CardKey, CardTuple][]) {
    target.cards[k] = t;
    cardMap.set(k, t);
    keyShard.set(k, id);
  }
}

export async function initStore(o: InitOptions = {}): Promise<void> {
  // A re-init (slot switch) must not drop up to 1 s of debounced reviews.
  if (persist) await persist.flush();
  teardown();
  ready.value = false;
  slot = o.slot ?? 0;
  nowFn = o.now ?? (() => Date.now());
  const storage = o.storage ?? defaultStorage();
  const p = createPersist(storage, slot, {
    onState: (s) => {
      storageSig.value = s;
      if (s.level === 'ceiling') void runLadder();
    },
  });
  persist = p;

  // Never overwrite a save we cannot read: stash its text as `<key>.bak`, then start fresh.
  // A stash that hits the quota frees room (session key, gzip the largest shard) and retries once;
  // if it still fails the key is frozen so the unreadable document is never written over.
  async function stash(key: string, why: unknown): Promise<void> {
    const reason = why instanceof MigrationError ? why.message : `${key} is not readable`;
    const text = p.readRaw(key);
    if (text === null) {
      console.warn(`[store] ${reason}`);
      return;
    }
    const bak = `${key}.bak`;
    let ok = p.writeRaw(bak, text);
    if (!ok) {
      p.remove(p.key(SESSION_KEY));
      await p.compressLargest();
      ok = p.writeRaw(bak, text);
    }
    if (ok) {
      console.warn(`[store] ${reason}; kept as ${bak}`);
      return;
    }
    p.freeze(key);
    console.error(`[store] ${reason}; ${bak} could not be written (storage full), so ${key} is left untouched and not persisted this session`);
  }

  // meta
  const metaKey = p.key(META_KEY);
  const rawMeta = await p.read<unknown>(metaKey);
  let m: SaveMeta;
  if (rawMeta === null) {
    if (p.readRaw(metaKey) !== null) await stash(metaKey, null);
    m = freshSave(nowFn(), resolveTz());
  } else {
    try {
      m = migrateMeta(rawMeta);
    } catch (e) {
      await stash(metaKey, e);
      m = freshSave(nowFn(), resolveTz());
    }
  }
  applyMeta(m);

  // cards
  for (const spec of SHARD_SPECS) {
    const key = p.shardKey(spec.kind, spec.level);
    const raw = await p.read<unknown>(key);
    if (raw === null) {
      if (p.readRaw(key) !== null) await stash(key, null);
      continue;
    }
    try {
      ingestShard(shardIdOf(spec.kind, spec.level), migrateShard(raw));
    } catch (e) {
      await stash(key, e);
    }
  }

  // log — same stash rule as meta and the shards (a rolled-back schema bump must not drop the ring).
  const logKey = p.key(LOG_KEY);
  const rawLog = await p.read<unknown>(logKey);
  if (rawLog === null) {
    if (p.readRaw(logKey) !== null) await stash(logKey, null);
  } else {
    try {
      logEntries = migrateLog(rawLog);
      if (logEntries.length > LOG_RING) logEntries = logEntries.slice(logEntries.length - LOG_RING);
    } catch (e) {
      await stash(logKey, e);
      logEntries = [];
    }
  }

  sessionCache = undefined;
  version.value = version.peek() + 1;
  storageSig.value = p.state();

  if (o.reducers !== false) {
    for (const start of REDUCERS) stops.push(start(store));
  }
  ready.value = true;
}

/** Drop everything (signals back to fresh defaults, timers cleared, reducers stopped). */
export function resetStoreForTests(): void {
  teardown();
  applyMeta(freshSave(0, 'UTC'));
  nowFn = () => Date.now();
  slot = 0;
  ready.value = false;
  version.value = version.peek() + 1;
  storageSig.value = { bytes: 0, level: 'ok' };
}

/** The active slot (0 = default). */
export function currentSlot(): number {
  return slot;
}
