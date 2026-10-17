/**
 * TSUZUKU — comprehension questions after an episode (design 04 §7).
 *
 * ≥ 3 questions from `StoryItem.comprehension` (English through Station 15,
 * Japanese with ruby from 16; the text decides, this component renders both),
 * four choices each, one question at a time: pick → the right answer is shown
 * → next. `onDone({correct, total})` fires once after the last question; the
 * host applies the ≥ 2/3 rule. Choices are shuffled with the host's seeded
 * `rng` so positions cannot be memorised (content order without one).
 *
 * Keys: inside an `<ExerciseFrame>` the frame forwards 1–4 and Enter through
 * `useExerciseKeys`; on a standalone page (no frame) the component listens
 * for the same keys itself. Every control is a real button as well.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComprehensionQuestion } from '@/content/types';
import { shuffle, type Rng } from '@/shared/hash';
import { containsJapanese } from '@/shared/jp';
import { useExerciseFrame, useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { S, fill } from './strings';
import './reader.css';

export interface ComprehensionResult {
  correct: number;
  total: number;
}

export interface ComprehensionProps {
  questions: ComprehensionQuestion[];
  onDone(r: ComprehensionResult): void;
  /** Seeded rng (`rngFor(store.seed(), store.today(), storyId)`); omit to keep content order. */
  rng?: Rng;
  /** Each answer as it lands (index into `questions`). */
  onAnswer?(index: number, correct: boolean): void;
}

export interface PreparedChoice {
  text: string;
  correct: boolean;
}
export interface PreparedQuestion {
  q: string;
  choices: PreparedChoice[];
}

/** Choices tagged with correctness, shuffled when an rng is given. */
export function prepareQuestions(questions: readonly ComprehensionQuestion[], rng?: Rng): PreparedQuestion[] {
  return questions.map((qq) => {
    const choices = qq.choices.map((text, i) => ({ text, correct: i === qq.answer }));
    return { q: qq.q, choices: rng ? shuffle(rng, choices) : choices };
  });
}

/** Full credit at two of three or better (design 04 §7). */
export function passes(correct: number, total: number): boolean {
  return total > 0 && correct / total >= 2 / 3 - 1e-9;
}

const RUBY_RE = /\{[^{}|]+\|[^{}|]+\}/;
const LATIN_RE = /[A-Za-z]/;

/** Japanese text (ruby markup or no Latin letters) renders through `<Ruby>` with `lang="ja"`. */
export function JaOrPlain(p: { text: string; class?: string }): JSX.Element {
  const ja = RUBY_RE.test(p.text) || (containsJapanese(p.text) && !LATIN_RE.test(p.text));
  if (ja) return <Ruby ja={p.text} mode="always" class={p.class} />;
  return <span class={p.class}>{p.text}</span>;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return t.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT';
}

export function Comprehension(p: ComprehensionProps): JSX.Element {
  const prepared = useMemo(() => prepareQuestions(p.questions, p.rng), [p.questions, p.rng]);
  const total = prepared.length;
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const finished = useRef(false);
  const latest = useRef(p);
  latest.current = p;

  const finish = (score: number): void => {
    if (finished.current) return;
    finished.current = true;
    latest.current.onDone({ correct: score, total });
  };

  useEffect(() => {
    if (total === 0) finish(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const current = prepared[index];

  const pick = (i: number): void => {
    if (!current || picked !== null || i < 0 || i >= current.choices.length) return;
    const ok = current.choices[i]?.correct === true;
    setPicked(i);
    if (ok) setCorrect((c) => c + 1);
    latest.current.onAnswer?.(index, ok);
  };

  const advance = (): void => {
    if (picked === null) return;
    if (index + 1 >= total) {
      finish(correct);
      return;
    }
    setIndex(index + 1);
    setPicked(null);
  };

  // Inside a frame the frame forwards keys; outside we listen ourselves.
  useExerciseKeys({ onChoice: (i) => pick(i), onSubmit: () => advance() });
  const frame = useExerciseFrame();
  const handlers = useRef({ pick, advance });
  handlers.current = { pick, advance };
  useEffect(() => {
    if (frame.inFrame) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (e.key >= '1' && e.key <= '4' && e.key.length === 1) {
        e.preventDefault();
        handlers.current.pick(Number(e.key) - 1);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        handlers.current.advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frame.inFrame]);

  if (!current) {
    return (
      <section class="comp" aria-label={S.questionsTitle}>
        <p class="reader__hint">{S.speedNoQuestions}</p>
      </section>
    );
  }

  const pickedOk = picked !== null && current.choices[picked]?.correct === true;
  const answerText = current.choices.find((c) => c.correct)?.text ?? '';
  const last = index + 1 >= total;

  return (
    <section class="comp" aria-label={S.questionsTitle} data-index={index}>
      <div class="comp__meta">
        <span aria-live="polite">{fill(S.questionOf, { i: index + 1, n: total })}</span>
        <span class="comp__score" aria-label={fill(S.questionsScore, { correct, total })}>
          {correct}/{total}
        </span>
      </div>
      <p class="comp__q" data-field="question">
        <JaOrPlain text={current.q} />
      </p>
      <ol class="comp__choices" aria-label={S.questionChoices}>
        {current.choices.map((c, i) => {
          const state = picked === null ? undefined : i === picked ? (c.correct ? 'correct' : 'wrong') : c.correct ? 'answer' : undefined;
          return (
            <li key={`${index}:${i}`}>
              <button
                type="button"
                class="comp__choice"
                data-choice={i}
                data-state={state}
                disabled={picked !== null}
                aria-pressed={picked === i ? 'true' : undefined}
                aria-label={`${fill(S.questionChoiceN, { n: i + 1 })}: ${c.text}`}
                aria-keyshortcuts={String(i + 1)}
                onClick={() => pick(i)}
              >
                <span class="comp__key" aria-hidden="true">
                  {i + 1}
                </span>
                <JaOrPlain text={c.text} />
              </button>
            </li>
          );
        })}
      </ol>
      {picked !== null ? (
        <div class="comp__feedback" data-kind={pickedOk ? 'correct' : 'wrong'} role="status">
          <p>
            <strong>{pickedOk ? S.questionCorrect : S.questionWrong}</strong>
          </p>
          {!pickedOk ? (
            <p>
              {S.questionAnswerWas}: <JaOrPlain text={answerText} />
            </p>
          ) : null}
          <div>
            <button type="button" class="btn" onClick={advance} data-action="advance" aria-keyshortcuts="Enter">
              {last ? S.questionFinish : S.questionNext}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
