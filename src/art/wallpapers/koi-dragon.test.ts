import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { spec } from './koi-dragon';

const DATA = sampleData(1);
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

describe('koi-dragon', () => {
  it('declares its catalog id', () => {
    expect(spec.id).toBe('koi-dragon');
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, right canvas (snapshot)`, () => {
      const a = spec.compose(1, DATA, size);
      const b = spec.compose(1, DATA, size);
      expect(isComposition(a)).toBe(true);
      expect(a.svg).toBe(b.svg);
      expect(a.texts).toEqual(b.texts);
      expect(a.post).toBe('none');
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

  it('seed changes the picture but keeps the fall, pool and pearl', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    for (const c of [a, b]) {
      expect(c.svg).toContain('id="kd-fall"');
      expect(c.svg).toContain('id="kd-pool"');
      expect(c.svg).toContain('id="kd-pearl"');
    }
  });

  it('one koi per 50 mastered kanji (1–8), scales are the learner\'s kanji', () => {
    const fishCount = (svg: string): number => (svg.match(/class="koi/g) ?? []).length;
    const few = spec.compose(1, { ...DATA, mastered: { ...DATA.mastered, kanji: ['日', '本'] } }, 'desktop');
    const many = spec.compose(1, { ...DATA, mastered: { ...DATA.mastered, kanji: Array.from({ length: 400 }, (_, i) => String.fromCodePoint(0x4e00 + i)) } }, 'desktop');
    const huge = spec.compose(1, { ...DATA, mastered: { ...DATA.mastered, kanji: Array.from({ length: 2000 }, () => '字') } }, 'desktop');
    expect(fishCount(few.svg)).toBe(1);
    expect(fishCount(many.svg)).toBe(8);
    expect(fishCount(huge.svg)).toBe(8);
    expect(many.svg.match(/class="koi dragon"/g)?.length).toBe(1);
    expect(few.svg).toContain('>日<');
    expect(few.svg).toContain('>本<');
    expect(parse(huge.svg).querySelectorAll('*').length).toBeLessThan(4000);
    expect(few.texts.some((t) => t.text === '2字')).toBe(true);
  });

  it('personal text: caption, name, era date, chosen kanji on the pearl', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(c.texts.some((t) => t.text === '登竜門' && t.vertical)).toBe(true);
    expect(c.texts.some((t) => t.text === DATA.nameKana && t.vertical)).toBe(true);
    expect(c.texts.some((t) => /年\d+月\d+日/.test(t.text))).toBe(true);
    expect(c.texts.some((t) => t.text === DATA.chosenKanji)).toBe(true);
  });

  it('degrades on an empty save: no kanji → ring scales, no pearl kanji, still one koi', () => {
    const c = spec.compose(9, normalizeData({}), 'phone');
    expect(isComposition(c)).toBe(true);
    expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(c.texts.some((t) => t.text === '0字')).toBe(true);
    expect(c.texts.filter((t) => t.font.includes('Yuji') && !t.vertical)).toEqual([]);
    parse(c.svg);
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
  });
});
