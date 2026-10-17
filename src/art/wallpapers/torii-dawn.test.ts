import { fnv1a32 } from '../../shared/hash';
import { FONTS, inSafeZone } from '../jtext';
import { sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { spec } from './torii-dawn';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

describe('torii-dawn', () => {
  it('exports the spec with its catalog id and a grain post pass', () => {
    expect(spec.id).toBe('torii-dawn');
    expect(spec.living).toBeUndefined();
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
      expect(doc.querySelector('title')?.textContent).toBe('Torii at Dawn');
      expect(fingerprint(a.svg)).toMatchSnapshot();
    });
  }

  it('different seeds give visibly different ridges and torii placement, same identity', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const polys = (svg: string): string[] => Array.from(parse(svg).querySelectorAll('polygon')).map((p) => p.getAttribute('points') ?? '');
    expect(polys(a.svg).slice(0, 5)).not.toEqual(polys(b.svg).slice(0, 5));
    // the ema name sits somewhere else, but is still the same name in the brush face
    expect(a.texts[0]!.x).not.toBe(b.texts[0]!.x);
    expect(a.texts[0]!.text).toBe(DATA.nameKana);
    expect(b.texts[0]!.font).toBe(FONTS.brush);
    // identity: five ridges, one torii group with a gradient fill, the mist filter
    for (const c of [a, b]) {
      expect(parse(c.svg).querySelectorAll('polygon').length).toBeGreaterThanOrEqual(5);
      expect(c.svg).toContain('url(#td-torii)');
      expect(c.svg).toContain('id="td-mist"');
    }
  });

  it('phone: every TextLayer stays inside the safe zones', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
      for (const t of c.texts) expect(inSafeZone(t, 'phone')).toBe(true);
    }
  });

  it('personalises with the name on the ema, the chosen kanji on a shu seal and the era date, none of it inside the SVG', () => {
    const c = spec.compose(3, DATA, 'desktop');
    const texts = c.texts.map((t) => t.text);
    expect(texts).toContain(DATA.nameKana);
    expect(texts).toContain(DATA.chosenKanji);
    expect(texts.some((t) => /^令和\d+年\d+月\d+日$/.test(t))).toBe(true);
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.svg).not.toContain('令和');
    for (const t of c.texts) expect(t.lang).toBe('ja');
    // the belt colour is used (ema cord)
    expect(c.svg.toLowerCase()).toContain('#3e9b4f');
  });

  it('degrades gracefully: no chosen kanji, a long name, an empty mastered set', () => {
    const noKanji = spec.compose(1, { ...sampleData(1), chosenKanji: undefined }, 'phone');
    expect(noKanji.texts.map((t) => t.text)).not.toContain('続');
    expect(noKanji.texts.length).toBe(2);
    const long = spec.compose(1, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード' }), 'phone');
    const name = long.texts.find((t) => t.text.startsWith('クリス'))!;
    expect(name.size).toBeLessThan(noKanji.texts[0]!.size);
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
    const empty = spec.compose(5, sampleData(2, { mastered: { kana: [], kanji: [], vocab: [] }, belt: 'white', streak: 0, totalDays: 0 }), 'desktop');
    expect(isComposition(empty)).toBe(true);
    expect(parse(empty.svg).querySelector('parsererror')).toBeNull();
  });
});
