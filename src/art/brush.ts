/**
 * TSUZUKU — sumi-e brush geometry (design 01 §4.1, 06 §3/§4).
 *
 *  brushPolygon / brushStroke  variable-width stroke from a centreline (spine)
 *                              with a pressure envelope and bristle displacement
 *  bristles / dryBrush         dry-brush hair lines with gaps along the spine
 *  inkBleed                    filter def that roughens and bleeds edges
 *  splatter                    ink droplets around a point (path)
 *  enso                        the one-stroke circle with its opening (path)
 *  sealFrame                   hanko frame with noise-eroded edges (evenodd path)
 *  dashWrite                   stroke-dasharray "writing" animation helpers
 *
 * All outputs are deterministic for a seed; paths come back as `d` strings
 * so callers choose fill/filter. A stroke polygon always has exactly 2n
 * points for an n-point spine.
 */
import { mulberry32, type Rng } from '../shared/hash';
import { noise1 } from './noise';
import { clamp, dist, lerp, norm, perp, polar, resample, sub, TAU, type Pt } from './geom';
import { A, L, M, Z, el, filter, fmt, polyPath, type Attrs } from './svg';

/* ────────────────────────────────────────────────────────────────────────── */
/* Pressure envelopes                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export type Pressure = (t: number) => number;

/** Fast attack, full body, long taper (the default brush feel). */
export const taper: Pressure = (t) => {
  const u = clamp(t, 0, 1);
  const attack = Math.min(1, u / 0.12);
  const release = u < 0.6 ? 1 : 1 - ((u - 0.6) / 0.4) ** 1.6;
  return Math.max(0.04, attack * release);
};
/** Even width with soft ends. */
export const flat: Pressure = (t) => {
  const u = clamp(t, 0, 1);
  return Math.max(0.1, Math.min(1, Math.min(u, 1 - u) * 12));
};
/** Thin start swelling to the middle, thin end (a leaf). */
export const swell: Pressure = (t) => Math.max(0.05, Math.sin(clamp(t, 0, 1) * Math.PI));
/** Thick start fading to a flick (an ensō stroke). */
export const fade: Pressure = (t) => {
  const u = clamp(t, 0, 1);
  return Math.max(0.03, Math.min(1, u * 8) * (1 - u) ** 0.8 + 0.12 * (1 - u));
};
export const PRESSURE = { taper, flat, swell, fade } as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Stroke polygon                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BrushOptions {
  /** Maximum width in user units. */
  width: number;
  /** Width envelope over arc-length fraction t ∈ [0, 1] → 0–1 (default `taper`). */
  pressure?: Pressure;
  seed: number;
  /** Bristle displacement amplitude as a fraction of the half-width (default 0.18). */
  bristle?: number;
  /** Noise frequency along the stroke (default 6 cycles over the stroke). */
  frequency?: number;
  /** Width floor in user units (default 0.4). */
  minWidth?: number;
}

/** Unit tangent at each spine point (central differences; ends one-sided). */
export function tangents(spine: readonly Pt[]): Pt[] {
  const n = spine.length;
  if (n === 0) return [];
  if (n === 1) return [[1, 0]];
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = spine[Math.max(0, i - 1)]!;
    const b = spine[Math.min(n - 1, i + 1)]!;
    const t = norm(sub(b, a));
    out.push(t[0] === 0 && t[1] === 0 ? [1, 0] : t);
  }
  return out;
}

/**
 * The stroke outline: left edge forward, right edge backward → exactly
 * `2 × spine.length` points. The two edges carry independent bristle noise so
 * the stroke never looks machine-symmetric.
 */
