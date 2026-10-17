/**
 * TSUZUKU — Kana Forge IME (design 04 §0).
 *
 * `wanakana.toKana(IMEMode)` plus a post-pass so learners can type Hepburn or
 * Kunrei as they read it in a textbook:
 *   nn / n' → ん · n + consonant → ん · doubled consonant → っ · x/l → small kana
 *   '-' → ー · tsu/tu → つ · du/dzu → づ · di/dji → ぢ · m before b/p/m → ん
 *   "nn" + vowel/y → ん + n-row (kanna → かんな, konnichiwa → こんにちわ,
 *   konnyaku → こんにゃく; ん before a vowel/y is typed n' as in Hepburn: hon'ya)
 *   tch → っち (itchi, matcha) · uppercase is folded (katakana is a mode, not Caps Lock)
 * Unresolved trailing romaji stays visible as `pending`. Katakana mode converts
 * the resolved kana (typed hiragana included); pending romaji is untouched.
 */
import { toKana, toKatakana } from 'wanakana';

export interface ImeOptions {
  katakana: boolean;
}

export interface ImeState {
  /** Resolved kana (plus any mid-string characters that could not convert). */
  text: string;
  /** Trailing romaji still waiting for more keys (`k`, `ky`, `n`, `tt` …). */
  pending: string;
}

const RE_TRAILING_ROMAJI = /[A-Za-z']+$/;

/** Romaji spellings wanakana does not know, rewritten before conversion. */
function preprocess(buffer: string): string {
  let s = buffer.toLowerCase();
  // Hepburn "nn" before a vowel or y is ん + n-row (かんな), not ん + bare vowel.
  s = s.replace(/nn(?=n*[aiueoy])/g, (m, offset: number, str: string) => {
    // "nnn" + vowel is wanakana-correct already (ん + な); only rewrite exactly two n.
    return str[offset + 2] === 'n' ? m : "n'n";
  });
  // Hepburn m before labials: shimbun → shinbun, sampo → sanpo, gamma → ganma.
  s = s.replace(/m(?=[bpm])/g, 'n');
  // Hepburn "tch" is っち (itchi, matcha).
  s = s.replace(/tch/g, 'cch');
  // づ/ぢ variants.
  s = s.replace(/dzu/g, 'du').replace(/dji/g, 'di');
  return s;
}

function split(converted: string): ImeState {
  const m = RE_TRAILING_ROMAJI.exec(converted);
  if (!m) return { text: converted, pending: '' };
  return { text: converted.slice(0, m.index), pending: m[0] };
}

/** Live conversion of the whole input buffer. Pure; call on every keystroke. */
export function imeStep(buffer: string, o: ImeOptions = { katakana: false }): ImeState {
  if (buffer.length === 0) return { text: '', pending: '' };
  const st = split(toKana(preprocess(buffer), { IMEMode: true }));
  if (o.katakana) st.text = toKatakana(st.text);
  return st;
}

/** `imeStep` under the name the task sheet uses: `{ kana, pending }` (plus `text`). */
export function convertLive(buffer: string, o: ImeOptions = { katakana: false }): ImeState & { kana: string } {
  const st = imeStep(buffer, o);
  return { ...st, kana: st.text };
}

/**
 * Resolution at submit: a trailing lone `n` becomes ん; other unresolved romaji
 * stays as typed (it is wrong either way and the grader will show the diff).
 */
export function finalizeIme(buffer: string, o: ImeOptions = { katakana: false }): string {
  if (buffer.length === 0) return '';
  let s = preprocess(buffer);
  if (/(^|[^n])n$/.test(s)) s = `${s}'`;
  const st = split(toKana(s, { IMEMode: true }));
  const text = o.katakana ? toKatakana(st.text) : st.text;
  return text + st.pending;
}

/** Whole-string conversion for answers and ids (never leaves pending romaji behind where it can resolve). */
export function romajiToKana(s: string, o: { katakana?: boolean } = {}): string {
  return finalizeIme(s, { katakana: Boolean(o.katakana) });
}

const RE_KATAKANA_CHAR = /[ァ-ヺヽヾ]/;
const RE_HIRAGANA_CHAR = /[ぁ-ゖゝゞ]/;

/** Katakana mode should be on when the expected answer is katakana (katakana items, loanwords). */
export function wantsKatakana(answer: string): boolean {
  return RE_KATAKANA_CHAR.test(answer) && !RE_HIRAGANA_CHAR.test(answer);
}

/** True when the buffer ends in romaji that could still resolve with more keys. */
export function hasPending(buffer: string): boolean {
  return imeStep(buffer).pending.length > 0;
}
