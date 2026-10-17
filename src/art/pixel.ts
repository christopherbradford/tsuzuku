/**
 * TSUZUKU — arcade pixel helpers and post effects (design 01 §4.1 "90s arcade").
 *
 *  scanlines / scanlineLayer   CRT line pattern def + the rect that uses it
 *  bayer / bayerThresholds     ordered-dither matrices (2, 4, 8)
 *  ditherPattern               a dot-screen `<pattern>` driven by the Bayer matrix
 *  chromatic                   R/B channel offset filter (CRT fringing)
 *  grainFilter                 seeded film grain overlay filter
 *  crtBezel / crtScreenClip    cabinet bezel shapes and the rounded screen clip
 *  vignette                    radial darkening gradient def
 *  sprite                      pixel art from string rows (`.` = transparent)
 *  monoLayout / pixelText      DotGothic16-style monospaced grid text
 *  postLayer                   the SVG-side post pass used by the wallpapers
 *
 * Everything returns markup or data; nothing touches the DOM.
 */
import { circle, el, fmt, filter, pattern, radialGradient, rect, roundedRectPath, clipPath as svgClip, text as svgText, url, type Attrs } from './svg';

export type PostPass = 'none' | 'dither' | 'scanlines' | 'grain';
export const POST_PASSES: readonly PostPass[] = ['none', 'dither', 'scanlines', 'grain'];

/* ────────────────────────────────────────────────────────────────────────── */
/* Scanlines                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** `<pattern>`: one dark line every `period` px at `opacity` (line thickness defaults to a third of the period). */
export function scanlines(id: string, period: number, opacity: number, o: { color?: string; thickness?: number } = {}): string {
  const p = Math.max(1, period);
  const t = Math.max(0.25, Math.min(p, o.thickness ?? p / 3));
  return pattern(id, 1, p, rect(0, p - t, 1, t, { fill: o.color ?? '#000', 'fill-opacity': Math.max(0, Math.min(1, opacity)) }));
}

/** Full-canvas rect filled with a `scanlines` pattern. */
export function scanlineLayer(id: string, w: number, h: number, a?: Attrs): string {
  return rect(0, 0, w, h, { fill: url(id), 'pointer-events': 'none', ...a });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Dither                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Bayer matrix of integers 0 … n²−1 (recursive construction). */
export function bayer(n: 2 | 4 | 8): number[][] {
  let m: number[][] = [
    [0, 2],
    [3, 1],
  ];
  while (m.length < n) {
    const k = m.length;
    const next: number[][] = Array.from({ length: k * 2 }, () => new Array<number>(k * 2).fill(0));
    for (let y = 0; y < k; y++) {
      for (let x = 0; x < k; x++) {
        const v = m[y]![x]! * 4;
        next[y]![x] = v;
        next[y]![x + k] = v + 2;
        next[y + k]![x] = v + 3;
        next[y + k]![x + k] = v + 1;
      }
    }
    m = next;
  }
  return m;
}

/** Normalised thresholds `(v + 0.5) / n²` in (0, 1). */
export function bayerThresholds(n: 2 | 4 | 8): number[][] {
  const m = bayer(n);
  const d = n * n;
  return m.map((row) => row.map((v) => (v + 0.5) / d));
}

/**
 * Dot-screen `<pattern>`: an n×n grid of `cell`-px squares whose opacity
 * follows the Bayer thresholds, so flat colors underneath pick up an
 * ordered-dither texture. `strength` scales the opacity (default 0.18).
 */
export function ditherPattern(id: string, cell: number, o: { n?: 4 | 8; color?: string; strength?: number } = {}): string {
  const n = o.n ?? 4;
  const th = bayerThresholds(n);
  const c = Math.max(0.5, cell);
  const k = Math.max(0, Math.min(1, o.strength ?? 0.18));
  const cells: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const op = th[y]![x]! * k;
      if (op < 0.005) continue;
      cells.push(rect(x * c, y * c, c, c, { fill: o.color ?? '#000', 'fill-opacity': Math.round(op * 1000) / 1000 }));
    }
  }
  return pattern(id, n * c, n * c, cells);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Chromatic offset, grain, vignette                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/** Filter: red shifted `+px`, blue shifted `−px`, green in place, recombined additively. */
