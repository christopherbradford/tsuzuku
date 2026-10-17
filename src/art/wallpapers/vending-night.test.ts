import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { spec } from './vending-night';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

describe('vending-night', () => {
  it('declares its catalog id', () => {
    expect(spec.id).toBe('vending-night');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, right canvas (snapshot)`, () => {
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

  it('400 rain lines, a puddle flip of the machine, seeded variation', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const doc = parse(a.svg);
    const rain = Array.from(doc.querySelectorAll('g[stroke="#FFFFFF"][stroke-linecap="round"]')).find((g) => g.children.length >= 400);
    expect(rain).toBeDefined();
    expect(rain!.querySelectorAll('line').length).toBe(400);
    expect(doc.querySelectorAll('use[href="#vn-machine"]').length).toBe(2);
    expect(doc.querySelector('use[href="#vn-machine"][filter="url(#vn-ripple)"]')?.getAttribute('transform')).toMatch(/scale\(1 -1\)/);
    expect(doc.querySelector('defs > g#vn-machine')).not.toBeNull();
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(new Set([1, 2, 3, 4].map((s) => spec.compose(s, DATA, 'desktop').svg)).size).toBe(4);
  });

  it('can labels are the mastered katakana words; indicators say つめたい / あたたかい', () => {
    const c = spec.compose(1, DATA, 'desktop');
    for (const word of DATA.katakanaBrown.slice(0, 5)) expect(c.svg).toContain(word.includes('ー') ? word[0]! : `>${word}<`);
    expect(c.svg).toContain('つめたい');
    expect(c.texts.some((t) => t.text === `${DATA.katakanaBrown.length}語`)).toBe(true);
    const many = spec.compose(1, { ...DATA, katakanaBrown: Array.from({ length: 300 }, (_, i) => `カナ${i}`) }, 'phone');
    expect(parse(many.svg).querySelectorAll('*').length).toBeLessThan(4000);
    const longWord = spec.compose(1, { ...DATA, katakanaBrown: ['インターナショナル'] }, 'desktop');
    expect(longWord.svg).toContain('>イ<'); // too long for a band → stacked vertically
  });

  it('personal text: name on the lit sign, count, era date; empty save still renders', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const sign = c.texts.find((t) => t.text === DATA.nameKana)!;
    expect(sign).toBeDefined();
    expect(sign.font).toContain('Dela Gothic One');
    expect(c.texts.some((t) => /年\d+月\d+日/.test(t.text))).toBe(true);
    const e = spec.compose(17, normalizeData({}), 'phone');
    expect(isComposition(e)).toBe(true);
    expect(e.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(e.texts.some((t) => t.text === '0語')).toBe(true);
    parse(e.svg);
    expect(safeZoneViolations(e, 'phone')).toEqual([]);
  });
});
