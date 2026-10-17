/**
 * TSUZUKU — PNG export pipeline (design 07 §8).
 *
 *  SVG string → Blob URL → Image → canvas.drawImage at the target size →
 *  Canvas 2D text layer after `document.fonts.load` → optional pixel post
 *  pass (Bayer dither / scanlines / seeded grain) → PNG Blob.
 *
 * `exportPng` resolves `null` instead of throwing when the host cannot
 * rasterise (no canvas 2D context, no Image, load failure) — jsdom included —
 * so UI shows `S.exportUnavailable` rather than a stack trace. Everything the
 * pipeline touches in the browser goes through a `RasterEnv`, which tests
 * replace with a recording stub. OffscreenCanvas and requestIdleCallback are
 * used when present; `canRender4k()` gates 3840×2160 to desktops (fine
 * pointer, ≥ 1024 px, not iOS) and refuses only when the browser reports
 * `deviceMemory` below 4 GB — Firefox and Safari never report it, so an
 * unknown value is not a reason to withhold 4K. `download()` is one anchor
 * click on every platform (a new tab on iOS, `<a download>` elsewhere) and
 * revokes its object URL after `REVOKE_DELAY_MS` on both paths.
 *
 * `drawTexts` honours `TextLayer.letterSpacing` through the canvas
 * `letterSpacing` property where the engine has it (Chrome 99+, Safari 17+,
 * Firefox 126+), so tracked captions line up with the inline SVG preview.
 */
import { mulberry32 } from '../shared/hash';
import { isoDate } from '../shared/time';
import type { EpochDay } from '../shared/store-types';
import { VERTICAL_PITCH, needsRotation, webfontOf, type TextLayer } from './jtext';
import { bayerThresholds, type PostPass } from './pixel';
import { viewBoxOf, type SizeKey } from './svg';
import { S } from './strings';

export type { TextLayer } from './jtext';
export type { PostPass } from './pixel';

