/**
 * TSUZUKU — kakejiku 'road-continues' (無限の道 The Road Continues, design 06 §3).
 *
 * A straight road in one-point perspective running into a sunrise, its
 * centre dashes and the telegraph poles beside it receding geometrically to
 * the vanishing point, wires sagging between the poles, lens clouds lit from
 * below. Across the sky, the brush つづく. In the foreground a wooden signpost
 * names the traveller and carries the streak and total days on two arrow
 * boards pointing down the road. The road has no end on purpose.
 * Palette: sakura → kin sunrise. Unlock: 十段.
 *
 * Seed → vanishing point, clouds, light rays, pole spacing, birds, field
 * bands, signpost tilt. Text is `TextLayer`s only.
 */
import { chance, mulberry32, range, uniform } from '../../shared/hash';
import { INK, PALETTE, SUMI, WASHI, mix } from '../color';
import { catenary, rays, type Pt } from '../geom';
import { FONTS, fitSize, type TextLayer } from '../jtext';
import { circle, el, ellipse, fmt, line, linearGradient, path, polygon, polyline, radialGradient, rect, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES, fill } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-4';

const ID = 'road-continues';
const SAKURA = PALETTE.light.sakura;
const SAKURA_LIGHT = PALETTE.dark.sakura;
const KIN = PALETTE.dark.kin;
const KIN_PALE = '#F2D54A';
const PLUM_INK = '#2A1F2E';
const WOOD = '#4A3324';

export const spec: WallpaperSpec = {
  id: ID,
  compose(seed, data, size) {
    return compose(seed, data, size);
  },
};

