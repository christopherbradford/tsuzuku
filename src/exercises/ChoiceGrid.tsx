/**
 * TSUZUKU — `<ChoiceGrid>`: the numbered choice grid every multiple-choice
 * drill shares (design 04 §0 keys 1–9, 01 §7 44 px targets).
 *
 *  · 2–9 choices in 2 or 3 columns (default: 2 up to four choices, else 3);
 *    text, `lang="ja"` text, or ruby markup (`ruby` = a furigana mode).
 *  · Digits arrive through `useExerciseKeys` from the enclosing
 *    `<ExerciseFrame>` (0-based index); the grid never binds keys itself.
 *  · After a pick (`picked`), or when `reveal` is set without one (timeout,
 *    Guard), every button locks and shows its state as shape + text, never
 *    color alone: `correct` (picked and right), `wrong` (picked and not),
 *    `missed` (the right answer the learner did not pick).
 *  · `onPick` fires once per grid life; later taps and digits are ignored.
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { FuriganaMode } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { S, fill } from './strings';
import './ChoiceGrid.css';

/** `picked` = chosen with no `correct` index given (ungraded / self-graded grids). */
export type ChoiceState = 'idle' | 'picked' | 'correct' | 'wrong' | 'missed';

export interface ChoiceGridProps {
  choices: string[];
  onPick(i: number): void;
  /** Index the learner chose; set it to lock the grid and reveal states. */
  picked?: number;
  /** Index of the right answer (revealed with `picked` or `reveal`). */
  correct?: number;
  columns?: 2 | 3;
  /** Japanese choices: `lang="ja"` and the JP font. */
  ja?: boolean;
  /** Render choices through `<Ruby>` with this furigana mode (choices may carry `{base|reading}`). Implies `ja`. */
  ruby?: FuriganaMode;
  /** Lock and show states without a pick (timeout / Guard). */
  reveal?: boolean;
  disabled?: boolean;
  /** Accessible name of the group; default "Choices". */
  label?: string;
  /** `lg` for single glyphs (kana, kanji, ○/×). */
  size?: 'md' | 'lg';
}

const STATE_TEXT: Record<Exclude<ChoiceState, 'idle'>, string> = {
  picked: S.yourPick,
  correct: S.correctPick,
  wrong: S.yourPick,
  missed: S.missedPick,
};

const STATE_MARK: Record<Exclude<ChoiceState, 'idle'>, string> = { picked: '●', correct: '○', wrong: '×', missed: '○' };

/** State of choice `i` once the grid is answered (`picked` set) or revealed. */
export function choiceState(i: number, picked: number | undefined, correct: number | undefined, reveal: boolean): ChoiceState {
  if (picked === undefined && !reveal) return 'idle';
  if (picked === i) {
    if (correct === undefined) return 'picked';
    return picked === correct ? 'correct' : 'wrong';
  }
  if (correct === i) return 'missed';
  return 'idle';
}

export function ChoiceGrid(p: ChoiceGridProps): JSX.Element {
  const locked = p.picked !== undefined || Boolean(p.reveal) || Boolean(p.disabled);
  const fired = useRef(false);
  // Re-arm when the exercise instance is reused for a new step (new choices, or `picked` cleared).
  const sig = p.choices.join('\u001f');
  const last = useRef({ sig, picked: p.picked });
  if (last.current.sig !== sig || (last.current.picked !== undefined && p.picked === undefined)) fired.current = false;
  last.current = { sig, picked: p.picked };
  const n = p.choices.length;
  const columns = p.columns ?? (n <= 4 ? 2 : 3);
  const ja = Boolean(p.ja) || p.ruby !== undefined;

  const pick = (i: number): void => {
    if (locked || fired.current || i < 0 || i >= n) return;
    fired.current = true;
    p.onPick(i);
  };

  useExerciseKeys({ onChoice: pick });

  return (
    <div
      class="choice-grid"
      role="group"
      aria-label={p.label ?? S.choicesLabel}
      data-columns={columns}
      data-size={p.size ?? 'md'}
      data-locked={locked ? 'true' : undefined}
    >
      {p.choices.map((c, i) => {
        const st = choiceState(i, p.picked, p.correct, Boolean(p.reveal));
        return (
          <button
            key={`${i}:${c}`}
            type="button"
            class="choice"
            data-index={i}
            data-state={st}
            disabled={locked}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            onClick={() => pick(i)}
          >
            {i < 9 ? (
              <kbd class="choice__key" aria-hidden="true">
                {i + 1}
              </kbd>
            ) : null}
            <span class="choice__text">
              {p.ruby !== undefined ? <Ruby ja={c} mode={p.ruby} /> : ja ? <span lang="ja">{c}</span> : c}
            </span>
            {st !== 'idle' ? (
              <span class="choice__mark" aria-hidden="true">
                {STATE_MARK[st]}
              </span>
            ) : null}
            <span class="choice__sr">{st !== 'idle' ? ` (${STATE_TEXT[st]})` : fill(S.choiceN, { n: i + 1 })}</span>
          </button>
        );
      })}
    </div>
  );
}
