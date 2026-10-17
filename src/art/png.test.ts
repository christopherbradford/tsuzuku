import { civilToDay } from '../shared/time';
import { FONTS, type TextLayer } from './jtext';
import { applyPostPass, canRender4k, defaultEnv, download, drawTexts, EXPORT_SIZES, exportPng, exportSizes, filenameFor, fontsOf, isIos, type CanvasLike, type Ctx2D, type RasterEnv } from './png';
import { svgDoc } from './svg';

/* ────────────────────────────────────────────────────────────────────────── */
/* A recording canvas                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function fakeCanvas(w: number, h: number, log: string[], pixels?: Uint8ClampedArray): CanvasLike {
  const data = pixels ?? new Uint8ClampedArray(w * h * 4).fill(128);
  const ctx: Ctx2D = {
    fillStyle: '#000',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    drawImage: (_img, dx, dy, dw, dh) => void log.push(`drawImage ${dx},${dy},${dw},${dh}`),
    fillRect: (x, y, ww, hh) => void log.push(`fillRect ${x},${y},${ww},${hh}`),
    fillText: (t, x, y) => void log.push(`fillText ${t} ${Math.round(x)},${Math.round(y)} ${ctx.font} ${ctx.textAlign}/${ctx.textBaseline}`),
    save: () => void log.push('save'),
    restore: () => void log.push('restore'),
    translate: (x, y) => void log.push(`translate ${Math.round(x)},${Math.round(y)}`),
    rotate: (r) => void log.push(`rotate ${Math.round((r * 180) / Math.PI)}`),
    setTransform: (a, _b, _c, d) => void log.push(`setTransform ${a},${d}`),
    getImageData: () => {
      log.push('getImageData');
      return { data, width: w, height: h, colorSpace: 'srgb' } as unknown as ImageData;
    },
    putImageData: () => void log.push('putImageData'),
  };
  return { width: w, height: h, getContext: () => ctx };
}

function fakeEnv(log: string[], o: { noCanvas?: boolean; noContext?: boolean; failImage?: boolean; blob?: Blob | null } = {}): RasterEnv {
  return {
    createCanvas: (w, h) => {
      log.push(`createCanvas ${w}x${h}`);
      if (o.noCanvas) return null;
      if (o.noContext) return { width: w, height: h, getContext: () => null };
      return fakeCanvas(w, h, log);
    },
    loadImage: async (svg) => {
      log.push(`loadImage ${svg.length}`);
      if (o.failImage) throw new Error('decode');
      return {} as CanvasImageSource;
    },
    fontsReady: async (families, px) => void log.push(`fontsReady ${families.join('+')} ${Math.round(px)}`),
    idle: async () => void log.push('idle'),
    toBlob: async () => {
      log.push('toBlob');
      return o.blob === undefined ? new Blob(['png'], { type: 'image/png' }) : o.blob;
    },
  };
}

const SVG = svgDoc({ w: 1920, h: 1080, body: [] });
const TEXTS: TextLayer[] = [
  { text: 'ハナ', x: 960, y: 540, size: 80, font: FONTS.brush, fill: '#C9302C', anchor: 'middle' },
  { text: 'コーヒー', x: 1800, y: 100, size: 40, font: FONTS.mincho, fill: '#1A1A1F', vertical: true },
];

describe('exportPng pipeline', () => {
  it('runs in order: canvas → idle → image → draw → fonts → text → post → blob, with progress', async () => {
    const log: string[] = [];
    const progress: number[] = [];
    const blob = await exportPng({ svg: SVG, texts: TEXTS, width: 3840, height: 2160, post: 'scanlines', onProgress: (p) => progress.push(p) }, fakeEnv(log));
    expect(blob).toBeInstanceOf(Blob);
    const order = ['createCanvas 3840x2160', 'idle', `loadImage ${SVG.length}`, 'drawImage 0,0,3840,2160', 'fontsReady Yuji Syuku+Shippori Mincho B1 160'];
    for (let i = 0; i < order.length; i++) expect(log[i]).toBe(order[i]);
    const textIdx = log.findIndex((l) => l.startsWith('fillText'));
    const postIdx = log.indexOf('getImageData');
    expect(textIdx).toBeGreaterThan(4);
    expect(postIdx).toBeGreaterThan(textIdx);
    expect(log.indexOf('putImageData')).toBeGreaterThan(postIdx);
    expect(log[log.length - 1]).toBe('toBlob');
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    // text pass scales SVG units to the 2× canvas
    expect(log).toContain('setTransform 2,2');
    expect(log.filter((l) => l.startsWith('fillText')).length).toBe(1 + 4);
  });
  it('skips the pixel pass for post none and a missing post', async () => {
    const log: string[] = [];
    await exportPng({ svg: SVG, texts: [], width: 1920, height: 1080 }, fakeEnv(log));
    expect(log).not.toContain('getImageData');
    expect(log.filter((l) => l === 'idle').length).toBe(1);
  });
  it('returns null gracefully without a canvas, without a 2D context, or when the image fails', async () => {
    expect(await exportPng({ svg: SVG, texts: [], width: 10, height: 10 }, fakeEnv([], { noCanvas: true }))).toBeNull();
    expect(await exportPng({ svg: SVG, texts: [], width: 10, height: 10 }, fakeEnv([], { noContext: true }))).toBeNull();
    expect(await exportPng({ svg: SVG, texts: [], width: 10, height: 10 }, fakeEnv([], { failImage: true }))).toBeNull();
    expect(await exportPng({ svg: SVG, texts: [], width: 10, height: 10 }, fakeEnv([], { blob: null }))).toBeNull();
  });
  it('returns null under jsdom (no 2D context) through the default env', async () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const env = defaultEnv();
      expect(env.createCanvas(4, 4)).not.toBeNull();
      expect(await exportPng({ svg: SVG, texts: [], width: 4, height: 4 }, env)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
  it('falls back to an element canvas when OffscreenCanvas is absent and prefers it when present', () => {
    const g = globalThis as { OffscreenCanvas?: unknown };
    expect(g.OffscreenCanvas).toBeUndefined();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const c = defaultEnv().createCanvas(7, 9) as unknown as HTMLCanvasElement;
      expect(c.tagName).toBe('CANVAS');
      expect(c.width).toBe(7);
      expect(c.height).toBe(9);
    } finally {
      spy.mockRestore();
    }
    class Off {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext(): Ctx2D {
        return {} as Ctx2D;
      }
    }
    g.OffscreenCanvas = Off;
    try {
      expect(defaultEnv().createCanvas(3, 3)).toBeInstanceOf(Off);
    } finally {
      delete g.OffscreenCanvas;
    }
  });
  it('idle uses requestIdleCallback when present', async () => {
    const g = globalThis as { requestIdleCallback?: (cb: () => void) => number };
    const calls: number[] = [];
    g.requestIdleCallback = (cb) => {
      calls.push(1);
      cb();
      return 1;
    };
    try {
      await defaultEnv().idle();
      expect(calls.length).toBe(1);
    } finally {
      delete g.requestIdleCallback;
    }
    await defaultEnv().idle();
  });
});

describe('drawTexts', () => {
  it('stacks vertical glyphs with the shared pitch and rotates ー', () => {
    const log: string[] = [];
    const c = fakeCanvas(10, 10, log);
    drawTexts(c.getContext('2d')!, [TEXTS[1]!], 1, 1);
    const fills = log.filter((l) => l.startsWith('fillText'));
    expect(fills.length).toBe(4);
    expect(fills[0]).toContain('コ 1800,120');
    expect(fills[2]).toContain('ヒ 1800,210');
    expect(log).toContain('rotate 90');
    expect(fills[1]).toContain('ー 0,0');
    expect(fills[0]).toContain('center/middle');
    expect(fills[0]).toContain(`400 40px ${FONTS.mincho}`);
  });
  it('horizontal text maps anchors and skips empty layers', () => {
    const log: string[] = [];
    const c = fakeCanvas(10, 10, log);
    drawTexts(c.getContext('2d')!, [TEXTS[0]!, { ...TEXTS[0]!, text: '' }, { ...TEXTS[0]!, anchor: 'end', rotate: -6 }], 1, 1);
    const fills = log.filter((l) => l.startsWith('fillText'));
    expect(fills.length).toBe(2);
    expect(fills[0]).toContain('center/alphabetic');
    expect(fills[1]).toContain('end/alphabetic');
    expect(log).toContain('rotate -6');
  });
  it('fontsOf lists only webfonts, once each', () => {
    expect(fontsOf(TEXTS)).toEqual(['Yuji Syuku', 'Shippori Mincho B1']);
    expect(fontsOf([{ ...TEXTS[0]!, font: FONTS.ja }])).toEqual([]);
  });
});

describe('applyPostPass', () => {
  function canvasWith(w: number, h: number, v: number): { ctx: Ctx2D; data: Uint8ClampedArray } {
    const data = new Uint8ClampedArray(w * h * 4).fill(v);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const c = fakeCanvas(w, h, [], data);
    return { ctx: c.getContext('2d')!, data };
  }
  it('scanlines darken every period-th row only', () => {
    const { ctx, data } = canvasWith(4, 720, 200);
    applyPostPass(ctx, 4, 720, 'scanlines');
    expect(data[0]).toBe(200);
    expect(data[1 * 4 * 4]).toBe(Math.round(200 * 0.72));
    expect(data[2 * 4 * 4]).toBe(200);
    expect(data[3]).toBe(255);
  });
  it('dither quantises to a few levels and is deterministic', () => {
    const { ctx, data } = canvasWith(8, 8, 100);
    applyPostPass(ctx, 8, 8, 'dither');
    const levels = new Set<number>();
    for (let i = 0; i < data.length; i += 4) levels.add(data[i]!);
    expect(levels.size).toBeGreaterThan(1);
    expect(levels.size).toBeLessThanOrEqual(3);
    for (const v of levels) expect(v % 51).toBe(0);
  });
  it('grain is seeded and bounded', () => {
    const a = canvasWith(16, 16, 128);
    const b = canvasWith(16, 16, 128);
    applyPostPass(a.ctx, 16, 16, 'grain', 7);
    applyPostPass(b.ctx, 16, 16, 'grain', 7);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const c = canvasWith(16, 16, 128);
    applyPostPass(c.ctx, 16, 16, 'grain', 8);
    expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
    for (let i = 0; i < a.data.length; i += 4) expect(Math.abs(a.data[i]! - 128)).toBeLessThanOrEqual(18);
  });
  it('none and empty canvases are no-ops', () => {
    const log: string[] = [];
    const c = fakeCanvas(1, 1, log);
    applyPostPass(c.getContext('2d')!, 1, 1, 'none');
    applyPostPass(c.getContext('2d')!, 0, 0, 'grain');
    expect(log).toEqual([]);
  });
});

describe('download / gating / filenames', () => {
  it('download clicks an anchor with the filename; unavailable without object URLs', () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    expect(download(blob, 'a.png')).toBe('unavailable');
    const u = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    u.createObjectURL = () => 'blob:fake';
    u.revokeObjectURL = () => undefined;
    const clicks: string[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(`${this.getAttribute('download')}|${this.href}`);
    });
    try {
      expect(download(blob, 'tsuzuku-x.png')).toBe('download');
      expect(clicks).toEqual(['tsuzuku-x.png|blob:fake']);
      expect(document.querySelector('a[download]')).toBeNull();
    } finally {
      spy.mockRestore();
      delete u.createObjectURL;
      delete u.revokeObjectURL;
    }
  });
  it('iOS opens a tab instead', () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    const u = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    u.createObjectURL = () => 'blob:fake';
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    try {
      expect(isIos()).toBe(true);
      expect(download(blob, 'x.png')).toBe('opened');
      expect(open).toHaveBeenCalledWith('blob:fake', '_blank', 'noopener');
    } finally {
      ua.mockRestore();
      open.mockRestore();
      delete u.createObjectURL;
    }
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIos(undefined)).toBe(false);
  });
  it('4K gate needs deviceMemory ≥ 4 and a desktop media query', () => {
    expect(canRender4k()).toBe(false);
    Object.defineProperty(navigator, 'deviceMemory', { value: 8, configurable: true });
    expect(canRender4k()).toBe(false); // jsdom has no matchMedia
    const w = window as unknown as { matchMedia?: (q: string) => { matches: boolean } };
    w.matchMedia = (q) => ({ matches: q.includes('pointer: fine') });
    try {
      expect(canRender4k()).toBe(true);
      expect(exportSizes('desktop').length).toBe(3);
      Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true });
      expect(canRender4k()).toBe(false);
      expect(exportSizes('desktop')).toEqual([
        [1920, 1080],
        [2560, 1440],
      ]);
      expect(exportSizes('phone', true)).toEqual(EXPORT_SIZES.phone);
    } finally {
      delete w.matchMedia;
      Object.defineProperty(navigator, 'deviceMemory', { value: undefined, configurable: true });
    }
  });
  it('filename pattern', () => {
    const day = civilToDay({ year: 2026, month: 1, day: 15 });
    expect(filenameFor('torii-dawn', 'desktop', day)).toBe('tsuzuku-torii-dawn-desktop-2026-01-15.png');
    expect(filenameFor('Kyoto Arrival!', 'phone', day)).toBe('tsuzuku-kyoto-arrival-phone-2026-01-15.png');
    expect(filenameFor('***', 'phone', day)).toBe('tsuzuku-kakejiku-phone-2026-01-15.png');
  });
});
