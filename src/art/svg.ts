/**
 * TSUZUKU — tiny string-building SVG kit (design 07 §8).
 *
 * Everything in `src/art` renders to SVG strings through these helpers so the
 * same markup serves inline `<svg>` (via `dangerouslySetInnerHTML` on a host),
 * `<img>`-loaded blobs and the PNG export. Numbers are formatted to at most
 * two decimals and are NEVER `NaN`/`Infinity` (they print as `0`); attribute
 * and text values are XML-escaped; `null`/`undefined`/`false` attributes are
 * skipped.
 *
 * Canvas sizes (group G convention): desktop 1920×1080 (16:9) and phone
 * 1080×2340 (9:19.5). Phone safe zones keep the top and bottom free of text:
 * `safeZone('phone')` = `{ top: 281, bottom: 300 }` — the stricter of the
 * design rule (12 % / 10 %, 06 §3) and the pixel rule (220 / 300 px). Use the
 * function; never hard-code either number.
 */

export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue>;

/* ────────────────────────────────────────────────────────────────────────── */
/* Numbers and escaping                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** ≤ 2 decimals, trailing zeros stripped, `-0` → `0`, non-finite → `0`. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 100) / 100;
  if (Object.is(r, -0) || r === 0) return '0';
  return String(r);
}

/** Escape for attribute values and text nodes. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attribute string with a leading space per attribute; skips null/undefined/false, prints `true` as `""`. */
export function attrs(a?: Attrs): string {
  if (!a) return '';
  let out = '';
  for (const k of Object.keys(a)) {
    const v = a[k];
    if (v === null || v === undefined || v === false) continue;
    const s = v === true ? '' : typeof v === 'number' ? fmt(v) : esc(v);
    out += ` ${k}="${s}"`;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Elements                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** `<tag attrs>children</tag>`, or self-closing when there are no children. Children are raw markup (already escaped). */
export function el(tag: string, a?: Attrs, children?: string | string[]): string {
  const inner = children === undefined ? '' : Array.isArray(children) ? children.join('') : children;
  return inner === '' ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${inner}</${tag}>`;
}

export function g(a?: Attrs, children?: string | string[]): string {
  return el('g', a, children);
}
export function path(d: string, a?: Attrs): string {
  return el('path', { d, ...a });
}
export function rect(x: number, y: number, w: number, h: number, a?: Attrs): string {
  return el('rect', { x, y, width: w, height: h, ...a });
}
export function circle(cx: number, cy: number, r: number, a?: Attrs): string {
  return el('circle', { cx, cy, r: Math.max(0, r), ...a });
}
export function ellipse(cx: number, cy: number, rx: number, ry: number, a?: Attrs): string {
  return el('ellipse', { cx, cy, rx: Math.max(0, rx), ry: Math.max(0, ry), ...a });
}
export function line(x1: number, y1: number, x2: number, y2: number, a?: Attrs): string {
  return el('line', { x1, y1, x2, y2, ...a });
}
export function polyline(pts: readonly (readonly [number, number])[], a?: Attrs): string {
  return el('polyline', { points: points(pts), ...a });
}
export function polygon(pts: readonly (readonly [number, number])[], a?: Attrs): string {
  return el('polygon', { points: points(pts), ...a });
}
/** `<text>` with escaped content; pass `font-family`, `font-size`, `fill`, `text-anchor`… through `a`. */
export function text(s: string, a?: Attrs): string {
  return el('text', a, esc(s));
}
/** `<use href="#id">` (SVG 2 `href`; no xlink namespace needed in current engines). */
export function use(id: string, a?: Attrs): string {
  return el('use', { href: `#${id}`, ...a });
}
/** `<title>` for accessibility (first child of the root). */
export function title(s: string): string {
  return el('title', undefined, esc(s));
}

/** `points` attribute: `x1,y1 x2,y2 …`. */
export function points(pts: readonly (readonly [number, number])[]): string {
  return pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
}

/** `url(#id)` reference. */
export function url(id: string): string {
  return `url(#${id})`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Path helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export const M = (x: number, y: number): string => `M${fmt(x)} ${fmt(y)}`;
export const L = (x: number, y: number): string => `L${fmt(x)} ${fmt(y)}`;
export const Q = (cx: number, cy: number, x: number, y: number): string => `Q${fmt(cx)} ${fmt(cy)} ${fmt(x)} ${fmt(y)}`;
export const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): string =>
  `C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)}`;
export const A = (rx: number, ry: number, rot: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): string =>
  `A${fmt(rx)} ${fmt(ry)} ${fmt(rot)} ${large} ${sweep} ${fmt(x)} ${fmt(y)}`;
export const Z = 'Z';

/** `M … L … (Z)` for a point list. */
export function polyPath(pts: readonly (readonly [number, number])[], closed = false): string {
  if (pts.length === 0) return '';
  let d = M(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) d += L(pts[i]![0], pts[i]![1]);
  return closed ? d + Z : d;
}

/** Rounded-rectangle path (radius clamped to half the shorter side). */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return polyPath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  return (
    M(x + rr, y) +
    L(x + w - rr, y) +
    A(rr, rr, 0, 0, 1, x + w, y + rr) +
    L(x + w, y + h - rr) +
    A(rr, rr, 0, 0, 1, x + w - rr, y + h) +
    L(x + rr, y + h) +
    A(rr, rr, 0, 0, 1, x, y + h - rr) +
    L(x, y + rr) +
    A(rr, rr, 0, 0, 1, x + rr, y) +
    Z
  );
}

/** Full circle as a path (two arcs) so it can take `pathLength`/dash animation. */
export function circlePath(cx: number, cy: number, r: number): string {
  const rr = Math.max(0, r);
  return M(cx + rr, cy) + A(rr, rr, 0, 1, 1, cx - rr, cy) + A(rr, rr, 0, 1, 1, cx + rr, cy) + Z;
}

/** Circular arc from `a0` to `a1` radians (clockwise positive in SVG's y-down space). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const sweep = Math.abs(a1 - a0);
  const large: 0 | 1 = sweep > Math.PI ? 1 : 0;
  return M(x0, y0) + A(r, r, 0, large, a1 > a0 ? 1 : 0, x1, y1);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Defs: gradients, filters, patterns, masks                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function defs(items: string | string[]): string {
  const inner = Array.isArray(items) ? items.join('') : items;
  return inner ? el('defs', undefined, inner) : '';
}

/** `<stop>` from `[offset 0–1, color]` or `[offset, color, opacity]`. */
export function stop(s: readonly [number, string] | readonly [number, string, number]): string {
  return el('stop', { offset: `${fmt(Math.min(1, Math.max(0, s[0])) * 100)}%`, 'stop-color': s[1], 'stop-opacity': s[2] });
}

/**
 * Linear gradient; `angle` in degrees, 0 = left→right, 90 = top→bottom
 * (CSS-like, objectBoundingBox units).
 */
export function linearGradient(id: string, stops: readonly (readonly [number, string] | readonly [number, string, number])[], angle = 90, a?: Attrs): string {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return el(
    'linearGradient',
    { id, x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy, ...a },
    stops.map(stop),
  );
}

export function radialGradient(
  id: string,
  stops: readonly (readonly [number, string] | readonly [number, string, number])[],
  o: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number } = {},
  a?: Attrs,
): string {
  return el('radialGradient', { id, cx: o.cx ?? 0.5, cy: o.cy ?? 0.5, r: o.r ?? 0.5, fx: o.fx, fy: o.fy, ...a }, stops.map(stop));
}

