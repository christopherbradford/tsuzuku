/**
 * TSUZUKU — speaking scores (design 04 §6 Shadow Strike, 05 §4).
 *
 * The recognizer emits kanji-kana mixed text, so a transcript is compared
 * with the target three ways and the best wins:
 *   plain   `toPlain(ja)` (毎朝コーヒーを飲みます)
 *   kana    the kana field (まいあさコーヒーをのみます)
 *   mixed   a lattice where EVERY ruby may match its base OR its reading —
 *           one DP pass (`rubyMixedDistance`), so 毎朝コーヒーをのみます scores
 *           as well as either pure surface.
 * Distance is mora Levenshtein over katakana-folded, punctuation-free text
 * (`shared/jp moraSplit`); similarity = 1 − d / max(|hyp|, |target|). The
 * lattice normalises by the plain length (the shortest variant), so it never
 * inflates a score. Best of ≤ 5 alternatives.
 *
 * Bands (SHADOW_BANDS): ≥ 0.80 Good · 0.60–0.79 Hard ("Blocked") · < 0.60 Again.
 * Fallback checklist (mora count, long vowels, pitch shape) → a self rating
 * the perception Judge samples. Implicit grades: content words' `prod` cards
 * due within 3 days (Good / Again only — a Hard shadow writes nothing).
 */
import type { CardKey, ContentItem, StoryLine, VocabItem } from '../../content/types';
import { parseRuby, toPlain } from '../../content/ruby';
import { cardKey, isValidId, tryKindOfId } from '../../shared/ids';
import { moraCount, moraSimilarity, moraSplit, normalizeJa } from '../../shared/jp';
import type { CardsApi, EpochDay, Rating } from '../../shared/store-types';

/** Implicit shadow grades apply to cards due within this many days (design 05 §4). */
export const IMPLICIT_WINDOW_DAYS = 3;

/**
 * Shadow bands (design 04 §6): ≥ 0.80 Good, 0.60–0.79 Hard, else Again.
 * Mirrors `learn/grading.ts SHADOW_BANDS`, which the `@/learn` barrel does not
 * re-export yet (requested); `grade()` applies the same numbers to `score`.
 */
export const SHADOW_BANDS: Readonly<{ good: number; hard: number }> = { good: 0.8, hard: 0.6 };

/* ────────────────────────────────────────────────────────────────────────── */
/* Normalisation                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/** Recognizer text → comparable morae: NFKC, punctuation/space-free, katakana→hiragana, ぢ/づ folded. */
export function toMorae(text: string): string[] {
  const n = normalizeJa(text, { foldKatakana: true }).replace(/ぢ/g, 'じ').replace(/づ/g, 'ず');
  return moraSplit(n);
}

function levMorae(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] as number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ruby lattice DP                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

type Unit = { kind: 'fixed'; mora: string } | { kind: 'ruby'; base: string[]; reading: string[] };

/** Target units: fixed morae for plain text, a two-way choice per ruby. */
export function latticeUnits(ja: string): Unit[] {
  const units: Unit[] = [];
  for (const seg of parseRuby(ja)) {
    if (seg.reading === null) {
      for (const m of toMorae(seg.base)) units.push({ kind: 'fixed', mora: m });
    } else {
      const base = toMorae(seg.base);
      const reading = toMorae(seg.reading);
      if (base.length === 0 && reading.length === 0) continue;
      units.push({ kind: 'ruby', base, reading });
    }
  }
  return units;
}

/** Advance a Levenshtein row by one target mora. */
function step(row: readonly number[], hyp: readonly string[], mora: string): number[] {
  const next = new Array<number>(hyp.length + 1);
  next[0] = (row[0] as number) + 1;
  for (let j = 1; j <= hyp.length; j++) {
    const cost = hyp[j - 1] === mora ? 0 : 1;
    next[j] = Math.min((row[j] as number) + 1, (next[j - 1] as number) + 1, (row[j - 1] as number) + cost);
  }
  return next;
}

