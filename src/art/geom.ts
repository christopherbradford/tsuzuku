/**
 * TSUZUKU — 2-D geometry for procedural art.
 *
 * Points are `[x, y]` tuples (`Pt`). Path builders return SVG `d` strings via
 * `svg.ts` (two-decimal, NaN-free). Randomised helpers take a seed or an `Rng`
 * from `@/shared/hash`; nothing here is time- or `Math.random`-dependent.
 */
import { mulberry32, type Rng } from '../shared/hash';
import { C, L, M, Z, fmt, polyPath } from './svg';

export type Pt = [number, number];
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scalars and vectors                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Map `x` from `[a0, a1]` to `[b0, b1]` (unclamped). */
export function remap(x: number, a0: number, a1: number, b0: number, b1: number): number {
  if (a1 === a0) return b0;
  return b0 + ((x - a0) / (a1 - a0)) * (b1 - b0);
}
/** Smooth 0→1 over `[e0, e1]`. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}
export const TAU = Math.PI * 2;
export function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}
export function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function add(a: Pt, b: Pt): Pt {
  return [a[0] + b[0], a[1] + b[1]];
}
export function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}
export function scale(a: Pt, k: number): Pt {
  return [a[0] * k, a[1] * k];
}
export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}
export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
export function length(a: Pt): number {
  return Math.hypot(a[0], a[1]);
}
/** Unit vector (zero vector stays zero). */
export function norm(a: Pt): Pt {
  const l = length(a);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
}
/** Left-hand perpendicular. */
export function perp(a: Pt): Pt {
  return [-a[1], a[0]];
}
export function angleOf(a: Pt): number {
  return Math.atan2(a[1], a[0]);
}
/** Point at polar `(r, theta)` around `(cx, cy)`; theta in radians, 0 = +x, clockwise on screen. */
export function polar(cx: number, cy: number, r: number, theta: number): Pt {
  return [cx + r * Math.cos(theta), cy + r * Math.sin(theta)];
}
/** Rotate `p` about `c` by `theta` radians. */
export function rotate(p: Pt, theta: number, c: Pt = [0, 0]): Pt {
  const s = Math.sin(theta);
  const co = Math.cos(theta);
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * co - y * s, c[1] + x * s + y * co];
}

/** Randomly displace each point by up to `amount` (uniform square). */
export function jitter(rng: Rng, pts: readonly Pt[], amount: number): Pt[] {
  return pts.map(([x, y]) => [x + (rng() * 2 - 1) * amount, y + (rng() * 2 - 1) * amount]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Polylines                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function bbox(pts: readonly Pt[]): Box {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pathLength(pts: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

/** `n` points evenly spaced by arc length along the polyline (endpoints kept). */
export function resample(pts: readonly Pt[], n: number): Pt[] {
  const count = Math.max(2, Math.round(n));
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: count }, () => [pts[0]![0], pts[0]![1]] as Pt);
  const total = pathLength(pts);
  if (total === 0) return Array.from({ length: count }, () => [pts[0]![0], pts[0]![1]] as Pt);
  const out: Pt[] = [[pts[0]![0], pts[0]![1]]];
  let seg = 0;
  let segStart = 0;
  for (let i = 1; i < count - 1; i++) {
    const target = (i / (count - 1)) * total;
    while (seg < pts.length - 2 && segStart + dist(pts[seg]!, pts[seg + 1]!) < target) {
      segStart += dist(pts[seg]!, pts[seg + 1]!);
      seg++;
    }
    const sl = dist(pts[seg]!, pts[seg + 1]!);
    const t = sl === 0 ? 0 : (target - segStart) / sl;
    out.push(lerpPt(pts[seg]!, pts[seg + 1]!, t));
  }
  out.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
  return out;
}

/** Point and unit tangent at arc-length fraction `t` ∈ [0, 1]. */
export function pointAt(pts: readonly Pt[], t: number): { p: Pt; tangent: Pt } {
  if (pts.length === 0) return { p: [0, 0], tangent: [1, 0] };
  if (pts.length === 1) return { p: [pts[0]![0], pts[0]![1]], tangent: [1, 0] };
  const total = pathLength(pts);
  const target = clamp(t, 0, 1) * total;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const sl = dist(pts[i - 1]!, pts[i]!);
    if (acc + sl >= target || i === pts.length - 1) {
      const k = sl === 0 ? 0 : (target - acc) / sl;
      return { p: lerpPt(pts[i - 1]!, pts[i]!, clamp(k, 0, 1)), tangent: norm(sub(pts[i]!, pts[i - 1]!)) };
    }
    acc += sl;
  }
  return { p: [pts[pts.length - 1]![0], pts[pts.length - 1]![1]], tangent: [1, 0] };
}

/**
 * Moving-average smoothing that keeps the point count and pins both endpoints
 * (`passes` of a 1-2-1 kernel).
 */
export function smooth(pts: readonly Pt[], passes: number): Pt[] {
  let cur: Pt[] = pts.map(([x, y]) => [x, y]);
  if (cur.length < 3) return cur;
  for (let p = 0; p < Math.max(0, Math.round(passes)); p++) {
    const next: Pt[] = [cur[0]!];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1]!;
      const b = cur[i]!;
      const c = cur[i + 1]!;
      next.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]);
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