/** Filter wrapper with a generous region so blurs are not clipped. */
export function filter(id: string, children: string | string[], a?: Attrs): string {
  return el('filter', { id, x: '-20%', y: '-20%', width: '140%', height: '140%', 'color-interpolation-filters': 'sRGB', ...a }, children);
}

/** Neon glow: a blurred copy of the source merged beneath the source (the "glow twin", design 06 §3). */
export function glowTwin(id: string, std: number, o: { spread?: number; opacity?: number } = {}): string {
  const spread = o.spread ?? 0;
  const parts = [
    spread > 0 ? el('feMorphology', { in: 'SourceGraphic', operator: 'dilate', radius: spread, result: 'fat' }) : '',
    el('feGaussianBlur', { in: spread > 0 ? 'fat' : 'SourceGraphic', stdDeviation: Math.max(0, std), result: 'blur' }),
    o.opacity !== undefined
      ? el('feComponentTransfer', { in: 'blur', result: 'blur2' }, el('feFuncA', { type: 'linear', slope: o.opacity }))
      : '',
    el('feMerge', undefined, [el('feMergeNode', { in: o.opacity !== undefined ? 'blur2' : 'blur' }), el('feMergeNode', { in: 'SourceGraphic' })]),
  ];
  return filter(id, parts, { x: '-50%', y: '-50%', width: '200%', height: '200%' });
}

