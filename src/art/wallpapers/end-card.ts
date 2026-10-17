/**
 * TSUZUKU — kakejiku 'end-card' (つづく End Card, design 06 §3).
 *
 * Pure sumi. The brush つづく every session ends on, one sweeping dry-brush
 * underline, a vermilion seal with the chosen kanji, and the learner's
 * longest streak in small type below. Grain post pass.
 * Palette: sumi, washi, one shu seal. Unlock: 100 sessions.
 *
 * Seed → the lift of the ink field, the underline's spine and bristles, the
 * splatter at its flick, the seal's shape and tilt, the drifting ink motes.
 * All type is `TextLayer`s (webfonts render in the canvas pass); the SVG
 * itself holds only ink.
 */
import { chance, mulberry32, range, uniform } from '../../shared/hash';
import { PRESSURE, dryBrush, inkBleed, sealFrame, splatter } from '../brush';
import { INK, INK_WASH, PALETTE, SUMI, WASHI, alpha } from '../color';
import { resample, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, textWidth, type TextLayer } from '../jtext';
import { noise1 } from '../noise';
import { circle, el, fmt, path, radialGradient, rect, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES, fill } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-4';

const ID = 'end-card';
const SHU = PALETTE.light.shu;
const MUTED = PALETTE.dark['fg-muted'];
const HAI = PALETTE.dark.hai;

export const spec: WallpaperSpec = {
  id: ID,
  compose(seed, data, size) {
    return compose(seed, data, size);
  },
};

/* ────────────────────────────────────────────────────────────────────────── */

