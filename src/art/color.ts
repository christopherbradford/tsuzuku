/**
 * TSUZUKU — art palette as data (design 01 §4.3, 06 §3).
 *
 * The ONLY place art code reads colors. Hex values mirror
 * `src/styles/tokens.css` exactly (color.test.ts parses the CSS and compares),
 * belt colors come from `content/types BELTS`, crest rings from the catalog.
 * Helpers mix in sRGB (`mix`) or OKLab (`mixOklab`) and check WCAG contrast.
 *
 * Every function accepts `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored) and
 * returns lowercase `#rrggbb`; `alpha()` returns `rgba(r,g,b,a)`.
 */
import { BELTS, BELT_IDS, type Belt } from '../content/types';
import { BADGE_RING, type BadgeTier } from '../shared/catalog';

/* ────────────────────────────────────────────────────────────────────────── */
/* Tokens                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const TOKENS = [
  'bg',
  'surface',
  'raised',
  'fg',
  'fg-muted',
  'line',
  'shu',
  'kin',
  'ai',
  'sakura',
  'matcha',
  'neon-c',
  'neon-m',
  'kon',
  'hai',
  'focus',
] as const;
export type Token = (typeof TOKENS)[number];
export type Theme = 'light' | 'dark';

/** Dojo Morning (light) and Arcade Night (dark); identical to tokens.css. */
export const PALETTE: { light: Record<Token, string>; dark: Record<Token, string> } = {
  light: {
    bg: '#F4EDE0',
    surface: '#FFFBF3',
    raised: '#EADFCB',
    fg: '#1A1A1F',
    'fg-muted': '#5E5A52',
    line: '#D9CDB6',
    shu: '#C9302C',
    kin: '#B8860B',
    ai: '#1F2A6B',
    sakura: '#C9718A',
    matcha: '#4E8A3C',
    'neon-c': '#0E8F86',
    'neon-m': '#B8257A',
    kon: '#1F3A93',
    hai: '#8A8578',
    focus: '#1F2A6B',
  },
  dark: {
    bg: '#0B0B10',
    surface: '#15151D',
    raised: '#1F1F2A',
    fg: '#F4EDE0',
    'fg-muted': '#A9A49A',
    line: '#2C2C3A',
    shu: '#E63B2E',
    kin: '#E0B341',
    ai: '#6C7BD9',
    sakura: '#F7B2C4',
    matcha: '#7BB661',
    'neon-c': '#2EE6D6',
    'neon-m': '#FF3DA6',
    kon: '#4F6FD6',
    hai: '#6E6A61',
    focus: '#2EE6D6',
  },
};

/** `PALETTE[theme][token]`. */
export function token(t: Token, theme: Theme = 'light'): string {
  return PALETTE[theme][t];
}

/** Belt hex, theme-invariant (design 01 §4.3; the values live in `BELTS`). */
export const BELT_HEX: Record<Belt, string> = Object.fromEntries(BELTS.map((b) => [b.id, b.color])) as Record<Belt, string>;
export { BELT_IDS };
export function beltColor(belt: Belt): string {
  return BELT_HEX[belt];
}

