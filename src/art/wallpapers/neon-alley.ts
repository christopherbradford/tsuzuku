/**
 * TSUZUKU — kakejiku 'neon-alley' 電脳横丁 (design 06 §3).
 *
 * A one-point-perspective alley in the rain. Both walls carry hanging neon
 * signs, and every sign is one of the learner's Mastered words, the most
 * reviewed ones nearest and biggest. A gate beam at the mouth of the alley
 * names the alley after the learner (`ハナ横丁`). Glow comes from blurred
 * twins, the wet street mirrors each sign as a flipped gradient wobbled by
 * a displacement map, and 300-odd rain strokes fall as a single path.
 *
 * Seed → vanishing point, which wall each sign hangs on, sign colours,
 * window lights, puddles and rain. Words and the name are `TextLayer`s.
 */
import { hashSeed, mulberry32, range, uniform } from '../../shared/hash';
import { PALETTE, SUMI, WARM, WASHI, alpha, beltColor, mix } from '../color';
import { type Pt, lerpPt } from '../geom';
import { FONTS, eraDate, fitSize, type TextLayer } from '../jtext';
import { L, M, Z, clipPath, el, ellipse, feTurbulence, filter, g, glowTwin, line, linearGradient, path, polygon, radialGradient, rect, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-1';

const P = 'na';

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size, phone ? 40 : 40);
  const D = PALETTE.dark;
  const neon = [D['neon-m'], D['neon-c'], D.kin];
  const defs: string[] = [];
  const body: string[] = [];
  const texts: TextLayer[] = [];

  /* Perspective frame */
  const vx = w * uniform(rng, 0.46, 0.54);
  const vy = h * (phone ? uniform(rng, 0.36, 0.42) : uniform(rng, 0.4, 0.46));
  const VP: Pt = [vx, vy];
  const floorL = (t: number): Pt => lerpPt([0, h], VP, t);
  const floorR = (t: number): Pt => lerpPt([w, h], VP, t);
  const topL = (t: number): Pt => lerpPt([0, -h * 0.1], VP, t);
  const topR = (t: number): Pt => lerpPt([w, -h * 0.1], VP, t);

  /* Sky, walls, street */
  defs.push(linearGradient(`${P}-sky`, [[0, SUMI], [1, mix(D.surface, D['neon-m'], 0.12)]]));
  body.push(rect(0, 0, w, h, { fill: url(`${P}-sky`) }));
  defs.push(linearGradient(`${P}-wallL`, [[0, D.surface], [1, SUMI]], 0));
  defs.push(linearGradient(`${P}-wallR`, [[0, SUMI], [1, D.surface]], 0));
  body.push(polygon([VP, [0, -h * 0.1], [0, h]], { fill: url(`${P}-wallL`) }));
  body.push(polygon([VP, [w, -h * 0.1], [w, h]], { fill: url(`${P}-wallR`) }));
  defs.push(linearGradient(`${P}-street`, [[0, mix(D.surface, D.kon, 0.25)], [1, D.raised]]));
  body.push(polygon([VP, [0, h], [w, h]], { fill: url(`${P}-street`) }));
  // perspective tiles on the wet street
  let lanes = '';
  for (let i = 1; i <= 9; i++) {
    const t = 1 - Math.pow(0.74, i);
    const a = floorL(t);
    const b = floorR(t);
    lanes += M(a[0], a[1]) + L(b[0], b[1]);
  }
  body.push(path(lanes, { stroke: alpha(D['neon-c'], 0.1), 'stroke-width': 1.5, fill: 'none' }));
  // fog at the far end
  defs.push(radialGradient(`${P}-fog`, [[0, mix(D['neon-c'], D['neon-m'], 0.5), 0.55], [0.5, D['neon-m'], 0.18], [1, SUMI, 0]]));
  body.push(ellipse(vx, vy, w * (phone ? 0.4 : 0.22), h * 0.16, { fill: url(`${P}-fog`) }));

  /* Window lights on both walls */
  const winRng = mulberry32(hashSeed(seed, 'win'));
  const windows = range(winRng, 40, 70);
  const winParts: string[] = [];
  for (let i = 0; i < windows; i++) {
    const side = winRng() < 0.5 ? -1 : 1;
    const t = uniform(winRng, 0.15, 0.9);
    const u = uniform(winRng, 0.08, 0.95);
    const fl = side < 0 ? floorL(t) : floorR(t);
    const tp = side < 0 ? topL(t) : topR(t);
    const x = fl[0] + side * -1 * uniform(winRng, 0, w * 0.02) * (1 - t);
    const y = tp[1] + (fl[1] - tp[1]) * u;
    const s = (1 - t) * (phone ? 26 : 22) + 3;
    const c = winRng() < 0.6 ? WARM : neon[range(winRng, 0, 2)]!;
    winParts.push(rect(x - s / 2, y - s * 0.7, s, s * 1.4, { fill: c, opacity: uniform(winRng, 0.25, 0.75) }));
  }
  body.push(g(undefined, winParts));

  /* Gate geometry first: signs must clear the beam */
  const bh = phone ? 150 : 120;
  const by = phone ? safe.y + 36 : 48;
  const bx0 = w * 0.08;
  const bx1 = w * 0.92;

  /* Signs */
  const words = [...data.mastered.vocab].sort((a, b) => b.reviews - a.reviews || (a.word < b.word ? -1 : 1));
  const pool = words.length ? words : data.mastered.kana.map((k) => ({ word: k, kana: k, reviews: 1 }));
  const nSigns = Math.min(pool.length, phone ? 9 : 13);
  const maxRev = pool.reduce((m, v) => Math.max(m, v.reviews), 1);
  defs.push(glowTwin(`${P}-glow`, phone ? 12 : 14, { opacity: 0.85 }));
  // wet-street filter: turbulence-displaced, then softened
  defs.push(
    filter(`${P}-wet`, [
      feTurbulence({ baseFrequency: [0.02, 0.09], octaves: 2, seed: hashSeed(seed, 'wet'), result: 'noise' }),
      el('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: phone ? 16 : 14, xChannelSelector: 'R', yChannelSelector: 'G', result: 'disp' }),
      el('feGaussianBlur', { in: 'disp', stdDeviation: phone ? 4 : 3 }),
    ]),
  );
  defs.push(clipPath(`${P}-street`, polygon([VP, [0, h], [w, h]])));
  const plates: string[] = [];
  const arms: string[] = [];
  const mirrors: string[] = [];
  const firstSide = rng() < 0.5 ? -1 : 1;
  const signTop = by + bh + (phone ? 60 : 40);
  for (let i = 0; i < nSigns; i++) {
    const v = pool[i]!;
    const side = i % 2 === 0 ? firstSide : -firstSide;
    const t = 0.06 + 0.7 * Math.pow(i / Math.max(1, nSigns - 1), 0.9) + uniform(rng, -0.015, 0.015);
    const scale = 1 - t * 0.86;
    const fl = side < 0 ? floorL(t) : floorR(t);
    const tp = side < 0 ? topL(t) : topR(t);
    const col = neon[i % 3]!;
    const rev = 0.75 + (0.45 * v.reviews) / maxRev;
    const chars = Array.from(v.word);
    const vertical = chars.length >= 2;
    const pw = (phone ? 150 : 165) * scale * rev;
    const pad = pw * 0.14;
    const ph = vertical ? pw * (0.5 + Math.min(chars.length, 6) * 0.64) : pw * 0.95;
    // alternate high and low along each wall so neighbours do not stack
    const u = 0.3 + 0.28 * (Math.floor(i / 2) % 2) + uniform(rng, -0.04, 0.04);
    let cy = tp[1] + (fl[1] - tp[1]) * u;
    cy = Math.max(signTop + ph / 2, Math.min(safe.y + safe.h - ph / 2 - 4, cy));
    const x0 = side < 0 ? fl[0] + pw * 0.08 : fl[0] - pw * 1.08;
    plates.push(rect(x0, cy - ph / 2, pw, ph, { rx: pw * 0.06, fill: alpha(SUMI, 0.86), stroke: col, 'stroke-width': Math.max(1.5, 4 * scale) }));
    arms.push(line(fl[0], cy - ph * 0.38, side < 0 ? x0 : x0 + pw, cy - ph * 0.38, { stroke: D.line, 'stroke-width': Math.max(1, 3 * scale) }));
    if (t < 0.6) {
      const gid = `${P}-m${i}`;
      defs.push(linearGradient(gid, [[0, col, 0.26 * (1 - t)], [1, col, 0]]));
      mirrors.push(rect(x0 + pw * 0.15, fl[1] - 2, pw * 0.7, ph * 1.3, { fill: url(gid), filter: url(`${P}-wet`) }));
    }
    if (vertical) {
      const sz = fitSize(v.word, pw - 2 * pad, ph - 2 * pad, { vertical: true, max: pw * 0.68 });
      texts.push({ text: v.word, x: x0 + pw / 2, y: cy - ph / 2 + pad, size: sz, font: FONTS.neon, fill: col, vertical: true, lang: 'ja' });
    } else {
      const sz = fitSize(v.word, pw - 2 * pad, ph - 2 * pad, { max: pw * 0.68 });
      texts.push({ text: v.word, x: x0 + pw / 2, y: cy + sz * 0.35, size: sz, font: FONTS.neon, fill: col, anchor: 'middle', lang: 'ja' });
    }
  }
  body.push(g({ 'clip-path': url(`${P}-street`) }, mirrors));
  body.push(g(undefined, arms));
  body.push(g({ filter: url(`${P}-glow`) }, plates));

  /* Gate beam at the mouth of the alley: `<name>横丁` */
  const belt = beltColor(data.belt);
  defs.push(linearGradient(`${P}-beam`, [[0, D.raised], [1, SUMI]]));
  body.push(rect(bx0, by, bx1 - bx0, bh, { fill: url(`${P}-beam`), stroke: belt, 'stroke-width': phone ? 5 : 4 }));
  body.push(rect(bx0 + 10, by + 10, bx1 - bx0 - 20, bh - 20, { fill: 'none', stroke: alpha(D.kin, 0.5), 'stroke-width': 1.5 }));
  for (const lx of [bx0 + bh * 0.4, bx1 - bh * 0.4]) {
    body.push(line(lx, by + bh, lx, by + bh + bh * 0.3, { stroke: D.line, 'stroke-width': 3 }));
    body.push(ellipse(lx, by + bh + bh * 0.6, bh * 0.22, bh * 0.3, { fill: WARM, opacity: 0.9, filter: url(`${P}-glow`) }));
  }
  const gateText = `${data.nameKana}${S.alleySuffix}`;
  const gateSize = fitSize(gateText, (bx1 - bx0) * 0.82, bh * 0.6, { max: bh * 0.6 });
  texts.push({ text: gateText, x: w / 2, y: by + bh / 2 + gateSize * 0.36, size: gateSize, font: FONTS.neon, fill: D.kin, anchor: 'middle', lang: 'ja' });

  /* Puddles with neon shimmer */
  const puddles = range(rng, 3, 6);
  for (let i = 0; i < puddles; i++) {
    const t = uniform(rng, 0.02, 0.3);
    const a = floorL(t);
    const b = floorR(t);
    const px = uniform(rng, a[0] + w * 0.08, b[0] - w * 0.08);
    const rx = uniform(rng, w * 0.04, w * 0.12) * (1 - t);
    const id = `${P}-pud${i}`;
    defs.push(radialGradient(id, [[0, neon[i % 3]!, 0.3], [1, neon[i % 3]!, 0]]));
    body.push(ellipse(px, a[1], rx, rx * 0.18, { fill: url(id) }));
  }

  /* Rain: one path of slanted strokes, a second of nearer, longer drops */
  const rainRng = mulberry32(hashSeed(seed, 'rain'));
  let far = '';
  let nearD = '';
  const drops = phone ? 300 : 340;
  for (let i = 0; i < drops; i++) {
    const x = uniform(rainRng, 0, w);
    const y = uniform(rainRng, -40, h);
    const len = uniform(rainRng, 26, 70);
    far += M(x, y) + L(x - len * 0.14, y + len);
  }
  for (let i = 0; i < 40; i++) {
    const x = uniform(rainRng, 0, w);
    const y = uniform(rainRng, -60, h);
    const len = uniform(rainRng, 90, 170);
    nearD += M(x, y) + L(x - len * 0.14, y + len);
  }
  body.push(path(far, { stroke: WASHI, 'stroke-width': 1.3, opacity: 0.24, 'stroke-linecap': 'round', fill: 'none' }));
  body.push(path(nearD, { stroke: WASHI, 'stroke-width': 2.2, opacity: 0.14, 'stroke-linecap': 'round', fill: 'none' }));

  /* Date, small pixel type at the bottom right */
  const ds = phone ? 28 : 24;
  texts.push({ text: eraDate(data.date), x: safe.x + safe.w, y: safe.y + safe.h - ds * 0.3, size: ds, font: FONTS.pixel, fill: D.hai, anchor: 'end', lang: 'ja' });

  const svg = svgDoc({ w, h, defs, body, title: WALLPAPER_NAMES['neon-alley'].en, attrs: { 'data-piece': 'neon-alley' } });
  return { svg, texts, post: 'none' };
}

export const spec: WallpaperSpec = { id: 'neon-alley', compose };
