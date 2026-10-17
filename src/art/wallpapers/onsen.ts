/**
 * TSUZUKU — kakejiku 'onsen' 温泉の湯気 (design 06 §3).
 *
 * A rotenburo at night: starry sky, moon, three mountain ridges with cedars,
 * a wooden fence with a 「ゆ」 noren, a stone lantern, and the pool breathing
 * feTurbulence steam. The stones around the rim are the learner's planned
 * rest days taken — the bath grows as they learn to rest.
 *
 * Layers: sky and stars → moon → ridges and cedars → ground → fence, noren,
 * lantern → rim and back stones → water with moon ripples → front stones,
 * bucket, towel → steam. Text (name on the fence sign, rest-day caption,
 * era date) is returned as TextLayers inside the phone safe zone; a long
 * name is set in up to three columns and the sign widens to hold them.
 * Pure for (seed, data, size).
 */
import { chance, hashSeed, mulberry32, pick, range, uniform } from '../../shared/hash';
import { FOAM, INK, NIGHT, PALETTE, STONE, STONE_DARK, WASHI, darken, mix } from '../color';
import { chaikin, TAU, type Pt } from '../geom';
import { FONTS, columnHeight, columnsFor, eraDate, fitSize, glyphCount, splitColumns, tategakiLayers, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { blur, circle, el, ellipse, g, line, linearGradient, mask, path, polyPath, polygon, radialGradient, rect, safeRect, sizeOf, svgDoc, text, turbulence, url } from '../svg';
import type { WallpaperSpec } from './spec';
import { S } from './strings-3';

const MATCHA = PALETTE.light.matcha;
const KON_DEEP = '#1F2A6B';
const WARM = '#FFD166';
const WOOD = '#3B2A1E';
const WOOD_LIGHT = '#5A4330';
/** Sign-board colour (exported for the sign-fit test). */
export const SIGN = '#8B6B4A';
const MAX_STONES = 60;

export const spec: WallpaperSpec = {
  id: 'onsen',
  compose(seed, data, size) {
    const { w, h } = sizeOf(size);
    const phone = size === 'phone';
    const rng = mulberry32(seed);
    const defs: string[] = [];
    const body: string[] = [];

    const horizon = h * (phone ? 0.5 : 0.56);
    const cx = w / 2;
    const py = h * (phone ? 0.72 : 0.76);
    const rx = phone ? w * 0.4 : w * 0.26;
    const ry = phone ? h * 0.07 : h * 0.11;

    /* Sky, stars, moon */
    defs.push(linearGradient('on-sky', [[0, NIGHT], [0.7, mix(NIGHT, KON_DEEP, 0.5)], [1, mix(NIGHT, KON_DEEP, 0.75)]], 90));
    body.push(rect(0, 0, w, h, { fill: url('on-sky') }));
    const stars: string[] = [];
    const nStars = range(rng, 90, 150);
    for (let i = 0; i < nStars; i++) {
      const x = uniform(rng, 0, 1) * w;
      const y = uniform(rng, 0, 0.95) * horizon;
      const r = uniform(rng, 0.6, 2.2);
      stars.push(circle(x, y, r, { opacity: uniform(rng, 0.3, 0.95) }));
      if (r > 1.9 && chance(rng, 0.4)) stars.push(path(`M${(x - r * 4).toFixed(1)} ${y.toFixed(1)}h${(r * 8).toFixed(1)}M${x.toFixed(1)} ${(y - r * 4).toFixed(1)}v${(r * 8).toFixed(1)}`, { stroke: FOAM, 'stroke-width': 0.8, opacity: 0.5 }));
    }
    body.push(g({ fill: FOAM }, stars));
    const moonSide = chance(rng, 0.5) ? -1 : 1;
    const moonX = w / 2 + moonSide * uniform(rng, 0.18, 0.34) * w;
    const moonY = h * (phone ? uniform(rng, 0.17, 0.28) : uniform(rng, 0.12, 0.24));
    const moonR = Math.min(w, h) * uniform(rng, 0.045, 0.07);
    defs.push(blur('on-moon-glow', moonR * 0.8));
    body.push(circle(moonX, moonY, moonR * 1.8, { fill: WASHI, opacity: 0.18, filter: url('on-moon-glow') }));
    body.push(circle(moonX, moonY, moonR, { fill: mix(WASHI, FOAM, 0.5) }));
    if (chance(rng, 0.45)) body.push(circle(moonX + moonR * 0.45 * moonSide, moonY - moonR * 0.15, moonR * 0.92, { fill: mix(NIGHT, KON_DEEP, 0.25) }));

    /* Ridges and cedars */
    const ridges: { amp: number; base: number; fill: string }[] = [
      { amp: h * 0.17, base: horizon - h * 0.02, fill: mix(NIGHT, KON_DEEP, 0.4) },
      { amp: h * 0.12, base: horizon + h * 0.01, fill: darken(MATCHA, 0.7) },
      { amp: h * 0.085, base: horizon + h * 0.04, fill: darken(MATCHA, 0.82) },
    ];
    ridges.forEach((rd, k) => {
      const heights = ridge(hashSeed(seed, 'ridge', k), 72, rd.amp, { roughness: 0.3 + k * 0.1 });
      const pts: Pt[] = heights.map((v, i) => [(i / (heights.length - 1)) * w, rd.base - v]);
      body.push(path(polyPath([...pts, [w, h], [0, h]], true), { fill: rd.fill }));
      if (k === 2) {
        const trees: string[] = [];
        const n = range(rng, 28, 48);
        for (let i = 0; i < n; i++) {
          const t = uniform(rng, 0, 1);
          const idx = Math.min(heights.length - 1, Math.floor(t * (heights.length - 1)));
          const x = t * w;
          const yb = rd.base - heights[idx]! + 6;
          const th = uniform(rng, 28, 70) * (phone ? 1.3 : 1);
          const tw = th * uniform(rng, 0.28, 0.4);
          trees.push(polygon([[x, yb - th], [x + tw / 2, yb], [x - tw / 2, yb]]));
          trees.push(polygon([[x, yb - th * 0.75], [x + tw * 0.38, yb - th * 0.4], [x - tw * 0.38, yb - th * 0.4]]));
        }
        body.push(g({ fill: darken(MATCHA, 0.86) }, trees));
      }
    });

    /* Ground */
    defs.push(linearGradient('on-ground', [[0, darken(MATCHA, 0.78)], [1, '#0A0D16']], 90));
    body.push(rect(0, horizon + h * 0.06, w, h - horizon, { fill: url('on-ground') }));

    /* Fence with a sign and a noren */
    const fenceL = cx - rx * 1.35;
    const fenceR = cx + rx * 1.35;
    const fenceBottom = py - ry * 1.05;
    const fenceTop = fenceBottom - h * (phone ? 0.15 : 0.2);
    const plankW = phone ? 40 : 30;
    const planks: string[] = [];
    for (let x = fenceL; x < fenceR; x += plankW + 3) {
      const top = fenceTop + uniform(rng, -6, 10);
      planks.push(rect(x, top, plankW, fenceBottom - top + 20, { fill: chance(rng, 0.5) ? WOOD : WOOD_LIGHT }));
      planks.push(polygon([[x, top], [x + plankW / 2, top - plankW * 0.3], [x + plankW, top]], { fill: WOOD_LIGHT }));
    }
    planks.push(rect(fenceL - 10, fenceTop + (fenceBottom - fenceTop) * 0.35, fenceR - fenceL + 20, 10, { fill: darken(WOOD, 0.3) }));
    body.push(g(undefined, planks));
    const sign = { x: cx - rx * 1.2, y: fenceTop + 24, w: phone ? 96 : 72, h: 0 };
    // A long name splits into up to three columns (right to left) and the sign widens with them, so a name at
    // NAME_MAX_GLYPHS stays legible and inside the fence instead of a floored size running past it (review round 2).
    const nameColumns = splitColumns(data.nameKana, Math.min(3, columnsFor(data.nameKana, 8)));
    const longestColumn = nameColumns.reduce((a, b) => (glyphCount(b) > glyphCount(a) ? b : a), '');
    const nameSize = fitSize(longestColumn, sign.w * 0.6, (fenceBottom - fenceTop) * 0.85, { vertical: true, max: phone ? 48 : 36 });
    const colPitch = nameSize * 1.6;
    sign.w += (nameColumns.length - 1) * colPitch;
    sign.h = columnHeight(longestColumn, nameSize) + nameSize * 1.2;
    body.push(el('rect', { x: sign.x, y: sign.y, width: sign.w, height: sign.h, rx: 3, fill: SIGN, stroke: darken(SIGN, 0.45), 'stroke-width': 3 }));
    // noren on the right end of the fence
    const nx = cx + rx * 0.72;
    const nw = phone ? 150 : 120;
    const nh = (fenceBottom - fenceTop) * 0.62;
    body.push(rect(nx - nw / 2 - 8, fenceTop + 6, nw + 16, 8, { fill: darken(WOOD, 0.4) }));
    body.push(rect(nx - nw / 2, fenceTop + 12, nw / 2 - 3, nh, { fill: PALETTE.light.kon }));
    body.push(rect(nx + 3, fenceTop + 12, nw / 2 - 3, nh, { fill: PALETTE.light.kon }));
    body.push(text(S.yu, { x: nx, y: fenceTop + 12 + nh * 0.58, 'font-size': nh * 0.5, 'font-family': FONTS.brush, fill: WASHI, 'text-anchor': 'middle', lang: 'ja' }));

    /* Stone lantern on the left */
    const lx = fenceL - (phone ? 40 : 60);
    const lb = py - ry * 0.4;
    const ls = phone ? 1.3 : 1;
    defs.push(blur('on-lantern-glow', 30 * ls));
    body.push(circle(lx, lb - 110 * ls, 70 * ls, { fill: WARM, opacity: 0.22, filter: url('on-lantern-glow') }));
    body.push(rect(lx - 34 * ls, lb - 14 * ls, 68 * ls, 14 * ls, { fill: STONE_DARK }));
    body.push(rect(lx - 10 * ls, lb - 80 * ls, 20 * ls, 66 * ls, { fill: STONE_DARK }));
    body.push(rect(lx - 30 * ls, lb - 92 * ls, 60 * ls, 12 * ls, { fill: STONE }));
    body.push(rect(lx - 22 * ls, lb - 130 * ls, 44 * ls, 38 * ls, { fill: STONE_DARK }));
    body.push(rect(lx - 12 * ls, lb - 122 * ls, 24 * ls, 22 * ls, { fill: WARM }));
    body.push(polygon([[lx - 40 * ls, lb - 130 * ls], [lx + 40 * ls, lb - 130 * ls], [lx + 22 * ls, lb - 152 * ls], [lx - 22 * ls, lb - 152 * ls]], { fill: STONE }));
    body.push(circle(lx, lb - 160 * ls, 8 * ls, { fill: STONE }));

    /* Pool: rim, back stones, water, front stones */
    const blobPts: Pt[] = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const k = uniform(rng, 0.86, 1.1);
      blobPts.push([cx + Math.cos(a) * rx * k, py + Math.sin(a) * ry * k]);
    }
    const water = chaikin(blobPts, 3, true);
    const rim = water.map(([x, y]) => [cx + (x - cx) * 1.1, py + (y - py) * 1.16] as Pt);
    body.push(path(polyPath(rim, true), { fill: '#1C1A17' }));

    const stonesN = Math.min(MAX_STONES, Math.max(0, Math.floor(data.restDays)));
    const back: string[] = [];
    const front: string[] = [];
    const palette = [STONE, STONE_DARK, mix(STONE, NIGHT, 0.3), mix(STONE, WASHI, 0.15)];
    for (let i = 0; i < stonesN; i++) {
      const a = ((i + 0.5) / stonesN) * TAU + uniform(rng, -0.05, 0.05);
      const idx = Math.floor(((a % TAU) / TAU) * rim.length) % rim.length;
      const p = rim[(idx + rim.length) % rim.length]!;
      const srx = uniform(rng, 16, 30) * (phone ? 1.25 : 1);
      const sry = srx * uniform(rng, 0.55, 0.75);
      const rot = uniform(rng, -20, 20);
      const fill = pick(rng, palette);
      const stone = g({ transform: `rotate(${rot.toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)})` }, [
        ellipse(p[0], p[1], srx, sry, { fill }),
        ellipse(p[0] - srx * 0.25, p[1] - sry * 0.3, srx * 0.45, sry * 0.3, { fill: FOAM, opacity: 0.14 }),
      ]);
      (Math.sin(a) < 0 ? back : front).push(stone);
    }
    body.push(g(undefined, back));

    defs.push(radialGradient('on-water', [[0, mix(MATCHA, NIGHT, 0.12)], [0.5, mix(MATCHA, NIGHT, 0.45)], [1, mix(MATCHA, NIGHT, 0.72)]], { cx: 0.5, cy: 0.4, r: 0.7 }));
    body.push(path(polyPath(water, true), { fill: url('on-water') }));
    defs.push(blur('on-moon-water', 14));
    body.push(ellipse(cx + (moonX - cx) * 0.25, py - ry * 0.2, rx * 0.22, ry * 0.3, { fill: FOAM, opacity: 0.35, filter: url('on-moon-water') }));
    for (let k = 1; k <= 3; k++) body.push(ellipse(cx + (moonX - cx) * 0.25, py - ry * 0.1 + k * ry * 0.18, rx * 0.2 + k * rx * 0.12, ry * 0.08 + k * ry * 0.04, { fill: 'none', stroke: FOAM, 'stroke-width': 1.2, opacity: 0.3 - k * 0.07 }));
    body.push(g(undefined, front));

    // bucket and towel at the front rim
    const bx = cx - rx * 0.7;
    const by = py + ry * 1.05;
    const bs = phone ? 1.3 : 1;
    body.push(rect(bx - 22 * bs, by - 30 * bs, 44 * bs, 30 * bs, { fill: '#6B4A2E' }));
    body.push(line(bx - 22 * bs, by - 22 * bs, bx + 22 * bs, by - 22 * bs, { stroke: '#3B2A1E', 'stroke-width': 2 }));
    body.push(line(bx - 22 * bs, by - 8 * bs, bx + 22 * bs, by - 8 * bs, { stroke: '#3B2A1E', 'stroke-width': 2 }));
    body.push(ellipse(bx, by - 30 * bs, 22 * bs, 7 * bs, { fill: '#8B6B4A' }));
    body.push(ellipse(bx, by - 30 * bs, 17 * bs, 5 * bs, { fill: mix(MATCHA, WASHI, 0.5) }));
    body.push(el('rect', { x: cx + rx * 0.62, y: py + ry * 0.95, width: 46 * bs, height: 22 * bs, rx: 5, fill: WASHI, transform: `rotate(-8 ${(cx + rx * 0.62).toFixed(1)} ${(py + ry * 0.95).toFixed(1)})` }));

    /* Steam */
    const steam = { x: cx - rx * 1.5, y: py - h * 0.5, w: rx * 3, h: h * 0.52 };
    defs.push(turbulence('on-steam', { baseFrequency: [0.0045, 0.011], octaves: 3, seed: hashSeed(seed, 'steam') % 1000, alpha: 0.95 }));
    // the mask ellipse fits the box exactly (r = 0.5 of the bbox) so the steam has no straight edges
    defs.push(radialGradient('on-steam-fade', [[0, '#FFFFFF', 1], [0.35, '#FFFFFF', 0.6], [0.75, '#FFFFFF', 0.12], [1, '#000000', 1]], { cx: 0.5, cy: 0.9, r: 0.5 }));
    defs.push(mask('on-steam-mask', rect(steam.x, steam.y, steam.w, steam.h, { fill: url('on-steam-fade') })));
    body.push(g({ mask: url('on-steam-mask'), opacity: 0.72 }, rect(steam.x, steam.y, steam.w, steam.h, { fill: WASHI, filter: url('on-steam') })));
    defs.push(blur('on-curl', 30));
    const curls: string[] = [];
    const nCurl = range(rng, 3, 5);
    for (let i = 0; i < nCurl; i++) curls.push(ellipse(cx + uniform(rng, -0.5, 0.5) * rx, py - ry - uniform(rng, 0.04, 0.3) * h, rx * uniform(rng, 0.2, 0.4), ry * uniform(rng, 0.5, 1.2), { fill: FOAM, opacity: uniform(rng, 0.14, 0.3) }));
    body.push(g({ filter: url('on-curl') }, curls));

    /* Text */
    const texts: TextLayer[] = [];
    const safe = safeRect(size, 0);
    const margin = phone ? 84 : 72;
    const firstColX = sign.x + sign.w / 2 + ((nameColumns.length - 1) * colPitch) / 2;
    texts.push(...tategakiLayers({ text: data.nameKana, x: firstColX, y: sign.y + nameSize * 0.6, size: nameSize, columns: nameColumns.length, font: FONTS.mincho, fill: INK }));
    const small = phone ? 30 : 24;
    const bottomY = safe.y + safe.h - (phone ? 56 : 48);
    texts.push({ text: `${S.restLabel}${Math.max(0, Math.floor(data.restDays))}${S.daysUnit}`, x: margin, y: bottomY, size: small, font: FONTS.mincho, fill: WASHI, anchor: 'start', opacity: 0.85, lang: 'ja' });
    texts.push({ text: eraDate(data.date), x: w - margin, y: bottomY, size: small, font: FONTS.mincho, fill: WASHI, anchor: 'end', opacity: 0.7, lang: 'ja' });
    for (const t of texts) {
      if (t.y - t.size * 0.88 < safe.y) t.y = safe.y + t.size * 0.9;
    }

    return { svg: svgDoc({ w, h, defs, body }), texts, post: 'none' };
  },
};
