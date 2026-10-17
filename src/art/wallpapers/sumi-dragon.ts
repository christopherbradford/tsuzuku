/**
 * TSUZUKU — kakejiku 'sumi-dragon' 墨龍 (design 06 §3).
 *
 * An ink dragon coiling across washi. The spine is a seeded trochoid
 * (looping across the canvas, down it on the phone) smoothed by Chaikin and
 * resampled to one point per body segment: `segments = clamp(streak, 30,
 * 365)`, where `streak` is the longest streak, so the dragon never shrinks.
 * The body is a brush stroke with a dragon pressure envelope and bristle
 * displacement, over an ink-wash under-stroke; dry-brush hairs in paper
 * colour cross it; a scale tick marks every segment; dorsal fins, four
 * clawed legs, a horned head with whiskers and a mane, ink clouds, splatter
 * and a flaming pearl in the belt colour. One shu seal (朱文) carries the
 * chosen kanji. Palette sumi on washi.
 */
import { mulberry32, range, uniform } from '../../shared/hash';
import { PRESSURE, brushStroke, bristles, inkBleed, sealFrame, splatter, type Pressure } from '../brush';
import { INK, INK_WASH, PALETTE, WASHI, WASHI_LIGHT, beltColor, mix } from '../color';
import { TAU, chaikin, clamp, dist, lerp, norm, perp, polar, resample, sub, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, type TextLayer } from '../jtext';
import { L, M, Q, Z, blur, circle, el, ellipse, g, path, polyPath, radialGradient, rect, svgDoc, turbulence, url } from '../svg';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-2';

export const MIN_SEGMENTS = 30;
export const MAX_SEGMENTS = 365;

/** Thin tail growing into a full body, a slightly narrower neck, gentle undulation. */
export const dragonPressure: Pressure = (t) => {
  const u = clamp(t, 0, 1);
  const tail = Math.min(1, u / 0.38) ** 0.85;
  const neck = u > 0.84 ? 1 - ((u - 0.84) / 0.16) * 0.4 : 1;
  const belly = 1 + 0.1 * Math.sin(u * Math.PI * 7);
  return Math.max(0.05, tail * neck * belly);
};

/** Seeded coiling spine through the canvas (control polygon, before resampling). */
export function dragonSpine(seed: number, w: number, h: number, phone: boolean): Pt[] {
  const rng = mulberry32(seed ^ 0x647261);
  const n = 28;
  const turns = uniform(rng, 1.4, 2.6);
  const phase = uniform(rng, 0, TAU);
  const wob = uniform(rng, 3, 8);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = phase + t * TAU * turns;
    if (!phone) {
      const R = h * uniform(rng, 0.24, 0.3);
      const x = lerp(w * 0.13, w * 0.87, t) + Math.cos(a) * R * 0.55;
      const y = h * 0.5 + Math.sin(a) * R * (0.75 + 0.25 * Math.sin(t * wob + phase));
      pts.push([clamp(x, w * 0.04, w * 0.96), clamp(y, h * 0.08, h * 0.92)]);
    } else {
      const R = w * uniform(rng, 0.27, 0.34);
      const x = w * 0.5 + Math.sin(a) * R * (0.8 + 0.2 * Math.cos(t * wob + phase));
      const y = lerp(h * 0.22, h * 0.84, t) + Math.cos(a) * R * 0.4;
      pts.push([clamp(x, w * 0.06, w * 0.94), clamp(y, h * 0.1, h * 0.93)]);
    }
  }
  return chaikin(pts, 2);
}

