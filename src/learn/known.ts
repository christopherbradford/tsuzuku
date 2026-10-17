/**
 * TSUZUKU — the known set for coverage math (design 05 §2 "Definitions").
 *
 * Known = the item's base facet (`item-belt.baseFacet`: `rec`, or `comp` for
 * kanji / `cloze` for grammar / `prod` for chunks) has retrievability ≥ 0.85
 * today. Archived cards still count. Items without a base-facet card (e.g. a
 * vocab item holding only a `listen` card) are not known.
 *
 * `knownSet` walks every card once; `createKnownSetCache` memoises it on
 * `cards.version` + `today` for the reader's live coverage checks.
 */
import type { CardKey, Facet } from '../content/types';
import type { CardTuple, CardsApi, EpochDay, ItemKind } from '../shared/store-types';
import { parseCardKey, tryKindOfId } from '../shared/ids';
import { cardRetrievability } from './fsrs';
import { baseFacet } from './item-belt';

export const KNOWN_R = 0.85;

export function isKnown(cards: Partial<Record<Facet, CardTuple>>, kind: ItemKind, today: EpochDay): boolean {
  const base = cards[baseFacet(kind)];
  if (!base) return false;
  return cardRetrievability(base, today) >= KNOWN_R;
}

/**
 * Item kind from an id and the facets its cards cover. A vocab id with a `prod`
 * card and no `rec` card is a chunk (set phrase / aizuchi). Non-item ids
 * (stories, stations…) return `undefined`.
 */
export function kindOfCards(itemId: string, facets: Iterable<Facet>): ItemKind | undefined {
  const k = tryKindOfId(itemId);
  if (k === undefined) return undefined;
  if (k === 'story' || k === 'michikusa' || k === 'conjugation' || k === 'station') return undefined;
  if (k === 'vocab') {
    let rec = false;
    let prod = false;
    for (const f of facets) {
      if (f === 'rec') rec = true;
      if (f === 'prod') prod = true;
    }
    if (!rec && prod) return 'chunk';
  }
  return k;
}

export interface CardWalker {
  forEach(fn: (k: CardKey, t: CardTuple) => void): void;
}

/** Groups a card walk by item: `itemId → facet → card`. */
export function groupByItem(all: CardWalker): Map<string, Partial<Record<Facet, CardTuple>>> {
  const byItem = new Map<string, Partial<Record<Facet, CardTuple>>>();
  all.forEach((k, t) => {
    const { itemId, facet } = parseCardKey(k);
    let entry = byItem.get(itemId);
    if (!entry) {
      entry = {};
      byItem.set(itemId, entry);
    }
    entry[facet] = t;
  });
  return byItem;
}

/**
 * Item ids whose base facet has R ≥ 0.85 on `today`. The base facet follows
 * the item kind: a vocab id holding a `prod` card and no `rec` card is a
 * chunk (set phrase / aizuchi), whose base facet IS `prod`, so it is known
 * through production; a vocab id holding only `listen`/`pitch` has no base
 * facet and is not known. `store/derived.ts` codes against this.
 */
export function knownSet(all: CardWalker, today: EpochDay): Set<string> {
  const out = new Set<string>();
  for (const [itemId, facets] of groupByItem(all)) {
    const kind = kindOfCards(itemId, Object.keys(facets) as Facet[]);
    if (!kind) continue;
    if (isKnown(facets, kind, today)) out.add(itemId);
  }
  return out;
}

/**
 * Memoised `knownSet` keyed on `cards.version.value` and `today`; the returned
 * set is shared, so callers must not mutate it.
 */
export function createKnownSetCache(): (cards: CardsApi, today: EpochDay) => Set<string> {
  let version = -1;
  let day: EpochDay = Number.NaN;
  let cached: Set<string> = new Set();
  return (cards, today) => {
    const v = cards.version.value;
    if (v !== version || today !== day) {
      cached = knownSet(cards, today);
      version = v;
      day = today;
    }
    return cached;
  };
}
