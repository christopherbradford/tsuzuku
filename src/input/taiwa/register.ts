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
 *   casual  plain forms, だ, contractions, noun fragments that dropped the
 *           copula (これ、ほんとう？), casual interjections (うん・へー・ごめん)
 *   polite  です・ます・ございます・ください, polite set phrases
 *   keigo   a sonkeigo / kenjōgo marker with a polite final (でございます,
 *           いらっしゃいます, お〜ください, いただけますか, 申します …)
 *   mixed   casual and polite/keigo finals in one sentence, a casual
 *           interjection on a polite line, or an honorific verb in plain form
 *
 * What carries NO register (review round 2, #2): a clause with no predicate
 * shape — an echo question or exclamation (かたで？ 十一回！), a piece ending in a
 * case particle or a name honorific (ほんとうに。 田中さん！), a short fragment
 * (晴れ。), a trailing subordinate clause ending in たら・ば・けど・から・ので・
 * のに・し whose remainder is not polite (京都からもどってきたら。), while a
 * trailing て-form after a polite connective (〜んですが、降ってきて。) is
 * polite; and the
 * "soft" set phrases はい・ええ・いいえ・いただきます・どうぞ… that both
 * registers use: they read polite only when a line is made of nothing else
 * (はい。 → polite), and never clash with a final (はい、食べる。 → casual).
 * A line of only such fragments falls back to casual (no predicate = plain).
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

/** Set phrases that are polite as a whole (checked piece by piece between 、) and contrast with a casual final. */
export const LEXICAL_POLITE: ReadonlySet<string> = new Set([
  'すみません', 'すいません', 'ありがとうございます', 'ありがとうございました',
  'おはようございます', 'こんにちは', 'こんばんは', 'おやすみなさい', 'さようなら',
  'ごちそうさまでした', 'よろしくお願いします', 'よろしくお願いいたします', 'お願いします', 'お疲れ様です', 'お疲れさまです', 'お疲れ様でした', 'お疲れさまでした',
  'おめでとうございます', '失礼します', 'ごめんなさい', 'いってきます', 'いってらっしゃい', 'ただいま', 'おかえりなさい', 'はじめまして',
  'どういたしまして', 'お大事に', 'お先に失礼します', 'そうですね', 'そうですか', 'わかりました', '分かりました',
]);

/**
 * Soft polite set phrases: polite on their own (はい。 いただきます。) but used in
 * casual speech too, so they never make a line with a casual final `mixed`.
 */
export const LEXICAL_SOFT_POLITE: ReadonlySet<string> = new Set(['はい', 'いいえ', 'いえ', 'いえいえ', 'ええ', 'どうぞ', 'どうも', 'いただきます', 'ごちそうさま']);

/** Casual interjections and set phrases. */
export const LEXICAL_CASUAL: ReadonlySet<string> = new Set([
  'うん', 'ううん', 'へー', 'へえ', 'ふーん', 'ふうん', 'そっか', 'そうか', 'まじ', 'まじで', 'やば', 'やばい', 'じゃあね', 'じゃね',
  'ねえ', 'ねー', 'おい', 'よし', 'ほら', 'さあ', 'おはよう', 'おやすみ', 'ありがと', 'ありがとう', 'ごめん', 'ごめんね', 'やだ', 'うそ',
  'ばいばい', 'バイバイ', 'またね', 'おつかれ', 'お疲れ', 'おっす', 'ういっす', 'うっす', 'おう', 'そうなんだ', 'なんで',
]);

/** Keigo set phrases. */
export const LEXICAL_KEIGO: ReadonlySet<string> = new Set([
  'かしこまりました', '承知いたしました', '承知しました', '恐れ入ります', '失礼いたします', 'お疲れ様でございます', 'いらっしゃいませ',
  'お待たせしました', 'お待たせいたしました', 'ありがとうございます、お客様', 'お世話になっております',
]);

/** Register-neutral aizuchi, fillers and standalone adverbs: no marker, but a clause made only of them is not a "bare fragment". */
export const LEXICAL_NEUTRAL: ReadonlySet<string> = new Set([
  'なるほど', 'そう', 'あ', 'あっ', 'え', 'えっ', 'ん', 'まあ', 'えっと', 'あの', 'あのう', 'ええと', 'じゃあ', 'じゃ', 'では', 'また明日',
  'たぶん', 'きっと', 'もちろん', 'ちょっと', 'もう', 'まだ', 'また', 'ぜひ', 'どうか', 'かならず', 'すぐ',
]);

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
    '(?:て|[んい]で)$', // te-form で follows ん/い (飲んで, およいで); かたで / 工場で is a case particle
    '[うくぐすつぬぶむる]$',
    '[えけげせねべめれ]$|ろ$|こい$',
    'い$',
  ].join('|'),
);

