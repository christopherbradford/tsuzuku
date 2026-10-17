/**
 * TSUZUKU — kakejiku 'koi-dragon' 登竜門 (design 06 §3).
 *
 * Koi climb a night waterfall; the one at the top is already turning into a
 * dragon (whiskers, horns, mane, the pearl before its mouth). Bodies are brush
 * ribbons along streamlines, their scales are the learner's mastered kanji,
 * and the number of fish is kanji-Brown ÷ 50 (1–8).
 *
 * Layers: deep kon water → moon → cliff and rocks → the fall (body gradient,
 * streamlines) → koi (ribbon, kanji scales, fins, eye) → spray and mist →
 * pool ripples. Text (登竜門 caption, kanji count, name, era date, chosen
 * kanji on the dragon's pearl) is returned as TextLayers in the safe zone.
 * Pure: identical (seed, data, size) → byte-identical SVG.
 */
import { chance, hashSeed, mulberry32, range, uniform } from '../../shared/hash';
import { brushStroke, type Pressure } from '../brush';
import { FOAM, INK, PALETTE, WASHI, darken, mix } from '../color';
import { chaikin, clamp, deg, lerp, pathLength, perp, pointAt, polar, resample, TAU, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, tategakiLayers, type TextLayer } from '../jtext';
import { noise1 } from '../noise';
import { blur, circle, ellipse, g, linearGradient, mask, path, polyPath, radialGradient, rect, safeRect, sizeOf, svgDoc, text, url } from '../svg';
import type { WallpaperSpec } from './spec';
import { S } from './strings-3';

const KON = PALETTE.light.kon;
const SHU = PALETTE.light.shu;
const KIN = PALETTE.dark.kin;
const WATER = mix(KON, FOAM, 0.38);

/** Fat head, long taper to the tail. */
const koiPressure: Pressure = (t) => (t < 0.16 ? lerp(0.55, 1, t / 0.16) : 1 - ((t - 0.16) / 0.84) ** 1.1 * 0.86);
/** Dragon: even body, slow taper. */
const dragonPressure: Pressure = (t) => (t < 0.1 ? lerp(0.6, 1, t / 0.1) : 1 - ((t - 0.1) / 0.9) ** 1.6 * 0.8);

interface Fish {
  spine: Pt[];
  width: number;
  body: string;
  scale: string;
  dragon: boolean;
}

/** An irregular smoothed blob around a centre (rocks, cliff lumps). */
function blob(rng: () => number, cx: number, cy: number, rx: number, ry: number): Pt[] {
  const n = range(rng, 7, 10);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = uniform(rng, 0.72, 1.12);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return chaikin(pts, 2, true);
}

