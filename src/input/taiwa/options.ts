/**
 * TSUZUKU — Taiwa learner-line options and grading (design 04 §8).
 *
 *  chooseOptions()  Choose mode. `StoryLine.options` written by the Pass 2
 *                   writer (V27) are returned verbatim (recast defaulting to
 *                   the gold line). Synthesis is a FALLBACK for a line without
 *                   them: best = gold; register-wrong = the gold line swapped
 *                   to the opposite register (です⇄だ, ます-forms ⇄ plain via
 *                   `learn/conjugate`); grammar-wrong = a particle swap, else a
 *                   ます-glitch (飲むます), else a stray です; ok = a shorter
 *                   natural variant (interjection / topic dropped, ね added).
 *  buildTiles()     Build mode tiles from `tokens` (punctuation dropped,
 *                   deterministic shuffle, never the gold order).
 *  gradeOption() / gradeTyped() / gradeBuild()
 *                   correctness + error tags (`register`, `particle`,
 *                   `conjugation`, `word-order`, `word-choice`). The register
 *                   check (`registerAcceptable`) passes an answer in the
 *                   target register OR in the gold line's own register: the
 *                   model line can never be a register slip, even where the
 *                   scene's target disagrees with it (review round 2, #1).
 *
 * Deterministic: every draw goes through the injected `rng`.
 */
import type { ContentItem, ErrorTag, RegisterTag, StoryLine, VocabItem } from '../../content/types';
import { toPlain } from '../../content/ruby';
import { conjugate, isConjugable, scrambleTiles } from '../../learn';
import { pick, shuffle, type Rng } from '../../shared/hash';
import { equivalentJa, nearMissKind, normalizeAnswer, normalizeJa, type NearMissKind } from '../../shared/jp';
import { detectRegister, markersDetailed, registerFor, registerMatches, type MarkerRegister } from './register';

export type OptionKind = 'best' | 'ok' | 'register-wrong' | 'grammar-wrong';

/** `learn/conjugate` result shape, derived from the barrel export (the type itself is not re-exported). */
type Conjugation = NonNullable<ReturnType<typeof conjugate>>;

export interface DialogueOption {
  text: string;
  kind: OptionKind;
  /** The model line shown as the implicit correction (the gold line for every option). */
  recast: string;
}

export interface OptionContext {
  /** The register the learner's line is scored against (`registerTarget` in force, else the gold line's own register, else the story register). */
  register: RegisterTag;
  get: (id: string) => ContentItem | undefined;
  rng: Rng;
}

/** Case particles a learner swaps (Particle Duel keys). */
export const PARTICLES: readonly string[] = ['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の', 'も'];

/** The plausible wrong partner of each particle. */
const PARTICLE_SWAP: Readonly<Record<string, string>> = {
  は: 'を',
  が: 'を',
  を: 'が',
  に: 'で',
  で: 'に',
  と: 'に',
  へ: 'に',
  から: 'まで',
  まで: 'から',
  より: 'から',
  の: 'が',
  も: 'は',
};

const INTERJECTIONS: ReadonlySet<string> = new Set(['はい', 'ええ', 'うん', 'いいえ', 'いえ', 'おはよう', 'おはようございます', 'こんにちは', 'こんばんは', 'すみません', 'あ', 'あの', 'えっと', 'ねえ', 'じゃあ', 'なるほど', 'そうですね', 'そっか', 'へえ', 'へー']);

function isPunct(t: string): boolean {
  return normalizeJa(t).length === 0;
}

function isVocab(i: ContentItem | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i;
}