/** Tokens the final-word extractor stops at. */
const WORD_TAIL_RE = /([^をはがにでとへもの、。\s]+)$/;

/** A piece ending in a case particle (ほんとうに。 かたで？ 日本橋から。) is a fragment, not a dropped copula. */
const PARTICLE_END_RE = /(?:から|まで|より|[をはがにでとへも])$/;
/** A piece ending in a name honorific or a title is a vocative (田中さん！). */
const VOCATIVE_END_RE = /(?:さん|さま|様|くん|ちゃん|先生|たち)$/;
/** Trailing subordinate connectives: the clause before them is plain by grammar, so only a polite remainder marks it. */
const CONNECTIVE_END_RE = /(?:たら|だら|れば|ければ|えば|けれども|けれど|けど|から|ので|のに|し)$/;
/** A fragment this short (晴れ。 本気？) never counts as a dropped copula. */
const BARE_MIN_LEN = 3;
/** A polite connective earlier in the clause (〜んですが、 〜ますから、): a trailing て-form after it is polite speech trailing off. */
const POLITE_CONNECTIVE_RE = /(?:です|ます|ません|でした|ました)(?:が|けど|けれど|から|ので|のに|し)、/;
/** The te-form branch of CASUAL_FINAL_RE (a trailing て / 飲んで). */
const TE_FINAL_RE = /(?:て|[んい]で)$/;

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Plain surface, NFKC (an ellipsis folds to dots and is restored, so clauses still split at it), quotes removed, whitespace collapsed away. */
export function normalizeForRegister(sentence: string): string {
  return foldWidth(toPlain(sentence)).replace(/\.{2,}/g, '…').replace(QUOTE_RE, '').replace(/[\s　]+/g, '');
}

interface Clause {
  text: string;
  index: number;
  /** The clause closed with ？ or ！ (an echo question or exclamation). */
  echo: boolean;
}

function splitClausesDetailed(normalized: string): Clause[] {
  const out: Clause[] = [];
  let pos = 0;
  for (const part of normalized.split(CLAUSE_SPLIT_RE)) {
    const idx = pos;
    pos += part.length;
    const text = part.replace(PUNCT_EDGE_RE, '');
    if (text.length > 0) out.push({ text, index: idx, echo: /[？！?!]$/.test(part) });
  }
  return out;
}

/** Clause texts with their offsets in the normalized sentence. */
export function splitClauses(normalized: string): { text: string; index: number }[] {
  return splitClausesDetailed(normalized).map((c) => ({ text: c.text, index: c.index }));
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
  /** The clause is made only of neutral / soft set phrases (なるほど, はい). */
  neutral: boolean;
  /** `register` rests on soft set phrases alone (はい。): it yields to any clause with a real marker. */
  weak: boolean;
}

function isLexical(piece: string): boolean {
  return LEXICAL_KEIGO.has(piece) || LEXICAL_POLITE.has(piece) || LEXICAL_SOFT_POLITE.has(piece) || LEXICAL_CASUAL.has(piece) || LEXICAL_NEUTRAL.has(piece);
}

/**
 * The register a piece's own ending gives: a polite / casual predicate, a noun
 * fragment that plausibly dropped だ (casual), or `null` for a fragment with no
 * predicate shape (echo question, case particle, vocative, short fragment,
 * trailing subordinate clause).
 */
function pieceRegister(core: string, echo: boolean, clause: string): MarkerRegister | null {
  if (POLITE_FINAL_RE.test(core)) return 'polite';
  const conn = CONNECTIVE_END_RE.exec(core);
  if (conn) {
    // 思いますけど → polite; もどってきたら / 行くから → no register of its own.
    const before = core.slice(0, core.length - conn[0].length);
    return POLITE_FINAL_RE.test(before) ? 'polite' : null;
  }
  // だいじょうぶだったんですが、きゅうに降ってきて。 → polite trailing off, not a plain request.
  if (TE_FINAL_RE.test(core) && POLITE_CONNECTIVE_RE.test(clause)) return 'polite';
  if (CASUAL_FINAL_RE.test(core)) return 'casual';
  if (echo || core.length < BARE_MIN_LEN || PARTICLE_END_RE.test(core) || VOCATIVE_END_RE.test(core)) return null;
  return 'casual'; // bare noun fragment = dropped copula = plain
}

