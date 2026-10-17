/**
 * TSUZUKU — kakejiku 'daruma' 達磨 (design 06 §3). Living piece.
 *
 * A vermilion daruma on washi, painted in brush: wet-ink body edge, cream
 * face with gold rim, ink brows and beard, gold ribbons and flecks. The
 * daruma's LEFT eye (the viewer's right, as tradition paints it first) is
 * filled at Blue Shinsa, the RIGHT eye at Shodan — `data.belt` decides, so
 * the piece upgrades in place. The belly carries the chosen kanji (福 until
 * one is chosen); the cushion underneath is the belt colour.
 *
 * Layers: washi with ink wash → optional gold ensō → cushion → body →
 * ribbons → face, brows, eyes, beard → flecks. Text (belly kanji, name in
 * tategaki, era date) is returned as TextLayers inside the phone safe zone.
 * Pure for (seed, data, size).
 */
import { chance, hashSeed, mulberry32, range, uniform } from '../../shared/hash';
import { BELT_IDS, type Belt } from '../../content/types';
import { PRESSURE, brushStroke, enso, inkBleed, splatter } from '../brush';
import { INK, INK_WASH, PALETTE, SHOJI, WASHI, beltColor, darken, mix } from '../color';
import { chaikin, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, tategakiLayers, type TextLayer } from '../jtext';
import { noise1 } from '../noise';
import { blur, circle, ellipse, g, path, polyPath, radialGradient, safeRect, sizeOf, svgDoc, url } from '../svg';
import type { WallpaperSpec } from './spec';
import { S } from './strings-3';

const SHU = PALETTE.light.shu;
const KIN = PALETTE.light.kin;
const GOLD = mix(PALETTE.dark.kin, WASHI, 0.1);

/** Which eyes are painted: the daruma's left at Blue Shinsa (belt ≥ blue), the right at Shodan (black). */
export function darumaEyes(belt: Belt): { left: boolean; right: boolean } {
  return { left: BELT_IDS.indexOf(belt) >= BELT_IDS.indexOf('blue'), right: belt === 'black' };
}

/** Daruma outline: an egg heavier at the bottom, brush-wobbled, 2n points clockwise. */
function darumaOutline(cx: number, cy: number, W: number, D: number, seed: number): Pt[] {
  const wob = noise1(mulberry32(seed));
  const n = 48;
  const right: Pt[] = [];
  const left: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const v = i / n; // 0 top → 1 bottom
    const e = Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2));
    const heavy = 0.76 + 0.34 * v - 0.18 * Math.max(0, v - 0.82) * 5; // bellies out, then tucks under
    const hw = (W / 2) * e * heavy * (1 + (wob(v * 6) - 0.5) * 0.035);
    const y = cy - D / 2 + v * D * (v > 0.9 ? 1 - (v - 0.9) * 0.35 : 1);
    right.push([cx + hw, y]);
    left.push([cx - hw * (1 + (wob(v * 6 + 11) - 0.5) * 0.03), y]);
  }
  return [...right, ...left.reverse()];
}

