/**
 * TSUZUKU — kakejiku 'tanabata' 七夕 (design 06 §3).
 *
 * Bamboo under the Milky Way. The sky is a night gradient with a star
 * field; the river of heaven is a fractal-noise cloud band masked along a
 * seeded diagonal, with Orihime and Hikoboshi as the two brightest stars
 * on either bank. Segmented bamboo stalks lean in from the sides with
 * node rings, twigs and brush-stroke leaves. From the twigs hang tanzaku
 * in the five colours, one per Writing Dojo sentence (up to 24; a few
 * blank strips wait for wishes when there are fewer). Sentences are
 * vertical TextLayers tilted with their strip. Palette night, matcha,
 * 五色; post pass grain.
 */
import { mulberry32, range, shuffle, uniform } from '../../shared/hash';
import { PRESSURE, brushStroke } from '../brush';
import { INK, NIGHT, PALETTE, TANZAKU, WASHI, beltColor, darken, lighten, mix, pickReadable } from '../color';
import { clamp, polar, star, type Pt } from '../geom';
import { FONTS, columnHeight, eraDate, fitSize, type TextLayer } from '../jtext';
import { ridge } from '../noise';
import { circle, el, feTurbulence, filter, g, line, linearGradient, mask, path, polyPath, polygon, radialGradient, rect, svgDoc, url } from '../svg';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-2';

export const MAX_STRIPS = 24;
export const MIN_STRIPS = 5;

const MATCHA = PALETTE.dark.matcha;
const KON = PALETTE.dark.kon;

interface Hang {
  p: Pt;
  side: 1 | -1;
}

interface Stalk {
  markup: string[];
  hangs: Hang[];
}

