/**
 * TSUZUKU — distractor selection (design 04 §1–§4), pure and seeded.
 *
 * Every picker takes an injected `rng`, never returns the answer twice
 * (meaning pickers exclude every accepted meaning of the target, not only
 * `meanings[0]`), never returns duplicates, and degrades gracefully on a small pool
 * (tiered preference lists, then built-in fallbacks) so the UI always gets
 * a full set of choices.
 */
import type { GrammarItem, KanaItem, KanjiItem, SentenceExample, StoryLine, VocabItem } from '../content/types';
import { toPlain } from '../content/ruby';
import { shuffle, type Rng } from '../shared/hash';
import { levenshtein, moraSplit, normalizeAnswer, normalizeEn, normalizeJa, toHiragana } from '../shared/jp';

/** Particle keys of Particle Duel (design 04 §4). */
export const PARTICLES: readonly string[] = ['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の'];

/** Padding glosses used only when a pool is too small to fill four meaning choices. */
export const FALLBACK_GLOSSES: readonly string[] = ['(none of the others)', '(a different word)', '(something else)'];

/** Padding tiles for cloze choices when a grammar pool is tiny. */
export const FALLBACK_TILES: readonly string[] = ['て', 'た', 'ない', 'ます', 'から', 'ので', 'でも', 'たい', 'ている', 'ば'];

const HIRAGANA_46 = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const KATAKANA_46 = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

/* ────────────────────────────────────────────────────────────────────────── */
/* Generic tiered filling                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Fills `n` picks from preference tiers in order; each tier is shuffled with
 * `rng`, candidates whose `key` equals the answer's or an earlier pick's are
 * dropped. Returns fewer than `n` only when every tier is exhausted.
 */
