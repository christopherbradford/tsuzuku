/**
 * TSUZUKU — bunsetsu tiles and particle tables (design 04 §4 Scramble, Particle Duel).
 *
 * `splitBunsetsu` cuts a plain sentence into bunsetsu-ish tiles when no linked
 * story line carries tokens; the particle tables it and Particle Duel share
 * live here. Split out of `params.ts` (which re-exports everything) so each
 * file stays readable.
 */
import { isHiragana } from '../shared/jp';
import type { ContentItem, GrammarItem } from '../content/types';

function isGrammarItem(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}

/** Particle Duel keys (design 04 §4; `learn/distractors.PARTICLES` is not in the barrel). */
export const PARTICLES: readonly string[] = ['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の'];
/** Particles that close a Scramble tile: the Duel keys plus も (never a Duel choice, but a bunsetsu boundary all the same). */
export const CUT_PARTICLES: readonly string[] = [...PARTICLES, 'も'];
/**
 * Hiragana words that begin a bunsetsu after a particle (demonstratives,
 * adverbs, existence verbs): a particle followed by one of these is a tile
 * boundary even though hiragana continues (ケンさんも|どこ, 音楽を|よく).
 */
export const BUNSETSU_STARTERS: readonly string[] = ['ここ', 'そこ', 'あそこ', 'どこ', 'どちら', 'どう', 'どんな', 'いつ', 'もう', 'まだ', 'あまり', 'とても', 'たぶん', 'よく', 'ゆっくり', 'そのまま', 'たくさん', 'しっかり', 'いる', 'いない', 'ある', 'ない'];
/** Particle Duel is scheduled from this station (design 04 §4 introduction table). */
export const PARTICLE_DUEL_FROM = 5;

/** The particle cloze hints of a grammar point (what Particle Duel blanks); empty for a non-particle point. */
export function particleHints(item: GrammarItem): string[] {
  return item.clozeHints.filter((h) => PARTICLES.includes(h));
}
export function hasParticleHint(item: ContentItem | null | undefined): boolean {
  return isGrammarItem(item) && particleHints(item).length > 0;
}

/**
 * Character runs a particle may not split: copula / auxiliary continuations
 * (です・でした・でしょう・ので・のに・こと・もの・とても・という…). `splitBunsetsu`
 * treats a match here as word-internal, so 「元気です」 never yields a lone 「す」.
 */
export const PARTICLE_ATOMS: readonly string[] = ['です', 'でした', 'でしょう', 'でき', 'ではな', 'ではあ', 'ので', 'のに', 'のだ', 'のです', 'こと', 'もの', 'とても', 'という', 'として', 'とう', 'とか', 'について', 'ところ'];
/** Compound particles that stay on one tile with their word (私には・それでは・食べるのが). */
export const COMPOUND_PARTICLES: readonly string[] = ['では', 'には', 'とは', 'へは', 'のは', 'のが', 'のを', 'からは', 'までは'];

/**
 * Bunsetsu-ish tiles for Scramble when no linked story line carries tokens:
 * a particle closes the tile it follows (particles attach to their word), a
 * punctuation mark is its own tile, and a `PARTICLE_ATOMS` run (です・ので・こと…)
 * is word-internal, never a boundary. A particle cuts only when what follows
 * is not hiragana (kanji, katakana, punctuation or the end) or is a
 * `BUNSETSU_STARTERS` word (どこ, よく, いつ…): any other hiragana
 * continuation means the match sits inside a word (ありが|とう, なが|ら, と|き,
 * べから|ず), and an under-split tile is still Japanese while a non-word tile
 * is not. Exported for tests.
 */
export function splitBunsetsu(plain: string): string[] {
  const particles = [...CUT_PARTICLES, ...COMPOUND_PARTICLES].sort((a, b) => b.length - a.length);
  const atoms = PARTICLE_ATOMS.slice().sort((a, b) => b.length - a.length);
  const tiles: string[] = [];
  let cur = '';
  let i = 0;
  const continues = (at: number): boolean => {
    const next = plain[at];
    return next !== undefined && isHiragana(next) && !BUNSETSU_STARTERS.some((w) => plain.startsWith(w, at));
  };
  while (i < plain.length) {
    const ch = plain[i] as string;
    if ('、。！？'.includes(ch)) {
      if (cur) tiles.push(cur);
      tiles.push(ch);
      cur = '';
      i++;
      continue;
    }
    const atom = atoms.find((x) => plain.startsWith(x, i));
    if (atom) {
      cur += atom;
      i += atom.length;
      continue;
    }
    const p = particles.find((x) => plain.startsWith(x, i) && cur.length > 0 && !continues(i + x.length));
    if (p) {
      tiles.push(cur + p);
      cur = '';
      i += p.length;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur) tiles.push(cur);
  return tiles;
}

/** Distinct non-punctuation tiles: a Scramble with fewer than 2 is a no-op (`scrambleTiles` returns them in order). */
export function movableTiles(tiles: readonly string[]): number {
  return new Set(tiles.filter((t) => !/^[、。！？]$/.test(t))).size;
}

