/**
 * TSUZUKU — story coverage against the learner's live known set (design 04 §7,
 * 05 §2 "Known", CONTENT_GUIDE §14.2, V20).
 *
 * Works from `StoryLine.tokenIds` written by the linker, so no loader call is
 * needed for allowlist items that are not in memory: a token is known when
 * its id is in `known` (`learn/known.ts knownSet`). Function tokens, cast and
 * story names, numerals and punctuation never count as unknown. A token the
 * linker left `null` that is not exempt is an unknown with no id (a word the
 * corpus does not carry); a story without `tokenIds` falls back to an
 * optional `surfaces` map (`StationBundle.surfaces`) and otherwise counts
 * its content tokens as unknown, honestly.
 *
 *  lineCoverage()   per-line known / total / unknown tokens
 *  storyCoverage()  ratio + distinct unknown tokens and ids (次回予告, capture)
 *  isIPlusOne()     exactly one unknown item above the threshold (i+1 reading)
 *  pickEpisode()    highest coverage ≥ `coverageTargetFor(station, bridge)`
 *  previewLine()    the line with the fewest unknown tokens and the first of
 *                   them masked (the つづく card's 次回予告 sentence)
 */
import { coverageTargetFor, type StoryItem, type StoryLine } from '../../content/types';
import { normalizeJa } from '../../shared/jp';

/* ────────────────────────────────────────────────────────────────────────── */
/* Exempt tokens (CONTENT_GUIDE §14.2; mirrors scripts/assign-stations.ts)    */
/* ────────────────────────────────────────────────────────────────────────── */

export const FUNCTION_TOKENS: ReadonlySet<string> = new Set([
  // particles
  'は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の', 'も', 'か', 'ね', 'よ', 'な', 'わ', 'って',
  'や', 'し', 'ば', 'ても', 'でも', 'のに', 'ので', 'けど', 'けれど', 'けれども', 'のは', 'のが', 'には', 'では', 'とは', 'へは',
  'からは', 'までは', 'とか', 'だけ', 'しか', 'ほど', 'くらい', 'ぐらい', 'ずつ', 'など', 'なんて', 'かな', 'よね', 'ぞ', 'ぜ', 'さ', 'っけ',
  // copula and ます-forms
  'です', 'だ', 'でした', 'だった', 'じゃない', 'ではない', 'じゃありません', 'ではありません', 'じゃなかった', 'ではなかった',
  'でしょう', 'だろう', 'ます', 'ません', 'ました', 'ましょう', 'ませんでした', 'ましょうか', 'ませんか', 'なら', 'なの', 'なん',
  // て-form auxiliaries
  'いる', 'います', 'いた', 'いました', 'いない', 'いません', 'いて', 'ある', 'あります', 'あった', 'ありました', 'ない', 'ありません', 'あって',
  'おく', 'おきます', 'おいた', 'おいて', 'みる', 'みます', 'みた', 'みて', 'しまう', 'しまいます', 'しまった', 'しまって',
  'くれる', 'くれます', 'くれた', 'くれて', 'もらう', 'もらいます', 'もらった', 'もらって', 'あげる', 'あげます', 'あげた', 'あげて',
  'いく', 'いきます', 'いった', 'いって', 'くる', 'きます', 'きた', 'きて', 'する', 'します', 'した', 'して', 'しない', 'しません',
  // name suffixes
  'さん', 'ちゃん', 'くん', '様', 'さま', 'たち',
]);

/** The fixed cast (CONTENT_GUIDE §14.1) is exempt in every text. */
export const CAST_NAMES: ReadonlySet<string> = new Set(['ハナ', 'ケン', 'アオ', '田中', '田中さん']);

const NAME_SUFFIXES = ['さん', 'ちゃん', 'くん', '様', 'さま', 'たち'];
const NUMERAL = '〇零一二三四五六七八九十百千万億兆0-9０-９';
const KANJI_NUMERAL_RE = new RegExp(`^[${NUMERAL}]+$`);
/** A numeral with a common counter (三人, 二つ, 十二時, ３枚): the counter is taught with the number, not as a word. */
const COUNTED_RE = new RegExp(
  `^[${NUMERAL}]+(?:人|つ|本|枚|匹|回|日|月|年|時|分|秒|円|個|階|歳|才|冊|台|杯|番|度|週|週間|か月|ヶ月|ヵ月|カ月|時間|日間|年間|名|着|軒|足|頭|羽|通|曲|泊|丁目|キロ|メートル|グラム|センチ|ページ|ドル)$`,
);

