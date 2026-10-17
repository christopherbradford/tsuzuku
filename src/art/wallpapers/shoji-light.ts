/**
 * TSUZUKU — kakejiku 'shoji-light' 障子 (design 06 §3).
 *
 * Afternoon light through paper screens. A wall of shōji panels (kumiko
 * lattice over warm paper), a sun spot behind the paper, and the blurred
 * shadow of bamboo swaying outside in three depths. Every paper cell carries
 * one of the learner's Brown grammar patterns written vertically at 8 %
 * opacity, so the wall is quietly made of what they know.
 *
 * Layers: paper → light → grammar (8 % ink) → bamboo shadows (3 blur depths)
 * → kumiko bars and frames → rails and floor → a wooden name plaque.
 * Text (name on the plaque, pattern count, era date) is returned as
 * TextLayers inside the phone safe zone. Pure for (seed, data, size).
 */
import { chance, hashSeed, mulberry32, range, uniform } from '../../shared/hash';
import { INK, INK_WASH, SHOJI, WARM, WASHI, darken, mix } from '../color';
import { grid, type Box } from '../geom';
import { FONTS, eraDate, fitSize, tategakiLayers, type TextLayer } from '../jtext';
import { noise1 } from '../noise';
import { M, Q, Z, blur, circle, el, ellipse, g, line, linearGradient, path, radialGradient, rect, safeRect, sizeOf, svgDoc, text, url } from '../svg';
import type { WallpaperSpec } from './spec';
import { S } from './strings-3';

const LATTICE = '#3A2A1E';
const RAIL = '#2A1E14';
const PLAQUE = '#8B6B4A';
const SHADOW = mix(INK, '#6B5A3E', 0.45);

interface Panel {
  box: Box;
  cols: number;
  rows: number;
}

/** A lanceolate bamboo leaf as a path around (x, y), length `len`, rotated `rot` degrees. */
function leaf(x: number, y: number, len: number, rot: number): string {
  const wHalf = len * 0.14;
  const d = M(x, y) + Q(x + len * 0.5, y - wHalf, x + len, y) + Q(x + len * 0.5, y + wHalf, x, y) + Z;
  return path(d, { transform: `rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` });
}

