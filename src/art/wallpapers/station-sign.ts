/**
 * TSUZUKU — kakejiku 'station-sign' (駅名標 Station Sign, design 06 §3).
 *
 * A generic platform sign at dusk. The sky runs kon → sakura → warm, thin
 * clouds drift, overhead-wire masts and their catenaries stand beyond the
 * tracks, a far platform canopy and a hill of window lights close the
 * distance. On our platform: the tactile line, a bench, one traveller, and
 * the sign itself — a washi plate on two posts, lit by its lamp hood. The
 * plate names the learner in katakana (the station is you), a thin stripe in
 * the belt colour, the current station in small type, and the previous and
 * next Tōkaidō stations in the kon band below. No operator's livery.
 * Palette: washi plate, kon, sakura sky. Unlock: any Gatekeeper.
 *
 * Seed → clouds, stars, hill ridge, window lights, mast spacing, birds.
 */
import { mulberry32, range, uniform } from '../../shared/hash';
import { NIHONBASHI, SANJO_OHASHI, STATIONS } from '../../content/types';
import { INK, INK_WASH, PALETTE, SUMI, WARM, WASHI, WASHI_LIGHT, beltColor, mix } from '../color';
import { catenary, type Pt } from '../geom';
import { FONTS, fitSize, katakanaName, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { blur, circle, el, ellipse, line, linearGradient, polygon, polyline, radialGradient, rect, roundedRectPath, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-4';

const ID = 'station-sign';
const KON = PALETTE.light.kon;
const AI = PALETTE.light.ai;
const SAKURA = PALETTE.light.sakura;
const SAKURA_LIGHT = PALETTE.dark.sakura;
const KIN = PALETTE.dark.kin;

export const spec: WallpaperSpec = {
  id: ID,
  compose(seed, data, size) {
    return compose(seed, data, size);
  },
};

/** Previous / current / next station names around `station` (1–53; 0 counts as the first). */
export function neighbours(station: number): { prev: string; cur: string; next: string } {
  const n = Math.min(53, Math.max(1, Math.round(station)));
  const cur = STATIONS[n - 1]!.nameJa;
  const prev = n > 1 ? STATIONS[n - 2]!.nameJa : NIHONBASHI.nameJa;
  const next = n < 53 ? STATIONS[n]!.nameJa : SANJO_OHASHI.nameJa;
  return { prev, cur, next };
}

/* ────────────────────────────────────────────────────────────────────────── */

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);

  const horizon = h * (phone ? 0.56 : 0.6);
  const platformTop = h * (phone ? 0.74 : 0.8);
  const trackTop = platformTop - h * (phone ? 0.05 : 0.07);
  const farPlatform = trackTop - h * (phone ? 0.035 : 0.05);

  const defs: string[] = [
    linearGradient('ss-sky', [[0, AI], [0.3, mix(AI, SAKURA, 0.45)], [0.62, SAKURA], [0.85, mix(SAKURA, WARM, 0.55)], [1, mix(WARM, WASHI, 0.4)]], 90),
    linearGradient('ss-platform', [[0, '#4C4A55'], [0.2, '#3E3C46'], [1, '#2A2830']], 90),
    linearGradient('ss-post', [[0, '#3A3944'], [0.5, '#55535F'], [1, '#2E2D36']], 0),
    linearGradient('ss-plate', [[0, WASHI_LIGHT], [1, WASHI]], 90),
    radialGradient('ss-lamp', [[0, WARM, 0.55], [0.5, WARM, 0.14], [1, WARM, 0]], { cy: 0.3, r: 0.6 }),
    radialGradient('ss-window', [[0, KIN, 0.9], [1, KIN, 0]]),
    blur('ss-mist', phone ? 7 : 9),
  ];
  const body: string[] = [rect(0, 0, w, h, { fill: url('ss-sky') })];

  /* ── stars, clouds, birds ─────────────────────────────────────────────── */
  const stars: string[] = [];
  const starN = range(rng, 18, 40);
  for (let i = 0; i < starN; i++) stars.push(circle(uniform(rng, 0, w), uniform(rng, 0, h * 0.3), uniform(rng, 0.7, 1.6), { fill: WASHI, opacity: uniform(rng, 0.2, 0.6) }));
  body.push(el('g', undefined, stars));
  const clouds: string[] = [];
  const cloudN = range(rng, 4, 7);
  for (let i = 0; i < cloudN; i++) {
    const cw = w * uniform(rng, 0.1, phone ? 0.5 : 0.3);
    const ch = h * uniform(rng, phone ? 0.004 : 0.006, phone ? 0.009 : 0.014);
    const cy = h * uniform(rng, 0.18, 0.5);
    const tone = cy > h * 0.38 ? mix(WARM, WASHI, 0.6) : mix(SAKURA_LIGHT, WASHI, 0.4);
    clouds.push(el('path', { d: roundedRectPath(uniform(rng, -cw * 0.2, w - cw * 0.8), cy, cw, ch, ch / 2), fill: tone, opacity: uniform(rng, 0.3, 0.6) }));
  }
  body.push(el('g', { filter: url('ss-mist') }, clouds));
  const birds: string[] = [];
  const birdN = range(rng, 2, 6);
  const bx = w * uniform(rng, 0.1, 0.7);
  const by = h * uniform(rng, 0.12, 0.32);
  for (let i = 0; i < birdN; i++) {
    const x = bx + i * w * 0.02 + uniform(rng, -8, 8);
    const y = by + i * h * 0.012 + uniform(rng, -6, 6);
    const s = uniform(rng, 5, 9);
    birds.push(polyline([[x - s, y], [x - s * 0.4, y - s * 0.5], [x, y], [x + s * 0.4, y - s * 0.5], [x + s, y]], { fill: 'none', stroke: INK, 'stroke-width': 1.4, opacity: 0.7 }));
  }
  body.push(el('g', undefined, birds));

  /* ── far hill with window lights ──────────────────────────────────────── */
  const hillPts = ridge(seed ^ 0x1234, phone ? 36 : 64, h * (phone ? 0.05 : 0.08));
  const hill: Pt[] = hillPts.map((v, i) => [(i / (hillPts.length - 1)) * w, horizon - v]);
  body.push(polygon([[0, horizon + 2], ...hill, [w, horizon + 2]], { fill: mix(KON, SUMI, 0.6) }));
  const windows: string[] = [];
  const winN = range(rng, 14, 30);
  for (let i = 0; i < winN; i++) {
    const t = uniform(rng, 0, 1);
    const idx = Math.min(hill.length - 1, Math.floor(t * (hill.length - 1)));
    const base = hill[idx]!;
    const wy = base[1] + uniform(rng, 4, horizon - base[1] - 2 > 4 ? horizon - base[1] - 2 : 4);
    windows.push(rect(base[0] + uniform(rng, -8, 8), wy, 3, 2.5, { fill: KIN, opacity: uniform(rng, 0.5, 1) }));
  }
  body.push(el('g', { 'shape-rendering': 'crispEdges' }, windows));

  /* ── far platform canopy, masts and wires ─────────────────────────────── */
  body.push(rect(0, farPlatform, w, trackTop - farPlatform, { fill: '#1E1B2B' }));
  body.push(rect(0, farPlatform - h * 0.012, w, h * 0.012, { fill: '#15131F' }));
  const colN = phone ? 4 : 8;
  for (let i = 0; i <= colN; i++) {
    const cx = (w * (i + uniform(rng, -0.1, 0.1))) / colN;
    body.push(rect(cx - 3, farPlatform - h * 0.05, 6, h * 0.05, { fill: '#15131F' }));
  }
  body.push(rect(0, farPlatform - h * 0.06, w, h * 0.012, { fill: '#17141F' }));
  const mastN = phone ? 3 : 5;
  const masts: number[] = [];
  for (let i = 0; i < mastN; i++) masts.push((w * (i + uniform(rng, 0.2, 0.8))) / mastN);
  const mastTop = h * (phone ? 0.3 : 0.26);
  const mastG: string[] = [];
  for (const mx of masts) {
    mastG.push(rect(mx - 4, mastTop, 8, trackTop - mastTop, { fill: INK }));
    mastG.push(rect(mx - w * 0.03, mastTop + h * 0.02, w * 0.06, 5, { fill: INK }));
    mastG.push(line(mx - w * 0.03, mastTop + h * 0.02, mx, mastTop + h * 0.06, { stroke: INK, 'stroke-width': 3 }));
    mastG.push(line(mx + w * 0.03, mastTop + h * 0.02, mx, mastTop + h * 0.06, { stroke: INK, 'stroke-width': 3 }));
  }
  const wireAt = (x0: number, x1: number, y: number, sag: number): void => {
    mastG.push(polyline(catenary(x0, x1, y, sag, 20), { fill: 'none', stroke: INK, 'stroke-width': 2, opacity: 0.75 }));
  };
  const ends = [-w * 0.1, ...masts, w * 1.1];
  for (let i = 0; i < ends.length - 1; i++) {
    const x0 = ends[i]!;
    const x1 = ends[i + 1]!;
    wireAt(x0, x1, mastTop + h * 0.02, (x1 - x0) * 0.06);
    wireAt(x0, x1, mastTop + h * 0.062, (x1 - x0) * 0.025);
  }
  body.push(el('g', undefined, mastG));

  /* ── tracks ───────────────────────────────────────────────────────────── */
  body.push(rect(0, trackTop, w, platformTop - trackTop, { fill: '#1B1820' }));
  const ties: string[] = [];
  const tieW = phone ? 26 : 34;
  for (let x = -tieW; x < w + tieW; x += tieW * 1.9) ties.push(rect(x + uniform(rng, -2, 2), trackTop + (platformTop - trackTop) * 0.25, tieW, (platformTop - trackTop) * 0.5, { fill: '#2B2630' }));
  body.push(el('g', undefined, ties));
  for (const t of [0.32, 0.72]) {
    const ry = trackTop + (platformTop - trackTop) * t;
    body.push(rect(0, ry - 2, w, 5, { fill: '#55525E' }));
    body.push(rect(0, ry - 2, w, 1.5, { fill: '#9A96A3' }));
  }

  /* ── our platform ─────────────────────────────────────────────────────── */
  body.push(rect(0, platformTop, w, h - platformTop, { fill: url('ss-platform') }));
  body.push(rect(0, platformTop, w, 3, { fill: WASHI, opacity: 0.85 }));
  const tactileY = platformTop + h * 0.02;
  body.push(rect(0, tactileY, w, h * 0.011, { fill: KIN, opacity: 0.92 }));
  const dots: string[] = [];
  for (let x = 8; x < w; x += 16) dots.push(circle(x, tactileY + h * 0.0055, 1.6, { fill: '#8A6A1E', opacity: 0.6 }));
  body.push(el('g', undefined, dots));

  /* ── the sign ─────────────────────────────────────────────────────────── */
  const plateW = w * (phone ? 0.9 : 0.6);
  const plateH = h * (phone ? 0.2 : 0.3);
  const plateX = (w - plateW) / 2;
  const plateCy = h * (phone ? 0.46 : 0.47);
  const plateY = plateCy - plateH / 2;
  const postW = plateH * 0.06;
  const sign: string[] = [];
  for (const px of [plateX + plateW * 0.08, plateX + plateW * 0.92 - postW]) {
    sign.push(rect(px, plateY + plateH * 0.5, postW, platformTop + h * 0.03 - plateY - plateH * 0.5, { fill: url('ss-post') }));
    sign.push(rect(px - postW * 0.4, platformTop + h * 0.02, postW * 1.8, h * 0.012, { fill: '#2A2830' }));
  }
  // lamp hood and its light
  sign.push(ellipse(plateX + plateW / 2, plateY + plateH * 0.02, plateW * 0.26, plateH * 0.3, { fill: url('ss-lamp') }));
  sign.push(rect(plateX + plateW * 0.3, plateY - plateH * 0.1, plateW * 0.4, plateH * 0.08, { fill: '#2A2830', rx: plateH * 0.02 }));
  sign.push(rect(plateX + plateW * 0.32, plateY - plateH * 0.03, plateW * 0.36, plateH * 0.03, { fill: WARM, opacity: 0.8 }));
  // plate
  sign.push(el('path', { d: roundedRectPath(plateX + 5, plateY + 8, plateW, plateH, plateH * 0.05), fill: SUMI, opacity: 0.28 }));
  sign.push(el('path', { d: roundedRectPath(plateX, plateY, plateW, plateH, plateH * 0.05), fill: url('ss-plate'), stroke: '#2A2A33', 'stroke-width': 3 }));
  const belt = beltColor(data.belt);
  const stripeY = plateY + plateH * 0.66;
  sign.push(rect(plateX + plateW * 0.04, stripeY, plateW * 0.92, plateH * 0.045, { fill: belt, stroke: belt === WASHI ? INK_WASH : 'none', 'stroke-width': 1 }));
  const bandY = plateY + plateH * 0.76;
  sign.push(el('path', { d: roundedRectPath(plateX, bandY, plateW, plateH - (bandY - plateY), plateH * 0.05), fill: KON }));
  sign.push(rect(plateX, bandY, plateW, plateH * 0.1, { fill: KON }));
  const arrowH = plateH * 0.1;
  const bandCy = bandY + (plateY + plateH - bandY) / 2;
  sign.push(polygon([[plateX + plateW * 0.03, bandCy], [plateX + plateW * 0.03 + arrowH * 0.8, bandCy - arrowH / 2], [plateX + plateW * 0.03 + arrowH * 0.8, bandCy + arrowH / 2]], { fill: WASHI }));
  sign.push(polygon([[plateX + plateW * 0.97, bandCy], [plateX + plateW * 0.97 - arrowH * 0.8, bandCy - arrowH / 2], [plateX + plateW * 0.97 - arrowH * 0.8, bandCy + arrowH / 2]], { fill: WASHI }));
  // roundel for the station number
  const rr = plateH * 0.13;
  const rcx = plateX + plateW * 0.12;
  const rcy = plateY + plateH * 0.32;
  sign.push(circle(rcx, rcy, rr, { fill: WASHI_LIGHT, stroke: belt, 'stroke-width': rr * 0.22 }));
  body.push(el('g', undefined, sign));

  /* ── bench and the traveller ──────────────────────────────────────────── */
  const benchX = w * (phone ? 0.06 : 0.1);
  const benchY = platformTop + h * 0.06;
  const bw = w * (phone ? 0.22 : 0.11);
  body.push(rect(benchX, benchY, bw, h * 0.012, { fill: '#23212A' }));
  body.push(rect(benchX + bw * 0.08, benchY + h * 0.012, bw * 0.05, h * 0.03, { fill: '#23212A' }));
  body.push(rect(benchX + bw * 0.87, benchY + h * 0.012, bw * 0.05, h * 0.03, { fill: '#23212A' }));
  // the traveller: head, shoulders, coat, legs, a bag in hand
  const tx = w * (phone ? 0.82 : 0.86);
  const ts = h * (phone ? 0.05 : 0.085);
  const ty = platformTop + h * 0.02;
  body.push(circle(tx, ty + ts * 0.14, ts * 0.13, { fill: INK }));
  body.push(rect(tx - ts * 0.05, ty + ts * 0.24, ts * 0.1, ts * 0.08, { fill: INK }));
  body.push(polygon([[tx - ts * 0.26, ty + ts * 0.34], [tx + ts * 0.26, ty + ts * 0.34], [tx + ts * 0.22, ty + ts * 0.95], [tx - ts * 0.22, ty + ts * 0.95]], { fill: INK }));
  body.push(rect(tx - ts * 0.18, ty + ts * 0.9, ts * 0.14, ts * 0.42, { fill: INK }));
  body.push(rect(tx + ts * 0.04, ty + ts * 0.9, ts * 0.14, ts * 0.42, { fill: INK }));
  body.push(line(tx + ts * 0.22, ty + ts * 0.4, tx + ts * 0.34, ty + ts * 0.95, { stroke: INK, 'stroke-width': ts * 0.08, 'stroke-linecap': 'round' }));
  body.push(rect(tx + ts * 0.24, ty + ts * 0.95, ts * 0.26, ts * 0.22, { fill: INK, rx: 2 }));

  /* ── text ─────────────────────────────────────────────────────────────── */
  const { prev, cur, next } = neighbours(data.station);
  const name = katakanaName(data.nameKana) || data.nameKana;
  const nameSize = fitSize(name, plateW * 0.62, plateH * 0.4, { max: plateH * 0.4 });
  const texts: TextLayer[] = [
    { text: name, x: plateX + plateW * 0.56, y: plateY + plateH * 0.42, size: nameSize, font: FONTS.ja, fill: INK, anchor: 'middle', weight: 700, lang: 'ja' },
    { text: `${cur}${S.stationSign.eki}`, x: plateX + plateW * 0.56, y: plateY + plateH * 0.6, size: plateH * 0.09, font: FONTS.ja, fill: INK_WASH, anchor: 'middle', letterSpacing: plateH * 0.02, lang: 'ja' },
    { text: String(Math.min(53, Math.max(1, Math.round(data.station)))), x: rcx, y: rcy + rr * 0.36, size: rr * 1.05, font: FONTS.ui, fill: INK, anchor: 'middle', weight: 700, lang: 'en' },
    { text: prev, x: plateX + plateW * 0.03 + arrowH * 1.3, y: bandCy + plateH * 0.04, size: plateH * 0.11, font: FONTS.ja, fill: WASHI, anchor: 'start', weight: 600, lang: 'ja' },
    { text: next, x: plateX + plateW * 0.97 - arrowH * 1.3, y: bandCy + plateH * 0.04, size: plateH * 0.11, font: FONTS.ja, fill: WASHI, anchor: 'end', weight: 600, lang: 'ja' },
  ];

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body });
  return { svg, texts, post: 'none' };
}
