import { mulberry32 } from '../shared/hash';
import { curl, fbm, minDistance, noise1, noise2, poisson, ridge, simplex2 } from './noise';

describe('noise1', () => {
  it('is deterministic for a seed and in [0, 1]', () => {
    const a = noise1(mulberry32(42));
    const b = noise1(mulberry32(42));
    for (let i = -20; i < 20; i++) {
      const x = i * 0.37;
      expect(a(x)).toBe(b(x));
      expect(a(x)).toBeGreaterThanOrEqual(0);
      expect(a(x)).toBeLessThanOrEqual(1);
    }
  });
  it('is continuous (small steps change little) and hits lattice values exactly', () => {
    const n = noise1(mulberry32(7));
    expect(Math.abs(n(3.001) - n(3))).toBeLessThan(0.01);
    const v = n(5);
    expect(n(5)).toBe(v);
    expect(n(Number.NaN)).toBe(0.5);
  });
  it('different seeds differ', () => {
    const a = noise1(mulberry32(1));
    const b = noise1(mulberry32(2));
    let same = 0;
    for (let i = 0; i < 20; i++) if (a(i + 0.5) === b(i + 0.5)) same++;
    expect(same).toBeLessThan(3);
  });
});

describe('noise2 / simplex2', () => {
  it('noise2 is deterministic per seed and in [0, 1]', () => {
    const a = noise2(99);
    const b = noise2(99);
    for (let i = 0; i < 200; i++) {
      const x = (i % 17) * 0.31;
      const y = Math.floor(i / 17) * 0.53;
      expect(a(x, y)).toBe(b(x, y));
      expect(a(x, y)).toBeGreaterThanOrEqual(0);
      expect(a(x, y)).toBeLessThanOrEqual(1);
    }
    expect(noise2(1)(0.5, 0.5)).not.toBe(noise2(2)(0.5, 0.5));
  });
  it('simplex2 is zero-mean, bounded in [-1, 1] and deterministic', () => {
    const s = simplex2(2024);
    const s2 = simplex2(2024);
    let sum = 0;
    let n = 0;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const v = s(x * 0.173, y * 0.191);
        expect(v).toBe(s2(x * 0.173, y * 0.191));
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
        sum += v;
        n++;
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.1);
    expect(s(Number.NaN, 0)).toBe(0);
  });
});

describe('fbm / curl / ridge', () => {
  it('fbm keeps the range of its base noise', () => {
    const f = fbm(noise2(5), 5);
    for (let i = 0; i < 100; i++) {
      const v = f(i * 0.07, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const g = fbm(simplex2(5), 4, { gain: 0.6, lacunarity: 2.1 });
    expect(Math.abs(g(0.3, 0.7))).toBeLessThanOrEqual(1);
  });
  it('curl of a linear field is constant and perpendicular to the gradient', () => {
    const field = (x: number, y: number): number => 2 * x + 3 * y;
    const c = curl(field);
    const [vx, vy] = c(0.3, 0.9);
    expect(vx).toBeCloseTo(3, 4);
    expect(vy).toBeCloseTo(-2, 4);
    expect(vx * 2 + vy * 3).toBeCloseTo(0, 4);
  });
  it('ridge returns `points` heights in [0, amp], deterministic per seed', () => {
    const r = ridge(11, 64, 120);
    expect(r.length).toBe(64);
    for (const v of r) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(120);
    }
    expect(ridge(11, 64, 120)).toEqual(r);
    expect(ridge(12, 64, 120)).not.toEqual(r);
    expect(ridge(1, 1, 10).length).toBe(2);
  });
});

describe('poisson', () => {
  it('samples are inside the box and never closer than r', () => {
    const pts = poisson(3, 400, 300, 20);
    expect(pts.length).toBeGreaterThan(100);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(300);
    }
    expect(minDistance(pts)).toBeGreaterThanOrEqual(20);
  });
  it('relaxation keeps the minimum distance and stays deterministic', () => {
    const a = poisson(8, 300, 300, 24, 3);
    const b = poisson(8, 300, 300, 24, 3);
    expect(a).toEqual(b);
    expect(minDistance(a)).toBeGreaterThanOrEqual(24);
    for (const [x, y] of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(300);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(300);
    }
  });
  it('max caps the count; bad sizes yield nothing', () => {
    expect(poisson(1, 500, 500, 10, 0, { max: 50 }).length).toBe(50);
    expect(poisson(1, 0, 10, 5)).toEqual([]);
    expect(poisson(1, 10, 10, 0)).toEqual([]);
    expect(minDistance([[0, 0]])).toBe(Infinity);
  });
});
