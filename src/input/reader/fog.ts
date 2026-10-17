/**
 * TSUZUKU — furigana fog (design 04 §7, 05 §12).
 *
 * Furigana stays visible while a kanji's `read` card has S < 7 d (or the
 * kanji has no `read` card at all); once every kanji of a ruby base is at
 * S ≥ 7 d the reading is hidden and a tap reveals it (a hint, counted by
 * `<Ruby onReveal>`). `settings.furigana` modes:
 *
 *   always → never fogged      fog → the rule above
 *   tap    → always fogged     off → never fogged (Ruby renders plain text)
 *
 * `fogPredicate()` returns the `fog(base)` function `<Ruby>` expects.
 */
import type { CardKey } from '../../content/types';
import { KANJI_RE } from '../../content/ruby';
import { cardKey } from '../../shared/ids';
import type { CardTuple, FuriganaMode } from '../../shared/store-types';

/** Hide the reading once the kanji's `read` card has this stability (days). */
export const FOG_S = 7;

/** The one thing we need from the store: `cards.get`. */
export interface CardLookup {
  get(k: CardKey): CardTuple | undefined;
}

const KANJI_RE_G = new RegExp(KANJI_RE.source, 'g');
const ITERATION = /[々〆]/;

/** `j-<char>#read` */
export function readKey(char: string): CardKey {
  return cardKey(`j-${char}`, 'read');
}

/** The kanji's `read` card is at S ≥ 7 d (archived cards still count: S is still S). */
export function kanjiFogged(cards: CardLookup, char: string): boolean {
  const c = cards.get(readKey(char));
  return !!c && c[1] >= FOG_S;
}

/**
 * A ruby base is fogged when EVERY kanji in it is fogged. 々 / 〆 repeat the
 * preceding kanji; a base without kanji (an acronym ruby like `{NHK|えぬえいちけー}`)
 * is never fogged — its reading is the whole point.
 */
export function baseFogged(cards: CardLookup, base: string): boolean {
  const chars = base.match(KANJI_RE_G) ?? [];
  if (chars.length === 0) return false;
  let prev: string | null = null;
  for (const ch of chars) {
    const target: string | null = ITERATION.test(ch) ? prev : ch;
    if (target === null) return false;
    if (!kanjiFogged(cards, target)) return false;
    prev = target;
  }
  return true;
}

/** The `fog(base) → hide` predicate for `<Ruby mode={mode} fog={…}>`. */
export function fogPredicate(cards: CardLookup, mode: FuriganaMode): (base: string) => boolean {
  switch (mode) {
    case 'always':
    case 'off':
      return () => false;
    case 'tap':
      return () => true;
    case 'fog':
    default: {
      const memo = new Map<string, boolean>();
      return (base) => {
        const hit = memo.get(base);
        if (hit !== undefined) return hit;
        const v = baseFogged(cards, base);
        memo.set(base, v);
        return v;
      };
    }
  }
}

/** Kanji in `text` whose reading would be hidden (Records / debug: "N of M kanji fogged"). */
export function foggedKanji(cards: CardLookup, text: string): { fogged: string[]; shown: string[] } {
  const fogged: string[] = [];
  const shown: string[] = [];
  for (const ch of new Set(text.match(KANJI_RE_G) ?? [])) {
    if (ITERATION.test(ch)) continue;
    (kanjiFogged(cards, ch) ? fogged : shown).push(ch);
  }
  return { fogged, shown };
}
