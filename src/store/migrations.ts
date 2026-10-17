/**
 * TSUZUKU — save schema migrations (store group B).
 *
 * Versioned chains for the three persisted documents (`tsuzuku.save/N`,
 * `tsuzuku.cards/N`, `tsuzuku.log/N`). v0 = a pre-schema document (no
 * `schema` field); v0 → v1 fills defaults and is the identity on a complete
 * v1 document. Later versions register a step in `*_STEPS`. Every function is
 * pure and idempotent; unknown or newer schemas throw `MigrationError` so the
 * caller can stash the raw document instead of overwriting it.
 *
 * `applyRedirects` is the id-rename pass driven by `ContentManifest.redirects`.
 */
import { FACETS, type CardKey } from '../content/types';
import {
  CARDS_SCHEMA,
  LOG_SCHEMA,
  SAVE_SCHEMA,
  SHARD_KINDS,
  SLICE_KEYS,
  type CardShard,
  type CardTuple,
  type LogEntry,
  type SaveMeta,
} from '../shared/store-types';
import { freshSave } from './defaults';

export const CURRENT = { meta: 1, cards: 1, log: 1 } as const;

export class MigrationError extends Error {
  readonly doc: 'meta' | 'cards' | 'log';
  readonly schema: unknown;
  constructor(doc: 'meta' | 'cards' | 'log', message: string, schema?: unknown) {
    super(`migrate ${doc}: ${message}`);
    this.name = 'MigrationError';
    this.doc = doc;
    this.schema = schema;
  }
}

type Raw = Record<string, unknown>;
type Step = (raw: Raw) => Raw;

