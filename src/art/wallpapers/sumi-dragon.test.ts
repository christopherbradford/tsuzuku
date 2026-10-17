import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-2';
import { MAX_SEGMENTS, MIN_SEGMENTS, dragonPressure, dragonSpine, spec } from './sumi-dragon';

const DATA = sampleData(1);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

/** The scale-tick path holds one `M` per body segment (segments − 1 interior points). */
function tickCount(svg: string): number {
  const doc = parse(svg);
  const ticks = Array.from(doc.querySelectorAll('path.scales'));
  const d = ticks[0]?.getAttribute('d') ?? '';
  return (d.match(/M/g) ?? []).length;
}

describe('sumi-dragon', () => {
  it('exports the spec under its catalog id and is a living piece', () => {
    expect(spec.id).toBe('sumi-dragon');
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
  });

  it('personal text lives in TextLayers: name, longest streak, chosen kanji on the seal', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.texts.some((t) => t.text === DATA.nameKana && t.font.includes('Yuji'))).toBe(true);
    expect(c.texts.some((t) => t.text === `${S.longestStreak} ${DATA.streak}${S.daysUnit}`)).toBe(true);
    expect(c.texts.some((t) => t.text === DATA.chosenKanji)).toBe(true);
    const noKanji = spec.compose(1, sampleData(1, { chosenKanji: undefined }), 'desktop');
    expect(noKanji.texts.some((t) => t.text === S.defaultSeal)).toBe(true);
  });

  it('one body segment per day of the longest streak, clamped to 30–365, so it never shrinks', () => {
    const seg = (streak: number): number => tickCount(spec.compose(4, sampleData(1, { streak }), 'desktop').svg);
    expect(seg(100)).toBe(100 - 1);
    expect(seg(5)).toBe(MIN_SEGMENTS - 1);
    expect(seg(900)).toBe(MAX_SEGMENTS - 1);
    expect(seg(200)).toBeGreaterThan(seg(60));
  });

  it('different seeds coil differently; the spine stays on the canvas', () => {
    expect(spec.compose(1, DATA, 'desktop').svg).not.toBe(spec.compose(2, DATA, 'desktop').svg);
    for (const [w, h, phone] of [[1920, 1080, false], [1080, 2340, true]] as const) {
      const pts = dragonSpine(9, w, h, phone);
      expect(pts.length).toBeGreaterThan(50);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(h);
      }
    }
  });

  it('pressure envelope: thin tail, full body, never below the floor', () => {
    expect(dragonPressure(0)).toBeLessThan(0.1);
    expect(dragonPressure(0.6)).toBeGreaterThan(0.85);
    expect(dragonPressure(1)).toBeGreaterThan(0.5);
    for (let t = 0; t <= 1; t += 0.05) expect(dragonPressure(t)).toBeGreaterThanOrEqual(0.05);
  });

  it('degrades gracefully on empty data', () => {
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(5, empty, size);
      expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(c.svg);
      expect(safeZoneViolations(c, size)).toEqual([]);
    }
  });
});
