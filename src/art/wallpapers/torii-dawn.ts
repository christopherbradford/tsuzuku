/**
 * TSUZUKU — kakejiku 'torii-dawn' 朝の鳥居 (design 06 §3).
 *
 * Five 1-D noise ridges recede from a kon-to-sakura dawn sky; mist bands
 * (feGaussianBlur) pool in the valleys; one vermilion torii stands on the
 * nearest ridge against the rising sun, and from its nuki hangs an ema that
 * carries the learner's name. Belt colour on the ema cord; the chosen kanji
 * on a shu seal beside the era date.
 *
 * Seed → horizon height, sky darkness, sun and torii placement, ridge
 * profiles, birds. Personal text is returned as `TextLayer`s only.
 */
import { hashSeed, mulberry32, range, uniform } from '../../shared/hash';
import { sealFrame } from '../brush';
import { INK, NIGHT, PALETTE, SUMI, WARM, WASHI, WASHI_LIGHT, beltColor, darken, lighten, mix, mixOklab } from '../color';
import { FONTS, eraDate, layoutInBox, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { L, M, Q, Z, blur, circle, g, line, linearGradient, path, polygon, radialGradient, rect, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';

const P = 'td';
const RIDGES = 5;
const PTS = 72;

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size, phone ? 48 : 40);
  const kon = PALETTE.light.kon;
  const shu = PALETTE.light.shu;
  const sakura = PALETTE.dark.sakura;
  const defs: string[] = [];
  const body: string[] = [];
  const texts: TextLayer[] = [];

  /* Sky */
  const horizon = h * uniform(rng, phone ? 0.56 : 0.58, phone ? 0.63 : 0.67);
  const nightness = uniform(rng, 0, 0.6);
  const skyTop = mix(kon, NIGHT, nightness);
  defs.push(
    linearGradient(`${P}-sky`, [
      [0, skyTop],
      [0.42, mixOklab(kon, sakura, 0.35 + nightness * 0.1)],
      [0.78, mixOklab(sakura, '#F08A24', 0.22)],
      [1, lighten(sakura, 0.35)],
    ]),
  );
  body.push(rect(0, 0, w, horizon + 2, { fill: url(`${P}-sky`) }));
  if (nightness > 0.3) {
    let d = '';
    const n = range(rng, 20, 60);
    for (let i = 0; i < n; i++) {
      const x = uniform(rng, 0, w);
      const y = uniform(rng, 0, horizon * 0.45);
      const s = uniform(rng, 1.2, 2.6);
      d += M(x, y) + L(x + s, y) + L(x + s, y + s) + L(x, y + s) + Z;
    }
    body.push(path(d, { fill: WASHI, opacity: (nightness - 0.3) * 1.5 }));
  }

  /* Sun, framed by the torii drawn below */
  const tx = w * uniform(rng, 0.3, 0.7);
  const sunX = tx + w * uniform(rng, -0.09, 0.09);
  const sunR = h * (phone ? 0.045 : 0.07);
  const sunY = horizon - sunR * uniform(rng, 0.2, 1.1);
  defs.push(
    radialGradient(`${P}-glow`, [
      [0, WARM, 0.85],
      [0.35, sakura, 0.4],
      [1, sakura, 0],
    ]),
  );
  body.push(circle(sunX, sunY, sunR * 4.5, { fill: url(`${P}-glow`) }));
  body.push(circle(sunX, sunY, sunR, { fill: mix(WARM, WASHI_LIGHT, 0.45) }));

  /* Birds */
  const birds = range(rng, 3, 7);
  let bd = '';
  for (let i = 0; i < birds; i++) {
    const x = uniform(rng, w * 0.05, w * 0.95);
    const y = uniform(rng, horizon * 0.12, horizon * 0.5);
    const s = uniform(rng, 0.6, 1.4) * (phone ? 11 : 12);
    bd += M(x - s, y) + Q(x - s / 2, y - s * 0.7, x, y) + Q(x + s / 2, y - s * 0.7, x + s, y);
  }
  body.push(path(bd, { fill: 'none', stroke: INK, 'stroke-width': phone ? 2.4 : 2, 'stroke-linecap': 'round', opacity: 0.8 }));

  /* Ridges and mist */
  defs.push(blur(`${P}-mist`, phone ? 28 : 22));
  const stepY = (h - horizon) / 5.4;
  const amps = [0.17, 0.14, 0.11, 0.09, 0.075].map((a) => a * h * (phone ? 0.72 : 1));
  const colors = [mixOklab(sakura, kon, 0.38), mixOklab(sakura, kon, 0.58), mix(kon, INK, 0.2), mix(kon, INK, 0.5), mix(kon, SUMI, 0.75)];
  const ridges: number[][] = [];
  for (let i = 0; i < RIDGES; i++) {
    const hs = ridge(hashSeed(seed, 'ridge', i), PTS, amps[i]!, { roughness: 0.28 + (0.14 * i) / RIDGES });
    ridges.push(hs);
    const base = horizon + i * stepY;
    const poly: [number, number][] = hs.map((v, k) => [(-0.02 + (1.04 * k) / (PTS - 1)) * w, base - v]);
    poly.push([w * 1.02, h + 2], [-w * 0.02, h + 2]);
    body.push(polygon(poly, { fill: colors[i]! }));
    if (i < RIDGES - 1) {
      body.push(rect(-w * 0.05, base - stepY * 0.12, w * 1.1, stepY * 0.58, { fill: WASHI, opacity: 0.16 + 0.12 * (1 - i / RIDGES), filter: url(`${P}-mist`) }));
    }
  }

  /* Torii on the nearest ridge */
  const near = ridges[RIDGES - 1]!;
  const nearBase = horizon + (RIDGES - 1) * stepY;
  const groundAt = (x: number): number => {
    const u = ((x / w + 0.02) / 1.04) * (PTS - 1);
    const i = Math.max(0, Math.min(PTS - 2, Math.floor(u)));
    const t = Math.max(0, Math.min(1, u - i));
    return nearBase - (near[i]! * (1 - t) + near[i + 1]! * t);
  };
  const gy = groundAt(tx) + 6;
  const th = phone ? h * 0.2 : h * 0.3;
  const pw = th * 0.62;
  const top = gy - th;
  defs.push(linearGradient(`${P}-torii`, [[0, mix(shu, SUMI, 0.3 + nightness * 0.2)], [1, mix(shu, SUMI, 0.68)]]));
  const T: string[] = [];
  const pillarW = th * 0.055;
  for (const s of [-1, 1]) {
    const xb = tx + (s * pw) / 2;
    const xt = tx + (s * pw * 0.95) / 2;
    T.push(polygon([[xb - pillarW / 2, gy], [xb + pillarW / 2, gy], [xt + pillarW / 2, top + th * 0.1], [xt - pillarW / 2, top + th * 0.1]]));
    T.push(rect(xb - pillarW * 0.9, gy - th * 0.05, pillarW * 1.8, th * 0.05));
  }
  const nukiY = top + th * 0.3;
  T.push(rect(tx - pw / 2 - th * 0.09, nukiY, pw + th * 0.18, th * 0.05));
  T.push(rect(tx - pw / 2 - th * 0.14, top + th * 0.1, pw + th * 0.28, th * 0.06));
  T.push(rect(tx - th * 0.035, top + th * 0.16, th * 0.07, th * 0.14));
  const kx0 = tx - pw / 2 - th * 0.21;
  const kx1 = tx + pw / 2 + th * 0.21;
  T.push(path(M(kx0, top - th * 0.04) + Q(tx, top + th * 0.03, kx1, top - th * 0.04) + L(kx1, top + th * 0.045) + Q(tx, top + th * 0.125, kx0, top + th * 0.045) + Z));
  body.push(g({ fill: url(`${P}-torii`) }, T));

  /* Ema hanging from the nuki */
  const belt = beltColor(data.belt);
  const ex = tx + th * uniform(rng, -0.12, 0.12);
  const ew = th * 0.36;
  const eh = ew * 0.8;
  const eTop = nukiY + th * 0.16;
  const emaFill = mix(WASHI, '#8A5A2B', 0.35);
  const emaEdge = darken(emaFill, 0.4);
  const E: string[] = [];
  for (const s of [-1, 1]) E.push(line(ex + s * ew * 0.3, nukiY + th * 0.05, ex + s * ew * 0.22, eTop + eh * 0.12, { stroke: belt, 'stroke-width': phone ? 4 : 3 }));
  E.push(
    polygon([[ex - ew / 2, eTop + eh * 0.24], [ex, eTop], [ex + ew / 2, eTop + eh * 0.24], [ex + ew / 2, eTop + eh], [ex - ew / 2, eTop + eh]], {
      fill: emaFill,
      stroke: emaEdge,
      'stroke-width': phone ? 4 : 3,
      'stroke-linejoin': 'round',
    }),
  );
  E.push(polygon([[ex - ew * 0.44, eTop + eh * 0.28], [ex, eTop + eh * 0.07], [ex + ew * 0.44, eTop + eh * 0.28], [ex + ew * 0.44, eTop + eh * 0.94], [ex - ew * 0.44, eTop + eh * 0.94]], { fill: 'none', stroke: belt, 'stroke-width': 1.5, opacity: 0.8 }));
  E.push(circle(ex, eTop + eh * 0.17, ew * 0.035, { fill: emaEdge }));
  body.push(g(undefined, E));
  texts.push(layoutInBox(data.nameKana, { x: ex - ew * 0.4, y: eTop + eh * 0.34, w: ew * 0.8, h: eh * 0.54 }, { font: FONTS.brush, fill: INK, max: eh * 0.42, weight: 700 }));

  /* Seal and date, bottom right of the safe area */
  const ss = phone ? 76 : 62;
  const dateSize = phone ? 30 : 26;
  const sx = safe.x + safe.w - ss;
  const sy = safe.y + safe.h - ss - dateSize * 1.6;
  body.push(path(sealFrame({ x: sx, y: sy, size: ss, round: false, seed: hashSeed(seed, 'seal'), stroke: ss * 0.07, erode: 0.014 }), { fill: shu, 'fill-rule': 'evenodd' }));
  if (data.chosenKanji) {
    body.push(rect(sx + ss * 0.16, sy + ss * 0.16, ss * 0.68, ss * 0.68, { fill: shu, opacity: 0.92 }));
    texts.push(layoutInBox(data.chosenKanji, { x: sx + ss * 0.2, y: sy + ss * 0.2, w: ss * 0.6, h: ss * 0.6 }, { font: FONTS.brush, fill: WASHI, weight: 700 }));
  }
  texts.push({
    text: eraDate(data.date),
    x: safe.x + safe.w,
    y: safe.y + safe.h - dateSize * 0.3,
    size: dateSize,
    font: FONTS.mincho,
    fill: mix(WASHI, sakura, 0.25),
    anchor: 'end',
    opacity: 0.9,
    lang: 'ja',
  });

  const svg = svgDoc({ w, h, defs, body, title: WALLPAPER_NAMES['torii-dawn'].en, attrs: { 'data-piece': 'torii-dawn' } });
  return { svg, texts, post: 'grain' };
}

export const spec: WallpaperSpec = { id: 'torii-dawn', compose };
