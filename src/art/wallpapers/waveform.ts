/**
 * TSUZUKU — kakejiku 'waveform' (聴写の波形, design 06 §3).
 *
 * An oscilloscope trace of the sentence the learner dictated perfectly. The
 * signal is synthesised from the sentence itself: one burst per mora, its
 * amplitude from the vowel (あ loud, い/う quiet, っ a gap, ん a hum), its
 * frequency from a Tokyo-type pitch contour (low first mora, high plateau,
 * drop after a seeded accent nucleus, declination across phrases) and a
 * silence at every 、。. Phosphor glow, afterglow, graticule, pixel readouts;
 * the sentence in DotGothic16 below. Scanlines post pass.
 * Palette: sumi, neon-c. Unlock: Golden Ear badge.
 *
 * Seed → base frequency, accent nuclei, graticule style, afterglow, jitter.
 * Without a dictated sentence (not persisted; the Studio supplies it) the
 * trace is a flat "no signal" line and the caption says so honestly.
 */
import { chance, mulberry32, range, uniform } from '../../shared/hash';
import { moraSplit, stripPunctuation, toHiragana } from '../../shared/jp';
import { PALETTE, SUMI, mix } from '../color';
import { clamp, type Pt } from '../geom';
import { FONTS, eraDate, fitSize, glyphCount, splitColumns, type TextLayer } from '../jtext';
import { noise1 } from '../noise';
import { L, M, Z, blur, circle, el, glowTwin, line, linearGradient, polyline, radialGradient, rect, svgDoc, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-4';

const ID = 'waveform';
const NEON = PALETTE.dark['neon-c'];
const MUTED = PALETTE.dark['fg-muted'];

export const spec: WallpaperSpec = {
  id: ID,
  compose(seed, data, size) {
    return compose(seed, data, size);
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Sentence → signal units                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

type Vowel = 'a' | 'i' | 'u' | 'e' | 'o' | 'n' | 'q' | 'long' | 'other';
const ROWS: Record<Exclude<Vowel, 'n' | 'q' | 'long' | 'other'>, string> = {
  a: 'あかさたなはまやらわがざだばぱぁゃゎ',
  i: 'いきしちにひみりぎじぢびぴぃゐ',
  u: 'うくすつぬふむゆるぐずづぶぷぅゅゔ',
  e: 'えけせてねへめれげぜでべぺぇゑ',
  o: 'おこそとのほもよろをごぞどぼぽぉょ',
};
const VOWEL_AMP: Record<Vowel, number> = { a: 1, o: 0.86, e: 0.74, u: 0.56, i: 0.5, n: 0.38, q: 0.08, long: 0.9, other: 0.78 };

function vowelOf(mora: string): Vowel {
  const h = toHiragana(mora);
  const last = Array.from(h).pop() ?? '';
  if (last === 'ん') return 'n';
  if (last === 'っ') return 'q';
  if (last === 'ー') return 'long';
  for (const v of ['a', 'i', 'u', 'e', 'o'] as const) if (ROWS[v].includes(last)) return v;
  return 'other';
}

interface Unit {
  /** 0–1 loudness. */
  amp: number;
  /** 0–1 pitch. */
  pitch: number;
  /** Silence slot (punctuation). */
  pause: boolean;
}

/** Phrases split at Japanese punctuation; each phrase gets a Tokyo-type contour with a seeded nucleus. */
function unitsOf(sentence: string, rng: () => number): Unit[] {
  const phrases = sentence
    .split(/[、。，．！？!?,.\s　]+/)
    .map((p) => stripPunctuation(p))
    .filter((p) => glyphCount(p) > 0);
  const out: Unit[] = [];
  phrases.forEach((phrase, pi) => {
    const morae = moraSplit(phrase);
    const n = morae.length;
    // nucleus: 0 = heiban (no drop); otherwise the mora after which pitch falls
    const nucleus = chance(rng, 0.3) ? 0 : range(rng, 1, Math.max(1, n - 1));
    const declination = 1 - 0.22 * (phrases.length > 1 ? pi / (phrases.length - 1) : 0);
    let prevAmp = 0.7;
    for (let i = 0; i < n; i++) {
      const v = vowelOf(morae[i]!);
      let pitch: number;
      if (i === 0) pitch = n === 1 ? 0.7 : 0.3;
      else if (nucleus === 0 || i <= nucleus) pitch = 1 - 0.04 * i;
      else pitch = 0.36 - 0.02 * (i - nucleus);
      let amp = v === 'long' ? prevAmp * 0.92 : v === 'other' ? uniform(rng, 0.62, 0.95) : VOWEL_AMP[v];
      amp *= 0.9 + 0.1 * uniform(rng, 0, 1);
      prevAmp = amp;
      out.push({ amp: clamp(amp, 0.05, 1), pitch: clamp(pitch * declination, 0.1, 1), pause: false });
    }
    if (pi < phrases.length - 1) out.push({ amp: 0, pitch: 0, pause: true });
  });
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const margin = Math.round(Math.min(w, h) * 0.055);
  const safe = safeRect(size, margin);
  const rng = mulberry32(seed);
  const jit = noise1(mulberry32(seed ^ 0x77aa));

  const sentence = data.dictatedSentence ?? data.sentenceOfChoice;
  const units = sentence ? unitsOf(sentence, rng) : [];
  const live = units.some((u) => !u.pause);

  /* ── geometry ─────────────────────────────────────────────────────────── */
  const traceX0 = safe.x + safe.w * 0.04;
  const traceX1 = safe.x + safe.w * 0.96;
  const traceW = traceX1 - traceX0;
  const midY = safe.y + safe.h * (phone ? 0.33 : 0.42);
  const ampMax = phone ? Math.min(w * 0.3, safe.h * 0.16) : Math.min(h * 0.24, safe.h * 0.26);

  /* ── signal ───────────────────────────────────────────────────────────── */
  const baseCycles = uniform(rng, 1.7, 2.6);
  const perUnit = phone ? 12 : 16;
  const slots = units.reduce((a, u) => a + (u.pause ? 1.3 : 1), 0) + 1;
  const slotW = traceW / Math.max(slots, 4);
  const pts: Pt[] = [];
  const env: number[] = [];
  let phase = uniform(rng, 0, Math.PI * 2);
  let x = traceX0 + slotW * 0.5;
  const flatCount = Math.round(traceW / 6);
  if (!live) {
    for (let i = 0; i <= flatCount; i++) {
      const xx = traceX0 + (i / flatCount) * traceW;
      pts.push([xx, midY + (jit(i * 0.35) - 0.5) * ampMax * 0.03]);
      env.push(0.02);
    }
  } else {
    pts.push([traceX0, midY]);
    env.push(0);
    for (const u of units) {
      const width = slotW * (u.pause ? 1.3 : 1);
      const samples = u.pause ? Math.round(perUnit * 0.8) : perUnit;
      const f = baseCycles * (0.7 + 0.6 * u.pitch);
      for (let s = 0; s < samples; s++) {
        const t = s / samples;
        const xx = x + width * t;
        let e: number;
        if (u.pause) {
          e = 0.012;
        } else {
          const shape = Math.sin(Math.PI * t) ** 0.55;
          e = u.amp * shape * (0.94 + 0.12 * (jit(xx * 0.05) - 0.5));
          phase += (Math.PI * 2 * f) / samples;
        }
        const wave = u.pause ? (jit(xx * 0.2) - 0.5) * 0.6 : Math.sin(phase) * 0.82 + 0.18 * Math.sin(2 * phase + 0.7);
        pts.push([xx, midY - ampMax * e * wave]);
        env.push(e);
      }
      x += width;
    }
    pts.push([traceX1, midY]);
    env.push(0);
  }

  /* ── defs ─────────────────────────────────────────────────────────────── */
  const screenTint = mix(SUMI, NEON, 0.07);
  const defs: string[] = [
    radialGradient('wf-screen', [[0, screenTint, 1], [0.7, SUMI, 1], [1, '#06070a', 1]], { cx: 0.5, cy: phone ? 0.38 : 0.45, r: 0.75 }),
    glowTwin('wf-glow', phone ? 7 : 8, { opacity: 0.9 }),
    blur('wf-after', phone ? 12 : 16),
    linearGradient('wf-env', [[0, NEON, 0.22], [0.5, NEON, 0.04], [1, NEON, 0.22]], 90),
  ];
  const body: string[] = [rect(0, 0, w, h, { fill: url('wf-screen') })];

  /* ── graticule ────────────────────────────────────────────────────────── */
  const cols = phone ? 8 : 10;
  const rows = phone ? 16 : 8;
  const dotted = chance(rng, 0.4);
  const grat: string[] = [];
  const gx0 = safe.x;
  const gx1 = safe.x + safe.w;
  const gy0 = phone ? safe.y + safe.h * 0.04 : safe.y;
  const gy1 = phone ? midY + ampMax * 1.35 : safe.y + safe.h * 0.78;
  for (let c = 0; c <= cols; c++) {
    const gx = gx0 + ((gx1 - gx0) * c) / cols;
    grat.push(line(gx, gy0, gx, gy1, { stroke: NEON, 'stroke-width': 1, opacity: 0.09, 'stroke-dasharray': dotted ? '2 10' : undefined }));
  }
  for (let r = 0; r <= rows; r++) {
    const gy = gy0 + ((gy1 - gy0) * r) / rows;
    grat.push(line(gx0, gy, gx1, gy, { stroke: NEON, 'stroke-width': 1, opacity: 0.09, 'stroke-dasharray': dotted ? '2 10' : undefined }));
  }
  // centre axes with fine ticks
  const axisX = (gx0 + gx1) / 2;
  grat.push(line(axisX, gy0, axisX, gy1, { stroke: NEON, 'stroke-width': 1, opacity: 0.18 }));
  grat.push(line(gx0, midY, gx1, midY, { stroke: NEON, 'stroke-width': 1, opacity: 0.18 }));
  const tickN = cols * 5;
  for (let i = 0; i <= tickN; i++) {
    const tx = gx0 + ((gx1 - gx0) * i) / tickN;
    const len = i % 5 === 0 ? 10 : 5;
    grat.push(line(tx, midY - len, tx, midY + len, { stroke: NEON, 'stroke-width': 1, opacity: 0.22 }));
  }
  body.push(el('g', { 'shape-rendering': 'crispEdges' }, grat));

  /* ── envelope, afterglow, trace ───────────────────────────────────────── */
  if (live) {
    let d = M(pts[0]![0], midY);
    for (let i = 0; i < pts.length; i++) d += L(pts[i]![0], midY - env[i]! * ampMax);
    for (let i = pts.length - 1; i >= 0; i--) d += L(pts[i]![0], midY + env[i]! * ampMax);
    body.push(el('path', { d: d + Z, fill: url('wf-env') }));
  }
  body.push(polyline(pts, { fill: 'none', stroke: NEON, 'stroke-width': phone ? 11 : 13, 'stroke-linejoin': 'round', opacity: uniform(rng, 0.1, 0.18), filter: url('wf-after') }));
  body.push(polyline(pts, { fill: 'none', stroke: NEON, 'stroke-width': phone ? 3.5 : 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', filter: url('wf-glow') }));
  // the beam's bright spot at the end of the sweep
  const last = pts[pts.length - 1]!;
  body.push(circle(last[0], last[1], phone ? 6 : 5, { fill: '#ffffff', opacity: 0.9, filter: url('wf-glow') }));
  // trigger marker at the start
  const trig = traceX0 - 14;
  body.push(el('path', { d: `${M(trig, midY - 9)}${L(trig + 12, midY)}${L(trig, midY + 9)}${Z}`, fill: NEON, opacity: 0.7 }));

  /* ── mora ticks under the trace ───────────────────────────────────────── */
  if (live) {
    const ticks: string[] = [];
    const ty = midY + ampMax * 1.12;
    let tx = traceX0 + slotW * 0.5;
    for (const u of units) {
      const width = slotW * (u.pause ? 1.3 : 1);
      if (u.pause) ticks.push(rect(tx + width * 0.3, ty - 1, width * 0.4, 2, { fill: NEON, opacity: 0.25 }));
      else ticks.push(rect(tx + width / 2 - 1.5, ty - 4 - u.amp * 10, 3, 4 + u.amp * 10, { fill: NEON, opacity: 0.35 + 0.35 * u.pitch }));
      tx += width;
    }
    body.push(el('g', { 'shape-rendering': 'crispEdges' }, ticks));
  }

  /* ── text ─────────────────────────────────────────────────────────────── */
  const texts: TextLayer[] = [];
  const readout = Math.round(Math.min(w, h) * (phone ? 0.03 : 0.024));
  const readY = (phone ? gy0 : safe.y) + readout * 1.1;
  const pixel = (text: string, px: number, y: number, fill: string, anchor: 'start' | 'middle' | 'end', sz = readout, opacity = 1): TextLayer => ({
    text,
    x: px,
    y,
    size: sz,
    font: FONTS.pixel,
    fill,
    anchor,
    opacity,
    lang: 'ja',
  });
  texts.push(pixel(S.waveform.channel, gx0 + 6, readY, NEON, 'start', readout, 0.85));
  texts.push(pixel(S.waveform.volts, gx0 + 6 + readout * 3.2, readY, MUTED, 'start', readout, 0.9));
  texts.push(pixel(S.waveform.time, gx0 + 6 + readout * 9.2, readY, MUTED, 'start', readout, 0.9));
  if (live) texts.push(pixel(S.waveform.perfect, gx1 - 6, readY, NEON, 'end', readout, 0.85));

  const caption = live && sentence ? sentence : S.waveform.noSignal;
  const lineBoxW = safe.w * (phone ? 0.88 : 0.82);
  const maxLine = phone ? 11 : 24;
  const lines = splitColumns(caption, Math.min(4, Math.max(1, Math.ceil(glyphCount(caption) / maxLine))));
  const lineMax = phone ? 78 : 64;
  const lineSize = Math.max(18, Math.min(...lines.map((l) => fitSize(l, lineBoxW, lineMax * 1.2, { max: lineMax }))));
  const pitch = lineSize * 1.55;
  const firstY = midY + ampMax + (phone ? safe.h * 0.09 : safe.h * 0.12) + lineSize * 0.88;
  lines.forEach((l, i) => texts.push(pixel(l, w / 2, firstY + i * pitch, live ? NEON : MUTED, 'middle', lineSize)));

  const footSize = Math.round(lineSize * 0.5);
  const footY = firstY + (lines.length - 1) * pitch + lineSize * 1.6;
  const foot = `${data.nameKana}　${eraDate(data.date)}`;
  texts.push(pixel(foot, w / 2, Math.min(footY, safe.y + safe.h - footSize * 0.3), MUTED, 'middle', footSize, 0.9));

  const svg = svgDoc({ w, h, title: WALLPAPER_NAMES[ID].en, bg: SUMI, defs, body });
  return { svg, texts, post: 'scanlines' };
}