export function chromatic(id: string, px: number): string {
  const d = Math.max(0, px);
  return filter(id, [
    el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'r' }),
    el('feOffset', { in: 'r', dx: d, dy: 0, result: 'r2' }),
    el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'g' }),
    el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'b' }),
    el('feOffset', { in: 'b', dx: -d, dy: 0, result: 'b2' }),
    el('feComposite', { in: 'r2', in2: 'g', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'rg' }),
    el('feComposite', { in: 'rg', in2: 'b2', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0 }),
  ]);
}

/** Filter producing a grey grain field (apply to a full-canvas rect at low opacity). */
export function grainFilter(id: string, o: { seed: number; baseFrequency?: number; octaves?: number }): string {
  return filter(id, [
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: fmt(o.baseFrequency ?? 0.9), numOctaves: Math.max(1, o.octaves ?? 2), seed: Math.round(o.seed) >>> 0, stitchTiles: 'stitch', result: 'n' }),
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 0' }),
  ]);
}

/** Radial gradient def for CRT edge darkening: transparent centre → `color` at the edge. */
export function vignette(id: string, o: { color?: string; strength?: number } = {}): string {
  const c = o.color ?? '#000';
  const s = Math.max(0, Math.min(1, o.strength ?? 0.55));
  return radialGradient(
    id,
    [
      [0, c, 0],
      [0.6, c, 0],
      [1, c, s],
    ],
    { cx: 0.5, cy: 0.5, r: 0.75 },
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CRT shapes                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BezelOptions {
  /** Bezel thickness (default 4 % of the shorter side). */
  inset?: number;
  /** Outer corner radius (default 3 % of the shorter side). */
  radius?: number;
  fill?: string;
  highlight?: string;
}

/** Rounded screen clip (`clipPath` def) matching `crtBezel`'s inner opening. */
export function crtScreenClip(id: string, w: number, h: number, o: BezelOptions = {}): string {
  const s = Math.min(w, h);
  const inset = o.inset ?? s * 0.04;
  const r = (o.radius ?? s * 0.03) * 1.6;
  return svgClip(id, el('path', { d: roundedRectPath(inset, inset, w - 2 * inset, h - 2 * inset, r) }));
}

/** Cabinet bezel: outer rounded rect minus the rounded screen opening (evenodd), with a thin top highlight. */
export function crtBezel(w: number, h: number, o: BezelOptions = {}): string {
  const s = Math.min(w, h);
  const inset = o.inset ?? s * 0.04;
  const r = o.radius ?? s * 0.03;
  const outer = roundedRectPath(0, 0, w, h, r);
  const inner = roundedRectPath(inset, inset, w - 2 * inset, h - 2 * inset, r * 1.6);
  return el('g', undefined, [
    el('path', { d: outer + inner, 'fill-rule': 'evenodd', fill: o.fill ?? '#15151D' }),
    el('path', {
      d: roundedRectPath(inset * 0.35, inset * 0.35, w - inset * 0.7, inset * 0.3, inset * 0.15),
      fill: o.highlight ?? '#F4EDE0',
      'fill-opacity': 0.08,
    }),
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sprites and pixel text                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SpriteOptions {
  x: number;
  y: number;
  /** Size of one pixel in user units. */
  px: number;
  /** Character → fill; `.` and space are always transparent. */
  palette: Record<string, string>;
  /** Mirror horizontally. */
  flip?: boolean;
}

/** Pixel art from string rows; horizontal runs of one color merge into one rect. */
export function sprite(rows: readonly string[], o: SpriteOptions): string {
  const out: string[] = [];
  const px = Math.max(0.01, o.px);
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (let y = 0; y < rows.length; y++) {
    const row = o.flip ? rows[y]!.padEnd(width, '.').split('').reverse().join('') : rows[y]!;
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      const color = ch === '.' || ch === ' ' ? undefined : o.palette[ch];
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      if (color) out.push(rect(o.x + x * px, o.y + y * px, run * px, px, { fill: color }));
      x += run;
    }
  }
  return el('g', { 'shape-rendering': 'crispEdges' }, out);
}

export interface MonoGlyph {
  ch: string;
  x: number;
  y: number;
}

/** Monospaced layout: full-width cells for CJK/kana, half-width for ASCII (DotGothic16 proportions). */
export function monoLayout(text: string, x: number, y: number, size: number, o: { anchor?: 'start' | 'middle' | 'end'; gap?: number } = {}): MonoGlyph[] {
  const chars = Array.from(text);
  const gap = o.gap ?? 0;
  const widths = chars.map((ch) => (/[ -~]/.test(ch) ? size * 0.5 : size) + gap);
  const total = widths.reduce((a, b) => a + b, 0) - (chars.length ? gap : 0);
  let cursor = o.anchor === 'middle' ? x - total / 2 : o.anchor === 'end' ? x - total : x;
  const out: MonoGlyph[] = [];
  for (let i = 0; i < chars.length; i++) {
    out.push({ ch: chars[i]!, x: cursor + (widths[i]! - gap) / 2, y });
    cursor += widths[i]!;
  }
  return out;
}

/** Grid-aligned pixel text: one centred `<text>` per glyph inside a `<g>` carrying font and fill. */
export function pixelText(text: string, o: { x: number; y: number; size: number; fill: string; font: string; anchor?: 'start' | 'middle' | 'end'; attrs?: Attrs }): string {
  const glyphs = monoLayout(text, o.x, o.y, o.size, { anchor: o.anchor });
  return el(
    'g',
    { 'font-family': o.font, 'font-size': o.size, fill: o.fill, 'text-anchor': 'middle', lang: 'ja', ...o.attrs },
    glyphs.map((gl) => svgText(gl.ch, { x: gl.x, y: gl.y })),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Post pass                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PostLayerOptions {
  /** Id prefix for the defs (default `post`). */
  id?: string;
  w: number;
  h: number;
  seed: number;
  /** 0–1 effect strength (defaults: dither 0.18, scanlines 0.28, grain 0.14). */
  strength?: number;
}

/**
 * The SVG-side post pass appended on top of a composed scene: `defs` to add
 * and the `body` layer. `none` yields empty strings. The PNG exporter has a
 * pixel-level twin for the same names.
 */
export function postLayer(kind: PostPass, o: PostLayerOptions): { defs: string[]; body: string } {
  const id = o.id ?? 'post';
  switch (kind) {
    case 'none':
      return { defs: [], body: '' };
    case 'scanlines': {
      const period = Math.max(2, Math.round(o.h / 360));
      return { defs: [scanlines(`${id}-scan`, period, o.strength ?? 0.28)], body: scanlineLayer(`${id}-scan`, o.w, o.h) };
    }
    case 'dither': {
      const cell = Math.max(1, Math.round(o.h / 540));
      return {
        defs: [ditherPattern(`${id}-dither`, cell, { n: 4, strength: o.strength ?? 0.18 })],
        body: rect(0, 0, o.w, o.h, { fill: url(`${id}-dither`), 'pointer-events': 'none' }),
      };
    }
    case 'grain':
      return {
        defs: [grainFilter(`${id}-grain`, { seed: o.seed })],
        body: rect(0, 0, o.w, o.h, { filter: url(`${id}-grain`), opacity: o.strength ?? 0.14, 'pointer-events': 'none' }),
      };
  }
}

/** A single pixel-dot marker (cursor, hi-score caret). */
export function dot(cx: number, cy: number, r: number, fill: string): string {
  return circle(cx, cy, r, { fill, 'shape-rendering': 'crispEdges' });
}
