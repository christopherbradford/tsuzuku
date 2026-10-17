import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { spec } from './shoji-light';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

describe('shoji-light', () => {
  it('declares its catalog id', () => {
    expect(spec.id).toBe('shoji-light');
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

  it('seed moves the light and the bamboo but keeps the wall', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    for (const c of [a, b]) {
      expect(c.svg).toContain('id="sl-light"');
      expect(c.svg).toContain('id="sl-shadow-2"');
      expect(c.svg).toContain('fill-rule="evenodd"');
    }
  });

  it('the panels carry the Brown grammar patterns at 8 % opacity, one per cell, up to the wall\'s capacity', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const doc = parse(c.svg);
    const layer = Array.from(doc.querySelectorAll('g[opacity="0.08"]')).find((g) => g.getAttribute('lang') === 'ja');
    expect(layer).toBeDefined();
    expect(layer!.querySelectorAll(':scope > g').length).toBe(DATA.grammarBrown.length);
    expect(c.svg).toContain('>で<');
    const hundred = Array.from({ length: 100 }, (_, i) => `〜${i}型`);
    const full = spec.compose(1, { ...DATA, grammarBrown: hundred }, 'desktop');
    const fullDoc = parse(full.svg);
    const fullLayer = Array.from(fullDoc.querySelectorAll('g[opacity="0.08"]')).find((g) => g.getAttribute('lang') === 'ja')!;
    const placed = fullLayer.querySelectorAll(':scope > g').length;
    expect(placed).toBeGreaterThanOrEqual(60);
    expect(placed).toBeLessThanOrEqual(100);
    expect(full.texts.some((t) => t.text === '100型')).toBe(true);
    // the long dash rotates like real tategaki
    expect(full.svg).toMatch(/<text[^>]*transform="rotate\(90 /);
  });

  it('personal text: name on the plaque, pattern count, era date', () => {
    const c = spec.compose(1, DATA, 'phone');
    expect(c.texts.some((t) => t.text === DATA.nameKana && t.vertical)).toBe(true);
    expect(c.texts.some((t) => t.text === `${DATA.grammarBrown.length}型`)).toBe(true);
    expect(c.texts.some((t) => /年\d+月\d+日/.test(t.text))).toBe(true);
  });

  it('degrades on an empty save: no patterns → plain paper, still a plaque and a date', () => {
    const c = spec.compose(11, normalizeData({}), 'phone');
    expect(isComposition(c)).toBe(true);
    expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
    const doc = parse(c.svg);
    expect(doc.querySelector('g[opacity="0.08"][lang="ja"]')).toBeNull();
    expect(c.texts.some((t) => t.text === '0型')).toBe(true);
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
  });
});
