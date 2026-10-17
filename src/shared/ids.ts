/**
 * TSUZUKU — id helpers (ARCHITECTURE §3; hyphen grammar from `content/types`).
 *
 *  kana k-h-a · vocab v-n5-0001 · kanji j-食 · grammar g-n5-001 · story s-07-1
 *  conjugation cj-0001 · component c-person · michikusa m-07-1 · station st-07
 *  card keys `${itemId}#${facet}`.
 */
import { FACETS, ID_PATTERNS, type CardKey, type ContentKind, type Facet, type Level } from '../content/types';
import type { ItemKind } from './store-types';

/** `kindOfId` / `loader.kindOf` return this union; `chunk` needs the item and is never returned. */
export type IdKind = ItemKind | 'story' | 'michikusa' | 'conjugation' | 'station';

const FACET_SET: ReadonlySet<string> = new Set(FACETS);

export function cardKey(itemId: string, facet: Facet): CardKey {
  return `${itemId}#${facet}`;
}

export function isFacet(s: string): s is Facet {
  return FACET_SET.has(s);
}

export function isCardKey(s: string): s is CardKey {
  const i = s.lastIndexOf('#');
  return i > 0 && i === s.indexOf('#') && isFacet(s.slice(i + 1));
}

/** Throws on a malformed key. */
export function parseCardKey(k: CardKey | string): { itemId: string; facet: Facet } {
  const i = k.lastIndexOf('#');
  if (i <= 0) throw new RangeError(`parseCardKey: "${k}" has no facet`);
  const itemId = k.slice(0, i);
  const facet = k.slice(i + 1);
  if (!isFacet(facet)) throw new RangeError(`parseCardKey: "${facet}" is not a facet`);
  return { itemId, facet };
}

export function itemOfKey(k: CardKey): string {
  return parseCardKey(k).itemId;
}

export function facetOfKey(k: CardKey): Facet {
  return parseCardKey(k).facet;
}

/** Longest prefixes first so `cj-`/`st-` win over `c-`/`s-`. */
const PREFIXES: readonly [prefix: string, kind: IdKind][] = [
  ['cj-', 'conjugation'],
  ['st-', 'station'],
  ['k-', 'kana'],
  ['v-', 'vocab'],
  ['j-', 'kanji'],
  ['g-', 'grammar'],
  ['c-', 'component'],
  ['s-', 'story'],
  ['m-', 'michikusa'],
];

/**
 * Kind from the id prefix. Set-phrase/aizuchi vocab is `'vocab'` here
 * (`'chunk'` needs the item's tags). Throws on an unknown prefix.
 */
export function kindOfId(id: string): IdKind {
  for (const [prefix, kind] of PREFIXES) {
    if (id.startsWith(prefix)) return kind;
  }
  throw new RangeError(`kindOfId: unrecognized id "${id}"`);
}

/** `kindOfId` that returns `undefined` instead of throwing. */
export function tryKindOfId(id: string): IdKind | undefined {
  for (const [prefix, kind] of PREFIXES) {
    if (id.startsWith(prefix)) return kind;
  }
  return undefined;
}

/** `IdKind` → the content directory kind (`chunk` → `vocab`). */
export function contentKindOf(kind: IdKind): ContentKind {
  return kind === 'chunk' ? 'vocab' : kind;
}

/** Strict grammar check against `ID_PATTERNS` (optionally for one kind). */
export function isValidId(id: string, kind?: IdKind): boolean {
  const k = kind ?? tryKindOfId(id);
  if (!k) return false;
  return ID_PATTERNS[contentKindOf(k)].test(id);
}

const STATION_RE = /^(?:s|m|st)-(\d{2})(?:-\d)?$/;

/** Station number of a story, michikusa or station id; `undefined` for everything else. */
export function stationOfId(id: string): number | undefined {
  const m = STATION_RE.exec(id);
  if (!m) return undefined;
  return Number(m[1]);
}

/** `7` → `st-07`. */
export function stationId(n: number): string {
  return `st-${String(n).padStart(2, '0')}`;
}

const LEVEL_RE = /^[vg]-(n[1-5])-/;

/** Level encoded in the id: vocab/grammar `n5…n1`, kana `kana`; kanji ids carry none (read `item.jlpt`). */
export function levelOfId(id: string): Level | undefined {
  const m = LEVEL_RE.exec(id);
  if (m) return m[1] as Level;
  if (id.startsWith('k-')) return 'kana';
  return undefined;
}
