import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { spec } from './road-continues';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-4';

const DATA = sampleData(1);

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

describe('road-continues', () => {
  it('exports the spec for its catalog id without a post pass', () => {
    expect(spec.id).toBe('road-continues');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('none');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: seed 1 + fixture data is deterministic, well-formed and self-contained (snapshot)`, () => {
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
      expect(doc.querySelectorAll('*').length).toBeLessThan(4000);
      expect(doc.querySelector('svg > title')?.textContent).toBe('The Road Continues');
      expect(fingerprint(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for many seeds', () => {
    for (let seed = 1; seed <= 8; seed++) {
      expect(safeZoneViolations(spec.compose(seed, DATA, 'phone'), 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
    }
  });

  it('seed moves the vanishing point and the sky but keeps the words', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    const sunX = (svg: string): string | null => parse(svg).querySelector('circle[fill="#FFF3C4"]')?.getAttribute('cx') ?? null;
    expect(sunX(a.svg)).not.toBe(sunX(b.svg));
  });

  it('the road recedes: dashes and poles shrink toward the vanishing point, wires sag between poles', () => {
    const doc = parse(spec.compose(1, DATA, 'desktop').svg);
    const dashes = Array.from(doc.querySelectorAll('polygon[fill="#F4EDE0"][opacity="0.85"]'));
    expect(dashes.length).toBeGreaterThan(10);
    const heights = dashes.map((d) => {
      const ys = d.getAttribute('points')!.split(' ').map((p) => Number(p.split(',')[1]));
      return Math.max(...ys) - Math.min(...ys);
    });
    for (let i = 1; i < heights.length; i++) expect(heights[i]!).toBeLessThanOrEqual(heights[i - 1]! + 0.01);
    const wires = doc.querySelectorAll('polyline[stroke="#2A1F2E"][opacity="0.8"]');
    expect(wires.length).toBeGreaterThanOrEqual(6);
  });

  it('the signpost names the traveller and carries the streak and total days; つづく crosses the sky in brush', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(c.texts[0]!.text).toBe(DATA.nameKana);
    expect(c.texts[1]!.text).toBe(`${DATA.streak}日連続`);
    expect(c.texts[2]!.text).toBe(`通算${DATA.totalDays}日`);
    for (const t of c.texts.slice(0, 3)) expect(t.font).toContain('Shippori Mincho');
    const main = c.texts[3]!;
    expect(main.text).toBe(S.roadContinues.tsuzuku);
    expect(main.font).toContain('Yuji Syuku');
    expect(main.y).toBeLessThan(1080 * 0.58);
    expect(main.size).toBeGreaterThan(c.texts[0]!.size * 3);
  });

  it('empty data still composes', () => {
    const empty = spec.compose(1, normalizeData({}), 'phone');
    expect(isComposition(empty)).toBe(true);
    expect(empty.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(safeZoneViolations(empty, 'phone')).toEqual([]);
    expect(empty.texts[1]!.text).toBe('0日連続');
    parse(empty.svg);
  });
});
