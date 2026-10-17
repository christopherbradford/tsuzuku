import { fnv1a32 } from '../../shared/hash';
import { initials } from '../jtext';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { spec } from './insert-coin';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

describe('insert-coin', () => {
  it('declares its catalog id and asks for scanlines', () => {
    expect(spec.id).toBe('insert-coin');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('scanlines');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, right canvas (snapshot)`, () => {
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
      expect(fingerprint(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones', () => {
    const c = spec.compose(1, DATA, 'phone');
    expect(c.texts.length).toBeGreaterThan(10);
    expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
    const long = spec.compose(5, { ...DATA, nameKana: 'ナガイナマエノガクシュウシャデス' }, 'phone');
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
  });

  it('seed re-dresses the cabinet (body, stripes, buttons) but keeps the parts', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    for (const c of [a, b]) {
      expect(c.svg).toContain('id="ic-marquee"');
      expect(c.svg).toContain('id="ic-screen-clip"');
      expect(c.svg).toContain('id="ic-carpet"');
      expect(c.svg).toContain('fill-rule="evenodd"'); // the bezel
    }
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => spec.compose(s, DATA, 'desktop').svg));
    expect(seeds.size).toBe(6);
  });

  it('marquee = name, hi-score = Rapid Fire best with katakana initials, house rows never beat the learner', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const marquee = c.texts.find((t) => t.text === DATA.nameKana)!;
    expect(marquee).toBeDefined();
    expect(marquee.font).toContain('Dela Gothic One');
    expect(c.texts.some((t) => t.text === 'HI-SCORE')).toBe(true);
    expect(c.texts.some((t) => t.text === 'INSERT COIN')).toBe(true);
    const first = c.texts.find((t) => t.text === '1ST')!;
    const sameRow = c.texts.filter((t) => t.y === first.y);
    expect(sameRow.map((t) => t.text)).toContain(initials(DATA.nameKana));
    expect(sameRow.map((t) => t.text)).toContain(String(DATA.rapidBest).padStart(4, '0'));
    const scores = c.texts.filter((t) => /^\d{4}$/.test(t.text)).map((t) => Number(t.text));
    expect(scores.length).toBe(5);
    expect(scores[0]).toBe(DATA.rapidBest);
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    for (const t of c.texts.filter((t) => /^(1ST|2ND|3RD|4TH|5TH|\d{4}|HI-SCORE|INSERT COIN)$/.test(t.text))) expect(t.font).toContain('DotGothic16');
  });

  it('romaji names become katakana initials; an empty save shows 0000 everywhere', () => {
    const r = spec.compose(1, { ...DATA, nameKana: 'hana' }, 'desktop');
    expect(r.texts.some((t) => t.text === 'ハナ')).toBe(true);
    const c = spec.compose(3, normalizeData({}), 'phone');
    expect(isComposition(c)).toBe(true);
    expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
    const scores = c.texts.filter((t) => /^\d{4}$/.test(t.text)).map((t) => t.text);
    expect(scores).toEqual(['0000', '0000', '0000', '0000', '0000']);
    parse(c.svg);
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
  });
});
