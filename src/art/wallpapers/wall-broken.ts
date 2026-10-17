/**
 * TSUZUKU — kakejiku 'wall-broken' 壁を越えて Beyond the Wall (design 06 §3).
 *
 * The VS composition of 'vs-wall' with the wall shattered: the wall panel
 * is Voronoi-shattered (`geom.shatter`) into one fragment per grammar point
 * mastered during the Plateau Arc (`arcGrammar`, 10–40 pieces; Brown
 * grammar as a fallback), each flung outward from a burst point behind
 * the wall, tilted and shaded, carrying its pattern as a pixel-font
 * TextLayer. Gold light pours through the gap: a radial glow, blurred
 * shafts, flying dust; the split edge glows kin instead of magenta and 越
 * stands where 壁 stood. Palette as vs-wall + kin; post pass scanlines.
 */
import { mulberry32, uniform } from '../../shared/hash';
import { SUMI, WASHI, alpha, beltColor, darken, mix } from '../color';
import { bbox, centroid, clamp, polygonArea, shatter, type Pt } from '../geom';
import { FONTS, fitSize, inSafeZone, type TextLayer } from '../jtext';
import { L, M, Z, blur, clipPath, el, g, path, polygon, radialGradient, rect, svgDoc, url } from '../svg';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-2';
import { KIN, NEON_M, brickPattern, challengerSide, challengerTexts, speedLines, splitEdge, vsCentre, vsLayout } from './vs-wall';

export const MIN_PIECES = 10;
export const MAX_PIECES = 40;

interface Fragment {
  cell: Pt[];
  c: Pt;
  dx: number;
  dy: number;
  rot: number;
  sc: number;
  /** 1 at the burst, 0 far away. */
  k: number;
  area: number;
}

function polyD(pts: readonly Pt[]): string {
  let d = M(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) d += L(pts[i]![0], pts[i]![1]);
  return d + Z;
}