function segmentsFor(streak: number): number {
  return clamp(Math.floor(streak), MIN_SEGMENTS, MAX_SEGMENTS);
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const segments = segmentsFor(data.streak);
  const spine = resample(dragonSpine(seed, w, h, phone), segments + 1);
  const width = phone ? w * 0.085 : h * 0.078;
  const shu = PALETTE.light.shu;
  const belt = beltColor(data.belt);

  const defs = [
    inkBleed('bleed', seed % 991, { scale: 7, blur: 0.6, frequency: 0.03 }),
    inkBleed('bleed2', (seed >>> 3) % 991, { scale: 4, blur: 0.4, frequency: 0.05 }),
    blur('wash', phone ? 34 : 28),
    turbulence('paper', { baseFrequency: 0.9, octaves: 2, seed: seed % 211, alpha: 0.12 }),
    radialGradient('pearl', [[0, WASHI_LIGHT], [0.35, belt], [1, mix(belt, INK, 0.35)]], { cx: 0.4, cy: 0.35 }),
    radialGradient('pearlGlow', [[0, PALETTE.light.kin, 0.45], [1, PALETTE.light.kin, 0]]),
  ];

  // Ink clouds: soft wash ellipses around the composition.
  const clouds: string[] = [];
  const nClouds = range(rng, 3, 6);
  for (let i = 0; i < nClouds; i++) {
    const cx = uniform(rng, 0.1, 0.9) * w;
    const cy = uniform(rng, 0.1, 0.9) * h;
    const rx = uniform(rng, 0.12, 0.26) * w;
    const ry = rx * uniform(rng, 0.22, 0.4);
    clouds.push(ellipse(cx, cy, rx, ry, { fill: INK_WASH, opacity: uniform(rng, 0.05, 0.11) }));
  }

  // Body: wash under-stroke, main stroke, paper-coloured dry hairs.
  const under = path(brushStroke(spine, { width: width * 1.3, pressure: dragonPressure, seed: seed ^ 0x77, bristle: 0.3, frequency: 7 }), {
    fill: INK_WASH,
    opacity: 0.32,
    filter: url('wash'),
  });
  const bodyStroke = path(brushStroke(spine, { width, pressure: dragonPressure, seed: seed ^ 0x1234, bristle: 0.24, frequency: 11 }), { fill: INK });
  const hairs = bristles(spine, { width: width * 0.8, seed: seed ^ 0x99, count: 5, gap: 0.55, pressure: dragonPressure, samples: Math.min(120, segments) }).map((d) =>
    path(d, { fill: 'none', stroke: WASHI, 'stroke-width': Math.max(0.8, width * 0.025), 'stroke-linecap': 'round', opacity: 0.8 }),
  );

  // One tick per segment across the belly, and dorsal fins along the back.
  let ticks = '';
  let fins = '';
  for (let i = 1; i < spine.length - 1; i++) {
    const t = i / (spine.length - 1);
    const p = spine[i]!;
    const tan = norm(sub(spine[i + 1]!, spine[i - 1]!));
    const nrm = perp(tan);
    const half = (width * dragonPressure(t)) / 2;
    const a: Pt = [p[0] - nrm[0] * half * 0.22, p[1] - nrm[1] * half * 0.22];
    const b: Pt = [p[0] - nrm[0] * half * 0.74, p[1] - nrm[1] * half * 0.74];
    ticks += M(a[0], a[1]) + Q((a[0] + b[0]) / 2 + tan[0] * half * 0.3, (a[1] + b[1]) / 2 + tan[1] * half * 0.3, b[0], b[1]);
    if (i % Math.max(4, Math.round(segments / 30)) === 0 && t > 0.24 && t < 0.84) {
      const len = half * uniform(rng, 1.3, 2.2);
      const sweep = half * uniform(rng, 1.1, 1.7);
      const base0: Pt = [p[0] + nrm[0] * half * 0.85 - tan[0] * half * 0.35, p[1] + nrm[1] * half * 0.85 - tan[1] * half * 0.35];
      const base1: Pt = [p[0] + nrm[0] * half * 0.85 + tan[0] * half * 0.5, p[1] + nrm[1] * half * 0.85 + tan[1] * half * 0.5];
      const tip: Pt = [base0[0] + nrm[0] * len - tan[0] * sweep, base0[1] + nrm[1] * len - tan[1] * sweep];
      const ctl: Pt = [base1[0] + nrm[0] * len * 0.6 - tan[0] * sweep * 0.05, base1[1] + nrm[1] * len * 0.6 - tan[1] * sweep * 0.05];
      fins += M(base0[0], base0[1]) + L(tip[0], tip[1]) + Q(ctl[0], ctl[1], base1[0], base1[1]) + Z;
    }
  }
  const tickPath = path(ticks, { class: 'scales', fill: 'none', stroke: WASHI_LIGHT, 'stroke-width': Math.max(0.6, width * 0.014), opacity: 0.42 });
  const finPath = path(fins, { fill: INK });

  // Legs with claws at four stations along the body.
  const legs: string[] = [];
  const legT = phone ? [0.3, 0.46, 0.64, 0.8] : [0.32, 0.48, 0.66, 0.8];
  legT.forEach((lt, k) => {
    const i = Math.round(lt * (spine.length - 1));
    const p = spine[i]!;
    const tan = norm(sub(spine[Math.min(spine.length - 1, i + 1)]!, spine[Math.max(0, i - 1)]!));
    const nrm = perp(tan);
    const side = k % 2 === 0 ? 1 : -1;
    const half = (width * dragonPressure(lt)) / 2;
    const root: Pt = [p[0] + nrm[0] * half * 0.6 * side, p[1] + nrm[1] * half * 0.6 * side];
    const ang = Math.atan2(nrm[1] * side, nrm[0] * side) + uniform(rng, -0.5, 0.5) - 0.35;
    const knee = polar(root[0], root[1], half * 1.5, ang);
    const foot = polar(knee[0], knee[1], half * 1.3, ang + 1.1 * side);
    legs.push(path(brushStroke([root, knee, foot], { width: half * 0.75, pressure: PRESSURE.taper, seed: seed ^ (k * 31), bristle: 0.3 }), { fill: INK }));
    for (let c = -1; c <= 1; c++) {
      const ca = ang + 1.1 * side + c * 0.45 + 0.4 * side;
      const tipP = polar(foot[0], foot[1], half * 0.9, ca);
      legs.push(path(brushStroke([foot, polar(foot[0], foot[1], half * 0.45, ca - 0.25 * c), tipP], { width: half * 0.26, pressure: PRESSURE.fade, seed: seed ^ (k * 7 + c) }), { fill: INK }));
    }
  });

  // Head: one stroke from inside the neck through the snout (no seam), a lower jaw, horns on top, whiskers, mane, eye.
  const headP = spine[spine.length - 1]!;
  const dir = norm(sub(headP, spine[spine.length - 3]!));
  const hn = perp(dir);
  const hw = width * dragonPressure(1);
  const snoutMid: Pt = [headP[0] + dir[0] * hw * 1.0 - hn[0] * hw * 0.12, headP[1] + dir[1] * hw * 1.0 - hn[1] * hw * 0.12];
  const snoutEnd: Pt = [headP[0] + dir[0] * hw * 2.0 - hn[0] * hw * 0.4, headP[1] + dir[1] * hw * 2.0 - hn[1] * hw * 0.4];
  const headPressure: Pressure = (t) => (t < 0.72 ? 1 : Math.max(0.35, 1 - ((t - 0.72) / 0.28) * 0.6));
  const head: string[] = [path(brushStroke([spine[spine.length - 4]!, headP, snoutMid, snoutEnd], { width: hw * 1.12, pressure: headPressure, seed: seed ^ 0x51, bristle: 0.16, frequency: 4 }), { fill: INK })];
  const jawEnd: Pt = [snoutMid[0] + dir[0] * hw * 0.75 + hn[0] * hw * 0.6, snoutMid[1] + dir[1] * hw * 0.75 + hn[1] * hw * 0.6];
  const jawMid: Pt = [headP[0] + dir[0] * hw * 0.7 + hn[0] * hw * 0.45, headP[1] + dir[1] * hw * 0.7 + hn[1] * hw * 0.45];
  head.push(path(brushStroke([headP, jawMid, jawEnd], { width: hw * 0.5, pressure: PRESSURE.taper, seed: seed ^ 0x52, bristle: 0.2 }), { fill: INK }));
  for (const s of [1, -1] as const) {
    const base: Pt = [headP[0] - hn[0] * hw * (0.3 + 0.1 * s) + dir[0] * hw * 0.2 * s, headP[1] - hn[1] * hw * (0.3 + 0.1 * s) + dir[1] * hw * 0.2 * s];
    const mid: Pt = [base[0] - hn[0] * hw * 0.9 - dir[0] * hw * (0.5 + 0.25 * s), base[1] - hn[1] * hw * 0.9 - dir[1] * hw * (0.5 + 0.25 * s)];
    const tip: Pt = [mid[0] - hn[0] * hw * 0.5 - dir[0] * hw * 1.1, mid[1] - hn[1] * hw * 0.5 - dir[1] * hw * 1.1];
    head.push(path(brushStroke([base, mid, tip], { width: hw * 0.34, pressure: PRESSURE.taper, seed: seed ^ (0x61 + s) }), { fill: INK }));
    const wStart: Pt = [snoutMid[0] + dir[0] * hw * 0.5 + hn[0] * hw * 0.25 * s, snoutMid[1] + dir[1] * hw * 0.5 + hn[1] * hw * 0.25 * s];
    const wCtl: Pt = [wStart[0] + dir[0] * hw * 1.7 + hn[0] * hw * 1.3 * s, wStart[1] + dir[1] * hw * 1.7 + hn[1] * hw * 1.3 * s];
    const wEnd: Pt = [wStart[0] + dir[0] * hw * 2.5 + hn[0] * hw * 2.5 * s, wStart[1] + dir[1] * hw * 2.5 + hn[1] * hw * 2.5 * s];
    head.push(path(M(wStart[0], wStart[1]) + Q(wCtl[0], wCtl[1], wEnd[0], wEnd[1]), { fill: 'none', stroke: INK, 'stroke-width': Math.max(1.2, hw * 0.05), 'stroke-linecap': 'round' }));
  }
  const nMane = range(rng, 6, 9);
  const back = Math.atan2(-dir[1], -dir[0]);
  for (let i = 0; i < nMane; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const a = back + s * uniform(rng, 0.25, 1.05);
    const root: Pt = [headP[0] - dir[0] * hw * 0.35 + hn[0] * hw * 0.45 * s, headP[1] - dir[1] * hw * 0.35 + hn[1] * hw * 0.45 * s];
    const mid = polar(root[0], root[1], hw * uniform(rng, 0.9, 1.4), a);
    const tip = polar(mid[0], mid[1], hw * uniform(rng, 0.8, 1.3), a + s * 0.45);
    head.push(path(brushStroke([root, mid, tip], { width: hw * 0.28, pressure: PRESSURE.fade, seed: seed ^ (0x300 + i), bristle: 0.3 }), { fill: INK, opacity: 0.92 }));
  }
  const eye: Pt = [headP[0] + dir[0] * hw * 0.6 - hn[0] * hw * 0.22, headP[1] + dir[1] * hw * 0.6 - hn[1] * hw * 0.22];
  head.push(circle(eye[0], eye[1], hw * 0.17, { fill: WASHI }));
  head.push(circle(eye[0] + dir[0] * hw * 0.05, eye[1] + dir[1] * hw * 0.05, hw * 0.085, { fill: INK }));

  // The flaming pearl ahead of the snout, in the belt colour.
  const pearl: Pt = [clamp(snoutEnd[0] + dir[0] * hw * 1.3 - hn[0] * hw * 1.05, hw, w - hw), clamp(snoutEnd[1] + dir[1] * hw * 1.3 - hn[1] * hw * 1.05, hw, h - hw)];
  const pr = hw * 0.42;
  const pearlG = g(undefined, [circle(pearl[0], pearl[1], pr * 2.6, { fill: url('pearlGlow') }), circle(pearl[0], pearl[1], pr, { fill: url('pearl') })]);

  // Splatter at the tail flick and under the head.
  const tail = spine[0]!;
  const spl = path(splatter(tail[0], tail[1], width * 1.4, seed ^ 0x5, 12) + splatter(headP[0], headP[1], width * 2, seed ^ 0x9, 9), { fill: INK, opacity: 0.85 });

  // Seal (朱文: frame and glyph in shu).
  const sealSize = phone ? 150 : 124;
  const safe = safeRect(size);
  const sealY = phone ? safe.y + safe.h - sealSize - 40 : h - sealSize - h * 0.08;
  const candidates = [w * 0.06, w - sealSize - w * 0.06];
  const clearance = (x: number): number => {
    const c: Pt = [x + sealSize / 2, sealY + sealSize / 2];
    let best = Infinity;
    for (const p of spine) best = Math.min(best, dist(p, c));
    return Math.min(best, dist(pearl, c));
  };
  const sealRight = clearance(candidates[1]!) >= clearance(candidates[0]!);
  const sealX = sealRight ? candidates[1]! : candidates[0]!;
  const seal = path(sealFrame({ x: sealX, y: sealY, size: sealSize, round: false, seed: seed ^ 0xa1, stroke: sealSize * 0.075, erode: 0.015 }), { fill: shu, 'fill-rule': 'evenodd', opacity: 0.92 });

  const body = [
    rect(0, 0, w, h, { fill: WASHI_LIGHT, filter: url('paper') }),
    g({ filter: url('wash') }, clouds),
    under,
    g({ filter: url('bleed') }, [bodyStroke, finPath, ...legs, ...head]),
    g(undefined, hairs),
    tickPath,
    g({ filter: url('bleed2') }, [spl]),
    pearlG,
    g({ filter: url('bleed2') }, [seal]),
  ];

  // Text layers.
  const texts: TextLayer[] = [];
  const nameSize = fitSize(data.nameKana, phone ? w * 0.6 : w * 0.4, phone ? 86 : 78, { min: 30, max: phone ? 86 : 78 });
  const nameX = phone ? w * 0.08 : w * 0.06;
  const nameY = phone ? safe.y + 140 : h * 0.16;
  texts.push({ text: data.nameKana, x: nameX, y: nameY, size: nameSize, font: FONTS.brush, fill: INK, opacity: 0.95, lang: 'ja' });
  texts.push({ text: `${S.longestStreak} ${data.streak}${S.daysUnit}`, x: nameX + 2, y: nameY + (phone ? 64 : 54), size: phone ? 32 : 28, font: FONTS.mincho, fill: INK_WASH, lang: 'ja' });
  texts.push({ text: S.dragonTitle, x: phone ? w * 0.9 : w * 0.955, y: phone ? safe.y + 50 : h * 0.07, size: phone ? 44 : 38, font: FONTS.brush, fill: INK, vertical: true, opacity: 0.85, lang: 'ja' });
  const glyph = data.chosenKanji ?? S.defaultSeal;
  texts.push({ text: glyph, x: sealX + sealSize / 2, y: sealY + sealSize * 0.74, size: sealSize * 0.6, font: FONTS.brush, fill: shu, anchor: 'middle', opacity: 0.92, lang: 'ja' });
  texts.push({
    text: eraDate(data.date),
    x: sealRight ? sealX - 24 : sealX + sealSize + 24,
    y: sealY + sealSize - 6,
    size: phone ? 24 : 22,
    font: FONTS.mincho,
    fill: INK_WASH,
    anchor: sealRight ? 'end' : 'start',
    lang: 'ja',
  });

  const svg = svgDoc({ w, h, bg: WASHI, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'grain' };
}

export const spec: WallpaperSpec = { id: 'sumi-dragon', living: true, compose };
