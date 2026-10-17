/**
 * TSUZUKU — item belts (design 02 §4, exactly that table).
 *
 *  | Kind            | Base facet | Production facet |
 *  | vocab           | rec        | prod             |
 *  | chunk           | prod       | prod (both)      |
 *  | kana            | rec        | prod             |
 *  | component       | rec        | — (never Brown)  |
 *  | kanji           | comp       | read             |
 *  | grammar         | cloze      | prod             |
 *
 *  White  introduced (base card exists, or nothing yet)
 *  Yellow base S ≥ 1 d
 *  Green  base S ≥ 7 d                       ("Known": coverage + belt eligibility)
 *  Brown  base S ≥ 30 d AND production S ≥ 7 d ("Mastered": production exists)
 *  Black  Brown AND every unlocked facet S ≥ 120 d (Kotodama flame, Kaiden lane)
 *
 * Archived cards still count (archive is a flag; S is still S).
 */
import type { CardTuple, ItemBelt, ItemKind } from '../shared/store-types';
import type { Facet } from '../content/types';

export const BELT_ORDER: readonly ItemBelt[] = ['white', 'yellow', 'green', 'brown', 'black'];

export const BELT_THRESHOLDS = {
  yellow: 1,
  green: 7,
  brownBase: 30,
  brownProd: 7,
  black: 120,
} as const;

export function baseFacet(kind: ItemKind): Facet {
  switch (kind) {
    case 'kanji':
      return 'comp';
    case 'grammar':
      return 'cloze';
    case 'chunk':
      return 'prod';
    case 'vocab':
    case 'kana':
    case 'component':
      return 'rec';
  }
}

export function productionFacet(kind: ItemKind): Facet | null {
  switch (kind) {
    case 'kanji':
      return 'read';
    case 'component':
      return null;
    case 'vocab':
    case 'kana':
    case 'chunk':
    case 'grammar':
      return 'prod';
  }
}

/** 0 white … 4 black. */
export function beltRank(b: ItemBelt): number {
  return BELT_ORDER.indexOf(b);
}

/** `a` is at least `b` on the belt ladder. */
export function beltAtLeast(a: ItemBelt, b: ItemBelt): boolean {
  return beltRank(a) >= beltRank(b);
}

function stabilityOf(card: CardTuple | undefined): number {
  return card ? card[1] : 0;
}

export function itemBelt(kind: ItemKind, cards: Partial<Record<Facet, CardTuple>>): ItemBelt {
  const base = cards[baseFacet(kind)];
  if (!base) return 'white';
  const baseS = stabilityOf(base);
  if (baseS < BELT_THRESHOLDS.yellow) return 'white';
  if (baseS < BELT_THRESHOLDS.green) return 'yellow';
  const prodFacet = productionFacet(kind);
  if (prodFacet === null) return 'green';
  const prod = cards[prodFacet];
  if (!prod || baseS < BELT_THRESHOLDS.brownBase || stabilityOf(prod) < BELT_THRESHOLDS.brownProd) return 'green';
  for (const facet of Object.keys(cards) as Facet[]) {
    const c = cards[facet];
    if (c && stabilityOf(c) < BELT_THRESHOLDS.black) return 'brown';
  }
  return 'black';
}

/** The promotion `from → to` if `after` outranks `before`, else null (demotions are never announced). */
export function beltPromotion(before: ItemBelt, after: ItemBelt): { from: ItemBelt; to: ItemBelt } | null {
  return beltRank(after) > beltRank(before) ? { from: before, to: after } : null;
}
