/**
 * TSUZUKU — kakejiku 'vending-night' 自販機の夜 (design 06 §3).
 *
 * A generic vending machine glowing warm on a rainy street at night. The
 * display window is lit from inside; every can and bottle wears a label that
 * is one of the learner's mastered katakana words; the top sign carries their
 * name. 400 rain lines fall through the light, and the wet asphalt returns
 * the machine as a rippled puddle flip.
 *
 * Layers: night wall → streetlamp → machine (drawn once in defs, used twice:
 * upright and flipped/displaced for the puddle) → rain → splashes.
 * Text (sign name, katakana count, era date) is returned as TextLayers inside
 * the phone safe zone. Pure for (seed, data, size).
 */
import { chance, hashSeed, mulberry32, pick, range, uniform } from '../../shared/hash';
import { FOAM, INK, NIGHT, PALETTE, SUMI, WARM, WASHI, darken, lighten, mix, pickReadable } from '../color';
import type { Box } from '../geom';
import { FONTS, eraDate, fitSize, textWidth, type TextLayer } from '../jtext';
import { blur, circle, displace, ellipse, g, line, linearGradient, mask, path, pattern, radialGradient, rect, roundedRectPath, safeRect, sizeOf, svgDoc, text, url, use } from '../svg';
import type { WallpaperSpec } from './spec';
import { S } from './strings-3';

const NEON_C = PALETTE.dark['neon-c'];
const SHU = PALETTE.dark.shu;
const KIN = PALETTE.dark.kin;
const BODIES = ['#D9CDB6', '#2F6FD6', '#C9302C', '#F4EDE0', '#E0B341'] as const;
const LABELS = [NEON_C, SHU, KIN, FOAM, '#3E9B4F', '#2F6FD6', '#F7B2C4'] as const;

