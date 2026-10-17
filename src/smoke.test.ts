import { toHiragana } from 'wanakana';

describe('toolchain smoke', () => {
  it('wanakana converts romaji to hiragana (IME convention: du -> づ, zu -> ず)', () => {
    expect(toHiragana('tsuduku')).toBe('つづく');
    expect(toHiragana('tsuzuku')).toBe('つずく');
  });
});
