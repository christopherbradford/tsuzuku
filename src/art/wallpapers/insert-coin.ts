/**
 * TSUZUKU — kakejiku 'insert-coin' 筐体 (design 06 §3).
 *
 * An original upright arcade cabinet in a dark hall: marquee, CRT bezel with
 * a hi-score attract screen, control panel, coin door, side-art stripes, a
 * neon-lit carpet and dim cabinets behind. The marquee carries the learner's
 * name; the hi-score table leads with their Rapid Fire best and katakana
 * initials, the house entries below are generic attract-mode names.
 *
 * Layers: hall gradient → carpet pattern → background cabinets → marquee
 * glow on the floor → the cabinet (body, stripes, marquee, bezel, screen,
 * controls, coin door, kick plate). Post pass: scanlines (applied by the
 * pipeline). All text is TextLayers (DotGothic16 / Dela Gothic One) inside
 * the phone safe zone. Pure for (seed, data, size).
 */
import { chance, mulberry32, pick, range, shuffle, uniform } from '../../shared/hash';
import { FOAM, PALETTE, PHOSPHOR, SUMI, WASHI, darken, lighten, mix } from '../color';
import type { Box } from '../geom';
import { FONTS, fitSize, initials, type TextLayer } from '../jtext';
import { crtBezel, crtScreenClip, vignette } from '../pixel';
import { blur, circle, g, glowTwin, line, linearGradient, path, pattern, polygon, rect, roundedRectPath, safeRect, sizeOf, svgDoc, url } from '../svg';
import type { WallpaperSpec } from './spec';
import { S } from './strings-3';

const NEON_C = PALETTE.dark['neon-c'];
const NEON_M = PALETTE.dark['neon-m'];
const KIN = PALETTE.dark.kin;
const SHU = PALETTE.dark.shu;
const BODIES = ['#1A1A24', '#201826', '#15202A'] as const;

/** A dim cabinet silhouette for the background row. */
function ghostCabinet(x: number, y: number, cw: number, ch: number, glowColor: string, body: string): string {
  const parts: string[] = [];
  parts.push(rect(x, y, cw, ch, { fill: body }));
  parts.push(rect(x + cw * 0.08, y + cw * 0.08, cw * 0.84, ch * 0.09, { fill: mix(body, glowColor, 0.35) }));
  parts.push(rect(x + cw * 0.12, y + ch * 0.2, cw * 0.76, ch * 0.26, { fill: mix(SUMI, glowColor, 0.25) }));
  parts.push(polygon([[x, y + ch * 0.5], [x + cw, y + ch * 0.5], [x + cw * 1.04, y + ch * 0.58], [x - cw * 0.04, y + ch * 0.58]], { fill: darken(body, 0.2) }));
  return g({ opacity: 0.55 }, parts);
}