export function brushPolygon(spine: readonly Pt[], o: BrushOptions): Pt[] {
  const n = spine.length;
  if (n === 0) return [];
  const pressure = o.pressure ?? taper;
  const amp = clamp(o.bristle ?? 0.18, 0, 1);
  const freq = o.frequency ?? 6;
  const minW = Math.max(0, o.minWidth ?? 0.4);
  const nl = noise1(mulberry32(o.seed));
  const nr = noise1(mulberry32(o.seed ^ 0x5bd1e995));
  const tans = tangents(spine);
  let total = 0;
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) {
    total += dist(spine[i - 1]!, spine[i]!);
    cum.push(total);
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = total === 0 ? (n === 1 ? 0 : i / (n - 1)) : cum[i]! / total;
    const w = Math.max(minW, o.width * clamp(pressure(t), 0, 1));
    const half = w / 2;
    const hl = half * (1 + amp * (nl(t * freq) * 2 - 1));
    const hr = half * (1 + amp * (nr(t * freq + 17.3) * 2 - 1));
    const nrm = perp(tans[i]!);
    const p = spine[i]!;
    left.push([p[0] + nrm[0] * hl, p[1] + nrm[1] * hl]);
    right.push([p[0] - nrm[0] * hr, p[1] - nrm[1] * hr]);
  }
  right.reverse();
  return [...left, ...right];
}

/** Closed `d` path of `brushPolygon` (fill it with ink; add `inkBleed` for texture). */
export function brushStroke(spine: readonly Pt[], o: BrushOptions): string {
  return polyPath(brushPolygon(spine, o), true);
}

/** A smoother stroke: resamples the spine to `samples` points first (default 24). */
export function brushStrokeSmooth(spine: readonly Pt[], o: BrushOptions & { samples?: number }): string {
  const pts = spine.length >= 2 ? resample(spine, o.samples ?? 24) : spine;
  return brushStroke(pts, o);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Dry brush                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BristleOptions {
  width: number;
  seed: number;
  /** Hair count (default 7). */
  count?: number;
  /** Probability a segment is skipped (the dry gaps), 0–1, default 0.35. */
  gap?: number;
  /** Width envelope (default `taper`). */
  pressure?: Pressure;
  /** Samples along the spine (default 32). */
  samples?: number;
}

/**
 * Dry-brush hairs: `count` thin polylines offset across the stroke width, each
 * broken into runs with seeded gaps. Returns one `d` string per hair (may hold
 * several `M` sub-paths). Stroke them thin in the ink color.
 */
export function bristles(spine: readonly Pt[], o: BristleOptions): string[] {
  if (spine.length < 2) return [];
  const rng = mulberry32(o.seed ^ 0x2545f491);
  const count = Math.max(1, Math.round(o.count ?? 7));
  const gap = clamp(o.gap ?? 0.35, 0, 0.95);
  const pressure = o.pressure ?? taper;
  const pts = resample(spine, o.samples ?? 32);
  const tans = tangents(pts);
  const out: string[] = [];
  for (let h = 0; h < count; h++) {
    const lane = (h + 0.5) / count - 0.5 + (rng() - 0.5) * 0.15; // -0.5..0.5 across the width
    let d = '';
    let pen = false;
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const w = o.width * clamp(pressure(t), 0, 1);
      const nrm = perp(tans[i]!);
      const p = pts[i]!;
      const q: Pt = [p[0] + nrm[0] * lane * w, p[1] + nrm[1] * lane * w];
      const skip = rng() < gap * (0.6 + 0.8 * t); // drier toward the end
      if (skip) {
        pen = false;
        continue;
      }
      d += pen ? L(q[0], q[1]) : M(q[0], q[1]);
      pen = true;
    }
    if (d.includes('L')) out.push(d);
  }
  return out;
}