/** Chaikin corner cutting (`passes` iterations; roughly doubles the point count each pass). */
export function chaikin(pts: readonly Pt[], passes: number, closed = false): Pt[] {
  let cur: Pt[] = pts.map(([x, y]) => [x, y]);
  for (let p = 0; p < Math.max(0, Math.round(passes)); p++) {
    if (cur.length < 3) break;
    const next: Pt[] = [];
    const n = cur.length;
    const last = closed ? n : n - 1;
    if (!closed) next.push(cur[0]!);
    for (let i = 0; i < last; i++) {
      const a = cur[i]!;
      const b = cur[(i + 1) % n]!;
      next.push(lerpPt(a, b, 0.25), lerpPt(a, b, 0.75));
    }
    if (!closed) next.push(cur[n - 1]!);
    cur = next;
  }
  return cur;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Curves                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Catmull-Rom spline through every point as cubic Béziers (`tension` 0.5 =
 * centripetal-ish classic). Two points yield a straight line; one point a move.
 */
export function catmullRomPath(pts: readonly Pt[], closed = false, tension = 0.5): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return M(pts[0]![0], pts[0]![1]);
  if (n === 2) return polyPath(pts, closed);
  const k = tension;
  const get = (i: number): Pt => {
    if (closed) return pts[((i % n) + n) % n]!;
    return pts[clamp(i, 0, n - 1)]!;
  };
  let d = M(pts[0]![0], pts[0]![1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) * k) / 3, p1[1] + ((p2[1] - p0[1]) * k) / 3];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) * k) / 3, p2[1] - ((p3[1] - p1[1]) * k) / 3];
    d += C(c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]);
  }
  return closed ? d + Z : d;
}

/** Cubic Bézier point. */
export function bezierPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/**
 * Catenary-shaped hang between `(x0, y)` and `(x1, y)` with the lowest point
 * `sag` below the ends (`cosh` profile); `n` points, endpoints exact.
 */
export function catenary(x0: number, x1: number, y: number, sag: number, n: number): Pt[] {
  const count = Math.max(2, Math.round(n));
  const a = 2.2; // steepness of the cosh bowl; normalised below so the dip is exactly `sag`
  const denom = Math.cosh(a) - 1;
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const u = (t - 0.5) * 2 * a;
    const dip = denom === 0 ? 0 : 1 - (Math.cosh(u) - 1) / denom; // 0 at ends, 1 at centre
    const x = i === 0 ? x0 : i === count - 1 ? x1 : lerp(x0, x1, t);
    out.push([x, i === 0 || i === count - 1 ? y : y + sag * dip]);
  }
  return out;
}