/** Plain Gaussian blur filter (mist bands, depth layers). */
export function blur(id: string, std: number): string {
  return filter(id, el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: Math.max(0, std) }), {
    x: '-30%',
    y: '-30%',
    width: '160%',
    height: '160%',
  });
}

export interface TurbulenceOptions {
  baseFrequency: number | [number, number];
  octaves?: number;
  seed?: number;
  type?: 'fractalNoise' | 'turbulence';
  /** `in`-independent noise is produced; set `result` to name it. */
  result?: string;
}

/** `<feTurbulence>` primitive (seeded, deterministic across engines). */
export function feTurbulence(o: TurbulenceOptions): string {
  const bf = Array.isArray(o.baseFrequency) ? `${fmt(o.baseFrequency[0])} ${fmt(o.baseFrequency[1])}` : fmt(o.baseFrequency);
  return el('feTurbulence', {
    type: o.type ?? 'fractalNoise',
    baseFrequency: bf,
    numOctaves: Math.max(1, Math.round(o.octaves ?? 2)),
    seed: Math.round(o.seed ?? 0) >>> 0,
    result: o.result,
  });
}

/** Turbulence rendered as the filter output (steam, clouds): `fill` a rect with it. */
export function turbulence(id: string, o: TurbulenceOptions & { alpha?: number }): string {
  return filter(id, [
    feTurbulence({ ...o, result: 'noise' }),
    el(
      'feColorMatrix',
      { in: 'noise', type: 'matrix', values: `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${fmt(o.alpha ?? 1)} 0` },
    ),
  ]);
}

/** Displacement by turbulence (wobbly reflections, ink edges). */
export function displace(id: string, o: { baseFrequency: number | [number, number]; scale: number; seed?: number; octaves?: number }): string {
  return filter(id, [
    feTurbulence({ baseFrequency: o.baseFrequency, octaves: o.octaves ?? 2, seed: o.seed ?? 0, result: 'noise' }),
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: o.scale, xChannelSelector: 'R', yChannelSelector: 'G' }),
  ]);
}

/** Drop shadow (soft, offset). */
export function dropShadow(id: string, o: { dx?: number; dy?: number; std?: number; color?: string; opacity?: number } = {}): string {
  return filter(id, el('feDropShadow', { dx: o.dx ?? 0, dy: o.dy ?? 4, stdDeviation: o.std ?? 4, 'flood-color': o.color ?? '#000', 'flood-opacity': o.opacity ?? 0.35 }));
}

/** `<pattern>` in userSpaceOnUse units. */
export function pattern(id: string, w: number, h: number, children: string | string[], a?: Attrs): string {
  return el('pattern', { id, width: Math.max(0.01, w), height: Math.max(0.01, h), patternUnits: 'userSpaceOnUse', ...a }, children);
}

export function mask(id: string, children: string | string[], a?: Attrs): string {
  return el('mask', { id, maskUnits: 'userSpaceOnUse', ...a }, children);
}

export function clipPath(id: string, children: string | string[], a?: Attrs): string {
  return el('clipPath', { id, ...a }, children);
}

