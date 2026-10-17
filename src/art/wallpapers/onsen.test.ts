import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { spec } from './onsen';

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
});
