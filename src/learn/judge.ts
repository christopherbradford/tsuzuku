/**
 * TSUZUKU — Metsuke (目付), the Judge honesty mechanic (design 05 §6).
 *
 * Applies only to self-graded results. A deterministic sample of self-rated
 * Goods (`hash(seed, cardKey, reps) % 100 < rate`) gets a Judge Card; the
 * rate adapts to Honesty %: 25 % at ≥ 95, 50 % at 90–95, 100 % below 90 and
 * for the first 20 checks. Three card shapes: 4-option meaning Judge, rubric
 * Judge (regex over the learner's sentence), perception Judge (minimal pair).
 * Honesty bookkeeping lives in `stats` (B) fed by `attempt:graded.judge`.
 */
import type { CardKey, ContentItem, GrammarItem, KanjiItem, VocabItem } from '../content/types';
import { toPlain } from '../content/ruby';
import { hashSeed, type Rng } from '../shared/hash';
import { normalizeEn } from '../shared/jp';
import { FALLBACK_GLOSSES, fillTiers, meaningDistractors, meaningKeys, minimalPairPartner, sharesMeaning } from './distractors';

export type JudgeRate = 25 | 50 | 100;

/** Honesty % is computed over the last 200 Judge checks. */
export const HONESTY_WINDOW = 200;
/** Every one of the first 20 self-rated Goods is checked. */
export const JUDGE_WARMUP_CHECKS = 20;
/** 正直者 badge threshold (design 06). */
export const HONESTY_BADGE = 0.95;

export const JUDGE_RATES = { calibrated: 25, drifting: 50, uncalibrated: 100 } as const;

/**
 * Sampling rate for the next self-rated Good. `honesty` is a 0–1 ratio
 * (`stats.honesty`); a percentage > 1 is tolerated and divided by 100.
 */
export function judgeRate(honesty: number | null, checks: number): JudgeRate {
  if (checks < JUDGE_WARMUP_CHECKS || honesty === null || !Number.isFinite(honesty)) return 100;
  const h = honesty > 1 ? honesty / 100 : honesty;
  if (h >= 0.95) return 25;
  if (h >= 0.9) return 50;
  return 100;
}

/** Deterministic sample: `hash(seed, cardKey, reps) % 100 < rate`. */
export function shouldJudge(seed: string, cardKey: CardKey, reps: number, rate: JudgeRate): boolean {
  return hashSeed(seed, cardKey, reps) % 100 < rate;
}

/** Honesty ratio over the recorded window, or `null` before the first check. */
export function honestyRate(passes: number, checks: number): number | null {
  if (checks <= 0) return null;
  return Math.max(0, Math.min(1, passes / checks));
}