export function fillTiers<T>(rng: Rng, tiers: readonly (readonly T[])[], n: number, key: (t: T) => string, taken: Iterable<string>): T[] {
  const seen = new Set<string>(taken);
  const out: T[] = [];
  for (const tier of tiers) {
    if (out.length >= n) break;
    for (const c of shuffle(rng, tier)) {
      if (out.length >= n) break;
      const k = key(c);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kana similarity                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/** Mora-level edit distance on hiragana-folded, punctuation-free kana. */
export function kanaDistance(a: string, b: string): number {
  return levenshtein(moraSplit(normalizeJa(a, { foldKatakana: true })), moraSplit(normalizeJa(b, { foldKatakana: true })));
}

const VOICING: Record<string, string> = {};
{
  const pairs = ['かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ', 'ただ', 'ちぢ', 'つづ', 'てで', 'とど', 'はば', 'ひび', 'ふぶ', 'へべ', 'ほぼ'];
  for (const p of pairs) {
    VOICING[p[0] as string] = p[1] as string;
    VOICING[p[1] as string] = p[0] as string;
  }
}
const VOWEL_OF: Record<string, string> = {};
{
  const rows: [string, string][] = [
    ['あかさたなはまやらわがざだばぱ', 'あ'],
    ['いきしちにひみりぎじぢびぴ', 'い'],
    ['うくすつぬふむゆるぐずづぶぷ', 'う'],
    ['えけせてねへめれげぜでべぺ', 'え'],
    ['おこそとのほもよろをごぞどぼぽ', 'お'],
  ];
  for (const [chars, v] of rows) for (const ch of chars) VOWEL_OF[ch] = v;
}

/**
 * Synthesizes a minimal pair for `kana` when no corpus neighbour exists:
 * toggles a small っ, a long vowel, or voicing on the first eligible mora.
 * Always differs from the input.
 */
export function synthesizeMinimalPair(kana: string): string {
  const k = toHiragana(kana);
  const morae = moraSplit(k);
  // 1. small っ: remove if present, else insert before the second mora.
  const sokuon = morae.indexOf('っ');
  if (sokuon >= 0) return morae.filter((_, i) => i !== sokuon).join('');
  if (morae.length >= 2) return [morae[0], 'っ', ...morae.slice(1)].join('');
  // 2. long vowel on a single mora: add or drop.
  const first = morae[0] ?? k;
  const base = first[0] as string;
  const v = VOWEL_OF[base];
  if (first.length === 1 && v) return first + v;
  // 3. voicing toggle.
  if (VOICING[base]) return VOICING[base] + first.slice(1);
  return k + 'ー';
}

/**
 * Nearest minimal-pair partner from `pool` (mora distance 1 preferred, then 2),
 * or a synthesized one. Returns `[word.kana, partnerKana]`.
 */
export function minimalPairPartner(word: Pick<VocabItem, 'id' | 'kana'>, pool: readonly Pick<VocabItem, 'id' | 'kana'>[]): [string, string] {
  let best: { kana: string; d: number } | null = null;
  const target = normalizeAnswer(word.kana);
  for (const p of pool) {
    if (p.id === word.id || normalizeAnswer(p.kana) === target) continue;
    const d = kanaDistance(word.kana, p.kana);
    if (d === 0 || d > 2) continue;
    if (!best || d < best.d || (d === best.d && p.kana < best.kana)) best = { kana: p.kana, d };
  }
  return [word.kana, best ? best.kana : synthesizeMinimalPair(word.kana)];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Meaning choices                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function gloss(v: VocabItem): string {
  return v.meanings[0] ?? '';
}

/** Normalized keys of every meaning of an item (empty keys dropped). */
export function meaningKeys(item: { meanings: readonly string[] }): Set<string> {
  const out = new Set<string>();
  for (const m of item.meanings) {
    const k = normalizeEn(m);
    if (k) out.add(k);
  }
  return out;
}

/** True when any meaning of `candidate` normalizes to any meaning of the target (`targetKeys`). */
export function sharesMeaning(candidate: { meanings: readonly string[] }, targetKeys: ReadonlySet<string>): boolean {
  return candidate.meanings.some((m) => targetKeys.has(normalizeEn(m)));
}

/**
 * Three meaning distractors for `target` in preference order: one confusable
 * (or the nearest kana neighbour as a minimal-pair distractor), then same
 * POS + same station, same POS, same level, anything. Never the answer,
 * never duplicates (compared through `normalizeEn`). A candidate is excluded
 * when ANY of its meanings matches ANY of the target's meanings, so a
 * secondary gloss of the target (風情: taste | charm) never shows up as a
 * "wrong" option, and a word whose secondary gloss is the target's primary
 * one is skipped too.
 */
export function meaningDistractors(target: VocabItem, pool: readonly VocabItem[], rng: Rng, n = 3): string[] {
  const targetKeys = meaningKeys(target);
  const answerKey = normalizeEn(gloss(target));
  const others = pool.filter((v) => v.id !== target.id && gloss(v).length > 0 && !sharesMeaning(v, targetKeys));
  const byId = new Map(others.map((v) => [v.id, v] as const));
  const key = (v: VocabItem) => normalizeEn(gloss(v));

  const confusables = (target.confusables ?? []).map((id) => byId.get(id)).filter((v): v is VocabItem => !!v);
  const nearKana = confusables.length
    ? []
    : others.filter((v) => kanaDistance(v.kana, target.kana) === 1);
  const taken = [...targetKeys, answerKey];
  const first = fillTiers(rng, [confusables, nearKana], 1, key, taken);

  const samePosStation = others.filter((v) => v.pos === target.pos && target.station !== undefined && v.station === target.station);
  const samePos = others.filter((v) => v.pos === target.pos);
  const sameLevel = others.filter((v) => v.jlpt === target.jlpt);
  const rest = fillTiers(rng, [samePosStation, samePos, sameLevel, others], n - first.length, key, [...taken, ...first.map(key)]);

  const picked = [...first, ...rest].map(gloss);
  if (picked.length < n) {
    const have = new Set([...taken, ...picked.map(normalizeEn)]);
    for (const f of FALLBACK_GLOSSES) {
      if (picked.length >= n) break;
      if (!have.has(normalizeEn(f))) picked.push(f);
    }
  }
  return picked.slice(0, n);
}

/** Four shuffled meaning choices containing `target.meanings[0]` (design 04 §2 meaning-guard / audio-flash). */
export function meaningChoices(target: VocabItem, pool: VocabItem[], rng: Rng): string[] {
  return shuffle(rng, [gloss(target), ...meaningDistractors(target, pool, rng, 3)]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kana grid                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 3×3 Kana Ear grid: nine distinct cells containing `target.kana`, filled from
 * `lookalikes`, then the same row, same script + type, same script, any kana,
 * and finally the built-in gojūon of the target's script.
 */
export function kanaGrid(target: KanaItem, all: KanaItem[], rng: Rng): string[] {
  const others = all.filter((k) => k.id !== target.id && k.kana !== target.kana);
  const byId = new Map(others.map((k) => [k.id, k] as const));
  const key = (k: KanaItem) => k.kana;
  const lookalikes = (target.lookalikes ?? []).map((id) => byId.get(id)).filter((k): k is KanaItem => !!k);
  const sameRow = others.filter((k) => k.script === target.script && k.row === target.row);
  const sameType = others.filter((k) => k.script === target.script && k.type === target.type);
  const sameScript = others.filter((k) => k.script === target.script);
  const picked = fillTiers(rng, [lookalikes, sameRow, sameType, sameScript, others], 8, key, [target.kana]).map(key);
  if (picked.length < 8) {
    const alphabet = target.script === 'katakana' ? KATAKANA_46 : HIRAGANA_46;
    const have = new Set([target.kana, ...picked]);
    for (const ch of shuffle(rng, Array.from(alphabet))) {
      if (picked.length >= 8) break;
      if (!have.has(ch)) {
        have.add(ch);
        picked.push(ch);
      }
    }
  }
  return shuffle(rng, [target.kana, ...picked.slice(0, 8)]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kanji look-alikes                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function charOfKanjiId(id: string): string {
  return id.startsWith('j-') ? id.slice(2) : id;
}

/**
 * 2–4 shuffled kanji characters for Lookalike Duel containing `target.char`:
 * declared `lookalikes` (resolved from the id itself, so no pool is needed),
 * then pool kanji sharing a component, ±1 stroke, same JLPT, anything.
 */
export function kanjiLookalikes(target: KanjiItem, pool: KanjiItem[], rng: Rng, n = 4): string[] {
  const want = Math.max(1, n - 1);
  const others = pool.filter((k) => k.id !== target.id && k.char !== target.char);
  const declared = (target.lookalikes ?? []).map(charOfKanjiId).filter((c) => c.length > 0 && c !== target.char);
  const comps = new Set(target.components);
  const shareComp = others.filter((k) => k.components.some((c) => comps.has(c))).map((k) => k.char);
  const strokes = others.filter((k) => Math.abs(k.strokes - target.strokes) <= 1).map((k) => k.char);
  const sameLevel = others.filter((k) => k.jlpt === target.jlpt).map((k) => k.char);
  const any = others.map((k) => k.char);
  const picked = fillTiers(rng, [declared, shareComp, strokes, sameLevel, any], want, (c) => c, [target.char]);
  return shuffle(rng, [target.char, ...picked]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Cloze tiles                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Four shuffled cloze tiles containing `answer` (default `target.clozeHints[0]`):
 * distractors from `related` points' hints, then same-level hints, any hint,
 * then `FALLBACK_TILES`. Compared through `normalizeAnswer`.
 */
export function clozeTiles(target: GrammarItem, pool: GrammarItem[], rng: Rng, answer?: string): string[] {
  const ans = answer ?? target.clozeHints[0] ?? target.pattern;
  const ansKey = normalizeAnswer(ans);
  const others = pool.filter((g) => g.id !== target.id);
  const byId = new Map(others.map((g) => [g.id, g] as const));
  const hintsOf = (gs: readonly GrammarItem[]) => gs.flatMap((g) => g.clozeHints);
  const related = hintsOf(target.related.map((id) => byId.get(id)).filter((g): g is GrammarItem => !!g));
  const sameLevel = hintsOf(others.filter((g) => g.jlpt === target.jlpt));
  const any = hintsOf(others);
  const ownOthers = target.clozeHints.filter((h) => normalizeAnswer(h) !== ansKey);
  const picked = fillTiers(rng, [related, sameLevel, any, ownOthers, FALLBACK_TILES], 3, normalizeAnswer, [ansKey]);
  return shuffle(rng, [ans, ...picked]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Particle options                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/** `n` shuffled particle options containing `answer` (Particle Duel keys). */
export function particleOptions(answer: string, rng: Rng, n = 4): string[] {
  const picked = fillTiers(rng, [PARTICLES], Math.max(0, n - 1), (p) => p, [answer]);
  return shuffle(rng, [answer, ...picked]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scramble tiles                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function isPunctuation(t: string): boolean {
  return normalizeJa(t).length === 0;
}

/**
 * Shuffled bunsetsu tiles for Scramble. `tokens` are the tiles (falls back to
 * `line.tokens` for a StoryLine, or a single tile of the plain sentence);
 * trailing punctuation stays in place; the shuffled order is never the
 * original order when at least two tiles move.
 */
export function scrambleTiles(line: StoryLine | SentenceExample, tokens: string[], rng: Rng): string[] {
  const src = tokens.length > 0 ? tokens : 'tokens' in line && line.tokens.length > 0 ? line.tokens : [toPlain(line.ja)];
  let end = src.length;
  while (end > 0 && isPunctuation(src[end - 1] as string)) end--;
  const movable = src.slice(0, end);
  const tail = src.slice(end);
  const distinct = new Set(movable).size;
  if (distinct < 2) return movable.concat(tail);
  let out = shuffle(rng, movable);
  for (let tries = 0; tries < 8 && out.every((t, i) => t === movable[i]); tries++) out = shuffle(rng, movable);
  if (out.every((t, i) => t === movable[i])) out = [...movable.slice(1), movable[0] as string];
  return out.concat(tail);
}
