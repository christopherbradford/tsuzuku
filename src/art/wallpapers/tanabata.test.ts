import { fnv1a32 } from '../../shared/hash';
import { TANZAKU } from '../color';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES, type Composition, type TextLayer } from './spec';
import { S } from './strings-2';
import { MAX_STRIPS, MIN_STRIPS, spec } from './tanabata';

const DATA = sampleData(1);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;
const SENTENCES = [
  '毎朝、駅まで歩きます。', '雨の日は本を読むのが好きです。', '友達と新しいレストランに行きました。', '日本語の勉強は毎日続けています。', '週末に山へ行こうと思っています。', '先生の話を聞いてから質問しました。',
  '今日はとても暑いですね。', '来年、京都に行きたいです。', '母は毎日料理を作ってくれます。', '電車が遅れたので、遅刻しました。', 'この本はもう読んだことがあります。', '静かな場所で勉強するのが好きです。',
  '犬を飼いたいと思っています。', '週に三回、ジムに通っています。', '冬になると、雪がたくさん降ります。', '日本の映画をよく見ます。', '新しい言葉を覚えるのは楽しいです。', '駅の前で友達を待っています。',
  '海が見えるホテルに泊まりました。', '毎晩、日記を書くようにしています。', '寿司より天ぷらのほうが好きです。', '漢字を書く練習をしています。', '花火大会はとてもきれいでした。', '明日は早く起きなければなりません。',
  '二十五番目の文は使われません。',
];

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

const stripCount = (svg: string): number => parse(svg).querySelectorAll('g.tanzaku').length;
const sentenceLayers = (c: Composition): TextLayer[] => c.texts.filter((t) => t.vertical && typeof t.rotate === 'number');

describe('tanabata', () => {
  it('exports the spec under its catalog id and is a living piece', () => {
    expect(spec.id).toBe('tanabata');
    expect(spec.living).toBe(true);
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, reasonable node count (snapshot)`, () => {
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
      expect(doc.querySelector('mask#bandMask')).not.toBeNull();
      expect(doc.querySelector('filter#mw feTurbulence')).not.toBeNull();
      expect(fp(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones, even with 24 sentences', () => {
    expect(safeZoneViolations(spec.compose(1, DATA, 'phone'), 'phone')).toEqual([]);
    const full = spec.compose(2, sampleData(1, { writingSentences: SENTENCES }), 'phone');
    expect(safeZoneViolations(full, 'phone')).toEqual([]);
    expect(sentenceLayers(full).length).toBe(MAX_STRIPS);
  });

  it('one tanzaku per Writing Dojo sentence (up to 24), blank strips keep the minimum of five', () => {
    const six = spec.compose(1, DATA, 'desktop');
    expect(DATA.writingSentences.length).toBe(6);
    expect(stripCount(six.svg)).toBe(6);
    expect(sentenceLayers(six).length).toBe(6);
    const two = spec.compose(1, sampleData(1, { writingSentences: SENTENCES.slice(0, 2) }), 'desktop');
    expect(stripCount(two.svg)).toBe(MIN_STRIPS);
    expect(sentenceLayers(two).length).toBe(2);
    const many = spec.compose(1, sampleData(1, { writingSentences: SENTENCES }), 'desktop');
    expect(stripCount(many.svg)).toBe(MAX_STRIPS);
    expect(sentenceLayers(many).map((t) => t.text)).not.toContain(SENTENCES[24]);
  });

  it('sentences are vertical mincho layers tilted with their strip, readable on each strip colour, truncated when too long', () => {
    const c = spec.compose(1, DATA, 'desktop');
    for (const t of sentenceLayers(c)) {
      expect(t.font.includes('Shippori Mincho')).toBe(true);
      expect(Math.abs(t.rotate!)).toBeLessThanOrEqual(13);
      expect(['#1A1A1F', '#F4EDE0']).toContain(t.fill);
    }
    for (const colour of TANZAKU) expect(spec.compose(1, sampleData(1, { writingSentences: SENTENCES.slice(0, 5) }), 'desktop').svg).toContain(colour);
    const longSentence = '昨日は友達と一緒に新しくできた駅前のレストランで晩ご飯を食べてから、夜遅くまで日本語の勉強をしました。';
    const long = spec.compose(1, sampleData(1, { writingSentences: [longSentence] }), 'desktop');
    const layer = sentenceLayers(long)[0]!;
    expect(layer.text.endsWith('…')).toBe(true);
    expect(layer.text.length).toBeLessThan(longSentence.length);
    expect(c.svg).not.toContain(DATA.writingSentences[0]!);
    expect(c.svg).not.toContain(DATA.nameKana);
  });

  it('captions: name, date and the 七夕 title', () => {
    const c = spec.compose(1, DATA, 'desktop');
    const plain = c.texts.filter((t) => !sentenceLayers(c).includes(t)).map((t) => t.text);
    expect(plain).toContain(DATA.nameKana);
    expect(plain).toContain(S.tanabataTitle);
    expect(plain.some((t) => /年.*月.*日/.test(t))).toBe(true);
  });

  it('different seeds differ; empty data degrades gracefully', () => {
    expect(spec.compose(1, DATA, 'desktop').svg).not.toBe(spec.compose(2, DATA, 'desktop').svg);
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(5, empty, size);
      expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(c.svg);
      expect(safeZoneViolations(c, size)).toEqual([]);
      expect(stripCount(c.svg)).toBe(MIN_STRIPS);
      expect(sentenceLayers(c).length).toBe(0);
    }
  });
});
