/**
 * TSUZUKU — pure answer graders for the drills (design 04 §0, 05 §4).
 *
 * `checkJa` / `checkReading` classify a typed Japanese answer against an
 * accept list; the `grade*` helpers build the `AttemptResult` shape
 * (`@/shared/session-types`) every exercise hands to `onResult`. The FSRS
 * rating itself is decided later by `learn/grading.ts`; these graders only
 * set the facts it reads:
 *
 *   correct:true  nearMiss:false → Good      (exact, or kana-only under 'good')
 *   correct:true  nearMiss:true  → Hard      (kana-only under 'hard': right word,
 *                                             the kanji counts from Green)
 *   correct:false nearMiss:true  → Hard      ("Block": small-kana / long-vowel /
 *                                             one-character / particle slip; combo holds)
 *   correct:false nearMiss:false → Again
 *
 * Order of checks in `checkJa`: equivalence (`equivalentJa`: NFKC, katakana
 * fold, ぢ/づ ≡ じ/ず, long-vowel variants) → script mismatch when the fold is
 * disallowed → particle slip → `nearMissKind` → plain miss (voicing detected
 * either way). No clocks, no randomness, no store.
 */
import type { Belt, ContentItem, ErrorTag, KanaItem, KanjiItem, VocabItem } from '@/content/types';
import { BELT_IDS } from '@/content/types';
import { SCORE_BANDS } from '@/learn';
import type { AttemptResult, StepParams } from '@/shared/session-types';
import {
  containsHiragana,
  containsKanji,
  containsKatakana,
  equivalentJa,
  fuzzyEn,
  moraSimilarity,
  nearMissKind,
  normalizeAnswer,
  normalizeJa,
  type NearMissKind,
} from '@/shared/jp';
import { S, WHY_BY_NEAR_MISS, WHY_BY_TAG } from './strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Tables                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Particles a production answer may slip on (design 04 §4 Particle Duel set + も). */
export const SLIP_PARTICLES: readonly string[] = ['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の', 'も'];

/** Kanji `read` cards must have S ≥ 7 d before kana-only answers drop to Hard (design 04 §2). */
export const KANA_ONLY_READ_DAYS = 7;

