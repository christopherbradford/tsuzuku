/**
 * TSUZUKU — kakejiku 'hanko-garden' 判子の庭 (design 06 §3).
 *
 * The learner's Mon badges pressed as vermilion seals on washi, in unlock
 * order (reading order of a loose grid), each tilted ±8°, edges eroded and
 * bled by one turbulence filter over the whole group; about a third are
 * partial impressions (lighter, more eroded). The crest's glyph sits in
 * the frame as a brush-font TextLayer rotated with its seal; round frames
 * for circle/petal fields, square otherwise; silver and gold crests carry
 * a double frame and gold adds sixteen rays. Behind them a karesansui:
 * raked gravel lines curving around moss stones. A larger name seal and a
 * belt-colour sash sit in the corner. Palette washi, shu; post pass grain.
 *
 * Glyph, field and tier come from `BADGE_DEFS` (store contract tier), so
 * the seals always match the Mon shown in the Collections screen.
 */
import type { BadgeId, BadgeTier } from '../../shared/catalog';
import { mulberry32, range, uniform } from '../../shared/hash';
import { BADGE_DEFS } from '../../store';
import { inkBleed, sealFrame } from '../brush';
import { INK, INK_WASH, PALETTE, STONE_DARK, WASHI, WASHI_LIGHT, beltColor, mix } from '../color';
import { clamp, rays, type Box, type Pt } from '../geom';
import { FONTS, columnsFor, eraDate, tategakiLayers, type TextLayer } from '../jtext';
import { noise1 } from '../noise';
import { M, Q, el, ellipse, g, path, rect, svgDoc, turbulence, url } from '../svg';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-2';

const SHU = PALETTE.light.shu;
const KIN = PALETTE.light.kin;

export interface SealLook {
  glyph: string;
  round: boolean;
  tier: BadgeTier;
}

const LOOK = new Map<string, SealLook>(BADGE_DEFS.map((d) => [d.id, { glyph: d.glyph, round: d.field === 'circle' || d.field === 'petal', tier: d.tier }]));

/** How a badge is pressed: its glyph, frame shape and tier (unknown ids get a generic crest). */
export function sealLook(id: BadgeId): SealLook {
  return LOOK.get(id) ?? { glyph: '紋', round: true, tier: 'bronze' };
}

export interface SealPlacement {
  id: BadgeId;
  x: number;
  y: number;
  size: number;
  rot: number;
  partial: boolean;
  look: SealLook;
}

/** Loose grid in reading order (= unlock order) filling `box`, jittered, tilted ±8°, ~30 % partial impressions. */
export function layoutSeals(seed: number, ids: readonly BadgeId[], box: Box): SealPlacement[] {
  const n = ids.length;
  if (n === 0) return [];
  const rng = mulberry32(seed ^ 0x6861);
  const cell = clamp(Math.sqrt((box.w * box.h) / n), 90, 260);
  const cols = Math.max(1, Math.min(n, Math.floor(box.w / cell)));
  const rows = Math.ceil(n / cols);
  const cw = box.w / cols;
  const ch = Math.min(cell * 1.08, box.h / rows);
  const y0 = box.y + (box.h - rows * ch) / 2;
  const out: SealPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const x0 = box.x + ((cols - inRow) * cw) / 2;
    const size = Math.min(cw, ch) * 0.74 * uniform(rng, 0.93, 1.04);
    out.push({
      id: ids[i]!,
      x: x0 + (c + 0.5) * cw + uniform(rng, -cw * 0.07, cw * 0.07),
      y: y0 + (r + 0.5) * ch + uniform(rng, -ch * 0.07, ch * 0.07),
      size,
      rot: uniform(rng, -8, 8),
      partial: rng() < 0.3,
      look: sealLook(ids[i]!),
    });
  }
  return out;
}