function key(s: string): string {
  return normalizeAnswer(s);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Register swap                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

interface Tok {
  text: string;
  item: VocabItem | undefined;
}

function toks(line: StoryLine, get: OptionContext['get']): Tok[] {
  return line.tokens.map((text, i) => {
    const id = line.tokenIds?.[i];
    const item = id ? get(id) : undefined;
    return { text, item: isVocab(item) ? item : undefined };
  });
}

/** Spell a conjugation like the token: kanji when the token carried kanji, kana otherwise. */
function spell(c: Conjugation, likeToken: string): string {
  return /[㐀-䶿一-鿿々〆]/.test(likeToken) ? c.answer : c.answerKana;
}

function conj(item: VocabItem, form: Parameters<typeof conjugate>[3]): Conjugation | null {
  if (!isConjugable(item.pos)) return null;
  return conjugate(item.word, item.kana, item.pos, form);
}

/** Polite → plain, token by token. Returns `null` when nothing changed. */
function toCasual(tokens: Tok[]): string[] | null {
  const out = tokens.map((t) => t.text);
  let changed = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Tok;
    const prev = tokens[i - 1];
    if (t.text === 'です') {
      // い-adjective + です → drop; noun + です → だ
      const prevIsIAdj = prev?.item?.pos === 'adj-i' || (!!prev && !prev.item && /[^っ]い$/.test(prev.text) && prev.text.length >= 2);
      out[i] = prevIsIAdj ? '' : 'だ';
      changed = true;
      continue;
    }
    if (t.text === 'でした') {
      out[i] = 'だった';
      changed = true;
      continue;
    }
    if (t.text === 'か' && i > 0 && (tokens[i - 1]?.text === 'です' || /ます$/.test(tokens[i - 1]?.text ?? ''))) {
      out[i] = '';
      changed = true;
      continue;
    }
    if (t.item && isConjugable(t.item.pos)) {
      const forms: [RegExp, Parameters<typeof conjugate>[3] | 'dict'][] = [
        [/ませんでした$/, 'nakatta'],
        [/ましょう$/, 'volitional'],
        [/ました$/, 'ta'],
        [/ません$/, 'nai'],
        [/ます$/, 'dict'],
      ];
      for (const [re, form] of forms) {
        if (!re.test(t.text)) continue;
        const c = form === 'dict' ? { answer: t.item.word, answerKana: t.item.kana, alt: [] } : conj(t.item, form);
        if (c) {
          out[i] = spell(c, t.text);
          changed = true;
        }
        break;
      }
    }
  }
  return changed ? out : null;
}

/** Plain → polite, token by token. Returns `null` when nothing changed. */
function toPolite(tokens: Tok[]): string[] | null {
  const out = tokens.map((t) => t.text);
  let changed = false;
  const lastContent = (() => {
    for (let i = tokens.length - 1; i >= 0; i--) if (!isPunct((tokens[i] as Tok).text)) return i;
    return -1;
  })();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Tok;
    if (t.text === 'だ') {
      out[i] = 'です';
      changed = true;
      continue;
    }
    if (t.text === 'だった') {
      out[i] = 'でした';
      changed = true;
      continue;
    }
    if (t.item && isConjugable(t.item.pos)) {
      const item = t.item;
      const isVerb = item.pos === 'v1' || item.pos === 'v5' || item.pos === 'v-irr';
      if (isVerb) {
        const candidates: [string | undefined, Parameters<typeof conjugate>[3]][] = [
          [item.word, 'masu'],
          [item.kana, 'masu'],
          [conj(item, 'ta')?.answer, 'mashita'],
          [conj(item, 'ta')?.answerKana, 'mashita'],
          [conj(item, 'nai')?.answer, 'masen'],
          [conj(item, 'nai')?.answerKana, 'masen'],
          [conj(item, 'nakatta')?.answer, 'masen-deshita'],
          [conj(item, 'nakatta')?.answerKana, 'masen-deshita'],
          [conj(item, 'volitional')?.answer, 'masho'],
          [conj(item, 'volitional')?.answerKana, 'masho'],
        ];
        const hit = candidates.find(([surface]) => surface !== undefined && surface === t.text);
        if (hit) {
          const c = conj(item, hit[1]);
          if (c) {
            out[i] = spell(c, t.text);
            changed = true;
          }
          continue;
        }
      } else if (item.pos === 'adj-i' && i === lastContent && (t.text === item.word || t.text === item.kana)) {
        out[i] = t.text + 'です';
        changed = true;
        continue;
      }
    }
    if (i === lastContent && !changed && t.item && (t.item.pos === 'n' || t.item.pos === 'pron' || t.item.pos === 'adj-na' || t.item.pos === 'n-adv')) {
      out[i] = t.text + 'です';
      changed = true;
    }
  }
  return changed ? out : null;
}

