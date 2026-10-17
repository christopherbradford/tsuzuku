/**
 * TSUZUKU — ruby markup helpers (CONTENT_GUIDE §4, types.ts RUBY_RE).
 *
 * `{base|reading}`: base = kanji run (or an uppercase acronym ≤ 4 letters),
 * reading = kana. Okurigana stay outside. Shared by the validator scripts
 * (run under `node --experimental-strip-types`, hence the `.ts` import) and
 * the runtime `<Ruby>` component.
 */
import { RUBY_RE } from './types.ts';

/** One kanji or 々/〆 (BMP CJK unified + extension A). */
export const KANJI_RE = /[㐀-䶿一-鿿々〆]/;
const KANJI_RE_G = /[㐀-䶿一-鿿々〆]/g;

function rubyRe(): RegExp {
  // RUBY_RE is /g and stateful; always iterate with a fresh instance.
  return new RegExp(RUBY_RE.source, 'g');
}

export interface RubySegment {
  /** Displayed text (kanji run for a ruby, plain text otherwise). */
  base: string;
  /** Kana reading for a ruby segment; `null` for plain text. */
  reading: string | null;
}

/** Splits `ja` into alternating plain and ruby segments; empty plain runs are omitted. */
export function parseRuby(ja: string): RubySegment[] {
  const out: RubySegment[] = [];
  const re = rubyRe();
  let last = 0;
  for (const m of ja.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ base: ja.slice(last, idx), reading: null });
    out.push({ base: m[1] as string, reading: m[2] as string });
    last = idx + m[0].length;
  }
  if (last < ja.length) out.push({ base: ja.slice(last), reading: null });
  return out;
}

/** Bases + plain text: the sentence as written. */
export function toPlain(ja: string): string {
  return ja.replace(rubyRe(), '$1');
}

/** Readings + plain text: must equal the sibling `kana` field (V13). */
export function toKana(ja: string): string {
  return ja.replace(rubyRe(), '$2');
}

export function hasKanji(s: string): boolean {
  return KANJI_RE.test(s);
}

/** Every kanji character in `s`, in order (duplicates kept). */
export function kanjiIn(s: string): string[] {
  return s.match(KANJI_RE_G) ?? [];
}

/** Number of ruby segments. */
export function rubyCount(ja: string): number {
  let n = 0;
  for (const _ of ja.matchAll(rubyRe())) n++;
  return n;
}

/** True when `tokens.join('') === toPlain(ja)` (V19). */
export function tokensMatchPlain(ja: string, tokens: readonly string[]): boolean {
  return tokens.join('') === toPlain(ja);
}

export interface TokenRuby {
  /** The plain token surface. */
  token: string;
  /** The same span of `ja` with its ruby markup; `toPlain(ja) === token` when no ruby straddles. */
  ja: string;
}

/**
 * Aligns word tokens (whose concatenation is the plain sentence) with the
 * ruby'd `ja`, so each token can be rendered through `<Ruby>` on its own.
 * A ruby whose base straddles a token boundary is attached whole to the token
 * where it starts; the following token keeps only its bare remainder.
 */
export function segmentsToTokens(ja: string, tokens: readonly string[]): TokenRuby[] {
  const segs = parseRuby(ja);
  const out: TokenRuby[] = [];
  let si = 0; // segment index
  let off = 0; // offset inside segs[si].base already consumed
  for (const token of tokens) {
    let need = token.length;
    let built = '';
    while (need > 0 && si < segs.length) {
      const seg = segs[si] as RubySegment;
      const avail = seg.base.length - off;
      if (seg.reading !== null) {
        if (off === 0) {
          // Whole ruby goes to this token, even if its base overflows it.
          built += `{${seg.base}|${seg.reading}}`;
          if (avail > need) {
            off = need;
            need = 0;
          } else {
            need -= avail;
            si++;
            off = 0;
          }
        } else {
          // Overflow of a ruby already emitted for an earlier token: bare remainder.
          const take = Math.min(avail, need);
          built += seg.base.slice(off, off + take);
          need -= take;
          off += take;
          if (off >= seg.base.length) {
            si++;
            off = 0;
          }
        }
      } else {
        const take = Math.min(avail, need);
        built += seg.base.slice(off, off + take);
        need -= take;
        off += take;
        if (off >= seg.base.length) {
          si++;
          off = 0;
        }
      }
    }
    out.push({ token, ja: built });
  }
  return out;
}
