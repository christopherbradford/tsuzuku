import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { spec } from './golden-screen';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, sizeOf, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-4';

const DATA = sampleData(1);

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

describe('golden-screen', () => {
  it('exports the spec for its catalog id without a post pass (gold leaf stays clean)', () => {
    expect(spec.id).toBe('golden-screen');
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
      expect(doc.querySelector('svg > title')?.textContent).toBe('Golden Screen');
      // six panels of leaf: the crisp leaf group holds hundreds of squares
      const leaves = doc.querySelectorAll('g[shape-rendering="crispEdges"] rect').length;
      expect(leaves).toBeGreaterThan(300);
      expect(fingerprint(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for many seeds, including long names', () => {
    for (let seed = 1; seed <= 6; seed++) {
      expect(safeZoneViolations(spec.compose(seed, DATA, 'phone'), 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
      const long = spec.compose(seed, { ...DATA, nameKana: 'クリストファー・ブラッドフォード' }, 'phone');
      expect(safeZoneViolations(long, 'phone')).toEqual([]);
    }
  });

  it('seed changes leaf, clouds and cranes but keeps the identity and the words', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    // every leaf square differs in luminance from its neighbour somewhere: more than one leaf colour
    const fills = new Set(Array.from(parse(a.svg).querySelectorAll('g[shape-rendering="crispEdges"] rect')).map((r) => r.getAttribute('fill')));
    expect(fills.size).toBeGreaterThan(20);
  });

  it('panel six carries the greeting, the honorific name and the era date as vertical mincho columns', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const { w } = sizeOf('desktop');
    expect(c.texts.every((t) => t.vertical && t.font.includes('Shippori Mincho'))).toBe(true);
    const name = c.texts.find((t) => t.text === `${DATA.nameKana}${S.goldenScreen.honorific}`);
    expect(name).toBeDefined();
    expect(name!.x).toBeGreaterThan(w * (5 / 6));
    expect(c.texts.some((t) => t.text === S.goldenScreen.greeting)).toBe(true);
    expect(c.texts.some((t) => t.text === S.goldenScreen.occasion)).toBe(true);
    expect(c.texts.some((t) => /年.*月.*日/.test(t.text))).toBe(true);
    // columns flow right to left: name is the rightmost
    const xs = c.texts.map((t) => t.x);
    expect(Math.max(...xs)).toBe(name!.x);
  });

  it('draws cranes with a red crown and clips clouds to the screen', () => {
    const doc = parse(spec.compose(4, DATA, 'desktop').svg);
    expect(doc.querySelectorAll('circle[fill="#C9302C"]').length).toBeGreaterThanOrEqual(3);
    expect(doc.querySelector('clipPath#gs-screen')).not.toBeNull();
    expect(doc.querySelectorAll('g[clip-path="url(#gs-screen)"]').length).toBe(3);
  });

  it('empty data still composes', () => {
    const empty = spec.compose(1, normalizeData({}), 'phone');
    expect(isComposition(empty)).toBe(true);
    expect(empty.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(safeZoneViolations(empty, 'phone')).toEqual([]);
    parse(empty.svg);
  });
});
