import { fnv1a32 } from '../../shared/hash';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-4';
import { spec } from './waveform';

const DATA = sampleData(1);

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}
const fingerprint = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

describe('waveform', () => {
  it('exports the spec for its catalog id with a scanlines post pass', () => {
    expect(spec.id).toBe('waveform');
    expect(spec.compose(1, DATA, 'desktop').post).toBe('scanlines');
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
      expect(doc.querySelector('svg > title')?.textContent).toBe('Waveform');
      // two polylines: afterglow and the beam, both on the glow/blur filters
      expect(doc.querySelectorAll('polyline').length).toBe(2);
      expect(fingerprint(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for many seeds and long sentences', () => {
    const long = { ...DATA, dictatedSentence: '昨日の夜、友達と一緒に新しいレストランで晩ご飯を食べてから、駅まで歩いて帰りました。' };
    for (let seed = 1; seed <= 6; seed++) {
      expect(safeZoneViolations(spec.compose(seed, DATA, 'phone'), 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
      expect(safeZoneViolations(spec.compose(seed, long, 'phone'), 'phone').map((t) => `${t.text}@${t.y}`)).toEqual([]);
    }
  });

  it('seed changes the trace but not the sentence', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(a.texts.map((t) => t.text)).toEqual(b.texts.map((t) => t.text));
  });

  it('the trace is synthesised from the sentence: different sentences, different signal; mora ticks follow the count', () => {
    const a = spec.compose(1, { ...DATA, dictatedSentence: 'ありがとう。' }, 'desktop');
    const b = spec.compose(1, { ...DATA, dictatedSentence: 'きっと、いつか、わかります。' }, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    const ticks = (svg: string): number => parse(svg).querySelectorAll('g[shape-rendering] rect').length;
    // ありがとう = 5 morae → 5 ticks; きっと・いつか・わかります = 11 morae + 2 pauses
    expect(ticks(a.svg)).toBe(5);
    expect(ticks(b.svg)).toBe(13);
  });

  it('sets the sentence in the pixel font, splits long ones into lines and adds the readouts', () => {
    const c = spec.compose(1, DATA, 'phone');
    const sentence = DATA.dictatedSentence!;
    const joined = c.texts
      .filter((t) => t.fill === '#2EE6D6' && t.anchor === 'middle')
      .map((t) => t.text)
      .join('');
    expect(joined).toBe(sentence);
    expect(c.texts.every((t) => t.font.includes('DotGothic16'))).toBe(true);
    expect(c.texts.some((t) => t.text === S.waveform.channel)).toBe(true);
    expect(c.texts.some((t) => t.text === S.waveform.perfect)).toBe(true);
    expect(c.texts.some((t) => t.text.includes(DATA.nameKana))).toBe(true);
  });

  it('falls back to the sentence of choice, then to an honest "no signal" trace', () => {
    const choice = spec.compose(1, { ...DATA, dictatedSentence: undefined }, 'desktop');
    expect(choice.texts.some((t) => t.text === DATA.sentenceOfChoice)).toBe(true);
    const none = spec.compose(1, normalizeData({}), 'desktop');
    expect(none.texts.some((t) => t.text === S.waveform.noSignal)).toBe(true);
    expect(none.texts.some((t) => t.text === S.waveform.perfect)).toBe(false);
    expect(none.svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(parse(none.svg).querySelector('path[fill="url(#wf-env)"]')).toBeNull();
    expect(safeZoneViolations(spec.compose(1, normalizeData({}), 'phone'), 'phone')).toEqual([]);
  });
});
