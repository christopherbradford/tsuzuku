/**
 * TSUZUKU — kakejiku 'vs-wall' 対戦画面 VS Screen (design 06 §3).
 *
 * A fighting-game intro: the canvas split by a jagged diagonal (top/bottom
 * on the phone), the challenger's panel in neon-c halftone with a sash in
 * the belt colour, the wall's panel as a brick wall tinted neon-m, radial
 * speed lines from the burst centre and a pixel slab "VS" with an extruded
 * drop. Left: your name; right: 壁 (the Plateau Arc's wall, design 02).
 * Palette neon-c / neon-m on sumi; post pass scanlines. Generic arcade
 * idiom only: no characters, logos or franchise designs.
 *
 * The building blocks (`vsLayout`, `speedLines`, `vsSlab`, `brickPattern`,
 * `challengerSide`, `challengerTexts`, `vsCentre`, `vsPlate`, `splitEdge`)
 * are exported for 'wall-broken', which keeps this composition and shatters
 * the wall. On desktop the name is fitted to the free width left of the VS
 * plate (`vsPlate(L0).left`) and 壁 is kept right of it, so neither glyph
 * run ever slides under the slab.
 */
import { mulberry32, uniform } from '../../shared/hash';
import { PALETTE, SUMI, WASHI, alpha, beltColor, darken, mix } from '../color';
import { TAU, pointInPolygon, polar, rays, type Pt } from '../geom';
import { FONTS, fitSize, type TextLayer } from '../jtext';
import { ditherPattern, sprite } from '../pixel';
import { L, M, Z, clipPath, el, g, glowTwin, linearGradient, path, pattern, polygon, polyline, rect, svgDoc, url } from '../svg';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-2';

export const NEON_C = PALETTE.dark['neon-c'];
export const NEON_M = PALETTE.dark['neon-m'];
export const KIN = PALETTE.dark.kin;

const V_ROWS = ['XX.....XX', 'XX.....XX', 'XX.....XX', 'XX.....XX', '.XX...XX.', '.XX...XX.', '..XX.XX..', '..XX.XX..', '...XXX...', '....X....'];
const S_ROWS = ['..XXXXXX.', '.XX....XX', '.XX......', '..XX.....', '...XXXX..', '......XX.', '.......XX', '.XX....XX', '..XXXXXX.', '.........'];
const LETTER_COLS = 9;
const LETTER_ROWS = 10;

export interface VsLayout {
  w: number;
  h: number;
  phone: boolean;
  /** Jagged split from one canvas edge to the other. */
  split: Pt[];
  /** Unit normal of the split pointing into the wall's panel. */
  nrm: Pt;
  /** Challenger panel (left / top) and wall panel (right / bottom). */
  left: Pt[];
  right: Pt[];
  /** Burst centre, where the VS slab sits. */
  cx: number;
  cy: number;
}

/** Seeded split geometry shared by vs-wall and wall-broken. */
export function vsLayout(seed: number, size: WallpaperSize): VsLayout {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed ^ 0x7673);
  const cx = w / 2 + uniform(rng, -0.02, 0.02) * w;
  const cy = h / 2 + uniform(rng, -0.015, 0.015) * h;
  let a: Pt;
  let b: Pt;
  if (!phone) {
    const off = w * uniform(rng, 0.07, 0.11);
    a = [cx + off, 0];
    b = [cx - off, h];
  } else {
    const off = h * uniform(rng, 0.05, 0.08);
    a = [w, cy - off];
    b = [0, cy + off];
  }
  const steps = phone ? 16 : 20;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let nrm: Pt = [-dy / len, dx / len];
  const split: Pt[] = [a];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const jit = (rng() * 2 - 1) * (phone ? 22 : 26);
    split.push([a[0] + dx * t + nrm[0] * jit, a[1] + dy * t + nrm[1] * jit]);
  }
  split.push(b);
  const left: Pt[] = phone ? [[0, 0], [w, 0], ...split] : [[0, 0], ...split, [0, h]];
  const right: Pt[] = phone ? [...split.slice().reverse(), [w, h], [0, h]] : [...split.slice().reverse(), [w, 0], [w, h]];
  const mid: Pt = [(a[0] + b[0]) / 2 + nrm[0] * 40, (a[1] + b[1]) / 2 + nrm[1] * 40];
  if (!pointInPolygon(mid, right)) nrm = [-nrm[0], -nrm[1]];
  return { w, h, phone, split, nrm, left, right, cx, cy };
}

