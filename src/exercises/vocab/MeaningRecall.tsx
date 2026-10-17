/**
 * TSUZUKU — 意味想起 Meaning Recall (design 04 §2): the word (furigana per
 * mode, fog tap = hint; the frame's `?` / Hint button shows the reading under
 * the word while it is hidden, the same hint) plus audio → type the English. Fuzzy: any entry of
 * `meanings` / `params.accept`, articles and "to" stripped, Levenshtein ≤ 1
 * on ≥ 5 chars, ≤ 2 on ≥ 9 (`<TextAnswer mode="en">`). A miss offers
 * 「I meant that」: the override is reported as `correct: true, selfRating: 3`
 * (`gradeEn`), so the writer logs it and the Judge can sample it next time.
 * Speed never touches this drill (free English typing). After answering:
 * pitch line, collocations, and from Station 34 the J-J definition with the
 * English behind a tap (the widget's own English reveal is then suppressed).
 * The default receptive exercise at every level from Station 4.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { gradeEn } from '../check';
import { S as X } from '../strings';
import { MissingItem, missingResult, useDrillKeys, useLatency } from '../kana/KanaFlash';
import { Speaker, VocabAfter, WordHead, isVocabItem, readingHidden, speakWord } from './MeaningGuard';
import { S } from './strings';
import './vocab.css';

export const meta: ExerciseMeta = {
  id: 'meaning-recall',
  facet: 'rec',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'text',
};

/** Accepted English glosses: `params.answer`, `params.accept`, then the item's `meanings`, deduped. */
export function acceptEn(meanings: readonly string[], params: { answer?: string; accept?: string[] }): string[] {
  const out: string[] = [];
  for (const m of [params.answer ?? '', ...(params.accept ?? []), ...meanings]) {
    const t = m.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

export function MeaningRecall(p: ExerciseProps): JSX.Element {
  return <MeaningRecallBody key={p.step.id} {...p} />;
}

function MeaningRecallBody(p: ExerciseProps): JSX.Element {
  const item = isVocabItem(p.item) ? p.item : null;
  const ms = useLatency(p.step.id);
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [replays, setReplays] = useState(0);
  const replaysRef = useRef(0);
  const hinted = useRef(false);
  const [hintTaken, setHintTaken] = useState(false);
  const [readingShown, setReadingShown] = useState(false);
  const fired = useRef(false);
  const accept = item ? acceptEn(item.meanings, p.step.params) : [];
  const jjReveal = p.jj && item?.definitionJa !== undefined;

  useEffect(() => {
    if (item) void speakWord(item);
  }, [item]);

  const replay = (): void => {
    if (fired.current || !item) return;
    replaysRef.current += 1;
    setReplays(replaysRef.current);
    void speakWord(item);
    p.onReplay();
  };
  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  /** A fogged reading tapped open: the hint is taken (Hard ceiling). */
  const reveal = (): void => {
    if (hinted.current || fired.current) return;
    hinted.current = true;
    setHintTaken(true);
    p.onHint();
  };
  /** The frame's `?` / Hint button: show the reading under the word — the same hint as a fog tap. */
  const showReading = (): void => {
    if (hinted.current || fired.current) return;
    setReadingShown(true);
    reveal();
  };
  const canShowReading = !!item && !hintTaken && done === null && readingHidden(item, p.furigana);
  useDrillKeys(root, { onReplay: replay, onHint: canShowReading ? showReading : undefined });

  const submit = (r: TextAnswerResult): void => {
    const g = gradeEn(r.given, accept, { ms: ms(), hintUsed: hinted.current, replays: replaysRef.current, override: r.override, missTags: ['word-choice'] });
    finish(g);
  };

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  return (
    <div class="drill meaning-recall" data-exercise="meaning-recall" ref={root}>
      <p class="drill__prompt">{X.typeMeaning}</p>
      <WordHead item={item} mode={p.furigana} onReveal={reveal} kana={readingShown} />
      <div class="drill__row drill__row--between">
        <Speaker onClick={replay} disabled={done !== null} replays={replays} />
        <span class="drill__hint">{S.replayHint}</span>
      </div>

      <TextAnswer mode="en" accept={accept} autoFocus label={X.englishField} reveal={!jjReveal} onSubmit={submit} />

      {done ? <VocabAfter item={item} correct={done.correct ? (done.selfRating !== undefined ? 'near' : 'true') : 'false'} jj={p.jj} furigana={p.furigana} meaning={jjReveal} /> : null}
    </div>
  );
}
