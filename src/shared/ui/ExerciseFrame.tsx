/**
 * TSUZUKU — `<ExerciseFrame>`: the shared frame around every drill (ARCHITECTURE §4).
 *
 * E (SessionView/GateView/ShinsaView) wraps the resolved exercise in it and
 * feeds the runner's `ki/combo/timer/feedback`. The frame owns the keyboard
 * (design 04 §0 / 01 §7) — exercises never bind keys:
 *   1–9          pick a choice (the handler the exercise registered through
 *                `useExerciseKeys`, else the `onChoice` prop; index is 0-based)
 *   Enter        continue when feedback shows; else the registered `onSubmit`
 *   Space        continue when feedback shows; else replay (registered / prop)
 *   ?            hint · Shift+Enter guard · Esc pause / resume
 * Keys typed into an input/textarea are left alone except Shift+Enter, Esc and
 * Enter-to-continue (captured before the input sees it). Zen hides ki, combo
 * and the speed ring; the ring also needs `step.timed` and a `timer`.
 */
import { createContext, type JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ExerciseFrameProps as ContractProps } from '../exercise-types';
import { Feedback, feedbackAnnouncement } from './Feedback';
import { S, fill } from './strings';
import { useTimer } from './use-timer';
import './ui.css';

/* ── context: exercises register handlers instead of binding keys ───────── */

export interface ExerciseKeyHandlers {
  /** Digit `n` (1–9) → `onChoice(n − 1)`. */
  onChoice?(index: number): void;
  /** Space (no feedback showing). */
  onReplay?(): void;
  /** Enter outside an input (no feedback showing). */
  onSubmit?(): void;
}

export interface ExerciseFrameApi {
  register(h: ExerciseKeyHandlers): () => void;
  /** False outside a frame (tests, previews). */
  readonly inFrame: boolean;
}

export const ExerciseFrameContext = createContext<ExerciseFrameApi>({
  register: () => () => undefined,
  inFrame: false,
});

export function useExerciseFrame(): ExerciseFrameApi {
  return useContext(ExerciseFrameContext);
}

/** Registers the exercise's key handlers with the enclosing frame (latest closures are used). */
export function useExerciseKeys(h: ExerciseKeyHandlers): void {
  const api = useContext(ExerciseFrameContext);
  const ref = useRef(h);
  ref.current = h;
  useEffect(
    () =>
      api.register({
        onChoice: (i) => ref.current.onChoice?.(i),
        onReplay: () => ref.current.onReplay?.(),
        onSubmit: () => ref.current.onSubmit?.(),
      }),
    [api],
  );
}

/* ── props ──────────────────────────────────────────────────────────────── */

export interface ExerciseFrameProps extends ContractProps {
  /** Injected clock for the speed ring (`store.now`); `timer.startedAt` is read on this clock. */
  now?: () => number;
  /** Soft deadline reached (ring empty). Never fails a rep by itself. */
  onTimeout?(): void;
  /** 「もう一度」 on the feedback card; the button is hidden when absent. */
  onAgain?(): void;
  /** Resume after a pause (the frame keeps its own pause overlay). */
  onResume?(): void;
}

const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(type);
  }
  return false;
}

const STEP_TAG_LABEL: Record<NonNullable<ContractProps['step']['stepTag']>, string> = {
  intro: S.introStep,
  '+3': '+3',
  '+10': '+10',
  recovery: S.recoveryStep,
  relearn: S.relearnStep,
};