/** Radial speed lines as one path: `count` thin triangles from an inner radius past the canvas edge. */
export function speedLines(seed: number, cx: number, cy: number, w: number, h: number, count: number, o: { inner?: [number, number]; width?: [number, number] } = {}): string {
  const rng = mulberry32(seed ^ 0x5370);
  const R = Math.hypot(w, h) * 0.75;
  const [i0, i1] = o.inner ?? [0.12, 0.3];
  const [w0, w1] = o.width ?? [0.002, 0.011];
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const r1 = R * uniform(rng, i0, i1);
    const half = uniform(rng, w0, w1);
    const p0 = polar(cx, cy, r1, a);
    const p1 = polar(cx, cy, R, a - half);
    const p2 = polar(cx, cy, R, a + half);
    d += M(p0[0], p0[1]) + L(p1[0], p1[1]) + L(p2[0], p2[1]) + Z;
  }
  return d;
}

/** Offset brick `<pattern>` (userSpaceOnUse). */
export function brickPattern(id: string, bw: number, bh: number, brick: string, mortar: string): string {
  const m = 2;
  const row = (x: number, y: number): string[] => [
    rect(x + m, y + m, bw - 2 * m, bh - 2 * m, { fill: brick, rx: 1 }),
    rect(x + m, y + m, bw - 2 * m, Math.max(1, bh * 0.12), { fill: WASHI, opacity: 0.08 }),
  ];
  return pattern(id, bw, bh * 2, [rect(0, 0, bw, bh * 2, { fill: mortar }), ...row(0, 0), ...row(-bw / 2, bh), ...row(bw / 2, bh)]);
}

/** Pixel slab "VS" with an extruded drop, skewed like arcade display type. */
export function vsSlab(cx: number, cy: number, px: number, o: { face: string; side: string; depth?: number; skew?: number }): string {
  const depth = o.depth ?? 3;
  const letterW = LETTER_COLS * px;
  const letterH = LETTER_ROWS * px;
  const gap = px * 1.4;
  const x0 = cx - (letterW * 2 + gap) / 2;
  const y0 = cy - letterH / 2;
  const layer = (dx: number, dy: number, fill: string): string =>
    g({ transform: dx || dy ? `translate(${dx} ${dy})` : undefined }, [
      sprite(V_ROWS, { x: x0, y: y0, px, palette: { X: fill } }),
      sprite(S_ROWS, { x: x0 + letterW + gap, y: y0, px, palette: { X: fill } }),
    ]);
  const parts: string[] = [];
  for (let i = depth; i >= 1; i--) parts.push(layer(i * px * 0.42, i * px * 0.42, i === depth ? darken(o.side, 0.35) : o.side));
  parts.push(layer(0, 0, o.face));
  const skew = o.skew ?? 6;
  return g({ transform: `translate(${cx} ${cy}) skewX(${-skew}) translate(${-cx} ${-cy})` }, parts);
}

