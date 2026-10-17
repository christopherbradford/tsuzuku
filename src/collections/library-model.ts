/**
 * TSUZUKU — Library read-model (group G, design 06 §6 + group notes).
 *
 * Pure functions behind `pages/LibraryPage.tsx`:
 *  - every introduced item (anything with a card) with its kind, item belt
 *    (`store/derived.itemBeltOf`), archive flag and the station that taught
 *    it (from the station bundles the loader hands back; 0 = unplaced, e.g.
 *    captured on the road);
 *  - the display surface of an item (text, reading, meaning, what to speak);
 *  - kana / romaji / meaning search;
 *  - Michikusa fragments per station with the un-collected count
 *    ("3 more at Totsuka"); stations whose bundle is missing fall back to
 *    the design's four fragments per station.
 */
import type { ContentLoader } from '../content/loader';
import { toPlain } from '../content/ruby';
import {
  STATIONS,
  type ComponentDef,
  type ContentItem,
  type Facet,
  type GrammarItem,
  type KanaItem,
  type KanjiItem,
  type MichikusaItem,
  type StationBundle,
  type StationDef,
  type VocabItem,
} from '../content/types';
import { parseCardKey, stationOfId } from '../shared/ids';
import { normalizeAnswer } from '../shared/jp';
import { romajiToKana } from '../shared/kana-ime';
import { CardFlag, hasFlag, type CardTuple, type CardsApi, type ItemBelt, type ItemKind } from '../shared/store-types';
import { itemBeltOf, kindFor } from '../store/derived';

export const MICHIKUSA_PER_STATION = 4;
export const UNPLACED = 0;

export type Facets = Partial<Record<Facet, CardTuple>>;

export interface LibraryItem {
  id: string;
  kind: ItemKind;
  belt: ItemBelt;
  /** Station that introduced it; `UNPLACED` when no bundle lists it. */
  station: number;
  archived: boolean;
  facets: Facets;
}

export interface StationGroup {
  station: number;
  def: StationDef | undefined;
  items: LibraryItem[];
}

export interface StationIndex {
  /** item id → station number, from the bundles that loaded. */
  map: Map<string, number>;
  bundles: Map<number, StationBundle>;
  /** Stations whose bundle could not be loaded (missing or offline). */
  failed: number[];
}

export const KIND_ORDER: readonly ItemKind[] = ['kana', 'vocab', 'chunk', 'kanji', 'grammar', 'component'];
export const BELT_ORDER: readonly ItemBelt[] = ['white', 'yellow', 'green', 'brown', 'black'];

