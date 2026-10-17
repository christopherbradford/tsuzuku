/**
 * TSUZUKU — ceremony support (group G).
 *
 *  Lazy sibling art   MonCrest, GoshuinStamp, mon.ts and wallpapers/index.ts
 *                     are written by sibling G builders. They are loaded
 *                     through `import.meta.glob` (the pattern main.tsx uses for
 *                     optional barrels): a file that is not built yet is simply
 *                     absent and every ceremony falls back to its own art, so a
 *                     half-built tree never breaks a ceremony or a test. Tests
 *                     inject doubles with `setLazyArtForTests`.
 *  Motion / feel      `prefersReducedMotion()` (store setting OR media query),
 *                     `playSfx()` (silent in Zen, design 01 §6).
 *  useTimeline        phase index driven by setTimeout; reduced motion jumps
 *                     to the final phase (static card).
 *  Focus helpers      `FOCUSABLE`, `isInteractive`.
 */
import type { FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../../shared/audio';
import type { BadgeId, SfxName, WallpaperId } from '../../shared/catalog';
import type { EpochDay } from '../../shared/store-types';
import { store } from '../../store';
import type { RenderedWallpaper, Revealed, WallpaperSize } from '../wallpapers/spec';

/* ────────────────────────────────────────────────────────────────────────── */
/* Sibling module shapes (from their module-plan briefs)                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MonCrestProps {
  id: BadgeId;
  earned: boolean;
  size?: number;
  describe?: string;
  /** The real crest shows its own caption by default; the ceremonies carry the name themselves. */
  caption?: boolean;
  /** The real crest's own hanko-slam entrance; the ceremonies animate the stage instead. */
  slam?: boolean;
}

export interface GoshuinStampProps {
  station: number;
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
  size?: number;
}

export interface MonModule {
  monSvg(spec: unknown, o: { size: number; earned: boolean; seed: number }): string;
  MON_SPECS: Partial<Record<BadgeId, unknown>>;
}

export interface WallpaperRenderOptions {
  size: WallpaperSize;
  reforge: number;
  revealed: Revealed;
  locked: boolean;
}

export interface WallpapersModule {
  renderWallpaper(id: WallpaperId, o: WallpaperRenderOptions): Promise<RenderedWallpaper>;
}

export interface LazyArt {
  MonCrest: FunctionComponent<MonCrestProps> | null;
  GoshuinStamp: FunctionComponent<GoshuinStampProps> | null;
  mon: MonModule | null;
  wallpapers: WallpapersModule | null;
}

type AnyModule = Record<string, unknown>;

const FILES = {
  MonCrest: '/src/art/MonCrest.tsx',
  GoshuinStamp: '/src/art/GoshuinStamp.tsx',
  mon: '/src/art/mon.ts',
  wallpapers: '/src/art/wallpapers/index.ts',
} as const;

/** Only files that exist at build time appear here; the keys are the paths above. */
const GLOB = import.meta.glob<AnyModule>(['/src/art/MonCrest.tsx', '/src/art/GoshuinStamp.tsx', '/src/art/mon.ts', '/src/art/wallpapers/index.ts']);

let override: Partial<LazyArt> | null = null;
const cache = new Map<string, Promise<AnyModule | null>>();

/**
 * Tests: `setLazyArtForTests({ MonCrest: Fake })` serves doubles; a key set to
 * `null` means "not built"; `setLazyArtForTests(null)` restores the real
 * loaders and clears the cache.
 */
export function setLazyArtForTests(o: Partial<LazyArt> | null): void {
  override = o;
  cache.clear();
}

async function loadFile(file: string): Promise<AnyModule | null> {
  const loader = GLOB[file];
  if (!loader) return null;
  try {
    return await loader();
  } catch (err) {
    // The file exists but cannot be evaluated yet (e.g. the kakejiku registry
    // before every generator is written). Degrade to the fallback art.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ceremony] ${file} unavailable: ${msg.split('\n')[0]}`);
    return null;
  }
}

function cached(file: string): Promise<AnyModule | null> {
  let p = cache.get(file);
  if (!p) {
    p = loadFile(file);
    cache.set(file, p);
  }
  return p;
}

function has<K extends keyof LazyArt>(k: K): boolean {
  return override !== null && Object.prototype.hasOwnProperty.call(override, k);
}

export async function loadMonCrest(): Promise<FunctionComponent<MonCrestProps> | null> {
  if (has('MonCrest')) return override!.MonCrest ?? null;
  const m = await cached(FILES.MonCrest);
  return m && typeof m.MonCrest === 'function' ? (m.MonCrest as FunctionComponent<MonCrestProps>) : null;
}

