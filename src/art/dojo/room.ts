/**
 * TSUZUKU — the dojo room (design 06 §5): the save file made visible.
 *
 *  tatami count by belt (2 → 10)       the floor
 *  the belt on the wall rack           `belt` (+ gold dan ticks on black)
 *  kakejiku with the chosen kanji      `chosenKanji`, an ensō while none is chosen
 *  lanterns along the eaves            one per 10 levels, lit at dusk and night
 *  Mon shelf                           one slot per badge category, earned ones filled
 *  stamp rack                          the goshuin book open on the latest stamp
 *  Kage silhouette                     sits in the corner the week it was beaten
 *  shōji sky and seasonal tree         `hour` → dawn / day / dusk / night, `month` → season
 *
 * Everything is deterministic from the options (`seed` only varies detail,
 * never meaning). Interior colors are CSS custom properties with Dojo-Morning
 * fallbacks (`tok()`), so the inline scene follows the page theme without JS;
 * the sky is real color because it is the time of day, not the theme.
 *
 * `roomSvg` returns paint-ordered layers; the LAST layer is the time-of-day
 * light overlay (`overlayIndex`), so a host inserts the hearth, bonsai and
 * kotodama flames before it. `roomLayout` gives the boxes a host needs for
 * hotspots and for placing those objects.
 */
import type { Belt } from '../../content/types';
import { hashSeed, mulberry32 } from '../../shared/hash';
import { enso } from '../brush';
import { BELT_HEX, INK, PALETTE, SHOJI, SUMI, WARM, WASHI, mix, type Token } from '../color';
import { clamp, lerp, type Box, type Pt } from '../geom';
import { FONTS, fitSize, tategaki } from '../jtext';
import { M, Q, Z, circle, clipPath, el, ellipse, g, glowTwin, line, linearGradient, path, pattern, polygon, rect, url } from '../svg';

/* ────────────────────────────────────────────────────────────────────────── */
/* Tables                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Tatami count per belt (design 06 §5: 2 → 10; the black-belt hall is the full ten). */
export const TATAMI_BY_BELT: Record<Belt, number> = {
  white: 2,
  yellow: 3,
  orange: 4,
  green: 5,
  blue: 6,
  purple: 7,
  brown: 8,
  black: 10,
};

/** One lantern per `LANTERN_PER_LEVELS` levels, at most `LANTERN_MAX`. */
export const LANTERN_PER_LEVELS = 10;
export const LANTERN_MAX = 10;
/** Badge categories (`store/badge-defs BADGE_CATEGORIES`), one shelf slot each. */
export const MON_SLOTS = 9;

export function tatamiCount(belt: Belt): number {
  return TATAMI_BY_BELT[belt] ?? 2;
}

export function lanternCount(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return clamp(Math.floor(level / LANTERN_PER_LEVELS), 0, LANTERN_MAX);
}

/** 05–07 dawn · 08–16 day · 17–19 dusk · else night (local hour). */
export function skyPhase(hour: number): SkyPhase {
  if (!Number.isFinite(hour)) return 'day';
  const h = (((Math.floor(hour) % 24) + 24) % 24);
  if (h >= 5 && h <= 7) return 'dawn';
  if (h >= 8 && h <= 16) return 'day';
  if (h >= 17 && h <= 19) return 'dusk';
  return 'night';
}

