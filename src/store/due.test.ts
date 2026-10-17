import { CardFlag } from '../shared/store-types';
import { isDueReview } from './due';
import { card } from './testing';

describe('isDueReview', () => {
  it('needs an arrived due day, a reviewed card (state ≠ 0) and neither the archived nor the kaiden flag', () => {
    expect(isDueReview(card({ due: 10, state: 2 }), 10)).toBe(true);
    expect(isDueReview(card({ due: 9, state: 1 }), 10)).toBe(true);
    expect(isDueReview(card({ due: 11, state: 2 }), 10)).toBe(false);
    expect(isDueReview(card({ due: 10, state: 0 }), 10)).toBe(false);
    expect(isDueReview(card({ due: 10, state: 2, flags: CardFlag.archived }), 10)).toBe(false);
    expect(isDueReview(card({ due: 10, state: 2, flags: CardFlag.kaiden }), 10)).toBe(false);
    expect(isDueReview(card({ due: 10, state: 3, flags: CardFlag.nemesis }), 10)).toBe(true);
  });
});
