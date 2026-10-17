/**
 * TSUZUKU — `splitAtPlainRange`: cut a ruby'd sentence at plain-text offsets
 * (Kanji Read's target word, Lookalike Duel's blank).
 *
 * `segmentsToTokens` (content/ruby) hands a ruby group that straddles a cut to
 * the first piece whole and emits the bare remainder to the next piece, which
 * is right for word tokens but duplicates kanji when a blank cuts through a
 * group ('{未来|みらい}は' blanked [0,1] → '＿来は' before, '未来みらい来は'
 * after the reveal). Here a group wholly inside one piece keeps its markup; a
 * group that straddles a cut is emitted as bare base characters in each piece
 * it touches (no duplication, no reading inside the blank), and the reading
 * of everything the target touches comes back separately as the clue.
 */
import { parseRuby } from '@/content/ruby';

export interface PlainRangeSplit {
  /** `[before, target, after]`, each with its own ruby markup where a group fits inside. */
  pieces: [string, string, string];
  /** Kana of the target span: plain text as is, each ruby group the target touches by its full reading; `null` for an empty target. */
  reading: string | null;
}

/** Splits ruby'd `ja` at plain offsets `[start, end)` (clamped) into `[before, target, after]`; see the header. */
export function splitAtPlainRange(ja: string, start: number, end: number): PlainRangeSplit {
  const segs = parseRuby(ja);
  const len = segs.reduce((n, s) => n + s.base.length, 0);
  const a = Math.max(0, Math.min(start, len));
  const b = Math.max(a, Math.min(end, len));
  const bounds: [number, number][] = [
    [0, a],
    [a, b],
    [b, len],
  ];
  const pieces: [string, string, string] = ['', '', ''];
  let reading = '';
  let off = 0;
  for (const seg of segs) {
    const s0 = off;
    const s1 = off + seg.base.length;
    off = s1;
    const inside = bounds.findIndex(([lo, hi]) => s0 >= lo && s1 <= hi);
    if (seg.reading !== null && inside >= 0) {
      pieces[inside] += `{${seg.base}|${seg.reading}}`;
      if (inside === 1) reading += seg.reading;
      continue;
    }
    bounds.forEach(([lo, hi], i) => {
      const from = Math.max(s0, lo);
      const to = Math.min(s1, hi);
      if (to <= from) return;
      const part = seg.base.slice(from - s0, to - s0);
      pieces[i] += part;
      if (i === 1) reading += seg.reading ?? part;
    });
  }
  return { pieces, reading: b > a ? reading : null };
}
