import { NIHONBASHI, SANJO_OHASHI, STATIONS } from '../../content/types';
import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { neighbours, spec } from './station-sign';
import { S } from './strings-4';

const DATA = sampleData(1);

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

describe('station-sign', () => {
  it('exports the spec for its catalog id without a post pass', () => {
    expect(spec.id).toBe('station-sign');
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
      expect(doc.querySelector('svg > title')?.textContent).toBe('Station Sign');
      // the plate and its kon band, catenary wires between the masts
      expect(doc.querySelector('path[fill="url(#ss-plate)"]')).not.toBeNull();
      expect(doc.querySelectorAll('polyline[stroke="#1A1A1F"]').length).toBeGreaterThanOrEqual(6);
      expect(fingerprint(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for many seeds', () => {
    for (let seed = 1; seed <= 8; seed++) {
      expect(safeZoneViolations(spec.compose(seed, DATA, 'phone'), 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
    }
  });

  it('seed changes the sky, hill and masts but not the sign', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(a.texts).toEqual(b.texts);
  });

  it('neighbours: previous / current / next along the Tōkaidō, with Nihonbashi and Sanjō Ōhashi at the ends', () => {
    expect(neighbours(17)).toEqual({ prev: STATIONS[15]!.nameJa, cur: STATIONS[16]!.nameJa, next: STATIONS[17]!.nameJa });
    expect(neighbours(1)).toEqual({ prev: NIHONBASHI.nameJa, cur: '品川', next: '川崎' });
    expect(neighbours(0).prev).toBe(NIHONBASHI.nameJa);
    expect(neighbours(53)).toEqual({ prev: '草津', cur: '大津', next: SANJO_OHASHI.nameJa });
    expect(neighbours(99).next).toBe(SANJO_OHASHI.nameJa);
  });

  it('the plate names the learner in katakana, shows the station number and the neighbouring stations in the band', () => {
    const c = spec.compose(1, { ...DATA, nameKana: 'はな', station: 10 }, 'desktop');
    const name = c.texts[0]!;
    expect(name.text).toBe('ハナ');
    expect(name.weight).toBe(700);
    expect(c.texts.some((t) => t.text === `箱根${S.stationSign.eki}`)).toBe(true);
    expect(c.texts.some((t) => t.text === '10' && t.lang === 'en')).toBe(true);
    const prev = c.texts.find((t) => t.text === '小田原');
    const next = c.texts.find((t) => t.text === '三島');
    expect(prev?.anchor).toBe('start');
    expect(next?.anchor).toBe('end');
    expect(prev!.x).toBeLessThan(next!.x);
    // the stripe takes the belt colour
    expect(c.svg).toContain(`fill="#3E9B4F"`);
    expect(spec.compose(1, { ...DATA, belt: 'purple' }, 'desktop').svg).toContain(`fill="#7A3FB5"`);
  });

  it('long names shrink to fit the plate; empty data still composes', () => {
    const long = spec.compose(1, { ...DATA, nameKana: 'クリストファー・ブラッドフォード' }, 'phone');
    const short = spec.compose(1, DATA, 'phone');
    expect(long.texts[0]!.size).toBeLessThan(short.texts[0]!.size);
    expect(safeZoneViolations(long, 'phone')).toEqual([]);
    const empty = spec.compose(1, normalizeData({}), 'phone');
    expect(isComposition(empty)).toBe(true);
    expect(empty.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(empty.texts[0]!.text).toBe('無名');
    expect(safeZoneViolations(empty, 'phone')).toEqual([]);
    parse(empty.svg);
  });
});