/** Logarithmic spiral `r = a·e^(bθ)` around the origin, `n` points over `turns` revolutions. */
export function logSpiral(a: number, b: number, turns: number, n: number): Pt[] {
  const count = Math.max(2, Math.round(n));
  const out: Pt[] = [];
  const thetaMax = TAU * turns;
  for (let i = 0; i < count; i++) {
    const theta = (i / (count - 1)) * thetaMax;
    const r = a * Math.exp(b * theta);
    out.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Polygons                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export function regularPolygon(cx: number, cy: number, r: number, n: number, rot = -Math.PI / 2): Pt[] {
  const sides = Math.max(3, Math.round(n));
  const out: Pt[] = [];
  for (let i = 0; i < sides; i++) out.push(polar(cx, cy, r, rot + (i / sides) * TAU));
  return out;
}

/** `n`-pointed star alternating outer/inner radius (polygon points, 2n). */
export function star(cx: number, cy: number, rOuter: number, rInner: number, n: number, rot = -Math.PI / 2): Pt[] {
  const spikes = Math.max(2, Math.round(n));
  const out: Pt[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    out.push(polar(cx, cy, r, rot + (i / (spikes * 2)) * TAU));
  }
  return out;
}

/**
 * `n` triangular rays between radius `r1` (base, width = half the angular pitch)
 * and `r2` (tip) as one path (Gold crest rays, speed lines, fireworks).
 */
export function rays(cx: number, cy: number, r1: number, r2: number, n: number, rot = -Math.PI / 2): string {
  const count = Math.max(1, Math.round(n));
  const pitch = TAU / count;
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = rot + i * pitch;
    const base0 = polar(cx, cy, r1, a - pitch / 4);
    const base1 = polar(cx, cy, r1, a + pitch / 4);
    const tip = polar(cx, cy, r2, a);
    d += M(base0[0], base0[1]) + L(tip[0], tip[1]) + L(base1[0], base1[1]) + Z;
  }
  return d;
}

/** Signed area (positive = counter-clockwise in y-up, clockwise on screen). */
export function polygonArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function centroid(poly: readonly Pt[]): Pt {
  if (poly.length === 0) return [0, 0];
  const area = polygonArea(poly);
  if (Math.abs(area) < 1e-9) {
    let x = 0;
    let y = 0;
    for (const p of poly) {
      x += p[0];
      y += p[1];
    }
    return [x / poly.length, y / poly.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cy += (a[1] + b[1]) * f;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/** Ray-casting point-in-polygon (edges count as inside). */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi === y && xi === x) return true;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Clip a polygon by the half-plane `ax + by ≤ c` (Sutherland–Hodgman step). */
function clipHalfPlane(poly: readonly Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const fp = a * p[0] + b * p[1] - c;
    const fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push(lerpPt(p, q, t));
    }
  }
  return out;
}

/**
 * Voronoi-lite shatter: `pieces` seed points inside `poly`, each cell = the
 * polygon clipped by the bisector half-planes against every other seed.
 * Always returns exactly `pieces` polygons (a degenerate cell falls back to a
 * tiny triangle at its seed so counts stay stable).
 */
export function shatter(seed: number, poly: readonly Pt[], pieces: number): Pt[][] {
  const count = Math.max(1, Math.round(pieces));
  if (poly.length < 3) return [];
  const rng = mulberry32(seed);
  const box = bbox(poly);
  const seeds: Pt[] = [];
  let guard = 0;
  while (seeds.length < count && guard < count * 200) {
    guard++;
    const p: Pt = [box.x + rng() * box.w, box.y + rng() * box.h];
    if (pointInPolygon(p, poly)) seeds.push(p);
  }
  while (seeds.length < count) seeds.push(centroid(poly));
  const cells: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const s = seeds[i]!;
    let cell: Pt[] = poly.map(([x, y]) => [x, y]);
    for (let j = 0; j < count && cell.length >= 3; j++) {
      if (j === i) continue;
      const o = seeds[j]!;
      if (o[0] === s[0] && o[1] === s[1]) continue;
      // points closer to s than to o: (o - s)·p ≤ (|o|² - |s|²)/2
      const a = o[0] - s[0];
      const b = o[1] - s[1];
      const c = (o[0] * o[0] + o[1] * o[1] - s[0] * s[0] - s[1] * s[1]) / 2;
      cell = clipHalfPlane(cell, a, b, c);
    }
    if (cell.length < 3) {
      const e = Math.max(1e-3, Math.min(box.w, box.h) * 0.002);
      cell = [
        [s[0] - e, s[1] + e],
        [s[0] + e, s[1] + e],
        [s[0], s[1] - e],
      ];
    }
    cells.push(cell);
  }
  return cells;
}