/* ────────────────────────────────────────────────────────────────────────── */

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const safe = safeRect(size, Math.round(Math.min(w, h) * 0.06));
  const rng = mulberry32(seed);
  const horizon = h * (phone ? 0.55 : 0.58);
  const vpX = w * 0.5 + w * uniform(rng, -0.07, 0.07);

  /* perspective: a ground point with lateral offset `u` (near-plane units) at depth z ≥ 1 */
  const depth = h - horizon;
  const sx = (u: number, z: number): number => vpX + u / z;
  const sy = (z: number): number => horizon + depth / z;

  const defs: string[] = [
    linearGradient('rc-sky', [[0, '#B86A8A'], [0.38, mix(SAKURA, SAKURA_LIGHT, 0.6)], [0.72, '#F3C98B'], [1, KIN_PALE]], 90),
    radialGradient('rc-sun', [[0, '#FFF6D6', 0.95], [0.25, KIN_PALE, 0.5], [0.6, KIN, 0.12], [1, KIN, 0]]),
    linearGradient('rc-ground', [[0, '#8A6478'], [0.25, '#55405A'], [1, '#2A2030']], 90),
    linearGradient('rc-road', [[0, '#5A4F5E'], [1, '#2F2836']], 90),
    linearGradient('rc-post', [[0, WOOD], [0.6, '#6A4A33'], [1, '#3A2619']], 0),
  ];
  const body: string[] = [rect(0, 0, w, h, { fill: url('rc-sky') })];

  /* ── sun and rays ─────────────────────────────────────────────────────── */
  const sunR = Math.min(w, h) * (phone ? 0.13 : 0.09);
  const sunY = horizon - sunR * uniform(rng, 0.45, 0.7);
  body.push(circle(vpX, sunY, sunR * 3.6, { fill: url('rc-sun') }));
  body.push(path(rays(vpX, sunY, sunR * 1.1, sunR * uniform(rng, 5, 8), range(rng, 7, 11), uniform(rng, 0, Math.PI)), { fill: WASHI, opacity: 0.07 }));
  body.push(circle(vpX, sunY, sunR, { fill: '#FFF3C4' }));

  /* ── clouds ───────────────────────────────────────────────────────────── */
  const clouds: string[] = [];
  const cloudN = range(rng, 5, 8);
  for (let i = 0; i < cloudN; i++) {
    // most clouds lie low where the sunrise lights them; a few drift high, clear of the つづく band
    const cy = chance(rng, 0.7) ? uniform(rng, h * 0.37, horizon - h * 0.05) : h * uniform(rng, 0.04, 0.11);
    const near = cy / horizon; // lower clouds are flatter and longer
    const rx = w * uniform(rng, 0.07, 0.2) * (0.7 + near);
    const ry = h * uniform(rng, 0.006, 0.016) * (1.3 - near * 0.6);
    const cx = uniform(rng, rx, w - rx);
    clouds.push(ellipse(cx, cy, rx, ry, { fill: mix(SAKURA_LIGHT, WASHI, 0.55), opacity: uniform(rng, 0.55, 0.85) }));
    clouds.push(ellipse(cx + rx * 0.1, cy + ry * 0.7, rx * 0.8, ry * 0.5, { fill: KIN_PALE, opacity: 0.45 }));
  }
  body.push(el('g', undefined, clouds));

  /* ── birds ────────────────────────────────────────────────────────────── */
  const birds: string[] = [];
  const birdN = range(rng, 3, 7);
  const bx = vpX + w * uniform(rng, -0.3, 0.3);
  const by = h * uniform(rng, 0.14, 0.3);
  for (let i = 0; i < birdN; i++) {
    const x = bx + i * w * 0.022 + uniform(rng, -10, 10);
    const y = by + i * h * 0.014 * (chance(rng, 0.5) ? 1 : -1) + uniform(rng, -8, 8);
    const s = uniform(rng, 5, 10);
    birds.push(polyline([[x - s, y], [x - s * 0.45, y - s * 0.5], [x, y], [x + s * 0.45, y - s * 0.5], [x + s, y]], { fill: 'none', stroke: PLUM_INK, 'stroke-width': 1.5, opacity: 0.75 }));
  }
  body.push(el('g', undefined, birds));

  /* ── ground and fields ────────────────────────────────────────────────── */
  body.push(rect(0, horizon, w, h - horizon, { fill: url('rc-ground') }));
  const bands: string[] = [];
  let zb = 1.25;
  while (zb < 14) {
    const z2 = zb * uniform(rng, 1.25, 1.5);
    const tone = chance(rng, 0.5) ? '#4E6A3C' : '#6A4A5A';
    bands.push(rect(0, sy(z2), w, sy(zb) - sy(z2), { fill: tone, opacity: uniform(rng, 0.12, 0.26) }));
    zb = z2 * uniform(rng, 1.05, 1.25);
  }
  body.push(el('g', undefined, bands));

  /* ── road ─────────────────────────────────────────────────────────────── */
  const half = w * 0.44;
  body.push(polygon([[sx(-half, 1), h], [sx(half, 1), h], [vpX + 2, horizon], [vpX - 2, horizon]], { fill: url('rc-road') }));
  body.push(line(sx(-half, 1), h, vpX, horizon, { stroke: WASHI, 'stroke-width': 3, opacity: 0.4 }));
  body.push(line(sx(half, 1), h, vpX, horizon, { stroke: WASHI, 'stroke-width': 3, opacity: 0.4 }));
  const dashes: string[] = [];
  const dashW = w * 0.012;
  let z = 1.02;
  while (sy(z) - horizon > 1.5) {
    const z2 = z * 1.06;
    dashes.push(polygon([[sx(-dashW, z), sy(z)], [sx(dashW, z), sy(z)], [sx(dashW, z2), sy(z2)], [sx(-dashW, z2), sy(z2)]], { fill: WASHI, opacity: 0.85 }));
    z = z2 * 1.14;
  }
  body.push(el('g', undefined, dashes));

  /* ── telegraph poles and wires ────────────────────────────────────────── */
  const poles: string[] = [];
  const tops: Pt[] = [];
  const poleU = -half * 1.16;
  const poleH = h * 0.62;
  const arm = w * 0.055;
  const ratio = uniform(rng, 1.22, 1.3);
  let zp = 1.12;
  while (poleH / zp > 6) {
    const px = sx(poleU, zp);
    const base = sy(zp);
    const top = base - poleH / zp;
    const pw = Math.max(1.5, (w * 0.011) / zp);
    poles.push(rect(px - pw / 2, top, pw, base - top, { fill: PLUM_INK }));
    poles.push(rect(px - arm / zp / 2, top + (poleH / zp) * 0.06, arm / zp, Math.max(1, pw * 0.5), { fill: PLUM_INK }));
    poles.push(rect(px - (arm / zp) * 0.4, top + (poleH / zp) * 0.14, arm / zp * 0.8, Math.max(1, pw * 0.4), { fill: PLUM_INK }));
    tops.push([px, top + (poleH / zp) * 0.06]);
    zp *= ratio;
  }
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i]!;
    const b = tops[i + 1]!;
    const span = Math.abs(b[0] - a[0]);
    const pts = catenary(a[0], b[0], a[1], span * 0.09, 14).map(([x, y], k, arr) => [x, y + ((b[1] - a[1]) * k) / (arr.length - 1)] as Pt);
    poles.push(polyline(pts, { fill: 'none', stroke: PLUM_INK, 'stroke-width': Math.max(0.8, 2.2 / (i + 1)), opacity: 0.8 }));
  }
  body.push(el('g', undefined, poles));
  // guard posts on the far shoulder
  const guards: string[] = [];
  let zg = 1.3;
  while (h * 0.06 / zg > 3) {
    const gx = sx(half * 1.06, zg);
    const gy = sy(zg);
    guards.push(rect(gx - 3 / zg, gy - (h * 0.05) / zg, 6 / zg, (h * 0.05) / zg, { fill: PLUM_INK, opacity: 0.75 }));
    zg *= 1.3;
  }
  body.push(el('g', undefined, guards));

  /* ── signpost ─────────────────────────────────────────────────────────── */
  const texts: TextLayer[] = [];
  const postX = w * (phone ? 0.74 : 0.8);
  const postBottom = h * (phone ? 0.84 : 0.97);
  const postTop = phone ? safe.y + safe.h * 0.56 : h * 0.44;
  const postW = w * (phone ? 0.03 : 0.013);
  const tilt = uniform(rng, -1.5, 1.5);
  const bwid = w * (phone ? 0.5 : 0.17);
  const bhgt = h * (phone ? 0.04 : 0.056);
  const gap = bhgt * 0.35;
  const post: string[] = [];
  post.push(rect(postX - postW / 2, postTop, postW, postBottom - postTop, { fill: url('rc-post') }));
  post.push(polygon([[postX - postW * 0.8, postTop], [postX + postW * 0.8, postTop], [postX, postTop - postW * 1.2]], { fill: WOOD }));
  const boards = [data.nameKana, fill(S.roadContinues.streak, { n: data.streak }), fill(S.roadContinues.total, { n: data.totalDays })];
  boards.forEach((text, i) => {
    const y = postTop + postW * 1.2 + i * (bhgt + gap);
    const tip = bhgt * 0.5;
    const x0 = postX - bwid * 0.78;
    const x1 = postX + bwid * 0.22;
    post.push(polygon([[x0 + tip + 4, y + 5], [x1 + 4, y + 5], [x1 + 4, y + bhgt + 5], [x0 + tip + 4, y + bhgt + 5], [x0 + 4, y + bhgt / 2 + 5]], { fill: SUMI, opacity: 0.25 }));
    post.push(polygon([[x0 + tip, y], [x1, y], [x1, y + bhgt], [x0 + tip, y + bhgt], [x0, y + bhgt / 2]], { fill: i === 0 ? '#EADFCB' : WASHI, stroke: PLUM_INK, 'stroke-width': 2 }));
    post.push(circle(postX, y + bhgt * 0.5, bhgt * 0.05, { fill: INK, opacity: 0.6 }));
    const boxW = (x1 - x0 - tip) * 0.86;
    const size = fitSize(text, boxW, bhgt * 0.66, { max: bhgt * 0.62 });
    texts.push({ text, x: (x0 + tip + x1) / 2, y: y + bhgt * 0.5 + size * 0.34, size, font: FONTS.mincho, fill: INK, anchor: 'middle', weight: i === 0 ? 700 : 500, lang: 'ja' });
  });
  body.push(el('g', { transform: `rotate(${fmt(tilt)} ${fmt(postX)} ${fmt(postBottom)})` }, post));
  // the texts share the post's small tilt about its foot
  for (const t of texts) t.rotate = tilt;
  // (rotation is tiny; bounds are checked unrotated, so keep the boards clear of the safe-zone edges)

  /* ── つづく ───────────────────────────────────────────────────────────── */
  const mainSize = phone ? fitSize(S.roadContinues.tsuzuku, w * 0.78, h * 0.16, { max: 300 }) : fitSize(S.roadContinues.tsuzuku, w * 0.5, h * 0.22, { max: h * 0.2 });
  const mainY = phone ? Math.max(safe.y + mainSize * 0.9, h * 0.3) : h * 0.3;
  texts.push({ text: S.roadContinues.tsuzuku, x: w * 0.5, y: mainY, size: mainSize, font: FONTS.brush, fill: PLUM_INK, anchor: 'middle', letterSpacing: mainSize * 0.04, lang: 'ja' });

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body });
  return { svg, texts, post: 'none' };
}
