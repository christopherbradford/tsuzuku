import { fnv1a32 } from '../../shared/hash';
import { PHOSPHOR } from '../color';
import { normalizeData, sampleData } from './data';
import { arcadeNumber, phosphorFor, spec } from './okaeri';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-2';

const DATA = sampleData(1);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

describe('okaeri', () => {
  it('exports the spec under its catalog id', () => {
    expect(spec.id).toBe('okaeri');
    expect(spec.living).toBeUndefined();
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, reasonable node count (snapshot)`, () => {
      const a = spec.compose(1, DATA, size);
      const b = spec.compose(1, DATA, size);
      expect(isComposition(a)).toBe(true);
      expect(a.svg).toBe(b.svg);
      expect(a.texts).toEqual(b.texts);
      expect(a.post).toBe('scanlines');
      expect(hasCanvasSize(a, size)).toBe(true);
      expect(isSelfContained(a.svg)).toBe(true);
      expect(usesReservedIds(a.svg)).toBe(false);
      expect(a.svg).not.toMatch(/NaN|Infinity|undefined/);
      const doc = parse(a.svg);
      expect(doc.querySelectorAll('*').length).toBeLessThan(4000);
      expect(doc.querySelector('clipPath#screen')).not.toBeNull();
      expect(doc.querySelector('filter#chroma')).not.toBeNull();
      expect(fp(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones', () => {
    const c = spec.compose(1, DATA, 'phone');
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
    expect(c.texts.length).toBe(3 + 5 * 3);
  });

  it('attract screen: おかえり, the sub-caption, a hi-score table with 1ST = name + XP and 2ND = total days, all in the pixel font', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const t = c.texts;
    expect(t[0]!.text).toBe(S.okaeri);
    expect(t[1]!.text).toBe(S.okaeriSub);
    expect(t[2]!.text).toBe(S.hiScore);
    const row = (i: number): string[] => t.slice(3 + i * 3, 6 + i * 3).map((l) => l.text);
    expect(row(0)).toEqual([S.ranks[0], DATA.nameKana, arcadeNumber(DATA.xp)]);
    expect(row(1)).toEqual([S.ranks[1], S.rowDays, String(DATA.totalDays)]);
    expect(row(2)[1]).toBe(S.rowStreak);
    expect(row(3)[1]).toBe(S.rowLevel);
    expect(row(4)[1]).toBe(S.rowStation);
    expect(t.every((l) => l.font.includes('DotGothic16'))).toBe(true);
    // rows share a baseline per row and the score column is right-aligned
    expect(t[3]!.y).toBe(t[5]!.y);
    expect(t[5]!.anchor).toBe('end');
    expect(c.svg).not.toContain(DATA.nameKana);
  });

  it('never shows a countdown digit or coin prompt (design 06 §3)', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const all = c.texts.map((l) => l.text).join(' ');
    expect(all).not.toMatch(/insert|coin|continue\?|credit/i);
    // a countdown would be a lone, title-sized number; every number here is a table score at row size
    expect(c.texts.filter((l) => /^\d+$/.test(l.text) && l.size > 60)).toEqual([]);
    expect(c.svg).not.toMatch(/insert|coin/i);
  });

  it('phosphor is amber or green by seed and both occur', () => {
    const names = new Set<string>();
    for (let s = 1; s <= 40; s++) names.add(phosphorFor(s).name);
    expect(names).toEqual(new Set(['amber', 'green']));
    expect(Object.values(PHOSPHOR)).toContain(phosphorFor(1).hue);
    const amber = [...Array(40).keys()].find((s) => phosphorFor(s).name === 'amber')!;
    const green = [...Array(40).keys()].find((s) => phosphorFor(s).name === 'green')!;
    expect(spec.compose(amber, DATA, 'desktop').svg).toContain(PHOSPHOR.amber);
    expect(spec.compose(green, DATA, 'desktop').svg).toContain(PHOSPHOR.green);
  });

  it('arcadeNumber groups thousands deterministically', () => {
    expect(arcadeNumber(0)).toBe('0');
    expect(arcadeNumber(999)).toBe('999');
    expect(arcadeNumber(1000)).toBe('1,000');
    expect(arcadeNumber(81247.9)).toBe('81,247');
    expect(arcadeNumber(-5)).toBe('0');
  });

  it('different seeds differ; empty data degrades gracefully', () => {
    expect(spec.compose(1, DATA, 'desktop').svg).not.toBe(spec.compose(2, DATA, 'desktop').svg);
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(5, empty, size);
      expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(c.svg);
      expect(safeZoneViolations(c, size)).toEqual([]);
      expect(c.texts[3 + 1]!.text).toBe(empty.nameKana);
    }
    const longName = spec.compose(1, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード' }), 'phone');
    expect(safeZoneViolations(longName, 'phone')).toEqual([]);
    const name = longName.texts[4]!;
    expect(name.size).toBeLessThan(longName.texts[3]!.size);
  });
});
