import {
  chance,
  fmix32,
  fnv1a32,
  gauss,
  hashSeed,
  hashString,
  mulberry32,
  pick,
  randomSeed,
  range,
  rngFor,
  sample,
  shuffle,
  uniform,
  weighted,
  xmur3,
} from './hash';

describe('fnv1a32', () => {
  it('matches the reference vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    expect(hashString('foobar')).toBe(fnv1a32('foobar'));
  });
  it('is a uint32 for any input', () => {
    for (const s of ['つづく', 'v-n5-0001#prod', 'x'.repeat(1000), '🍵']) {
      const h = fnv1a32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('hashSeed / xmur3 / fmix32', () => {
  it('is deterministic and order-sensitive', () => {
    expect(hashSeed('seed', 'day', 20743)).toBe(hashSeed('seed', 'day', 20743));
    expect(hashSeed('a', 'b')).not.toBe(hashSeed('b', 'a'));
    expect(hashSeed('seed', 1)).not.toBe(hashSeed('seed', 2));
    expect(hashSeed('seed', 1)).toBe(hashSeed('seed', '1'));
    expect(hashSeed('ab', 'c')).not.toBe(hashSeed('a', 'bc'));
  });
  it('yields uint32', () => {
    for (const parts of [[''], ['x'], ['seed', 'kage', 2965], [0]]) {
      const h = hashSeed(...parts);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
    expect(fmix32(0)).toBe(0);
    expect(fmix32(1)).not.toBe(1);
  });
  it('xmur3 produces a repeatable sequence', () => {
    const a = xmur3('tsuzuku');
    const b = xmur3('tsuzuku');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(xmur3('x')()).not.toBe(xmur3('y')());
  });
});

describe('mulberry32', () => {
  it('pins the sequence for seed 1', () => {
    const r = mulberry32(1);
    expect([r(), r(), r(), r(), r()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849,
    ]);
  });
  it('stays in [0, 1) and differs by seed', () => {
    const r = mulberry32(123456);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('rngFor is mulberry32(hashSeed(...))', () => {
    expect(rngFor('s', 7)()).toBe(mulberry32(hashSeed('s', 7))());
  });
});

describe('helpers with an injected rng', () => {
  it('shuffle is a permutation, deterministic, and never mutates', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(mulberry32(42), src);
    const b = shuffle(mulberry32(42), src);
    expect(a).toEqual(b);
    expect(a).toEqual([3, 8, 2, 1, 7, 6, 4, 5]);
    expect([...a].sort((x, y) => x - y)).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffle(mulberry32(1), [])).toEqual([]);
  });
  it('pick draws members and throws on empty', () => {
    const r = mulberry32(9);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(arr).toContain(pick(r, arr));
    expect(() => pick(r, [])).toThrow(RangeError);
  });
  it('sample is distinct and bounded', () => {
    const s = sample(mulberry32(3), [1, 2, 3, 4, 5], 3);
    expect(s).toHaveLength(3);
    expect(new Set(s).size).toBe(3);
    expect(sample(mulberry32(3), [1, 2], 5)).toHaveLength(2);
  });
  it('range is inclusive on both ends and reaches both', () => {
    const r = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = range(r, 1, 3);
      expect([1, 2, 3]).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
    expect(range(r, 4, 4)).toBe(4);
    expect([2, 3, 4]).toContain(range(r, 4, 2));
  });
  it('uniform, chance, gauss, weighted', () => {
    const r = mulberry32(11);
    for (let i = 0; i < 100; i++) {
      const v = uniform(r, 2, 3);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(3);
    }
    expect(chance(() => 0.2, 0.5)).toBe(true);
    expect(chance(() => 0.7, 0.5)).toBe(false);
    for (let i = 0; i < 100; i++) expect(Number.isFinite(gauss(r, 10, 2))).toBe(true);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[weighted(r, [1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBeGreaterThan(counts[0]!);
    expect(() => weighted(r, [0, 0])).toThrow(RangeError);
  });
  it('randomSeed mints 32 hex chars', () => {
    const s = randomSeed();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSeed()).not.toBe(s);
  });
});
