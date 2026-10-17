/**
 * TSUZUKU — Writing Dojo live checks (design 04 §9, 04 §12 書, 05 §7).
 *
 * No automatic grade: the checks return typed findings the WritingDojo
 * component turns into copy (its `strings.ts`) and into the rubric Judge.
 *
 *  patterns     required grammar present: any `clozeHints` substring, or the
 *               `learn/judge rubricJudge` regex, in the plain (ruby-stripped) text
 *  register     every sentence consistent with the target (`taiwa/register`)
 *  kanaOnlyGreen Green words written in kana although their kanji is known
 *  particles    sanity heuristics: doubled or clashing particle pairs,
 *               a particle with nothing after it
 *  conjugation  dictionary form + ます (飲むます) for the given verbs, fixed via
 *               `learn/conjugate`
 *  length       sentence count against the belt range (3–12 by belt)
 *
 * `warnings` are stable machine codes (`particle:をが`, `length:short`, …),
 * never learner copy. `exportText()` builds the plain text handed to a tutor.
 */
import type { Belt, ErrorTag, GrammarItem, RegisterTag, VocabItem } from '../../content/types';
import { toPlain } from '../../content/ruby';
import { applicableForms, conjugate, isConjugable, rubricJudge } from '../../learn';
import { containsKanji, foldWidth, normalizeJa, toHiragana } from '../../shared/jp';
import { detectRegister, registerMatches, splitClauses, type Register } from '../taiwa/register';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type FindingCode = 'pattern-missing' | 'register' | 'kana-only-green' | 'particle' | 'conjugation' | 'length-short' | 'length-long' | 'empty';

export interface WritingFinding {
  code: FindingCode;
  /** Error tag the finding maps to (`null` for pattern / length findings). */
  tag: ErrorTag | null;
  /** The pattern id, word, particle pair or sentence concerned. */
  detail: string;
  /** Suggested fix where one exists (飲むます → 飲みます). */
  fix?: string;
  /** 0-based sentence index where it was seen, when it is local. */
  sentence?: number;
}

export interface WritingCheckOptions {
  patterns: readonly GrammarItem[];
  register: RegisterTag;
  greenWords: readonly VocabItem[];
  /** Sentence range to check (`SENTENCE_RANGE_BY_BELT[belt]` or explicit). */
  range?: readonly [min: number, max: number];
  belt?: Belt;
}

export interface WritingCheck {
  patternsHit: number;
  patternsTotal: number;
  /** Ids of required patterns not found. */
  patternsMissing: string[];
  registerOk: boolean;
  /** Register of each sentence (for the meter). */
  sentenceRegisters: Register[];
  /** Green words (by `word`) written in kana only. */
  kanaOnlyGreen: string[];
  /** Stable codes, one per finding. */
  warnings: string[];
  findings: WritingFinding[];
  sentences: number;
  /** Readable characters (punctuation excluded). */
  chars: number;
}

