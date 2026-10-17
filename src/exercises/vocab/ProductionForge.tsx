/**
 * TSUZUKU — 産出鍛造 Production Forge (design 04 §2): the English gloss plus a
 * context sentence with the word blanked out (the sentence constrains the
 * word choice; the planner rotates it between the item's examples and story
 * lines) → type the Japanese through the IME. Space cycles the kanji
 * candidates (`params.candidates`: the target and its known homophones),
 * Enter submits. Any listed form counts (`acceptForms`: answer, accept,
 * word, kana, altForms). Kana-only is Good through Orange; from Green it is
 * Hard once the word's kanji `read` cards are ≥ 7 d (`params.kanaOnlyPolicy`,
 * else computed here with `kanaOnlyPolicyFor`). A particle slip is a Block
 * tagged `particle`, never a fail. 「Show the first kana」 is a hint.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { toPlain } from '@/content/ruby';
import type { VocabItem } from '@/content/types';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { moraSplit } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import { store } from '@/store';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { acceptForms, attempt, kanaOnlyPolicyFor } from '../check';
import { S as X } from '../strings';
import { MissingItem, missingResult, useDrillKeys, useLatency } from '../kana/KanaFlash';
import { VocabAfter, beltNow, isVocabItem } from './MeaningGuard';
import { S, fill } from './strings';
import './vocab.css';

export const meta: ExerciseMeta = {
  id: 'production-forge',
  facet: 'prod',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

/** `params.kanaOnlyPolicy`, else the belt rule over the word's kanji `read` cards (design 04 §2). */
export function kanaOnlyPolicy(item: VocabItem, params: StepParams): 'good' | 'hard' {
  if (params.kanaOnlyPolicy) return params.kanaOnlyPolicy;
  const stabilities = (item.kanjiIds ?? []).map((kid) => store.cards.get(`${kid}#read`)?.[1]).filter((s): s is number => s !== undefined);
  return kanaOnlyPolicyFor(beltNow(), stabilities);
}

export interface ForgePrompt {
  en: string;
  sentence: string;
  blank: [number, number];
}

/** The gloss line and the context sentence with its blank, from params or the item's first example. */
export function forgePrompt(item: VocabItem, params: StepParams): ForgePrompt {
  const ex = item.examples[0];
  const sentence = params.sentence ?? (ex ? toPlain(ex.ja) : item.word);
  let blank = params.blank;
  if (!blank || blank[1] <= blank[0] || blank[1] > sentence.length) {
    const surface = [item.word, ...(item.altForms ?? []), item.kana].find((s) => s.length > 0 && sentence.includes(s));
    const at = surface ? sentence.indexOf(surface) : -1;
    blank = at >= 0 && surface ? [at, at + surface.length] : [0, 0];
  }
  const en = params.promptEn ?? (ex ? `${item.meanings[0] ?? ''} — ${ex.en}` : (item.meanings[0] ?? ''));
  return { en, sentence, blank };
}

export function ProductionForge(p: ExerciseProps): JSX.Element {
  return <ProductionForgeBody key={p.step.id} {...p} />;
}

function ProductionForgeBody(p: ExerciseProps): JSX.Element {
  const item = isVocabItem(p.item) ? p.item : null;
  const ms = useLatency(p.step.id);
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [firstKana, setFirstKana] = useState(false);
  const fired = useRef(false);
  const accept = acceptForms(item, p.step.params);
  const candidates = p.step.params.candidates ?? (item ? [item.word] : []);
  const policy = item ? kanaOnlyPolicy(item, p.step.params) : 'good';
  const prompt = item ? forgePrompt(item, p.step.params) : null;

  useDrillKeys(root, {});

  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  const hint = (): void => {
    if (firstKana || fired.current) return;
    setFirstKana(true);
    p.onHint();
  };

  const submit = (r: TextAnswerResult): void => {
    finish(attempt({ ms: ms(), correct: r.correct, nearMiss: r.nearMiss, errorTags: r.tags, answer: r.given, hintUsed: firstKana }));
  };

  if (!item || !prompt) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  const [b0, b1] = prompt.blank;
  const hasBlank = b1 > b0;
  const before = hasBlank ? prompt.sentence.slice(0, b0) : prompt.sentence;
  const after = hasBlank ? prompt.sentence.slice(b1) : '';
  const filled = done ? (done.correct ? prompt.sentence.slice(b0, b1) : (done.answer ?? '')) : '';
  const first = moraSplit(item.kana)[0] ?? item.kana;

  return (
    <div class="drill production-forge" data-exercise="production-forge" data-policy={policy} ref={root}>
      <p class="drill__prompt">{X.typeJapanese}</p>
      <p class="drill__prompt forge__gloss-row">
        <span class="drill__label">{S.glossLabel}</span> <span class="forge__gloss">{prompt.en}</span>
      </p>
      <p class="forge__sentence" lang="ja">
        {hasBlank ? (
          <>
            {before}
            <span class="forge__blank" data-filled={done ? 'true' : 'false'} aria-label={S.blankSr}>
              {done ? filled : '＿＿'}
            </span>
            {after}
          </>
        ) : (
          before
        )}
      </p>

      <div class="drill__row drill__row--between">
        <button type="button" class="btn btn--ghost btn--sm" onClick={hint} disabled={firstKana || done !== null}>
          {S.firstKana}
        </button>
        <span class="drill__hint">{policy === 'hard' ? S.kanaOnlyHardNote : S.kanaOnlyNote}</span>
      </div>
      {firstKana ? (
        <p class="drill__hint" role="status">
          {fill(S.firstKanaShown, { kana: first })}
        </p>
      ) : null}

      <TextAnswer mode="ja" accept={accept} candidates={candidates} kanaOnlyPolicy={policy} autoFocus label={X.answerField} onSubmit={submit} />

      {done ? <VocabAfter item={item} correct={done.nearMiss ? 'near' : done.correct ? 'true' : 'false'} jj={p.jj} furigana={p.furigana} meaning={false} /> : null}
    </div>
  );
}
