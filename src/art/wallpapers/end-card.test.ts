import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { spec } from './end-card';
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

describe('end-card', () => {
  it('exports the spec for its catalog id with a grain post pass', () => {
    expect(spec.id).toBe('end-card');
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
      expect(doc.querySelector('svg > title')?.textContent).toBe('End Card');
      expect(fingerprint(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for many seeds', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
    }
  });

  it('seed changes the brushwork but not the words', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    expect(a.post).toBe(b.post);
  });

  it('carries つづく in the brush font, the streak in small type and the chosen kanji on the seal', () => {
    const c = spec.compose(3, DATA, 'desktop');
    const main = c.texts[0]!;
    expect(main.text).toBe(S.endCard.tsuzuku);
    expect(main.font).toContain('Yuji Syuku');
    const streak = c.texts.find((t) => t.text.includes(String(DATA.streak)));
    expect(streak).toBeDefined();
    expect(streak!.size).toBeLessThan(main.size / 4);
    expect(c.texts.some((t) => t.text === DATA.chosenKanji)).toBe(true);
    // the vermilion seal frame is drawn in the SVG
    expect(c.svg).toContain('fill-rule="evenodd"');
    expect(c.svg).toContain('#C9302C');
  });

  it('degrades gracefully: no chosen kanji falls back to the first glyph of the name; empty data still composes', () => {
    const noKanji = spec.compose(1, { ...DATA, chosenKanji: undefined, nameKana: 'ミナト' }, 'phone');
    expect(noKanji.texts.some((t) => t.text === 'ミ')).toBe(true);
    const empty = spec.compose(1, normalizeData({}), 'phone');
    expect(isComposition(empty)).toBe(true);
    expect(empty.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(safeZoneViolations(empty, 'phone')).toEqual([]);
    expect(empty.texts.some((t) => t.text.includes('0'))).toBe(true);
    parse(empty.svg);
  });
});