export function stationDef(n: number): StationDef | undefined {
  return STATIONS.find((s) => s.number === n);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Items                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Every item that holds at least one card, with its facet cards. */
export function introducedItems(cards: CardsApi): Map<string, Facets> {
  const byItem = new Map<string, Facets>();
  cards.forEach((k, t) => {
    const { itemId, facet } = parseCardKey(k);
    let f = byItem.get(itemId);
    if (!f) {
      f = {};
      byItem.set(itemId, f);
    }
    f[facet] = t;
  });
  return byItem;
}

/** Station bundles 1..`max` (failures tolerated), indexed by item id. */
export async function stationIndex(loader: ContentLoader, max: number): Promise<StationIndex> {
  const map = new Map<string, number>();
  const bundles = new Map<number, StationBundle>();
  const failed: number[] = [];
  const top = Math.max(0, Math.min(STATIONS.length, Math.floor(max)));
  for (let n = 1; n <= top; n++) {
    try {
      const b = await loader.station(n);
      bundles.set(n, b);
      for (const id of [...b.kanaIds, ...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.componentIds]) if (!map.has(id)) map.set(id, n);
    } catch {
      failed.push(n);
    }
  }
  return { map, bundles, failed };
}

/** Introduced items placed on the road; kind from the id + facets, belt from the cards. */
export function placeItems(byItem: Map<string, Facets>, cards: CardsApi, stationOf: (id: string) => number | undefined): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const [id, facets] of byItem) {
    const kind = kindFor(id, facets);
    if (!kind) continue;
    const archived = (Object.values(facets) as (CardTuple | undefined)[]).some((t) => t !== undefined && hasFlag(t[7], CardFlag.archived));
    let station = stationOf(id);
    if (station === undefined || !Number.isFinite(station) || station < 1) station = UNPLACED;
    out.push({ id, kind, belt: itemBeltOf(id, kind, cards), station, archived, facets });
  }
  out.sort((a, b) => a.station - b.station || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Items grouped by station in road order; the unplaced group (station 0) comes last. */
export function groupByStation(items: readonly LibraryItem[]): StationGroup[] {
  const by = new Map<number, LibraryItem[]>();
  for (const it of items) {
    const list = by.get(it.station) ?? [];
    list.push(it);
    by.set(it.station, list);
  }
  const stations = Array.from(by.keys()).sort((a, b) => (a === UNPLACED ? 1 : b === UNPLACED ? -1 : a - b));
  return stations.map((station) => ({ station, def: stationDef(station), items: by.get(station) ?? [] }));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Surfaces                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Surface {
  /** What to show large (word, kana, kanji, pattern, component glyph). */
  text: string;
  /** Kana reading when it differs from `text`. */
  reading?: string;
  /** First gloss (or the grammar meaning / component name). */
  meaning: string;
  meanings: string[];
  /** TTS target: the plain surface, kana reading as a hint; null when nothing sensible can be spoken. */
  speak: { text: string; kana?: string } | null;
  /** One example sentence with ruby markup and its English, when the item has one. */
  example?: { ja: string; kana: string; en: string };
  /** True when the loader has the item in memory. */
  loaded: boolean;
}

export function isKana(it: ContentItem): it is KanaItem {
  return 'romaji' in it && 'script' in it;
}
export function isVocab(it: ContentItem): it is VocabItem {
  return 'word' in it && 'pos' in it;
}
export function isKanji(it: ContentItem): it is KanjiItem {
  return 'char' in it && 'strokes' in it;
}
export function isGrammar(it: ContentItem): it is GrammarItem {
  return 'pattern' in it && 'clozeHints' in it;
}
export function isComponent(it: ContentItem): it is ComponentDef {
  return 'char' in it && 'name' in it && !('strokes' in it);
}
export function isMichikusa(it: ContentItem): it is MichikusaItem {
  return 'bodyEn' in it && 'titleEn' in it;
}

/** The surface of an item, or an honest id-only placeholder while it loads. */
export function surfaceOf(item: ContentItem | undefined, id: string): Surface {
  if (!item) return { text: id, meaning: '', meanings: [], speak: null, loaded: false };
  if (isKana(item)) {
    return {
      text: item.kana,
      meaning: item.romaji,
      meanings: [item.romaji],
      speak: { text: item.kana, kana: item.kana },
      example: { ja: item.exampleWord.word, kana: item.exampleWord.kana, en: item.exampleWord.en },
      loaded: true,
    };
  }
  if (isVocab(item)) {
    const ex = item.examples[0];
    return {
      text: item.word,
      reading: item.kana !== item.word ? item.kana : undefined,
      meaning: item.meanings[0] ?? '',
      meanings: item.meanings,
      speak: { text: item.word, kana: item.kana },
      example: ex ? { ja: ex.ja, kana: ex.kana, en: ex.en } : undefined,
      loaded: true,
    };
  }
  if (isKanji(item)) {
    const ex = item.examples[0];
    return {
      text: item.char,
      reading: [...item.kun, ...item.on].join('・') || undefined,
      meaning: item.meanings[0] ?? '',
      meanings: item.meanings,
      speak: ex ? { text: ex.word, kana: ex.kana } : null,
      example: ex ? { ja: ex.word, kana: ex.kana, en: ex.en } : undefined,
      loaded: true,
    };
  }
  if (isGrammar(item)) {
    const ex = item.examples[0];
    return {
      text: item.pattern,
      meaning: item.meaning,
      meanings: [item.meaning],
      speak: ex ? { text: toPlain(ex.ja), kana: ex.kana } : null,
      example: ex ? { ja: ex.ja, kana: ex.kana, en: ex.en } : undefined,
      loaded: true,
    };
  }
  if (isComponent(item)) {
    return { text: item.char, meaning: item.name, meanings: [item.name, ...(item.hint ? [item.hint] : [])], speak: null, loaded: true };
  }
  return { text: id, meaning: '', meanings: [], speak: null, loaded: true };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Search and filters                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

const LATIN_RE = /^[a-z' -]+$/i;

/**
 * Kana (katakana folded, づ/ぢ ≡ ず/じ, long vowels canonical via
 * `normalizeAnswer`), romaji typed as kana, or an English substring.
 */
export function matchesQuery(s: Surface, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const lower = q.toLowerCase();
  if (s.meanings.some((m) => m.toLowerCase().includes(lower))) return true;
  const needles = new Set<string>([normalizeAnswer(q)]);
  if (LATIN_RE.test(q)) {
    const kana = romajiToKana(lower.replace(/\s+/g, ''));
    if (kana && !/[a-z]/i.test(kana)) needles.add(normalizeAnswer(kana));
  }
  const hay = [s.text, s.reading ?? ''].filter(Boolean).map(normalizeAnswer);
  for (const n of needles) if (n && hay.some((h) => h.includes(n))) return true;
  return false;
}

export interface ItemFilter {
  kind: ItemKind | '';
  belt: ItemBelt | '';
  query: string;
}

export function filterItems(items: readonly LibraryItem[], f: ItemFilter, surface: (id: string) => Surface): LibraryItem[] {
  return items.filter((it) => (f.kind === '' || it.kind === f.kind) && (f.belt === '' || it.belt === f.belt) && matchesQuery(surface(it.id), f.query));
}

export function hasActiveFilter(f: ItemFilter): boolean {
  return f.kind !== '' || f.belt !== '' || f.query.trim() !== '';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Michikusa                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MichikusaGroup {
  station: number;
  def: StationDef | undefined;
  /** Fragment ids at this station (bundle order; collected-only when the bundle is missing). */
  ids: string[];
  collected: string[];
  total: number;
  missing: number;
}

/** Stations 1..`max` with their fragments; the un-collected count comes from the bundle, else from the four-per-station rule. */
export function michikusaGroups(bundles: Map<number, StationBundle>, collectedIds: readonly string[], max: number): MichikusaGroup[] {
  const collectedBy = new Map<number, string[]>();
  let top = Math.max(1, Math.min(STATIONS.length, Math.floor(max)));
  for (const id of collectedIds) {
    const n = stationOfId(id);
    if (n === undefined || n < 1 || n > STATIONS.length) continue;
    top = Math.max(top, n);
    const list = collectedBy.get(n) ?? [];
    if (!list.includes(id)) list.push(id);
    collectedBy.set(n, list);
  }
  const out: MichikusaGroup[] = [];
  for (let n = 1; n <= top; n++) {
    const b = bundles.get(n);
    const got = collectedBy.get(n) ?? [];
    const ids = b ? b.michikusaIds.slice() : got.slice();
    for (const id of got) if (!ids.includes(id)) ids.push(id);
    const collected = ids.filter((id) => got.includes(id));
    const total = b ? Math.max(ids.length, collected.length) : Math.max(MICHIKUSA_PER_STATION, collected.length);
    out.push({ station: n, def: stationDef(n), ids, collected, total, missing: Math.max(0, total - collected.length) });
  }
  return out;
}

/** Kind label key of a michikusa fragment (for `S.kinds`). */
export function michikusaKind(it: MichikusaItem): string {
  return it.kind;
}
