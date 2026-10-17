import { fnv1a32 } from '../../shared/hash';
import { pointInPolygon } from '../geom';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-2';
import { brickPattern, challengerTexts, spec, speedLines, vsLayout, vsSlab } from './vs-wall';

const DATA = sampleData(1);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

describe('vs-wall', () => {
  it('exports the spec under its catalog id', () => {
    expect(spec.id).toBe('vs-wall');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, reasonable node count (snapshot)`, () => {
      const a = spec.compose(1, DATA, size);
      const b = spec.compose(1, DATA, size);
      expect(isComposition(a)).toBe(true);
      expect(a.svg).toBe(b.svg);
      expect(a.texts).toEqual(b.texts);
      expect(a.post).toBe('scanlines');
      expect(hasCanvasSize(a, size)).toBe(true);
      expect(isSelfContained(a.svg)).toBe(true);
      expect(usesReservedIds(a.svg)).toBe(false);
      expect(a.svg).not.toMatch(/NaN|Infinity|undefined/);
      const doc = parse(a.svg);
      expect(doc.querySelectorAll('*').length).toBeLessThan(4000);
      expect(doc.querySelector('pattern#brick')).not.toBeNull();
      expect(doc.querySelector('pattern#halftone')).not.toBeNull();
      expect(doc.querySelector('clipPath#clipL')).not.toBeNull();
      expect(fp(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones', () => {
    const c = spec.compose(1, DATA, 'phone');
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
  });

  it('left: the challenger name in the neon face; right: 壁 — both as TextLayers, never in the SVG', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const name = c.texts.find((t) => t.text === DATA.nameKana)!;
    const wall = c.texts.find((t) => t.text === S.wall)!;
    expect(name.font.includes('Dela Gothic One')).toBe(true);
    expect(wall.font.includes('Dela Gothic One')).toBe(true);
    expect(name.x).toBeLessThan(960);
    expect(wall.x).toBeGreaterThan(960);
    expect(c.texts.map((t) => t.text)).toContain(S.challenger);
    expect(c.texts.map((t) => t.text)).toContain(S.wallArc);
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.svg).not.toContain(S.wall);
    // phone: challenger on top, wall below
    const p = spec.compose(1, DATA, 'phone');
    expect(p.texts.find((t) => t.text === DATA.nameKana)!.y).toBeLessThan(p.texts.find((t) => t.text === S.wall)!.y);
  });

  it('vsLayout splits the canvas into two panels that contain their own text anchors', () => {
    for (const size of WALLPAPER_SIZES) {
      const L0 = vsLayout(1, size);
      expect(L0.split.length).toBeGreaterThan(10);
      expect(L0.left.length).toBeGreaterThan(3);
      expect(L0.right.length).toBeGreaterThan(3);
      const texts = challengerTexts(L0, DATA, size);
      expect(pointInPolygon([texts[1]!.x, texts[1]!.y - texts[1]!.size * 0.4], L0.left)).toBe(true);
      expect(pointInPolygon([texts[1]!.x, texts[1]!.y - texts[1]!.size * 0.4], L0.right)).toBe(false);
      // normal points into the wall panel
      const mid = L0.split[Math.floor(L0.split.length / 2)]!;
      expect(pointInPolygon([mid[0] + L0.nrm[0] * 60, mid[1] + L0.nrm[1] * 60], L0.right)).toBe(true);
    }
    expect(vsLayout(1, 'desktop').split).not.toEqual(vsLayout(2, 'desktop').split);
  });

  it('building blocks: speed lines are one path of triangles, the slab draws V and S in the face colour, brick pattern is well-formed', () => {
    const d = speedLines(3, 100, 100, 1920, 1080, 25);
    expect((d.match(/Z/g) ?? []).length).toBe(25);
    expect(d).not.toMatch(/NaN/);
    const slab = vsSlab(500, 300, 20, { face: '#E0B341', side: '#333333' });
    const doc = parse(`<svg xmlns="http://www.w3.org/2000/svg">${slab}</svg>`);
    expect(doc.querySelectorAll('rect[fill="#E0B341"]').length).toBeGreaterThan(20);
    expect(doc.querySelector('g[transform*="skewX"]')).not.toBeNull();
    parse(`<svg xmlns="http://www.w3.org/2000/svg">${brickPattern('b', 80, 36, '#333', '#111')}</svg>`);
  });

  it('long names shrink to fit; empty data degrades gracefully; the belt colour appears as the sash', () => {
    const long = spec.compose(1, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード', belt: 'purple' }), 'desktop');
    const name = long.texts.find((t) => t.text.startsWith('クリス'))!;
    expect(name.size).toBeLessThan(150);
    expect(long.svg).toContain('#7A3FB5');
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(5, empty, size);
      expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(c.svg);
      expect(safeZoneViolations(c, size)).toEqual([]);
    }
    expect(spec.compose(1, DATA, 'desktop').svg).not.toBe(spec.compose(2, DATA, 'desktop').svg);
  });
});
