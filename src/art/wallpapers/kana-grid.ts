/**
 * TSUZUKU — kakejiku 'kana-grid' 五十音セレクト (design 06 §3).
 *
 * An arcade character-select screen: the gojūon as 10 × 5 tiles on sumi,
 * each tile heat-coloured from the learner's best Gojūon Fighter reaction
 * time (neon-c fast → neon-m slow, hai when never timed), blurred glow
 * twins behind the lit frames, the 1P cursor parked on the slowest kana.
 * The slowest kana also looms faint and huge behind the grid. Scanlines
 * are the post pass. Kana glyphs are fixed decoration inside the SVG; the
 * learner's name, XP and the two reaction-time readouts are `TextLayer`s.
 *
 * Seed → background speckles and streaks, grid pattern pitch, vignette,
 * cursor bracket shape, the tilt of the big glyph.
 */
import { mulberry32, range, uniform } from '../../shared/hash';
import { PALETTE, SUMI, WASHI, alpha, mixOklab } from '../color';
import { FONTS, fitSize, type TextLayer } from '../jtext';
import { vignette } from '../pixel';
import { L, M, Z, g, glowTwin, line, linearGradient, path, pattern, rect, svgDoc, text, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-1';

const P = 'kg';
const COLS = 10;
const ROWS = 5;

interface Cell {
  kana: string;
  x: number;
  y: number;
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size, phone ? 40 : 40);
  const D = PALETTE.dark;
  const fast = D['neon-c'];
  const slow = D['neon-m'];
  const defs: string[] = [];
  const body: string[] = [];
  const texts: TextLayer[] = [];

  /* Background: sumi, faint grid, speckles, streaks, vignette */
  body.push(rect(0, 0, w, h, { fill: SUMI }));
  const pitch = range(rng, 24, 44);
  defs.push(pattern(`${P}-grid`, pitch, pitch, [line(0, pitch - 0.5, pitch, pitch - 0.5, { stroke: D.surface, 'stroke-width': 1 }), line(pitch - 0.5, 0, pitch - 0.5, pitch, { stroke: D.surface, 'stroke-width': 1 })]));
  body.push(rect(0, 0, w, h, { fill: url(`${P}-grid`) }));
  let speck = '';
  const n = range(rng, 90, 180);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(uniform(rng, 0, w) / 3) * 3;
    const y = Math.floor(uniform(rng, 0, h) / 3) * 3;
    const s = rng() < 0.2 ? 6 : 3;
    speck += M(x, y) + L(x + s, y) + L(x + s, y + s) + L(x, y + s) + Z;
  }
  body.push(path(speck, { fill: fast, opacity: 0.22 }));
  const streaks = range(rng, 3, 7);
  for (let i = 0; i < streaks; i++) {
    const y = uniform(rng, 0, h);
    const len = uniform(rng, w * 0.15, w * 0.6);
    const x = uniform(rng, -len * 0.5, w);
    body.push(rect(x, y, len, phone ? 3 : 2, { fill: rng() < 0.5 ? fast : slow, opacity: uniform(rng, 0.08, 0.22) }));
  }

  /* Layout: 10 consonant columns × 5 vowel rows on desktop; the phone turns the chart so each consonant group is a row */
  const tile = phone ? 124 : 128;
  const gap = phone ? 13 : 12;
  const cols = phone ? ROWS : COLS;
  const rowsN = phone ? COLS : ROWS;
  const gw = cols * tile + (cols - 1) * gap;
  const gh = rowsN * tile + (rowsN - 1) * gap;
  const gx = (w - gw) / 2;
  const gy = phone ? safe.y + 190 : 232;

  /* Heat from reaction times */
  const cells: Cell[] = [];
  const rows = S.gojuonRows.map((r) => Array.from(r));
  for (let v = 0; v < ROWS; v++) {
    for (let c = 0; c < COLS; c++) {
      const col = phone ? v : c;
      const row = phone ? c : v;
      cells.push({ kana: rows[v]![c] ?? '　', x: gx + col * (tile + gap), y: gy + row * (tile + gap) });
    }
  }
  const timed = cells.filter((c) => c.kana !== '　' && typeof data.gojuonMs[c.kana] === 'number');
  const times = timed.map((c) => data.gojuonMs[c.kana]!);
  const minMs = times.length ? Math.min(...times) : 0;
  const maxMs = times.length ? Math.max(...times) : 0;
  const heat = (k: string): number | null => {
    const ms = data.gojuonMs[k];
    if (typeof ms !== 'number') return null;
    return maxMs === minMs ? 0.5 : (ms - minMs) / (maxMs - minMs);
  };
  const colorOf = (t: number): string => mixOklab(fast, slow, t);
  const slowest = timed.length ? timed.reduce((a, b) => (data.gojuonMs[b.kana]! > data.gojuonMs[a.kana]! ? b : a)) : cells[0]!;
  const fastest = timed.length ? timed.reduce((a, b) => (data.gojuonMs[b.kana]! < data.gojuonMs[a.kana]! ? b : a)) : null;

  /* The big faint glyph behind the grid */
  const bigSize = Math.min(w, h) * (phone ? 1.1 : 0.92);
  body.push(
    text(slowest.kana, {
      x: w / 2,
      y: gy + gh / 2,
      'font-family': FONTS.pixel,
      'font-size': bigSize,
      fill: slow,
      opacity: 0.07,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      transform: `rotate(${uniform(rng, -8, 8).toFixed(1)} ${w / 2} ${gy + gh / 2})`,
      lang: 'ja',
    }),
  );

  /* Tiles */
  defs.push(glowTwin(`${P}-glow`, phone ? 9 : 12, { opacity: 0.9 }));
  const frames: string[] = [];
  const glyphs: string[] = [];
  const dull: string[] = [];
  for (const c of cells) {
    if (c.kana === '　') {
      dull.push(rect(c.x, c.y, tile, tile, { rx: 6, fill: D.surface, opacity: 0.7 }));
      dull.push(rect(c.x + tile / 2 - 3, c.y + tile / 2 - 3, 6, 6, { fill: D.line }));
      continue;
    }
    const t = heat(c.kana);
    const col = t === null ? D.hai : colorOf(t);
    const selected = c === slowest;
    frames.push(rect(c.x, c.y, tile, tile, { rx: 6, fill: selected ? col : alpha(col, t === null ? 0.08 : 0.14 + 0.3 * t), stroke: col, 'stroke-width': selected ? 4 : 3 }));
    glyphs.push(
      text(c.kana, {
        x: c.x + tile / 2,
        y: c.y + tile / 2 + tile * 0.04,
        'font-size': tile * 0.56,
        fill: selected ? SUMI : t === null ? WASHI : col,
        opacity: t === null ? 0.55 : 1,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      }),
    );
  }
  body.push(g(undefined, dull));
  body.push(g({ filter: url(`${P}-glow`) }, frames));
  body.push(g({ 'font-family': FONTS.pixel, lang: 'ja' }, glyphs));

  /* Cursor brackets on the slowest kana */
  const b = phone ? 14 : 18;
  const o = phone ? 7 : 9;
  const bracket = rng() < 0.5 ? 'corner' : 'full';
  const kin = D.kin;
  const sx = slowest.x;
  const sy = slowest.y;
  if (bracket === 'corner') {
    let d = '';
    for (const [cx, cy, dx, dy] of [
      [sx - o, sy - o, 1, 1],
      [sx + tile + o, sy - o, -1, 1],
      [sx - o, sy + tile + o, 1, -1],
      [sx + tile + o, sy + tile + o, -1, -1],
    ] as const) {
      d += M(cx, cy + dy * b) + L(cx, cy) + L(cx + dx * b, cy);
    }
    body.push(path(d, { fill: 'none', stroke: kin, 'stroke-width': phone ? 4 : 5, 'stroke-linecap': 'square' }));
  } else {
    body.push(rect(sx - o, sy - o, tile + 2 * o, tile + 2 * o, { rx: 8, fill: 'none', stroke: kin, 'stroke-width': phone ? 4 : 5, 'stroke-dasharray': `${b} ${b * 0.6}` }));
  }
  const tri = phone ? 12 : 14;
  if (phone) {
    // the phone chart is tight, so the pointer sits beside the tile (right of column 0, left otherwise)
    const right = sx <= gx + 1;
    const px = right ? sx + tile + o + tri * 0.6 : sx - o - tri * 0.6;
    const dir = right ? -1 : 1;
    const cy = sy + tile / 2;
    body.push(path(M(px, cy - tri) + L(px, cy + tri) + L(px + dir * tri * 1.2, cy) + Z, { fill: kin }));
    texts.push({ text: S.player1, x: px - dir * tri * 0.6, y: cy + 9, size: 24, font: FONTS.pixel, fill: kin, anchor: right ? 'start' : 'end', lang: 'ja' });
  } else {
    body.push(path(M(sx + tile / 2 - tri, sy - o - tri * 0.8) + L(sx + tile / 2 + tri, sy - o - tri * 0.8) + L(sx + tile / 2, sy - o + tri * 0.4) + Z, { fill: kin }));
    texts.push({ text: S.player1, x: sx + tile / 2, y: sy - o - tri * 1.4, size: 26, font: FONTS.pixel, fill: kin, anchor: 'middle', lang: 'ja' });
  }

  /* Header: name left, XP right, title centred above the grid */
  const headY = phone ? safe.y + 70 : 110;
  const headSize = phone ? 44 : 40;
  const nameText = `${S.player1} ${data.nameKana}`;
  const nameSize = fitSize(nameText, gw * 0.55, headSize, { max: headSize });
  texts.push({ text: nameText, x: gx, y: headY, size: nameSize, font: FONTS.pixel, fill: fast, lang: 'ja' });
  texts.push({ text: `${S.xpLabel} ${String(data.xp).padStart(8, '0')}`, x: gx + gw, y: headY, size: headSize * 0.8, font: FONTS.pixel, fill: kin, anchor: 'end', lang: 'ja' });
  const titleSize = phone ? 40 : 36;
  texts.push({ text: WALLPAPER_NAMES['kana-grid'].ja, x: w / 2, y: gy - (phone ? 36 : 40), size: titleSize, font: FONTS.pixel, fill: WASHI, anchor: 'middle', lang: 'ja' });
  body.push(line(gx, headY + headSize * 0.5, gx + gw, headY + headSize * 0.5, { stroke: D.line, 'stroke-width': 2 }));

  /* Legend: heat bar with the fastest and slowest readouts */
  defs.push(linearGradient(`${P}-heat`, [[0, fast], [1, slow]], 0));
  const legY = gy + gh + (phone ? 64 : 60);
  const barW = gw * 0.42;
  const barX = w / 2 - barW / 2;
  body.push(rect(barX, legY - 8, barW, phone ? 12 : 10, { fill: url(`${P}-heat`), rx: 2 }));
  const legSize = phone ? 28 : 26;
  if (fastest) {
    texts.push({ text: `${S.fastest} ${fastest.kana} ${data.gojuonMs[fastest.kana]}${S.msUnit}`, x: barX - 24, y: legY + legSize * 0.3, size: legSize, font: FONTS.pixel, fill: fast, anchor: 'end', lang: 'ja' });
    texts.push({ text: `${S.slowest} ${slowest.kana} ${data.gojuonMs[slowest.kana]}${S.msUnit}`, x: barX + barW + 24, y: legY + legSize * 0.3, size: legSize, font: FONTS.pixel, fill: slow, lang: 'ja' });
  } else {
    texts.push({ text: S.noTimes, x: w / 2, y: legY + legSize * 1.6, size: legSize, font: FONTS.pixel, fill: D.hai, anchor: 'middle', lang: 'ja' });
  }

  /* Vignette */
  defs.push(vignette(`${P}-vig`, { strength: uniform(rng, 0.45, 0.7) }));
  body.push(rect(0, 0, w, h, { fill: url(`${P}-vig`) }));

  const svg = svgDoc({ w, h, defs, body, title: WALLPAPER_NAMES['kana-grid'].en, attrs: { 'data-piece': 'kana-grid' } });
  return { svg, texts, post: 'scanlines' };
}

export const spec: WallpaperSpec = { id: 'kana-grid', compose };
