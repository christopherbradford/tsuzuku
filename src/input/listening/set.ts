/**
 * TSUZUKU — Listening Arena set helpers: constants, the deterministic set
 * builder, the dictation grader and the listen-facet evidence (design 04 §5,
 * 05 §4). Pure; `ListeningArena.tsx` re-exports them (tests and E's builder
 * import from there). Split out of the component in review round 2b to keep
 * the file under the size cap.
 */
import { segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import type { CardKey, ComprehensionQuestion, ContentItem, ErrorTag, StoryItem, StoryLine, VocabItem } from '@/content/types';
import { SCORE_BANDS } from '@/learn';
import { shuffle, type Rng } from '@/shared/hash';
import { cardKey, tryKindOfId } from '@/shared/ids';
import { diffChars, moraCount, moraSimilarity, nearMissKind, normalizeAnswer, normalizeJa } from '@/shared/jp';
import type { CardsApi, EpochDay, Rating } from '@/shared/store-types';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Items per set (design 04 §5 "a set of 5–8"); the gist questions come first. */
export const SET_TARGET = 6;
export const SET_MIN_LINES = 2;
export const SET_MAX = 8;
/** Replays per item and for the whole-text listen (design 04 §5: ≤ 2, second → Hard ceiling). */
export const REPLAY_BUDGET = 2;
/** Lines longer than this (morae) are heard as a choice item, never dictated. */
export const DICTATION_MAX_MORAE = 22;
/** Japanese choices (the line itself) from Green; English meanings before. */
export const JA_CHOICES_FROM_STATION = 16;
/** The mandatory re-listen is this much faster. */
export const RELISTEN_DELTA = 0.1;
/** Implicit listen grades apply to cards due within this many days (design 05 §4). */
export const IMPLICIT_WINDOW_DAYS = 3;
/** Set pass mark for XP / stats (design 04 §7 "≥ 2/3"). */
export const PASS_RATIO = 2 / 3;

const FUNCTION_POS: ReadonlySet<string> = new Set(['prt', 'aux', 'conj', 'pref', 'suf']);

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers (exported for tests and for E's builder)                      */
/* ────────────────────────────────────────────────────────────────────────── */

export function isStoryItem(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && 'comprehension' in i && Array.isArray((i as StoryItem).lines);
}

function isVocab(i: ContentItem | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i;
}

/** Speaker label → voice slot by first appearance (`a`, `b`, `a`, …); unlabelled lines use `a`. */
export function voiceSlots(lines: readonly StoryLine[]): Map<string, 'a' | 'b'> {
  const slots = new Map<string, 'a' | 'b'>();
  for (const l of lines) {
    const name = l.speaker ?? '';
    if (!slots.has(name)) slots.set(name, slots.size % 2 === 0 ? 'a' : 'b');
  }
  return slots;
}

export function slotFor(line: StoryLine, slots: Map<string, 'a' | 'b'>): 'a' | 'b' {
  return slots.get(line.speaker ?? '') ?? 'a';
}

/** The re-listen rate: +0.1×, rounded to two decimals. */
export function relistenRate(rate: number): number {
  return Math.round((rate + RELISTEN_DELTA) * 100) / 100;
}

export type ListenItem =
  | { kind: 'gist'; q: ComprehensionQuestion }
  | { kind: 'choice'; lineIndex: number; choices: string[]; answer: number; ja: boolean }
  | { kind: 'dictation'; lineIndex: number };

export interface SetOptions {
  rng: Rng;
  station: number;
}

/**
 * Builds the set: every gist question first, then 2–5 line items (alternating
 * choice / dictation; a line too long to dictate becomes a choice), 5–8 items
 * in all. Deterministic for a given `rng`.
 */
export function buildListeningSet(story: StoryItem, o: SetOptions): ListenItem[] {
  const items: ListenItem[] = story.comprehension.map((q) => ({ kind: 'gist', q }));
  const lines = story.lines;
  if (lines.length === 0) return items;
  const lineCount = Math.max(SET_MIN_LINES, Math.min(SET_MAX - items.length, SET_TARGET - items.length, lines.length));
  const order = shuffle(
    o.rng,
    lines.map((_, i) => i),
  ).slice(0, lineCount);
  const ja = o.station >= JA_CHOICES_FROM_STATION;
  order.forEach((lineIndex, k) => {
    const line = lines[lineIndex] as StoryLine;
    const dictable = moraCount(normalizeJa(line.kana, { foldKatakana: true })) <= DICTATION_MAX_MORAE;
    if (k % 2 === 1 && dictable) {
      items.push({ kind: 'dictation', lineIndex });
      return;
    }
    const text = (l: StoryLine): string => (ja ? l.ja : l.en);
    const correctText = text(line);
    const pool: string[] = [];
    const seen = new Set([normalizeAnswer(toPlain(correctText)) || correctText]);
    for (const j of shuffle(
      o.rng,
      lines.map((_, i) => i),
    )) {
      if (j === lineIndex) continue;
      const t = text(lines[j] as StoryLine);
      const k2 = normalizeAnswer(toPlain(t)) || t;
      if (seen.has(k2)) continue;
      seen.add(k2);
      pool.push(t);
      if (pool.length === 3) break;
    }
    const choices = shuffle(o.rng, [correctText, ...pool]);
    items.push({ kind: 'choice', lineIndex, choices, answer: choices.indexOf(correctText), ja });
  });
  return items;
}

export interface DictationGrade {
  /** 1 − mora edit distance / length. */
  score: number;
  rating: Rating;
  /** ≥ 0.80 counts as a right answer for the set. */
  correct: boolean;
  tags: ErrorTag[];
  diff: [string, 0 | 1 | 2][];
}

/** Mora-similarity grading of a typed line (design 04 §5 sentence-listen bands). */
export function gradeDictation(answer: string, line: StoryLine): DictationGrade {
  const score = Math.max(0, Math.min(1, moraSimilarity(answer, line.kana)));
  const near = nearMissKind(answer, line.kana);
  let rating: Rating = score >= SCORE_BANDS.good ? 3 : score >= SCORE_BANDS.hard ? 2 : 1;
  if (near && rating < 2) rating = 2;
  const tags: ErrorTag[] = [];
  if (rating < 3) tags.push(near ?? (rating === 2 ? 'transcription' : 'listening'));
  return { score, rating, correct: rating >= 2, tags, diff: diffChars(normalizeJa(answer), normalizeJa(line.kana)) };
}

/**
 * Listen-facet evidence for one dictated line: a content word whose kana (or
 * surface) appears in the answer → Good on its `listen` card, else Again —
 * only for cards that exist and are due within 3 days (design 04 §5, 05 §4).
 */
export function implicitListenGrades(
  line: StoryLine,
  answer: string,
  get: (id: string) => ContentItem | undefined,
  cards: Pick<CardsApi, 'get'>,
  today: EpochDay,
): { cardKey: CardKey; rating: Rating }[] {
  const ids = line.tokenIds;
  if (!ids) return [];
  const key = normalizeAnswer(answer);
  const toks = segmentsToTokens(line.ja, line.tokens);
  const out: { cardKey: CardKey; rating: Rating }[] = [];
  const seen = new Set<CardKey>();
  ids.forEach((id, i) => {
    if (!id || tryKindOfId(id) !== 'vocab') return;
    // The item may not be in memory (a story opens with only its own file, ARCHITECTURE §3):
    // the id already says "vocab"; a loaded function word is the only thing that excludes it.
    const item = get(id);
    if (isVocab(item) && FUNCTION_POS.has(item.pos)) return;
    const ck = cardKey(id, 'listen');
    if (seen.has(ck)) return;
    const card = cards.get(ck);
    if (!card || card[0] > today + IMPLICIT_WINDOW_DAYS) return;
    const surface = line.tokens[i] ?? '';
    const reading = toks[i] ? toKana(toks[i].ja) : surface;
    const present = [reading, surface].some((s) => {
      const k = normalizeAnswer(s);
      return k.length > 0 && key.includes(k);
    });
    seen.add(ck);
    out.push({ cardKey: ck, rating: present ? 3 : 1 });
  });
  return out;
}