function isObject(x: unknown): x is Raw {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** `tsuzuku.save/3` → 3; absent → 0; malformed → null. */
function versionOf(doc: 'meta' | 'cards' | 'log', raw: Raw): number | null {
  const prefix = { meta: 'tsuzuku.save/', cards: 'tsuzuku.cards/', log: 'tsuzuku.log/' }[doc];
  const s = raw.schema;
  if (s === undefined) return 0;
  if (typeof s !== 'string' || !s.startsWith(prefix)) return null;
  const n = Number(s.slice(prefix.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function runChain(doc: 'meta' | 'cards' | 'log', raw: Raw, steps: Record<number, Step>, current: number): Raw {
  const v = versionOf(doc, raw);
  if (v === null) throw new MigrationError(doc, `unknown schema "${String(raw.schema)}"`, raw.schema);
  if (v > current) throw new MigrationError(doc, `schema version ${v} is newer than this build (${current})`, raw.schema);
  let out = raw;
  for (let i = v; i < current; i++) {
    const step = steps[i];
    if (!step) throw new MigrationError(doc, `no migration step from version ${i}`, raw.schema);
    out = step(out);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* meta                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const META_STEPS: Record<number, Step> = {
  /** v0 (no schema) → v1: stamp the schema; defaults are filled afterwards. */
  0: (raw) => ({ ...raw, schema: SAVE_SCHEMA }),
  // Future: 1: (raw) => ({ ...raw, schema: 'tsuzuku.save/2', ... }),
};

function num(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

/**
 * Fill every slice with defaults for keys the document lacks (additive fields
 * of newer builds). Shallow per slice: a slice value the save already has wins.
 */
function fillMeta(raw: Raw): SaveMeta {
  const tz = isObject(raw.profile) && typeof raw.profile.tz === 'string' ? raw.profile.tz : 'UTC';
  const d = freshSave(num(raw.createdAt, 0), tz);
  const out = {} as Record<string, unknown>;
  out.schema = SAVE_SCHEMA;
  out.seed = typeof raw.seed === 'string' && raw.seed.length > 0 ? raw.seed : d.seed;
  out.createdAt = num(raw.createdAt, d.createdAt);
  out.updatedAt = num(raw.updatedAt, out.createdAt as number);
  out.contentVersion = typeof raw.contentVersion === 'string' ? raw.contentVersion : '';
  for (const k of SLICE_KEYS) {
    const def = d[k];
    const have = raw[k];
    if (Array.isArray(def)) {
      out[k] = Array.isArray(have) ? have : def;
    } else if (isObject(def)) {
      out[k] = isObject(have) ? { ...(def as Raw), ...have } : def;
    } else {
      out[k] = have ?? def;
    }
  }
  return out as unknown as SaveMeta;
}

export function migrateMeta(raw: unknown): SaveMeta {
  if (!isObject(raw)) throw new MigrationError('meta', 'document is not an object');
  if (raw.schema === undefined && !isObject(raw.profile) && !isObject(raw.settings)) {
    throw new MigrationError('meta', 'document has no schema and does not look like a save');
  }
  return fillMeta(runChain('meta', raw, META_STEPS, CURRENT.meta));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* cards                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

const CARD_STEPS: Record<number, Step> = {
  0: (raw) => ({ ...raw, schema: CARDS_SCHEMA }),
};

const FACET_SET: ReadonlySet<string> = new Set(FACETS);

export function isCardTuple(x: unknown): x is CardTuple {
  if (!Array.isArray(x) || x.length !== 8) return false;
  for (let i = 0; i < 8; i++) {
    const v = x[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  const state = x[5];
  return state === 0 || state === 1 || state === 2 || state === 3;
}

function isCardKeyString(k: string): k is CardKey {
  const i = k.lastIndexOf('#');
  return i > 0 && FACET_SET.has(k.slice(i + 1));
}

export function migrateShard(raw: unknown): CardShard {
  if (!isObject(raw)) throw new MigrationError('cards', 'document is not an object');
  const r = runChain('cards', raw, CARD_STEPS, CURRENT.cards);
  const kind = typeof r.kind === 'string' && (SHARD_KINDS as readonly string[]).includes(r.kind) ? r.kind : null;
  const level = typeof r.level === 'string' ? r.level : null;
  if (!kind || !level) throw new MigrationError('cards', 'shard lacks kind/level');
  const cards: Record<CardKey, CardTuple> = {};
  if (isObject(r.cards)) {
    for (const [k, t] of Object.entries(r.cards)) {
      if (isCardKeyString(k) && isCardTuple(t)) cards[k] = t;
    }
  }
  return { schema: CARDS_SCHEMA, kind: kind as CardShard['kind'], level: level as CardShard['level'], cards };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* log                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

const LOG_STEPS: Record<number, Step> = {
  0: (raw) => ({ ...raw, schema: LOG_SCHEMA }),
};

/** Accepts the 6-tuple and the design-07 5-tuple (`tagsMask` optional → 0). */
export function toLogEntry(x: unknown): LogEntry | null {
  if (!Array.isArray(x) || x.length < 5 || x.length > 6) return null;
  const [t, k, rating, ms, ex, mask] = x as unknown[];
  if (typeof t !== 'number' || typeof k !== 'string' || !isCardKeyString(k)) return null;
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) return null;
  if (typeof ms !== 'number' || typeof ex !== 'number') return null;
  const m = typeof mask === 'number' ? mask : 0;
  return [t, k, rating, ms, ex, m];
}

export function migrateLog(raw: unknown): LogEntry[] {
  // v0 may be a bare array of entries.
  const doc: Raw = Array.isArray(raw) ? { entries: raw } : isObject(raw) ? raw : {};
  if (!Array.isArray(raw) && !isObject(raw)) throw new MigrationError('log', 'document is not an object');
  const r = runChain('log', doc, LOG_STEPS, CURRENT.log);
  const entries = Array.isArray(r.entries) ? r.entries : [];
  const out: LogEntry[] = [];
  for (const e of entries) {
    const le = toLogEntry(e);
    if (le) out.push(le);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* id redirects                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Follow `old → new` chains (≤ 16 hops, cycle-safe). */
export function resolveRedirect(id: string, redirects: Record<string, string>): string {
  let cur = id;
  for (let i = 0; i < 16; i++) {
    const next = redirects[cur];
    if (next === undefined || next === cur) break;
    cur = next;
  }
  return cur;
}

export function redirectKey(key: CardKey, redirects: Record<string, string>): CardKey {
  const i = key.lastIndexOf('#');
  const itemId = key.slice(0, i);
  const facet = key.slice(i);
  const to = resolveRedirect(itemId, redirects);
  return to === itemId ? key : (`${to}${facet}` as CardKey);
}

/** Newer `last` wins a collision; ties go to the card with more reps. */
export function newerCard(a: CardTuple, b: CardTuple): CardTuple {
  if (b[6] !== a[6]) return b[6] > a[6] ? b : a;
  return b[3] > a[3] ? b : a;
}

/** Rewrite card keys through `redirects`; merge collisions by newer `last`. Idempotent. */
export function applyRedirects(shard: CardShard, redirects: Record<string, string>): CardShard {
  let changed = false;
  const cards: Record<CardKey, CardTuple> = {};
  for (const [k, t] of Object.entries(shard.cards) as [CardKey, CardTuple][]) {
    const nk = redirectKey(k, redirects);
    if (nk !== k) changed = true;
    const existing = cards[nk];
    cards[nk] = existing ? newerCard(existing, t) : t;
  }
  return changed ? { ...shard, cards } : shard;
}
