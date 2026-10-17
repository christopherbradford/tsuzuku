/**
 * TSUZUKU — <WallpaperUnlock>: a kakejiku (hanging scroll) unrolls to reveal
 * the new piece, or a quarter more of a progressive one, with the wind chime
 * (design 06 §3). The artwork is rendered through the kakejiku registry
 * (sibling G module `wallpapers/index.ts`) when it is available; otherwise a
 * seeded sumi placeholder carries the piece's name and the Studio link.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { WallpaperId } from '../../shared/catalog';
import { hashSeed, mulberry32, uniform } from '../../shared/hash';
import { href } from '../../shared/routes';
import { store } from '../../store';
import { INK_WASH, NIGHT, PALETTE, SUMI, WASHI, alpha } from '../color';
import { FONTS, fitSize, tategaki, textLayersSvg } from '../jtext';
import { blur, circle, linearGradient, rect, safeRect, sizeOf, svgDoc, text, uid, url, type SizeKey } from '../svg';
import { WALLPAPER_NAMES, fill } from '../strings';
import { S } from './strings';
import { appendToSvg, loadWallpapers, playSfx, prefersReducedMotion, useLazy, useTimeline } from './support';
import './WallpaperUnlock.css';

export interface WallpaperUnlockProps {
  id: WallpaperId;
  /** A progressive reveal (1–3) instead of the full unlock. */
  quadrant?: 1 | 2 | 3 | 4;
  onDone(): void;
  reduced?: boolean;
}

