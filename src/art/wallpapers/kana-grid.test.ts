import { fnv1a32 } from '../../shared/hash';
import { FONTS, inSafeZone } from '../jtext';
import { sampleData } from './data';
import { spec } from './kana-grid';
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

const ALL_KANA = Array.from(S.gojuonRows.join('')).filter((k) => k !== '　');

describe('kana-grid', () => {
  it('exports the spec with its catalog id and asks for scanlines', () => {
    expect(spec.id).toBe('kana-grid');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('scanlines');
    expect(ALL_KANA.length).toBe(46);
    expect(new Set(ALL_KANA).size).toBe(46);
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
      expect(fingerprint(a.svg)).toMatchSnapshot();
    });
  }

  it('draws all 46 kana as tiles (fixed decoration inside the SVG) plus the four empty slots', () => {
    const doc = parse(spec.compose(1, DATA, 'desktop').svg);
    const glyphs = Array.from(doc.querySelectorAll('text')).map((t) => t.textContent ?? '');
    for (const k of ALL_KANA) expect(glyphs.filter((g) => g === k).length, k).toBeGreaterThanOrEqual(1);
    // 50 tile rects: 46 framed + 4 empty
    const tiles = Array.from(doc.querySelectorAll('rect[rx="6"]'));
    expect(tiles.length).toBe(50);
    expect(doc.querySelector('filter#kg-glow')).not.toBeNull();
  });

  it('puts the 1P cursor on the slowest kana and reads the heat from gojuonMs', () => {
    const data = sampleData(1, { gojuonMs: { あ: 400, か: 900, ぬ: 1500, を: 600 } });
    const c = spec.compose(1, data, 'desktop');
    const texts = c.texts.map((t) => t.text);
    expect(texts).toContain(`${S.slowest} ぬ 1500${S.msUnit}`);
    expect(texts).toContain(`${S.fastest} あ 400${S.msUnit}`);
    const doc = parse(c.svg);
    // the big faint glyph behind the grid is the slowest kana
    const big = Array.from(doc.querySelectorAll('text')).find((t) => Number(t.getAttribute('font-size')) > 500);
    expect(big?.textContent).toBe('ぬ');
    // the selected tile is filled with the hot colour; untimed tiles are hai
    const fills = Array.from(doc.querySelectorAll('rect[rx="6"]')).map((r) => r.getAttribute('fill') ?? '');
    expect(fills.some((f) => f.toLowerCase() === '#ff3da6')).toBe(true);
    expect(fills.some((f) => f.startsWith('rgba(110,106,97'))).toBe(true);
  });

  it('without any reaction times: cursor on あ and a plain-language note instead of readouts', () => {
    const c = spec.compose(2, sampleData(1, { gojuonMs: {} }), 'phone');
    const texts = c.texts.map((t) => t.text);
    expect(texts).toContain(S.noTimes);
    expect(texts.some((t) => t.startsWith(S.slowest))).toBe(false);
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
    const big = Array.from(parse(c.svg).querySelectorAll('text')).find((t) => Number(t.getAttribute('font-size')) > 500);
    expect(big?.textContent).toBe('あ');
  });

  it('header carries the name and XP as pixel-font TextLayers; the name never leaks into the SVG', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const name = c.texts.find((t) => t.text === `${S.player1} ${DATA.nameKana}`)!;
    expect(name.font).toBe(FONTS.pixel);
    expect(c.texts.find((t) => t.text === `${S.xpLabel} ${String(DATA.xp).padStart(8, '0')}`)?.anchor).toBe('end');
    expect(c.svg).not.toContain(DATA.nameKana);
    const long = spec.compose(1, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード・ジュニア' }), 'desktop');
    const longName = long.texts.find((t) => t.text.includes('クリス'))!;
    expect(longName.size).toBeLessThan(name.size);
  });

  it('phone: the chart is transposed (5 × 10) and every TextLayer stays inside the safe zones', () => {
    for (const seed of [1, 2, 3, 9]) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
      for (const t of c.texts) expect(inSafeZone(t, 'phone')).toBe(true);
    }
    const doc = parse(spec.compose(1, DATA, 'phone').svg);
    const xs = new Set(Array.from(doc.querySelectorAll('rect[rx="6"]')).map((r) => r.getAttribute('x')));
    const ys = new Set(Array.from(doc.querySelectorAll('rect[rx="6"]')).map((r) => r.getAttribute('y')));
    expect(xs.size).toBe(5);
    expect(ys.size).toBe(10);
    const desk = parse(spec.compose(1, DATA, 'desktop').svg);
    expect(new Set(Array.from(desk.querySelectorAll('rect[rx="6"]')).map((r) => r.getAttribute('x'))).size).toBe(10);
  });

  it('seed changes the backdrop but not the chart', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const tiles = (svg: string): string[] => Array.from(parse(svg).querySelectorAll('rect[rx="6"]')).map((r) => `${r.getAttribute('x')},${r.getAttribute('y')},${r.getAttribute('fill')}`);
    expect(tiles(a.svg)).toEqual(tiles(b.svg));
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
  });
});
