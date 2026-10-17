import { fnv1a32 } from '../../shared/hash';
import { NAME_MAX_GLYPHS } from '../../shared/store-types';
import { glyphCount, layerBounds } from '../jtext';
import { normalizeData, sampleData } from './data';
import { canvasViolations, hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { SIGN, spec } from './onsen';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

/** Stones are the only groups rotated about a point that hold exactly two ellipses. */
function stones(doc: Document): number {
  return Array.from(doc.querySelectorAll('g[transform^="rotate("]')).filter((g) => g.children.length === 2 && g.children[0]!.tagName === 'ellipse').length;
}

describe('onsen', () => {
  it('declares its catalog id', () => {
    expect(spec.id).toBe('onsen');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, right canvas (snapshot)`, () => {
      const a = spec.compose(1, DATA, size);
      const b = spec.compose(1, DATA, size);
      expect(isComposition(a)).toBe(true);
      expect(a.svg).toBe(b.svg);
      expect(a.texts).toEqual(b.texts);
      expect(a.post).toBe('none');
      expect(hasCanvasSize(a, size)).toBe(true);
      expect(isSelfContained(a.svg)).toBe(true);
      expect(usesReservedIds(a.svg)).toBe(false);
      expect(a.svg).not.toMatch(/NaN|Infinity|undefined/);
      const doc = parse(a.svg);
      expect(doc.querySelectorAll('*').length).toBeLessThan(4000);
      expect(fingerprint(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones', () => {
    const c = spec.compose(1, DATA, 'phone');
    expect(c.texts.length).toBeGreaterThan(0);
    expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
    const long = spec.compose(5, { ...DATA, nameKana: 'ナガイナマエノガクシュウシャデス' }, 'phone');
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
  });

  it('seed moves the moon, stars and ridges but keeps the bath', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    for (const c of [a, b]) {
      expect(c.svg).toContain('id="on-water"');
      expect(c.svg).toContain('<feTurbulence');
      expect(c.svg).toContain('id="on-steam-mask"');
      expect(c.svg).toContain('>ゆ<');
    }
  });

  it('stones = planned rest days taken (0 → bare rim, capped at 60)', () => {
    expect(stones(parse(spec.compose(1, { ...DATA, restDays: 0 }, 'desktop').svg))).toBe(0);
    expect(stones(parse(spec.compose(1, { ...DATA, restDays: 7 }, 'desktop').svg))).toBe(7);
    expect(stones(parse(spec.compose(1, { ...DATA, restDays: 23 }, 'phone').svg))).toBe(23);
    expect(stones(parse(spec.compose(1, { ...DATA, restDays: 500 }, 'desktop').svg))).toBe(60);
    const c = spec.compose(1, { ...DATA, restDays: 7 }, 'desktop');
    expect(c.texts.some((t) => t.text === '休み7日')).toBe(true);
  });

  it('personal text: name on the fence sign, rest caption, era date; empty save renders', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(c.texts.some((t) => t.text === DATA.nameKana && t.vertical)).toBe(true);
    expect(c.texts.some((t) => /年\d+月\d+日/.test(t.text))).toBe(true);
    const e = spec.compose(19, normalizeData({}), 'phone');
    expect(isComposition(e)).toBe(true);
    expect(e.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(e.texts.some((t) => t.text === '休み0日')).toBe(true);
    parse(e.svg);
    expect(safeZoneViolations(e, 'phone')).toEqual([]);
  });

  it('a name at NAME_MAX_GLYPHS is set in three columns inside a widened sign instead of a floored size running past the fence', () => {
    const name = 'クリストファー・ブラッドフォード・ジュニアだよね';
    expect(glyphCount(name)).toBe(NAME_MAX_GLYPHS);
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(1, normalizeData({ ...DATA, nameKana: name }), size);
      const cols = c.texts.filter((t) => t.vertical && name.includes(t.text));
      expect(cols.length, size).toBe(3);
      expect(cols.map((t) => t.text).join('')).toBe(name);
      expect(cols[0]!.x).toBeGreaterThan(cols[1]!.x); // right to left, like real tategaki
      const sign = Array.from(parse(c.svg).querySelectorAll('rect[rx="3"]')).find((r) => r.getAttribute('fill') === SIGN)!;
      expect(sign).toBeDefined();
      const [sx, sy, sw, sh] = ['x', 'y', 'width', 'height'].map((a) => Number(sign.getAttribute(a)));
      for (const t of cols) {
        const b = layerBounds(t);
        expect(b.x, `${size} left`).toBeGreaterThanOrEqual(sx! - 0.5);
        expect(b.x + b.w, `${size} right`).toBeLessThanOrEqual(sx! + sw! + 0.5);
        expect(b.y, `${size} top`).toBeGreaterThanOrEqual(sy! - 0.5);
        expect(b.y + b.h, `${size} bottom`).toBeLessThanOrEqual(sy! + sh! + 0.5);
        expect(t.size, `${size} legible`).toBeGreaterThanOrEqual(16);
      }
      expect(canvasViolations(c, size)).toEqual([]);
      // the short sample name keeps one column and the original sign width
      const one = spec.compose(1, DATA, size);
      expect(one.texts.filter((t) => t.vertical && t.text === DATA.nameKana).length).toBe(1);
      const signOne = Array.from(parse(one.svg).querySelectorAll('rect[rx="3"]')).find((r) => r.getAttribute('fill') === SIGN)!;
      expect(Number(signOne.getAttribute('width'))).toBe(size === 'phone' ? 96 : 72);
    }
  });
});