export interface VsPlate {
  /** Pixel unit of the slab. */
  px: number;
  /** Skewed plate corners, clockwise from the top-left. */
  corners: [Pt, Pt, Pt, Pt];
  /** Outermost x of the plate on either side (the skew included). */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Geometry of the plate behind the VS slab; texts keep clear of `left`/`right`. */
export function vsPlate(L0: VsLayout): VsPlate {
  const px = L0.phone ? 26 : 22;
  const pw = px * (LETTER_COLS * 2 + 1.4) + px * 4;
  const ph = px * LETTER_ROWS + px * 3.2;
  const sk = ph * 0.14;
  const corners: [Pt, Pt, Pt, Pt] = [
    [L0.cx - pw / 2 + sk, L0.cy - ph / 2],
    [L0.cx + pw / 2 + sk, L0.cy - ph / 2],
    [L0.cx + pw / 2 - sk, L0.cy + ph / 2],
    [L0.cx - pw / 2 - sk, L0.cy + ph / 2],
  ];
  return { px, corners, left: L0.cx - pw / 2 - sk, right: L0.cx + pw / 2 + sk, top: L0.cy - ph / 2, bottom: L0.cy + ph / 2 };
}

/** Burst, plate and slab at the layout centre. */
export function vsCentre(L0: VsLayout, seed: number): string {
  const { px, corners } = vsPlate(L0);
  const r = px * 10;
  return g(undefined, [
    path(rays(L0.cx, L0.cy, r * 0.6, r * 1.4, 24, seed % 7), { fill: WASHI, opacity: 0.32 }),
    path(polyPath(corners), { fill: SUMI, opacity: 0.9, stroke: WASHI, 'stroke-width': 5 }),
    vsSlab(L0.cx, L0.cy, px, { face: KIN, side: darken(KIN, 0.55) }),
  ]);
}

/** Clearance between a glyph run and the plate (desktop). */
const PLATE_GAP = 48;

/** Centre x for the wall glyph on desktop: 0.75 w, pushed right when the plate would touch it. */
export function wallGlyphX(L0: VsLayout, glyphSize: number): number {
  return L0.phone ? L0.w / 2 : Math.max(L0.w * 0.75, vsPlate(L0).right + PLATE_GAP + glyphSize / 2);
}

function polyPath(pts: Pt[]): string {
  let d = M(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) d += L(pts[i]![0], pts[i]![1]);
  return d + Z;
}

/** Glowing jagged edge along the split. */
export function splitEdge(L0: VsLayout, color: string): { defs: string[]; body: string } {
  return {
    defs: [glowTwin('edgeGlow', 14, { opacity: 0.9 })],
    body: g({ filter: url('edgeGlow') }, [polyline(L0.split, { fill: 'none', stroke: color, 'stroke-width': 7, 'stroke-linejoin': 'round' }), polyline(L0.split, { fill: 'none', stroke: WASHI, 'stroke-width': 2.5, 'stroke-linejoin': 'round' })]),
  };
}

/** The challenger's panel: neon-c gradient, halftone, the belt sash. */
export function challengerSide(L0: VsLayout, belt: string): { defs: string[]; body: string } {
  const { w, h, phone, split, nrm } = L0;
  const a = split[0]!;
  const b = split[split.length - 1]!;
  const dir: Pt = [b[0] - a[0], b[1] - a[1]];
  // Sash band parallel to the split, behind the name area.
  const centreDist = phone ? -h * 0.27 : -w * 0.25;
  const sw = phone ? 170 : 150;
  const band = (d: number, t: number): Pt => [a[0] + dir[0] * t + nrm[0] * d, a[1] + dir[1] * t + nrm[1] * d];
  const sash = [band(centreDist - sw / 2, -0.4), band(centreDist - sw / 2, 1.4), band(centreDist + sw / 2, 1.4), band(centreDist + sw / 2, -0.4)];
  return {
    defs: [
      linearGradient('lpanel', [[0, mix(SUMI, NEON_C, 0.5)], [1, mix(SUMI, NEON_C, 0.08)]], phone ? 90 : 0),
      ditherPattern('halftone', phone ? 7 : 6, { n: 4, color: NEON_C, strength: 0.5 }),
      clipPath('clipL', polygon(L0.left)),
    ],
    body: g({ 'clip-path': url('clipL') }, [
      rect(0, 0, w, h, { fill: url('lpanel') }),
      rect(0, 0, w, h, { fill: url('halftone'), opacity: 0.55 }),
      polygon(sash, { fill: belt, opacity: 0.92 }),
      polygon(sash, { fill: 'none', stroke: SUMI, 'stroke-width': 6, opacity: 0.6 }),
    ]),
  };
}

/** Name and caption on the challenger's side (inside the phone safe zone). */
export function challengerTexts(L0: VsLayout, data: WallpaperData, size: WallpaperSize): TextLayer[] {
  const { w, h, phone } = L0;
  const safe = safeRect(size);
  // Desktop: centred in, and fitted to, the free width left of the VS plate.
  const right = phone ? w : vsPlate(L0).left - PLATE_GAP;
  const x = phone ? w / 2 : right / 2;
  // No floor: a name at NAME_MAX_GLYPHS must shrink to fit its box (review round 2).
  const nameSize = fitSize(data.nameKana, phone ? w * 0.86 : right - 2 * PLATE_GAP, phone ? 170 : 190, { max: phone ? 170 : 190 });
  const nameY = phone ? safe.y + 560 : h * 0.57;
  return [
    { text: S.challenger, x, y: nameY - nameSize * 0.95 - 18, size: phone ? 40 : 40, font: FONTS.pixel, fill: NEON_C, anchor: 'middle', letterSpacing: 6, lang: 'ja' },
    { text: data.nameKana, x, y: nameY, size: nameSize, font: FONTS.neon, fill: WASHI, anchor: 'middle', lang: 'ja' },
  ];
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const L0 = vsLayout(seed, size);
  const { w, h, phone, cx, cy } = L0;
  const belt = beltColor(data.belt);
  const left = challengerSide(L0, belt);
  const edge = splitEdge(L0, NEON_M);
  const safe = safeRect(size);

  const defs = [
    ...left.defs,
    ...edge.defs,
    brickPattern('brick', phone ? 96 : 84, phone ? 44 : 38, mix(SUMI, NEON_M, 0.2), mix(SUMI, NEON_M, 0.06)),
    linearGradient('rpanel', [[0, NEON_M, 0.3], [1, NEON_M, 0]], phone ? 270 : 180),
    clipPath('clipR', polygon(L0.right)),
  ];

  const wall = g({ 'clip-path': url('clipR') }, [
    rect(0, 0, w, h, { fill: url('brick') }),
    rect(0, 0, w, h, { fill: url('rpanel') }),
    rect(0, 0, w, h, { fill: alpha(SUMI, 0.25) }),
  ]);

  const body = [
    rect(0, 0, w, h, { fill: SUMI }),
    left.body,
    wall,
    path(speedLines(seed, cx, cy, w, h, phone ? 150 : 170), { fill: WASHI, opacity: 0.13 }),
    path(speedLines(seed ^ 0x99, cx, cy, w, h, 36, { inner: [0.2, 0.4], width: [0.001, 0.004] }), { fill: WASHI, opacity: 0.3 }),
    edge.body,
    vsCentre(L0, seed),
  ];

  const texts: TextLayer[] = [...challengerTexts(L0, data, size)];
  const wallSize = phone ? 320 : 340;
  const wx = wallGlyphX(L0, wallSize);
  const wallY = phone ? safe.y + safe.h - 300 : h * 0.68;
  texts.push({ text: S.wallArc, x: wx, y: wallY - wallSize * 0.95 - 18, size: 40, font: FONTS.pixel, fill: NEON_M, anchor: 'middle', letterSpacing: 6, lang: 'ja' });
  texts.push({ text: S.wall, x: wx, y: wallY, size: wallSize, font: FONTS.neon, fill: WASHI, anchor: 'middle', lang: 'ja' });

  const svg = svgDoc({ w, h, bg: SUMI, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'scanlines' };
}

export const spec: WallpaperSpec = { id: 'vs-wall', compose };