function sealMarkup(p: SealPlacement, i: number, seed: number): string {
  const { x, y, size, rot, look } = p;
  const op = p.partial ? 0.6 : 0.92;
  const erode = p.partial ? 0.03 : 0.014;
  const parts: string[] = [];
  if (look.tier === 'gold') parts.push(path(rays(x, y, size * 0.58, size * 0.67, 16), { fill: KIN, opacity: op * 0.9 }));
  parts.push(path(sealFrame({ x: x - size / 2, y: y - size / 2, size, round: look.round, seed: seed ^ (i * 977), stroke: size * (look.tier === 'bronze' ? 0.08 : 0.05), erode, samples: 48 }), { fill: SHU, 'fill-rule': 'evenodd', opacity: op }));
  if (look.tier !== 'bronze') {
    const inner = size * 0.84;
    parts.push(path(sealFrame({ x: x - inner / 2, y: y - inner / 2, size: inner, round: look.round, seed: seed ^ (i * 977) ^ 0x55, stroke: size * 0.024, erode, samples: 48 }), { fill: SHU, 'fill-rule': 'evenodd', opacity: op }));
  }
  return g({ class: 'seal', transform: `rotate(${rot.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})` }, parts);
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size);
  const belt = beltColor(data.belt);
  const nameSeal = phone ? 220 : 190;
  const nameX = phone ? w - w * 0.08 - nameSeal : w - w * 0.05 - nameSeal;
  const nameY = phone ? safe.y + safe.h - nameSeal - 40 : h - h * 0.08 - nameSeal;

  const defs = [
    inkBleed('bleed', seed % 991, { scale: 5, blur: 0.5, frequency: 0.04 }),
    inkBleed('bleedStone', (seed >>> 2) % 991, { scale: 9, blur: 1.2, frequency: 0.03 }),
    turbulence('paper', { baseFrequency: 0.85, octaves: 2, seed: seed % 211, alpha: 0.1 }),
  ];

  // Karesansui: moss stones with ripple rings, raked gravel lines bending around them.
  const stones: Pt[] = [];
  const nStones = range(rng, 2, 3);
  for (let i = 0; i < nStones; i++) {
    const left = rng() < 0.5;
    const sx = (left ? uniform(rng, 0.06, 0.2) : uniform(rng, 0.8, 0.94)) * w;
    const sy = phone ? (i % 2 === 0 ? uniform(rng, 0.03, 0.09) : uniform(rng, 0.9, 0.96)) * h : uniform(rng, 0.55, 0.9) * h;
    stones.push([sx, sy]);
  }
  const gravel: string[] = [];
  const wob = noise1(mulberry32(seed ^ 0x9a));
  const pitch = phone ? 46 : 42;
  const lineColor = PALETTE.light.line;
  for (let y = h * 0.04; y < h; y += pitch) {
    let d = '';
    const stepX = 24;
    let prev: Pt | null = null;
    for (let x = -10; x <= w + 10; x += stepX) {
      let yy = y + (wob(x / 260 + y / 97) * 2 - 1) * 9;
      for (const [sx, sy] of stones) {
        const dx = x - sx;
        const dy = y - sy;
        const dd = Math.hypot(dx, dy);
        const R = phone ? 150 : 140;
        if (dd < R && dd > 1) yy += (dy / dd) * (R - dd) * 0.45;
      }
      if (!prev) d += M(x, yy);
      else d += Q((prev[0] + x) / 2, (prev[1] + yy) / 2, x, yy);
      prev = [x, yy];
    }
    gravel.push(path(d, { fill: 'none', stroke: lineColor, 'stroke-width': 2, opacity: 0.6 }));
  }
  const stoneMarkup: string[] = [];
  for (const [sx, sy] of stones) {
    const rx = uniform(rng, 36, 60) * (phone ? 1.15 : 1);
    const ry = rx * uniform(rng, 0.55, 0.8);
    for (let k = 1; k <= 3; k++) stoneMarkup.push(ellipse(sx, sy, rx + k * 16, ry + k * 13, { fill: 'none', stroke: lineColor, 'stroke-width': 2, opacity: 0.9 }));
    stoneMarkup.push(ellipse(sx, sy, rx, ry, { fill: STONE_DARK, filter: url('bleedStone') }));
    stoneMarkup.push(ellipse(sx - rx * 0.25, sy - ry * 0.3, rx * 0.4, ry * 0.3, { fill: mix(STONE_DARK, PALETTE.light.matcha, 0.4), opacity: 0.8 }));
  }

  // Seals.
  const box: Box = phone
    ? { x: w * 0.08, y: safe.y + 60, w: w * 0.84, h: safe.h - 60 - (nameSeal + 130) }
    : { x: w * 0.07, y: h * 0.1, w: w * 0.86, h: h * 0.68 };
  const seals = layoutSeals(seed, data.badgesInOrder, box);
  const sealMarkupAll = seals.map((p, i) => sealMarkup(p, i, seed));

  // Name seal (square, double frame) with the belt sash beneath.
  const nameFrame = g({ class: 'name-seal' }, [
    path(sealFrame({ x: nameX, y: nameY, size: nameSeal, round: false, seed: seed ^ 0x4e, stroke: nameSeal * 0.045, erode: 0.01 }), { fill: SHU, 'fill-rule': 'evenodd', opacity: 0.94 }),
    path(sealFrame({ x: nameX + nameSeal * 0.08, y: nameY + nameSeal * 0.08, size: nameSeal * 0.84, round: false, seed: seed ^ 0x4f, stroke: nameSeal * 0.02, erode: 0.01 }), { fill: SHU, 'fill-rule': 'evenodd', opacity: 0.94 }),
  ]);
  const sash = rect(nameX - 6, nameY + nameSeal + 18, nameSeal + 12, 14, { fill: belt, stroke: INK, 'stroke-width': 1.5, opacity: 0.95 });

  const body = [
    rect(0, 0, w, h, { fill: WASHI_LIGHT, filter: url('paper') }),
    g(undefined, gravel),
    g(undefined, stoneMarkup),
    g({ filter: url('bleed') }, [...sealMarkupAll, nameFrame]),
    sash,
  ];

  // Texts: a glyph per seal, the name in the name seal, caption, date, title.
  const texts: TextLayer[] = seals.map((p) => ({
    text: p.look.glyph,
    x: p.x,
    y: p.y + p.size * 0.18,
    size: p.size * (p.look.tier === 'bronze' ? 0.5 : 0.44),
    font: FONTS.brush,
    fill: SHU,
    anchor: 'middle',
    rotate: p.rot,
    opacity: p.partial ? 0.6 : 0.92,
    lang: 'ja',
  }));
  const inner = nameSeal * 0.68;
  const columns = Math.min(3, columnsFor(data.nameKana, 4));
  const perCol = Math.ceil(Array.from(data.nameKana).length / columns);
  const fs = Math.min(nameSeal * 0.4, inner / (1 + (columns - 1) * 1.5), inner / (1 + (perCol - 1) * 1.12));
  const colH = fs * (1 + (perCol - 1) * 1.12);
  texts.push(
    ...tategakiLayers({
      text: data.nameKana,
      x: nameX + nameSeal / 2 + ((columns - 1) * 1.5 * fs) / 2,
      y: nameY + nameSeal / 2 - colH / 2,
      size: fs,
      columns,
      font: FONTS.brush,
      fill: SHU,
      colGap: 1.5,
      opacity: 0.94,
    }),
  );
  const n = data.badgesInOrder.length;
  texts.push({ text: `${n}${S.crestsUnit}`, x: nameX - 26, y: nameY + nameSeal - 36, size: phone ? 30 : 28, font: FONTS.mincho, fill: INK, anchor: 'end', lang: 'ja' });
  texts.push({ text: eraDate(data.date), x: nameX - 26, y: nameY + nameSeal - 4, size: phone ? 24 : 22, font: FONTS.mincho, fill: INK_WASH, anchor: 'end', lang: 'ja' });
  texts.push({ text: S.gardenTitle, x: phone ? w * 0.9 : w * 0.955, y: phone ? safe.y + 40 : h * 0.05, size: phone ? 40 : 34, font: FONTS.brush, fill: INK, vertical: true, opacity: 0.85, lang: 'ja' });

  const svg = svgDoc({ w, h, bg: WASHI, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'grain' };
}

export const spec: WallpaperSpec = { id: 'hanko-garden', living: true, compose };
