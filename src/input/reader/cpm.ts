/**
 * TSUZUKU — reading speed (design 04 §7: silent cpm timer; speed-read targets
 * N5 80 · N4 150 · N3 250 · N2 350 · N1 450 cpm; Perapera 読 = median cpm).
 *
 * Characters = plain surface (ruby stripped), punctuation and whitespace
 * excluded. The timer is pure (injected clock) and pauses while the page is
 * hidden (`bindVisibility`). Banding compares a measured cpm with the level
 * target; `msPerLine` paces Speed Read's line-by-line reveal.
 */
import { toPlain } from '../../content/ruby';
import { BELTS, type Level, type StoryLine } from '../../content/types';
import { normalizeJa } from '../../shared/jp';

export type CpmLevel = Exclude<Level, 'kana' | 'dan'>;

/** Speed-read targets by level (design 04 §7). */
export const CPM_TARGETS: Record<CpmLevel, number> = { n5: 80, n4: 150, n3: 250, n2: 350, n1: 450 };

/** Readable characters of one plain / ruby'd string: no punctuation, no whitespace. */
export function plainChars(s: string): number {
  return Array.from(normalizeJa(toPlain(s))).length;
}

/** Readable characters of a story (sum over lines). */
export function charCount(lines: readonly StoryLine[]): number {
  let n = 0;
  for (const l of lines) n += plainChars(l.ja);
  return n;
}

/** Characters per minute, rounded; 0 when nothing was read or no time passed. */
export function cpm(chars: number, ms: number): number {
  if (!(chars > 0) || !(ms > 0)) return 0;
  return Math.round((chars / ms) * 60_000);
}

/** Milliseconds a line of `chars` should stay on screen at `targetCpm` (≥ 600 ms so a short line never flashes). */
export function msPerLine(chars: number, targetCpm: number): number {
  if (!(targetCpm > 0)) return 0;
  return Math.max(600, Math.round((Math.max(0, chars) / targetCpm) * 60_000));
}

export type CpmBand = 'below' | 'near' | 'at' | 'above';

/**
 * Where a measured cpm sits against the level target:
 *  below < 0.6 × target · near < 1.0 × · at < 1.3 × · above ≥ 1.3 ×
 */
export function cpmBand(measured: number, level: CpmLevel): CpmBand {
  const t = CPM_TARGETS[level];
  if (measured < t * 0.6) return 'below';
  if (measured < t) return 'near';
  if (measured < t * 1.3) return 'at';
  return 'above';
}

/** Level of a station (BELTS table); `null` for the kana stations and out-of-range values. */
export function levelForStation(station: number): CpmLevel | null {
  const belt = BELTS.find((b) => station >= b.stations[0] && station <= b.stations[1]);
  if (!belt || belt.level === 'kana' || belt.level === 'dan') return null;
  return belt.level;
}

/** Target cpm for a station (N5 for the kana stations: the first reading target). */
export function cpmTargetForStation(station: number): number {
  return CPM_TARGETS[levelForStation(station) ?? 'n5'];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Timer                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ReadingTimer {
  start(): void;
  pause(): void;
  resume(): void;
  /** Stops and returns the accumulated ms. */
  stop(): number;
  /** Accumulated reading ms so far (live while running). */
  elapsedMs(): number;
  running(): boolean;
  /** Started at least once. */
  started(): boolean;
}

/**
 * Accumulates reading time between `start()`/`resume()` and `pause()`/`stop()`.
 * `now` is injected (`store.now` in the app, a counter in tests); `cpm()` on
 * the result gives the episode's reading speed.
 */
export function createReadingTimer(now: () => number): ReadingTimer {
  let acc = 0;
  let since: number | null = null;
  let begun = false;
  const flush = (): void => {
    if (since !== null) {
      acc += Math.max(0, now() - since);
      since = null;
    }
  };
  return {
    start() {
      acc = 0;
      begun = true;
      since = now();
    },
    pause() {
      flush();
    },
    resume() {
      if (!begun) {
        begun = true;
        acc = 0;
      }
      if (since === null) since = now();
    },
    stop() {
      flush();
      return acc;
    },
    elapsedMs() {
      return since === null ? acc : acc + Math.max(0, now() - since);
    },
    running: () => since !== null,
    started: () => begun,
  };
}

export interface VisibilityDoc {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

/**
 * Pauses the timer while the document is hidden and resumes it when visible
 * again (only if it was running when hidden). Returns the unsubscribe.
 */
export function bindVisibility(timer: ReadingTimer, doc: VisibilityDoc): () => void {
  let pausedByUs = false;
  const onChange = (): void => {
    if (doc.hidden) {
      if (timer.running()) {
        timer.pause();
        pausedByUs = true;
      }
    } else if (pausedByUs) {
      pausedByUs = false;
      timer.resume();
    }
  };
  doc.addEventListener('visibilitychange', onChange);
  return () => doc.removeEventListener('visibilitychange', onChange);
}
