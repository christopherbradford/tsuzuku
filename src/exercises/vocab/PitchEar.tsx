/**
 * TSUZUKU — 高低の耳 Pitch Ear (design 04 §2): the voice says the word → pick
 * its contour among 平板 / 頭高 / 中高 / 尾高 drawn as glyphs (keys 1–4, Space
 * replays). Exact; a miss is tagged `pitch`. Only words whose
 * `pitchConfidence` is `high` get a card; the pattern is drawn from the
 * dataset value and the copy never claims the TTS proves it. After the
 * answer the word's own pitch line is shown, and — minimal-pair rounds, 雨
 * or 飴 — a loaded homophone with a different pitch is drawn beside it as
 * the contrast (`pitchPairPool`: the planner's `params.distractorIds` first,
 * when it set them, then the item's own `confusables`, so a planner list that
 * holds no pitch homophone still falls back to the item's own pairs).
 * `params.choices` may carry the four labels in the planner's order (kanji
 * names, as `session/builder.PITCH_PATTERNS`); `params.answer` is one of them.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import type { VocabItem } from '@/content/types';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { equivalentJa } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { PITCH_TYPES, PitchGlyph, PitchLine, pitchType, type PitchType } from '../PitchLine';
import { gradePitch } from '../check';
import { PITCH_TYPE_LABEL, S as X } from '../strings';
import { MissingItem, missingResult, useLatency } from '../kana/KanaFlash';
import { Speaker, WordHead, isVocabItem, speakWord } from './MeaningGuard';
import { S } from './strings';
import './vocab.css';

export const meta: ExerciseMeta = {
  id: 'pitch-ear',
  facet: 'pitch',
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'choices',
};

/** A planner label (平板 / Flat / heiban …) → pitch type, or `null`. */
export function pitchTypeOfLabel(label: string): PitchType | null {
  const l = label.trim().toLowerCase();
  for (const t of PITCH_TYPES) {
    const lab = PITCH_TYPE_LABEL[t];
    if (l === t || l === lab.ja || l === lab.en.toLowerCase()) return t;
  }
  return null;
}

/** The four choices in the planner's order when `params.choices` names them all, else the canonical order. */
export function pitchChoiceTypes(params: StepParams): PitchType[] {
  const given = (params.choices ?? []).map(pitchTypeOfLabel);
  if (given.length === 4 && given.every((t): t is PitchType => t !== null) && new Set(given).size === 4) return given;
  return [...PITCH_TYPES];
}

/**
 * The loaded vocab the contrast is drawn from: the planner's
 * `params.distractorIds` first (its homophone picks win), then the item's
 * `confusables`; deduped, unloaded ids dropped.
 */
export function pitchPairPool(item: VocabItem, params: StepParams): VocabItem[] {
  const ids = Array.from(new Set([...(params.distractorIds ?? []), ...(item.confusables ?? [])]));
  return ids.map((id) => content.get(id)).filter(isVocabItem);
}

/** A homophone with a different, dataset-backed pitch — the 雨 / 飴 contrast. */
export function minimalPairOf(item: VocabItem, pool: readonly VocabItem[]): VocabItem | null {
  return pool.find((v) => v.id !== item.id && v.pitch !== undefined && v.pitch !== item.pitch && equivalentJa(v.kana, item.kana)) ?? null;
}

export function PitchEar(p: ExerciseProps): JSX.Element {
  return <PitchEarBody key={p.step.id} {...p} />;
}

type PickState = 'idle' | 'correct' | 'wrong' | 'missed';

function PitchEarBody(p: ExerciseProps): JSX.Element {
  const item = isVocabItem(p.item) && p.item.pitch !== undefined ? p.item : null;
  const ms = useLatency(p.step.id);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [replays, setReplays] = useState(0);
  const replaysRef = useRef(0);
  const fired = useRef(false);
  const types = useMemo(() => pitchChoiceTypes(p.step.params), [p.step.params]);
  const correctType = item ? pitchType(item.kana, item.pitch ?? 0) : null;
  const correctIdx = correctType ? types.indexOf(correctType) : -1;
  const pair = useMemo(() => (item ? minimalPairOf(item, pitchPairPool(item, p.step.params)) : null), [item, p.step.params]);

  const play = (): void => {
    if (item) void speakWord(item);
  };
  useEffect(() => {
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const replay = (): void => {
    if (fired.current || !item) return;
    replaysRef.current += 1;
    setReplays(replaysRef.current);
    play();
    p.onReplay();
  };

  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  const pick = (i: number): void => {
    if (fired.current || i < 0 || i >= types.length) return;
    setPicked(i);
    const r = gradePitch(i, correctIdx, { ms: ms(), replays: replaysRef.current });
    const t = types[i] as PitchType;
    r.answer = PITCH_TYPE_LABEL[t].ja;
    finish(r);
  };

  useExerciseKeys({ onChoice: pick, onReplay: replay });

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  const state = (i: number): PickState => {
    if (picked === null) return 'idle';
    if (picked === i) return i === correctIdx ? 'correct' : 'wrong';
    return i === correctIdx ? 'missed' : 'idle';
  };

  return (
    <div class="drill pitch-ear" data-exercise="pitch-ear" data-correct-index={correctIdx}>
      <p class="drill__prompt">{X.choosePitch}</p>
      <WordHead item={item} mode={p.furigana} kana />
      <div class="drill__row drill__row--between">
        <Speaker onClick={replay} disabled={done !== null} replays={replays} />
        <span class="drill__hint">{S.replayHint}</span>
      </div>

      <div class="pitch-choices" role="group" aria-label={S.pitchChoicesLabel} data-locked={done ? 'true' : undefined}>
        {types.map((t, i) => {
          const st = state(i);
          return (
            <button
              key={t}
              type="button"
              class="pitch-choice"
              data-type={t}
              data-state={st}
              disabled={done !== null}
              aria-keyshortcuts={String(i + 1)}
              aria-label={`${PITCH_TYPE_LABEL[t].en} (${PITCH_TYPE_LABEL[t].ja})`}
              onClick={() => pick(i)}
            >
              <kbd class="pitch-choice__key" aria-hidden="true">
                {i + 1}
              </kbd>
              <PitchGlyph type={t} label />
              {st !== 'idle' ? (
                <span class="pitch-choice__mark" aria-hidden="true">
                  {st === 'wrong' ? '×' : '○'}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {done ? (
        <div class="drill__after pitch-contrast" data-correct={done.correct ? 'true' : 'false'}>
          <div class="pitch-contrast__row">
            <span class="drill__ja" lang="ja">
              {item.word}
            </span>
            <PitchLine kana={item.kana} pitch={item.pitch ?? 0} />
            <span>{item.meanings[0]}</span>
          </div>
          {pair ? (
            <>
              <span class="drill__label">{S.pitchContrast}</span>
              <div class="pitch-contrast__row" data-pair={pair.id}>
                <span class="drill__ja" lang="ja">
                  {pair.word}
                </span>
                <PitchLine kana={pair.kana} pitch={pair.pitch ?? 0} />
                <span>{pair.meanings[0]}</span>
              </div>
            </>
          ) : null}
          <p class="drill__hint">{S.pitchDatasetNote}</p>
          {item.collocations && item.collocations.length > 0 ? (
            <div>
              <span class="drill__label">{X.collocations}</span>
              <ul class="vocab__collocations">
                {item.collocations.slice(0, 3).map((c) => (
                  <li key={c} class="vocab__collocation" lang="ja">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
