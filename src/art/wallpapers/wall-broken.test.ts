import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-2';
import { spec as vsWall, vsLayout } from './vs-wall';
import { MAX_PIECES, MIN_PIECES, fragments, spec } from './wall-broken';

const DATA = sampleData(1);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

const fragmentCount = (svg: string): number => parse(svg).querySelectorAll('path[fill="url(#brick)"]').length;

describe('wall-broken', () => {
  it('exports the spec under its catalog id', () => {
    expect(spec.id).toBe('wall-broken');
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
      expect(doc.querySelector('radialGradient#light')).not.toBeNull();
      expect(fp(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones', () => {
    const c = spec.compose(1, DATA, 'phone');
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
  });

  it('keeps the VS composition: same split as vs-wall for the same seed, the name on the challenger side, 越 where 壁 stood', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const v = vsWall.compose(1, DATA, 'desktop');
    const splitPoints = /<polyline points="([^"]+)"/.exec(v.svg)?.[1];
    expect(splitPoints).toBeTruthy();
    expect(a.svg).toContain(`points="${splitPoints}"`);
    expect(a.texts.find((t) => t.text === DATA.nameKana)!.x).toBeLessThan(960);
    const beyond = a.texts.find((t) => t.text === S.beyond)!;
    expect(beyond.x).toBeGreaterThan(960);
    expect(a.texts.map((t) => t.text)).toContain(S.beyondTitle);
    expect(a.texts.map((t) => t.text)).not.toContain(S.wall);
    expect(a.svg).not.toContain(DATA.nameKana);
  });

  it('one fragment per grammar point mastered in the arc, clamped 10–40; Brown grammar is the fallback', () => {
    expect(fragmentCount(spec.compose(2, sampleData(1, { arcGrammar: ['〜ば', '〜たら', '〜なら'] }), 'desktop').svg)).toBe(MIN_PIECES);
    const many = Array.from({ length: 70 }, (_, i) => `〜${i}`);
    expect(fragmentCount(spec.compose(2, sampleData(1, { arcGrammar: many }), 'desktop').svg)).toBe(MAX_PIECES);
    expect(fragmentCount(spec.compose(2, sampleData(1, { arcGrammar: Array.from({ length: 22 }, (_, i) => `〜${i}`) }), 'desktop').svg)).toBe(22);
    const fallback = spec.compose(2, sampleData(1, { arcGrammar: [], grammarBrown: ['〜です', '〜ます'] }), 'desktop');
    expect(fallback.texts.some((t) => t.text === '〜です')).toBe(true);
  });

  it('fragments carry their grammar labels as rotated pixel-font TextLayers, off the slab and the 越 block', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const labels = c.texts.filter((t) => DATA.arcGrammar.includes(t.text));
    expect(labels.length).toBeGreaterThan(0);
    const L0 = vsLayout(1, 'desktop');
    for (const l of labels) {
      expect(l.font.includes('DotGothic16')).toBe(true);
      expect(typeof l.rotate).toBe('number');
      expect(Math.hypot(l.x - L0.cx, l.y - L0.cy)).toBeGreaterThanOrEqual(290);
      expect(l.x).toBeGreaterThan(960 * 0.6);
    }
    const phone = spec.compose(1, DATA, 'phone');
    expect(phone.texts.filter((t) => DATA.arcGrammar.includes(t.text)).length).toBeGreaterThan(0);
  });

  it('fragments fly away from the burst, closer pieces further and more tilted', () => {
    const L0 = vsLayout(1, 'desktop');
    const burst: [number, number] = [L0.cx + L0.nrm[0] * 250, L0.cy + L0.nrm[1] * 250];
    const fr = fragments(1, L0.right, 20, burst, 1920, 1080, false);
    expect(fr.length).toBe(20);
    for (const f of fr) {
      const before = Math.hypot(f.c[0] - burst[0], f.c[1] - burst[1]);
      const after = Math.hypot(f.c[0] + f.dx - burst[0], f.c[1] + f.dy - burst[1]);
      expect(after).toBeGreaterThan(before);
      expect(Math.abs(f.rot)).toBeLessThanOrEqual(30);
    }
    const near = fr.reduce((a, b) => (a.k > b.k ? a : b));
    const far = fr.reduce((a, b) => (a.k < b.k ? a : b));
    expect(Math.hypot(near.dx, near.dy)).toBeGreaterThan(Math.hypot(far.dx, far.dy));
  });

  it('different seeds differ; empty data degrades gracefully', () => {
    expect(spec.compose(1, DATA, 'desktop').svg).not.toBe(spec.compose(2, DATA, 'desktop').svg);
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(5, empty, size);
      expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(c.svg);
      expect(safeZoneViolations(c, size)).toEqual([]);
      expect(fragmentCount(c.svg)).toBe(MIN_PIECES);
    }
  });
});