function analyzeClause(text: string, index: number, echo: boolean): ClauseAnalysis {
  const markers: Marker[] = [];
  const lexical = new Set<MarkerRegister>();
  let soft = false;
  let neutralPiece = false;

  // Lexical pieces between 、
  const pieces: { piece: string; at: number }[] = [];
  let off = 0;
  for (const raw of text.split('、')) {
    const lead = raw.length - raw.replace(/^[、。！？!?…・「」『』()（）\s]+/, '').length;
    const piece = raw.replace(PUNCT_EDGE_RE, '');
    const at = index + off + lead;
    off += raw.length + 1;
    pieces.push({ piece, at });
    if (piece.length === 0) continue;
    if (LEXICAL_KEIGO.has(piece)) {
      markers.push({ surface: piece, register: 'keigo', index: at, kind: 'lexical' });
      lexical.add('keigo');
    } else if (LEXICAL_POLITE.has(piece)) {
      markers.push({ surface: piece, register: 'polite', index: at, kind: 'lexical' });
      lexical.add('polite');
    } else if (LEXICAL_SOFT_POLITE.has(piece)) {
      markers.push({ surface: piece, register: 'polite', index: at, kind: 'lexical' });
      soft = true;
    } else if (LEXICAL_CASUAL.has(piece)) {
      markers.push({ surface: piece, register: 'casual', index: at, kind: 'lexical' });
      lexical.add('casual');
    } else if (LEXICAL_NEUTRAL.has(piece)) {
      neutralPiece = true;
    }
  }

  const wholeLexical = pieces.every((p) => p.piece.length === 0 || isLexical(p.piece));

  // Keigo anywhere (set phrases excluded: いただきます alone is the table grace).
  const keigo: Marker[] = [];
  if (!wholeLexical) {
    for (const m of text.matchAll(KEIGO_RE)) {
      const surface = m[0];
      keigo.push({ surface, register: 'keigo', index: index + (m.index ?? 0), kind: 'keigo' });
    }
  }
  markers.push(...keigo);

  // Final predicate: the last piece with a predicate shape decides; fragments
  // after it (a vocative: アオですよ、ケン) are skipped; a set phrase stops the walk.
  let final: Marker | null = null;
  if (!wholeLexical) {
    for (let i = pieces.length - 1; i >= 0; i--) {
      const { piece, at } = pieces[i] as { piece: string; at: number };
      if (piece.length === 0) continue;
      if (isLexical(piece)) break;
      const core = stripFinalParticles(piece);
      const reg = pieceRegister(core, echo && i === pieces.length - 1, text);
      if (reg === null) continue;
      const word = finalWord(core);
      final = { surface: word, register: reg, index: at + Math.max(0, core.length - word.length), kind: 'final' };
      // A keigo form that closes the clause IS the predicate: start the final marker there.
      const closing = keigo.find((k) => k.index + k.surface.length === at + core.length && k.index > (final as Marker).index);
      if (closing) final = { ...final, surface: core.slice(closing.index - at), index: closing.index };
      markers.push(final);
      break;
    }
  }

  markers.sort((a, b) => a.index - b.index);

  let register: Register | null = null;
  let weak = false;
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
  } else if (soft && wholeLexical) {
    register = 'polite';
    weak = true;
  }
  return { markers, register, neutral: wholeLexical && (soft || neutralPiece), weak };
}

function analyze(sentence: string): { clauses: ClauseAnalysis[]; markers: Marker[] } {
  const normalized = normalizeForRegister(sentence);
  const clauses = splitClausesDetailed(normalized).map((c) => analyzeClause(c.text, c.index, c.echo));
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
 * plain form) → mixed. A line of only neutral aizuchi or soft set phrases
 * (なるほど, はい) → polite; such clauses yield to any clause with a real marker
 * (はい、はい。食べながら見る。 → casual).
 */
export function detectRegister(sentence: string): Register {
  const { clauses } = analyze(sentence);
  const regs = new Set<Register>();
  let neutral = false;
  for (const c of clauses) {
    if (c.register && !c.weak) regs.add(c.register);
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
