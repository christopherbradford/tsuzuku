import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { darumaEyes, spec } from './daruma';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

/** Painted pupils are the only circles that carry the ink-bleed filter. */
function pupils(svg: string): number {
  return (svg.match(/<circle[^>]*filter="url\(#dr-bleed\)"/g) ?? []).length;
}

describe('daruma', () => {
  it('declares its catalog id and is a living piece', () => {
    expect(spec.id).toBe('daruma');
    expect(spec.living).toBe(true);
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

  it('seed changes the brush (tilt, ribbons, flecks) but keeps the daruma', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    for (const c of [a, b]) {
      expect(c.svg).toContain('id="dr-shu"');
      expect(c.svg).toContain('id="dr-bleed"');
      expect(c.svg).toContain('#f7efdf'.toUpperCase()); // the cream face
    }
  });

  it('eyes follow the belt: none below Blue, the left (viewer\'s right) from Blue, both at Shodan', () => {
    expect(darumaEyes('green')).toEqual({ left: false, right: false });
    expect(darumaEyes('blue')).toEqual({ left: true, right: false });
    expect(darumaEyes('brown')).toEqual({ left: true, right: false });
    expect(darumaEyes('black')).toEqual({ left: true, right: true });
    expect(pupils(spec.compose(1, { ...DATA, belt: 'green' }, 'desktop').svg)).toBe(0);
    const blue = spec.compose(1, { ...DATA, belt: 'blue' }, 'desktop');
    expect(pupils(blue.svg)).toBe(1);
    const black = spec.compose(1, { ...DATA, belt: 'black' }, 'desktop');
    expect(pupils(black.svg)).toBe(2);
    // the single painted pupil sits right of centre (the daruma's own left eye)
    const m = /<circle cx="([\d.]+)"[^>]*filter="url\(#dr-bleed\)"/.exec(blue.svg)!;
    expect(Number(m[1])).toBeGreaterThan(1920 / 2);
    // the cushion carries the belt colour
    expect(blue.svg.toLowerCase()).toContain('#2f6fd6');
    expect(black.svg.toLowerCase()).toContain('#0b0b10');
  });

  it('belly kanji is the chosen one (福 until chosen), name and date as text layers', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const belly = c.texts.find((t) => t.text === DATA.chosenKanji)!;
    expect(belly).toBeDefined();
    expect(belly.font).toContain('Yuji Syuku');
    expect(c.texts.some((t) => t.text === DATA.nameKana && t.vertical)).toBe(true);
    expect(c.texts.some((t) => /年\d+月\d+日/.test(t.text))).toBe(true);
    const none = spec.compose(1, { ...DATA, chosenKanji: undefined }, 'phone');
    expect(none.texts.some((t) => t.text === '福')).toBe(true);
  });

  it('degrades on an empty save', () => {
    const c = spec.compose(13, normalizeData({}), 'phone');
    expect(isComposition(c)).toBe(true);
    expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(pupils(c.svg)).toBe(0);
    parse(c.svg);
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
  });
});
