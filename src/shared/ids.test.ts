import { FACETS } from '../content/types';
import {
  cardKey,
  contentKindOf,
  facetOfKey,
  isCardKey,
  isFacet,
  isValidId,
  itemOfKey,
  kindOfId,
  levelOfId,
  parseCardKey,
  stationId,
  stationOfId,
  tryKindOfId,
  type IdKind,
} from './ids';

const EXAMPLES: [id: string, kind: IdKind][] = [
  ['k-h-a', 'kana'],
  ['k-k-shi', 'kana'],
  ['k-h-kya', 'kana'],
  ['k-k-thi', 'kana'],
  ['v-n5-0001', 'vocab'],
  ['v-n1-9999', 'vocab'],
  ['j-食', 'kanji'],
  ['j-々', 'kanji'],
  ['g-n5-001', 'grammar'],
  ['g-n3-031', 'grammar'],
  ['c-person', 'component'],
  ['c-rice-field', 'component'],
  ['s-07-1', 'story'],
  ['s-53-2', 'story'],
  ['m-07-1', 'michikusa'],
  ['m-25-4', 'michikusa'],
  ['cj-0001', 'conjugation'],
  ['st-07', 'station'],
  ['st-00', 'station'],
];

describe('cardKey / parseCardKey', () => {
  it('roundtrips every id pattern × every facet', () => {
    for (const [id] of EXAMPLES) {
      for (const facet of FACETS) {
        const k = cardKey(id, facet);
        expect(k).toBe(`${id}#${facet}`);
        expect(parseCardKey(k)).toEqual({ itemId: id, facet });
        expect(itemOfKey(k)).toBe(id);
        expect(facetOfKey(k)).toBe(facet);
        expect(isCardKey(k)).toBe(true);
      }
    }
  });
  it('rejects malformed keys', () => {
    expect(() => parseCardKey('v-n5-0001')).toThrow(RangeError);
    expect(() => parseCardKey('v-n5-0001#nope')).toThrow(RangeError);
    expect(() => parseCardKey('#prod')).toThrow(RangeError);
    expect(isCardKey('v-n5-0001')).toBe(false);
    expect(isCardKey('v-n5-0001#nope')).toBe(false);
    expect(isCardKey('a#b#prod')).toBe(false);
    expect(isFacet('prod')).toBe(true);
    expect(isFacet('write')).toBe(false);
  });
});

describe('kindOfId', () => {
  it('classifies every prefix', () => {
    for (const [id, kind] of EXAMPLES) {
      expect(kindOfId(id)).toBe(kind);
      expect(tryKindOfId(id)).toBe(kind);
    }
  });
  it('a chunk (set-phrase vocab) is reported as vocab — the item decides', () => {
    expect(kindOfId('v-n5-0300')).toBe('vocab');
    expect(contentKindOf('chunk')).toBe('vocab');
    expect(contentKindOf('kanji')).toBe('kanji');
  });
  it('throws on an unknown prefix; tryKindOfId returns undefined', () => {
    expect(() => kindOfId('x-001')).toThrow(RangeError);
    expect(() => kindOfId('')).toThrow(RangeError);
    expect(tryKindOfId('x-001')).toBeUndefined();
    expect(tryKindOfId('v:n5:0001')).toBeUndefined();
  });
});

describe('stationOfId / stationId', () => {
  it('reads the station from story, michikusa and station ids only', () => {
    expect(stationOfId('s-07-1')).toBe(7);
    expect(stationOfId('m-25-4')).toBe(25);
    expect(stationOfId('st-07')).toBe(7);
    expect(stationOfId('st-00')).toBe(0);
    expect(stationOfId('s-53-2')).toBe(53);
    expect(stationOfId('v-n5-0001')).toBeUndefined();
    expect(stationOfId('j-食')).toBeUndefined();
    expect(stationOfId('c-person')).toBeUndefined();
    expect(stationOfId('s-7-1')).toBeUndefined();
  });
  it('stationId pads to two digits', () => {
    expect(stationId(7)).toBe('st-07');
    expect(stationId(53)).toBe('st-53');
    expect(stationId(0)).toBe('st-00');
    expect(stationOfId(stationId(42))).toBe(42);
  });
});

describe('isValidId / levelOfId', () => {
  it('validates against ID_PATTERNS', () => {
    for (const [id] of EXAMPLES) expect(isValidId(id)).toBe(true);
    expect(isValidId('v-n5-001')).toBe(false);
    expect(isValidId('v-n6-0001')).toBe(false);
    expect(isValidId('s-54-1')).toBe(false);
    expect(isValidId('m-07-5')).toBe(false);
    expect(isValidId('c-Person')).toBe(false);
    expect(isValidId('k-h-kyaa1')).toBe(false);
    expect(isValidId('j-か')).toBe(false);
    expect(isValidId('v-n5-0001', 'kanji')).toBe(false);
    expect(isValidId('nope')).toBe(false);
  });
  it('reads the level from vocab/grammar/kana ids', () => {
    expect(levelOfId('v-n5-0001')).toBe('n5');
    expect(levelOfId('g-n2-010')).toBe('n2');
    expect(levelOfId('k-h-a')).toBe('kana');
    expect(levelOfId('j-食')).toBeUndefined();
    expect(levelOfId('s-07-1')).toBeUndefined();
  });
});
