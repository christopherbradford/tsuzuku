/**
 * TSUZUKU — `useTimer`: elapsed / countdown hook for the speed ring (design 04 §0).
 *
 * Pure with respect to the clock: `now` is injected (`store.now`); the default
 * is `performance.now`, the only clock allowed outside `hash.ts`/`store.now()`.
 * Time accumulates only while `running` is true, the hook is not paused and
 * the document is visible. `deadlineMs` is a soft deadline: `progress` clamps
 * to 1, `timedOut` flips once and `onTimeout` fires once per run.
 * `startedAt` (same clock base as `now`) back-dates the start so a resumed
 * step keeps its elapsed time.
 */
import { useSignal, type Signal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';

export interface UseTimerOptions {
  /** Soft deadline in ms; omit for a plain elapsed timer. */
  deadlineMs?: number;
  /** Host-driven run flag (false while feedback shows or the frame is paused). */
  running: boolean;
  /** Injected clock; default `performance.now`. */
  now?: () => number;
  /** Clock value at which the run began (back-dates `elapsed`). */
  startedAt?: number;
  /** Tick period in ms (default 100). */
  tickMs?: number;
  onTimeout?: () => void;
}

export interface TimerHandle {
  elapsed: Signal<number>;
  /** `max(0, deadline − elapsed)`; 0 without a deadline. */
  remaining: Signal<number>;
  /** 0..1 of the deadline; 0 without one. */
  progress: Signal<number>;
  timedOut: Signal<boolean>;
  /** Learner/frame pause (independent of `running` and visibility). */
  paused: Signal<boolean>;
  pause(): void;
  resume(): void;
  /** Restart from 0, or from `startedAt` on the injected clock. */
  reset(startedAt?: number): void;
}

/** The handle plus the hooks the effects below drive. */
interface TimerCore extends TimerHandle {
  sync(): void;
  publish(): void;
  deadlineChanged(): void;
  setHidden(h: boolean): void;
  ticking(): boolean;
}

interface TimerState {
  /** Elapsed ms accumulated over earlier run segments. */
  base: number;
  /** Clock value when the current run segment began; null while stopped. */
  since: number | null;
  fired: boolean;
  hidden: boolean;
}

const defaultNow = (): number => performance.now();

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useTimer(o: UseTimerOptions): TimerHandle {
  const elapsed = useSignal(0);
  const remaining = useSignal(o.deadlineMs ?? 0);
  const progress = useSignal(0);
  const timedOut = useSignal(false);
  const paused = useSignal(false);

  const opts = useRef(o);
  opts.current = o;

  const core = useMemo<TimerCore>(() => {
    const clock = (): number => (opts.current.now ?? defaultNow)();
    const s: TimerState = {
      base: o.startedAt === undefined ? 0 : Math.max(0, clock() - o.startedAt),
      since: null,
      fired: false,
      hidden: isHidden(),
    };

    const publish = (): void => {
      const e = s.base + (s.since === null ? 0 : clock() - s.since);
      elapsed.value = e;
      const d = opts.current.deadlineMs;
      if (d !== undefined && d > 0) {
        progress.value = Math.min(1, Math.max(0, e / d));
        remaining.value = Math.max(0, d - e);
        if (e >= d && !s.fired) {
          s.fired = true;
          timedOut.value = true;
          opts.current.onTimeout?.();
        }
      } else {
        progress.value = 0;
        remaining.value = 0;
      }
    };

    const active = (): boolean => opts.current.running && !paused.peek() && !s.hidden;

    const sync = (): void => {
      const a = active();
      if (a && s.since === null) s.since = clock();
      else if (!a && s.since !== null) {
        s.base += clock() - s.since;
        s.since = null;
      }
      publish();
    };

    return {
      elapsed,
      remaining,
      progress,
      timedOut,
      paused,
      sync,
      publish,
      pause() {
        paused.value = true;
        sync();
      },
      resume() {
        paused.value = false;
        sync();
      },
      reset(startedAt?: number) {
        s.base = startedAt === undefined ? 0 : Math.max(0, clock() - startedAt);
        s.since = null;
        s.fired = false;
        timedOut.value = false;
        sync();
      },
      deadlineChanged() {
        const d = opts.current.deadlineMs;
        if (d === undefined || elapsed.peek() < d) {
          s.fired = false;
          timedOut.value = false;
        }
        publish();
      },
      setHidden(h: boolean) {
        s.hidden = h;
        sync();
      },
      ticking() {
        return s.since !== null;
      },
    };
  }, []);

  // Run / stop with the host flag.
  useEffect(() => {
    core.sync();
  }, [core, o.running]);

  // Deadline changes re-evaluate progress and the fired flag.
  useEffect(() => {
    core.deadlineChanged();
  }, [core, o.deadlineMs]);

  // Tick while a run segment is open.
  useEffect(() => {
    const id = setInterval(() => {
      if (core.ticking()) core.publish();
    }, o.tickMs ?? 100);
    return () => clearInterval(id);
  }, [core, o.tickMs]);

  // Pause while the document is hidden.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = (): void => core.setHidden(isHidden());
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [core]);

  return core;
}