/** Crest rings (design 06 §2): gold is `--kin` and therefore theme-dependent. */
export const RING_HEX = { bronze: BADGE_RING.bronze, silver: BADGE_RING.silver } as const;
export function ringHex(tier: BadgeTier, theme: Theme = 'light'): string {
  return tier === 'gold' ? PALETTE[theme].kin : RING_HEX[tier];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Named constants used across the wallpapers (design 06 §3 palette column)   */
/* ────────────────────────────────────────────────────────────────────────── */

export const WASHI = '#F4EDE0';
export const WASHI_LIGHT = '#FFFBF3';
export const SUMI = '#0B0B10';
export const INK = '#1A1A1F';
export const INK_WASH = '#5E5A52';
export const NIGHT = '#0A0F2E';
export const WARM = '#FFD166';
export const SHOJI = '#F7EFDF';
export const FOAM = '#FFFFFF';
export const PHOSPHOR = { amber: '#FFB000', green: '#33FF66' } as const;
export const STONE = '#8A8578';
export const STONE_DARK = '#6E6A61';

/** Five tanzaku strip colors (七夕 五色). */
export const TANZAKU: readonly string[] = ['#2F6FD6', '#C9302C', '#F2D54A', '#F4EDE0', '#4E8A3C'];

export type PresetName =
  | 'dawn'
  | 'dusk'
  | 'night'
  | 'neon'
  | 'sumi'
  | 'washi'
  | 'festival'
  | 'onsen'
  | 'gold'
  | 'arcade'
  | 'sakura'
  | 'ukiyoe';

/** Ordered palette presets; index 0 is the dominant color, the last is an accent. */
export const PRESETS: Record<PresetName, readonly string[]> = {
  dawn: ['#1F3A93', '#4F6FD6', '#C9718A', '#F7B2C4', '#C9302C'],
  dusk: ['#1F2A6B', '#4F6FD6', '#C9718A', '#E0B341', '#0B0B10'],
  night: ['#0A0F2E', '#1F2A6B', '#4F6FD6', '#E0B341', '#F4EDE0'],
  neon: ['#0B0B10', '#15151D', '#2EE6D6', '#FF3DA6', '#E0B341'],
  sumi: ['#0B0B10', '#1A1A1F', '#5E5A52', '#F4EDE0', '#C9302C'],
  washi: ['#F4EDE0', '#FFFBF3', '#EADFCB', '#D9CDB6', '#C9302C'],
  festival: ['#0B0B10', '#C9302C', '#E0B341', '#FFD166', '#F4EDE0'],
  onsen: ['#0A0F2E', '#1F2A6B', '#4E8A3C', '#7BB661', '#F4EDE0'],
  gold: ['#B8860B', '#E0B341', '#F2D54A', '#0B0B10', '#F4EDE0'],
  arcade: ['#0B0B10', '#2EE6D6', '#FF3DA6', '#E0B341', '#FFB000'],
  sakura: ['#1F2A6B', '#C9718A', '#F7B2C4', '#FFFBF3', '#0B0B10'],
  ukiyoe: ['#1F3A93', '#4F6FD6', '#F4EDE0', '#FFFFFF', '#C9302C'],
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Parsing and formatting                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export type Rgb = [r: number, g: number, b: number];

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : Number.isNaN(x) ? 0 : x;
}
function clamp255(x: number): number {
  const r = Math.round(x);
  return r < 0 ? 0 : r > 255 ? 255 : Number.isNaN(r) ? 0 : r;
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb(a)(…)` → `[r,g,b]` in 0–255. Unparseable input yields black. */
export function parseHex(hex: string): Rgb {
  const s = hex.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16)].map(clamp255) as Rgb;
    }
    if (h.length === 6 || h.length === 8) {
      const n = parseInt(h.slice(0, 6), 16);
      if (!Number.isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return [0, 0, 0];
  }
  const m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i.exec(s);
  if (m) return [clamp255(Number(m[1])), clamp255(Number(m[2])), clamp255(Number(m[3]))];
  return [0, 0, 0];
}

/** `[r,g,b]` → lowercase `#rrggbb`. */
export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** Lowercase `#rrggbb` form of any accepted input. */
export function normalizeHex(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r, g, b);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Mixing                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Linear interpolation in sRGB; `t` clamped to 0–1 (`t = 0` → `a`, `t = 1` → `b`). */
export function mix(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const A = parseHex(a);
  const B = parseHex(b);
  return toHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
}

/** `rgba(r,g,b,a)` with `a` clamped to 0–1 and 3 decimals. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  const k = Math.round(clamp01(a) * 1000) / 1000;
  return `rgba(${r},${g},${b},${k})`;
}

/** Toward white by `t`. */
export function lighten(hex: string, t: number): string {
  return mix(hex, '#ffffff', t);
}

/** Toward black by `t`. */
export function darken(hex: string, t: number): string {
  return mix(hex, '#000000', t);
}

/** Toward neutral grey of the same luminance by `t` (0 = unchanged, 1 = grey). */
export function desaturate(hex: string, t: number): string {
  const [r, g, b] = parseHex(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return mix(hex, toHex(y, y, y), t);
}

/** Steps `n` evenly spaced colors from `a` to `b` inclusive (`n ≥ 2`). */
export function ramp(a: string, b: string, n: number): string[] {
  const count = Math.max(2, Math.floor(n));
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(mix(a, b, i / (count - 1)));
  return out;
}

/** `[offset 0–1, color]` stops spread evenly over a color list, for `svg.linearGradient`. */
export function gradientStops(colors: readonly string[]): [number, string][] {
  if (colors.length === 0) return [];
  if (colors.length === 1) return [[0, colors[0]!], [1, colors[0]!]];
  return colors.map((c, i) => [i / (colors.length - 1), c]);
}

/* HSL */

export type Hsl = [h: number, s: number, l: number];

/** `#hex` → `[hue 0–360, sat 0–1, light 0–1]`. */
export function toHsl(hex: string): Hsl {
  const [R, G, B] = parseHex(hex).map((v) => v / 255) as Rgb;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return [h, s, l];
}

/** `hsl(h, s, l)` → `#hex`; hue in degrees (wraps), s/l 0–1. */
export function hsl(h: number, s: number, l: number): string {
  const H = (((h % 360) + 360) % 360) / 360;
  const S = clamp01(s);
  const L = clamp01(l);
  if (S === 0) return toHex(L * 255, L * 255, L * 255);
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const f = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return toHex(f(H + 1 / 3) * 255, f(H) * 255, f(H - 1 / 3) * 255);
}

/** Rotate hue by `deg`. */
export function shiftHue(hex: string, deg: number): string {
  const [h, s, l] = toHsl(hex);
  return hsl(h + deg, s, l);
}

/** Multiply saturation by `1 + t` (negative `t` desaturates). */
export function saturate(hex: string, t: number): string {
  const [h, s, l] = toHsl(hex);
  return hsl(h, clamp01(s * (1 + t)), l);
}

/* OKLab */

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(x: number): number {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055;
  return v * 255;
}

export type Oklab = [L: number, a: number, b: number];

export function toOklab(hex: string): Oklab {
  const [r, g, b] = parseHex(hex).map(srgbToLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab(L: number, a: number, b: number): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return toHex(linearToSrgb(r), linearToSrgb(g), linearToSrgb(bb));
}

/** Perceptual mix in OKLab (no muddy midpoints); `t` clamped 0–1. */
export function mixOklab(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const A = toOklab(a);
  const B = toOklab(b);
  return fromOklab(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Contrast                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** WCAG relative luminance 0–1. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(srgbToLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio ≥ 1. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `contrast(fg, bg) ≥ min` (AA body text = 4.5). */
export function readable(fg: string, bg: string, min = 4.5): boolean {
  return contrast(fg, bg) >= min;
}

/** The candidate with the highest contrast against `bg` (first wins ties); `bg`'s own ink fallback when the list is empty. */
export function pickReadable(bg: string, candidates: readonly string[]): string {
  if (candidates.length === 0) return luminance(bg) > 0.4 ? INK : WASHI;
  let best = candidates[0]!;
  let bestC = contrast(best, bg);
  for (const c of candidates.slice(1)) {
    const k = contrast(c, bg);
    if (k > bestC) {
      best = c;
      bestC = k;
    }
  }
  return best;
}

/** True when the color reads as light (luminance > 0.4): choose ink text on it. */
export function isLight(hex: string): boolean {
  return luminance(hex) > 0.4;
}
