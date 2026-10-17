/**
 * TSUZUKU — seeded noise for procedural art.
 *
 * Every generator is deterministic from its seed (mulberry32 from
 * `@/shared/hash`); no `Math.random` anywhere.
 *
 *  noise1(rng)        1-D value noise in [0, 1], lattice drawn from `rng`
 *  noise2(seed)       2-D value noise in [0, 1] (smoothstep interpolation)
 *  simplex2(seed)     2-D simplex gradient noise in [-1, 1]
 *  fbm(n, octaves)    fractal sum, normalised back into the input's range
 *  curl(n)            divergence-free 2-D flow field from a scalar field
 *  ridge(seed, …)     1-D ridge heights (mountain profiles)
 *  poisson(seed, …)   Poisson-disc samples (Bridson) with optional relaxation
 */
import { mulberry32, type Rng } from '../shared/hash';

const PERM_SIZE = 256;

function permutation(seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const p = new Uint8Array(PERM_SIZE * 2);
  const base: number[] = [];
  for (let i = 0; i < PERM_SIZE; i++) base.push(i);
  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = base[i]!;
    base[i] = base[j]!;
    base[j] = t;
  }
  for (let i = 0; i < PERM_SIZE * 2; i++) p[i] = base[i & 255]!;
  return p;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Value noise                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 1-D value noise in [0, 1]: lattice values at integer x drawn from `rng` on
 * demand (cached), smoothstep between them. Negative and fractional x are fine.
 */
export function noise1(rng: Rng): (x: number) => number {
  const table = new Map<number, number>();
  const at = (i: number): number => {
    let v = table.get(i);
    if (v === undefined) {
      v = rng();
      table.set(i, v);
    }
    return v;
  };
  return (x: number): number => {
    if (!Number.isFinite(x)) return 0.5;
    const i = Math.floor(x);
    const t = smoothstep(x - i);
    return lerp(at(i), at(i + 1), t);
  };
}

/** 2-D value noise in [0, 1], period 256, seeded. */
export function noise2(seed: number): (x: number, y: number) => number {
  const p = permutation(seed);
  const vals = new Float32Array(PERM_SIZE);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0; i < PERM_SIZE; i++) vals[i] = rng();
  const at = (ix: number, iy: number): number => vals[p[(p[ix & 255]! + iy) & 255]! & 255]!;
  return (x: number, y: number): number => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0.5;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smoothstep(x - xi);
    const ty = smoothstep(y - yi);
    const a = lerp(at(xi, yi), at(xi + 1, yi), tx);
    const b = lerp(at(xi, yi + 1), at(xi + 1, yi + 1), tx);
    return lerp(a, b, ty);
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Simplex noise (2-D, Gustavson's public-domain formulation)                  */
/* ────────────────────────────────────────────────────────────────────────── */

const GRAD2: readonly [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** 2-D simplex gradient noise, roughly uniform in [-1, 1], zero-mean, seeded. */
export function simplex2(seed: number): (x: number, y: number) => number {
  const p = permutation(seed);
  const dot = (gi: number, x: number, y: number): number => {
    const gr = GRAD2[gi % 8]!;
    return gr[0] * x + gr[1] * y;
  };
  return (xin: number, yin: number): number => {
    if (!Number.isFinite(xin) || !Number.isFinite(yin)) return 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) {
      tt *= tt;
      n += tt * tt * dot(p[ii + p[jj]!]!, x0, y0);
    }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) {
      tt *= tt;
      n += tt * tt * dot(p[ii + i1 + p[jj + j1]!]!, x1, y1);
    }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) {
      tt *= tt;
      n += tt * tt * dot(p[ii + 1 + p[jj + 1]!]!, x2, y2);
    }
    const v = 70 * n;
    return v < -1 ? -1 : v > 1 ? 1 : v;
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* fBm, curl, ridge                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export interface FbmOptions {
  /** Frequency multiplier per octave (default 2). */
  lacunarity?: number;
  /** Amplitude multiplier per octave (default 0.5). */
  gain?: number;
}

/**
 * Fractal Brownian motion over `n`: octaves summed with geometric falloff and
 * divided by the total amplitude, so a [0, 1] (or [-1, 1]) input stays in range.
 */
export function fbm(n: (x: number, y: number) => number, octaves: number, o: FbmOptions = {}): (x: number, y: number) => number {
  const oct = Math.max(1, Math.round(octaves));
  const lac = o.lacunarity ?? 2;
  const gain = o.gain ?? 0.5;
  let total = 0;
  let amp = 1;
  for (let i = 0; i < oct; i++) {
    total += amp;
    amp *= gain;
  }
  return (x: number, y: number): number => {
    let sum = 0;
    let a = 1;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      sum += a * n(x * f, y * f);
      a *= gain;
      f *= lac;
    }
    return sum / total;
  };
}

