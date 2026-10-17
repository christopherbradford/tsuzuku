import { S } from './strings';

describe('shell page copy (design 01 §3)', () => {
  it('the kana-check hint matches the plain input: no live conversion is promised', () => {
    expect(S.onbKanaPromptHint).not.toMatch(/as you type/);
    expect(S.onbKanaPromptHint).toBe('Type romaji or kana. Enter checks it.');
  });

  it('no zero-based slot numbers or spec jargon reach the learner', () => {
    const values = Object.values(S as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
    for (const v of values) {
      expect(v).not.toMatch(/slot 0/i);
      expect(v).not.toMatch(/content pack/i);
    }
  });
});
