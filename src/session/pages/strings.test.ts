/**
 * strings.ts — aria-label strings carry the English half only (design 01 §7): an attribute has no `lang`, so Japanese in it is read as noise.
 */
import { describe, expect, it } from 'vitest';
import { S } from './strings';

const JAPANESE = /[぀-ヿ㐀-鿿]/;

describe('session page strings', () => {
  it('every *Aria key is English only', () => {
    const keys = Object.keys(S).filter((k) => k.endsWith('Aria'));
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) {
      const v = (S as Record<string, unknown>)[k];
      expect(typeof v, k).toBe('string');
      expect(v as string, k).not.toMatch(JAPANESE);
    }
  });
});
