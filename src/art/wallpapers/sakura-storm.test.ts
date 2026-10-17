import { fnv1a32 } from '../../shared/hash';
import { FONTS, inSafeZone } from '../jtext';
import { sampleData } from './data';
import { spec } from './sakura-storm';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S, kanjiNumber, kanjiNumerals } from './strings-1';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

describe('kanji numerals (strings-1)', () => {
  it('converts small numbers the traditional way', () => {
    expect(kanjiNumber(0)).toBe('〇');
    expect(kanjiNumber(7)).toBe('七');
    expect(kanjiNumber(10)).toBe('十');
    expect(kanjiNumber(15)).toBe('十五');
    expect(kanjiNumber(45)).toBe('四十五');
    expect(kanjiNumber(100)).toBe('百');
    expect(kanjiNumber(365)).toBe('三百六十五');
    expect(kanjiNumber(2026)).toBe('二千二十六');
    expect(kanjiNumber(10000)).toBe('一〇〇〇〇');
    expect(kanjiNumber(-3)).toBe('〇');
    expect(kanjiNumber(Number.NaN)).toBe('〇');
    expect(kanjiNumerals('令和8年1月15日')).toBe('令和八年一月十五日');
    expect(kanjiNumerals('令和元年12月3日')).toBe('令和元年十二月三日');
  });
});

describe('sakura-storm', () => {
  it('exports the spec with its catalog id and no post pass', () => {
    expect(spec.id).toBe('sakura-storm');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('none');
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

  it('builds the storm from one petal symbol in three depth layers, two of them blurred', () => {
    const doc = parse(spec.compose(1, DATA, 'desktop').svg);
    expect(doc.querySelector('defs > path#ss-p')).not.toBeNull();
    const uses = Array.from(doc.querySelectorAll('use[href="#ss-p"]'));
    expect(uses.length).toBeGreaterThan(400);
    expect(uses.length).toBeLessThan(520);
    expect(doc.querySelectorAll('g[filter="url(#ss-far)"] use').length).toBe(240);
    expect(doc.querySelectorAll('g[filter="url(#ss-near)"] use').length).toBe(52);
    // every petal is placed and turned by the wind field
    for (const u of uses.slice(0, 20)) expect(u.getAttribute('transform')).toMatch(/^translate\([-\d.]+ [-\d.]+\) rotate\([-\d.]+\) scale\([\d.]+\)$/);
    // pagoda: five roofs plus the sōrin rings
    expect(doc.querySelectorAll('ellipse').length).toBeGreaterThanOrEqual(7);
  });

  it('the tanzaku carries the longest streak and the date in kanji numerals, set vertically in mincho', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(c.texts.length).toBe(2);
    const [streak, date] = c.texts;
    expect(streak!.text).toBe(`${S.streakPrefix}${kanjiNumber(DATA.streak)}${S.daysSuffix}`);
    expect(streak!.vertical).toBe(true);
    expect(streak!.font).toBe(FONTS.mincho);
    expect(date!.text).toBe(kanjiNumerals('令和8年5月20日'));
    expect(date!.text).not.toMatch(/\d/);
    expect(c.svg).not.toContain(S.streakPrefix);
    // belt colour on the cord
    expect(c.svg.toLowerCase()).toContain('#3e9b4f');
    // a long streak still fits the strip
    const long = spec.compose(1, sampleData(1, { streak: 8888 }), 'phone');
    const short = spec.compose(1, DATA, 'phone');
    expect(long.texts[0]!.text).toBe('連続八千八百八十八日');
    expect(long.texts[0]!.size).toBeLessThan(short.texts[0]!.size);
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
  });

  it('phone: both tanzaku columns stay inside the safe zones, for several seeds', () => {
    for (const seed of [1, 2, 3, 4, 13]) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
      for (const t of c.texts) expect(inSafeZone(t, 'phone')).toBe(true);
    }
  });

  it('seed changes the wind, the pagoda side and the paper, keeping the identity', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(4, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const firstPetal = (svg: string): string | null => parse(svg).querySelector('use[href="#ss-p"]')?.getAttribute('transform') ?? null;
    expect(firstPetal(a.svg)).not.toBe(firstPetal(b.svg));
    expect(a.texts[0]!.x).not.toBe(b.texts[0]!.x);
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    for (const c of [a, b]) expect(parse(c.svg).querySelectorAll('use[href="#ss-p"]').length).toBeGreaterThan(400);
  });

  it('zero streak and zero days still compose', () => {
    const c = spec.compose(9, sampleData(3, { streak: 0, totalDays: 0, belt: 'white' }), 'phone');
    expect(c.texts[0]!.text).toBe('連続〇日');
    expect(parse(c.svg).querySelector('parsererror')).toBeNull();
  });
});
