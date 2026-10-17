/**
 * TSUZUKU — 聞き分け Minimal Pair (design 04 §5, Station 3+): the voice says
 * one of two near words (おばさん/おばあさん, きて/きって, かき/かぎ) → A/B.
 *
 *  · The pair: `params.choices` when E hands two surfaces, else
 *    `learn.perceptionJudge(item, pool)` (= `minimalPairPartner`) over the
 *    `params.distractorIds` items, synthesizing a partner when the pool has
 *    none. The display order and — unless `params.answer` names it — the
 *    spoken side are drawn from `rngFor(store.seed(), today, step.id)`.
 *  · Skill stat only (`learn/grading` lists it as ungraded): the result is a
 *    plain `gradeChoice` with the pair's contrast as the miss tag
 *    (`pairTag`: vowel-length / small-kana / voicing, else listening).
 *  · Unlimited replays (counted, forwarded to `onReplay`); after answering,
 *    both words can be played for comparison.
 * Facet `null`; keys `choices`; `needsTts`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import type { ContentItem, ErrorTag, VocabItem } from '@/content/types';
import { perceptionJudge } from '@/learn';
import { services, speak } from '@/shared/audio';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { chance, type Rng, rngFor } from '@/shared/hash';
import { equivalentJa, nearMissKind } from '@/shared/jp';
import type { AttemptResult, StepParams } from '@/shared/session-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { gradeChoice, voicingSlip } from '../check';
import { PAIR_WHY, S, fill } from './strings';
import './MinimalPair.css';

export const meta: ExerciseMeta = {
  id: 'minimal-pair',
  facet: null,
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'choices',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function isVocab(i: ContentItem | null | undefined): i is VocabItem {
  return !!i && 'word' in i && 'kana' in i && 'meanings' in i;
}

/** The contrast a pair trains: vowel length, a small kana, voicing, else plain listening. */
export function pairTag(a: string, b: string): ErrorTag {
  const k = nearMissKind(a, b);
  if (k === 'vowel-length') return 'vowel-length';
  if (k === 'small-kana') return 'small-kana';
  if (voicingSlip(a, b)) return 'voicing';
  return 'listening';
}

export interface Pair {
  /** Two kana surfaces in display order. */
  choices: [string, string];
  /** Index of the spoken word. */
  target: number;
  tag: ErrorTag;
}

/**
 * Resolves the pair for a step. `lookup` resolves `params.distractorIds`
 * to vocab items for the partner search; `rng` draws the display order and
 * the spoken side (unless `params.answer` names it).
 */