/** Filled stroke plus dry hairs in one `<g>` (hairs at `hairWidth` user units). */
export function dryBrush(spine: readonly Pt[], o: BrushOptions & { fill: string; hairs?: number; hairWidth?: number; gap?: number }): string {
  const body = el('path', { d: brushStroke(spine, o), fill: o.fill });
  const hairs = bristles(spine, { width: o.width * 1.15, seed: o.seed, count: o.hairs ?? 6, gap: o.gap, pressure: o.pressure }).map((d) =>
    el('path', { d, fill: 'none', stroke: o.fill, 'stroke-width': o.hairWidth ?? Math.max(0.5, o.width * 0.04), 'stroke-linecap': 'round' }),
  );
  return el('g', undefined, [body, ...hairs]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ink texture                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export interface InkBleedOptions {
  /** Displacement in user units (default 6). */
  scale?: number;
  /** Edge softness (default 0.7). */
  blur?: number;
  /** Turbulence base frequency (default 0.035). */
  frequency?: number;
}

/** Filter def: turbulent edge displacement + a touch of blur, so flat fills read as wet ink on washi. */
export function inkBleed(id: string, seed: number, o: InkBleedOptions = {}): string {
  return filter(id, [
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: fmt(o.frequency ?? 0.035), numOctaves: 3, seed: Math.round(seed) >>> 0, result: 'noise' }),
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: o.scale ?? 6, xChannelSelector: 'R', yChannelSelector: 'G', result: 'disp' }),
    el('feGaussianBlur', { in: 'disp', stdDeviation: Math.max(0, o.blur ?? 0.7), result: 'soft' }),
    el('feComponentTransfer', { in: 'soft' }, el('feFuncA', { type: 'linear', slope: 1.25, intercept: 0 })),
  ]);
}

/**
 * Ink splatter around `(cx, cy)` within radius `r`: `count` droplets, denser
 * and larger near the centre, a few elongated along their fling direction.
 */
