import { mulberry32 } from '../shared/hash';
import {
  barrel,
  bbox,
  catenary,
  catmullRomPath,
  centroid,
  chaikin,
  clamp,
  fitInside,
  grid,
  jitter,
  logSpiral,
  pathLength,
  pointAt,
  pointInPolygon,
  polar,
  polygonArea,
  rays,
  regularPolygon,
  remap,
  resample,
  rotate,
  shatter,
  smooth,
  star,
  transform,
  type Pt,
} from './geom';
import { el, svgDoc } from './svg';

function parses(d: string): void {
  const svg = svgDoc({ w: 100, h: 100, body: [el('path', { d })] });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  // every command letter is followed by numbers, no NaN
  expect(d).not.toMatch(/NaN|Infinity/);
  expect(d).toMatch(/^M-?[\d.]+ -?[\d.]+/);
}

const SQUARE: Pt[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe('scalars', () => {
  it('clamp/remap handle NaN and degenerate ranges', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
    expect(remap(5, 3, 3, 7, 9)).toBe(7);
  });
  it('polar and rotate', () => {
    const p = polar(10, 10, 5, 0);
    expect(p[0]).toBeCloseTo(15);
    expect(p[1]).toBeCloseTo(10);
    const r = rotate([1, 0], Math.PI / 2);
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(1);
  });
});

describe('catmullRomPath', () => {
  it('path strings parse and start at the first point', () => {
    const pts: Pt[] = [
      [0, 50],
      [25, 20],
      [50, 60],
      [75, 30],
      [100, 50],
    ];
    const d = catmullRomPath(pts);
    parses(d);
    expect(d.startsWith('M0 50')).toBe(true);
    expect(d.split('C').length - 1).toBe(4);
    const closed = catmullRomPath(pts, true);
    parses(closed);
    expect(closed.endsWith('Z')).toBe(true);
    expect(closed.split('C').length - 1).toBe(5);
  });
  it('degenerate inputs', () => {
    expect(catmullRomPath([])).toBe('');
    expect(catmullRomPath([[1, 2]])).toBe('M1 2');
    expect(catmullRomPath([[0, 0], [10, 10]])).toBe('M0 0L10 10');
  });
});

describe('smoothing and resampling', () => {
  it('smooth keeps the count and both endpoints', () => {
    const pts: Pt[] = [[0, 0], [10, 100], [20, -100], [30, 100], [40, 0]];
    const s = smooth(pts, 3);
    expect(s.length).toBe(5);
    expect(s[0]).toEqual([0, 0]);
    expect(s[4]).toEqual([40, 0]);
    expect(Math.abs(s[2]![1])).toBeLessThan(100);
    expect(smooth([[0, 0], [1, 1]], 5)).toEqual([[0, 0], [1, 1]]);
  });
  it('chaikin grows the point count and keeps ends when open', () => {
    const c = chaikin(SQUARE, 1);
    expect(c.length).toBe(8);
    expect(c[0]).toEqual([0, 0]);
    expect(chaikin(SQUARE, 1, true).length).toBe(8);
  });
  it('resample spaces points evenly along the arc', () => {
    const r = resample([[0, 0], [100, 0]], 5);
    expect(r).toEqual([[0, 0], [25, 0], [50, 0], [75, 0], [100, 0]]);
    const bent = resample([[0, 0], [0, 100], [100, 100]], 9);
    expect(bent.length).toBe(9);
    expect(bent[4]).toEqual([0, 100]);
    expect(pathLength(bent)).toBeCloseTo(200);
    const mid = pointAt([[0, 0], [100, 0]], 0.5);
    expect(mid.p).toEqual([50, 0]);
    expect(mid.tangent).toEqual([1, 0]);
  });
});

describe('catenary', () => {
  it('endpoints exact, lowest point exactly sag below, symmetric', () => {
    const c = catenary(10, 210, 50, 40, 21);
    expect(c.length).toBe(21);
    expect(c[0]).toEqual([10, 50]);
    expect(c[20]).toEqual([210, 50]);
    expect(c[10]![0]).toBeCloseTo(110);
    expect(c[10]![1]).toBeCloseTo(90);
    for (let i = 1; i < 10; i++) {
      expect(c[i]![1]).toBeCloseTo(c[20 - i]![1]);
      expect(c[i]![1]).toBeLessThan(c[i + 1]![1]);
    }
  });
});

