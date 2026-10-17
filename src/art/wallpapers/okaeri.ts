/**
 * TSUZUKU — kakejiku 'okaeri' おかえり Welcome Back (design 06 §3).
 *
 * A CRT arcade attract screen: cabinet bezel, barrel-curved phosphor grid,
 * bloom behind the title, a hi-score table and a row of pixel torii and
 * lanterns along the bottom. Phosphor amber or green by seed; chromatic
 * offset on the screen art, scanlines as the post pass. There is NO
 * countdown digit and NO "insert coin" (design 06 §3): the screen says
 * おかえり and keeps the learner's place.
 *
 * Table (TextLayers, pixel font): 1ST = name + XP, 2ND = total training
 * days, then longest streak, level and station — all the learner's own
 * numbers, so the table never ranks them below invented players.
 */
import { mulberry32, range, uniform } from '../../shared/hash';
import { PHOSPHOR, SUMI, alpha, darken, mix } from '../color';
import { barrel, type Pt } from '../geom';
import { FONTS, fitSize, type TextLayer } from '../jtext';
import { chromatic, crtBezel, crtScreenClip, sprite, vignette } from '../pixel';
import { blur, circle, el, ellipse, g, polygon, polyline, radialGradient, rect, svgDoc, url } from '../svg';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';
import { S } from './strings-2';

const TORII = ['XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.XXXXXXXXX.', '..X.....X..', '..X.....X..', '..X.....X..', '..X.....X..', '..X.....X..'];
const LANTERN = ['..X..', '.XXX.', 'XXXXX', 'X.X.X', 'XXXXX', '.XXX.', '..X..'];
const CARET = ['X...', 'XX..', 'XXX.', 'XXXX', 'XXX.', 'XX..', 'X...'];