/* ────────────────────────────────────────────────────────────────────────── */
/* Environment                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** The slice of CanvasRenderingContext2D the pipeline uses (stub-friendly). */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  /** CSS length, e.g. `'6px'` (absent on engines without canvas letter spacing). */
  letterSpacing?: string;
  drawImage(img: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(rad: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
  putImageData(img: ImageData, x: number, y: number): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx2D | null;
}

export interface RasterEnv {
  /** A `width × height` canvas (Offscreen when available) or null when the host has none. */
  createCanvas(w: number, h: number): CanvasLike | null;
  /** Decode an SVG document string into something `drawImage` accepts. */
  loadImage(svg: string): Promise<CanvasImageSource>;
  /** Resolve once the given webfont families are usable at `px` (never rejects). */
  fontsReady(families: string[], px: number): Promise<void>;
  /** Yield to the browser (requestIdleCallback when present). */
  idle(): Promise<void>;
  /** Encode the canvas as PNG. */
  toBlob(canvas: CanvasLike): Promise<Blob | null>;
}

type OffscreenCtor = new (w: number, h: number) => CanvasLike & { convertToBlob?(o?: { type?: string }): Promise<Blob> };
type IdleFn = (cb: () => void, o?: { timeout?: number }) => number;

function globalOffscreen(): OffscreenCtor | undefined {
  const g = globalThis as { OffscreenCanvas?: OffscreenCtor };
  return typeof g.OffscreenCanvas === 'function' ? g.OffscreenCanvas : undefined;
}

/** The browser-backed environment. */
export function defaultEnv(): RasterEnv {
  return {
    createCanvas(w, h) {
      const Off = globalOffscreen();
      if (Off) {
        try {
          const c = new Off(w, h);
          if (c.getContext('2d')) return c;
        } catch {
          /* fall through to an element canvas */
        }
      }
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c as unknown as CanvasLike;
    },
    loadImage(svg) {
      if (typeof Image === 'undefined') return Promise.reject(new Error('no Image'));
      const hasObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
      const src = hasObjectUrl ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })) : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      return new Promise<CanvasImageSource>((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (hasObjectUrl) URL.revokeObjectURL(src);
          resolve(img);
        };
        img.onerror = () => {
          if (hasObjectUrl) URL.revokeObjectURL(src);
          reject(new Error('svg decode failed'));
        };
        img.src = src;
      });
    },
    async fontsReady(families, px) {
      const fonts = typeof document !== 'undefined' ? (document as { fonts?: { load(spec: string): Promise<unknown> } }).fonts : undefined;
      if (!fonts || typeof fonts.load !== 'function') return;
      await Promise.all(families.map((f) => fonts.load(`${Math.max(1, Math.round(px))}px "${f}"`).catch(() => undefined)));
    },
    idle() {
      const g = globalThis as { requestIdleCallback?: IdleFn };
      return new Promise<void>((resolve) => {
        if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(() => resolve(), { timeout: 500 });
        else setTimeout(resolve, 0);
      });
    },
    toBlob(canvas) {
      const c = canvas as CanvasLike & { convertToBlob?(o?: { type?: string }): Promise<Blob>; toBlob?(cb: (b: Blob | null) => void, type?: string): void };
      if (typeof c.convertToBlob === 'function') return c.convertToBlob({ type: 'image/png' }).catch(() => null);
      if (typeof c.toBlob === 'function') {
        return new Promise<Blob | null>((resolve) => {
          try {
            c.toBlob!((b) => resolve(b), 'image/png');
          } catch {
            resolve(null);
          }
        });
      }
      return Promise.resolve(null);
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Export                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ExportOptions {
  svg: string;
  texts: TextLayer[];
  width: number;
  height: number;
  post?: PostPass;
  onProgress?(p: number): void;
  /** Seed for the grain pass (default 1). */
  seed?: number;
  /** Paint this color before the image (default: whatever the SVG paints). */
  background?: string;
  /** Post-pass strength 0–1 (per-pass defaults). */
  strength?: number;
}

/** Distinct webfont families the text layers need (system stacks need no loading). */
export function fontsOf(texts: readonly TextLayer[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    const f = webfontOf(t.font);
    if (f) out.add(f);
  }
  return Array.from(out);
}

/** Draw the text layers in SVG units scaled by `(sx, sy)`; exported for the goshuin/print callers. */
export function drawTexts(ctx: Ctx2D, texts: readonly TextLayer[], sx: number, sy: number): void {
  for (const t of texts) {
    if (!t.text) continue;
    ctx.save();
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.globalAlpha = t.opacity === undefined ? 1 : Math.max(0, Math.min(1, t.opacity));
    ctx.fillStyle = t.fill;
    ctx.font = `${t.weight ?? 400} ${t.size}px ${t.font}`;
    if (t.rotate) {
      ctx.translate(t.x, t.y);
      ctx.rotate((t.rotate * Math.PI) / 180);
      ctx.translate(-t.x, -t.y);
    }
    if (!t.vertical) {
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = t.anchor === 'middle' ? 'center' : t.anchor === 'end' ? 'end' : 'start';
      // Same tracking as textEl()'s `letter-spacing` (trailing space included, so middle/end anchors match).
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${t.letterSpacing ?? 0}px`;
      ctx.fillText(t.text, t.x, t.y);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pitch = t.size * VERTICAL_PITCH;
      const chars = Array.from(t.text);
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]!;
        const cy = t.y + t.size / 2 + i * pitch;
        if (needsRotation(ch)) {
          ctx.save();
          ctx.translate(t.x, cy);
          ctx.rotate(Math.PI / 2);
          ctx.fillText(ch, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(ch, t.x, cy);
        }
      }
    }
    ctx.restore();
  }
}

/** Pixel-level post pass on the whole canvas (the raster twin of `pixel.postLayer`). */
export function applyPostPass(ctx: Ctx2D, w: number, h: number, kind: PostPass, seed = 1, strength?: number): void {
  if (kind === 'none' || w <= 0 || h <= 0) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  if (kind === 'dither') {
    const th = bayerThresholds(8);
    const k = strength ?? 1;
    const levels = 6;
    const step = 255 / (levels - 1);
    for (let y = 0; y < h; y++) {
      const row = th[y & 7]!;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const t = (row[x & 7]! - 0.5) * step * k;
        for (let c = 0; c < 3; c++) {
          const v = Math.round((d[i + c]! + t) / step) * step;
          d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
  } else if (kind === 'scanlines') {
    const period = Math.max(2, Math.round(h / 360));
    const dark = 1 - Math.max(0, Math.min(1, strength ?? 0.28));
    for (let y = period - 1; y < h; y += period) {
      const start = y * w * 4;
      for (let i = start; i < start + w * 4; i += 4) {
        d[i] = d[i]! * dark;
        d[i + 1] = d[i + 1]! * dark;
        d[i + 2] = d[i + 2]! * dark;
      }
    }
  } else {
    const rng = mulberry32(seed >>> 0);
    const amp = 255 * Math.max(0, Math.min(1, strength ?? 0.14)) * 0.5;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() * 2 - 1) * amp;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c]! + n;
        d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Rasterise `svg` at `width × height`, draw `texts`, apply `post`, return a
 * PNG Blob — or `null` when the host cannot (see the module header).
 * Progress: 0 → 0.15 image decoded → 0.5 drawn → 0.7 text → 0.9 post → 1.
 */
export async function exportPng(o: ExportOptions, env: RasterEnv = defaultEnv()): Promise<Blob | null> {
  const width = Math.max(1, Math.round(o.width));
  const height = Math.max(1, Math.round(o.height));
  const progress = (p: number): void => {
    try {
      o.onProgress?.(p);
    } catch {
      /* progress UI must never break the export */
    }
  };
  progress(0);
  let canvas: CanvasLike | null;
  let ctx: Ctx2D | null;
  try {
    canvas = env.createCanvas(width, height);
    ctx = canvas ? canvas.getContext('2d') : null;
  } catch {
    return null;
  }
  if (!canvas || !ctx) return null;

  await env.idle();
  let img: CanvasImageSource;
  try {
    img = await env.loadImage(o.svg);
  } catch {
    return null;
  }
  progress(0.15);

  try {
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    progress(0.5);

    const vb = viewBoxOf(o.svg) ?? { w: width, h: height };
    const sx = width / vb.w;
    const sy = height / vb.h;
    const maxSize = o.texts.reduce((m, t) => Math.max(m, t.size), 16) * sy;
    await env.fontsReady(fontsOf(o.texts), maxSize);
    drawTexts(ctx, o.texts, sx, sy);
    progress(0.7);

    if (o.post && o.post !== 'none') {
      await env.idle();
      applyPostPass(ctx, width, height, o.post, o.seed ?? 1, o.strength);
    }
    progress(0.9);
  } catch {
    return null;
  }

  const blob = await env.toBlob(canvas);
  progress(1);
  return blob;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Download, gating, naming                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export type DownloadOutcome = 'download' | 'opened' | 'unavailable';

/** iPhone/iPad (incl. iPadOS pretending to be a Mac): downloads open in a tab instead. */
export function isIos(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  if (/iP(hone|ad|od)/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

/** How long the object URL stays alive after the click: the download has started, or the new tab has fetched it, by then. */
export const REVOKE_DELAY_MS = { download: 30_000, opened: 60_000 } as const;

/**
 * Save the blob: an `<a download>` click, or on iOS a new tab (`'opened'`, show
 * `S.iosHint`). `'unavailable'` when the host has no object URLs. Both paths
 * are a single anchor click (`window.open(…, 'noopener')` returns null by
 * spec, so a fallback keyed on it would open the image twice), and both
 * revoke the one object URL they mint after `REVOKE_DELAY_MS`.
 */
export function download(blob: Blob, filename: string): DownloadOutcome {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') return 'unavailable';
  const href = URL.createObjectURL(blob);
  const ios = isIos();
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  if (ios) a.target = '_blank';
  else a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  const outcome: DownloadOutcome = ios ? 'opened' : 'download';
  setTimeout(() => URL.revokeObjectURL(href), REVOKE_DELAY_MS[outcome]);
  return outcome;
}

/**
 * Desktop (fine pointer, ≥ 1024 px, not iOS) that is not a known low-memory
 * device: `navigator.deviceMemory` is Chromium-only, so only a reported value
 * below 4 GB refuses; an unknown value (Firefox, Safari) passes.
 */
export function canRender4k(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === 'number' && mem < 4) return false;
  if (isIos()) return false;
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** Export resolutions per orientation (design 06 §3); 4K only through `canRender4k()`. */
export const EXPORT_SIZES: Record<SizeKey, readonly [number, number][]> = {
  desktop: [
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ],
  phone: [
    [1080, 2340],
    [1170, 2532],
    [1290, 2796],
  ],
};

export function exportSizes(size: SizeKey, allow4k = canRender4k()): [number, number][] {
  return EXPORT_SIZES[size].filter(([w, h]) => allow4k || w * h <= 2560 * 1440).map(([w, h]) => [w, h]);
}

/** `tsuzuku-<id>-<size>-<YYYY-MM-DD>.png` (ASCII only, safe on every OS). */
export function filenameFor(id: string, size: SizeKey, day: EpochDay): string {
  const stem = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'kakejiku';
  return `${S.filePrefix}-${stem}-${size}-${isoDate(day)}.png`;
}