/** `<symbol>` wrapper (reuse a whole scene with `use(id)`). */
export function symbol(id: string, children: string | string[], a?: Attrs): string {
  return el('symbol', { id, ...a }, children);
}

/** Inline `<style>` with CDATA-safe escaping (for keyframes in inline SVG). */
export function style(css: string): string {
  return el('style', undefined, css.replace(/</g, '&lt;'));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Documents and sizes                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export type SizeKey = 'desktop' | 'phone';
export const SIZES: { desktop: [number, number]; phone: [number, number] } = { desktop: [1920, 1080], phone: [1080, 2340] };

export function sizeOf(size: SizeKey): { w: number; h: number } {
  const [w, h] = SIZES[size];
  return { w, h };
}

/**
 * Pixels at the top and bottom of a phone piece that stay free of text:
 * `max(12 % of h, 220)` and `max(10 % of h, 300)` → `{ top: 281, bottom: 300 }`
 * for 1080×2340. Desktop has no safe zone.
 */
export function safeZone(size: SizeKey): { top: number; bottom: number } {
  if (size !== 'phone') return { top: 0, bottom: 0 };
  const { h } = sizeOf(size);
  return { top: Math.max(Math.ceil(h * 0.12), 220), bottom: Math.max(Math.ceil(h * 0.1), 300) };
}

/** The text-safe rectangle of a size (full canvas on desktop). */
export function safeRect(size: SizeKey, margin = 0): { x: number; y: number; w: number; h: number } {
  const { w, h } = sizeOf(size);
  const z = safeZone(size);
  return { x: margin, y: z.top + margin, w: w - 2 * margin, h: h - z.top - z.bottom - 2 * margin };
}

export interface SvgDocOptions {
  w: number;
  h: number;
  defs?: string[];
  body: string[];
  /** Extra root attributes (`class`, `aria-label`, `role`…). */
  attrs?: Attrs;
  /** `<title>` for assistive tech. */
  title?: string;
  /** Fill the whole canvas with this color first. */
  bg?: string;
  /** Default `xMidYMid slice`, so the piece covers any aspect when scaled. */
  preserveAspectRatio?: string;
}

/** A complete standalone SVG document (xmlns, width/height AND viewBox, so `<img>` sizes it correctly in every engine). */
export function svgDoc(o: SvgDocOptions): string {
  const w = Math.max(1, Math.round(o.w));
  const h = Math.max(1, Math.round(o.h));
  const head = o.title ? title(o.title) : '';
  const bg = o.bg ? rect(0, 0, w, h, { fill: o.bg }) : '';
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: o.preserveAspectRatio ?? 'xMidYMid slice',
      ...o.attrs,
    },
    [head, defs(o.defs ?? []), bg, ...o.body],
  );
}

/** `viewBox` width/height of a document produced by `svgDoc` (falls back to width/height attributes). */
export function viewBoxOf(svg: string): { w: number; h: number } | null {
  const vb = /viewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*"/.exec(svg);
  if (vb) {
    const w = Number(vb[3]);
    const h = Number(vb[4]);
    if (w > 0 && h > 0) return { w, h };
  }
  const mw = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
  const mh = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
  if (mw && mh) {
    const w = Number(mw[1]);
    const h = Number(mh[1]);
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
}

/** The markup between the root `<svg …>` and `</svg>` of a document (to embed one scene inside another). */
export function innerOf(svg: string): string {
  const open = svg.indexOf('>');
  const close = svg.lastIndexOf('</svg>');
  if (open < 0 || close < 0 || close < open) return '';
  return svg.slice(open + 1, close);
}

/** `data:image/svg+xml;charset=utf-8,…` URL (for `<img src>` previews). */
export function svgDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/');
}

/** Namespaced id helper: `uid('wp', 'glow', 3)` → `wp-glow-3`. */
export function uid(...parts: (string | number)[]): string {
  return parts
    .map(String)
    .join('-')
    .replace(/[^A-Za-z0-9_-]/g, '_');
}
