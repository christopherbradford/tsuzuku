import { fnv1a32 } from '../../shared/hash';
import { FONTS, inSafeZone, layerBounds } from '../jtext';
import { sampleData } from './data';
import { spec } from './neon-alley';
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

describe('neon-alley', () => {
  it('exports the spec with its catalog id; neon stays clean (no post pass)', () => {
    expect(spec.id).toBe('neon-alley');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('none');
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

  it('signs are the most reviewed Mastered words, the most reviewed one biggest, all in the neon face', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const byReviews = [...DATA.mastered.vocab].sort((a, b) => b.reviews - a.reviews || (a.word < b.word ? -1 : 1));
    const signs = c.texts.filter((t) => t.font === FONTS.neon && !t.text.endsWith(S.alleySuffix));
    expect(signs.length).toBe(13);
    expect(signs.map((t) => t.text)).toEqual(byReviews.slice(0, 13).map((v) => v.word));
    expect(signs[0]!.size).toBeGreaterThan(signs[signs.length - 1]!.size);
    expect(layerBounds(signs[0]!).h).toBeGreaterThan(layerBounds(signs[signs.length - 1]!).h * 0.8);
    // words of two or more glyphs hang vertically
    for (const t of signs) expect(!!t.vertical).toBe(Array.from(t.text).length >= 2);
    // no personal word inside the SVG markup
    for (const t of signs) expect(c.svg).not.toContain(`>${t.text}<`);
  });

  it('names the alley after the learner on the gate beam, in the belt colour frame', () => {
    const c = spec.compose(2, DATA, 'phone');
    const gate = c.texts.find((t) => t.text === `${DATA.nameKana}${S.alleySuffix}`)!;
    expect(gate).toBeDefined();
    expect(gate.anchor).toBe('middle');
    expect(c.svg.toLowerCase()).toContain('#3e9b4f');
    expect(c.svg).not.toContain(DATA.nameKana);
    const long = spec.compose(2, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード・ジュニア' }), 'phone');
    const longGate = long.texts.find((t) => t.text.endsWith(S.alleySuffix))!;
    expect(longGate.size).toBeLessThan(gate.size);
  });

  it('phone: every sign and caption stays inside the safe zones, for several seeds', () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const c = spec.compose(seed, DATA, 'phone');
      expect(c.texts.filter((t) => t.font === FONTS.neon).length).toBe(10);
      expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`)).toEqual([]);
      for (const t of c.texts) expect(inSafeZone(t, 'phone')).toBe(true);
    }
  });

  it('seed moves the vanishing point, swaps walls and re-rolls rain and windows', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const sign = (c: typeof a): { x: number; y: number } => {
      const t = c.texts.find((l) => l.font === FONTS.neon && !l.text.endsWith(S.alleySuffix))!;
      return { x: t.x, y: t.y };
    };
    expect(sign(a)).not.toEqual(sign(b));
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
    for (const c of [a, b]) {
      expect(c.svg).toContain('id="na-glow"');
      expect(c.svg).toContain('id="na-wet"');
      expect(c.svg).toContain('feDisplacementMap');
    }
  });

  it('degrades: no Mastered vocab falls back to kana signs; nothing mastered leaves lit empty walls', () => {
    const kanaOnly = spec.compose(1, sampleData(1, { mastered: { kana: ['あ', 'い', 'う'], kanji: [], vocab: [] } }), 'desktop');
    expect(kanaOnly.texts.filter((t) => t.font === FONTS.neon && !t.text.endsWith(S.alleySuffix)).map((t) => t.text)).toEqual(['あ', 'い', 'う']);
    const nothing = spec.compose(1, sampleData(1, { mastered: { kana: [], kanji: [], vocab: [] } }), 'phone');
    expect(nothing.texts.map((t) => t.text)).toEqual([`${DATA.nameKana}${S.alleySuffix}`, nothing.texts[1]!.text]);
    expect(nothing.texts[1]!.text).toMatch(/^令和/);
    expect(parse(nothing.svg).querySelector('parsererror')).toBeNull();
    expect(safeZoneViolations(nothing, 'phone')).toEqual([]);
  });
});
