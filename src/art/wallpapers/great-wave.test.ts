import { fnv1a32 } from '../../shared/hash';
import { FONTS, inSafeZone } from '../jtext';
import { sampleData } from './data';
import { spec } from './great-wave';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

function glyphTexts(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll('g[font-family] > text'));
}

describe('great-wave', () => {
  it('exports the spec with its catalog id and a grain post pass (woodblock paper)', () => {
    expect(spec.id).toBe('great-wave');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('grain');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: byte-identical for the same (seed, data, size); well-formed, self-contained, no reserved ids (snapshot)`, () => {
      const a = spec.compose(1, DATA, size);
      const b = spec.compose(1, DATA, size);
      expect(isComposition(a)).toBe(true);
      expect(a.svg).toBe(b.svg);
      expect(a.texts).toEqual(b.texts);
      expect(hasCanvasSize(a, size)).toBe(true);
      expect(isSelfContained(a.svg)).toBe(true);
      expect(usesReservedIds(a.svg)).toBe(false);
      expect(a.svg).not.toMatch(/NaN|Infinity|undefined/);
      const doc = parse(a.svg);
      expect(doc.getElementsByTagName('*').length).toBeLessThan(4000);
      expect(fingerprint(a.svg)).toMatchSnapshot();
    });
  }

  it('builds the wave from roughly 600 of the learner\'s glyphs, strongest first on the crest, sized by band', () => {
    for (const size of WALLPAPER_SIZES) {
      const doc = parse(spec.compose(1, DATA, size).svg);
      const glyphs = glyphTexts(doc);
      expect(glyphs.length).toBeGreaterThan(480);
      expect(glyphs.length).toBeLessThan(720);
      const supply = new Set([...DATA.mastered.kanji, ...DATA.mastered.kana]);
      for (const g of glyphs) expect(supply.has(g.textContent ?? '')).toBe(true);
      // the first glyphs placed are the strongest kanji, rotated along the crest and white
      expect(glyphs[0]!.textContent).toBe(DATA.mastered.kanji[0]);
      expect(glyphs[0]!.getAttribute('fill')).toBe('#FFFFFF');
      expect(glyphs[0]!.getAttribute('transform')).toMatch(/^rotate\(/);
      const sizes = glyphs.map((g) => Number(g.getAttribute('font-size')));
      expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes) * 1.8);
      expect(doc.querySelector('g[font-family]')?.getAttribute('font-family')).toBe(FONTS.mincho);
    }
  });

  it('cycles a small mastered set and still draws a wave with no mastered glyphs at all', () => {
    const few = spec.compose(1, sampleData(1, { mastered: { kana: ['あ'], kanji: ['続'], vocab: [] } }), 'desktop');
    const glyphs = glyphTexts(parse(few.svg));
    expect(glyphs.length).toBeGreaterThan(480);
    expect(new Set(glyphs.map((g) => g.textContent))).toEqual(new Set(['あ', '続']));
    const none = spec.compose(1, sampleData(1, { mastered: { kana: [], kanji: [], vocab: [] } }), 'phone');
    expect(isComposition(none)).toBe(true);
    expect(glyphTexts(parse(none.svg)).every((g) => g.textContent === '波')).toBe(true);
    expect(safeZoneViolations(none, 'phone')).toEqual([]);
  });

  it('carries title, name, chosen kanji and date as TextLayers; the name is not in the SVG', () => {
    const c = spec.compose(2, DATA, 'desktop');
    const texts = c.texts.map((t) => t.text);
    expect(texts).toEqual(['文字の大波', DATA.nameKana, DATA.chosenKanji, '令和8年5月20日']);
    expect(c.texts[0]!.vertical).toBe(true);
    expect(c.texts[1]!.vertical).toBe(true);
    expect(c.texts[1]!.font).toBe(FONTS.brush);
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.svg.toLowerCase()).toContain('#3e9b4f');
    const noKanji = spec.compose(2, { ...DATA, chosenKanji: undefined }, 'desktop');
    expect(noKanji.texts.length).toBe(3);
  });

  it('phone: cartouches and date stay inside the safe zones, also with a long name', () => {
    for (const seed of [1, 2, 3, 6]) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
      for (const t of c.texts) expect(inSafeZone(t, 'phone')).toBe(true);
    }
    const long = spec.compose(1, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード' }), 'phone');
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
  });

  it('seed moves the crest and re-rolls bands and foam; same glyph supply', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const first = (c: typeof a): string => glyphTexts(parse(c.svg))[0]!.getAttribute('x') ?? '';
    expect(first(a)).not.toBe(first(b));
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
  });
});