export function isPunctToken(token: string): boolean {
  return normalizeJa(token).length === 0;
}

export function isNumeralToken(token: string): boolean {
  return KANJI_NUMERAL_RE.test(token) || COUNTED_RE.test(token);
}

export function isFunctionToken(token: string): boolean {
  return FUNCTION_TOKENS.has(token);
}

export function isNameToken(token: string, names: readonly string[] = []): boolean {
  if (CAST_NAMES.has(token) || names.includes(token)) return true;
  for (const nm of [...CAST_NAMES, ...names]) {
    if (token.startsWith(nm) && token.length > nm.length) {
      const rest = token.slice(nm.length);
      if (NAME_SUFFIXES.includes(rest) || FUNCTION_TOKENS.has(rest)) return true;
    }
  }
  return false;
}

/** Exempt = never counts as unknown: punctuation, function tokens, numerals, names (+ suffix). */
export function isExemptToken(token: string, names: readonly string[] = []): boolean {
  return isPunctToken(token) || isFunctionToken(token) || isNumeralToken(token) || isNameToken(token, names);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Coverage                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface CoverageOptions {
  /** Story / cast names exempt from coverage (`StoryItem.names`). */
  names?: readonly string[];
  /** Surface → item id fallback for lines without `tokenIds` (`StationBundle.surfaces`). */
  surfaces?: Readonly<Record<string, string>>;
}

export interface UnknownToken {
  token: string;
  /** The linked item id, or `null` when the corpus has no item for the token. */
  itemId: string | null;
  /** Index of the token in `line.tokens`. */
  index: number;
}

export interface LineCoverage {
  known: number;
  /** Non-punctuation tokens. */
  total: number;
  unknown: UnknownToken[];
}

function idFor(line: StoryLine, i: number, token: string, o: CoverageOptions): string | null | undefined {
  if (line.tokenIds) return line.tokenIds[i] ?? null;
  if (o.surfaces) {
    const direct = o.surfaces[token];
    if (direct) return direct;
    // inflected forms: the longest surface the token starts with (≥ 2 chars)
    let best: string | undefined;
    for (const [s, id] of Object.entries(o.surfaces)) {
      if (s.length >= 2 && token.startsWith(s) && (!best || s.length > best.length)) best = id;
    }
    return best;
  }
  return undefined;
}

/**
 * Coverage of one line. Punctuation is not counted; exempt tokens count as
 * known; a token with a linked id is known iff `known.has(id)`.
 */
export function lineCoverage(line: StoryLine, known: ReadonlySet<string>, o: CoverageOptions = {}): LineCoverage {
  let knownN = 0;
  let total = 0;
  const unknown: UnknownToken[] = [];
  line.tokens.forEach((token, i) => {
    if (isPunctToken(token)) return;
    total++;
    if (isExemptToken(token, o.names)) {
      knownN++;
      return;
    }
    const id = idFor(line, i, token, o);
    if (id && known.has(id)) {
      knownN++;
      return;
    }
    unknown.push({ token, itemId: id ?? null, index: i });
  });
  return { known: knownN, total, unknown };
}

export interface StoryCoverage {
  /** known / total over the whole story; 1 for a story with no content tokens. */
  ratio: number;
  known: number;
  total: number;
  /** Distinct unknown token surfaces in order of first appearance. */
  unknown: string[];
  /** Distinct unknown item ids (tokens the corpus carries), in order of first appearance. */
  unknownIds: string[];
  /** Ids in `plusOne` the learner does not know yet (the designed i+1 words). */
  plusOneUnknown: string[];
}

export function storyCoverage(s: StoryItem, known: ReadonlySet<string>, o: CoverageOptions = {}): StoryCoverage {
  const names = o.names ?? s.names ?? [];
  let knownN = 0;
  let total = 0;
  const unknown: string[] = [];
  const unknownIds: string[] = [];
  const plusOne = new Set<string>();
  for (const line of s.lines) {
    const c = lineCoverage(line, known, { ...o, names });
    knownN += c.known;
    total += c.total;
    for (const u of c.unknown) {
      if (!unknown.includes(u.token)) unknown.push(u.token);
      if (u.itemId && !unknownIds.includes(u.itemId)) unknownIds.push(u.itemId);
    }
    for (const id of line.plusOne ?? []) if (!known.has(id)) plusOne.add(id);
  }
  return { ratio: total === 0 ? 1 : knownN / total, known: knownN, total, unknown, unknownIds, plusOneUnknown: [...plusOne] };
}

/** The V20 threshold for a story at `station` (bridge passages 0.93). */
export function thresholdFor(station: number, bridge: boolean): number {
  return coverageTargetFor(station, bridge);
}

/** Coverage at or above the station threshold. */
export function isReadable(s: StoryItem, known: ReadonlySet<string>, station: number, o: CoverageOptions = {}): boolean {
  return storyCoverage(s, known, o).ratio >= thresholdFor(station, s.bridge === true) - 1e-9;
}

/** i+1: readable and exactly one unknown item (by id) in the whole text. */
export function isIPlusOne(s: StoryItem, known: ReadonlySet<string>, station: number, o: CoverageOptions = {}): boolean {
  const c = storyCoverage(s, known, o);
  return c.ratio >= thresholdFor(station, s.bridge === true) - 1e-9 && c.unknownIds.length === 1 && c.unknown.length === 1;
}

export interface PickOptions extends CoverageOptions {
  /** Story ids already read (skipped unless nothing else qualifies and `allowReread`). */
  read?: ReadonlySet<string>;
  allowReread?: boolean;
}

function stationOf(s: StoryItem): number {
  const m = /^s-(\d{2})-/.exec(s.id);
  return m ? Number(m[1]) : Number((s.stationId ?? 'st-99').slice(3)) || 99;
}

/**
 * The next readable episode: among candidates whose coverage meets their own
 * threshold (`coverageTargetFor(station, bridge)`), the highest coverage;
 * ties → fewer unknown tokens → earlier station → id order. Unread stories
 * first; `null` when nothing qualifies.
 */
export function pickEpisode(candidates: readonly StoryItem[], known: ReadonlySet<string>, station: number, o: PickOptions = {}): StoryItem | null {
  const scored = candidates
    .map((s) => ({ s, c: storyCoverage(s, known, o) }))
    .filter(({ s, c }) => c.ratio >= thresholdFor(station, s.bridge === true) - 1e-9);
  const order = (a: { s: StoryItem; c: StoryCoverage }, b: { s: StoryItem; c: StoryCoverage }): number => {
    if (b.c.ratio !== a.c.ratio) return b.c.ratio - a.c.ratio;
    if (a.c.unknown.length !== b.c.unknown.length) return a.c.unknown.length - b.c.unknown.length;
    const sa = stationOf(a.s);
    const sb = stationOf(b.s);
    if (sa !== sb) return sa - sb;
    return a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0;
  };
  const unread = o.read ? scored.filter(({ s }) => !o.read?.has(s.id)) : scored;
  const pool = unread.length > 0 ? unread : o.allowReread ? scored : [];
  pool.sort(order);
  return pool[0]?.s ?? null;
}

export interface PreviewLine {
  lineIndex: number;
  /** Index into `line.tokens` of the masked word. */
  maskedToken: number;
  /** Plain `ja` with the masked token replaced by `???`. */
  masked: string;
}

/**
 * 次回予告: the line with the fewest unknown tokens (at least one), masking
 * the first of them; when every line is fully known, the first line with a
 * content token whose id is in `dueTomorrow` (else `null`).
 */
export function previewLine(s: StoryItem, known: ReadonlySet<string>, dueTomorrow: ReadonlySet<string> = new Set(), o: CoverageOptions = {}): PreviewLine | null {
  const names = o.names ?? s.names ?? [];
  let best: { lineIndex: number; unknown: UnknownToken[] } | null = null;
  s.lines.forEach((line, i) => {
    const c = lineCoverage(line, known, { ...o, names });
    if (c.unknown.length === 0) return;
    if (!best || c.unknown.length < best.unknown.length) best = { lineIndex: i, unknown: c.unknown };
  });
  if (best) {
    const b: { lineIndex: number; unknown: UnknownToken[] } = best;
    const first = b.unknown[0] as UnknownToken;
    return { lineIndex: b.lineIndex, maskedToken: first.index, masked: maskToken(s.lines[b.lineIndex] as StoryLine, first.index) };
  }
  for (let i = 0; i < s.lines.length; i++) {
    const line = s.lines[i] as StoryLine;
    const j = line.tokens.findIndex((t, k) => {
      const id = line.tokenIds?.[k];
      return !!id && dueTomorrow.has(id) && !isExemptToken(t, names);
    });
    if (j >= 0) return { lineIndex: i, maskedToken: j, masked: maskToken(line, j) };
  }
  return null;
}

function maskToken(line: StoryLine, index: number): string {
  return line.tokens.map((t, i) => (i === index ? '???' : t)).join('');
}
