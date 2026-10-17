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
 * `fillMeta` is type-aware against `freshSave()` as the template: a field
 * whose runtime kind differs from the default (a string where a number
 * belongs, `null`, `Infinity`, an object for an array…) falls back to the
 * default, recursively through nested objects; `profile.belt` must be a
 * known belt and `profile.tz` a zone the host resolves (`shared/time.safeTz`,
 * else `'UTC'`). Keys the template lacks (optional fields, record entries) pass
 * through untouched. `migrateMetaChecked` also reports the repaired paths
 * so an import can warn. A save that finished onboarding (goals set, or any
 * training recorded) while `progress.station` is still 0 is lifted to the
 * first station past its cleared gates (Nihonbashi is onboarding only).
 *
 * `applyRedirects` is the id-rename pass driven by `ContentManifest.redirects`.
 */
import { BELT_IDS, FACETS, type CardKey } from '../content/types';
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
import { safeTz } from '../shared/time';
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

const BELT_SET: ReadonlySet<string> = new Set(BELT_IDS);

/**
 * `have` if its runtime kind matches `def`, else `def`; objects recurse key
 * by key (keys absent from `def` pass through), arrays drop `null`/`undefined`
 * entries. Repaired paths are appended to `coerced`.
 */
function coerce(def: unknown, have: unknown, path: string, coerced: string[]): unknown {
  if (have === undefined) return def;
  if (def === null) {
    if (have === null || (typeof have === 'number' && Number.isFinite(have))) return have;
    coerced.push(path);
    return def;
  }
  if (Array.isArray(def)) {
    if (!Array.isArray(have)) {
      coerced.push(path);
      return def;
    }
    const clean = have.filter((x) => x !== null && x !== undefined);
    if (clean.length !== have.length) coerced.push(path);
    return clean;
  }
  if (isObject(def)) {
    if (!isObject(have)) {
      coerced.push(path);
      return def;
    }
    const out: Raw = { ...have };
    for (const [k, dv] of Object.entries(def)) out[k] = coerce(dv, have[k], `${path}.${k}`, coerced);
    return out;
  }
  const kind = typeof def;
  if (typeof have === kind && (kind !== 'number' || Number.isFinite(have))) return have;
  coerced.push(path);
  return def;
}

/**
 * Fill every slice with defaults for keys the document lacks (additive fields
 * of newer builds) and repair fields of the wrong type (see the module header).
 */
function fillMeta(raw: Raw, coerced: string[]): SaveMeta {
  const tz = safeTz(isObject(raw.profile) && typeof raw.profile.tz === 'string' ? raw.profile.tz : 'UTC');
  const d = freshSave(num(raw.createdAt, 0), tz);
  const out = {} as Record<string, unknown>;
  out.schema = SAVE_SCHEMA;
  out.seed = typeof raw.seed === 'string' && raw.seed.length > 0 ? raw.seed : d.seed;
  out.createdAt = num(raw.createdAt, d.createdAt);
  out.updatedAt = num(raw.updatedAt, out.createdAt as number);
  out.contentVersion = typeof raw.contentVersion === 'string' ? raw.contentVersion : '';
  for (const k of SLICE_KEYS) out[k] = coerce(d[k], raw[k], k, coerced);
  const meta = out as unknown as SaveMeta;
  if (!BELT_SET.has(meta.profile.belt)) {
    coerced.push('profile.belt');
    meta.profile = { ...meta.profile, belt: d.profile.belt };
  }
  // An unresolvable or unsafe zone id would throw in `Intl` day math and could leak into an ICS line.
  if (meta.profile.tz !== tz) {
    coerced.push('profile.tz');
    meta.profile = { ...meta.profile, tz };
  }
  // Onboarding done at station 0 (Nihonbashi is onboarding only): lift to the first uncleared station.
  const pr = meta.progress;
  const trained = meta.profile.goals.length > 0 || meta.stats.sessions > 0 || meta.streak.totalDays > 0;
  if (pr.station === 0 && trained) {
    const cleared = pr.stationsCleared.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    meta.progress = { ...pr, station: Math.min(53, Math.max(1, ...cleared.map((n) => n + 1))) };
  }
  return meta;
}

/** `migrateMeta` plus the paths whose values were repaired to defaults (empty on a well-typed save). */
export function migrateMetaChecked(raw: unknown): { meta: SaveMeta; coerced: string[] } {
  if (!isObject(raw)) throw new MigrationError('meta', 'document is not an object');
  if (raw.schema === undefined && !isObject(raw.profile) && !isObject(raw.settings)) {
    throw new MigrationError('meta', 'document has no schema and does not look like a save');
  }
  const coerced: string[] = [];
  const meta = fillMeta(runChain('meta', raw, META_STEPS, CURRENT.meta), coerced);
  return { meta, coerced };
}

export function migrateMeta(raw: unknown): SaveMeta {
  return migrateMetaChecked(raw).meta;
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