function stepAll(row: readonly number[], hyp: readonly string[], morae: readonly string[]): number[] {
  let r = row.slice();
  for (const m of morae) r = step(r, hyp, m);
  return r;
}

/**
 * Edit distance between a hypothesis and the ruby lattice of `ja`: each ruby
 * may be read as its kanji base or its kana reading, independently. Exact
 * (min over all 2^rubies variants) in one pass.
 */
export function rubyMixedDistance(hyp: string, ja: string): number {
  const h = toMorae(hyp);
  let row: number[] = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (const u of latticeUnits(ja)) {
    if (u.kind === 'fixed') {
      row = step(row, h, u.mora);
    } else {
      const a = stepAll(row, h, u.base);
      const b = stepAll(row, h, u.reading);
      row = a.map((v, j) => Math.min(v, b[j] as number));
    }
  }
  return row[h.length] as number;
}

/** Lattice similarity, normalised by the plain (shortest) target length so it never inflates. */
export function rubyMixedSimilarity(hyp: string, ja: string): number {
  const h = toMorae(hyp);
  const plainLen = toMorae(toPlain(ja)).length;
  const n = Math.max(h.length, plainLen);
  if (n === 0) return 1;
  return Math.max(0, 1 - rubyMixedDistance(hyp, ja) / n);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scoring                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export type ScoreVariant = 'plain' | 'kana' | 'mixed';

export interface RecognitionScore {
  /** 0–1. */
  score: number;
  /** The alternative that scored best (as the recognizer emitted it); '' when none. */
  best: string;
  /** Which comparison won. */
  variant: ScoreVariant;
  /** Score of every alternative, in order. */
  scores: number[];
}

/** Similarity of one transcript with the target: max of plain, kana and ruby-mixed. */
export function similarity(hyp: string, target: { ja: string; kana: string }): { score: number; variant: ScoreVariant } {
  const plain = toPlain(target.ja);
  const candidates: [number, ScoreVariant][] = [
    [moraSimilarity(hyp, plain), 'plain'],
    [target.kana ? moraSimilarity(hyp, target.kana) : 0, 'kana'],
    [rubyMixedSimilarity(hyp, target.ja), 'mixed'],
  ];
  let best: [number, ScoreVariant] = candidates[0] as [number, ScoreVariant];
  for (const c of candidates) if (c[0] > best[0] + 1e-12) best = c;
  return { score: Math.max(0, Math.min(1, best[0])), variant: best[1] };
}

/** Best of ≤ 5 alternatives against the target line. Empty input → score 0. */
export function scoreRecognition(alternatives: readonly string[], target: { ja: string; kana: string }): RecognitionScore {
  const alts = alternatives.slice(0, 5);
  if (alts.length === 0) return { score: 0, best: '', variant: 'plain', scores: [] };
  let out: RecognitionScore = { score: -1, best: '', variant: 'plain', scores: [] };
  for (const alt of alts) {
    const s = similarity(alt, target);
    out.scores.push(s.score);
    if (s.score > out.score) out = { ...out, score: s.score, best: alt, variant: s.variant };
  }
  return out;
}

/** SHADOW_BANDS: ≥ 0.80 Good (3), ≥ 0.60 Hard (2), else Again (1). */
export function bandFor(score: number): Rating {
  if (score >= SHADOW_BANDS.good) return 3;
  if (score >= SHADOW_BANDS.hard) return 2;
  return 1;
}

/** Implicit grade a shadow score may write: Good / Again only; a Blocked (Hard) line writes nothing. */
export function implicitRatingFor(score: number): Rating | null {
  const r = bandFor(score);
  return r === 2 ? null : r;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Fallback checklist (MediaRecorder path)                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Checklist {
  mora: boolean;
  longVowels: boolean;
  pitch: boolean;
}

/** 3/3 Good · 2/3 Hard · ≤ 1 Again. */
export function checklistToRating(c: Checklist): Rating {
  const n = Number(c.mora) + Number(c.longVowels) + Number(c.pitch);
  if (n === 3) return 3;
  if (n === 2) return 2;
  return 1;
}

export type PitchShape = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';

/** Accent type from the nucleus (0 = 平板, 1 = 頭高, n = 尾高, else 中高); `null` without data. */
export function pitchShape(pitch: number | undefined, morae: number): PitchShape | null {
  if (pitch === undefined || !Number.isFinite(pitch) || pitch < 0 || morae <= 0) return null;
  if (pitch === 0) return 'heiban';
  if (pitch === 1) return 'atamadaka';
  if (pitch >= morae) return 'odaka';
  return 'nakadaka';
}

export interface ChecklistHints {
  /** Mora count of the kana line. */
  morae: number;
  /** Long-vowel morae (ー, or a vowel that lengthens the previous mora), as kana snippets. */
  longVowels: string[];
  pitch: PitchShape | null;
}

const LONG_RE = /([あかさたなはまやらわがざだばぱゃぁ]あ|[いきしちにひみりぎじぢびぴぃ]い|[うくすつぬふむゆるぐずづぶぷゅぅ]う|[えけせてねへめれげぜでべぺぇ][いえ]|[おこそとのほもよろをごぞどぼぽょぉ][うお]|[ぁ-ゖ]ー)/g;

/** What the Recorder shows next to the three checkboxes. */
export function checklistHints(kana: string, pitch?: number): ChecklistHints {
  const folded = normalizeJa(kana, { foldKatakana: true });
  const morae = moraCount(folded);
  const longVowels = folded.match(LONG_RE) ?? [];
  return { morae, longVowels, pitch: pitchShape(pitch, morae) };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Implicit grades on content words                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/** POS that never carry a `prod` grade from a shadow line (function words). */
const FUNCTION_POS: ReadonlySet<string> = new Set(['prt', 'aux', 'conj', 'pref', 'suf']);

function isVocab(i: ContentItem | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i;
}

/**
 * `{cardKey, rating}` for every content word of the line whose `prod` card
 * exists and is due within 3 days. `tokens` are item ids (a line's
 * `tokenIds`, nulls dropped) — surfaces without ids are skipped, since no
 * surface → id lookup exists without a loader; pass `surfaces` to map them.
 */
export function implicitProdGrades(
  tokens: readonly (string | null | undefined)[],
  get: (id: string) => ContentItem | undefined,
  cards: Pick<CardsApi, 'get'>,
  today: EpochDay,
  rating: Rating,
  surfaces?: Readonly<Record<string, string>>,
): { cardKey: CardKey; rating: Rating }[] {
  const out: { cardKey: CardKey; rating: Rating }[] = [];
  const seen = new Set<CardKey>();
  for (const t of tokens) {
    if (!t) continue;
    const id = tryKindOfId(t) !== undefined && isValidId(t) ? t : surfaces?.[t];
    if (!id) continue;
    const kind = tryKindOfId(id);
    if (kind !== 'vocab') continue;
    const item = get(id);
    if (!isVocab(item) || FUNCTION_POS.has(item.pos)) continue;
    const key = cardKey(id, 'prod');
    if (seen.has(key)) continue;
    const card = cards.get(key);
    if (!card) continue;
    if (card[0] > today + IMPLICIT_WINDOW_DAYS) continue;
    seen.add(key);
    out.push({ cardKey: key, rating });
  }
  return out;
}

/** Convenience: the implicit grades for a story line at a given score (Good / Again only). */
export function implicitGradesForLine(
  line: Pick<StoryLine, 'tokenIds'>,
  score: number,
  get: (id: string) => ContentItem | undefined,
  cards: Pick<CardsApi, 'get'>,
  today: EpochDay,
): { cardKey: CardKey; rating: Rating }[] {
  const rating = implicitRatingFor(score);
  if (rating === null || !line.tokenIds) return [];
  return implicitProdGrades(line.tokenIds, get, cards, today, rating);
}