/** 3–5 spring · 6–8 summer · 9–11 autumn · 12–2 winter (month 1–12). */
export function seasonOf(month: number): Season {
  if (!Number.isFinite(month)) return 'spring';
  const m = ((((Math.round(month) - 1) % 12) + 12) % 12) + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

export function lanternsLit(phase: SkyPhase): boolean {
  return phase === 'dusk' || phase === 'night';
}

/** Sky gradient stops, top → horizon. */
export const SKY_STOPS: Record<SkyPhase, readonly [string, string, string]> = {
  dawn: ['#1F3A93', '#C9718A', '#F7B2C4'],
  day: ['#4F6FD6', '#9FC4F0', '#F4EDE0'],
  dusk: ['#1F2A6B', '#C9302C', '#E0B341'],
  night: ['#0A0F2E', '#1F2A6B', '#1F3A93'],
};

/** Indigo wash over the room by phase (0 = none). */
export const OVERLAY_OPACITY: Record<SkyPhase, number> = { dawn: 0.06, day: 0, dusk: 0.1, night: 0.2 };

/** Shōji paper opacity over the garden: bright by day, thin at night so stars show. */
const PAPER_OPACITY: Record<SkyPhase, number> = { dawn: 0.4, day: 0.55, dusk: 0.4, night: 0.28 };

/** Seasonal foliage of the garden tree (winter = bare branches with snow). */
export const TREE_FOLIAGE: Record<Season, string | null> = {
  spring: mix('#F7B2C4', '#C9718A', 0.3),
  summer: '#4E8A3C',
  autumn: mix('#C9302C', '#E0B341', 0.4),
  winter: null,
};

export const WOOD = '#5C3A21';
export const WOOD_LIGHT = '#8B5A2B';

/** `var(--token, light-hex)`: the inline scene follows the page theme; a standalone render falls back to Dojo Morning. */
export function tok(t: Token): string {
  return `var(--${t}, ${PALETTE.light[t]})`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Layout                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RoomLayout {
  w: number;
  h: number;
  /** Scale factors against the 960 × 540 reference. */
  sx: number;
  sy: number;
  /** Minimum of sx/sy, for stroke widths and glyph sizes. */
  s: number;
  floorTop: number;
  eaves: Box;
  window: Box;
  scroll: Box;
  rack: Box;
  shelf: Box;
  stamps: Box;
  hearth: Box;
  kage: Box;
  /** Where the kotodama flames drift. */
  hall: Box;
  bonsai: { x: number; y: number; scale: number };
}

/** Reference composition 960 × 540, scaled proportionally to `w × h`. */
export function roomLayout(w: number, h: number): RoomLayout {
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  const sx = W / 960;
  const sy = H / 540;
  const box = (x: number, y: number, bw: number, bh: number): Box => ({ x: x * sx, y: y * sy, w: bw * sx, h: bh * sy });
  return {
    w: W,
    h: H,
    sx,
    sy,
    s: Math.min(sx, sy),
    floorTop: 335 * sy,
    eaves: box(0, 0, 960, 34),
    window: box(50, 70, 280, 240),
    scroll: box(400, 56, 120, 268),
    rack: box(585, 92, 135, 100),
    shelf: box(585, 250, 335, 40),
    stamps: box(700, 380, 120, 90),
    hearth: box(420, 392, 120, 80),
    kage: box(850, 300, 90, 100),
    hall: box(40, 40, 880, 290),
    bonsai: { x: 175 * sx, y: 500 * sy, scale: Math.min(sx, sy) },
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Options and result                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RoomOptions {
  belt: Belt;
  level: number;
  chosenKanji?: string;
  /** Badge categories with at least one earned Mon (0 – `slots`). */
  badgeCategories: number;
  /** Station name (Japanese) of the latest goshuin; undefined = closed book. */
  latestStamp?: string;
  kageBeaten: boolean;
  /** Local hour 0–23. */
  hour: number;
  /** Local month 1–12. */
  month: number;
  seed: number;
  w: number;
  h: number;
  /** Dan rank; gold ticks on a black belt. */
  dan?: number;
  /** Shelf slots (default `MON_SLOTS`). */
  slots?: number;
}

export interface RoomSvg {
  defs: string[];
  /** Paint order; the last layer is the time-of-day overlay. */
  layers: string[];
  overlayIndex: number;
  layout: RoomLayout;
  phase: SkyPhase;
  season: Season;
}

const ID = {
  sky: 'dj-sky',
  tatami: 'dj-tatami',
  lattice: 'dj-lattice',
  glow: 'dj-lantern-glow',
  clip: 'dj-window-clip',
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Parts                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function wallLayer(L: RoomLayout): string {
  const wainscot = 22 * L.sy;
  return g({ class: 'room__wall' }, [
    rect(0, L.eaves.h, L.w, L.floorTop - L.eaves.h, { fill: tok('surface') }),
    rect(0, L.floorTop - wainscot, L.w, wainscot, { fill: WOOD_LIGHT, opacity: 0.55 }),
    line(0, L.floorTop - wainscot, L.w, L.floorTop - wainscot, { stroke: WOOD, 'stroke-width': 2 * L.s }),
  ]);
}

function gardenTree(L: RoomLayout, season: Season, rng: () => number): string {
  const win = L.window;
  const baseX = win.x + win.w * (0.22 + rng() * 0.1);
  const baseY = win.y + win.h;
  const topY = win.y + win.h * (0.3 + rng() * 0.1);
  const lean = (rng() - 0.5) * win.w * 0.16;
  const topX = baseX + lean;
  const midX = baseX + lean * 0.3 + (rng() - 0.5) * win.w * 0.08;
  const midY = lerp(baseY, topY, 0.5);
  const parts: string[] = [];
  const trunkW = Math.max(2, win.w * 0.035);
  parts.push(path(M(baseX, baseY) + Q(midX, midY, topX, topY), { stroke: INK, 'stroke-width': trunkW, 'stroke-linecap': 'round', fill: 'none' }));
  const ends: Pt[] = [[topX, topY]];
  for (let i = 0; i < 3; i++) {
    const t = 0.45 + i * 0.18;
    const sx = lerp(baseX, topX, t);
    const sy = lerp(baseY, topY, t);
    const dir = i % 2 === 0 ? 1 : -1;
    const ex = sx + dir * win.w * (0.16 + rng() * 0.12);
    const ey = sy - win.h * (0.08 + rng() * 0.12);
    const cx = (sx + ex) / 2 + dir * win.w * 0.03;
    const cy = sy - win.h * 0.02;
    parts.push(path(M(sx, sy) + Q(cx, cy, ex, ey), { stroke: INK, 'stroke-width': trunkW * 0.5, 'stroke-linecap': 'round', fill: 'none' }));
    ends.push([ex, ey]);
  }
  const foliage = TREE_FOLIAGE[season];
  if (foliage) {
    for (const [ex, ey] of ends) {
      const rx = win.w * (0.09 + rng() * 0.05);
      parts.push(ellipse(ex, ey - rx * 0.2, rx, rx * 0.6, { fill: foliage, opacity: 0.92 }));
    }
    const [tx, ty] = ends[0]!;
    parts.push(ellipse(tx + win.w * 0.05, ty - win.h * 0.06, win.w * 0.13, win.h * 0.07, { fill: foliage, opacity: 0.85 }));
  } else {
    for (const [ex, ey] of ends) parts.push(ellipse(ex, ey - trunkW * 0.3, win.w * 0.045, trunkW * 0.45, { fill: WASHI, opacity: 0.95 }));
  }
  return g({ class: `room__tree room__tree--${season}` }, parts);
}

function skyLayer(L: RoomLayout, phase: SkyPhase, season: Season, rng: () => number): string {
  const win = L.window;
  const parts: string[] = [rect(win.x, win.y, win.w, win.h, { fill: url(ID.sky), class: `room__sky room__sky--${phase}` })];
  if (phase === 'night') {
    const stars: string[] = [];
    for (let i = 0; i < 9; i++) {
      stars.push(circle(win.x + rng() * win.w, win.y + rng() * win.h * 0.6, (0.8 + rng() * 0.8) * L.s, { fill: WASHI, opacity: 0.6 + rng() * 0.35 }));
    }
    parts.push(g({ class: 'room__stars' }, stars));
    parts.push(circle(win.x + win.w * 0.74, win.y + win.h * 0.24, win.w * 0.06, { fill: WASHI, opacity: 0.95, class: 'room__moon' }));
  } else if (phase === 'dawn') {
    parts.push(circle(win.x + win.w * 0.7, win.y + win.h * 0.74, win.w * 0.07, { fill: mix(WARM, '#F7B2C4', 0.4), opacity: 0.9, class: 'room__sun' }));
  } else if (phase === 'dusk') {
    parts.push(circle(win.x + win.w * 0.3, win.y + win.h * 0.7, win.w * 0.075, { fill: WARM, opacity: 0.95, class: 'room__sun' }));
  } else {
    parts.push(ellipse(win.x + win.w * 0.62, win.y + win.h * 0.22, win.w * 0.14, win.h * 0.045, { fill: WASHI, opacity: 0.55, class: 'room__cloud' }));
  }
  parts.push(gardenTree(L, season, rng));
  // garden clipped to the opening; then paper, kumiko lattice, frame
  const garden = g({ 'clip-path': url(ID.clip) }, parts);
  const screen = [
    rect(win.x, win.y, win.w, win.h, { fill: SHOJI, opacity: PAPER_OPACITY[phase], class: 'room__paper' }),
    rect(win.x, win.y, win.w, win.h, { fill: url(ID.lattice) }),
    rect(win.x, win.y, win.w, win.h, { fill: 'none', stroke: INK, 'stroke-width': 5 * L.s }),
  ];
  return g({ class: 'room__window' }, [garden, ...screen]);
}

function scrollLayer(L: RoomLayout, kanji: string | undefined, seed: number): string {
  const sc = L.scroll;
  const cx = sc.x + sc.w / 2;
  const paper: Box = { x: sc.x + sc.w * 0.12, y: sc.y + sc.h * 0.12, w: sc.w * 0.76, h: sc.h * 0.72 };
  const parts: string[] = [
    line(cx, L.eaves.h, cx, sc.y, { stroke: INK, 'stroke-width': 1.5 * L.s }),
    rect(sc.x, sc.y + 6 * L.sy, sc.w, sc.h - 12 * L.sy, { fill: tok('kon'), class: 'room__mount' }),
    rect(paper.x, paper.y, paper.w, paper.h, { fill: tok('surface'), class: 'room__paper-scroll' }),
    rect(sc.x - 6 * L.sx, sc.y, sc.w + 12 * L.sx, 8 * L.sy, { fill: INK, rx: 4 * L.s }),
    rect(sc.x - 8 * L.sx, sc.y + sc.h - 10 * L.sy, sc.w + 16 * L.sx, 10 * L.sy, { fill: INK, rx: 5 * L.s }),
  ];
  const text = (kanji ?? '').trim();
  if (text) {
    const size = fitSize(text, paper.w * 0.78, paper.h * 0.82, { vertical: true, min: 8 });
    const colH = size * (1 + (Array.from(text).length - 1) * 1.12);
    parts.push(
      el('g', { class: 'room__kanji' }, tategaki({ text, x: cx, y: paper.y + (paper.h - colH) / 2, size, font: FONTS.brush, fill: tok('fg') })),
    );
  } else {
    const r = Math.min(paper.w, paper.h * 0.5) * 0.36;
    parts.push(path(enso(cx, paper.y + paper.h * 0.45, r, seed, { width: r * 0.26 }), { fill: INK, opacity: 0.85, class: 'room__enso' }));
  }
  const seal = Math.max(4, paper.w * 0.11);
  parts.push(rect(paper.x + paper.w - seal * 1.5, paper.y + paper.h - seal * 1.6, seal, seal, { fill: tok('shu'), rx: 1, class: 'room__seal' }));
  return g({ class: 'room__scroll', 'data-empty': text ? undefined : 'true' }, parts);
}

function rackLayer(L: RoomLayout, belt: Belt, dan: number): string {
  const r = L.rack;
  const barY = r.y + r.h * 0.2;
  const beltW = Math.max(4, 12 * L.s);
  const x0 = r.x + r.w * 0.3;
  const x1 = r.x + r.w * 0.62;
  const yLow = r.y + r.h * 0.92;
  const d = M(x0, barY) + Q(x0 - r.w * 0.06, yLow, x0 + r.w * 0.12, yLow) + Q(x1 - r.w * 0.04, yLow - r.h * 0.05, x1, barY);
  const parts: string[] = [
    rect(r.x, barY - 3 * L.sy, r.w, 6 * L.sy, { fill: WOOD, rx: 2 }),
    rect(r.x + r.w * 0.08, barY, 6 * L.sx, r.h * 0.12, { fill: WOOD_LIGHT }),
    rect(r.x + r.w * 0.92 - 6 * L.sx, barY, 6 * L.sx, r.h * 0.12, { fill: WOOD_LIGHT }),
    path(d, { stroke: tok('line'), 'stroke-width': beltW + 2 * L.s, fill: 'none', 'stroke-linecap': 'round' }),
    path(d, { stroke: BELT_HEX[belt], 'stroke-width': beltW, fill: 'none', 'stroke-linecap': 'round', class: `room__belt room__belt--${belt}` }),
  ];
  if (belt === 'black' && dan > 0) {
    const ticks: string[] = [];
    const n = clamp(Math.floor(dan), 1, 10);
    for (let i = 0; i < n; i++) {
      const y = barY + r.h * 0.18 + i * beltW * 0.9;
      if (y > yLow - beltW) break;
      ticks.push(line(x0 - beltW * 0.45, y, x0 + beltW * 0.45, y, { stroke: tok('kin'), 'stroke-width': Math.max(1, 2 * L.s) }));
    }
    parts.push(g({ class: 'room__dan' }, ticks));
  }
  return g({ class: 'room__rack' }, parts);
}

function shelfLayer(L: RoomLayout, earned: number, slots: number): string {
  const sh = L.shelf;
  const n = Math.max(1, Math.round(slots));
  const got = clamp(Math.floor(earned), 0, n);
  const slotW = sh.w / n;
  const r = Math.min(slotW * 0.36, sh.h * 0.38);
  const cy = sh.y + sh.h * 0.42;
  const parts: string[] = [rect(sh.x, sh.y + sh.h * 0.78, sh.w, sh.h * 0.22, { fill: WOOD, rx: 1 })];
  for (let i = 0; i < n; i++) {
    const cx = sh.x + slotW * (i + 0.5);
    if (i < got) {
      parts.push(circle(cx, cy, r, { fill: tok('surface'), stroke: tok('kin'), 'stroke-width': Math.max(1, 2 * L.s), class: 'room__mon room__mon--earned' }));
      parts.push(circle(cx, cy, r * 0.45, { fill: tok('shu') }));
    } else {
      parts.push(circle(cx, cy, r, { fill: 'none', stroke: tok('line'), 'stroke-width': Math.max(1, 1.5 * L.s), 'stroke-dasharray': '3 3', class: 'room__mon room__mon--empty' }));
    }
  }
  return g({ class: 'room__shelf', 'data-earned': got }, parts);
}

function lanternLayer(L: RoomLayout, level: number, phase: SkyPhase): string {
  const n = lanternCount(level);
  const lit = lanternsLit(phase);
  const e = L.eaves;
  const parts: string[] = [rect(0, 0, L.w, e.h, { fill: WOOD }), line(0, e.h - 3 * L.sy, L.w, e.h - 3 * L.sy, { stroke: WOOD_LIGHT, 'stroke-width': 2 * L.sy })];
  const lanterns: string[] = [];
  const rx = 14 * L.s;
  const ry = 20 * L.s;
  for (let i = 0; i < n; i++) {
    const x = (L.w * (i + 1)) / (n + 1);
    const top = e.h;
    const cy = top + 12 * L.sy + ry;
    const ribs = [0.5, 0, -0.5].map((k) => M(x - rx * 0.97, cy + ry * k) + Q(x, cy + ry * k + ry * 0.12, x + rx * 0.97, cy + ry * k)).join('');
    lanterns.push(
      g({ class: `room__lantern${lit ? ' room__lantern--lit' : ''}` }, [
        line(x, top, x, top + 12 * L.sy, { stroke: INK, 'stroke-width': Math.max(1, 1.2 * L.s) }),
        ellipse(x, cy, rx, ry, { fill: lit ? WARM : tok('surface'), stroke: tok('shu'), 'stroke-width': Math.max(1, 1.5 * L.s) }),
        path(ribs, { stroke: tok('shu'), 'stroke-width': Math.max(0.6, 0.9 * L.s), fill: 'none', opacity: 0.8 }),
      ]),
    );
  }
  if (lanterns.length) parts.push(g({ class: 'room__lanterns', filter: lit ? url(ID.glow) : undefined, 'data-count': n }, lanterns));
  return g({ class: 'room__eaves' }, parts);
}

/** Trapezoid floor: `u` across (0 left, 1 right), `v` depth (0 back wall, 1 front edge). */
function floorPoint(L: RoomLayout, u: number, v: number): Pt {
  const left = lerp(L.w * 0.08, -L.w * 0.02, v);
  const right = lerp(L.w * 0.92, L.w * 1.02, v);
  return [lerp(left, right, u), lerp(L.floorTop, L.h, v)];
}

function floorLayer(L: RoomLayout, belt: Belt): string {
  const n = tatamiCount(belt);
  const rows = n <= 5 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  const parts: string[] = [polygon([floorPoint(L, 0, 0), floorPoint(L, 1, 0), floorPoint(L, 1, 1), floorPoint(L, 0, 1)], { fill: tok('line') })];
  const mats: string[] = [];
  rows.forEach((count, row) => {
    const v0 = rows.length === 1 ? 0 : row / rows.length;
    const v1 = rows.length === 1 ? 1 : (row + 1) / rows.length;
    for (let i = 0; i < count; i++) {
      const u0 = i / count;
      const u1 = (i + 1) / count;
      const inset = 0.004;
      mats.push(
        polygon([floorPoint(L, u0 + inset, v0 + inset), floorPoint(L, u1 - inset, v0 + inset), floorPoint(L, u1 - inset, v1 - inset), floorPoint(L, u0 + inset, v1 - inset)], {
          fill: url(ID.tatami),
          stroke: INK,
          'stroke-opacity': 0.55,
          'stroke-width': Math.max(1.5, 3 * L.s),
          class: 'room__tatami',
        }),
      );
    }
  });
  parts.push(g({ class: 'room__mats', 'data-count': n }, mats));
  return g({ class: 'room__floor' }, parts);
}

function stampLayer(L: RoomLayout, latest: string | undefined, seed: number): string {
  const b = L.stamps;
  const standTop = b.y + b.h * 0.55;
  const parts: string[] = [
    polygon([[b.x + b.w * 0.1, standTop], [b.x + b.w * 0.9, standTop], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], { fill: WOOD }),
    rect(b.x + b.w * 0.18, standTop - 4 * L.sy, b.w * 0.64, 4 * L.sy, { fill: WOOD_LIGHT }),
  ];
  const name = (latest ?? '').trim();
  const pageW = b.w * 0.36;
  const pageH = b.h * 0.56;
  const pageY = standTop - pageH;
  if (name) {
    const leftX = b.x + b.w * 0.12;
    const rightX = b.x + b.w * 0.52;
    parts.push(rect(leftX, pageY, pageW, pageH, { fill: tok('surface'), stroke: tok('line'), 'stroke-width': 1, transform: `rotate(-4 ${leftX + pageW} ${pageY + pageH})` }));
    parts.push(rect(rightX, pageY, pageW, pageH, { fill: tok('surface'), stroke: tok('line'), 'stroke-width': 1, transform: `rotate(3 ${rightX} ${pageY + pageH})` }));
    const sealW = pageW * 0.7;
    const sealH = pageH * 0.78;
    const sx = rightX + (pageW - sealW) / 2;
    const sy = pageY + (pageH - sealH) / 2;
    const rot = ((mulberry32(seed)() - 0.5) * 10).toFixed(1);
    const size = fitSize(name, sealW * 0.7, sealH * 0.8, { vertical: true, min: 4 });
    const colH = size * (1 + (Array.from(name).length - 1) * 1.12);
    parts.push(
      g({ class: 'room__goshuin', transform: `rotate(${rot} ${sx + sealW / 2} ${sy + sealH / 2})` }, [
        rect(sx, sy, sealW, sealH, { fill: tok('shu'), rx: 1.5, opacity: 0.92 }),
        tategaki({ text: name, x: sx + sealW / 2, y: sy + (sealH - colH) / 2, size, font: FONTS.brush, fill: WASHI }),
      ]),
    );
  } else {
    const coverX = b.x + b.w * 0.3;
    parts.push(rect(coverX, pageY + pageH * 0.15, pageW * 1.1, pageH * 0.85, { fill: tok('shu'), rx: 1.5, class: 'room__book--closed' }));
    parts.push(line(coverX + pageW * 0.55, pageY + pageH * 0.15, coverX + pageW * 0.55, pageY + pageH, { stroke: WASHI, 'stroke-width': 1, opacity: 0.7 }));
  }
  return g({ class: 'room__stamps', 'data-empty': name ? undefined : 'true' }, parts);
}

function kageLayer(L: RoomLayout): string {
  const k = L.kage;
  const cx = k.x + k.w / 2;
  const headR = k.w * 0.16;
  const headY = k.y + k.h * 0.26;
  const body = M(k.x + k.w * 0.1, k.y + k.h) + Q(k.x + k.w * 0.08, k.y + k.h * 0.5, cx - headR * 0.6, headY + headR) + Q(cx, headY + headR * 0.6, cx + headR * 0.6, headY + headR) + Q(k.x + k.w * 0.95, k.y + k.h * 0.5, k.x + k.w * 0.92, k.y + k.h) + Z;
  return g({ class: 'room__kage' }, [path(body, { fill: SUMI, opacity: 0.82 }), circle(cx, headY, headR, { fill: SUMI, opacity: 0.86 })]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Composition                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export function roomSvg(o: RoomOptions): RoomSvg {
  const L = roomLayout(o.w, o.h);
  const phase = skyPhase(o.hour);
  const season = seasonOf(o.month);
  const rng = mulberry32(hashSeed(o.seed, 'room', season, phase));

  const defs: string[] = [
    linearGradient(ID.sky, [
      [0, SKY_STOPS[phase][0]],
      [0.55, SKY_STOPS[phase][1]],
      [1, SKY_STOPS[phase][2]],
    ]),
    pattern(ID.tatami, 8 * L.s, 8 * L.s, [
      rect(0, 0, 8 * L.s, 8 * L.s, { fill: tok('raised') }),
      rect(0, 0, 8 * L.s, 8 * L.s, { fill: tok('matcha'), opacity: 0.12 }),
      line(0, 4 * L.s, 8 * L.s, 4 * L.s, { stroke: tok('line'), 'stroke-width': 0.8 * L.s, opacity: 0.7 }),
    ]),
    pattern(ID.lattice, L.window.w / 6, L.window.h / 5, [
      line(L.window.w / 6, 0, L.window.w / 6, L.window.h / 5, { stroke: INK, 'stroke-width': 2.4 * L.s }),
      line(0, L.window.h / 5, L.window.w / 6, L.window.h / 5, { stroke: INK, 'stroke-width': 2.4 * L.s }),
    ], { x: L.window.x, y: L.window.y }),
    glowTwin(ID.glow, 6 * L.s, { opacity: 0.7 }),
    clipPath(ID.clip, rect(L.window.x, L.window.y, L.window.w, L.window.h)),
  ];

  const layers: string[] = [
    wallLayer(L),
    skyLayer(L, phase, season, rng),
    scrollLayer(L, o.chosenKanji, o.seed),
    rackLayer(L, o.belt, o.dan ?? 0),
    shelfLayer(L, o.badgeCategories, o.slots ?? MON_SLOTS),
    lanternLayer(L, o.level, phase),
    floorLayer(L, o.belt),
    stampLayer(L, o.latestStamp, o.seed),
    o.kageBeaten ? kageLayer(L) : '',
  ];
  const overlay = OVERLAY_OPACITY[phase];
  layers.push(overlay > 0 ? rect(0, 0, L.w, L.h, { fill: tok('kon'), opacity: overlay, class: `room__light room__light--${phase}`, 'pointer-events': 'none' }) : '');

  return { defs, layers, overlayIndex: layers.length - 1, layout: L, phase, season };
}