/** Divergence-free flow: `[∂n/∂y, −∂n/∂x]` by central differences (petal storms, steam). */
export function curl(n: (x: number, y: number) => number, eps = 0.01): (x: number, y: number) => [number, number] {
  const e = eps > 0 ? eps : 0.01;
  return (x: number, y: number): [number, number] => {
    const dndy = (n(x, y + e) - n(x, y - e)) / (2 * e);
    const dndx = (n(x + e, y) - n(x - e, y)) / (2 * e);
    return [dndy, -dndx];
  };
}

/**
 * A 1-D ridge of `points` heights in [0, amp]: three octaves of value noise
 * plus a gentle large-scale swell, so neighbouring ridges differ by seed.
 */
export function ridge(seed: number, points: number, amp: number, o: { roughness?: number } = {}): number[] {
  const n = Math.max(2, Math.round(points));
  const rough = o.roughness ?? 0.35;
  const rng = mulberry32(seed);
  const base = noise1(mulberry32(seed ^ 0x1234567));
  const detail = noise1(mulberry32(seed ^ 0x7654321));
  const phase = rng() * 10;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const swell = base(phase + t * 2.5);
    const d = detail(phase * 3 + t * 12);
    const d2 = detail(phase * 7 + t * 31) * 0.5;
    const v = swell * (1 - rough) + rough * (d * 0.7 + d2 * 0.3);
    out.push(Math.max(0, Math.min(1, v)) * amp);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Poisson disc                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Bridson Poisson-disc sampling inside `w × h` with minimum distance `r`,
 * then `relax` iterations of neighbour repulsion that only accept moves
 * keeping every pair ≥ r apart (so the guarantee survives relaxation).
 */
export function poisson(seed: number, w: number, h: number, r: number, relax = 0, o: { k?: number; max?: number } = {}): [number, number][] {
  if (!(w > 0) || !(h > 0) || !(r > 0)) return [];
  const rng = mulberry32(seed);
  const k = o.k ?? 30;
  const cell = r / Math.SQRT2;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: [number, number][] = [];
  const active: number[] = [];
  const r2 = r * r;
  const cap = o.max ?? Infinity;

  const cellOf = (x: number, y: number): number => Math.floor(y / cell) * gw + Math.floor(x / cell);
  const farEnough = (x: number, y: number, skip = -1): boolean => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let j = Math.max(0, cy - 2); j <= Math.min(gh - 1, cy + 2); j++) {
      for (let i = Math.max(0, cx - 2); i <= Math.min(gw - 1, cx + 2); i++) {
        const idx = grid[j * gw + i]!;
        if (idx < 0 || idx === skip) continue;
        const p = pts[idx]!;
        const dx = p[0] - x;
        const dy = p[1] - y;
        if (dx * dx + dy * dy < r2) return false;
      }
    }
    return true;
  };
  const insert = (x: number, y: number): void => {
    grid[cellOf(x, y)] = pts.length;
    pts.push([x, y]);
    active.push(pts.length - 1);
  };

  insert(rng() * w, rng() * h);
  while (active.length > 0 && pts.length < cap) {
    const ai = Math.floor(rng() * active.length);
    const p = pts[active[ai]!]!;
    let placed = false;
    for (let t = 0; t < k; t++) {
      const ang = rng() * Math.PI * 2;
      const rad = r * (1 + rng());
      const x = p[0] + Math.cos(ang) * rad;
      const y = p[1] + Math.sin(ang) * rad;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (!farEnough(x, y)) continue;
      insert(x, y);
      placed = true;
      break;
    }
    if (!placed) {
      active[ai] = active[active.length - 1]!;
      active.pop();
    }
  }

  // Relaxation: push each point away from neighbours within 2r; accept only moves that keep the spacing.
  for (let it = 0; it < Math.max(0, Math.round(relax)); it++) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      let fx = 0;
      let fy = 0;
      for (let j = 0; j < pts.length; j++) {
        if (j === i) continue;
        const q = pts[j]!;
        const dx = p[0] - q[0];
        const dy = p[1] - q[1];
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 > 4 * r2) continue;
        const d = Math.sqrt(d2);
        const push = (2 * r - d) / (2 * r);
        fx += (dx / d) * push;
        fy += (dy / d) * push;
      }
      const nx = Math.min(w - 1e-6, Math.max(0, p[0] + fx * r * 0.15));
      const ny = Math.min(h - 1e-6, Math.max(0, p[1] + fy * r * 0.15));
      if (nx === p[0] && ny === p[1]) continue;
      const oldCell = cellOf(p[0], p[1]);
      const newCell = cellOf(nx, ny);
      if (newCell !== oldCell && grid[newCell]! >= 0) continue;
      grid[oldCell] = -1;
      if (farEnough(nx, ny, i)) {
        p[0] = nx;
        p[1] = ny;
        grid[newCell] = i;
      } else {
        grid[oldCell] = i;
      }
    }
  }
  return pts;
}

/** Smallest pairwise distance of a point set (∞ for fewer than two points). */
export function minDistance(pts: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i]![0] - pts[j]![0];
      const dy = pts[i]![1] - pts[j]![1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
  }
  return best;
}
