import type { Facet } from '../content/types';
import type { CardTuple, ItemBelt, ItemKind } from '../shared/store-types';
import { BELT_ORDER, baseFacet, beltAtLeast, beltPromotion, beltRank, itemBelt, productionFacet } from './item-belt';

const card = (s: number, flags = 0): CardTuple => [100, s, 5, 3, 0, 2, 90, flags];

describe('base and production facets (design 02 §4)', () => {
  const table: [ItemKind, Facet, Facet | null][] = [
    ['vocab', 'rec', 'prod'],
    ['chunk', 'prod', 'prod'],
    ['kana', 'rec', 'prod'],
    ['component', 'rec', null],
    ['kanji', 'comp', 'read'],
    ['grammar', 'cloze', 'prod'],
  ];
  it.each(table)('%s → base %s, production %s', (kind, base, prod) => {
    expect(baseFacet(kind)).toBe(base);
    expect(productionFacet(kind)).toBe(prod);
  });
  it('orders the belts', () => {
    expect(BELT_ORDER).toEqual(['white', 'yellow', 'green', 'brown', 'black']);
    expect(beltRank('black')).toBe(4);
    expect(beltAtLeast('green', 'yellow')).toBe(true);
    expect(beltAtLeast('yellow', 'green')).toBe(false);
  });
});

describe('itemBelt', () => {
  it('vocab ladder', () => {
    expect(itemBelt('vocab', {})).toBe('white');
    expect(itemBelt('vocab', { rec: card(0.5) })).toBe('white');
    expect(itemBelt('vocab', { rec: card(1) })).toBe('yellow');
    expect(itemBelt('vocab', { rec: card(6.99) })).toBe('yellow');
    expect(itemBelt('vocab', { rec: card(7) })).toBe('green');
    expect(itemBelt('vocab', { rec: card(30) })).toBe('green');
    expect(itemBelt('vocab', { rec: card(30), prod: card(6.9) })).toBe('green');
    expect(itemBelt('vocab', { rec: card(29.9), prod: card(7) })).toBe('green');
    expect(itemBelt('vocab', { rec: card(30), prod: card(7) })).toBe('brown');
    expect(itemBelt('vocab', { rec: card(120), prod: card(120), listen: card(119) })).toBe('brown');
    expect(itemBelt('vocab', { rec: card(120), prod: card(120), listen: card(120) })).toBe('black');
    expect(itemBelt('vocab', { rec: card(120), prod: card(120), listen: card(120), pitch: card(200) })).toBe('black');
  });
  it('kanji: base comp, production read', () => {
    expect(itemBelt('kanji', { comp: card(7) })).toBe('green');
    expect(itemBelt('kanji', { comp: card(30), read: card(7) })).toBe('brown');
    expect(itemBelt('kanji', { comp: card(30), read: card(6) })).toBe('green');
    expect(itemBelt('kanji', { comp: card(120), read: card(120) })).toBe('black');
    expect(itemBelt('kanji', { read: card(100) })).toBe('white');
  });
  it('grammar: base cloze, production prod', () => {
    expect(itemBelt('grammar', { cloze: card(1) })).toBe('yellow');
    expect(itemBelt('grammar', { cloze: card(31), prod: card(8) })).toBe('brown');
    expect(itemBelt('grammar', { prod: card(31) })).toBe('white');
  });
  it('component is never brown or black', () => {
    expect(itemBelt('component', { rec: card(500) })).toBe('green');
    expect(itemBelt('component', { rec: card(3) })).toBe('yellow');
  });
  it('chunk: prod is both base and production', () => {
    expect(itemBelt('chunk', { prod: card(7) })).toBe('green');
    expect(itemBelt('chunk', { prod: card(30) })).toBe('brown');
    expect(itemBelt('chunk', { prod: card(120) })).toBe('black');
  });
  it('kana', () => {
    expect(itemBelt('kana', { rec: card(30), prod: card(7) })).toBe('brown');
    expect(itemBelt('kana', { rec: card(181, 1), prod: card(181, 1) })).toBe('black');
  });
  it('archived cards still count', () => {
    expect(itemBelt('kana', { rec: card(200, 1) })).toBe('green');
  });
});

describe('promotion detection', () => {
  it('reports before → after only when the belt rises', () => {
    const before = itemBelt('vocab', { rec: card(6) });
    const after = itemBelt('vocab', { rec: card(7.2) });
    expect(beltPromotion(before, after)).toEqual({ from: 'yellow', to: 'green' });
    expect(beltPromotion('green', 'green')).toBeNull();
    expect(beltPromotion('brown', 'green')).toBeNull();
    const ladder: ItemBelt[] = ['white', 'yellow', 'green', 'brown', 'black'];
    for (let i = 1; i < ladder.length; i++) {
      expect(beltPromotion(ladder[i - 1] as ItemBelt, ladder[i] as ItemBelt)).toEqual({ from: ladder[i - 1], to: ladder[i] });
    }
  });
});