export const spec: WallpaperSpec = {
  id: 'insert-coin',
  compose(seed, data, size) {
    const { w, h } = sizeOf(size);
    const phone = size === 'phone';
    const rng = mulberry32(seed);
    const defs: string[] = [];
    const body: string[] = [];
    const bodyColor = pick(rng, BODIES);
    const stripes = shuffle(rng, [NEON_M, NEON_C, KIN]);
    const phosphor = pick(rng, ['#07110F', '#080A1A', '#120C06']);
    const screenInk = phosphor === '#120C06' ? PHOSPHOR.amber : phosphor === '#07110F' ? PHOSPHOR.green : NEON_C;

    /* Hall */
    const floorY = h * (phone ? 0.9 : 0.88);
    defs.push(linearGradient('ic-hall', [[0, SUMI], [0.7, '#0E0E16'], [1, '#15151D']], 90));
    body.push(rect(0, 0, w, h, { fill: url('ic-hall') }));
    const cell = phone ? 54 : 44;
    defs.push(pattern('ic-carpet', cell, cell, [circle(cell * 0.25, cell * 0.25, 2, { fill: NEON_C, opacity: 0.35 }), circle(cell * 0.75, cell * 0.75, 2, { fill: NEON_M, opacity: 0.3 }), rect(cell * 0.6, cell * 0.2, 3, 3, { fill: KIN, opacity: 0.25 })]));
    body.push(rect(0, floorY, w, h - floorY, { fill: '#101018' }));
    body.push(rect(0, floorY, w, h - floorY, { fill: url('ic-carpet') }));
    body.push(line(0, floorY, w, floorY, { stroke: mix(SUMI, NEON_C, 0.3), 'stroke-width': 2 }));

    /* Cabinet geometry */
    const cabW = phone ? w * 0.78 : w * 0.3;
    const cabH = phone ? h * 0.76 : h * 0.86;
    const cabX = (w - cabW) / 2 + (phone ? 0 : uniform(rng, -0.04, 0.04) * w);
    const cabY = phone ? h * 0.14 : h * 0.07;

    /* Background cabinets */
    const ghosts = range(rng, phone ? 1 : 2, phone ? 2 : 4);
    const ghostParts: string[] = [];
    for (let i = 0; i < ghosts; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const gw = cabW * uniform(rng, 0.55, 0.75);
      const gh = cabH * uniform(rng, 0.6, 0.78);
      const gx = side < 0 ? cabX - gw * uniform(rng, 0.9, 1.5) : cabX + cabW + gw * uniform(rng, -0.1, 0.5);
      ghostParts.push(ghostCabinet(gx, floorY - gh, gw, gh, pick(rng, [NEON_C, NEON_M, KIN]), darken(bodyColor, 0.3)));
    }
    defs.push(blur('ic-haze', phone ? 5 : 3));
    body.push(g({ filter: url('ic-haze') }, ghostParts));

    /* Marquee glow on the floor and around the cabinet */
    defs.push(blur('ic-aura', phone ? 60 : 44));
    defs.push(linearGradient('ic-floor-glow', [[0, stripes[0]!, 0.4], [1, stripes[0]!, 0]], 90));
    body.push(rect(cabX - cabW * 0.15, floorY, cabW * 1.3, (h - floorY) * 0.8, { fill: url('ic-floor-glow'), filter: url('ic-aura') }));
    body.push(rect(cabX - cabW * 0.08, cabY - cabH * 0.02, cabW * 1.16, cabH * 0.2, { fill: stripes[0], opacity: 0.35, filter: url('ic-aura') }));

    /* Body with side-art stripes */
    body.push(path(roundedRectPath(cabX, cabY, cabW, cabH, cabW * 0.03), { fill: bodyColor }));
    body.push(rect(cabX + 3, cabY + 3, cabW - 6, 3, { fill: WASHI, opacity: 0.1 }));
    const stripeW = cabW * 0.035;
    for (let s = -1; s <= 1; s += 2) {
      const x0 = s < 0 ? cabX + cabW * 0.025 : cabX + cabW * 0.975 - stripeW * 3.2;
      for (let k = 0; k < 3; k++) {
        const x = x0 + k * stripeW * 1.1;
        body.push(polygon([[x, cabY + cabH * 0.17], [x + stripeW, cabY + cabH * 0.17], [x + stripeW + cabW * 0.04 * s, cabY + cabH * 0.95], [x + cabW * 0.04 * s, cabY + cabH * 0.95]], { fill: stripes[k], opacity: 0.85 }));
      }
    }

    /* Marquee */
    const mq: Box = { x: cabX + cabW * 0.06, y: cabY + cabH * 0.025, w: cabW * 0.88, h: cabH * 0.11 };
    defs.push(linearGradient('ic-marquee', [[0, '#0B0B14'], [1, '#14121E']], 90));
    defs.push(glowTwin('ic-neon', phone ? 10 : 7, { opacity: 0.9 }));
    body.push(rect(mq.x, mq.y, mq.w, mq.h, { fill: url('ic-marquee'), rx: 6 }));
    body.push(rect(mq.x, mq.y, mq.w, mq.h, { fill: 'none', stroke: stripes[0], 'stroke-width': phone ? 5 : 4, rx: 6, filter: url('ic-neon') }));
    body.push(rect(mq.x + mq.w * 0.1, mq.y + mq.h * 0.25, mq.w * 0.8, mq.h * 0.5, { fill: stripes[1], opacity: 0.18, rx: mq.h * 0.25, filter: url('ic-aura') }));

    /* Bezel and screen */
    const bz: Box = { x: cabX + cabW * 0.05, y: cabY + cabH * 0.155, w: cabW * 0.9, h: cabH * 0.37 };
    const inset = Math.min(bz.w, bz.h) * 0.06;
    defs.push(crtScreenClip('ic-screen-clip', bz.w, bz.h, { inset }));
    defs.push(vignette('ic-vignette', { strength: 0.7 }));
    defs.push(linearGradient('ic-glass', [[0, FOAM, 0.12], [0.5, FOAM, 0.02], [1, FOAM, 0]], 90));
    const screen: string[] = [];
    screen.push(rect(0, 0, bz.w, bz.h, { fill: phosphor }));
    screen.push(rect(0, 0, bz.w, bz.h, { fill: url('ic-vignette') }));
    // attract-screen frame and divider lines drawn in the phosphor colour
    screen.push(rect(bz.w * 0.1, bz.h * 0.09, bz.w * 0.8, bz.h * 0.84, { fill: 'none', stroke: screenInk, 'stroke-width': phone ? 4 : 3, opacity: 0.6 }));
    screen.push(line(bz.w * 0.14, bz.h * 0.27, bz.w * 0.86, bz.h * 0.27, { stroke: screenInk, 'stroke-width': 2, opacity: 0.5 }));
    screen.push(polygon([[0, bz.h * 0.02], [bz.w * 0.5, bz.h * 0.02], [0, bz.h * 0.6]], { fill: url('ic-glass') }));
    body.push(g({ transform: `translate(${bz.x.toFixed(2)} ${bz.y.toFixed(2)})` }, [g({ 'clip-path': url('ic-screen-clip') }, screen), crtBezel(bz.w, bz.h, { inset, fill: '#0F0F16', highlight: WASHI })]));

    /* Control panel (slanted) */
    const cp: Box = { x: cabX + cabW * 0.04, y: cabY + cabH * 0.545, w: cabW * 0.92, h: cabH * 0.1 };
    body.push(polygon([[cp.x, cp.y], [cp.x + cp.w, cp.y], [cp.x + cp.w + cabW * 0.03, cp.y + cp.h], [cp.x - cabW * 0.03, cp.y + cp.h]], { fill: lighten(bodyColor, 0.08) }));
    body.push(line(cp.x, cp.y, cp.x + cp.w, cp.y, { stroke: WASHI, 'stroke-width': 2, opacity: 0.12 }));
    const stickLeft = chance(rng, 0.7);
    const jx = stickLeft ? cp.x + cp.w * 0.22 : cp.x + cp.w * 0.78;
    const jy = cp.y + cp.h * 0.55;
    const ball = cp.h * 0.22;
    body.push(circle(jx, jy + ball * 0.8, ball * 1.3, { fill: darken(bodyColor, 0.4) }));
    body.push(line(jx, jy + ball * 0.6, jx, jy - ball * 1.6, { stroke: '#3A3A48', 'stroke-width': ball * 0.5, 'stroke-linecap': 'round' }));
    body.push(circle(jx, jy - ball * 1.9, ball, { fill: SHU }));
    body.push(circle(jx - ball * 0.3, jy - ball * 2.2, ball * 0.3, { fill: FOAM, opacity: 0.6 }));
    const buttonColors = shuffle(rng, [NEON_C, NEON_M, KIN, NEON_C, NEON_M, KIN]);
    const bx0 = stickLeft ? cp.x + cp.w * 0.5 : cp.x + cp.w * 0.14;
    for (let i = 0; i < 6; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const bx = bx0 + col * cp.w * 0.14 + row * cp.w * 0.02;
      const by = cp.y + cp.h * (0.32 + row * 0.38);
      body.push(circle(bx, by, ball * 0.78, { fill: darken(bodyColor, 0.5) }));
      body.push(circle(bx, by - 2, ball * 0.62, { fill: buttonColors[i] }));
    }
    body.push(circle(stickLeft ? cp.x + cp.w * 0.92 : cp.x + cp.w * 0.08, cp.y + cp.h * 0.5, ball * 0.45, { fill: FOAM, opacity: 0.85 }));

    /* Coin door and kick plate */
    const cd: Box = { x: cabX + cabW * 0.36, y: cabY + cabH * 0.72, w: cabW * 0.28, h: cabH * 0.16 };
    body.push(path(roundedRectPath(cd.x, cd.y, cd.w, cd.h, 6), { fill: darken(bodyColor, 0.35), stroke: '#3A3A48', 'stroke-width': 2 }));
    body.push(rect(cd.x + cd.w * 0.42, cd.y + cd.h * 0.12, cd.w * 0.16, cd.h * 0.1, { fill: SUMI, rx: 2 }));
    body.push(circle(cd.x + cd.w * 0.5, cd.y + cd.h * 0.42, cd.w * 0.1, { fill: KIN, opacity: 0.9 }));
    body.push(rect(cd.x + cd.w * 0.18, cd.y + cd.h * 0.68, cd.w * 0.26, cd.h * 0.18, { fill: SUMI, rx: 3 }));
    body.push(rect(cd.x + cd.w * 0.56, cd.y + cd.h * 0.68, cd.w * 0.26, cd.h * 0.18, { fill: SUMI, rx: 3 }));
    body.push(rect(cabX, cabY + cabH * 0.95, cabW, cabH * 0.05, { fill: '#0A0A10' }));

    /* Text: marquee name, hi-score table, insert coin */
    const texts: TextLayer[] = [];
    const safe = safeRect(size, 0);
    const nameSize = fitSize(data.nameKana, mq.w * 0.82, mq.h * 0.62, { min: 14, max: mq.h * 0.62 });
    texts.push({ text: data.nameKana, x: mq.x + mq.w / 2, y: mq.y + mq.h / 2 + nameSize * 0.36, size: nameSize, font: FONTS.neon, fill: stripes[1]!, anchor: 'middle', lang: 'ja' });

    const sx = bz.x + inset;
    const sy = bz.y + inset;
    const sw = bz.w - inset * 2;
    const sh = bz.h - inset * 2;
    const headSize = sh * 0.085;
    texts.push({ text: S.hiScore, x: sx + sw / 2, y: sy + sh * 0.2, size: headSize, font: FONTS.pixel, fill: KIN, anchor: 'middle', lang: 'en' });
    const rowSize = sh * 0.07;
    const best = Math.max(0, Math.floor(data.rapidBest));
    const house = shuffle(rng, S.houseInitials);
    const rows: { rank: string; who: string; score: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const rank = S.ranks[i]!;
      if (i === 0) rows.push({ rank, who: initials(data.nameKana) || house[0]!, score: best });
      else rows.push({ rank, who: house[i]!, score: Math.max(0, Math.floor(best * (1 - i * 0.18) - (i > 1 ? range(rng, 0, 3) : 1))) });
    }
    for (let i = 1; i < rows.length; i++) rows[i]!.score = Math.min(rows[i]!.score, Math.max(0, rows[i - 1]!.score - (rows[i - 1]!.score > 0 ? 1 : 0)));
    rows.forEach((r, i) => {
      const y = sy + sh * (0.36 + i * 0.105);
      texts.push({ text: r.rank, x: sx + sw * 0.17, y, size: rowSize, font: FONTS.pixel, fill: i === 0 ? screenInk : mix(screenInk, phosphor, 0.35), anchor: 'start', lang: 'en' });
      texts.push({ text: r.who, x: sx + sw * 0.5, y, size: rowSize, font: FONTS.pixel, fill: i === 0 ? FOAM : mix(FOAM, phosphor, 0.4), anchor: 'middle', lang: 'ja' });
      texts.push({ text: String(r.score).padStart(4, '0'), x: sx + sw * 0.83, y, size: rowSize, font: FONTS.pixel, fill: i === 0 ? KIN : mix(KIN, phosphor, 0.4), anchor: 'end', lang: 'en' });
    });
    texts.push({ text: S.insertCoin, x: sx + sw / 2, y: sy + sh * 0.9, size: sh * 0.062, font: FONTS.pixel, fill: NEON_M, anchor: 'middle', lang: 'en' });

    // every layer must sit in the phone safe band; the geometry above guarantees it, this clamps any drift
    const bottom = safe.y + safe.h;
    for (const t of texts) {
      if (t.y - t.size * 0.88 < safe.y) t.y = safe.y + t.size * 0.9;
      if (t.y + t.size * 0.22 > bottom) t.y = bottom - t.size * 0.25;
    }

    return { svg: svgDoc({ w, h, defs, body }), texts, post: 'scanlines' };
  },
};
