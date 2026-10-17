import { fnv1a32 } from '../../shared/hash';
import { FONTS, inSafeZone } from '../jtext';
import { sampleData } from './data';
import { COMPONENTS, componentsOf, spec } from './kanji-stars';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

const starGlyphs = (doc: Document): Element[] => Array.from(doc.querySelectorAll('g[font-family] > text'));

describe('component table', () => {
  it('lists single-glyph components with kanji that contain them; lookups never return the kanji itself', () => {
    for (const [c, members] of COMPONENTS) {
      expect(Array.from(c).length).toBe(1);
      expect(Array.from(members).length).toBeGreaterThanOrEqual(2);
    }
    expect(componentsOf('明')).toEqual(['日', '月']);
    expect(componentsOf('日')).toEqual([]);
    expect(componentsOf('校')).toContain('木');
    expect(componentsOf('ゑ')).toEqual([]);
  });
});

describe('kanji-stars', () => {
  it('exports the spec with its catalog id and no post pass', () => {
    expect(spec.id).toBe('kanji-stars');
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

  it('every Mastered kanji becomes one star, brightness and size falling with rank', () => {
    const doc = parse(spec.compose(1, DATA, 'desktop').svg);
    const glyphs = starGlyphs(doc);
    expect(glyphs.length).toBe(DATA.mastered.kanji.length);
    expect(glyphs.map((g) => g.textContent)).toEqual(DATA.mastered.kanji);
    const first = glyphs[0]!;
    const last = glyphs[glyphs.length - 1]!;
    expect(Number(first.getAttribute('font-size'))).toBeGreaterThan(Number(last.getAttribute('font-size')));
    expect(Number(first.getAttribute('opacity'))).toBeGreaterThan(Number(last.getAttribute('opacity')));
    // stars never share a position
    const pos = new Set(glyphs.map((g) => `${g.getAttribute('x')},${g.getAttribute('y')}`));
    expect(pos.size).toBe(glyphs.length);
    // Milky Way and dust
    expect(doc.querySelector('filter#ks-mw feTurbulence')).not.toBeNull();
    expect(doc.querySelector('mask#ks-mask')).not.toBeNull();
  });

  it('joins kanji that share a component and labels the three most common components as TextLayers', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const doc = parse(c.svg);
    const edges = Array.from(doc.querySelectorAll('line')).filter((l) => (l.getAttribute('stroke') ?? '').startsWith('rgba('));
    expect(edges.length).toBeGreaterThan(5);
    const labels = c.texts.slice(0, 3).map((t) => t.text);
    expect(labels.length).toBe(3);
    for (const l of labels) expect(COMPONENTS.some(([comp]) => comp === l)).toBe(true);
    // 日 is by far the most used component of the sample kanji
    expect(labels).toContain('日');
    for (const t of c.texts.slice(0, 3)) expect(t.font).toBe(FONTS.mincho);
    expect(c.texts.map((t) => t.text)).toContain(DATA.nameKana);
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.svg.toLowerCase()).toContain('#3e9b4f');
  });

  it('black belts see the brightest third in kin', () => {
    const black = spec.compose(1, sampleData(1, { belt: 'black' }), 'desktop');
    const green = spec.compose(1, DATA, 'desktop');
    const kinGlyphs = (svg: string): number => starGlyphs(parse(svg)).filter((g) => (g.getAttribute('fill') ?? '').toLowerCase() === '#e0b341').length;
    expect(kinGlyphs(black.svg)).toBe(Math.ceil(DATA.mastered.kanji.length / 3));
    expect(kinGlyphs(green.svg)).toBe(0);
  });

  it('caps the sky at 120 stars on desktop and 90 on the phone; no kanji means a quiet sky', () => {
    const many = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    const big = sampleData(1, { mastered: { kana: [], kanji: many, vocab: [] } });
    expect(starGlyphs(parse(spec.compose(1, big, 'desktop').svg)).length).toBeLessThanOrEqual(120);
    expect(starGlyphs(parse(spec.compose(1, big, 'phone').svg)).length).toBeLessThanOrEqual(90);
    expect(starGlyphs(parse(spec.compose(1, big, 'desktop').svg)).length).toBeGreaterThan(80);
    const none = spec.compose(1, sampleData(1, { mastered: { kana: [], kanji: [], vocab: [] } }), 'phone');
    expect(starGlyphs(parse(none.svg)).length).toBe(0);
    expect(none.texts.map((t) => t.text)).toEqual([DATA.nameKana, '令和8年5月20日', '漢字星座']);
    expect(safeZoneViolations(none, 'phone')).toEqual([]);
  });

  it('phone: labels, name and date stay inside the safe zones for several seeds', () => {
    for (const seed of [1, 2, 3, 5, 21]) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
      for (const t of c.texts) expect(inSafeZone(t, 'phone')).toBe(true);
    }
  });

  it('seed re-rolls positions and the Milky Way, keeping the same stars', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const firstPos = (svg: string): string => {
      const g = starGlyphs(parse(svg))[0]!;
      return `${g.getAttribute('x')},${g.getAttribute('y')}`;
    };
    expect(firstPos(a.svg)).not.toBe(firstPos(b.svg));
    expect(starGlyphs(parse(a.svg)).map((g) => g.textContent)).toEqual(starGlyphs(parse(b.svg)).map((g) => g.textContent));
  });
});