/** Target length in sentences by belt (design 04 §9: 3–12 by belt; Writing Dojo opens at Green). */
export const SENTENCE_RANGE_BY_BELT: Record<Belt, readonly [number, number]> = {
  white: [3, 4],
  yellow: [3, 4],
  orange: [3, 5],
  green: [3, 5],
  blue: [5, 7],
  purple: [6, 8],
  brown: [8, 10],
  black: [10, 12],
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Sentences                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Plain text (ruby stripped, NFKC) split into sentences at 。！？ and line breaks. */
export function sentencesOf(text: string): string[] {
  const plain = foldWidth(toPlain(text));
  const out: string[] = [];
  for (const para of plain.split(/\r?\n+/)) {
    for (const c of splitClauses(para.replace(/[\s　]+/g, ' ').trim())) out.push(c.text);
  }
  return out.filter((s) => normalizeJa(s).length > 0);
}

export function sentenceCount(text: string): number {
  return sentencesOf(text).length;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Patterns                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** A hint and its voiced て/た variant (〜てください also matches 飲んでください). */
export function hintVariants(hint: string): string[] {
  const out = [hint];
  if (hint.startsWith('て')) out.push('で' + hint.slice(1));
  else if (hint.startsWith('た')) out.push('だ' + hint.slice(1));
  return out;
}

/** The required pattern appears: any `clozeHints` substring (or its voiced variant), else the rubric regex. */
export function patternPresent(text: string, pattern: GrammarItem): boolean {
  const plain = normalizeJa(foldWidth(toPlain(text)));
  for (const h of pattern.clozeHints) {
    for (const v of hintVariants(normalizeJa(foldWidth(h)))) {
      if (v.length > 0 && plain.includes(v)) return true;
    }
  }
  const { regex } = rubricJudge(pattern);
  try {
    return new RegExp(regex, 'u').test(plain);
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kanji use for Green words                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Characters that may precede a short verb form (particles, punctuation, anything not hiragana). */
const PREV_BOUNDARY_RE = /[をはがにでとへも、。！？「\s]|[^ぁ-ゖー]/;
/** Characters that may follow a noun / adjective (particles, copula, punctuation, anything not hiragana). */
const NEXT_BOUNDARY_RE = /[をはがにでとへものねよかな、。！？」\s]|[^ぁ-ゖー]/;

function kanaSurfaces(w: VocabItem): string[] {
  const out = new Set<string>([toHiragana(normalizeJa(w.kana))]);
  if (isConjugable(w.pos)) {
    for (const form of applicableForms(w.pos)) {
      const c = conjugate(w.word, w.kana, w.pos, form);
      if (c) out.add(toHiragana(normalizeJa(c.answerKana)));
    }
  }
  return [...out].filter((k) => k.length >= 2);
}

function occursBounded(hira: string, surface: string, needPrev: boolean, needNext: boolean): boolean {
  let from = 0;
  for (;;) {
    const i = hira.indexOf(surface, from);
    if (i < 0) return false;
    const prev = i === 0 ? '' : (hira[i - 1] as string);
    const next = hira[i + surface.length] ?? '';
    const prevOk = !needPrev || prev === '' || PREV_BOUNDARY_RE.test(prev);
    const nextOk = !needNext || next === '' || NEXT_BOUNDARY_RE.test(next);
    if (prevOk && nextOk) return true;
    from = i + 1;
  }
}

/**
 * Green words whose `word` carries kanji but appear in the text only as
 * their kana reading (any conjugated kana form for verbs / adjectives), the
 * kanji surface absent. Loanwords, `usually-kana` words and する/来る verbs
 * never qualify. Short forms (見る → みます) need a particle or punctuation
 * before them; nouns and adjectives need one after them, so みずうみ never
 * flags 水 and のみます never flags 見る.
 */
export function kanaOnlyGreenWords(text: string, greenWords: readonly VocabItem[]): string[] {
  const plain = normalizeJa(foldWidth(toPlain(text)));
  const hira = toHiragana(plain);
  const out: string[] = [];
  for (const w of greenWords) {
    if (!containsKanji(w.word) || w.tags.includes('usually-kana') || w.tags.includes('loanword') || w.pos === 'v-irr') continue;
    if (plain.includes(w.word)) continue;
    const stem = kanjiStem(w.word);
    if (stem && plain.includes(stem)) continue;
    const conjugable = isConjugable(w.pos);
    const shortStem = conjugable && Array.from(normalizeJa(w.kana)).length <= 2;
    const hit = kanaSurfaces(w).some((k) => occursBounded(hira, k, shortStem, !conjugable));
    if (hit && !out.includes(w.word)) out.push(w.word);
  }
  return out;
}

/** The kanji part of a word up to its okurigana (食べる → 食, 飲む → 飲, 日本 → 日本). */
function kanjiStem(word: string): string {
  const m = /^([㐀-䶿一-鿿々〆]+)/.exec(word);
  return m ? (m[1] as string) : '';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Particles                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Adjacent particle pairs that are never grammatical. */
export const BAD_PARTICLE_PAIRS: readonly string[] = ['をを', 'がが', 'をが', 'がを', 'をは', 'はを', 'をに', 'にを', 'をで', 'でを', 'にに', 'でで', 'へへ', 'とと', 'もも', 'がは', 'はが'];

/** Particle-sanity heuristics: each finding's detail is the offending pair, or `を$` for a dangling object. */
export function particleFindings(text: string): WritingFinding[] {
  const out: WritingFinding[] = [];
  sentencesOf(text).forEach((s, i) => {
    const plain = normalizeJa(s);
    for (const pair of BAD_PARTICLE_PAIRS) {
      if (plain.includes(pair) && !out.some((f) => f.detail === pair && f.sentence === i)) {
        out.push({ code: 'particle', tag: 'particle', detail: pair, sentence: i });
      }
    }
    if (/[をへ]$/.test(plain) && plain.length > 1) out.push({ code: 'particle', tag: 'particle', detail: `${plain.slice(-1)}$`, sentence: i });
  });
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Conjugation                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Dictionary form + ます-family (飲むます, 食べるました) for the given verbs → fix via the engine. */
export function conjugationFindings(text: string, words: readonly VocabItem[]): WritingFinding[] {
  const plain = normalizeJa(foldWidth(toPlain(text)));
  const out: WritingFinding[] = [];
  const suffixes: [string, Parameters<typeof conjugate>[3]][] = [
    ['ませんでした', 'masen-deshita'],
    ['ましょう', 'masho'],
    ['ました', 'mashita'],
    ['ません', 'masen'],
    ['ます', 'masu'],
    ['たい', 'tai'],
  ];
  for (const w of words) {
    if (!isConjugable(w.pos) || !(w.pos === 'v1' || w.pos === 'v5' || w.pos === 'v-irr')) continue;
    for (const surface of [w.word, w.kana]) {
      for (const [suf, form] of suffixes) {
        const wrong = surface + suf;
        if (!plain.includes(wrong)) continue;
        const c = conjugate(w.word, w.kana, w.pos, form);
        const fix = c ? (surface === w.word ? c.answer : c.answerKana) : undefined;
        if (!out.some((f) => f.detail === wrong)) out.push({ code: 'conjugation', tag: 'conjugation', detail: wrong, ...(fix ? { fix } : {}) });
      }
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Register                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export function registerFindings(sentences: readonly string[], target: RegisterTag): { ok: boolean; registers: Register[]; findings: WritingFinding[] } {
  const registers = sentences.map((s) => detectRegister(s));
  const findings: WritingFinding[] = [];
  sentences.forEach((s, i) => {
    if (!registerMatches(s, target)) findings.push({ code: 'register', tag: 'register', detail: s, sentence: i });
  });
  return { ok: findings.length === 0, registers, findings };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* checkWriting                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export function checkWriting(text: string, o: WritingCheckOptions): WritingCheck {
  const sentences = sentencesOf(text);
  const findings: WritingFinding[] = [];

  const patternsMissing: string[] = [];
  for (const p of o.patterns) {
    if (!patternPresent(text, p)) {
      patternsMissing.push(p.id);
      findings.push({ code: 'pattern-missing', tag: null, detail: p.id });
    }
  }

  const reg = registerFindings(sentences, o.register);
  findings.push(...reg.findings);

  const kanaOnlyGreen = kanaOnlyGreenWords(text, o.greenWords);
  for (const w of kanaOnlyGreen) findings.push({ code: 'kana-only-green', tag: null, detail: w });

  findings.push(...particleFindings(text));
  findings.push(...conjugationFindings(text, o.greenWords));

  const range = o.range ?? (o.belt ? SENTENCE_RANGE_BY_BELT[o.belt] : undefined);
  if (sentences.length === 0) findings.push({ code: 'empty', tag: null, detail: '' });
  else if (range) {
    if (sentences.length < range[0]) findings.push({ code: 'length-short', tag: null, detail: `${sentences.length}/${range[0]}` });
    else if (sentences.length > range[1]) findings.push({ code: 'length-long', tag: null, detail: `${sentences.length}/${range[1]}` });
  }

  const chars = sentences.reduce((n, s) => n + Array.from(normalizeJa(s)).length, 0);
  return {
    patternsHit: o.patterns.length - patternsMissing.length,
    patternsTotal: o.patterns.length,
    patternsMissing,
    registerOk: reg.ok,
    sentenceRegisters: reg.registers,
    kanaOnlyGreen,
    warnings: findings.map((f) => (f.detail ? `${f.code}:${f.detail}` : f.code)),
    findings,
    sentences: sentences.length,
    chars,
  };
}

/** The rubric self-check items: one `{rubric, regex}` per required pattern (`learn/judge rubricJudge`). */
export function rubricItems(patterns: readonly GrammarItem[]): { id: string; rubric: string; regex: string; present: boolean }[] {
  return patterns.map((p) => ({ id: p.id, ...rubricJudge(p), present: false }));
}

/**
 * Plain text for a tutor: the learner's text, then the prompt, the required
 * patterns and the register, as labelled lines (labels are the caller's copy).
 */
export function exportText(
  text: string,
  o: { prompt?: string; patterns?: readonly GrammarItem[]; register?: RegisterTag; labels?: { prompt?: string; patterns?: string; register?: string } } = {},
): string {
  const lines: string[] = [toPlain(text).trim()];
  const extras: string[] = [];
  if (o.prompt) extras.push(`${o.labels?.prompt ?? 'Prompt'}: ${o.prompt}`);
  if (o.patterns && o.patterns.length > 0) extras.push(`${o.labels?.patterns ?? 'Patterns'}: ${o.patterns.map((p) => p.pattern).join(' / ')}`);
  if (o.register) extras.push(`${o.labels?.register ?? 'Register'}: ${o.register}`);
  if (extras.length > 0) lines.push('', ...extras);
  return lines.join('\n');
}