export function ExerciseFrame(p: ExerciseFrameProps): JSX.Element {
  const [paused, setPaused] = useState(false);
  const props = useRef(p);
  props.current = p;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const handlers = useRef<Set<ExerciseKeyHandlers>>(new Set());

  const api = useMemo<ExerciseFrameApi>(
    () => ({
      inFrame: true,
      register(h) {
        handlers.current.add(h);
        return () => {
          handlers.current.delete(h);
        };
      },
    }),
    [],
  );

  const zen = p.feel === 'zen';
  const showTimer = p.timer !== null && p.step.timed && !zen;
  const timer = useTimer({
    deadlineMs: p.timer?.ms,
    running: showTimer && !paused && p.feedback === null,
    now: p.now,
    startedAt: p.timer?.startedAt,
    onTimeout: () => props.current.onTimeout?.(),
  });
  const startedAt = p.timer?.startedAt;
  useEffect(() => {
    timer.reset(startedAt);
  }, [timer, p.step.id, startedAt]);

  const pause = (): void => {
    if (pausedRef.current) return;
    setPaused(true);
    props.current.onPause();
  };
  const resume = (): void => {
    if (!pausedRef.current) return;
    setPaused(false);
    props.current.onResume?.();
  };

  // Latest registered handler wins (the innermost exercise registers last).
  const latest = (): ExerciseKeyHandlers | undefined => {
    let last: ExerciseKeyHandlers | undefined;
    for (const h of handlers.current) last = h;
    return last;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const cur = props.current;
      const fb = cur.feedback;
      const editing = isEditable(e.target);
      const onButton = e.target instanceof HTMLElement && e.target.tagName === 'BUTTON';
      const consume = (): void => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (pausedRef.current) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          if (onButton && e.key !== 'Escape') return; // native click on Resume
          consume();
          resume();
        }
        return;
      }
      if (e.key === 'Escape') {
        consume();
        pause();
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        if (!fb) {
          consume();
          cur.onGuard();
        }
        return;
      }
      if (fb && (e.key === 'Enter' || e.key === ' ')) {
        if (onButton) return; // let the focused button click
        consume();
        cur.onContinue();
        return;
      }
      if (editing) return;
      if (onButton && (e.key === 'Enter' || e.key === ' ')) return;

      const h = latest();
      if (e.key >= '1' && e.key <= '9' && e.key.length === 1) {
        if (fb) return;
        const idx = Number(e.key) - 1;
        const fn = h?.onChoice ?? cur.onChoice;
        if (fn) {
          consume();
          fn(idx);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (h?.onSubmit) {
          consume();
          h.onSubmit();
        }
        return;
      }
      if (e.key === ' ') {
        const fn = h?.onReplay ?? cur.onReplay;
        if (fn) {
          consume();
          fn();
        }
        return;
      }
      if (e.key === '?' && !fb) {
        consume();
        cur.onHint();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const fb = p.feedback;
  const announce = paused ? S.paused : fb ? feedbackAnnouncement(fb) : '';
  const progress = timer.progress.value;
  const secondsLeft = Math.ceil(timer.remaining.value / 1000);
  const tag = p.step.stepTag;

  return (
    <ExerciseFrameContext.Provider value={api}>
      <section
        class="exercise-frame"
        data-feel={p.feel}
        data-exercise={p.step.exercise}
        data-paused={paused ? 'true' : undefined}
        aria-label="Exercise"
      >
        <header class="exercise-frame__head">
          <span class="exercise-frame__progress" aria-label={fill(S.stepOf, { i: p.index + 1, n: p.total })}>
            {p.index + 1} / {p.total}
            {p.step.isNew ? <span class="chip exercise-frame__tag">{S.newItem}</span> : null}
            {tag ? (
              <span class="chip exercise-frame__tag" data-step-tag={tag}>
                {STEP_TAG_LABEL[tag]}
              </span>
            ) : null}
          </span>
          {zen ? (
            <span />
          ) : (
            <div
              class="ki-bar status-window"
              role="meter"
              aria-label={S.ki}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p.ki)}
              data-full={p.ki >= 100 ? 'true' : undefined}
            >
              <span class="ki-bar__label" lang="ja">
                気
              </span>
              <div class="ki-bar__track">
                <div class="ki-bar__fill" style={{ width: `${Math.max(0, Math.min(100, p.ki))}%` }} />
              </div>
            </div>
          )}
          {!zen && p.combo > 0 ? (
            <span class="combo" data-tier={p.comboTier} aria-label={`${p.combo} ${S.combo}`}>
              {p.combo}
              <small>{S.combo}</small>
            </span>
          ) : null}
          {showTimer ? (
            <div
              class="speed-ring"
              role="timer"
              aria-label={fill(S.secondsLeft, { n: secondsLeft })}
              data-timed-out={timer.timedOut.value ? 'true' : undefined}
            >
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle class="speed-ring__track" cx="18" cy="18" r={RING_R} />
                <circle
                  class="speed-ring__fill"
                  cx="18"
                  cy="18"
                  r={RING_R}
                  style={{ strokeDasharray: `${RING_C}`, strokeDashoffset: `${RING_C * progress}` }}
                />
              </svg>
              <span class="speed-ring__text" aria-hidden="true">
                {secondsLeft}
              </span>
            </div>
          ) : null}
        </header>

        <div class="exercise-frame__body" aria-hidden={paused ? 'true' : undefined}>
          {p.children}
        </div>

        {fb ? <Feedback state={fb} feel={p.feel} onAgain={p.onAgain} /> : null}

        <footer class="exercise-frame__controls">
          {!fb ? (
            <button type="button" class="btn btn--ghost" onClick={() => p.onGuard()} aria-keyshortcuts="Shift+Enter">
              {S.guardButton}
              <kbd aria-hidden="true">⇧↵</kbd>
            </button>
          ) : null}
          {!fb ? (
            <button type="button" class="btn btn--ghost" onClick={() => p.onHint()} aria-keyshortcuts="?">
              {S.hintButton}
              <kbd aria-hidden="true">?</kbd>
            </button>
          ) : null}
          <button type="button" class="btn btn--ghost" onClick={pause} aria-keyshortcuts="Escape">
            {S.pauseButton}
            <kbd aria-hidden="true">Esc</kbd>
          </button>
          {fb ? (
            <button type="button" class="hanko" onClick={() => p.onContinue()} aria-keyshortcuts="Enter">
              {S.continue}
              <kbd aria-hidden="true">↵</kbd>
            </button>
          ) : null}
        </footer>

        {paused ? (
          <div class="pause-overlay" role="dialog" aria-modal="true" aria-label={S.paused}>
            <div class="pause-overlay__card status-window">
              <span class="pause-overlay__kanji" lang="ja">
                休憩
              </span>
              <p>{S.paused}</p>
              <button type="button" class="hanko" onClick={resume} autoFocus>
                {S.resumeButton}
              </button>
            </div>
          </div>
        ) : null}

        <div class="sr-only" role="status" aria-live="polite">
          {announce}
        </div>
      </section>
    </ExerciseFrameContext.Provider>
  );
}