const DEVOICE: Record<string, string> = {
  が: 'か', ぎ: 'き', ぐ: 'く', げ: 'け', ご: 'こ',
  ざ: 'さ', じ: 'し', ず: 'す', ぜ: 'せ', ぞ: 'そ',
  だ: 'た', ぢ: 'ち', づ: 'つ', で: 'て', ど: 'と',
  ば: 'は', び: 'ひ', ぶ: 'ふ', べ: 'へ', ぼ: 'ほ',
  ぱ: 'は', ぴ: 'ひ', ぷ: 'ふ', ぺ: 'へ', ぽ: 'ほ',
  ゔ: 'う',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Classification helpers                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

type Script = 'hira' | 'kata' | 'mixed';

function scriptOf(s: string): Script {
  const h = containsHiragana(s);
  const k = containsKatakana(s);
  if (k && !h) return 'kata';
  if (h && !k) return 'hira';
  return 'mixed';
}

/** `given` and `expected` are the same word with one script swapped (シ typed as し). */
export function scriptMismatch(given: string, expected: string): boolean {
  const g = scriptOf(normalizeJa(given));
  const e = scriptOf(normalizeJa(expected));
  return g !== 'mixed' && e !== 'mixed' && g !== e;
}

/** Same length, exactly one mora differs, and only by a dakuten/handakuten (か/が, は/ば/ぱ). */
export function voicingSlip(given: string, expected: string): boolean {
  const g = Array.from(normalizeJa(given, { foldKatakana: true }));
  const e = Array.from(normalizeJa(expected, { foldKatakana: true }));
  if (g.length === 0 || g.length !== e.length) return false;
  let diffs = 0;
  for (let i = 0; i < g.length; i++) {
    const a = g[i] as string;
    const b = e[i] as string;
    if (a === b) continue;
    if ((DEVOICE[a] ?? a) !== (DEVOICE[b] ?? b)) return false;
    diffs++;
  }
  return diffs === 1;
}

/**
 * The answer differs from the expected form only by a particle: one particle
 * swapped for another anywhere after the first character (は→が, に→へ), or a
 * trailing particle added / omitted (みずを for みず). Never fires on a bare
 * particle or on an empty side.
 */
export function particleSlip(given: string, expected: string): boolean {
  const g = normalizeAnswer(given);
  const e = normalizeAnswer(expected);
  if (g.length === 0 || e.length === 0 || g === e) return false;
  let i = 0;
  while (i < g.length && i < e.length && g[i] === e[i]) i++;
  let j = 0;
  while (j < g.length - i && j < e.length - i && g[g.length - 1 - j] === e[e.length - 1 - j]) j++;
  const gm = g.slice(i, g.length - j);
  const em = e.slice(i, e.length - j);
  const isP = (s: string): boolean => SLIP_PARTICLES.includes(s);
  if (i === 0) return false; // a particle never opens the word
  if (gm.length > 0 && em.length > 0) return isP(gm) && isP(em);
  const extra = gm.length > 0 ? gm : em;
  return j === 0 && isP(extra);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* checkJa / checkReading                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export type CheckKind = 'exact' | 'kana-only' | 'near' | 'particle' | 'script' | 'wrong' | 'empty';

export interface CheckOptions {
  /** Every accepted surface: `[word, kana, ...altForms]` (see `acceptForms`). */
  accept: readonly string[];
  /** Kana reading for a word that has kanji: Good through Orange, Hard from Green (design 04 §2). */
  kanaOnlyPolicy: 'good' | 'hard';
  /** `false` → カタカナ and ひらがな are different answers (kana-forge). Default `true`. */
  allowKatakanaFold?: boolean;
  /** Tolerate a particle slip as a Block tagged `particle` (production). Default `true`. */
  particleSlip?: boolean;
  /** Tags attached to a plain miss (`kanji-reading`, `conjugation` …). */
  missTags?: readonly ErrorTag[];
}

export interface CheckResult {
  correct: boolean;
  nearMiss: boolean;
  /** The learner typed the kana reading of a word that has kanji. */
  kanaOnly: boolean;
  tags: ErrorTag[];
  /** The accepted form to show: the one matched / nearly matched, else `accept[0]`. */
  expected: string;
  kind: CheckKind;
  nearKind: NearMissKind | null;
  /** The trimmed answer. */
  given: string;
}

function uniq<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}

function cleanAccept(accept: readonly string[]): string[] {
  return uniq(accept.map((a) => a.trim()).filter((a) => a.length > 0));
}

function result(kind: CheckKind, given: string, expected: string, over: Partial<CheckResult> = {}): CheckResult {
  return { correct: false, nearMiss: false, kanaOnly: false, tags: [], nearKind: null, ...over, kind, given, expected };
}

/** Classifies a typed Japanese answer (see the module header for the result semantics). */
export function checkJa(given: string, o: CheckOptions): CheckResult {
  const accept = cleanAccept(o.accept);
  const g = given.trim();
  const display = accept[0] ?? '';
  if (normalizeJa(g).length === 0) return result('empty', g, display);
  const fold = o.allowKatakanaFold !== false;
  // Kana-only means "the dictionary form (accept[0]) has kanji and the learner wrote none";
  // a usually-kana word with a kanji altForm (おいしい / 美味しい) is never kana-only.
  const primaryKanji = containsKanji(display);

  for (const a of accept) {
    if (!equivalentJa(g, a)) continue;
    if (!fold && scriptMismatch(g, a)) continue;
    const kanaOnly = primaryKanji && !containsKanji(a) && !containsKanji(g);
    if (kanaOnly && o.kanaOnlyPolicy === 'hard') return result('kana-only', g, a, { correct: true, nearMiss: true, kanaOnly: true });
    return result('exact', g, a, { correct: true, kanaOnly });
  }

  if (!fold) {
    for (const a of accept) if (equivalentJa(g, a)) return result('script', g, a);
  }

  if (o.particleSlip !== false) {
    for (const a of accept) if (particleSlip(g, a)) return result('particle', g, a, { nearMiss: true, tags: ['particle'] });
  }

  for (const a of accept) {
    const k = nearMissKind(g, a);
    if (k === null) continue;
    const tags: ErrorTag[] = k === 'transcription' && voicingSlip(g, a) ? ['voicing'] : [k];
    return result('near', g, a, { nearMiss: true, tags, nearKind: k });
  }

  const tags: ErrorTag[] = [...(o.missTags ?? [])];
  if (accept.some((a) => voicingSlip(g, a))) tags.push('voicing');
  return result('wrong', g, display, { tags: uniq(tags) });
}

export interface ReadingResult {
  correct: boolean;
  nearMiss: boolean;
  tags: ErrorTag[];
  kind: CheckKind;
  nearKind: NearMissKind | null;
  expected: string;
}

/**
 * A reading answer (kanji-read, kana-forge): exact or canonical-equivalent;
 * a slip is a Block tagged by kind; a plain miss carries `missTag`
 * (`kanji-reading` by default, `null` for none). No particle tolerance.
 */
export function checkReading(given: string, expected: string, missTag: ErrorTag | null = 'kanji-reading'): ReadingResult {
  const r = checkJa(given, {
    accept: [expected],
    kanaOnlyPolicy: 'good',
    particleSlip: false,
    missTags: missTag ? [missTag] : [],
  });
  return { correct: r.correct, nearMiss: r.nearMiss, tags: r.tags, kind: r.kind, nearKind: r.nearKind, expected: r.expected };
}

/** One line of *why* for a check, or `undefined` when there is nothing to explain. */
export function whyFor(r: Pick<CheckResult, 'kind' | 'tags' | 'nearKind' | 'expected'>): string | undefined {
  if (r.kind === 'kana-only') return S.kanaOnlyHard;
  if (r.kind === 'particle') return S.particleSlip;
  if (r.kind === 'script') return containsKatakana(r.expected) ? S.whyScriptKatakana : S.whyScriptHiragana;
  const tag = r.tags[0];
  if (tag) return WHY_BY_TAG[tag];
  if (r.nearKind) return WHY_BY_NEAR_MISS[r.nearKind];
  return undefined;
}

/**
 * Kana-only policy for a word (design 04 §2): Good through Orange; from Green,
 * Hard once every kanji `read` card of the word has S ≥ 7 d. A word without
 * `read` cards (no kanji, or cards not created yet) stays 'good'.
 */
export function kanaOnlyPolicyFor(belt: Belt, readStabilities: readonly number[]): 'good' | 'hard' {
  if (BELT_IDS.indexOf(belt) < BELT_IDS.indexOf('green')) return 'good';
  if (readStabilities.length === 0) return 'good';
  return readStabilities.every((s) => s >= KANA_ONLY_READ_DAYS) ? 'hard' : 'good';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Accept lists                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function isVocab(i: ContentItem): i is VocabItem {
  return 'word' in i && 'kana' in i && 'meanings' in i;
}
function isKana(i: ContentItem): i is KanaItem {
  return 'kana' in i && 'romaji' in i && 'script' in i;
}
function isKanji(i: ContentItem): i is KanjiItem {
  return 'char' in i && 'strokes' in i;
}

/**
 * Every surface a typed answer may match: `params.answer`, `params.accept`,
 * then the item's own forms (vocab: word, kana, altForms; kana: the character;
 * kanji: the character). Order matters: the first entry is the display form.
 */
export function acceptForms(item: ContentItem | null, params: StepParams = {}): string[] {
  const out: string[] = [];
  if (params.answer) out.push(params.answer);
  if (params.accept) out.push(...params.accept);
  if (item) {
    if (isVocab(item)) out.push(item.word, item.kana, ...(item.altForms ?? []));
    else if (isKana(item)) out.push(item.kana);
    else if (isKanji(item)) out.push(item.char);
  }
  return cleanAccept(out);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* AttemptResult builders                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface GradeCtx {
  /** Latency from prompt to answer, measured by the exercise with `store.now()`. */
  ms: number;
  hintUsed?: boolean;
  replays?: number;
}

/** Fills the `AttemptResult` defaults; `ms` is required. */
export function attempt(over: Partial<AttemptResult> & Pick<AttemptResult, 'ms'>): AttemptResult {
  return { correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, errorTags: [], ...over };
}

function fromCtx(ctx: GradeCtx): AttemptResult {
  const r = attempt({ ms: Math.max(0, ctx.ms), hintUsed: Boolean(ctx.hintUsed) });
  if (ctx.replays !== undefined) r.replays = ctx.replays;
  return r;
}

/** Multiple choice: right index → correct; wrong → `missTags`. */
export function gradeChoice(picked: number, correct: number, ctx: GradeCtx & { missTags?: readonly ErrorTag[]; answer?: string }): AttemptResult {
  const r = fromCtx(ctx);
  r.correct = picked === correct;
  if (!r.correct) r.errorTags = [...(ctx.missTags ?? [])];
  if (ctx.answer !== undefined) r.answer = ctx.answer;
  return r;
}

/** Typed Japanese through `checkJa`; the `check` is attached for the feedback card. */
export function gradeTyped(given: string, o: CheckOptions, ctx: GradeCtx): AttemptResult & { check: CheckResult } {
  const check = checkJa(given, o);
  const r = fromCtx(ctx);
  r.correct = check.correct;
  r.nearMiss = check.nearMiss;
  r.errorTags = check.tags;
  r.answer = check.given;
  return Object.assign(r, { check });
}

/** Cloze blank: exact or kana-equivalent; alternates from `accept`; particle slips are Blocks. */
export function gradeCloze(given: string, answer: string, accept: readonly string[], ctx: GradeCtx): AttemptResult & { check: CheckResult } {
  return gradeTyped(given, { accept: [answer, ...accept], kanaOnlyPolicy: 'good' }, ctx);
}

/**
 * Typed English through `fuzzyEn`. An "I meant that" `override` on a miss
 * reports `correct:true` with `selfRating: 3`, so grading treats it as
 * self-graded and the Judge can sample it (design 04 §2, 05 §6).
 */
export function gradeEn(
  given: string,
  accept: readonly string[],
  ctx: GradeCtx & { override?: boolean; missTags?: readonly ErrorTag[] },
): AttemptResult & { fuzzy: boolean } {
  const fuzzy = fuzzyEn(given, accept);
  const r = fromCtx(ctx);
  r.answer = given.trim();
  if (fuzzy) r.correct = true;
  else if (ctx.override) {
    r.correct = true;
    r.selfRating = 3;
  } else r.errorTags = [...(ctx.missTags ?? [])];
  return Object.assign(r, { fuzzy });
}

function sameOrder(given: readonly string[], expected: readonly string[]): boolean {
  return normalizeAnswer(given.join('')) === normalizeAnswer(expected.join(''));
}

/**
 * Tile ordering (scramble): the final order must match `expected` or an
 * alternate; first try → Good, after one fix → Hard (Block), more → Again.
 * Every non-clean outcome is tagged `word-order`.
 */
export function gradeOrdering(
  given: readonly string[],
  expected: readonly string[],
  ctx: GradeCtx & { fixes: number; accept?: readonly (readonly string[])[] },
): AttemptResult {
  const r = fromCtx(ctx);
  r.answer = given.join(' ');
  const ok = sameOrder(given, expected) || (ctx.accept ?? []).some((a) => sameOrder(given, a));
  if (!ok) {
    r.errorTags = ['word-order'];
    return r;
  }
  if (ctx.fixes <= 0) {
    r.correct = true;
    return r;
  }
  r.errorTags = ['word-order'];
  if (ctx.fixes === 1) {
    r.correct = true;
    r.nearMiss = true;
  }
  return r;
}

/** Particle slots (particle-duel): all right → Good; some → Hard; none → Again; always tagged `particle` on a miss. */
export function gradeSlots(picked: readonly (string | null)[], expected: readonly string[], ctx: GradeCtx): AttemptResult & { hits: number } {
  const r = fromCtx(ctx);
  let hits = 0;
  expected.forEach((e, i) => {
    const p = picked[i];
    if (p !== null && p !== undefined && equivalentJa(p, e)) hits++;
  });
  r.answer = picked.map((p) => p ?? '＿').join(' ');
  if (expected.length > 0 && hits === expected.length) r.correct = true;
  else {
    r.errorTags = ['particle'];
    if (hits > 0) r.nearMiss = true;
  }
  return Object.assign(r, { hits });
}

/** Pitch nucleus pick (pitch-ear / drop-mora tap): wrong → tag `pitch`. */
export function gradePitch(picked: number, expected: number, ctx: GradeCtx): AttemptResult {
  const r = fromCtx(ctx);
  r.answer = String(picked);
  if (picked === expected) r.correct = true;
  else r.errorTags = ['pitch'];
  return r;
}

/** 1 − normalized mora edit distance (dictation / shadow score). */
export function moraScore(given: string, expected: string): number {
  return moraSimilarity(given, expected);
}

/** Score-banded result (dictation ≥ 0.95 Good, ≥ 0.80 Hard, else Again by default). */
export function gradeScored(
  score: number,
  ctx: GradeCtx & { bands?: { good: number; hard: number }; missTags?: readonly ErrorTag[]; answer?: string },
): AttemptResult {
  const bands = ctx.bands ?? SCORE_BANDS;
  const s = Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0));
  const r = fromCtx(ctx);
  r.score = s;
  r.correct = s >= bands.good;
  r.nearMiss = !r.correct && s >= bands.hard;
  if (!r.correct) r.errorTags = [...(ctx.missTags ?? [])];
  if (ctx.answer !== undefined) r.answer = ctx.answer;
  return r;
}

/** Shift+Enter "don't know": honest, graded by `learn/grading` (step miss or Again). */
export function guardResult(ctx: GradeCtx): AttemptResult {
  const r = fromCtx(ctx);
  r.guard = true;
  return r;
}

/** Soft timer ran out with no answer: graded Hard, never Again (design 04 §11). */
export function timeoutResult(ctx: GradeCtx & { answer?: string }): AttemptResult {
  const r = fromCtx(ctx);
  r.timedOut = true;
  if (ctx.answer !== undefined) r.answer = ctx.answer;
  return r;
}