describe('logSpiral', () => {
  it('starts at radius a and grows', () => {
    const s = logSpiral(5, 0.2, 2, 50);
    expect(s.length).toBe(50);
    expect(s[0]![0]).toBeCloseTo(5);
    expect(s[0]![1]).toBeCloseTo(0);
    expect(Math.hypot(...s[49]!)).toBeGreaterThan(Math.hypot(...s[0]!));
  });
});

describe('polygons', () => {
  it('shatter returns exactly `pieces` polygons that cover the area', () => {
    const cells = shatter(5, SQUARE, 12);
    expect(cells.length).toBe(12);
    let area = 0;
    for (const c of cells) {
      expect(c.length).toBeGreaterThanOrEqual(3);
      area += Math.abs(polygonArea(c));
      for (const p of c) {
        expect(p[0]).toBeGreaterThanOrEqual(-1e-6);
        expect(p[0]).toBeLessThanOrEqual(100 + 1e-6);
        expect(p[1]).toBeGreaterThanOrEqual(-1e-6);
        expect(p[1]).toBeLessThanOrEqual(100 + 1e-6);
      }
    }
    expect(area).toBeCloseTo(10_000, 0);
    expect(shatter(5, SQUARE, 12)).toEqual(cells);
    expect(shatter(6, SQUARE, 12)).not.toEqual(cells);
    expect(shatter(1, SQUARE, 1)[0]!.length).toBe(4);
    expect(shatter(1, [[0, 0], [1, 1]], 3)).toEqual([]);
  });
  it('rays / star / regularPolygon', () => {
    const d = rays(50, 50, 10, 30, 16);
    parses(d);
    expect(d.split('Z').length - 1).toBe(16);
    expect(star(0, 0, 10, 4, 5).length).toBe(10);
    const hex = regularPolygon(0, 0, 10, 6);
    expect(hex.length).toBe(6);
    expect(Math.abs(polygonArea(hex))).toBeCloseTo((3 * Math.sqrt(3) * 100) / 2, 3);
  });
  it('area, centroid, point-in-polygon, bbox', () => {
    expect(Math.abs(polygonArea(SQUARE))).toBe(10_000);
    expect(centroid(SQUARE)).toEqual([50, 50]);
    expect(pointInPolygon([50, 50], SQUARE)).toBe(true);
    expect(pointInPolygon([150, 50], SQUARE)).toBe(false);
    expect(bbox(SQUARE)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(bbox([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('distortion and layout', () => {
  it('barrel leaves the centre alone and pushes corners outward', () => {
    const [c, corner] = barrel([[50, 50], [0, 0]], 0.2, 100, 100);
    expect(c).toEqual([50, 50]);
    expect(corner![0]).toBeLessThan(0);
    expect(corner![1]).toBeLessThan(0);
    const [pin] = barrel([[0, 0]], -0.2, 100, 100);
    expect(pin![0]).toBeGreaterThan(0);
  });
  it('grid fills the box row-major with gaps', () => {
    const cells = grid(3, 2, { x: 0, y: 0, w: 320, h: 210 }, 10);
    expect(cells.length).toBe(6);
    expect(cells[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 100, col: 0, row: 0, i: 0, cx: 50, cy: 50 });
    expect(cells[5]).toMatchObject({ x: 220, y: 110, col: 2, row: 1, i: 5 });
  });
  it('fitInside keeps aspect and centres', () => {
    expect(fitInside(16, 9, { x: 0, y: 0, w: 160, h: 180 })).toEqual({ x: 0, y: 45, w: 160, h: 90 });
  });
  it('jitter is seeded and bounded', () => {
    const a = jitter(mulberry32(1), SQUARE, 3);
    const b = jitter(mulberry32(1), SQUARE, 3);
    expect(a).toEqual(b);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(a[i]![0] - SQUARE[i]![0])).toBeLessThanOrEqual(3);
      expect(Math.abs(a[i]![1] - SQUARE[i]![1])).toBeLessThanOrEqual(3);
    }
  });
  it('transform omits identity parts', () => {
    expect(transform({})).toBe('');
    expect(transform({ x: 1, y: 2, rotate: 45, scale: 2 })).toBe('translate(1 2) rotate(45) scale(2)');
    expect(transform({ rotate: -6, cx: 10, cy: 20 })).toBe('rotate(-6 10 20)');
  });
});