/** Sliding-window update used by the stats reducer: returns the new window (≤ 200 booleans). */
export function pushHonesty(window: readonly boolean[], pass: boolean): boolean[] {
  const next = window.concat([pass]);
  return next.length > HONESTY_WINDOW ? next.slice(next.length - HONESTY_WINDOW) : next;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Meaning Judge                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

function isVocab(i: ContentItem): i is VocabItem {
  return 'meanings' in i && 'pos' in i && 'kana' in i;
}
function isKanji(i: ContentItem): i is KanjiItem {
  return 'char' in i && 'strokes' in i;
}
function isGrammar(i: ContentItem): i is GrammarItem {
  return 'pattern' in i && 'clozeHints' in i;
}

function padGlosses(correct: string, picked: string[], n: number): string[] {
  const have = new Set([normalizeEn(correct), ...picked.map(normalizeEn)]);
  const out = picked.slice();
  for (const f of FALLBACK_GLOSSES) {
    if (out.length >= n) break;
    const k = normalizeEn(f);
    if (!have.has(k)) {
      have.add(k);
      out.push(f);
    }
  }
  return out.slice(0, n);
}

/**
 * 4-option meaning Judge: the correct meaning, one confusable / look-alike /
 * related entry, and two same-POS (same-level for kanji and grammar)
 * distractors, so a guess passes 25 %, not 50 %. Distractors are distinct and
 * never equal ANY accepted meaning of the item (vocab and kanji carry
 * `meanings[]`; a secondary gloss must not be gradable as a miss).
 */
export function judgeOptions(item: VocabItem | KanjiItem | GrammarItem, pool: ContentItem[], rng: Rng): { correct: string; distractors: [string, string, string] } {
  if (isVocab(item)) {
    const correct = item.meanings[0] ?? '';
    const d = padGlosses(correct, meaningDistractors(item, pool.filter(isVocab), rng, 3), 3);
    return { correct, distractors: [d[0] as string, d[1] as string, d[2] as string] };
  }
  if (isKanji(item)) {
    const correct = item.meanings[0] ?? '';
    const targetKeys = meaningKeys(item);
    const taken = [...targetKeys, normalizeEn(correct)];
    const others = pool.filter(isKanji).filter((k) => k.id !== item.id && !sharesMeaning(k, targetKeys));
    const byId = new Map(others.map((k) => [k.id, k] as const));
    const key = (k: KanjiItem) => normalizeEn(k.meanings[0] ?? '');
    const lookalikes = (item.lookalikes ?? []).map((id) => byId.get(id)).filter((k): k is KanjiItem => !!k);
    const comps = new Set(item.components);
    const shareComp = others.filter((k) => k.components.some((c) => comps.has(c)));
    const first = fillTiers(rng, [lookalikes, shareComp], 1, key, taken);
    const sameLevel = others.filter((k) => k.jlpt === item.jlpt);
    const rest = fillTiers(rng, [sameLevel, others], 3 - first.length, key, [...taken, ...first.map(key)]);
    const d = padGlosses(correct, [...first, ...rest].map((k) => k.meanings[0] ?? ''), 3);
    return { correct, distractors: [d[0] as string, d[1] as string, d[2] as string] };
  }
  const correct = item.meaning;
  const others = pool.filter(isGrammar).filter((g) => g.id !== item.id);
  const byId = new Map(others.map((g) => [g.id, g] as const));
  const key = (g: GrammarItem) => normalizeEn(g.meaning);
  const related = item.related.map((id) => byId.get(id)).filter((g): g is GrammarItem => !!g);
  const first = fillTiers(rng, [related], 1, key, [normalizeEn(correct)]);
  const sameRegister = others.filter((g) => g.register === item.register && g.jlpt === item.jlpt);
  const sameLevel = others.filter((g) => g.jlpt === item.jlpt);
  const rest = fillTiers(rng, [sameRegister, sameLevel, others], 3 - first.length, key, [normalizeEn(correct), ...first.map(key)]);
  const d = padGlosses(correct, [...first, ...rest].map((g) => g.meaning), 3);
  return { correct, distractors: [d[0] as string, d[1] as string, d[2] as string] };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rubric Judge                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

export function escapeRegex(s: string): string {
  return s.replace(RE_ESCAPE, '\\$&');
}

/** Strips 〜 / slot letters / spaces from a display pattern: `Vた + ことがある` → `ことがある`. */
export function patternCore(pattern: string): string {
  return pattern
    .replace(/[〜～~]/g, ' ')
    .replace(/\b[A-Za-z]+\d*\b/g, ' ')
    .replace(/[+＋/／()（）\[\]［］]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length)[0] ?? '';
}

/**
 * Rubric Judge for Final Form / Writing Dojo: "Does your sentence contain X?
 * Show it." Verified by `regex` — an alternation of the point's `clozeHints`
 * (longest first) plus the pattern's core when it is not already covered.
 */
export function rubricJudge(pattern: GrammarItem): { rubric: string; regex: string } {
  const parts = pattern.clozeHints.filter((h) => h.length > 0);
  const core = patternCore(pattern.pattern);
  if (core && !parts.includes(core) && !parts.some((p) => core.includes(p))) parts.push(core);
  const uniq = Array.from(new Set(parts)).sort((a, b) => b.length - a.length);
  const regex = uniq.length > 0 ? uniq.map(escapeRegex).join('|') : escapeRegex(toPlain(pattern.pattern));
  return { rubric: `Does your sentence contain ${pattern.pattern}? Show it.`, regex };
}

/** Applies a rubric regex to the learner's text (plain surface, ruby stripped). */
export function rubricPasses(regex: string, text: string): boolean {
  try {
    return new RegExp(regex, 'u').test(toPlain(text));
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Perception Judge                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Perception Judge for the shadow fallback: "which did you hear — きて or きって?"
 * `[word.kana, partner]` where the partner is the nearest kana neighbour in
 * `pool` (mora distance 1–2) or a synthesized minimal pair.
 */
export function perceptionJudge(word: VocabItem, pool: VocabItem[]): { minimalPair: [string, string] } {
  return { minimalPair: minimalPairPartner(word, pool) };
}
