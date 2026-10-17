import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { spec } from './fuji-ridge';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

describe('fuji-ridge', () => {
  it('declares its catalog id', () => {
    expect(spec.id).toBe('fuji-ridge');
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
    const long = spec.compose(3, { ...DATA, nameKana: 'ナガイナマエノガクシュウシャデス' }, 'phone');
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
  });

  it('seed changes the brush, not the subject', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    // the ridge line, the snow cap and the lake survive every seed
    for (const c of [a, b]) {
      expect(c.svg).toContain('id="fr-mtn"');
      expect(c.svg).toContain('id="fr-lake"');
      expect(c.svg).toContain('id="fr-mist"');
    }
  });

  it('the ridge is the data: different minutes draw a different mountain', () => {
    const busy = spec.compose(1, DATA, 'desktop');
    const quiet = spec.compose(1, { ...DATA, minutes90: DATA.minutes90.map(() => 0) }, 'desktop');
    expect(busy.svg).not.toBe(quiet.svg);
    expect(quiet.svg).not.toMatch(/NaN/);
    const spiky = spec.compose(1, { ...DATA, minutes90: DATA.minutes90.map((_, i) => (i % 7 === 0 ? 240 : 0)) }, 'phone');
    expect(spiky.svg).not.toMatch(/NaN/);
    parse(spiky.svg);
  });

  it('personal text: name, caption with the 90-day total, era date, chosen kanji on a hanko', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const total = Math.round(DATA.minutes90.reduce((a, b) => a + b, 0));
    expect(c.texts.some((t) => t.text === DATA.nameKana && t.vertical)).toBe(true);
    expect(c.texts.some((t) => t.text.includes('九十日') && t.text.includes(`${total}分`))).toBe(true);
    expect(c.texts.some((t) => /年\d+月\d+日/.test(t.text))).toBe(true);
    expect(c.texts.some((t) => t.text === DATA.chosenKanji)).toBe(true);
    // the data line carries the belt colour
    expect(c.svg.toLowerCase()).toContain('#3e9b4f');
    const black = spec.compose(1, { ...DATA, belt: 'black' }, 'desktop');
    expect(black.svg.toLowerCase()).toContain('#0b0b10');
  });

  it('degrades on an empty save: no chosen kanji, zero minutes, short minutes array', () => {
    const empty = normalizeData({});
    const c = spec.compose(7, empty, 'phone');
    expect(isComposition(c)).toBe(true);
    expect(c.texts.some((t) => t.text === '無名')).toBe(true);
    expect(c.texts.filter((t) => t.rotate === -4)).toEqual([]);
    expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
    parse(c.svg);
    const short = spec.compose(7, { ...empty, minutes90: [5, 10, 15] }, 'desktop');
    expect(short.svg).not.toMatch(/NaN/);
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
  });
});
