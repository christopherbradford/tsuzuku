import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { MAX_LANTERNS, placeLanterns, spec } from './lantern-river';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';

const DATA = sampleData(1);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

describe('lantern-river', () => {
  it('exports the spec under its catalog id and is a living piece', () => {
    expect(spec.id).toBe('lantern-river');
    expect(spec.living).toBe(true);
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, reasonable node count (snapshot)`, () => {
      const a = spec.compose(1, DATA, size);
      const b = spec.compose(1, DATA, size);
      expect(isComposition(a)).toBe(true);
      expect(a.svg).toBe(b.svg);
      expect(a.texts).toEqual(b.texts);
      expect(a.post).toBe('grain');
      expect(hasCanvasSize(a, size)).toBe(true);
      expect(isSelfContained(a.svg)).toBe(true);
      expect(usesReservedIds(a.svg)).toBe(false);
      expect(a.svg).not.toMatch(/NaN|Infinity|undefined/);
      const doc = parse(a.svg);
      expect(doc.querySelectorAll('*').length).toBeLessThan(4000);
      expect(fp(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones', () => {
    const c = spec.compose(1, DATA, 'phone');
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
    expect(c.texts.length).toBeGreaterThanOrEqual(3);
  });

  it('personal text is carried by TextLayers only, never inside the SVG', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.texts.some((t) => t.text === DATA.nameKana)).toBe(true);
    expect(c.texts.some((t) => t.text.includes(String(DATA.wordsThisMonth)))).toBe(true);
  });

  it('different seeds give different pictures with the same identity', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(parse(a.svg).querySelectorAll('g.lantern').length).toBe(parse(b.svg).querySelectorAll('g.lantern').length);
  });

  it('draws one lantern per word learned this month, at least one, capped', () => {
    const count = (n: number): number => parse(spec.compose(3, sampleData(1, { wordsThisMonth: n }), 'desktop').svg).querySelectorAll('g.lantern').length;
    expect(count(17)).toBe(17);
    expect(count(0)).toBe(1);
    expect(count(5000)).toBeLessThanOrEqual(MAX_LANTERNS);
    expect(count(5000)).toBeGreaterThan(MAX_LANTERNS * 0.8);
  });

  it('placeLanterns keeps lanterns on the water, apart, sorted far to near', () => {
    const l = placeLanterns(7, 40, 1920, 420, 1080);
    expect(l.length).toBeGreaterThan(30);
    for (let i = 1; i < l.length; i++) expect(l[i]!.y).toBeGreaterThanOrEqual(l[i - 1]!.y);
    for (const p of l) {
      expect(p.y).toBeGreaterThan(420);
      expect(p.y).toBeLessThan(1080);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1920);
    }
    expect(placeLanterns(7, 0, 1920, 420, 1080)).toEqual([]);
  });

  it('degrades gracefully on empty data and the sumi silhouette has no text', () => {
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(5, empty, size);
      expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(c.svg);
      expect(safeZoneViolations(c, size)).toEqual([]);
    }
  });
});