/** Thousands separators without locale dependence (deterministic across engines). */
export function arcadeNumber(n: number): string {
  const s = String(Math.max(0, Math.floor(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Phosphor hue by seed: amber or green, each with its dim and glow tones. */
export function phosphorFor(seed: number): { hue: string; dim: string; faint: string; name: 'amber' | 'green' } {
  const name = mulberry32(seed ^ 0x6f6b)() < 0.5 ? 'amber' : 'green';
  const hue = PHOSPHOR[name];
  return { hue, dim: darken(hue, 0.35), faint: alpha(hue, 0.14), name };
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const ph = phosphorFor(seed);
  const inset = Math.min(w, h) * 0.04;
  const screen = { x: inset, y: inset, w: w - 2 * inset, h: h - 2 * inset };
  const screenBg = mix(SUMI, ph.hue, 0.05);
  const k = uniform(rng, 0.06, 0.1); // barrel strength

  const defs = [
    crtScreenClip('screen', w, h),
    chromatic('chroma', phone ? 2.5 : 2),
    vignette('vig', { color: '#000', strength: 0.7 }),
    radialGradient('bloom', [[0, ph.hue, 0.28], [0.5, ph.hue, 0.08], [1, ph.hue, 0]]),
    blur('soft', 18),
  ];

  // Barrel-curved phosphor grid: the CRT's curvature made visible.
  const grid: string[] = [];
  const gridRows = phone ? 22 : 13;
  const gridCols = phone ? 11 : 20;
  const samples = 28;
  for (let r = 0; r <= gridRows; r++) {
    const y = screen.y + (r / gridRows) * screen.h;
    const pts: Pt[] = [];
    for (let i = 0; i <= samples; i++) pts.push([screen.x + (i / samples) * screen.w, y]);
    grid.push(polyline(barrel(pts, k, w, h), { fill: 'none', stroke: ph.hue, 'stroke-width': 1.2, opacity: r % 2 === 0 ? 0.16 : 0.09 }));
  }
  for (let c = 0; c <= gridCols; c++) {
    const x = screen.x + (c / gridCols) * screen.w;
    const pts: Pt[] = [];
    for (let i = 0; i <= samples; i++) pts.push([x, screen.y + (i / samples) * screen.h]);
    grid.push(polyline(barrel(pts, k, w, h), { fill: 'none', stroke: ph.hue, 'stroke-width': 1.2, opacity: c % 2 === 0 ? 0.14 : 0.08 }));
  }

  // Phosphor burn-in specks.
  const specks: string[] = [];
  const nSpecks = range(rng, 36, 60);
  for (let i = 0; i < nSpecks; i++) {
    const px = range(rng, 2, 5);
    specks.push(rect(uniform(rng, screen.x, screen.x + screen.w - px), uniform(rng, screen.y, screen.y + screen.h - px), px, px, { fill: ph.hue, opacity: uniform(rng, 0.05, 0.16) }));
  }

  // Layout of the title and table.
  const safe = safeRect(size);
  const titleSize = fitSize(S.okaeri, phone ? w * 0.84 : w * 0.56, phone ? 230 : 200, { min: 60, max: phone ? 230 : 200 });
  const titleY = phone ? safe.y + 330 : h * 0.3;
  const subSize = phone ? 34 : 30;
  const subY = titleY + (phone ? 90 : 70);
  const rowSize = phone ? 46 : 40;
  const headY = phone ? subY + 260 : h * 0.5;
  const pitch = phone ? 100 : 58;
  const rankX = phone ? w * 0.12 : w * 0.28;
  const nameX = phone ? w * 0.33 : w * 0.4;
  const scoreX = phone ? w * 0.88 : w * 0.72;
  // Status-window frame around the table (JRPG double border with notched corners, design 01 §4.4).
  const frame = { x: rankX - rowSize * 2.2, y: headY - rowSize * 1.6, w: scoreX - rankX + rowSize * 4.4, h: pitch * 5 + rowSize * 2.1 };
  const notch = phone ? 14 : 12;
  const framePts = (o: number): Pt[] => [
    [frame.x + notch + o, frame.y + o], [frame.x + frame.w - notch - o, frame.y + o], [frame.x + frame.w - o, frame.y + notch + o],
    [frame.x + frame.w - o, frame.y + frame.h - notch - o], [frame.x + frame.w - notch - o, frame.y + frame.h - o], [frame.x + notch + o, frame.y + frame.h - o],
    [frame.x + o, frame.y + frame.h - notch - o], [frame.x + o, frame.y + notch + o],
  ];

  // Pixel decorations: bloom behind the title, caret beside 1ST, torii and lanterns along the bottom.
  const px = phone ? 13 : 8;
  const decor: string[] = [
    ellipse(w / 2, titleY - titleSize * 0.35, titleSize * 2.6, titleSize * 0.9, { fill: url('bloom') }),
    polygon(framePts(0), { fill: alpha(SUMI, 0.35), stroke: ph.hue, 'stroke-width': 2, opacity: 0.9 }),
    polygon(framePts(7), { fill: 'none', stroke: ph.dim, 'stroke-width': 1.5, opacity: 0.8 }),
  ];
  decor.push(sprite(CARET, { x: rankX - rowSize * 1.2, y: headY + pitch - rowSize * 0.72, px: Math.max(4, rowSize / 9), palette: { X: ph.hue } }));
  const groundY = phone ? h * 0.8 : h * 0.9;
  const nTorii = phone ? range(rng, 2, 3) : range(rng, 3, 4);
  const span = screen.w * 0.8;
  for (let i = 0; i < nTorii; i++) {
    const x = screen.x + screen.w * 0.1 + (span * (i + 0.5)) / nTorii - (TORII[0]!.length * px) / 2;
    decor.push(sprite(TORII, { x, y: groundY - TORII.length * px, px, palette: { X: ph.hue } }));
    if (i < nTorii - 1) {
      const lx = screen.x + screen.w * 0.1 + (span * (i + 1)) / nTorii - (LANTERN[0]!.length * px) / 2;
      decor.push(sprite(LANTERN, { x: lx, y: groundY - LANTERN.length * px - px * 2, px, palette: { X: ph.dim } }));
      decor.push(circle(lx + (LANTERN[0]!.length * px) / 2, groundY - LANTERN.length * px / 2 - px * 2, px * 4, { fill: ph.hue, opacity: 0.12, filter: url('soft') }));
    }
  }
  // Dotted ground line.
  let gx = screen.x + screen.w * 0.06;
  const groundDots: string[] = [];
  while (gx < screen.x + screen.w * 0.94) {
    groundDots.push(rect(gx, groundY, px * 1.5, px / 2, { fill: ph.dim, opacity: 0.8 }));
    gx += px * 3;
  }

  const body = [
    rect(0, 0, w, h, { fill: SUMI }),
    g({ 'clip-path': url('screen') }, [
      rect(screen.x, screen.y, screen.w, screen.h, { fill: screenBg }),
      g({ filter: url('chroma') }, [...grid, ...specks, ...decor, ...groundDots]),
      rect(screen.x, screen.y, screen.w, screen.h, { fill: url('vig') }),
    ]),
    crtBezel(w, h, { fill: '#15151D', highlight: '#F4EDE0' }),
  ];

  // Text layers (pixel font; the exporter draws them with DotGothic16).
  const texts: TextLayer[] = [];
  const pixel = FONTS.pixel;
  texts.push({ text: S.okaeri, x: w / 2, y: titleY, size: titleSize, font: pixel, fill: ph.hue, anchor: 'middle', lang: 'ja' });
  texts.push({ text: S.okaeriSub, x: w / 2, y: subY, size: subSize, font: pixel, fill: ph.dim, anchor: 'middle', lang: 'ja' });
  texts.push({ text: S.hiScore, x: w / 2, y: headY, size: rowSize, font: pixel, fill: ph.hue, anchor: 'middle', letterSpacing: 4, lang: 'en' });
  const rows: [string, string, string][] = [
    [S.ranks[0]!, data.nameKana, arcadeNumber(data.xp)],
    [S.ranks[1]!, S.rowDays, arcadeNumber(data.totalDays)],
    [S.ranks[2]!, S.rowStreak, arcadeNumber(data.streak)],
    [S.ranks[3]!, S.rowLevel, arcadeNumber(data.level)],
    [S.ranks[4]!, S.rowStation, arcadeNumber(data.station)],
  ];
  rows.forEach(([rank, label, score], i) => {
    const y = headY + pitch * (i + 1);
    const fill = i === 0 ? ph.hue : ph.dim;
    const nameMax = scoreX - nameX - (phone ? 180 : 220);
    const labelSize = i === 0 ? fitSize(label, nameMax, rowSize, { min: 18, max: rowSize }) : rowSize;
    texts.push({ text: rank, x: rankX, y, size: rowSize, font: pixel, fill, lang: 'en' });
    texts.push({ text: label, x: nameX, y, size: labelSize, font: pixel, fill, lang: 'ja' });
    texts.push({ text: score, x: scoreX, y, size: rowSize, font: pixel, fill, anchor: 'end', lang: 'en' });
  });

  const svg = svgDoc({ w, h, bg: SUMI, defs, body: [el('g', { 'aria-hidden': 'true' }, body)] });
  return { svg, texts, post: 'scanlines' };
}

export const spec: WallpaperSpec = { id: 'okaeri', compose };
