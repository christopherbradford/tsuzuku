import { toPlain } from '@/content/ruby';
import { alignedRange, spanReading, splitAtPlainRange } from './ruby-split';

const SENTENCE = '{犬|いぬ}が{水|みず}を{飲|の}みます。'; // plain: 犬が水を飲みます。
const FUTURE = '{未来|みらい}は{明|あか}るい。'; // plain: 未来は明るい。

describe('splitAtPlainRange', () => {
  it('cuts at plain offsets and keeps ruby markup on each side (the former splitRuby cases)', () => {
    expect(splitAtPlainRange(SENTENCE, 4, 8)).toEqual({ pieces: ['{犬|いぬ}が{水|みず}を', '{飲|の}みます', '。'], reading: 'のみます' });
    expect(splitAtPlainRange(SENTENCE, 0, 1)).toEqual({ pieces: ['', '{犬|いぬ}', 'が{水|みず}を{飲|の}みます。'], reading: 'いぬ' });
    expect(splitAtPlainRange(SENTENCE, 50, 60)).toEqual({ pieces: [SENTENCE, '', ''], reading: null });
    expect(splitAtPlainRange('ケンはパンを{食|た}べます。', 6, 7)).toEqual({ pieces: ['ケンはパンを', '{食|た}', 'べます。'], reading: 'た' });
  });

  it('a range inside a ruby base leaves bare kanji on each side, never a duplicate, and returns the group reading as the clue', () => {
    const r = splitAtPlainRange(FUTURE, 0, 1);
    expect(r.pieces).toEqual(['', '未', '来は{明|あか}るい。']);
    expect(r.reading).toBe('みらい');
    expect(r.pieces.map(toPlain).join('')).toBe('未来は明るい。');
    const second = splitAtPlainRange(FUTURE, 1, 2);
    expect(second.pieces).toEqual(['未', '来', 'は{明|あか}るい。']);
    expect(second.reading).toBe('みらい');
  });

  it('a range ending or starting mid-group splits only that group; whole groups elsewhere keep their ruby', () => {
    const r = splitAtPlainRange(FUTURE, 1, 4); // 来は明 — starts mid 未来, ends inside 明 (whole)
    expect(r.pieces).toEqual(['未', '来は{明|あか}', 'るい。']);
    expect(r.reading).toBe('みらいはあか');
    const s = splitAtPlainRange('{東京|とうきょう}{駅|えき}', 0, 3); // 東京 whole + 駅 whole
    expect(s.pieces).toEqual(['', '{東京|とうきょう}{駅|えき}', '']);
    expect(s.reading).toBe('とうきょうえき');
    const t = splitAtPlainRange('{東京|とうきょう}{駅|えき}', 1, 3); // 京 bare + 駅 whole
    expect(t.pieces).toEqual(['東', '京{駅|えき}', '']);
    expect(t.reading).toBe('とうきょうえき');
  });

  it('plain text without ruby and reversed or out-of-range offsets are clamped', () => {
    expect(splitAtPlainRange('ねこがいる。', 0, 2)).toEqual({ pieces: ['', 'ねこ', 'がいる。'], reading: 'ねこ' });
    expect(splitAtPlainRange('ねこがいる。', 4, 2)).toEqual({ pieces: ['ねこがい', '', 'る。'], reading: null });
    expect(splitAtPlainRange('ねこがいる。', -3, 99)).toEqual({ pieces: ['', 'ねこがいる。', ''], reading: 'ねこがいる。' });
    expect(splitAtPlainRange('', 0, 1)).toEqual({ pieces: ['', '', ''], reading: null });
  });
});

describe('spanReading / alignedRange', () => {
  const JA = '{日本|にほん}の{日|ひ}は{日曜日|にちようび}です。'; // plain: 日本の日は日曜日です。
  it('spanReading reads a span by its ruby, plain text as is, and is null when a group is cut', () => {
    expect(spanReading(JA, 3, 4)).toBe('ひ');
    expect(spanReading(JA, 0, 2)).toBe('にほん');
    expect(spanReading(JA, 2, 5)).toBe('のひは');
    expect(spanReading(JA, 0, 1)).toBeNull();
    expect(spanReading(JA, 7, 8)).toBeNull();
    expect(spanReading(SENTENCE, 4, 8)).toBe('のみます');
    expect(spanReading(FUTURE, 1, 3)).toBeNull();
  });
  it('alignedRange skips occurrences inside a ruby group and ones that read differently', () => {
    expect(alignedRange(JA, '日', 'ひ')).toEqual([3, 4]);
    expect(alignedRange(JA, '日')).toEqual([3, 4]);
    expect(alignedRange(JA, '日', 'にち')).toBeNull();
    expect(alignedRange(JA, '日曜日', 'にちようび')).toEqual([5, 8]);
    expect(alignedRange(JA, '日本', 'ニホン')).toEqual([0, 2]);
    expect(alignedRange(JA, '月')).toBeNull();
    expect(alignedRange(JA, '')).toBeNull();
    expect(alignedRange(SENTENCE, '飲みます', 'のみます')).toEqual([4, 8]);
  });
});