export const spec: WallpaperSpec = {
  id: 'vending-night',
  compose(seed, data, size) {
    const { w, h } = sizeOf(size);
    const phone = size === 'phone';
    const rng = mulberry32(seed);
    const defs: string[] = [];
    const body: string[] = [];
    const groundY = Math.round(h * (phone ? 0.82 : 0.84));

    /* Night wall and ground */
    defs.push(linearGradient('vn-sky', [[0, SUMI], [1, mix(SUMI, NIGHT, 0.7)]], 90));
    body.push(rect(0, 0, w, groundY, { fill: url('vn-sky') }));
    const brick = phone ? 64 : 52;
    defs.push(pattern('vn-wall', brick * 2, brick, [line(0, brick - 0.5, brick * 2, brick - 0.5, { stroke: FOAM, 'stroke-width': 1, opacity: 0.06 }), line(brick, 0, brick, brick, { stroke: FOAM, 'stroke-width': 1, opacity: 0.05 })]));
    body.push(rect(0, h * 0.18, w, groundY - h * 0.18, { fill: '#13131B' }));
    body.push(rect(0, h * 0.18, w, groundY - h * 0.18, { fill: url('vn-wall') }));
    defs.push(linearGradient('vn-ground', [[0, '#1C1C26'], [1, '#08080C']], 90));
    body.push(rect(0, groundY, w, h - groundY, { fill: url('vn-ground') }));
    body.push(line(0, groundY, w, groundY, { stroke: FOAM, 'stroke-width': 1.5, opacity: 0.12 }));

    /* Machine geometry */
    const Mw = phone ? w * 0.62 : w * 0.25;
    const Mh = phone ? h * 0.46 : h * 0.68;
    const mx = (w - Mw) / 2 + (phone ? 0 : uniform(rng, -0.12, 0.12) * w);
    const my = groundY - Mh;

    /* Streetlamp, away from the machine */
    if (chance(rng, 0.65)) {
      const lx = mx + Mw / 2 < w / 2 ? w * uniform(rng, 0.78, 0.9) : w * uniform(rng, 0.1, 0.22);
      const ly = h * (phone ? 0.3 : 0.22);
      defs.push(blur('vn-lamp', phone ? 70 : 50));
      body.push(circle(lx, ly, Math.min(w, h) * 0.16, { fill: WARM, opacity: 0.16, filter: url('vn-lamp') }));
      body.push(line(lx, ly, lx, groundY, { stroke: '#1E1E28', 'stroke-width': phone ? 14 : 10 }));
      body.push(rect(lx - 26, ly - 10, 52, 16, { fill: '#2A2A36', rx: 3 }));
      body.push(ellipse(lx, ly + 8, 20, 6, { fill: mix(WARM, FOAM, 0.4) }));
    }

    /* Second, unlit machine behind (seeded) */
    if (chance(rng, 0.45)) {
      const side = mx + Mw / 2 < w / 2 ? 1 : -1;
      const gx = side > 0 ? mx + Mw * 1.12 : mx - Mw * 0.9;
      body.push(g({ opacity: 0.6 }, [rect(gx, my + Mh * 0.08, Mw * 0.78, Mh * 0.92, { fill: '#1A1A24', rx: 6 }), rect(gx + Mw * 0.06, my + Mh * 0.16, Mw * 0.66, Mh * 0.42, { fill: '#0E0E15' })]));
    }

    /* The machine, built once in defs */
    const bodyColor = pick(rng, BODIES);
    const machine: string[] = [];
    defs.push(blur('vn-aura', phone ? 70 : 50));
    body.push(rect(mx - Mw * 0.1, my - Mh * 0.04, Mw * 1.2, Mh * 1.08, { fill: WARM, opacity: 0.22, filter: url('vn-aura') }));
    defs.push(linearGradient('vn-body', [[0, lighten(bodyColor, 0.08)], [1, darken(bodyColor, 0.22)]], 90));
    machine.push(path(roundedRectPath(mx, my, Mw, Mh, Mw * 0.02), { fill: url('vn-body'), stroke: darken(bodyColor, 0.5), 'stroke-width': 2 }));
    machine.push(rect(mx + Mw * 0.03, my + Mh * 0.005, Mw * 0.94, 3, { fill: FOAM, opacity: 0.25 }));

    // top sign (lit)
    const sign: Box = { x: mx + Mw * 0.06, y: my + Mh * 0.025, w: Mw * 0.88, h: Mh * 0.06 };
    defs.push(linearGradient('vn-sign', [[0, mix(WARM, FOAM, 0.35)], [1, WARM]], 90));
    machine.push(rect(sign.x, sign.y, sign.w, sign.h, { fill: url('vn-sign'), rx: 4 }));
    machine.push(rect(sign.x, sign.y, sign.w, sign.h, { fill: 'none', stroke: darken(bodyColor, 0.5), 'stroke-width': 2, rx: 4 }));

    // display window with inner glow
    const win: Box = { x: mx + Mw * 0.06, y: my + Mh * 0.1, w: Mw * 0.88, h: Mh * 0.5 };
    defs.push(radialGradient('vn-glow', [[0, WARM, 0.85], [0.55, WARM, 0.5], [1, darken(WARM, 0.5), 0.3]], { cx: 0.5, cy: 0.45, r: 0.7 }));
    machine.push(rect(win.x, win.y, win.w, win.h, { fill: '#0D0D14' }));
    machine.push(rect(win.x, win.y, win.w, win.h, { fill: url('vn-glow') }));

    // shelves of cans and bottles with katakana labels
    const words = data.katakanaBrown;
    const rows = phone ? 4 : 3;
    const cols = phone ? 4 : range(rng, 5, 6);
    const pad = win.w * 0.03;
    const cellW = (win.w - pad * 2) / cols;
    const cellH = (win.h - pad * 2) / rows;
    const labelGlyphs: string[] = [];
    let wi = 0;
    for (let r = 0; r < rows; r++) {
      const hot = r === rows - 1 && chance(rng, 0.8);
      const shelfY = win.y + pad + (r + 1) * cellH;
      for (let c = 0; c < cols; c++) {
        const cx0 = win.x + pad + c * cellW;
        const bottle = chance(rng, 0.35);
        const iw = cellW * (bottle ? 0.42 : 0.6);
        const ih = cellH * (bottle ? 0.6 : 0.56);
        const ix = cx0 + (cellW - iw) / 2;
        const iy = shelfY - cellH * 0.22 - ih;
        const labelColor = pick(rng, LABELS);
        if (bottle) {
          machine.push(rect(ix + iw * 0.3, iy - cellH * 0.12, iw * 0.4, cellH * 0.13, { fill: mix(labelColor, FOAM, 0.4), rx: 2 }));
          machine.push(path(roundedRectPath(ix, iy, iw, ih, iw * 0.25), { fill: mix(labelColor, INK, 0.3) }));
        } else {
          machine.push(path(roundedRectPath(ix, iy, iw, ih, iw * 0.12), { fill: mix(labelColor, FOAM, 0.75) }));
          machine.push(rect(ix, iy + ih * 0.06, iw, 2, { fill: FOAM, opacity: 0.5 }));
        }
        const band: Box = { x: ix, y: iy + ih * 0.3, w: iw, h: ih * 0.42 };
        machine.push(rect(band.x, band.y, band.w, band.h, { fill: labelColor }));
        if (words.length > 0) {
          const word = words[wi++ % words.length]!;
          const fill = pickReadable(labelColor, [INK, FOAM]);
          const hs = fitSize(word, band.w * 0.9, band.h * 0.7, { min: 6, max: phone ? 26 : 18 });
          if (textWidth(word, hs) <= band.w * 0.92 && hs >= (phone ? 12 : 9)) {
            labelGlyphs.push(text(word, { x: band.x + band.w / 2, y: band.y + band.h / 2 + hs * 0.35, 'font-size': hs, fill, 'text-anchor': 'middle' }));
          } else {
            const chars = Array.from(word).slice(0, 6);
            const vs = fitSize(chars.join(''), band.w * 0.8, ih * 0.9, { vertical: true, min: 6, max: phone ? 22 : 15 });
            const colH = vs + (chars.length - 1) * vs * 1.08;
            const y0 = iy + ih / 2 - colH / 2 + vs / 2;
            labelGlyphs.push(g({ 'font-size': vs, fill, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, chars.map((ch, k) => text(ch, { x: band.x + band.w / 2, y: y0 + k * vs * 1.08, transform: ch === 'ー' ? `rotate(90 ${(band.x + band.w / 2).toFixed(1)} ${(y0 + k * vs * 1.08).toFixed(1)})` : undefined }))));
          }
        }
        // button under the item
        const bw = cellW * 0.5;
        machine.push(rect(cx0 + (cellW - bw) / 2, shelfY - cellH * 0.17, bw, cellH * 0.11, { fill: '#1F1F2A', rx: 2 }));
        machine.push(circle(cx0 + cellW / 2 + bw * 0.32, shelfY - cellH * 0.115, Math.max(1.5, cellH * 0.025), { fill: hot ? SHU : NEON_C }));
      }
      // shelf line and indicator strip
      machine.push(rect(win.x + pad, shelfY - cellH * 0.22, win.w - pad * 2, 2, { fill: FOAM, opacity: 0.35 }));
      machine.push(rect(win.x + pad, shelfY - cellH * 0.05, win.w - pad * 2, cellH * 0.05, { fill: hot ? SHU : '#2F6FD6' }));
      labelGlyphs.push(text(hot ? S.hot : S.cold, { x: win.x + pad + 6, y: shelfY - cellH * 0.012, 'font-size': Math.max(6, cellH * 0.045), fill: FOAM, 'text-anchor': 'start' }));
    }
    if (labelGlyphs.length) machine.push(g({ 'font-family': FONTS.ja, lang: 'ja' }, labelGlyphs));

    // lower front: coin slot, display, return, hatch
    const lower: Box = { x: mx + Mw * 0.06, y: my + Mh * 0.63, w: Mw * 0.88, h: Mh * 0.33 };
    machine.push(rect(lower.x, lower.y, lower.w, lower.h * 0.05, { fill: darken(bodyColor, 0.35) }));
    const coinX = lower.x + lower.w * 0.68;
    machine.push(rect(coinX, lower.y + lower.h * 0.1, lower.w * 0.26, lower.h * 0.3, { fill: darken(bodyColor, 0.3), rx: 3 }));
    machine.push(rect(coinX + lower.w * 0.03, lower.y + lower.h * 0.14, lower.w * 0.2, lower.h * 0.08, { fill: '#0B0B10', rx: 2 }));
    machine.push(rect(coinX + lower.w * 0.06, lower.y + lower.h * 0.16, lower.w * 0.14, lower.h * 0.04, { fill: NEON_C, opacity: 0.8 }));
    machine.push(rect(coinX + lower.w * 0.1, lower.y + lower.h * 0.26, lower.w * 0.06, lower.h * 0.1, { fill: '#0B0B10', rx: 1 }));
    machine.push(circle(coinX + lower.w * 0.2, lower.y + lower.h * 0.33, lower.w * 0.025, { fill: '#2A2A36' }));
    machine.push(path(roundedRectPath(lower.x + lower.w * 0.08, lower.y + lower.h * 0.5, lower.w * 0.84, lower.h * 0.42, 6), { fill: '#0E0E15' }));
    machine.push(rect(lower.x + lower.w * 0.1, lower.y + lower.h * 0.52, lower.w * 0.8, lower.h * 0.1, { fill: '#2A2A36', rx: 3 }));
    machine.push(rect(mx, my + Mh * 0.985, Mw, Mh * 0.015, { fill: '#08080C' }));
    defs.push(g({ id: 'vn-machine' }, machine));

    /* Puddle flip, then the machine itself */
    defs.push(displace('vn-ripple', { baseFrequency: [0.012, 0.05], scale: phone ? 16 : 11, seed: hashSeed(seed, 'ripple') }));
    defs.push(linearGradient('vn-puddle-fade', [[0, '#FFFFFF', 0.9], [0.5, '#FFFFFF', 0.4], [1, '#000000', 1]], 90));
    defs.push(mask('vn-puddle', rect(mx - Mw, groundY, Mw * 3, Mh * 0.75, { fill: url('vn-puddle-fade') })));
    body.push(g({ mask: url('vn-puddle'), opacity: 0.5 }, use('vn-machine', { transform: `translate(0 ${groundY * 2}) scale(1 -1)`, filter: url('vn-ripple') })));
    body.push(ellipse(mx + Mw / 2, groundY + Mh * 0.12, Mw * 0.9, Mh * 0.1, { fill: 'none', stroke: FOAM, 'stroke-width': 1, opacity: 0.08 }));
    body.push(use('vn-machine'));

    /* Rain: 400 lines */
    const slant = uniform(rng, 8, 18) * (chance(rng, 0.5) ? 1 : -1);
    const rain: string[] = [];
    for (let i = 0; i < 400; i++) {
      const x = uniform(rng, -0.05, 1.05) * w;
      const y = uniform(rng, -40, groundY);
      const len = uniform(rng, 18, 70) * (phone ? 1.4 : 1);
      const a = ((slant + uniform(rng, -2, 2)) * Math.PI) / 180;
      rain.push(line(x, y, x + Math.sin(a) * len, y + Math.cos(a) * len, { 'stroke-width': uniform(rng, 0.8, 1.6), opacity: uniform(rng, 0.1, 0.5) }));
    }
    body.push(g({ stroke: FOAM, 'stroke-linecap': 'round' }, rain));
    const splashes: string[] = [];
    const nSplash = range(rng, 18, 30);
    for (let i = 0; i < nSplash; i++) {
      const sx = uniform(rng, 0, 1) * w;
      const sy = groundY + uniform(rng, 4, h - groundY - 10);
      splashes.push(ellipse(sx, sy, uniform(rng, 4, 14), uniform(rng, 1, 3), { fill: 'none', stroke: FOAM, 'stroke-width': 1, opacity: uniform(rng, 0.1, 0.3) }));
    }
    body.push(g(undefined, splashes));

    /* Text */
    const texts: TextLayer[] = [];
    const safe = safeRect(size, 0);
    const margin = phone ? 84 : 72;
    const nameSize = fitSize(data.nameKana, sign.w * 0.84, sign.h * 0.66, { min: 12, max: sign.h * 0.66 });
    texts.push({ text: data.nameKana, x: sign.x + sign.w / 2, y: sign.y + sign.h / 2 + nameSize * 0.36, size: nameSize, font: FONTS.neon, fill: INK, anchor: 'middle', lang: 'ja' });
    const small = phone ? 30 : 24;
    const bottomY = safe.y + safe.h - (phone ? 56 : 48);
    texts.push({ text: `${words.length}${S.katakanaUnit}`, x: margin, y: bottomY, size: small, font: FONTS.pixel, fill: WARM, anchor: 'start', opacity: 0.9, lang: 'ja' });
    texts.push({ text: eraDate(data.date), x: w - margin, y: bottomY, size: small, font: FONTS.mincho, fill: WASHI, anchor: 'end', opacity: 0.7, lang: 'ja' });
    for (const t of texts) {
      if (t.y - t.size * 0.88 < safe.y) t.y = safe.y + t.size * 0.9;
    }

    return { svg: svgDoc({ w, h, defs, body }), texts, post: 'grain' };
  },
};