/**
 * The gold line rewritten in the register the target is NOT: polite/keigo
 * targets get a plain version, a casual target gets a polite one. `null` when
 * no marker could be swapped.
 */
export function swapRegister(line: StoryLine, ctx: Pick<OptionContext, 'register' | 'get'>): string | null {
  const target: MarkerRegister = registerFor(ctx.register);
  const tokens = toks(line, ctx.get);
  const swapped = target === 'casual' ? toPolite(tokens) : toCasual(tokens);
  if (!swapped) return null;
  const text = swapped.join('').replace(/、。/g, '。');
  const gold = toPlain(line.ja);
  if (key(text) === key(gold) || key(text).length === 0) return null;
  return text;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Grammar-wrong and ok variants                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/** Particle swap first, then a ます-glitch (飲むます), then a stray です. */
export function grammarWrong(line: StoryLine, ctx: Pick<OptionContext, 'get' | 'rng'>): string | null {
  const tokens = toks(line, ctx.get);
  const gold = toPlain(line.ja);
  const particleIdx = tokens.map((t, i) => (PARTICLES.includes(t.text) ? i : -1)).filter((i) => i >= 0);
  if (particleIdx.length > 0) {
    const i = pick(ctx.rng, particleIdx);
    const cur = (tokens[i] as Tok).text;
    let wrong = PARTICLE_SWAP[cur] ?? cur;
    if (wrong === cur) wrong = pick(ctx.rng, PARTICLES.filter((p) => p !== cur));
    const out = tokens.map((t, j) => (j === i ? wrong : t.text)).join('');
    if (key(out) !== key(gold)) return out;
  }
  const verbIdx = tokens.findIndex((t) => t.item && isConjugable(t.item.pos) && /ます$/.test(t.text));
  if (verbIdx >= 0) {
    const t = tokens[verbIdx] as Tok;
    const dict = /[㐀-䶿一-鿿々〆]/.test(t.text) ? (t.item as VocabItem).word : (t.item as VocabItem).kana;
    const out = tokens.map((x, j) => (j === verbIdx ? dict + 'ます' : x.text)).join('');
    if (key(out) !== key(gold)) return out;
  }
  // A stray です after a plain predicate / before a comma (おはようです、ケン)
  const first = tokens.findIndex((t) => !isPunct(t.text));
  if (first >= 0 && !/です$/.test((tokens[first] as Tok).text)) {
    const out = tokens.map((x, j) => (j === first ? x.text + 'です' : x.text)).join('');
    if (key(out) !== key(gold)) return out;
  }
  return null;
}

const POLITE_SUFFIX_RE = /(ませんでした|ましょう|ました|ません|ます)$/;
const I_ROW_RE = /[いきぎしじちにひびぴみり]$/;

/**
 * Surfaces that count as "the word is there": the word itself, its ます-stem
 * (飲みます → 飲み) and, when that stem still identifies the word, the stem
 * without its final い-row kana (飲 → matches 飲む / 飲んだ; たべ matches たべる).
 */
export function stemsOf(word: string): string[] {
  const out = [word];
  const stem = word.replace(POLITE_SUFFIX_RE, '');
  if (stem !== word && stem.length > 0) {
    out.push(stem);
    const shorter = stem.replace(I_ROW_RE, '');
    if (shorter !== stem && shorter.length > 0 && (/[㐀-䶿一-鿿々〆]/.test(shorter) || shorter.length >= 2)) out.push(shorter);
  }
  return out;
}

/** `mustInclude` words missing from `text` (normalized; a conjugated form of the word counts). */
export function includesAll(text: string, must: readonly string[] | undefined): string[] {
  const k = key(text);
  return (must ?? []).filter((w) => !stemsOf(w).some((st) => k.includes(key(st))));
}

/** A shorter / softer natural variant that keeps `mustInclude`. */
export function okVariant(line: StoryLine): string | null {
  const gold = toPlain(line.ja);
  const tokens = line.tokens;
  const tryOut = (t: string[]): string | null => {
    const text = t.join('');
    if (key(text).length === 0 || key(text) === key(gold)) return null;
    if (includesAll(text, line.mustInclude).length > 0) return null;
    return text;
  };
  // 1. drop a leading interjection + 、
  if (tokens.length >= 3 && INTERJECTIONS.has(tokens[0] as string) && tokens[1] === '、') {
    const v = tryOut(tokens.slice(2));
    if (v) return v;
  }
  // 2. drop a leading topic X は / X も
  const start = INTERJECTIONS.has(tokens[0] as string) && tokens[1] === '、' ? 2 : 0;
  if (tokens.length >= start + 3 && (tokens[start + 1] === 'は' || tokens[start + 1] === 'も') && !isPunct(tokens[start] as string)) {
    const v = tryOut([...tokens.slice(0, start), ...tokens.slice(start + 2)]);
    if (v) return v;
  }
  // 3. add / remove a softening ね
  const lastIdx = tokens.length - 1;
  const endsPunct = lastIdx >= 0 && isPunct(tokens[lastIdx] as string);
  const predIdx = endsPunct ? lastIdx - 1 : lastIdx;
  if (predIdx >= 0) {
    if (tokens[predIdx] === 'ね') {
      const v = tryOut([...tokens.slice(0, predIdx), ...tokens.slice(predIdx + 1)]);
      if (v) return v;
    } else if (/(です|ます|だ|る|う|い)$/.test(tokens[predIdx] as string)) {
      const v = tryOut([...tokens.slice(0, predIdx + 1), 'ね', ...tokens.slice(predIdx + 1)]);
      if (v) return v;
    }
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* chooseOptions                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Choose-mode options for a learner line. Content options are returned
 * verbatim (shuffled with `rng`, recasts defaulting to the gold line); a line
 * without them gets a synthesized set: exactly one `best`, 2–3 distinct wrong
 * / ok options, deterministic for a given `rng`.
 */
export function chooseOptions(line: StoryLine, ctx: OptionContext): DialogueOption[] {
  const gold = toPlain(line.ja);
  if (line.options && line.options.length > 0) {
    const bestText = line.options.find((o) => o.kind === 'best')?.text ?? gold;
    return shuffle(
      ctx.rng,
      line.options.map((o) => ({ text: o.text, kind: o.kind, recast: o.recast ?? bestText })),
    );
  }
  const out: DialogueOption[] = [{ text: gold, kind: 'best', recast: gold }];
  const seen = new Set([key(gold)]);
  const add = (text: string | null, kind: OptionKind): void => {
    if (!text) return;
    const k = key(text);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text, kind, recast: gold });
  };
  add(swapRegister(line, ctx), 'register-wrong');
  add(grammarWrong(line, ctx), 'grammar-wrong');
  add(okVariant(line), 'ok');
  return shuffle(ctx.rng, out);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Build tiles                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Build-mode tiles: the line's tokens without punctuation, shuffled, never in the gold order. */
export function buildTiles(line: StoryLine, rng: Rng): string[] {
  const tiles = line.tokens.filter((t) => !isPunct(t));
  if (tiles.length <= 1) return tiles;
  return scrambleTiles(line, tiles, rng);
}

/** Gold tile order (what `buildTiles` scrambles). */
export function goldTiles(line: StoryLine): string[] {
  return line.tokens.filter((t) => !isPunct(t));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Grading                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface OptionGrade {
  correct: boolean;
  best: boolean;
  tags: ErrorTag[];
}

/** Which grammar slip a wrong text shows against the gold line. */
export function grammarTagFor(wrong: string, gold: string): ErrorTag {
  const a = Array.from(key(wrong)).sort().join('');
  const b = Array.from(key(gold)).sort().join('');
  if (a === b) return 'word-order';
  const diff = charDiff(key(wrong), key(gold));
  if (diff.every((ch) => PARTICLES.some((p) => key(p) === ch))) return 'particle';
  return 'conjugation';
}

/** Multiset difference of characters between two strings (both directions). */
function charDiff(a: string, b: string): string[] {
  const count = new Map<string, number>();
  for (const ch of a) count.set(ch, (count.get(ch) ?? 0) + 1);
  for (const ch of b) count.set(ch, (count.get(ch) ?? 0) - 1);
  const out: string[] = [];
  for (const [ch, n] of count) if (n !== 0) out.push(ch);
  return out;
}

export function gradeOption(option: Pick<DialogueOption, 'kind' | 'text'>, gold: string): OptionGrade {
  switch (option.kind) {
    case 'best':
      return { correct: true, best: true, tags: [] };
    case 'ok':
      return { correct: true, best: false, tags: [] };
    case 'register-wrong':
      return { correct: false, best: false, tags: ['register'] };
    case 'grammar-wrong':
    default:
      return { correct: false, best: false, tags: [grammarTagFor(option.text, gold)] };
  }
}

export interface TypedGrade extends OptionGrade {
  /** A Block (small-kana / vowel-length / transcription slip against the gold line). */
  nearMiss: NearMissKind | null;
  /** `mustInclude` words missing from the answer. */
  missing: string[];
  registerOk: boolean;
  recast: string;
}

/**
 * Register check for a typed / spoken line: the answer meets `target`, or it
 * is in the same register as the gold line itself (`detectRegister` of both
 * agree), or it carries no register marker at all (a fragment: 冬に、たぶん。).
 * A writer's model line is the register the scene really wants, so a learner
 * who speaks like it is never tagged `register` — even where the story-level
 * register or a `registerTarget` disagrees with that line (an aside to a
 * friend inside a polite scene, a polite line to an elder in a casual
 * dialogue).
 */
export function registerAcceptable(answer: string, gold: string, target: RegisterTag): boolean {
  if (registerMatches(answer, target)) return true;
  if (markersDetailed(answer).length === 0) return true;
  return detectRegister(answer) === detectRegister(gold);
}

/**
 * Type / Speak mode: exact match against plain `ja` ∪ `accept[]` → best;
 * a Block against the gold line → near miss (Hard); otherwise correct when
 * every `mustInclude` word is present and the register is acceptable
 * (`registerAcceptable`: the target, or the gold line's own register) → `ok`,
 * else wrong with `register` / `word-choice` tags.
 */
export function gradeTyped(answer: string, line: StoryLine, ctx: Pick<OptionContext, 'register'>): TypedGrade {
  const gold = toPlain(line.ja);
  // The kanji surface, its kana reading, and every listed alternative are all exact answers (design 04 §0).
  const accepted = [gold, line.kana, ...(line.accept ?? [])].filter((a) => a.length > 0);
  const registerOk = registerAcceptable(answer, gold, ctx.register);
  const base = { nearMiss: null as NearMissKind | null, missing: [] as string[], registerOk, recast: gold };
  if (key(answer).length === 0) return { ...base, correct: false, best: false, tags: ['word-choice'], missing: line.mustInclude ?? [] };
  if (accepted.some((a) => equivalentJa(answer, a))) return { ...base, correct: true, best: true, tags: [], registerOk: true };
  const near = accepted.map((a) => nearMissKind(answer, a)).find((k) => k !== null) ?? null;
  if (near) return { ...base, correct: true, best: false, nearMiss: near, tags: [near] };
  const missing = includesAll(answer, line.mustInclude);
  const tags: ErrorTag[] = [];
  if (missing.length > 0) tags.push('word-choice');
  if (!registerOk) tags.push('register');
  if (tags.length === 0) return { ...base, correct: true, best: false, tags: [] };
  return { ...base, correct: false, best: false, tags, missing };
}

/** Build mode: the tile order equals the gold order (or a listed `accept` surface). */
export function gradeBuild(order: readonly string[], line: StoryLine): OptionGrade {
  const text = order.join('');
  const gold = goldTiles(line).join('');
  if (key(text) === key(gold) || (line.accept ?? []).some((a) => equivalentJa(text, a))) return { correct: true, best: true, tags: [] };
  return { correct: false, best: false, tags: ['word-order'] };
}

/** Register of a typed line, for the debrief meter. */
export function lineRegister(text: string): ReturnType<typeof detectRegister> {
  return detectRegister(text);
}