/** Spine of the underline: a long bow from under the first glyph to a flick past the last. */
function underlineSpine(rng: () => number, cx: number, y: number, width: number, em: number): Pt[] {
  const wob = noise1(mulberry32(Math.floor(rng() * 0xffffffff)));
  const x0 = cx - width * uniform(rng, 0.5, 0.58);
  const x1 = cx + width * uniform(rng, 0.46, 0.56);
  const bow = em * uniform(rng, 0.03, 0.07);
  const tilt = em * uniform(rng, -0.05, 0.05);
  const pts: Pt[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = x0 + (x1 - x0) * t;
    const yy = y + tilt * (t - 0.5) * 2 - Math.sin(t * Math.PI) * bow + (wob(t * 5) - 0.5) * em * 0.03;
    pts.push([x, yy]);
  }
  // the flick: the last point lifts
  const last = pts[n - 1]!;
  pts[n - 1] = [last[0] + em * 0.08, last[1] - em * uniform(rng, 0.08, 0.16)];
  return resample(pts, 28);
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const margin = Math.round(Math.min(w, h) * 0.06);
  const safe = safeRect(size, margin);
  const rng = mulberry32(seed);

  /* ── type ─────────────────────────────────────────────────────────────── */
  const mainSize = fitSize(S.endCard.tsuzuku, safe.w * (phone ? 0.82 : 0.5), safe.h * 0.32, { max: phone ? 300 : 360 });
  const cx = w / 2;
  const cy = safe.y + safe.h * (phone ? 0.46 : 0.5);
  const baseline = cy + mainSize * 0.33;
  const tw = textWidth(S.endCard.tsuzuku, mainSize);
  const texts: TextLayer[] = [
    { text: S.endCard.tsuzuku, x: cx, y: baseline, size: mainSize, font: FONTS.brush, fill: WASHI, anchor: 'middle', lang: 'ja' },
  ];

  /* ── ink field ────────────────────────────────────────────────────────── */
  const liftX = uniform(rng, 0.4, 0.6);
  const liftY = uniform(rng, 0.35, 0.55);
  const liftStrength = uniform(rng, 0.55, 0.9);
  const defs: string[] = [
    radialGradient('ec-lift', [[0, INK, liftStrength], [0.55, INK, liftStrength * 0.35], [1, SUMI, 0]], { cx: liftX, cy: liftY, r: 0.7, fx: liftX, fy: liftY }),
    inkBleed('ec-bleed', seed, { scale: Math.max(3, mainSize * 0.02), blur: 0.6, frequency: 0.03 }),
    inkBleed('ec-seal-bleed', seed ^ 0x5151, { scale: 2.5, blur: 0.4, frequency: 0.05 }),
  ];
  const body: string[] = [rect(0, 0, w, h, { fill: url('ec-lift') })];

  // drifting ink motes, barely there, so the field is paper-and-ink rather than a flat tile
  const motes: string[] = [];
  const moteCount = range(rng, 10, 22);
  for (let i = 0; i < moteCount; i++) {
    const mx = uniform(rng, 0, w);
    const my = uniform(rng, 0, h);
    const r = uniform(rng, 1, 3.5);
    motes.push(circle(mx, my, r, { fill: WASHI, opacity: uniform(rng, 0.04, 0.12) }));
  }
  body.push(el('g', undefined, motes));

  /* ── underline ────────────────────────────────────────────────────────── */
  const uy = baseline + mainSize * 0.2;
  const spine = underlineSpine(rng, cx, uy, tw, mainSize);
  const strokeSeed = Math.floor(rng() * 0xffffffff);
  body.push(
    el('g', { filter: url('ec-bleed'), opacity: 0.92 }, [
      dryBrush(spine, { width: mainSize * 0.085, pressure: PRESSURE.taper, seed: strokeSeed, bristle: 0.26, frequency: 7, fill: WASHI, hairs: 7, gap: 0.4 }),
    ]),
  );
  const flick = spine[spine.length - 1]!;
  body.push(path(splatter(flick[0] + mainSize * 0.04, flick[1] - mainSize * 0.02, mainSize * 0.22, seed ^ 0x9e37, range(rng, 7, 13)), { fill: WASHI, opacity: 0.78 }));

  /* ── seal ─────────────────────────────────────────────────────────────── */
  const sealSize = mainSize * 0.3;
  const sealX = cx + tw / 2 - sealSize * 0.15;
  const sealY = uy + mainSize * 0.12;
  const tilt = uniform(rng, -7, 7);
  const sealCx = sealX + sealSize / 2;
  const sealCy = sealY + sealSize / 2;
  const round = chance(rng, 0.3);
  body.push(
    el('g', { transform: `rotate(${fmt(tilt)} ${fmt(sealCx)} ${fmt(sealCy)})`, filter: url('ec-seal-bleed') }, [
      path(sealFrame({ x: sealX, y: sealY, size: sealSize, round, seed: seed ^ 0x2a2a, stroke: sealSize * 0.075, erode: 0.014 }), { fill: SHU, 'fill-rule': 'evenodd' }),
    ]),
  );
  const glyph = data.chosenKanji ?? Array.from(data.nameKana)[0] ?? '続';
  texts.push({
    text: glyph,
    x: sealCx,
    y: sealCy + sealSize * 0.22,
    size: sealSize * 0.6,
    font: FONTS.brush,
    fill: SHU,
    anchor: 'middle',
    rotate: tilt,
    lang: 'ja',
  });

  /* ── small type ───────────────────────────────────────────────────────── */
  const small = Math.max(22, Math.round(mainSize * 0.11));
  const streakY = sealY + sealSize + small * 1.9;
  texts.push({
    text: fill(S.endCard.streak, { n: data.streak }),
    x: cx,
    y: streakY,
    size: small,
    font: FONTS.mincho,
    fill: MUTED,
    anchor: 'middle',
    letterSpacing: small * 0.14,
    lang: 'ja',
  });
  texts.push({
    text: eraDate(data.date),
    x: cx,
    y: streakY + small * 1.7,
    size: Math.round(small * 0.78),
    font: FONTS.mincho,
    fill: HAI,
    anchor: 'middle',
    letterSpacing: small * 0.08,
    lang: 'ja',
  });

  // a hairline of ink wash under the small type, the "rest" the end card asks for
  const ruleW = textWidth(fill(S.endCard.streak, { n: data.streak }), small, { letterSpacing: small * 0.14 }) * 0.6;
  body.push(rect(cx - ruleW / 2, streakY + small * 0.55, ruleW, 1.5, { fill: alpha(INK_WASH, 0.5) }));

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body });
  return { svg, texts, post: 'grain' };
}
