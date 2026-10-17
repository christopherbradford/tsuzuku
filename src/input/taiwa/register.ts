/**
 * TSUZUKU — politeness register detection (design 04 §6 Say It Three Ways,
 * §8 Taiwa register switching; tag `register`).
 *
 * Marker families (runtime constants, never content): だ・です・でございます;
 * くれる・くださる・いただく; verb forms (plain / ます / honorific–humble).
 * A sentence is split into clauses at 。！？; quoted speech 「…」 is ignored
 * (the quote carries someone else's register); each clause is classified by
 * its FINAL predicate after sentence-final particles (ね・よ・か・な・の…) are
 * stripped, plus any keigo marker anywhere in the clause and a few lexical
 * set phrases (はい・うん・おはよう…). Subordinate plain forms before a ます
 * final are therefore fine (食べると思います → polite).
 *
 *   casual  plain forms, だ, contractions, bare fragments (dropping the copula
 *           is itself plain speech), casual interjections
 *   polite  です・ます・ございます・ください, polite set phrases
 *   keigo   a sonkeigo / kenjōgo marker with a polite final (でございます,
 *           いらっしゃいます, お〜ください, いただけますか, 申します …)
 *   mixed   casual and polite/keigo finals in one sentence, a casual
 *           interjection on a polite line, or an honorific verb in plain form
 */
import type { RegisterTag } from '../../content/types';
import { toPlain } from '../../content/ruby';
import { foldWidth } from '../../shared/jp';

export type MarkerRegister = 'casual' | 'polite' | 'keigo';
export type Register = MarkerRegister | 'mixed';

