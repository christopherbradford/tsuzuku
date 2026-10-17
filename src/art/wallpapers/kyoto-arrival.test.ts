import { BELTS } from '../../content/types';
import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { spec } from './kyoto-arrival';
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

describe('kyoto-arrival', () => {
  it('exports the spec for its catalog id without a post pass', () => {
    expect(spec.id).toBe('kyoto-arrival');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('none');
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
      expect(doc.querySelector('svg > title')?.textContent).toBe('Kyoto Arrival');
      // the bridge is drawn once and mirrored into the water through the ripple filter
      expect(doc.querySelector('g#ka-bridge')).not.toBeNull();
      const mirror = doc.querySelector('use[href="#ka-bridge"]');
      expect(mirror?.getAttribute('transform')).toMatch(/scale\(1 -1\)/);
      expect(doc.querySelectorAll('[filter="url(#ka-ripple)"]').length).toBeGreaterThanOrEqual(3);
      expect(fingerprint(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for many seeds', () => {
    for (let seed = 1; seed <= 8; seed++) {
      expect(safeZoneViolations(spec.compose(seed, DATA, 'phone'), 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
    }
  });

  it('seed moves the sun, pagoda and geese but keeps the title', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    const pagodaX = (svg: string): string | null => parse(svg).querySelector('g#ka-bridge')?.previousElementSibling?.getAttribute('fill') ?? null;
    expect(pagodaX(a.svg)).not.toBeNull();
  });

  it('carries the full title (name, belt title, 初段), the era date with 京都着 and the chosen kanji on a seal', () => {
    const c = spec.compose(1, { ...DATA, belt: 'black' }, 'desktop');
    const black = BELTS.find((b) => b.id === 'black')!;
    expect(c.texts[0]!.text).toBe(DATA.nameKana);
    expect(c.texts[0]!.font).toContain('Shippori Mincho');
    expect(c.texts[1]!.text).toBe(`${black.titleJa}　${S.kyotoArrival.shodan}`);
    expect(c.texts[2]!.text).toMatch(/年.*月.*日　京都着$/);
    expect(c.texts[3]!.text).toBe(DATA.chosenKanji);
    expect(c.texts[3]!.font).toContain('Yuji Syuku');
    expect(c.svg).toContain('fill-rule="evenodd"');
    // the green belt's title when previewed before Shodan
    expect(spec.compose(1, DATA, 'desktop').texts[1]!.text.startsWith(BELTS.find((b) => b.id === 'green')!.titleJa)).toBe(true);
  });

  it('phone centres the title block; desktop sets it lower-left', () => {
    const d = spec.compose(1, DATA, 'desktop');
    const p = spec.compose(1, DATA, 'phone');
    expect(d.texts[0]!.anchor).toBe('start');
    expect(p.texts[0]!.anchor).toBe('middle');
    expect(p.texts[0]!.x).toBe(540);
  });

  it('empty data still composes and falls back to the first glyph of the name on the seal', () => {
    const empty = spec.compose(1, normalizeData({}), 'phone');
    expect(isComposition(empty)).toBe(true);
    expect(empty.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(safeZoneViolations(empty, 'phone')).toEqual([]);
    expect(empty.texts[3]!.text).toBe('無');
    parse(empty.svg);
  });
});