export const spec: WallpaperSpec = {
  id: 'daruma',
  living: true,
  compose(seed, data, size) {
    const { w, h } = sizeOf(size);
    const phone = size === 'phone';
    const rng = mulberry32(seed);
    const defs: string[] = [];
    const body: string[] = [];
    const { left: leftEye, right: rightEye } = darumaEyes(data.belt);

    /* Geometry */
    const D = phone ? h * 0.42 : h * 0.74;
    const W = D * uniform(rng, 0.82, 0.9);
    const cx = w / 2 + (phone ? 0 : uniform(rng, -0.04, 0.02) * w);
    const cy = phone ? h * 0.5 : h * 0.52;
    const tilt = uniform(rng, -3.5, 3.5);

    /* Washi with ink wash */
    defs.push(blur('dr-wash', phone ? 90 : 70));
    const washes: string[] = [];
    for (let i = 0; i < 3; i++) washes.push(ellipse(uniform(rng, 0.1, 0.9) * w, uniform(rng, 0.1, 0.9) * h, w * uniform(rng, 0.2, 0.4), h * uniform(rng, 0.15, 0.3), { fill: INK_WASH, opacity: uniform(rng, 0.05, 0.1) }));
    body.push(g({ filter: url('dr-wash') }, washes));

    /* Gold ensō behind (seeded) */
    defs.push(inkBleed('dr-bleed', seed, { scale: phone ? 7 : 5, blur: 0.8 }));
    if (chance(rng, 0.65)) {
      const r = D * uniform(rng, 0.5, 0.62);
      body.push(path(enso(cx + uniform(rng, -0.04, 0.04) * w, cy - D * 0.05, r, hashSeed(seed, 'enso'), { width: r * 0.16, gap: uniform(rng, 0.4, 0.8) }), { fill: KIN, opacity: 0.28, filter: url('dr-bleed') }));
    }

    /* Cushion in the belt colour */
    const belt = beltColor(data.belt);
    const cushY = cy + D / 2 - D * 0.02;
    body.push(ellipse(cx, cushY + D * 0.03, W * 0.68, D * 0.07, { fill: darken(belt, 0.35), opacity: 0.9 }));
    body.push(ellipse(cx, cushY, W * 0.66, D * 0.065, { fill: belt, stroke: darken(belt, 0.3), 'stroke-width': 3 }));
    body.push(ellipse(cx, cushY - D * 0.01, W * 0.5, D * 0.035, { fill: mix(belt, WASHI, 0.18), opacity: 0.5 }));

    /* Body */
    const outline = darumaOutline(cx, cy, W, D, hashSeed(seed, 'body'));
    defs.push(radialGradient('dr-shu', [[0, mix(SHU, '#FF8A66', 0.35)], [0.55, SHU], [1, darken(SHU, 0.35)]], { cx: 0.38, cy: 0.3, r: 0.75 }));
    const main: string[] = [];
    main.push(path(polyPath(outline, true), { fill: url('dr-shu'), filter: url('dr-bleed') }));

    // gold ribbons: belly band and two side curls
    const ribbonSeed = hashSeed(seed, 'ribbon');
    const faceCy = cy - D * 0.13;
    const faceRx = W * 0.3;
    const faceRy = D * 0.25;
    const band: Pt[] = chaikin([[cx - W * 0.36, cy + D * 0.08], [cx - W * 0.16, cy + D * 0.14], [cx + W * 0.16, cy + D * 0.14], [cx + W * 0.36, cy + D * 0.08]], 2);
    main.push(path(brushStroke(band, { width: W * 0.05, pressure: PRESSURE.swell, seed: ribbonSeed, bristle: 0.25 }), { fill: GOLD }));
    for (let s = -1; s <= 1; s += 2) {
      const curl: Pt[] = chaikin([
        [cx + s * faceRx * 0.9, faceCy - faceRy * 0.6],
        [cx + s * faceRx * 1.25, faceCy + faceRy * 0.1 + uniform(rng, -0.03, 0.03) * D],
        [cx + s * faceRx * 1.15, faceCy + faceRy * 0.9],
        [cx + s * W * 0.36, cy + D * 0.1],
      ], 3);
      main.push(path(brushStroke(curl, { width: W * 0.04, pressure: PRESSURE.taper, seed: ribbonSeed + s, bristle: 0.3 }), { fill: GOLD }));
    }
    main.push(path(brushStroke([[cx - W * 0.1, cy - D / 2 + D * 0.04], [cx, cy - D / 2 + D * 0.015], [cx + W * 0.1, cy - D / 2 + D * 0.04]], { width: W * 0.035, pressure: PRESSURE.swell, seed: ribbonSeed + 7 }), { fill: GOLD }));

    // face
    main.push(ellipse(cx, faceCy, faceRx * 1.06, faceRy * 1.05, { fill: GOLD }));
    main.push(ellipse(cx, faceCy, faceRx, faceRy, { fill: SHOJI }));

    // brows: thick, crane-wing curves
    const browY = faceCy - faceRy * 0.45;
    for (let s = -1; s <= 1; s += 2) {
      const brow: Pt[] = chaikin([[cx + s * faceRx * 0.1, browY + faceRy * 0.08], [cx + s * faceRx * 0.42, browY - faceRy * 0.12 + uniform(rng, -0.04, 0.04) * faceRy], [cx + s * faceRx * 0.78, browY + faceRy * 0.12]], 2);
      main.push(path(brushStroke(brow, { width: faceRy * 0.19, pressure: PRESSURE.swell, seed: hashSeed(seed, 'brow', s), bristle: 0.3 }), { fill: INK }));
    }

    // eyes: the daruma's left eye is on the viewer's right
    const eyeR = faceRx * 0.26;
    const eyeY = faceCy - faceRy * 0.05;
    const eyes: [number, boolean][] = [[cx + faceRx * 0.45, leftEye], [cx - faceRx * 0.45, rightEye]];
    for (const [ex, painted] of eyes) {
      main.push(circle(ex, eyeY, eyeR, { fill: '#FFFFFF', stroke: INK, 'stroke-width': Math.max(2, eyeR * 0.14) }));
      if (painted) {
        main.push(circle(ex + eyeR * 0.04, eyeY + eyeR * 0.06, eyeR * 0.7, { fill: INK, filter: url('dr-bleed') }));
        main.push(circle(ex - eyeR * 0.22, eyeY - eyeR * 0.24, eyeR * 0.14, { fill: '#FFFFFF', opacity: 0.8 }));
      }
    }

    // nose, moustache and beard
    main.push(path(brushStroke([[cx, eyeY + faceRy * 0.15], [cx - faceRx * 0.03, eyeY + faceRy * 0.42]], { width: faceRy * 0.08, pressure: PRESSURE.taper, seed: hashSeed(seed, 'nose') }), { fill: INK }));
    const mouthY = eyeY + faceRy * 0.55;
    for (let s = -1; s <= 1; s += 2) {
      const mo: Pt[] = chaikin([[cx + s * faceRx * 0.06, mouthY], [cx + s * faceRx * 0.3, mouthY - faceRy * 0.06], [cx + s * faceRx * 0.52, mouthY + faceRy * 0.16]], 2);
      main.push(path(brushStroke(mo, { width: faceRy * 0.11, pressure: PRESSURE.swell, seed: hashSeed(seed, 'mo', s), bristle: 0.3 }), { fill: INK }));
    }
    const beardN = range(rng, 3, 5);
    for (let i = 0; i < beardN; i++) {
      const t = beardN === 1 ? 0 : (i / (beardN - 1)) * 2 - 1;
      const bx = cx + t * faceRx * 0.3;
      const by0 = mouthY + faceRy * 0.18;
      main.push(path(brushStroke([[bx, by0], [bx + t * faceRx * 0.12, by0 + faceRy * 0.22 + (1 - Math.abs(t)) * faceRy * 0.1]], { width: faceRy * 0.07, pressure: PRESSURE.taper, seed: hashSeed(seed, 'beard', i) }), { fill: INK }));
    }

    // gold flecks on the body and around it
    const flecks: string[] = [];
    for (let i = 0; i < 5; i++) flecks.push(path(splatter(cx + uniform(rng, -0.45, 0.45) * W, cy + uniform(rng, -0.1, 0.45) * D, W * uniform(rng, 0.08, 0.16), hashSeed(seed, 'fleck', i), range(rng, 8, 16)), { fill: GOLD, opacity: 0.85 }));
    main.push(g(undefined, flecks));

    body.push(g({ transform: `rotate(${tilt.toFixed(2)} ${cx.toFixed(1)} ${(cy + D / 2).toFixed(1)})` }, main));

    const dust: string[] = [];
    const dustN = range(rng, 50, 90);
    for (let i = 0; i < dustN; i++) dust.push(circle(uniform(rng, 0, 1) * w, uniform(rng, 0, 1) * h, uniform(rng, 1, 3.5), { fill: KIN, opacity: uniform(rng, 0.15, 0.6) }));
    body.push(g(undefined, dust));

    /* Text: belly kanji, name, date */
    const texts: TextLayer[] = [];
    const safe = safeRect(size, 0);
    const margin = phone ? 84 : 72;
    const kanji = data.chosenKanji ?? S.darumaFallbackKanji;
    const kSize = W * 0.3;
    texts.push({ text: kanji, x: cx, y: cy + D * 0.3 + kSize * 0.36, size: kSize, font: FONTS.brush, fill: GOLD, anchor: 'middle', rotate: tilt, lang: 'ja' });
    const colTop = safe.y + (phone ? 70 : 56);
    // No floor: a name at NAME_MAX_GLYPHS must shrink to fit its box (review round 2).
    const nameSize = fitSize(data.nameKana, phone ? 70 : 56, safe.h * 0.42, { vertical: true, max: phone ? 58 : 46 });
    texts.push(...tategakiLayers({ text: data.nameKana, x: w - margin - nameSize / 2, y: colTop, size: nameSize, font: FONTS.mincho, fill: INK }));
    const small = phone ? 30 : 24;
    texts.push({ text: eraDate(data.date), x: w - margin, y: safe.y + safe.h - (phone ? 56 : 48), size: small, font: FONTS.mincho, fill: INK_WASH, anchor: 'end', lang: 'ja' });

    return { svg: svgDoc({ w, h, bg: WASHI, defs, body }), texts, post: 'grain' };
  },
};
