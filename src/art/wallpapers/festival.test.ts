import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { spec } from './festival';
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

describe('festival', () => {
  it('exports the spec for its catalog id with a grain post pass', () => {
    expect(spec.id).toBe('festival');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('grain');
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
      expect(doc.querySelector('svg > title')?.textContent).toBe('Festival Night');
      // lantern strings are catenary polylines; lanterns hang on them
      expect(doc.querySelectorAll('polyline[stroke="#1A1A1F"]').length).toBeGreaterThanOrEqual(4);
      expect(doc.querySelectorAll('circle[fill="url(#fs-lglow)"]').length).toBeGreaterThan(20);
      expect(fingerprint(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for many seeds', () => {
    for (let seed = 1; seed <= 8; seed++) {
      expect(safeZoneViolations(spec.compose(seed, DATA, 'phone'), 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
    }
  });

  it('seed changes fireworks, crowd and cloth but keeps the words', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    const bursts = (svg: string): number => parse(svg).querySelectorAll('g[filter="url(#fs-glow)"] > g').length;
    const counts = new Set([1, 2, 3, 4, 5, 6].map((s) => bursts(spec.compose(s, DATA, 'desktop').svg)));
    expect(counts.size).toBeGreaterThan(1);
    for (const n of counts) expect(n).toBeGreaterThanOrEqual(2);
  });

  it('banners carry short mastered words in vertical brush type; the great lantern reads 祭', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const banners = c.texts.filter((t) => t.vertical);
    expect(banners.length).toBe(4);
    const words = new Set(DATA.mastered.vocab.map((v) => v.word));
    for (const b of banners) {
      expect(words.has(b.text)).toBe(true);
      expect(Array.from(b.text).length).toBeLessThanOrEqual(5);
      expect(b.font).toContain('Yuji Syuku');
    }
    const matsuri = c.texts.find((t) => t.text === S.festival.matsuri);
    expect(matsuri).toBeDefined();
    expect(matsuri!.anchor).toBe('middle');
    expect(spec.compose(1, DATA, 'phone').texts.filter((t) => t.vertical).length).toBe(2);
  });

  it('falls back to festival words when nothing is mastered yet, and empty data composes', () => {
    const none = spec.compose(1, { ...DATA, mastered: { kana: [], kanji: [], vocab: [] } }, 'desktop');
    const banners = none.texts.filter((t) => t.vertical).map((t) => t.text);
    expect(banners.every((wd) => (S.festival.fallbackWords as readonly string[]).includes(wd))).toBe(true);
    const empty = spec.compose(1, normalizeData({}), 'phone');
    expect(isComposition(empty)).toBe(true);
    expect(empty.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(safeZoneViolations(empty, 'phone')).toEqual([]);
    parse(empty.svg);
  });
});