export interface Marker {
  /** The matched surface (predicate word, set phrase or keigo form). */
  surface: string;
  register: MarkerRegister;
  /** Offset in the plain, width-folded, space-free sentence. */
  index: number;
  kind: 'final' | 'keigo' | 'lexical';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tables                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Set phrases that are polite as a whole (checked piece by piece between 、). */
export const LEXICAL_POLITE: ReadonlySet<string> = new Set([
  'はい', 'いいえ', 'いえ', 'いえいえ', 'ええ', 'すみません', 'すいません', 'ありがとうございます', 'ありがとうございました',
  'おはようございます', 'こんにちは', 'こんばんは', 'おやすみなさい', 'さようなら', 'どうぞ', 'どうも', 'いただきます',
  'ごちそうさまでした', 'ごちそうさま', 'よろしくお願いします', 'よろしくお願いいたします', 'お願いします', 'お疲れ様です', 'お疲れさまです',
  'おめでとうございます', '失礼します', 'ごめんなさい', 'いってきます', 'いってらっしゃい', 'ただいま', 'おかえりなさい', 'はじめまして',
  'どういたしまして', 'お大事に', 'お先に失礼します', 'そうですね', 'そうですか', 'わかりました', '分かりました',
]);

/** Casual interjections and set phrases. */
export const LEXICAL_CASUAL: ReadonlySet<string> = new Set([
  'うん', 'ううん', 'へー', 'へえ', 'ふーん', 'ふうん', 'そっか', 'そうか', 'まじ', 'まじで', 'やば', 'やばい', 'じゃあ', 'じゃ', 'じゃあね', 'じゃね',
  'ねえ', 'ねー', 'おい', 'よし', 'ほら', 'さあ', 'おはよう', 'おやすみ', 'ありがと', 'ありがとう', 'ごめん', 'ごめんね', 'やだ', 'うそ', 'えっ',
  'ばいばい', 'バイバイ', 'またね', 'また明日', 'おつかれ', 'お疲れ', 'おっす', 'ういっす', 'うっす', 'おう', 'そうなんだ', 'なんで',
]);

/** Keigo set phrases. */
export const LEXICAL_KEIGO: ReadonlySet<string> = new Set([
  'かしこまりました', '承知いたしました', '承知しました', '恐れ入ります', '失礼いたします', 'お疲れ様でございます', 'いらっしゃいませ',
  'お待たせしました', 'お待たせいたしました', 'ありがとうございます、お客様', 'お世話になっております',
]);

/** Register-neutral aizuchi: no marker, but a clause made only of them is not a "bare fragment". */
export const LEXICAL_NEUTRAL: ReadonlySet<string> = new Set(['なるほど', 'そう', 'あ', 'あっ', 'え', 'ん', 'まあ', 'えっと', 'あの', 'あのう', 'ええと']);

/** Sentence-final particles stripped before the predicate check. */
const FINAL_PARTICLES_RE = /(?:よね|かな|かしら|っけ|のよ|のね|わよ|わね|もん|ぞ|ぜ|さ|よ|ね|か|な|わ|の)+$/;
const PUNCT_EDGE_RE = /^[、。！？!?…・「」『』()（）\s]+|[、。！？!?…・「」『』()（）\s]+$/g;
const QUOTE_RE = /「[^」]*」|『[^』]*』/g;
const CLAUSE_SPLIT_RE = /(?<=[。！？!?…])/;

/** Keigo forms (sonkeigo / kenjōgo / formal copula), matched anywhere in a clause. */
export const KEIGO_RE = new RegExp(
  [
    'でございま',
    'でござい',
    'いらっしゃ',
    'おっしゃ',
    'なさ(?:いま|る|った|らない|いませ|れ)',
    'くださ(?:いま|る|った|らない|いませ|れ)',
    'いただ(?:き|く|け|い)',
    'いたし(?:ます|ました|ません|て)|いたす',
    '申し(?:ます|ました|上げ)|申す',
    '参り(?:ます|ました|ません)|参る',
    '伺(?:い|う|っ)',
    'おり(?:ます|ました|ません)',
    '存じ',
    '拝見|拝借|拝読|拝聴',
    '差し上げ',
    'させていただ',
    'ご覧',
    '召し上が',
    'お[^\\sをはがにでとへもの、。！？!?]{1,6}(?:になり|になる|になっ|いたし|します|しました|ください|くださ)',
    'ご[^\\sをはがにでとへもの、。！？!?]{1,4}(?:になり|になる|になっ|いたし|します|しました|ください|くださ|いただ)',
  ].join('|'),
  'g',
);

/** Polite finals (after particle stripping). */
const POLITE_FINAL_RE = /(ませんでした|ましょう|ました|ません|ます|でしょう|でした|です|ございました|ございます|くださいませ|ください|なさい|ませ)$/;

/** Casual finals, most specific first. Anything not polite with a predicate shape is plain. */
const CASUAL_FINAL_RE = new RegExp(
  [
    '(?:ちゃった|じゃった|ちゃう|じゃう|てる|でる|なきゃ|なくちゃ|とく|とこう|ちゃだめ|じゃだめ|っす|でしょ|だろ|かも|じゃん|んだ|のだ|だって|だもん)$',
    '(?:じゃなかった|ではなかった|じゃない|ではない|だった|だろう|だ)$',
    '(?:なかった|ない|た|だ)$',
    '(?:て|で)$',
    '[うくぐすつぬぶむる]$',
    '[えけげせねべめれ]$|ろ$|こい$',
    'い$',
  ].join('|'),
);

/** Tokens the final-word extractor stops at. */
const WORD_TAIL_RE = /([^をはがにでとへもの、。\s]+)$/;

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Plain surface, NFKC, quotes removed, whitespace collapsed away. */
export function normalizeForRegister(sentence: string): string {
  return foldWidth(toPlain(sentence)).replace(QUOTE_RE, '').replace(/[\s　]+/g, '');
}

/** Clause texts with their offsets in the normalized sentence. */
export function splitClauses(normalized: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  let pos = 0;
  for (const part of normalized.split(CLAUSE_SPLIT_RE)) {
    const idx = pos;
    pos += part.length;
    const text = part.replace(PUNCT_EDGE_RE, '');
    if (text.length > 0) out.push({ text, index: idx });
  }
  return out;
}

/** Strips sentence-final particles (ね・よ・か・な・の・よね・かな …) from a clause. */
export function stripFinalParticles(clause: string): string {
  const core = clause.replace(FINAL_PARTICLES_RE, '');
  // Never strip a clause down to nothing (the clause WAS the particle).
  return core.length > 0 ? core : clause;
}

function finalWord(core: string): string {
  const m = WORD_TAIL_RE.exec(core);
  return m ? (m[1] as string) : core;
}

interface ClauseAnalysis {
  markers: Marker[];
  register: Register | null;
  neutral: boolean;
}

function analyzeClause(text: string, index: number): ClauseAnalysis {
  const markers: Marker[] = [];
  let neutral = false;
  const lexical = new Set<MarkerRegister>();

  // Lexical pieces between 、
  let off = 0;
  for (const raw of text.split('、')) {
    const piece = raw.replace(PUNCT_EDGE_RE, '');
    const at = index + off;
    off += raw.length + 1;
    if (piece.length === 0) continue;
    if (LEXICAL_KEIGO.has(piece)) {
      markers.push({ surface: piece, register: 'keigo', index: at, kind: 'lexical' });
      lexical.add('keigo');
    } else if (LEXICAL_POLITE.has(piece)) {
      markers.push({ surface: piece, register: 'polite', index: at, kind: 'lexical' });
      lexical.add('polite');
    } else if (LEXICAL_CASUAL.has(piece)) {
      markers.push({ surface: piece, register: 'casual', index: at, kind: 'lexical' });
      lexical.add('casual');
    } else if (LEXICAL_NEUTRAL.has(piece)) {
      neutral = true;
    }
  }

  const pieces = text.split('、').map((p) => p.replace(PUNCT_EDGE_RE, ''));
  const lastPiece = pieces[pieces.length - 1] ?? '';
  const wholeLexical = pieces.every((p) => p.length === 0 || LEXICAL_KEIGO.has(p) || LEXICAL_POLITE.has(p) || LEXICAL_CASUAL.has(p) || LEXICAL_NEUTRAL.has(p));

  // Keigo anywhere (set phrases excluded: いただきます alone is the table grace).
  const keigo: Marker[] = [];
  if (!wholeLexical) {
    for (const m of text.matchAll(KEIGO_RE)) {
      const surface = m[0];
      keigo.push({ surface, register: 'keigo', index: index + (m.index ?? 0), kind: 'keigo' });
    }
  }
  markers.push(...keigo);

  // Final predicate
  let final: Marker | null = null;
  if (!wholeLexical && !(LEXICAL_POLITE.has(lastPiece) || LEXICAL_CASUAL.has(lastPiece) || LEXICAL_KEIGO.has(lastPiece))) {
    const core = stripFinalParticles(text);
    const word = finalWord(core);
    const at = index + Math.max(0, core.length - word.length);
    if (POLITE_FINAL_RE.test(core)) final = { surface: word, register: 'polite', index: at, kind: 'final' };
    else if (CASUAL_FINAL_RE.test(core)) final = { surface: word, register: 'casual', index: at, kind: 'final' };
    else if (core.length > 0 && !neutral) final = { surface: word, register: 'casual', index: at, kind: 'final' }; // bare fragment = plain
    if (final) {
      // A keigo form that closes the clause IS the predicate: start the final marker there.
      const closing = keigo.find((k) => k.index + k.surface.length === index + core.length && k.index > (final as Marker).index);
      if (closing) final = { ...final, surface: core.slice(closing.index - index), index: closing.index };
      markers.push(final);
    }
  }

  markers.sort((a, b) => a.index - b.index);

  let register: Register | null = null;
  if (keigo.length > 0 || lexical.has('keigo')) {
    register = final?.register === 'casual' || lexical.has('casual') ? 'mixed' : 'keigo';
  } else if (final) {
    const other: MarkerRegister = final.register === 'casual' ? 'polite' : 'casual';
    register = lexical.has(other) ? 'mixed' : final.register;
  } else if (lexical.has('casual') && lexical.has('polite')) {
    register = 'mixed';
  } else if (lexical.has('polite')) {
    register = 'polite';
  } else if (lexical.has('casual')) {
    register = 'casual';
  }
  return { markers, register, neutral };
}

function analyze(sentence: string): { clauses: ClauseAnalysis[]; markers: Marker[] } {
  const normalized = normalizeForRegister(sentence);
  const clauses = splitClauses(normalized).map((c) => analyzeClause(c.text, c.index));
  const markers = clauses.flatMap((c) => c.markers).sort((a, b) => a.index - b.index);
  return { clauses, markers };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** Every register marker found, in order (predicate words, set phrases, keigo forms). */
export function markersDetailed(sentence: string): Marker[] {
  return analyze(sentence).markers;
}

/** Marker surfaces in order. */
export function markers(sentence: string): string[] {
  return markersDetailed(sentence).map((m) => m.surface);
}

/**
 * Register of a learner's line. Plain finals or no predicate at all → casual;
 * です・ます → polite; keigo forms with a polite final → keigo; a clash of
 * finals (or a casual interjection on a polite line, or an honorific verb in
 * plain form) → mixed. A line of only neutral aizuchi (なるほど) → polite.
 */
export function detectRegister(sentence: string): Register {
  const { clauses } = analyze(sentence);
  const regs = new Set<Register>();
  let neutral = false;
  for (const c of clauses) {
    if (c.register) regs.add(c.register);
    if (c.neutral) neutral = true;
  }
  if (regs.has('mixed')) return 'mixed';
  const casual = regs.has('casual');
  const formal = regs.has('polite') || regs.has('keigo');
  if (casual && formal) return 'mixed';
  if (regs.has('keigo')) return 'keigo';
  if (regs.has('polite')) return 'polite';
  if (casual) return 'casual';
  return neutral ? 'polite' : 'casual';
}

/** The register a content `RegisterTag` asks for (`StoryLine.registerTarget`, `GrammarItem.register`). */
export function registerFor(tag: RegisterTag): MarkerRegister {
  switch (tag) {
    case 'honorific':
    case 'humble':
    case 'formal':
      return 'keigo';
    case 'casual':
    case 'slang':
    case 'dialect':
      return 'casual';
    case 'polite':
    case 'neutral':
    case 'written':
    case 'literary':
    default:
      return 'polite';
  }
}

/**
 * Does the line meet the target? `neutral` accepts anything consistent (not
 * mixed); `polite` accepts polite or keigo (more polite than needed is not a
 * register slip); `casual` and keigo targets need exactly that register.
 */
export function registerMatches(sentence: string, target: RegisterTag): boolean {
  const r = detectRegister(sentence);
  if (target === 'neutral') return r !== 'mixed';
  const t = registerFor(target);
  if (t === 'polite') return r === 'polite' || r === 'keigo';
  return r === t;
}
