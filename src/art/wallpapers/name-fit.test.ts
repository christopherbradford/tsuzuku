/**
 * Learner text at its caps must shrink to fit (review round 2, contract
 * #15/#28, app #6): a name at `NAME_MAX_GLYPHS` and sentences at
 * `SENTENCE_MAX_GLYPHS`, in every piece at both sizes. A `fitSize` floor
 * (`min`) that binds lets text overrun its box — in VS Wall and the Waveform
 * footer it left the SVG viewBox — so `fitSize` is wrapped here to flag any
 * call on the name whose floor binds, and `canvasViolations` catches layers
 * that were never fitted at all. Tanabata's strip floor is exempt: it is
 * guarded by truncation and sets sentences, not the name.
 */
import { vi } from 'vitest';
import { WALLPAPER_IDS } from '../../shared/catalog';
import { NAME_MAX_GLYPHS } from '../../shared/store-types';
import { SUMI } from '../color';
import { FONTS, glyphCount } from '../jtext';
import { sampleData, SENTENCE_MAX_GLYPHS } from './data';
import { WALLPAPERS } from './index';
import { canvasViolations, safeZoneViolations, WALLPAPER_SIZES, type Composition } from './spec';

const rec = vi.hoisted(() => ({ floored: [] as string[] }));
vi.mock('../jtext', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('../jtext');
  const fitSize: typeof real.fitSize = (text, maxW, maxH, o = {}) => {
    const size = real.fitSize(text, maxW, maxH, o);
    const free = real.fitSize(text, maxW, maxH, { ...o, min: 0 });
    if (size > free + 0.001) rec.floored.push(`${text} | min=${o.min ?? 'default'} fitted=${free.toFixed(1)} used=${size}`);
    return size;
  };
  return { ...real, fitSize };
});

const NAME = 'クリストファー・ブラッドフォード・ジュニアだよね';
const SENTENCE = Array.from('毎朝、駅まで歩いてから、友達と一緒に新しいレストランで朝ご飯を食べて、日本語の勉強を少しずつ続けています。'.repeat(3)).slice(0, SENTENCE_MAX_GLYPHS).join('');
const DATA = sampleData(1, { nameKana: NAME, sentenceOfChoice: SENTENCE, dictatedSentence: SENTENCE, writingSentences: [SENTENCE, SENTENCE, SENTENCE] });
const SHORT = sampleData(1);

/** A recorded text is "the name" when it shares any four consecutive glyphs with it (columns, initials and katakana forms included). */
const NAME_GLYPHS = Array.from(NAME);
const WINDOWS = NAME_GLYPHS.slice(0, -3).map((_, i) => NAME_GLYPHS.slice(i, i + 4).join(''));
const nameLike = (entry: string): boolean => WINDOWS.some((w) => entry.includes(w));

const where = (t: { text: string; x: number; y: number; size: number }): string => `${t.text.slice(0, 16)}@${Math.round(t.x)},${Math.round(t.y)} size ${t.size}`;

describe('learner text at the caps', () => {
  it('the fixture sits exactly at NAME_MAX_GLYPHS / SENTENCE_MAX_GLYPHS', () => {
    expect(glyphCount(NAME)).toBe(NAME_MAX_GLYPHS);
    expect(DATA.nameKana).toBe(NAME);
    expect(glyphCount(DATA.sentenceOfChoice!)).toBe(SENTENCE_MAX_GLYPHS);
    expect(glyphCount(DATA.dictatedSentence!)).toBe(SENTENCE_MAX_GLYPHS);
    expect(DATA.writingSentences.map(glyphCount)).toEqual([SENTENCE_MAX_GLYPHS, SENTENCE_MAX_GLYPHS, SENTENCE_MAX_GLYPHS]);
  });

  it('canvasViolations flags a layer past any edge and skips rotated ones', () => {
    const base = { text: 'あいう', y: 500, size: 20, font: FONTS.ja, fill: SUMI };
    const inside: Composition = { svg: '', texts: [{ ...base, x: 10 }, { ...base, x: 1900, anchor: 'end' }, { ...base, x: 40, y: 0, vertical: true }], post: 'none' };
    expect(canvasViolations(inside, 'desktop')).toEqual([]);
    const outside: Composition = {
      svg: '',
      texts: [{ ...base, x: -1 }, { ...base, x: 1900 }, { ...base, x: 40, y: 1060, vertical: true }, { ...base, x: 40, y: 10 }, { ...base, x: -500, rotate: 20 }],
      post: 'none',
    };
    expect(canvasViolations(outside, 'desktop').map((t) => t.x)).toEqual([-1, 1900, 40, 40]);
    expect(canvasViolations(outside, 'phone').map((t) => t.x)).toEqual([-1, 1900, 40]);
  });

  for (const id of WALLPAPER_IDS) {
    for (const size of WALLPAPER_SIZES) {
      it(`${id} ${size}: the name is fitted (no binding floor) and every layer stays inside the canvas and the safe zones`, () => {
        rec.floored.length = 0;
        const c = WALLPAPERS[id].compose(1, DATA, size);
        expect(rec.floored.filter(nameLike), 'fitSize floors that bind on the name').toEqual([]);
        expect(canvasViolations(c, size).map(where)).toEqual([]);
        expect(safeZoneViolations(c, size).map(where)).toEqual([]);
        expect(canvasViolations(WALLPAPERS[id].compose(1, SHORT, size), size).map(where)).toEqual([]);
      });
    }
  }
});
