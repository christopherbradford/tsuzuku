import { STATIONS } from '../../content/types';
import { fnv1a32 } from '../../shared/hash';
import { FONTS, inSafeZone } from '../jtext';
import { sampleData } from './data';
import { spec } from './fifty-three';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-1';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

/** Goshuin = evenodd shu seal paths. */
const seals = (doc: Document): Element[] => Array.from(doc.querySelectorAll('path[fill-rule="evenodd"]'));

describe('fifty-three', () => {
  it('exports the living spec with its catalog id and a grain post pass', () => {
    expect(spec.id).toBe('fifty-three');
    expect(spec.living).toBe(true);
    expect(spec.compose(1, DATA, 'desktop').post).toBe('grain');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: byte-identical for the same (seed, data, size); well-formed, self-contained, no reserved ids (snapshot)`, () => {
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
      expect(doc.getElementsByTagName('*').length).toBeLessThan(4000);
      expect(doc.querySelector('pattern#ft-pines')).not.toBeNull();
      expect(fingerprint(a.svg)).toMatchSnapshot();
    });
  }

  it('stamps one goshuin per cleared station, a lantern on the next one and milestones elsewhere', () => {
    const data = sampleData(1, { stamps: [1, 2, 3, 4, 5, 6, 7, 8, 9], station: 10 });
    const doc = parse(spec.compose(1, data, 'desktop').svg);
    expect(seals(doc).length).toBe(9);
    // the seal glyphs are the first kanji of the cleared stations' names
    const sealGlyphs = Array.from(doc.querySelectorAll('g[transform^="rotate"] > text')).map((t) => t.textContent);
    expect(sealGlyphs).toEqual(data.stamps.map((n) => Array.from(STATIONS[n - 1]!.nameJa)[0]));
    expect(doc.querySelector('circle[fill="url(#ft-lantern)"]')).not.toBeNull();
    // 53 - 9 cleared - 1 lantern = 43 plain milestones
    expect(doc.querySelectorAll('circle[stroke="#5E5A52"]').length).toBe(43);
    expect(doc.querySelectorAll('circle[stroke="#5E5A52"]').length + seals(doc).length + 1).toBe(53);
  });

  it('is living: more stamps and a later station change the picture and the position line', () => {
    const early = spec.compose(1, sampleData(1, { stamps: [1, 2], station: 3 }), 'desktop');
    const late = spec.compose(1, sampleData(1, { stamps: Array.from({ length: 40 }, (_, i) => i + 1), station: 41 }), 'desktop');
    expect(early.svg).not.toBe(late.svg);
    expect(seals(parse(late.svg)).length).toBe(40);
    expect(early.texts.map((t) => t.text)).toContain(`${S.here}　${S.stationNo}3${S.stationSuffix}　${STATIONS[2]!.nameJa}`);
    expect(late.texts.map((t) => t.text)).toContain(`${S.here}　${S.stationNo}41${S.stationSuffix}　${STATIONS[40]!.nameJa}`);
    const fresh = spec.compose(1, sampleData(1, { stamps: [], station: 0, totalDays: 0 }), 'phone');
    expect(fresh.texts.map((t) => t.text)).toContain(`${S.here}　${S.edo}　${S.departure}`);
    expect(seals(parse(fresh.svg)).length).toBe(0);
    expect(safeZoneViolations(fresh, 'phone')).toEqual([]);
  });

  it('carries title and name as vertical TextLayers, the day count with the era date, nothing personal in the SVG', () => {
    const c = spec.compose(2, DATA, 'desktop');
    const [title, name, pos, day] = c.texts;
    expect(title!.text).toBe('五十三次');
    expect(title!.vertical).toBe(true);
    expect(name!.text).toBe(DATA.nameKana);
    expect(name!.font).toBe(FONTS.brush);
    expect(pos!.text).toContain(STATIONS[DATA.station - 1]!.nameJa);
    expect(day!.text).toBe(`${DATA.totalDays}${S.dayCount}　令和8年5月20日`);
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.svg).not.toContain('令和');
    expect(c.svg.toLowerCase()).toContain('#3e9b4f');
    // station names are fixed decoration inside the SVG (ends always labelled)
    expect(c.svg).toContain('>品川<');
    expect(c.svg).toContain('>大津<');
    expect(c.svg).toContain(`>${S.edo}<`);
    expect(c.svg).toContain(`>${S.kyoto}<`);
  });

  it('phone: all TextLayers inside the safe zones, for several seeds and a long name', () => {
    for (const seed of [1, 2, 3, 4, 17]) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
      for (const t of c.texts) expect(inSafeZone(t, 'phone')).toBe(true);
    }
    const long = spec.compose(1, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード' }), 'phone');
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
  });

  it('seed re-rolls the hills, the road jitter and the seals, keeping 53 posts', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const roads = (svg: string): string => parse(svg).querySelector('path[stroke="#FFFBF3"]')?.getAttribute('d') ?? '';
    expect(roads(a.svg)).not.toBe(roads(b.svg));
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    for (const c of [a, b]) {
      const doc = parse(c.svg);
      expect(doc.querySelectorAll('circle[stroke="#5E5A52"]').length + seals(doc).length + 1).toBe(53);
    }
  });
});