/** Phase start times: rolled → unrolling (1.4 s clip reveal) → open (copy and buttons). */
export const UNROLL_AT: readonly number[] = [0, 80, 1600];
export const UNROLL_PHASES = ['rolled', 'unrolling', 'open'] as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* Placeholder                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Seeded sumi-and-indigo card with the piece's name in tategaki: honest stand-in until the generator renders. */
export function placeholderWallpaperSvg(id: WallpaperId, seed: number, size: SizeKey): string {
  const { w, h } = sizeOf(size);
  const rng = mulberry32(seed >>> 0);
  const names = WALLPAPER_NAMES[id];
  const safe = safeRect(size, Math.round(w * 0.08));
  const gradId = uid('ph-sky', id);
  const mistId = uid('ph-mist', id);
  const kin = PALETTE.light.kin;
  const defs = [linearGradient(gradId, [[0, SUMI], [0.55, NIGHT], [1, PALETTE.light.kon]], 90), blur(mistId, Math.max(12, w * 0.03))];
  const body: string[] = [rect(0, 0, w, h, { fill: url(gradId) })];
  const moonR = w * uniform(rng, 0.05, 0.09);
  const mx = safe.x + safe.w * uniform(rng, 0.2, 0.8);
  const my = safe.y + safe.h * uniform(rng, 0.12, 0.3);
  body.push(circle(mx, my, moonR * 1.9, { fill: alpha(kin, 0.12), filter: url(mistId) }));
  body.push(circle(mx, my, moonR, { fill: kin, opacity: 0.92 }));
  for (let i = 0; i < 3; i++) {
    const y = safe.y + safe.h * uniform(rng, 0.45, 0.95);
    const bw = w * uniform(rng, 0.6, 1.3);
    body.push(rect(uniform(rng, -0.3, 0.3) * w, y, bw, h * uniform(rng, 0.02, 0.05), { fill: alpha(WASHI, 0.16), filter: url(mistId) }));
  }
  const vertical = size === 'phone';
  if (vertical) {
    const sz = fitSize(names.ja, safe.w * 0.32, safe.h * 0.6, { vertical: true, max: w * 0.2, min: 24 });
    body.push(tategaki({ text: names.ja, x: w / 2, y: safe.y + safe.h * 0.42 - (sz * (1 + (Array.from(names.ja).length - 1) * 1.12)) / 2, size: sz, font: FONTS.brush, fill: WASHI }));
  } else {
    const sz = fitSize(names.ja, safe.w * 0.7, h * 0.26, { max: h * 0.24, min: 24 });
    body.push(text(names.ja, { x: w / 2, y: h * 0.56, 'text-anchor': 'middle', 'font-family': FONTS.brush, 'font-size': sz, fill: WASHI, lang: 'ja' }));
  }
  body.push(
    text(names.en, {
      x: w / 2,
      y: safe.y + safe.h - w * 0.02,
      'text-anchor': 'middle',
      'font-family': FONTS.ui,
      'font-size': Math.max(18, w * 0.026),
      fill: WASHI,
      opacity: 0.75,
      'letter-spacing': w * 0.004,
      lang: 'en',
    }),
  );
  body.push(rect(0, 0, w, h, { fill: 'none', stroke: alpha(INK_WASH, 0.4), 'stroke-width': Math.max(2, w * 0.004) }));
  return svgDoc({ w, h, defs, body, title: fill(S.scrollAlt, { name: names.en }) });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function WallpaperUnlock(p: WallpaperUnlockProps): JSX.Element {
  const reduced = p.reduced ?? prefersReducedMotion();
  const phase = useTimeline(UNROLL_AT, { reduced });
  const names = WALLPAPER_NAMES[p.id];
  const wallpapers = useLazy(loadWallpapers);
  const [art, setArt] = useState<string | null>(null);
  const entry = store.collections.value.wallpapers[p.id];
  const reforge = entry?.reforges ?? 0;
  const seed = hashSeed(store.seed(), p.id, reforge);
  const quadrant = p.quadrant !== undefined && p.quadrant < 4 ? p.quadrant : undefined;

  useEffect(() => {
    playSfx('wallpaper');
  }, []);

  useEffect(() => {
    if (!wallpapers.settled || !wallpapers.value) return;
    let alive = true;
    wallpapers.value
      .renderWallpaper(p.id, { size: 'phone', reforge, revealed: quadrant ?? 4, locked: quadrant !== undefined })
      .then(
        (r) => {
          if (alive && r && typeof r.svg === 'string') setArt(appendToSvg(r.svg, textLayersSvg(r.texts ?? [])));
        },
        (err: unknown) => {
          console.warn('[ceremony] renderWallpaper failed', err);
        },
      );
    return () => {
      alive = false;
    };
  }, [wallpapers.settled]);

  const svg = art ?? placeholderWallpaperSvg(p.id, seed, 'phone');
  const phaseName = UNROLL_PHASES[Math.min(phase, UNROLL_PHASES.length - 1)];
  const studio = href({ name: 'studio', wallpaperId: p.id });

  return (
    <section class={`kakejiku-unlock kakejiku-unlock--${phaseName}`} data-phase={phase} data-wallpaper={p.id} data-preview={art ? 'render' : 'placeholder'}>
      <p class="kakejiku-unlock__eyebrow status-window__label">
        {quadrant ? S.wallpaperRevealed : S.wallpaperUnlocked}
        {quadrant ? <span class="chip kakejiku-unlock__quadrant">{fill(S.revealCount, { q: quadrant })}</span> : null}
      </p>
      <figure class="kakejiku" aria-label={fill(S.scrollAlt, { name: names.en })}>
        <div class="kakejiku__jiku kakejiku__jiku--top" aria-hidden="true" />
        <div class="kakejiku__silk">
          <div class="kakejiku__art" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
        <div class="kakejiku__jiku kakejiku__jiku--bottom" aria-hidden="true" />
      </figure>
      <h2 class="kakejiku-unlock__name brush" lang="ja">
        {names.ja}
      </h2>
      <p class="kakejiku-unlock__name-en">{names.en}</p>
      {!art ? <p class="kakejiku-unlock__pending muted">{wallpapers.settled && !wallpapers.value ? S.previewPending : S.previewLoading}</p> : null}
      <div class="kakejiku-unlock__actions">
        <a class="hanko kakejiku-unlock__studio" href={studio} onClick={() => p.onDone()}>
          {S.openStudio}
        </a>
        <button type="button" class="btn btn--ghost kakejiku-unlock__continue" onClick={() => p.onDone()}>
          {S.continue}
        </button>
      </div>
    </section>
  );
}