export function pairFor(item: ContentItem | null, params: StepParams, lookup: (id: string) => ContentItem | undefined, rng: Rng): Pair | null {
  let a: string;
  let b: string;
  if (params.choices && params.choices.length >= 2 && params.choices[0] && params.choices[1]) {
    a = params.choices[0];
    b = params.choices[1];
  } else if (isVocab(item)) {
    const pool = (params.distractorIds ?? []).map(lookup).filter(isVocab);
    [a, b] = perceptionJudge(item, pool).minimalPair;
  } else return null;
  if (equivalentJa(a, b)) return null;
  const swap = chance(rng, 0.5);
  const choices: [string, string] = swap ? [b, a] : [a, b];
  let target: number;
  if (params.answer) {
    const idx = choices.findIndex((c) => equivalentJa(c, params.answer as string));
    target = idx >= 0 ? idx : 0;
  } else if (isVocab(item) && !params.choices) {
    // the item's own word is the spoken one half the time, so the partner is heard too
    const own = choices.findIndex((c) => equivalentJa(c, item.kana));
    target = chance(rng, 0.5) ? own : 1 - own;
  } else target = chance(rng, 0.5) ? 0 : 1;
  return { choices, target, tag: pairTag(a, b) };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function MinimalPair(p: ExerciseProps): JSX.Element {
  const { step, item } = p;
  const pair = useMemo(() => pairFor(item, step.params, (id) => content.get(id), rngFor(store.seed(), store.today(), step.id, 'minimal-pair')), [item, step.id, step.params]);
  const hasVoice = services.audio.hasJaVoice.value;

  const [playing, setPlaying] = useState(false);
  const [plays, setPlays] = useState(0);
  const [replays, setReplays] = useState(0);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const startedAt = useRef<number | null>(null);
  const live = useRef({ playing, replays, picked, result });
  live.current = { playing, replays, picked, result };
  const stepRef = useRef(step.id);

  const say = async (kana: string): Promise<void> => {
    const id = step.id;
    setPlaying(true);
    try {
      await speak(kana, { kana });
    } finally {
      if (stepRef.current === id) setPlaying(false);
    }
  };

  const playTarget = async (): Promise<void> => {
    if (!pair) return;
    await say(pair.choices[pair.target]);
    setPlays((n) => n + 1);
    if (startedAt.current === null) startedAt.current = store.now();
  };

  useEffect(() => {
    stepRef.current = step.id;
    startedAt.current = null;
    setPlaying(false);
    setPlays(0);
    setReplays(0);
    setPicked(undefined);
    setResult(null);
    void playTarget();
    return () => {
      services.audio.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  const replay = (): void => {
    const s = live.current;
    if (s.result || s.playing || !pair) return;
    setReplays(s.replays + 1);
    p.onReplay();
    void playTarget();
  };

  const pick = (i: number): void => {
    const s = live.current;
    if (s.result || s.picked !== undefined || !pair || i < 0 || i > 1) return;
    const ms = Math.max(0, store.now() - (startedAt.current ?? store.now()));
    const r = gradeChoice(i, pair.target, { ms, replays: s.replays, missTags: [pair.tag], answer: pair.choices[pair.target] });
    setPicked(i);
    setResult(r);
    p.onResult(r);
  };

  const continueEmpty = (): void => {
    if (live.current.result) return;
    const r = gradeChoice(0, 0, { ms: 0 });
    setPicked(0);
    setResult(r);
    p.onResult(r);
  };

  // One handler set: the frame uses the latest registration, so digits are
  // routed here (same guard as the grid's own pick) alongside Space.
  useExerciseKeys({ onReplay: replay, onChoice: pick });

  if (!pair) {
    return (
      <div class="pair" data-feel={p.feel}>
        <p class="pair__note" role="status">
          {S.skillNote}
        </p>
        {!result ? (
          <button type="button" class="hanko" onClick={continueEmpty}>
            {S.continue}
          </button>
        ) : null}
      </div>
    );
  }

  const why = PAIR_WHY[pair.tag] ?? S.pairWhyOther;

  return (
    <div class="pair" data-feel={p.feel} data-done={result ? 'true' : undefined}>
      <p class="pair__prompt">{S.pairPrompt}</p>

      <div class="pair__player status-window">
        <button
          type="button"
          class="pair__play"
          onClick={replay}
          disabled={playing || result !== null}
          aria-keyshortcuts="Space"
          aria-label={plays === 0 ? S.play : S.replay}
        >
          <span class="pair__play-icon" aria-hidden="true">
            {playing ? '…' : '▶'}
          </span>
          {playing ? S.playing : S.replay}
        </button>
        {!hasVoice ? (
          <p class="pair__novoice" role="status">
            {S.noVoice}
            <span lang="ja" class="pair__shown">
              {pair.choices[pair.target]}
            </span>
          </p>
        ) : null}
      </div>

      <ChoiceGrid choices={[...pair.choices]} onPick={pick} picked={picked} correct={result ? pair.target : undefined} columns={2} ja size="lg" label={S.pairGroupLabel} />

      {result ? (
        <div class="pair__result" data-kind={result.correct ? 'correct' : 'wrong'} role="status">
          <p class="pair__line">{result.correct ? S.pairCorrect : S.pairMiss}</p>
          <p class="pair__why">{why}</p>
          <div class="pair__compare" role="group" aria-label={S.compareLabel}>
            {pair.choices.map((k) => (
              <button key={k} type="button" class="btn btn--ghost btn--sm" lang="ja" disabled={playing} aria-label={fill(S.hearOption, { kana: k })} onClick={() => void say(k)}>
                ▶ {k}
              </button>
            ))}
          </div>
          <p class="pair__skill">{S.skillNote}</p>
        </div>
      ) : null}
    </div>
  );
}