export async function loadGoshuinStamp(): Promise<FunctionComponent<GoshuinStampProps> | null> {
  if (has('GoshuinStamp')) return override!.GoshuinStamp ?? null;
  const m = await cached(FILES.GoshuinStamp);
  return m && typeof m.GoshuinStamp === 'function' ? (m.GoshuinStamp as FunctionComponent<GoshuinStampProps>) : null;
}

export async function loadMon(): Promise<MonModule | null> {
  if (has('mon')) return override!.mon ?? null;
  const m = await cached(FILES.mon);
  if (!m || typeof m.monSvg !== 'function' || typeof m.MON_SPECS !== 'object' || m.MON_SPECS === null) return null;
  return { monSvg: m.monSvg as MonModule['monSvg'], MON_SPECS: m.MON_SPECS as MonModule['MON_SPECS'] };
}

export async function loadWallpapers(): Promise<WallpapersModule | null> {
  if (has('wallpapers')) return override!.wallpapers ?? null;
  const m = await cached(FILES.wallpapers);
  return m && typeof m.renderWallpaper === 'function' ? { renderWallpaper: m.renderWallpaper as WallpapersModule['renderWallpaper'] } : null;
}

/** `useEffect`-friendly loader: resolves to the module (or null) once, ignoring late results after unmount. */
export function useLazy<T>(load: () => Promise<T | null>): { value: T | null; settled: boolean } {
  const [state, setState] = useState<{ value: T | null; settled: boolean }>({ value: null, settled: false });
  useEffect(() => {
    let alive = true;
    load().then(
      (v) => {
        if (alive) setState({ value: v, settled: true });
      },
      () => {
        if (alive) setState({ value: null, settled: true });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Motion and feel                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** The store's `reducedMotion` setting OR the OS preference. */
export function prefersReducedMotion(): boolean {
  try {
    if (store.settings.peek().reducedMotion) return true;
  } catch {
    /* store not initialised: fall through to the media query */
  }
  try {
    return typeof matchMedia === 'function' && matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

export function currentFeel(): 'zen' | 'dojo' | 'arcade' {
  try {
    const f = store.settings.peek().feel;
    return f === 'zen' || f === 'arcade' ? f : 'dojo';
  } catch {
    return 'dojo';
  }
}

/** SFX through the audio slot; Zen keeps the ceremony silent (design 01 §6). */
export function playSfx(name: SfxName): void {
  if (currentFeel() === 'zen') return;
  try {
    sfx(name);
  } catch (err) {
    console.warn('[ceremony] sfx failed', err);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Timeline                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TimelineOptions {
  /** Static variant: jump to the last phase at once (the `endAt` timer still runs). */
  reduced: boolean;
  /** Fire `onEnd` this many ms after mount (auto-complete). */
  endAt?: number;
  onEnd?: () => void;
}

/**
 * Current phase index for a list of phase start times (ms since mount, `at[0]`
 * is 0). Phases only move forward; timers are cleared on unmount.
 */
export function useTimeline(at: readonly number[], o: TimelineOptions): number {
  const last = Math.max(0, at.length - 1);
  const [phase, setPhase] = useState(o.reduced ? last : 0);
  const onEnd = useRef(o.onEnd);
  onEnd.current = o.onEnd;
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!o.reduced) {
      at.forEach((ms, i) => {
        if (i === 0) return;
        timers.push(
          setTimeout(() => {
            setPhase((p) => (i > p ? i : p));
          }, Math.max(0, ms)),
        );
      });
    }
    if (o.endAt !== undefined) {
      timers.push(
        setTimeout(() => {
          onEnd.current?.();
        }, Math.max(0, o.endAt)),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // The phase table and the reduced flag are fixed for the life of a ceremony.
  }, []);
  return phase;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Focus helpers                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** True when the event target is (inside) a control that handles its own activation. */
export function isInteractive(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  return (t as Element).closest('button, a[href], input, select, textarea, summary, [role="button"]') !== null;
}

/** Tab / Shift+Tab stay inside `root`. */
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0]!;
  const lastEl = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    lastEl.focus();
  } else if (!e.shiftKey && active === lastEl) {
    e.preventDefault();
    first.focus();
  }
}

/** Inline-SVG helper: inject extra markup before the closing tag of a document string. */
export function appendToSvg(svg: string, markup: string): string {
  const i = svg.lastIndexOf('</svg>');
  return i < 0 ? svg : svg.slice(0, i) + markup + svg.slice(i);
}