/** Shatter the wall panel and fling the pieces away from `burst` (seeded, closer pieces fly further and tilt more). */
export function fragments(seed: number, wall: readonly Pt[], pieces: number, burst: Pt, w: number, h: number, phone: boolean): Fragment[] {
  const rng = mulberry32(seed ^ 0x6272);
  const cells = shatter(seed ^ 0x3c, wall, clamp(Math.floor(pieces), MIN_PIECES, MAX_PIECES));
  const maxD = Math.hypot(w, h) * 0.55;
  return cells.map((cell) => {
    const c = centroid(cell);
    const d = Math.hypot(c[0] - burst[0], c[1] - burst[1]);
    const k = Math.max(0, 1 - d / maxD);
    const ang = Math.atan2(c[1] - burst[1], c[0] - burst[0]);
    const fly = k * k * (phone ? 150 : 170) + 16 + rng() * 12;
    return {
      cell,
      c,
      dx: Math.cos(ang) * fly,
      dy: Math.sin(ang) * fly,
      rot: (rng() * 2 - 1) * (5 + 24 * k),
      sc: 0.92 - 0.1 * k,
      k,
      area: Math.abs(polygonArea(cell)),
    };
  });
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const L0 = vsLayout(seed, size);
  const { w, h, phone, cx, cy } = L0;
  const rng = mulberry32(seed ^ 0x4c69);
  const belt = beltColor(data.belt);
  const left = challengerSide(L0, belt);
  const edge = splitEdge(L0, KIN);
  const safe = safeRect(size);
  const labels = data.arcGrammar.length > 0 ? data.arcGrammar : data.grammarBrown;
  const burst: Pt = [cx + L0.nrm[0] * (phone ? h * 0.13 : w * 0.13), cy + L0.nrm[1] * (phone ? h * 0.13 : w * 0.13)];
  const frags = fragments(seed, L0.right, labels.length, burst, w, h, phone);

  const defs = [
    ...left.defs,
    ...edge.defs,
    brickPattern('brick', phone ? 96 : 84, phone ? 44 : 38, mix(SUMI, NEON_M, 0.2), mix(SUMI, NEON_M, 0.06)),
    radialGradient('light', [[0, WASHI], [0.18, KIN], [0.55, mix(KIN, SUMI, 0.55)], [1, mix(SUMI, KIN, 0.08)]], { cx: burst[0] / w, cy: burst[1] / h, r: 0.75 }),
    clipPath('clipR', polygon(L0.right)),
    blur('shaft', 10),
    blur('dustBlur', 2),
  ];

  // Light behind the wall: glow, blurred shafts, a brighter core.
  const light = g({ 'clip-path': url('clipR') }, [
    rect(0, 0, w, h, { fill: url('light') }),
    path(speedLines(seed ^ 0x11, burst[0], burst[1], w, h, 16, { inner: [0, 0.02], width: [0.015, 0.05] }), { fill: KIN, opacity: 0.4, filter: url('shaft') }),
    path(speedLines(seed ^ 0x12, burst[0], burst[1], w, h, 10, { inner: [0, 0.01], width: [0.004, 0.012] }), { fill: WASHI, opacity: 0.45 }),
  ]);

  // Fragments: shaded underside, brick face, kin rim near the burst.
  const fragMarkup: string[] = [];
  for (const f of frags) {
    const tf = `translate(${f.dx.toFixed(2)} ${f.dy.toFixed(2)}) rotate(${f.rot.toFixed(2)} ${f.c[0].toFixed(2)} ${f.c[1].toFixed(2)}) translate(${f.c[0].toFixed(2)} ${f.c[1].toFixed(2)}) scale(${f.sc.toFixed(3)}) translate(${(-f.c[0]).toFixed(2)} ${(-f.c[1]).toFixed(2)})`;
    const d = polyD(f.cell);
    fragMarkup.push(
      g({ transform: tf }, [
        path(d, { fill: darken(mix(SUMI, NEON_M, 0.15), 0.4), transform: 'translate(7 9)' }),
        path(d, { fill: url('brick'), stroke: SUMI, 'stroke-width': 3, 'stroke-linejoin': 'round' }),
        f.k > 0.25 ? path(d, { fill: 'none', stroke: KIN, 'stroke-width': 2, opacity: f.k * 0.9 }) : '',
      ]),
    );
  }

  // Dust and sparks flying from the burst.
  const dust: string[] = [];
  const nDust = phone ? 70 : 60;
  for (let i = 0; i < nDust; i++) {
    const ang = uniform(rng, 0, Math.PI * 2);
    const dist = uniform(rng, 0.05, 0.6) * Math.hypot(w, h) * 0.5;
    const x = burst[0] + Math.cos(ang) * dist;
    const y = burst[1] + Math.sin(ang) * dist;
    const s = uniform(rng, 3, 12);
    dust.push(rect(x, y, s, s, { fill: rng() < 0.6 ? KIN : WASHI, opacity: uniform(rng, 0.3, 0.9), transform: `rotate(${(rng() * 90).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` }));
  }

  const body = [
    rect(0, 0, w, h, { fill: SUMI }),
    left.body,
    light,
    g({ 'clip-path': url('clipR') }, [rect(0, 0, w, h, { fill: alpha(SUMI, 0.1) })]),
    g(undefined, fragMarkup),
    g({ filter: url('dustBlur') }, dust),
    path(speedLines(seed, cx, cy, w, h, phone ? 140 : 160), { fill: WASHI, opacity: 0.12 }),
    path(speedLines(seed ^ 0x99, cx, cy, w, h, 30, { inner: [0.2, 0.4], width: [0.001, 0.004] }), { fill: KIN, opacity: 0.35 }),
    edge.body,
    vsCentre(L0, seed),
  ];

  // Texts: challenger, 越 with its caption, and the grammar patterns on the fragments (largest pieces first).
  const texts: TextLayer[] = [...challengerTexts(L0, data, size)];
  const gx = phone ? w / 2 : w * 0.75;
  const gSize = phone ? 300 : 320;
  const gy = phone ? safe.y + safe.h - 300 : h * 0.68;
  texts.push({ text: S.beyondTitle, x: gx, y: gy - gSize * 0.95 - 18, size: 40, font: FONTS.pixel, fill: KIN, anchor: 'middle', letterSpacing: 6, lang: 'ja' });
  texts.push({ text: S.beyond, x: gx, y: gy, size: gSize, font: FONTS.neon, fill: WASHI, anchor: 'middle', lang: 'ja' });
  // Keep labels off the VS slab and off the 越 block (caption + glyph).
  const slabR = phone ? 330 : 300;
  const blocked = (x: number, y: number): boolean =>
    Math.hypot(x - cx, y - cy) < slabR || (Math.abs(x - gx) < gSize * 0.62 && y > gy - gSize * 1.15 && y < gy + gSize * 0.12);
  const ordered = frags.map((f, i) => ({ f, i })).sort((a, b) => b.f.area - a.f.area || a.i - b.i);
  let li = 0;
  for (const { f } of ordered) {
    if (li >= labels.length) break;
    const cxT = f.c[0] + f.dx;
    const cyT = f.c[1] + f.dy;
    if (blocked(cxT, cyT)) continue;
    const b = bbox(f.cell);
    const label = labels[li]!;
    const sz = fitSize(label, b.w * 0.72 * f.sc, Math.min(b.h * 0.45 * f.sc, 44), { min: 10, max: 44 });
    if (sz < 17) continue;
    const layer: TextLayer = { text: label, x: cxT, y: cyT + sz * 0.35, size: sz, font: FONTS.pixel, fill: WASHI, anchor: 'middle', rotate: f.rot, opacity: 0.92, lang: 'ja' };
    if (!inSafeZone(layer, size)) continue;
    texts.push(layer);
    li++;
  }

  const svg = svgDoc({ w, h, bg: SUMI, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'scanlines' };
}

export const spec: WallpaperSpec = { id: 'wall-broken', compose };