export const spec: WallpaperSpec = {
  id: 'koi-dragon',
  compose(seed, data, size) {
    const { w, h } = sizeOf(size);
    const phone = size === 'phone';
    const rng = mulberry32(seed);
    const flow = noise1(mulberry32(hashSeed(seed, 'flow')));
    const defs: string[] = [];
    const body: string[] = [];

    const fx = w / 2 + (phone ? 0 : uniform(rng, -0.08, 0.08) * w);
    const fw = phone ? w * 0.46 : w * 0.21;
    const cliffY = h * (phone ? 0.11 : 0.13);
    const poolY = h * (phone ? 0.84 : 0.86);

    /* Water */
    defs.push(linearGradient('kd-bg', [[0, darken(KON, 0.3)], [0.6, darken(KON, 0.55)], [1, darken(KON, 0.72)]], 90));
    body.push(rect(0, 0, w, h, { fill: url('kd-bg') }));

    /* Moon */
    if (chance(rng, 0.7)) {
      const side = chance(rng, 0.5) ? -1 : 1;
      const mx = fx + side * uniform(rng, phone ? 0.3 : 0.22, phone ? 0.4 : 0.36) * w;
      const my = uniform(rng, phone ? 0.3 : 0.14, phone ? 0.5 : 0.3) * h;
      const mr = Math.min(w, h) * uniform(rng, 0.05, 0.085);
      defs.push(blur('kd-moon-glow', mr * 0.6));
      body.push(circle(mx, my, mr * 1.5, { fill: KIN, opacity: 0.22, filter: url('kd-moon-glow') }));
      body.push(circle(mx, my, mr, { fill: mix(KIN, WASHI, 0.45) }));
    }

    /* Cliff across the top with a notch where the fall leaves it */
    const rock = darken(KON, 0.78);
    const rim = mix(KON, FOAM, 0.22);
    const cliff: Pt[] = [[0, 0]];
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * w;
      const inFall = Math.abs(x - fx) < fw * 0.55;
      const y = inFall ? cliffY * 0.55 : cliffY * (0.8 + 0.5 * flow(i * 0.7 + 3));
      cliff.push([x, y]);
    }
    cliff.push([w, 0]);
    body.push(path(polyPath(cliff, true), { fill: rock }));
    body.push(path(polyPath(cliff.slice(1, -1)), { fill: 'none', stroke: rim, 'stroke-width': 2, opacity: 0.35 }));

    /* The fall body (soft-edged column fading toward the pool) and its streamlines */
    defs.push(linearGradient('kd-fall', [[0, WATER, 0], [0.18, WATER, 0.5], [0.5, WATER, 0.62], [0.82, WATER, 0.5], [1, WATER, 0]], 0));
    defs.push(linearGradient('kd-fall-fade', [[0, FOAM, 1], [0.6, FOAM, 0.55], [1, FOAM, 0]], 90));
    defs.push(mask('kd-fall-mask', rect(fx - fw, 0, fw * 2, h, { fill: url('kd-fall-fade') })));
    body.push(g({ mask: url('kd-fall-mask') }, rect(fx - fw * 0.62, cliffY * 0.45, fw * 1.24, poolY - cliffY * 0.45, { fill: url('kd-fall') })));
    const streams: string[] = [];
    const nStreams = range(rng, 44, 64);
    for (let i = 0; i < nStreams; i++) {
      const lane = uniform(rng, -0.5, 0.5);
      const x0 = fx + lane * fw;
      const y0 = cliffY * 0.5 + uniform(rng, 0, 0.35) * (poolY - cliffY);
      const y1 = Math.min(poolY + 10, y0 + uniform(rng, 0.25, 0.7) * (poolY - cliffY));
      const pts: Pt[] = [];
      const steps = 14;
      for (let k = 0; k <= steps; k++) {
        const y = lerp(y0, y1, k / steps);
        pts.push([x0 + (flow(y / 120 + i * 3.1) - 0.5) * fw * 0.08, y]);
      }
      const thin = chance(rng, 0.45);
      streams.push(path(polyPath(pts), { fill: 'none', stroke: thin ? FOAM : WATER, 'stroke-width': thin ? uniform(rng, 1, 2) : uniform(rng, 2.5, 5), 'stroke-linecap': 'round', opacity: thin ? uniform(rng, 0.35, 0.7) : uniform(rng, 0.2, 0.45) }));
    }
    body.push(g(undefined, streams));

    /* Rocks flanking the pool */
    const rocks: string[] = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 3; k++) {
        const rx = fx + side * (fw * 0.75 + k * fw * uniform(rng, 0.5, 0.8));
        const ry = poolY - h * uniform(rng, 0.02, 0.08) + k * 12;
        const pts = blob(rng, rx, ry, w * (phone ? 0.16 : 0.09) * uniform(rng, 0.8, 1.3), h * uniform(rng, 0.05, 0.1));
        rocks.push(path(polyPath(pts, true), { fill: k === 0 ? rock : darken(KON, 0.66 + k * 0.05) }));
        rocks.push(path(polyPath(pts.slice(0, Math.floor(pts.length / 2))), { fill: 'none', stroke: rim, 'stroke-width': 2, opacity: 0.3 }));
      }
    }
    body.push(g(undefined, rocks));

    /* Koi: one per 50 mastered kanji, the leader turning into a dragon */
    const kanji = data.mastered.kanji;
    const count = clamp(Math.round(kanji.length / 50), 1, 8);
    const fishes: Fish[] = [];
    const palette: [string, string][] = [
      [SHU, darken(SHU, 0.4)],
      [mix(WASHI, FOAM, 0.5), mix(INK, WASHI, 0.55)],
      [KIN, darken(KIN, 0.45)],
      [SHU, darken(SHU, 0.4)],
    ];
    for (let i = 0; i < count; i++) {
      const dragon = i === 0;
      const frac = count === 1 ? 0.5 : i / (count - 1);
      const headY = dragon ? h * (phone ? 0.22 : 0.15) : lerp(h * (phone ? 0.36 : 0.3), poolY - h * 0.03, 0.15 + 0.85 * frac) + uniform(rng, -0.02, 0.02) * h;
      const headX = fx + (dragon ? uniform(rng, -0.12, 0.12) : uniform(rng, -0.42, 0.42)) * fw;
      const len = (phone ? h * 0.2 : h * 0.26) * (dragon ? 1.75 : uniform(rng, 0.7, 1.05));
      const width = len * (dragon ? 0.14 : uniform(rng, 0.2, 0.26));
      const amp = len * (dragon ? 0.22 : 0.11) * (chance(rng, 0.5) ? -1 : 1);
      const ph = uniform(rng, 0, TAU);
      const ctrl: Pt[] = [];
      const segs = dragon ? 7 : 5;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const lean = dragon ? -0.35 : uniform(rng, -0.1, 0.1);
        ctrl.push([headX + Math.sin(t * Math.PI * (dragon ? 1.6 : 1.1) + ph) * amp + lean * len * t, headY + len * t]);
      }
      const spine = resample(chaikin(ctrl, 3), dragon ? 56 : 40);
      const [bodyFill, scaleFill] = dragon ? palette[2]! : palette[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2]!;
      fishes.push({ spine, width, body: bodyFill, scale: scaleFill, dragon });
    }
    // draw bottom-most first so the leader sits on top
    fishes.sort((a, b) => b.spine[0]![1] - a.spine[0]![1]);

    const fishParts: string[] = [];
    let glyphIdx = 0;
    for (const f of fishes) {
      const pressure = f.dragon ? dragonPressure : koiPressure;
      const parts: string[] = [];
      const fishSeed = hashSeed(seed, 'fish', Math.round(f.spine[0]![1]));
      const head = pointAt(f.spine, 0);
      const back: Pt = [-head.tangent[0], -head.tangent[1]];
      const nrm = perp(head.tangent);

      // tail: three fanned strokes
      const tail = pointAt(f.spine, 0.97);
      for (let k = -1; k <= 1; k++) {
        const dir = perp(tail.tangent);
        const end: Pt = [tail.p[0] + tail.tangent[0] * f.width * 1.3 + dir[0] * k * f.width * 0.9, tail.p[1] + tail.tangent[1] * f.width * 1.3 + dir[1] * k * f.width * 0.9];
        parts.push(path(brushStroke([tail.p, [lerp(tail.p[0], end[0], 0.5) + dir[0] * k * f.width * 0.2, lerp(tail.p[1], end[1], 0.5)], end], { width: f.width * 0.45, seed: fishSeed + k, bristle: 0.3 }), { fill: f.body, opacity: 0.85 }));
      }
      // pectoral fins
      const fin = pointAt(f.spine, 0.22);
      for (let s = -1; s <= 1; s += 2) {
        const d = perp(fin.tangent);
        const tip: Pt = [fin.p[0] + d[0] * s * f.width * 1.1 + fin.tangent[0] * f.width * 0.6, fin.p[1] + d[1] * s * f.width * 1.1 + fin.tangent[1] * f.width * 0.6];
        parts.push(path(brushStroke([fin.p, tip], { width: f.width * 0.42, seed: fishSeed + 10 + s, bristle: 0.25 }), { fill: f.body, opacity: 0.8 }));
      }
      // body ribbon
      parts.push(path(brushStroke(f.spine, { width: f.width, pressure, seed: fishSeed, bristle: f.dragon ? 0.1 : 0.06, minWidth: 2 }), { fill: f.body }));
      // belly highlight
      parts.push(path(polyPath(f.spine.slice(2, Math.floor(f.spine.length * 0.7)).map(([x, y], i, arr) => [x + nrm[0] * f.width * 0.2 * (1 - i / arr.length), y + nrm[1] * f.width * 0.2])), { fill: 'none', stroke: FOAM, 'stroke-width': f.width * 0.12, 'stroke-linecap': 'round', opacity: 0.18 }));

      // scales = kanji along two rows
      const total = pathLength(f.spine);
      const glyphSize = clamp(f.width * (f.dragon ? 0.34 : 0.3), 11, 44);
      const step = (glyphSize * 0.98) / Math.max(1, total);
      const scales: string[] = [];
      const arcs: string[] = [];
      for (let t = 0.17; t < 0.86; t += step) {
        const q = pointAt(f.spine, t);
        const n = perp(q.tangent);
        const halfW = (f.width * clamp(pressure(t), 0, 1)) / 2;
        const rot = deg(Math.atan2(q.tangent[1], q.tangent[0])) - 90;
        for (let row = -1; row <= 1; row += 2) {
          const off = halfW * 0.5 * row;
          const x = q.p[0] + n[0] * off;
          const y = q.p[1] + n[1] * off;
          if (kanji.length > 0) {
            const ch = kanji[glyphIdx++ % kanji.length]!;
            scales.push(text(ch, { x, y, 'font-size': glyphSize * (halfW / (f.width / 2)) * 0.9 + 4, transform: `rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` }));
          } else {
            arcs.push(circle(x, y, Math.max(1.5, halfW * 0.28), { fill: 'none', stroke: f.scale, 'stroke-width': 1.2 }));
          }
        }
      }
      if (scales.length) parts.push(g({ 'font-family': FONTS.mincho, fill: f.scale, 'text-anchor': 'middle', 'dominant-baseline': 'central', opacity: 0.62, lang: 'ja' }, scales));
      if (arcs.length) parts.push(g({ opacity: 0.6 }, arcs));

      // eye
      const eyeP = pointAt(f.spine, 0.06);
      const en = perp(eyeP.tangent);
      const ex = eyeP.p[0] + en[0] * f.width * 0.26;
      const ey = eyeP.p[1] + en[1] * f.width * 0.26;
      parts.push(circle(ex, ey, f.width * 0.09, { fill: INK }));
      parts.push(circle(ex - f.width * 0.025, ey - f.width * 0.025, f.width * 0.03, { fill: FOAM }));

      if (f.dragon) {
        // horns, mane, whiskers
        for (let s = -1; s <= 1; s += 2) {
          const base: Pt = [head.p[0] + nrm[0] * s * f.width * 0.3 + head.tangent[0] * f.width * 0.35, head.p[1] + nrm[1] * s * f.width * 0.3 + head.tangent[1] * f.width * 0.35];
          const hornTip: Pt = [base[0] + back[0] * f.width * 0.9 + nrm[0] * s * f.width * 0.5, base[1] + back[1] * f.width * 0.9 + nrm[1] * s * f.width * 0.5];
          parts.push(path(brushStroke([base, hornTip], { width: f.width * 0.26, seed: fishSeed + 20 + s, bristle: 0.2 }), { fill: mix(KIN, WASHI, 0.5) }));
          for (let k = 0; k < 5; k++) {
            const m0 = pointAt(f.spine, 0.12 + k * 0.045);
            const mn = perp(m0.tangent);
            const reach = f.width * (1.1 + k * 0.12);
            const mt: Pt = [m0.p[0] + mn[0] * s * reach + back[0] * f.width * 0.7, m0.p[1] + mn[1] * s * reach + back[1] * f.width * 0.7];
            const mid: Pt = [lerp(m0.p[0], mt[0], 0.5) + back[0] * f.width * 0.25, lerp(m0.p[1], mt[1], 0.5) + back[1] * f.width * 0.25];
            parts.push(path(brushStroke([m0.p, mid, mt], { width: f.width * 0.34, seed: fishSeed + 30 + k * 2 + s, bristle: 0.3 }), { fill: SHU, opacity: 0.9 }));
          }
          const snout: Pt = [head.p[0] + nrm[0] * s * f.width * 0.18, head.p[1] + nrm[1] * s * f.width * 0.18];
          const wk: Pt[] = [snout, polar(snout[0], snout[1], f.width * 1.2, Math.atan2(back[1], back[0]) + s * 0.9), polar(snout[0], snout[1], f.width * 2.4, Math.atan2(back[1], back[0]) + s * 1.5)];
          parts.push(path(polyPath(chaikin(wk, 3)), { fill: 'none', stroke: mix(KIN, WASHI, 0.6), 'stroke-width': f.width * 0.05, 'stroke-linecap': 'round' }));
        }
      }
      fishParts.push(g({ class: f.dragon ? 'koi dragon' : 'koi' }, parts));
    }
    body.push(g(undefined, fishParts));

    /* Spray and mist */
    const spray: string[] = [];
    const nSpray = range(rng, 90, 140);
    for (let i = 0; i < nSpray; i++) {
      const nearPool = chance(rng, 0.55);
      const x = nearPool ? fx + uniform(rng, -0.9, 0.9) * fw : fx + uniform(rng, -0.6, 0.6) * fw;
      const y = nearPool ? poolY + uniform(rng, -0.08, 0.02) * h : uniform(rng, cliffY, poolY);
      spray.push(circle(x, y, uniform(rng, 1, 4), { fill: FOAM, opacity: uniform(rng, 0.25, 0.9) }));
    }
    body.push(g(undefined, spray));
    defs.push(blur('kd-mist', 26));
    body.push(g({ filter: url('kd-mist'), opacity: 0.4 }, [ellipse(fx, poolY, fw * 0.9, h * 0.035, { fill: FOAM }), ellipse(fx, poolY - h * 0.03, fw * 0.5, h * 0.025, { fill: FOAM })]));

    /* Pool with ripples */
    defs.push(linearGradient('kd-pool', [[0, mix(KON, FOAM, 0.2), 0.5], [1, darken(KON, 0.6), 0.9]], 90));
    body.push(rect(0, poolY, w, h - poolY, { fill: url('kd-pool') }));
    for (let k = 1; k <= 5; k++) {
      body.push(ellipse(fx, poolY + h * 0.02 + k * (phone ? 20 : 14), fw * 0.5 + k * fw * 0.3, h * 0.012 + k * 6, { fill: 'none', stroke: FOAM, 'stroke-width': 1.5, opacity: 0.32 - k * 0.05 }));
    }

    /* Dragon's pearl (the chosen kanji glows before the leader's mouth) */
    const texts: TextLayer[] = [];
    const leader = fishes.find((f) => f.dragon)!;
    const lh = pointAt(leader.spine, 0);
    const pearlR = leader.width * 0.55;
    const px = lh.p[0] - lh.tangent[0] * leader.width * 1.3;
    const py = lh.p[1] - lh.tangent[1] * leader.width * 1.3;
    defs.push(radialGradient('kd-pearl', [[0, mix(KIN, WASHI, 0.6)], [0.7, KIN], [1, darken(KIN, 0.2)]], { cx: 0.4, cy: 0.35 }));
    defs.push(blur('kd-pearl-glow', pearlR * 0.7));
    body.push(circle(px, py, pearlR * 1.9, { fill: KIN, opacity: 0.35, filter: url('kd-pearl-glow') }));
    body.push(circle(px, py, pearlR, { fill: url('kd-pearl') }));
    if (data.chosenKanji) {
      texts.push({ text: data.chosenKanji, x: px, y: py + pearlR * 0.42, size: pearlR * 1.2, font: FONTS.brush, fill: INK, anchor: 'middle', lang: 'ja' });
    }

    /* Caption, count, name, date */
    const safe = safeRect(size, 0);
    const margin = phone ? 84 : 72;
    const top = safe.y + (phone ? 60 : 56);
    const capSize = phone ? 72 : 60;
    texts.push(...tategakiLayers({ text: S.koiCaption, x: margin + capSize / 2, y: top, size: capSize, font: FONTS.brush, fill: KIN }));
    const small = phone ? 30 : 24;
    texts.push({ text: `${kanji.length}${S.kanjiUnit}`, x: margin + capSize / 2, y: top + capSize * (1 + 2.24) + small * 1.6, size: small, font: FONTS.mincho, fill: WASHI, anchor: 'middle', opacity: 0.85, lang: 'ja' });
    // No floor: a name at NAME_MAX_GLYPHS must shrink to fit its box (review round 2).
    const nameSize = fitSize(data.nameKana, phone ? 64 : 52, safe.h * 0.42, { vertical: true, max: phone ? 56 : 44 });
    texts.push(...tategakiLayers({ text: data.nameKana, x: w - margin - nameSize / 2, y: top, size: nameSize, font: FONTS.mincho, fill: WASHI }));
    texts.push({ text: eraDate(data.date), x: w - margin, y: safe.y + safe.h - (phone ? 56 : 44), size: small, font: FONTS.mincho, fill: WASHI, anchor: 'end', opacity: 0.8, lang: 'ja' });

    return { svg: svgDoc({ w, h, defs, body }), texts, post: 'none' };
  },
};