export function splatter(cx: number, cy: number, r: number, seed: number, count = 14): string {
  const rng = mulberry32(seed ^ 0x27d4eb2f);
  let d = '';
  for (let i = 0; i < Math.max(0, Math.round(count)); i++) {
    const ang = rng() * TAU;
    const dd = Math.sqrt(rng()) * r;
    const size = Math.max(0.6, (1 - dd / (r || 1)) * r * 0.12 * (0.4 + rng()));
    const [x, y] = polar(cx, cy, dd, ang);
    if (rng() < 0.3) {
      // elongated drop: an ellipse drawn with two arcs, major axis along the fling
      const rx = size * (1.6 + rng());
      const ry = size * 0.7;
      const rot = (ang * 180) / Math.PI;
      const [x0, y0] = polar(x, y, rx, ang);
      const [x1, y1] = polar(x, y, rx, ang + Math.PI);
      d += M(x0, y0) + A(rx, ry, rot, 1, 1, x1, y1) + A(rx, ry, rot, 1, 1, x0, y0) + Z;
    } else {
      d += M(x + size, y) + A(size, size, 0, 1, 1, x - size, y) + A(size, size, 0, 1, 1, x + size, y) + Z;
    }
  }
  return d;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ensō                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface EnsoOptions {
  /** Maximum stroke width (default r × 0.22). */
  width?: number;
  /** Opening angle in radians (default 0.55 ≈ 32°). */
  gap?: number;
  /** Start angle in radians (default −115°, upper left, as a right hand would begin). */
  start?: number;
  /** Radius wobble as a fraction of r (default 0.04). */
  wobble?: number;
  /** Spine samples (default 72). */
  samples?: number;
}

/** The ensō: one circular brush stroke from thick to a flicked end, leaving its gap. Returns a closed `d` path. */
export function enso(cx: number, cy: number, r: number, seed: number, o: EnsoOptions = {}): string {
  const rng = mulberry32(seed);
  const wob = noise1(mulberry32(seed ^ 0x3c6ef372));
  const width = o.width ?? r * 0.22;
  const gap = clamp(o.gap ?? 0.55, 0.05, Math.PI);
  const start = o.start ?? (-115 * Math.PI) / 180 + (rng() - 0.5) * 0.2;
  const sweep = TAU - gap;
  const samples = Math.max(16, Math.round(o.samples ?? 72));
  const wobble = o.wobble ?? 0.04;
  const spine: Pt[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const a = start + t * sweep;
    const rr = r * (1 + wobble * (wob(t * 4) * 2 - 1) + 0.02 * t); // the hand drifts outward slightly
    spine.push(polar(cx, cy, rr, a));
  }
  return brushStroke(spine, { width, pressure: fade, seed: seed ^ 0x1b873593, bristle: 0.22, frequency: 9 });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Seal frame                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SealFrameOptions {
  x: number;
  y: number;
  size: number;
  round: boolean;
  seed: number;
  /** Border thickness (default size × 0.08). */
  stroke?: number;
  /** Edge erosion amplitude as a fraction of size (default 0.012). */
  erode?: number;
  /** Boundary samples per edge/circle (default 96 total). */
  samples?: number;
}

function boundary(cx: number, cy: number, half: number, round: boolean, samples: number, rng: Rng, erode: number, seed: number): Pt[] {
  const n = noise1(mulberry32(seed));
  const out: Pt[] = [];
  const corner = half * 0.12; // slight corner rounding on the square so the frame reads carved, not CAD
  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    let p: Pt;
    if (round) {
      p = polar(cx, cy, half, t * TAU);
    } else {
      // walk the rounded square perimeter
      const side = Math.floor(t * 4);
      const u = t * 4 - side;
      const a = -half + corner;
      const b = half - corner;
      const s = lerp(a, b, u);
      if (side === 0) p = [cx + s, cy - half];
      else if (side === 1) p = [cx + half, cy + s];
      else if (side === 2) p = [cx - s, cy + half];
      else p = [cx - half, cy - s];
    }
    const dir = norm(sub(p, [cx, cy]));
    const e = (n(t * 40 + rng() * 0.001) * 2 - 1) * erode + (n(t * 160 + 7) * 2 - 1) * erode * 0.4;
    out.push([p[0] + dir[0] * e, p[1] + dir[1] * e]);
  }
  return out;
}

/**
 * Hanko frame: outer and inner boundaries with eroded edges as one path.
 * Render with `fill-rule="evenodd"` so the band between them is the frame.
 */
export function sealFrame(o: SealFrameOptions): string {
  const rng = mulberry32(o.seed);
  const half = o.size / 2;
  const cx = o.x + half;
  const cy = o.y + half;
  const stroke = o.stroke ?? o.size * 0.08;
  const erode = (o.erode ?? 0.012) * o.size;
  const samples = Math.max(24, Math.round(o.samples ?? 96));
  const outer = boundary(cx, cy, half, o.round, samples, rng, erode, o.seed ^ 0x85ebca6b);
  const inner = boundary(cx, cy, Math.max(1, half - stroke), o.round, samples, rng, erode * 0.8, o.seed ^ 0xc2b2ae35).reverse();
  return polyPath(outer, true) + polyPath(inner, true);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Writing animation                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DashWriteOptions {
  /** Animation duration in ms. */
  dur: number;
  /** Delay in ms (default 0). */
  delay?: number;
  /** CSS class the keyframes bind to (default `write`). */
  cls?: string;
  /** Easing (default the UI `--ease` curve). */
  ease?: string;
}

/**
 * Attributes and CSS for a stroke that draws itself (`stroke-dasharray` /
 * `stroke-dashoffset` from `len` to 0). Put `css` in one `<style>` once and
 * spread `attrs` onto each path; under reduced motion, callers skip the
 * attrs so the glyph is simply shown.
 */
export function dashWrite(len: number, o: DashWriteOptions): { attrs: Attrs; css: string } {
  const cls = o.cls ?? 'write';
  const l = Math.max(1, len);
  return {
    attrs: {
      class: cls,
      pathLength: l,
      'stroke-dasharray': l,
      'stroke-dashoffset': l,
      style: `animation:${cls}-draw ${Math.max(0, o.dur)}ms ${o.ease ?? 'cubic-bezier(0.2,0.8,0.2,1)'} ${Math.max(0, o.delay ?? 0)}ms forwards`,
    },
    css: `@keyframes ${cls}-draw{to{stroke-dashoffset:0}}`,
  };
}