export const spec: WallpaperSpec = {
  id: 'shoji-light',
  compose(seed, data, size) {
    const { w, h } = sizeOf(size);
    const phone = size === 'phone';
    const rng = mulberry32(seed);
    const sway = noise1(mulberry32(hashSeed(seed, 'sway')));
    const defs: string[] = [];
    const body: string[] = [];

    /* Paper and light */
    defs.push(linearGradient('sl-paper', [[0, mix(SHOJI, WARM, 0.1)], [0.5, SHOJI], [1, mix(SHOJI, '#D9CDB6', 0.35)]], 90));
    body.push(rect(0, 0, w, h, { fill: url('sl-paper') }));
    const lightSide = chance(rng, 0.5) ? -1 : 1;
    const lx = w / 2 + lightSide * uniform(rng, 0.12, 0.3) * w;
    const ly = uniform(rng, 0.18, 0.4) * h;
    const lr = Math.max(w, h) * uniform(rng, 0.42, 0.6);
    const warmth = uniform(rng, 0.5, 0.85);
    defs.push(radialGradient('sl-light', [[0, mix(WARM, '#FFFFFF', 0.35), warmth], [0.35, WARM, warmth * 0.5], [1, WARM, 0]], { cx: 0.5, cy: 0.5, r: 0.5 }));
    body.push(circle(lx, ly, lr, { fill: url('sl-light') }));

    /* Panel geometry */
    const frame = phone ? 22 : 18;
    const bar = phone ? 7 : 5;
    const railH = Math.round(h * (phone ? 0.035 : 0.045));
    const floorY = Math.round(h * (phone ? 0.93 : 0.92));
    const wallTop = railH;
    const panelCount = phone ? 2 : range(rng, 3, 4);
    const gap = frame;
    const panelW = (w - gap * (panelCount + 1)) / panelCount;
    const panels: Panel[] = [];
    const cols = phone ? 3 : range(rng, 3, 4);
    const rows = phone ? range(rng, 8, 10) : range(rng, 5, 7);
    for (let i = 0; i < panelCount; i++) {
      panels.push({ box: { x: gap + i * (panelW + gap), y: wallTop + frame, w: panelW, h: floorY - wallTop - frame * 2 }, cols, rows });
    }

    /* Grammar on the paper, 8 % ink, one pattern per cell (tategaki order: right-to-left columns) */
    const patterns = data.grammarBrown;
    const glyphs: string[] = [];
    const cellTints: string[] = [];
    let pi = 0;
    for (const p of [...panels].reverse()) {
      const cells = grid(p.cols, p.rows, { x: p.box.x + frame, y: p.box.y + frame, w: p.box.w - frame * 2, h: p.box.h - frame * 2 }, bar);
      for (const c of cells) {
        const tint = uniform(rng, 0, 1);
        if (tint > 0.55) cellTints.push(rect(c.x, c.y, c.w, c.h, { fill: tint > 0.8 ? '#FFFFFF' : '#D9CDB6', opacity: uniform(rng, 0.03, 0.09) }));
      }
      // right-to-left columns, top-to-bottom rows, like a page of tategaki
      for (let col = p.cols - 1; col >= 0; col--) {
        for (let row = 0; row < p.rows; row++) {
          if (pi >= patterns.length) break;
          const c = cells[row * p.cols + col]!;
          const t = patterns[pi++]!;
          const sz = fitSize(t, c.w * 0.5, c.h - 24, { vertical: true, min: 8, max: phone ? 44 : 40 });
          const pitch = sz * 1.12;
          const chars = Array.from(t);
          const colH = sz + (chars.length - 1) * pitch;
          const y0 = c.y + (c.h - colH) / 2 + sz / 2;
          const parts: string[] = [];
          for (let k = 0; k < chars.length; k++) {
            const ch = chars[k]!;
            const cy = y0 + k * pitch;
            const rot = ch === 'ー' || ch === '〜' || ch === '～' ? `rotate(90 ${c.cx.toFixed(1)} ${cy.toFixed(1)})` : undefined;
            parts.push(text(ch, { x: c.cx, y: cy, transform: rot }));
          }
          glyphs.push(g({ 'font-size': sz }, parts));
        }
      }
    }
    body.push(g(undefined, cellTints));
    if (glyphs.length) body.push(g({ 'font-family': FONTS.mincho, fill: INK, opacity: 0.08, 'text-anchor': 'middle', 'dominant-baseline': 'central', lang: 'ja' }, glyphs));

    /* Bamboo shadows in three depths */
    const bambooSide = -lightSide; // shadows fall away from the light
    const depths: { blur: number; opacity: number; scale: number }[] = [
      { blur: phone ? 18 : 14, opacity: 0.18, scale: 1.25 },
      { blur: phone ? 10 : 8, opacity: 0.26, scale: 1.05 },
      { blur: phone ? 5 : 4, opacity: 0.35, scale: 0.9 },
    ];
    depths.forEach((d, di) => {
      defs.push(blur(`sl-shadow-${di}`, d.blur));
      const parts: string[] = [];
      const stalks = range(rng, 1, 2);
      for (let s = 0; s < stalks; s++) {
        const baseX = w / 2 + bambooSide * uniform(rng, 0.12, 0.46) * w + (di - 1) * uniform(rng, 40, 120);
        const lean = uniform(rng, -0.12, 0.12) + (sway(seed * 0.001 + s + di) - 0.5) * 0.1;
        const width = (phone ? 26 : 20) * d.scale * uniform(rng, 0.8, 1.2);
        const segLen = h * uniform(rng, 0.11, 0.16);
        let y = h + 20;
        let x = baseX;
        let n = 0;
        while (y > -segLen && n < 14) {
          const y2 = y - segLen;
          const x2 = x + lean * segLen;
          parts.push(line(x, y, x2, y2, { stroke: SHADOW, 'stroke-width': width, 'stroke-linecap': 'butt' }));
          parts.push(ellipse(x2, y2, width * 0.75, width * 0.3, { fill: SHADOW }));
          // branch with leaves
          if (n > 0 && chance(rng, 0.7)) {
            const dir = chance(rng, 0.5) ? -1 : 1;
            const bl = segLen * uniform(rng, 0.45, 0.8);
            const bx = x2 + dir * bl;
            const by = y2 - bl * uniform(rng, 0.15, 0.45);
            parts.push(line(x2, y2, bx, by, { stroke: SHADOW, 'stroke-width': width * 0.22 }));
            const leaves = range(rng, 4, 8);
            for (let k = 0; k < leaves; k++) {
              const t = uniform(rng, 0.45, 1);
              const px = x2 + (bx - x2) * t;
              const py = y2 + (by - y2) * t;
              const len = segLen * uniform(rng, 0.22, 0.4) * d.scale;
              const rot = uniform(rng, -10, 70) * (dir > 0 ? 1 : -1) + (dir > 0 ? 0 : 180);
              parts.push(leaf(px, py, len, rot));
            }
          }
          y = y2;
          x = x2;
          n++;
        }
      }
      body.push(g({ fill: SHADOW, filter: url(`sl-shadow-${di}`), opacity: d.opacity }, parts));
    });
    // a sparrow resting on the near stalk (seeded)
    if (chance(rng, 0.4)) {
      const bx = w / 2 + bambooSide * uniform(rng, 0.1, 0.4) * w;
      const by = uniform(rng, 0.25, 0.55) * h;
      const sz = phone ? 34 : 26;
      defs.push(blur('sl-bird', 3));
      body.push(g({ fill: SHADOW, opacity: 0.4, filter: url('sl-bird') }, [ellipse(bx, by, sz, sz * 0.62), circle(bx + sz * 0.8, by - sz * 0.35, sz * 0.42), path(M(bx - sz * 0.8, by) + Q(bx - sz * 1.6, by - sz * 0.2, bx - sz * 2, by + sz * 0.3) + Q(bx - sz * 1.4, by + sz * 0.3, bx - sz * 0.7, by + sz * 0.35) + Z)]));
    }

    /* Kumiko bars and frames */
    const lattice: string[] = [];
    for (const p of panels) {
      const inner: Box = { x: p.box.x + frame, y: p.box.y + frame, w: p.box.w - frame * 2, h: p.box.h - frame * 2 };
      for (let c = 1; c < p.cols; c++) {
        const x = inner.x + (inner.w / p.cols) * c - bar / 2;
        lattice.push(rect(x, inner.y, bar, inner.h, { fill: LATTICE }));
      }
      for (let r = 1; r < p.rows; r++) {
        const y = inner.y + (inner.h / p.rows) * r - bar / 2;
        lattice.push(rect(inner.x, y, inner.w, bar, { fill: LATTICE }));
      }
      lattice.push(el('path', { d: `M${p.box.x} ${p.box.y}h${p.box.w}v${p.box.h}h${-p.box.w}Z M${inner.x} ${inner.y}v${inner.h}h${inner.w}v${-inner.h}Z`, fill: LATTICE, 'fill-rule': 'evenodd' }));
      lattice.push(rect(p.box.x + 2, p.box.y + 2, p.box.w - 4, 2, { fill: WASHI, opacity: 0.15 }));
    }
    body.push(g({ 'shape-rendering': 'crispEdges' }, lattice));

    /* Rails and floor */
    body.push(rect(0, 0, w, railH, { fill: RAIL }));
    body.push(rect(0, railH - 3, w, 3, { fill: WASHI, opacity: 0.12 }));
    body.push(rect(0, floorY, w, h - floorY, { fill: RAIL }));
    body.push(rect(0, floorY, w, 4, { fill: mix(RAIL, WARM, 0.25) }));
    const planks = range(rng, 5, 9);
    for (let i = 1; i < planks; i++) body.push(line((i / planks) * w, floorY, (i / planks) * w, h, { stroke: darken(RAIL, 0.4), 'stroke-width': 2 }));

    /* Wooden name plaque hung on a frame post (right side), count under it, date bottom-right */
    const texts: TextLayer[] = [];
    const safe = safeRect(size, 0);
    const last = panels[panels.length - 1]!;
    const plaqueW = phone ? 96 : 72;
    // No floor: a name at NAME_MAX_GLYPHS must shrink to fit its box (review round 2).
    const nameSize = fitSize(data.nameKana, plaqueW * 0.6, safe.h * 0.36, { vertical: true, max: phone ? 54 : 42 });
    const chars = Array.from(data.nameKana).length;
    const plaqueH = nameSize * (1 + (chars - 1) * 1.12) + nameSize * 1.4;
    const px = last.box.x + last.box.w - frame - plaqueW - (phone ? 30 : 24);
    const py = safe.y + (phone ? 120 : 80);
    body.push(el('rect', { x: px, y: py, width: plaqueW, height: plaqueH, rx: 4, fill: PLAQUE, stroke: darken(PLAQUE, 0.45), 'stroke-width': 3 }));
    body.push(line(px + plaqueW / 2, py, px + plaqueW / 2, py - frame * 1.5, { stroke: darken(PLAQUE, 0.6), 'stroke-width': 2 }));
    texts.push(...tategakiLayers({ text: data.nameKana, x: px + plaqueW / 2, y: py + nameSize * 0.7, size: nameSize, font: FONTS.mincho, fill: INK }));
    const small = phone ? 28 : 22;
    texts.push({ text: `${patterns.length}${S.patternUnit}`, x: px + plaqueW / 2, y: py + plaqueH + small * 1.5, size: small, font: FONTS.mincho, fill: INK_WASH, anchor: 'middle', lang: 'ja' });
    const dateY = Math.min(last.box.y + last.box.h - frame - small * 1.2, safe.y + safe.h - small);
    texts.push({ text: eraDate(data.date), x: last.box.x + last.box.w - frame - (phone ? 30 : 24), y: dateY, size: small, font: FONTS.mincho, fill: INK_WASH, anchor: 'end', opacity: 0.9, lang: 'ja' });

    return { svg: svgDoc({ w, h, defs, body }), texts, post: 'grain' };
  },
};
