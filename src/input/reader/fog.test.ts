import type { CardKey } from '../../content/types';
import type { CardTuple } from '../../shared/store-types';
import { card } from '../../store/testing';
import { FOG_S, baseFogged, fogPredicate, foggedKanji, kanjiFogged, readKey, type CardLookup } from './fog';

function lookup(entries: Record<string, CardTuple>): CardLookup {
  const m = new Map<string, CardTuple>(Object.entries(entries));
  return { get: (k: CardKey) => m.get(k) };
}

describe('readKey', () => {
  it('builds the kanji read card key', () => {
    expect(readKey('飲')).toBe('j-飲#read');
    expect(FOG_S).toBe(7);
  });
});

describe('kanjiFogged / baseFogged', () => {
  it('S 6.9 → show (not fogged), S 7 → hide (fogged)', () => {
    const cards = lookup({ 'j-飲#read': card({ s: 6.9 }), 'j-食#read': card({ s: 7 }) });
    expect(kanjiFogged(cards, '飲')).toBe(false);
    expect(kanjiFogged(cards, '食')).toBe(true);
    expect(baseFogged(cards, '飲')).toBe(false);
    expect(baseFogged(cards, '食')).toBe(true);
  });

  it('no read card → show; a comp-only kanji → show', () => {
    const cards = lookup({ 'j-人#comp': card({ s: 30 }) });
    expect(kanjiFogged(cards, '人')).toBe(false);
    expect(kanjiFogged(cards, '水')).toBe(false);
  });

  it('a multi-kanji base is fogged only when every kanji is mature', () => {
    const cards = lookup({ 'j-日#read': card({ s: 20 }), 'j-本#read': card({ s: 3 }) });
    expect(baseFogged(cards, '日本')).toBe(false);
    const both = lookup({ 'j-日#read': card({ s: 20 }), 'j-本#read': card({ s: 7 }) });
    expect(baseFogged(both, '日本')).toBe(true);
  });

  it('々 repeats the previous kanji; a base without kanji is never fogged', () => {
    const cards = lookup({ 'j-人#read': card({ s: 10 }) });
    expect(baseFogged(cards, '人々')).toBe(true);
    expect(baseFogged(lookup({}), '人々')).toBe(false);
    expect(baseFogged(cards, '々')).toBe(false);
    expect(baseFogged(cards, 'NHK')).toBe(false);
    expect(baseFogged(cards, '')).toBe(false);
  });

  it('archived cards still count (archive is a flag; S is still S)', () => {
    const cards = lookup({ 'j-食#read': card({ s: 40, flags: 1 }) });
    expect(kanjiFogged(cards, '食')).toBe(true);
  });
});

describe('fogPredicate', () => {
  const cards = lookup({ 'j-食#read': card({ s: 7 }), 'j-飲#read': card({ s: 6.9 }) });

  it('fog mode applies the S ≥ 7 rule per base', () => {
    const fog = fogPredicate(cards, 'fog');
    expect(fog('食')).toBe(true);
    expect(fog('飲')).toBe(false);
    expect(fog('水')).toBe(false);
  });

  it('always and off override to never fogged; tap to always fogged', () => {
    expect(fogPredicate(cards, 'always')('食')).toBe(false);
    expect(fogPredicate(cards, 'off')('食')).toBe(false);
    expect(fogPredicate(cards, 'tap')('飲')).toBe(true);
    expect(fogPredicate(cards, 'tap')('水')).toBe(true);
  });

  it('memoises per base within one predicate (one lookup per distinct base)', () => {
    const get = vi.fn((k: CardKey) => (k === 'j-食#read' ? card({ s: 9 }) : undefined));
    const fog = fogPredicate({ get }, 'fog');
    fog('食');
    fog('食');
    fog('食');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('foggedKanji', () => {
  it('splits the distinct kanji of a text into fogged and shown', () => {
    const cards = lookup({ 'j-食#read': card({ s: 7 }), 'j-飲#read': card({ s: 1 }) });
    expect(foggedKanji(cards, '食べて飲む、食べる人々')).toEqual({ fogged: ['食'], shown: ['飲', '人'] });
    expect(foggedKanji(cards, 'かな だけ')).toEqual({ fogged: [], shown: [] });
  });
});