/** Shrink a polygon toward its centroid by factor `k` (0 = unchanged, 1 = collapsed). */
export function shrink(poly: readonly Pt[], k: number): Pt[] {
  const c = centroid(poly);
  return poly.map((p) => lerpPt(p, c, clamp(k, 0, 1)));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Distortion and layout                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Barrel (k > 0) / pincushion (k < 0) distortion about the centre of a `w × h`
 * canvas; radius normalised to the half-diagonal so the corners move most.
 */
export function barrel(pts: readonly Pt[], k: number, w: number, h: number): Pt[] {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.hypot(cx, cy) || 1;
  return pts.map(([x, y]) => {
    const dx = (x - cx) / R;
    const dy = (y - cy) / R;
    const r2 = dx * dx + dy * dy;
    const f = 1 + k * r2;
    return [cx + dx * f * R, cy + dy * f * R];
  });
}

export interface GridCell extends Box {
  col: number;
  row: number;
  i: number;
  cx: number;
  cy: number;
}

/** `cols × rows` cells filling `box` with `gap` between them (row-major order). */
export function grid(cols: number, rows: number, box: Box, gap = 0): GridCell[] {
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  const cw = (box.w - gap * (c - 1)) / c;
  const ch = (box.h - gap * (r - 1)) / r;
  const out: GridCell[] = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      const x = box.x + col * (cw + gap);
      const y = box.y + row * (ch + gap);
      out.push({ x, y, w: cw, h: ch, col, row, i: row * c + col, cx: x + cw / 2, cy: y + ch / 2 });
    }
  }
  return out;
}

/** Fit a `w × h` box inside `box` keeping aspect, centred (contain). */
export function fitInside(w: number, h: number, box: Box): Box {
  if (!(w > 0) || !(h > 0)) return { x: box.x, y: box.y, w: 0, h: 0 };
  const k = Math.min(box.w / w, box.h / h);
  const fw = w * k;
  const fh = h * k;
  return { x: box.x + (box.w - fw) / 2, y: box.y + (box.h - fh) / 2, w: fw, h: fh };
}

/** `translate(x,y) rotate(deg) scale(s)` transform string (omits identity parts). */
export function transform(o: { x?: number; y?: number; rotate?: number; scale?: number; cx?: number; cy?: number }): string {
  const parts: string[] = [];
  if (o.x || o.y) parts.push(`translate(${fmt(o.x ?? 0)} ${fmt(o.y ?? 0)})`);
  if (o.rotate) parts.push(o.cx !== undefined || o.cy !== undefined ? `rotate(${fmt(o.rotate)} ${fmt(o.cx ?? 0)} ${fmt(o.cy ?? 0)})` : `rotate(${fmt(o.rotate)})`);
  if (o.scale !== undefined && o.scale !== 1) parts.push(`scale(${fmt(o.scale)})`);
  return parts.join(' ');
}