/** One segmented, leaning bamboo stalk with twigs and leaves; returns markup and twig ends to hang strips from. */
function stalk(rng: () => number, base: Pt, top: number, lean: number, width: number, seed: number, phone: boolean): Stalk {
  const markup: string[] = [];
  const hangs: Hang[] = [];
  const segLen = (phone ? 150 : 125) * uniform(rng, 0.9, 1.1);
  const n = Math.ceil((base[1] - top) / segLen);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([base[0] + lean * t * t * 0.6 + lean * t * 0.4, base[1] - t * (base[1] - top)]);
  }
  const dark = mix(MATCHA, NIGHT, 0.45);
  const mid = mix(MATCHA, NIGHT, 0.2);
  const light = lighten(MATCHA, 0.15);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const wa = width * (1 - 0.35 * (i / n));
    const wb = width * (1 - 0.35 * ((i + 1) / n));
    markup.push(polygon([[a[0] - wa / 2, a[1]], [a[0] + wa / 2, a[1]], [b[0] + wb / 2, b[1]], [b[0] - wb / 2, b[1]]], { fill: i % 2 === 0 ? mid : mix(mid, dark, 0.3) }));
    markup.push(line(a[0] - wa * 0.3, a[1] - 2, b[0] - wb * 0.3, b[1] + 2, { stroke: light, 'stroke-width': Math.max(1.5, wa * 0.12), opacity: 0.55 }));
    // node ring at the joint
    markup.push(line(b[0] - wb * 0.62, b[1], b[0] + wb * 0.62, b[1], { stroke: dark, 'stroke-width': Math.max(3, wb * 0.22), 'stroke-linecap': 'round' }));
    // twig + leaves from the upper joints
    if (i >= Math.floor(n * 0.3) && rng() < 0.78) {
      const side: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const ang = side > 0 ? uniform(rng, -0.95, -0.45) : Math.PI + uniform(rng, 0.45, 0.95);
      const tl = uniform(rng, 70, 150) * (phone ? 1.1 : 1);
      const end = polar(b[0], b[1], tl, ang);
      const kink = polar(b[0], b[1], tl * 0.55, ang + side * 0.12);
      markup.push(path(`M${b[0].toFixed(2)} ${b[1].toFixed(2)}Q${kink[0].toFixed(2)} ${kink[1].toFixed(2)} ${end[0].toFixed(2)} ${end[1].toFixed(2)}`, { fill: 'none', stroke: mid, 'stroke-width': Math.max(2, wb * 0.14), 'stroke-linecap': 'round' }));
      const leaves = range(rng, 3, 5);
      for (let k = 0; k < leaves; k++) {
        const la = ang + uniform(rng, -0.4, 0.4) + (rng() < 0.6 ? side * uniform(rng, 0.6, 1.5) : 0);
        const ll = uniform(rng, 48, 92) * (phone ? 1.1 : 1);
        const root = polar(end[0], end[1], uniform(rng, 0, 14), la);
        const tip = polar(root[0], root[1], ll, la);
        const spine: Pt[] = [root, polar(root[0], root[1], ll * 0.5, la + 0.05 * side), tip];
        markup.push(path(brushStroke(spine, { width: ll * 0.26, pressure: PRESSURE.swell, seed: seed ^ (i * 131 + k * 17), bristle: 0.1 }), { fill: k % 2 === 0 ? MATCHA : mix(MATCHA, light, 0.4), opacity: 0.95 }));
      }
      hangs.push({ p: end, side });
    }
  }
  return { markup, hangs };
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size);
  const belt = beltColor(data.belt);
  const sentences = data.writingSentences.slice(0, MAX_STRIPS);
  const strips = clamp(Math.max(sentences.length, MIN_STRIPS), MIN_STRIPS, MAX_STRIPS);

  // Milky Way band: a seeded diagonal.
  const A: Pt = phone ? [w * uniform(rng, 0.7, 1.0), 0] : [w * uniform(rng, 0.05, 0.3), 0];
  const B: Pt = phone ? [w * uniform(rng, 0.0, 0.3), h] : [w * uniform(rng, 0.7, 0.95), h];
  const bandW = Math.min(w, h) * uniform(rng, 0.3, 0.38);
  const midP: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const bandAng = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
  const bandLen = Math.hypot(B[0] - A[0], B[1] - A[1]) * 1.3;

  const defs = [
    linearGradient('sky', [[0, '#05071a'], [0.55, NIGHT], [1, mix(NIGHT, KON, 0.4)]], 90),
    linearGradient('bandFade', [[0, '#000'], [0.32, '#fff'], [0.5, '#fff'], [0.68, '#fff'], [1, '#000']], 90),
    mask('bandMask', rect(midP[0] - bandLen / 2, midP[1] - bandW / 2, bandLen, bandW, { fill: url('bandFade'), transform: `rotate(${bandAng.toFixed(2)} ${midP[0].toFixed(2)} ${midP[1].toFixed(2)})` })),
    filter('mw', [
      feTurbulence({ baseFrequency: phone ? 0.0062 : 0.0055, octaves: 5, seed: seed % 199, result: 'n' }),
      el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 0.96  0 0 0 0 0.88  0 0 0 3 -1.05' }),
    ]),
    radialGradient('starGlow', [[0, WASHI, 0.7], [0.4, WASHI, 0.18], [1, WASHI, 0]]),
  ];

  // Stars: a third of them along the band.
  const stars: string[] = [];
  const nStars = phone ? 380 : 320;
  const ux = (B[0] - A[0]) / Math.hypot(B[0] - A[0], B[1] - A[1]);
  const uy = (B[1] - A[1]) / Math.hypot(B[0] - A[0], B[1] - A[1]);
  const tints = [WASHI, WASHI, WASHI, '#BFD3FF', PALETTE.dark.kin];
  for (let i = 0; i < nStars; i++) {
    let x: number;
    let y: number;
    if (rng() < 0.38) {
      const t = uniform(rng, -0.1, 1.1);
      const off = (rng() + rng() - 1) * bandW * 0.7;
      x = A[0] + (B[0] - A[0]) * t - uy * off;
      y = A[1] + (B[1] - A[1]) * t + ux * off;
    } else {
      x = rng() * w;
      y = Math.pow(rng(), 1.15) * h * 0.9;
    }
    const big = rng() < 0.05;
    const fill = tints[range(rng, 0, tints.length - 1)]!;
    if (big) stars.push(polygon(star(x, y, uniform(rng, 5, 9), 1.4, 4), { fill, opacity: uniform(rng, 0.7, 1) }));
    else stars.push(circle(x, y, uniform(rng, 0.5, 1.6), { fill, opacity: uniform(rng, 0.3, 1) }));
  }
  // Orihime and Hikoboshi on opposite banks.
  const lovers: string[] = [];
  for (const [t, side, tint] of [[0.4, 1, '#DCE6FF'], [0.6, -1, '#FFF0D0']] as const) {
    const x = A[0] + (B[0] - A[0]) * t - uy * bandW * 0.95 * side;
    const y = A[1] + (B[1] - A[1]) * t + ux * bandW * 0.95 * side;
    lovers.push(circle(x, y, 46, { fill: url('starGlow'), opacity: 0.6 }));
    lovers.push(polygon(star(x, y, 30, 4, 4), { fill: tint, opacity: 0.95 }));
    lovers.push(circle(x, y, 4.5, { fill: '#fff' }));
  }

  // Far hills.
  const amp = h * (phone ? 0.05 : 0.09);
  const rh = ridge(seed ^ 0x7a, 40, amp);
  const hillPts: Pt[] = rh.map((v, i) => [(i / (rh.length - 1)) * w, h - v - 4]);
  const hills = path(polyPath([[0, h + 4], ...hillPts, [w, h + 4]], true), { fill: '#04061a' });

  // Bamboo.
  const stalks: Stalk[] = [];
  const sw = phone ? 30 : 26;
  const topY = phone ? h * 0.1 : h * 0.03;
  stalks.push(stalk(rng, [w * uniform(rng, 0.08, 0.14), h + 20], topY, w * uniform(rng, 0.06, 0.14), sw, seed ^ 1, phone));
  stalks.push(stalk(rng, [w * uniform(rng, 0.86, 0.92), h + 20], topY + uniform(rng, 0, h * 0.1), -w * uniform(rng, 0.06, 0.14), sw * 0.9, seed ^ 2, phone));
  if (rng() < 0.6) stalks.push(stalk(rng, [w * uniform(rng, 0.2, 0.3), h + 20], h * uniform(rng, 0.3, 0.45), w * uniform(rng, 0.02, 0.06), sw * 0.7, seed ^ 3, phone));

  // Hanging points: twig ends inside the band where text may go (the phone safe zone), else synthetic branches above the frame.
  const stripW = phone ? 64 : 56;
  const stripH = phone ? 250 : 215;
  const yMin = phone ? safe.y + 80 : h * 0.06;
  const yMax = (phone ? safe.y + safe.h - 80 : h * 0.72) - stripH - 70;
  let hangs = shuffle(rng, stalks.flatMap((s) => s.hangs).filter((hg) => hg.p[1] + 30 >= yMin && hg.p[1] + 30 <= yMax));
  // Synthetic hangs (branches above the frame) are spread evenly across the middle so strips never bunch up.
  const synthetic: Hang[] = [];
  const need = Math.max(0, strips - hangs.length);
  for (let i = 0; i < need; i++) synthetic.push({ p: [w * (0.22 + (0.56 * (i + 0.5)) / need) + uniform(rng, -20, 20), -20 - uniform(rng, 0, (yMax - yMin) * 0.6)], side: 1 });
  hangs = [...hangs, ...synthetic].slice(0, strips);
  const placed: Pt[] = [];

  const stripMarkup: string[] = [];
  const texts: TextLayer[] = [];
  hangs.forEach((hg, i) => {
    const drop = hg.p[1] < 0 ? yMin + 20 - hg.p[1] : uniform(rng, 30, 70);
    let px = hg.p[0] + hg.side * uniform(rng, -6, 6);
    const py = hg.p[1] + drop;
    // nudge sideways away from strips already hanging at the same height
    for (let tries = 0; tries < 4; tries++) {
      const hit = placed.find((q) => Math.abs(q[0] - px) < stripW * 1.15 && Math.abs(q[1] - py) < stripH * 0.9);
      if (!hit) break;
      px += (px >= hit[0] ? 1 : -1) * stripW * 1.25;
    }
    placed.push([px, py]);
    const ang = uniform(rng, -13, 13);
    const color = TANZAKU[i % TANZAKU.length]!;
    const tf = `rotate(${ang.toFixed(2)} ${px.toFixed(2)} ${py.toFixed(2)})`;
    const inner: string[] = [
      rect(px - stripW / 2 + 3, py + 4, stripW, stripH, { fill: '#000', opacity: 0.35 }),
      rect(px - stripW / 2, py, stripW, stripH, { fill: color, stroke: darken(color, 0.3), 'stroke-width': 1.5 }),
      circle(px, py + 14, 4, { fill: NIGHT, stroke: belt, 'stroke-width': 2 }),
    ];
    const sentence = sentences[i];
    if (sentence === undefined) {
      inner.push(line(px - 8, py + 40, px - 8, py + stripH - 30, { stroke: darken(color, 0.25), 'stroke-width': 1, opacity: 0.5 }));
      inner.push(line(px + 8, py + 40, px + 8, py + stripH - 30, { stroke: darken(color, 0.25), 'stroke-width': 1, opacity: 0.5 }));
    } else {
      const maxH = stripH * 0.8;
      let text = sentence;
      let fs = fitSize(text, stripW * 0.6, maxH, { vertical: true, min: 11, max: 30 });
      if (columnHeight(text, fs) > maxH) {
        const maxN = Math.max(2, Math.floor((maxH / fs - 1) / 1.12) + 1);
        text = Array.from(text).slice(0, maxN - 1).join('') + '…';
        fs = fitSize(text, stripW * 0.6, maxH, { vertical: true, min: 11, max: 30 });
      }
      texts.push({ text, x: px, y: py + 32, size: fs, font: FONTS.mincho, fill: pickReadable(color, [INK, WASHI]), vertical: true, rotate: ang, lang: 'ja' });
    }
    stripMarkup.push(line(hg.p[0], hg.p[1], px, py + 14, { stroke: lighten(NIGHT, 0.55), 'stroke-width': 1.2, opacity: 0.8 }));
    stripMarkup.push(g({ class: 'tanzaku', transform: tf }, inner));
  });

  const body = [
    rect(0, 0, w, h, { fill: url('sky') }),
    g({ mask: url('bandMask') }, [rect(0, 0, w, h, { fill: WASHI, filter: url('mw'), opacity: 0.68 })]),
    g(undefined, stars),
    ...lovers,
    hills,
    ...stalks.flatMap((s) => s.markup),
    g(undefined, stripMarkup),
  ];

  // Captions.
  // No floor: a name at NAME_MAX_GLYPHS must shrink to fit its box (review round 2).
  const nameSize = fitSize(data.nameKana, phone ? w * 0.55 : w * 0.3, phone ? 56 : 48, { max: phone ? 56 : 48 });
  const nameY = phone ? safe.y + safe.h - 70 : h * 0.9;
  texts.push({ text: data.nameKana, x: phone ? w * 0.08 : w * 0.05, y: nameY, size: nameSize, font: FONTS.mincho, fill: WASHI, opacity: 0.9, lang: 'ja' });
  texts.push({ text: eraDate(data.date), x: phone ? w * 0.08 : w * 0.05, y: nameY + (phone ? 40 : 34), size: phone ? 24 : 22, font: FONTS.mincho, fill: WASHI, opacity: 0.65, lang: 'ja' });
  texts.push({ text: S.tanabataTitle, x: phone ? w * 0.9 : w * 0.955, y: phone ? safe.y + 50 : h * 0.07, size: phone ? 48 : 40, font: FONTS.brush, fill: WASHI, vertical: true, opacity: 0.85, lang: 'ja' });

  const svg = svgDoc({ w, h, bg: NIGHT, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'grain' };
}


export const spec: WallpaperSpec = { id: 'tanabata', living: true, compose };
