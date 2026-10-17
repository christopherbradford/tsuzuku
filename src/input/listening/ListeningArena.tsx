/**
 * TSUZUKU — 聴解 Listening Arena (design 04 §5 `listening-set`, 03 §2.3 Input).
 *
 * A dialogue or monologue `StoryItem`, AUDIO ONLY, two voice slots (speakers
 * alternate a / b by first appearance) at the step's speed tier:
 *   1. listen      whole text, no transcript; replay budget 2
 *   2. questions   5–8 items, QUESTIONS FIRST: gist questions, then per-line
 *                  choice (meaning ≤ Orange, the Japanese line from Green) and
 *                  dictation (KanaInput, mora similarity, ≥ 0.95 Good ·
 *                  ≥ 0.80 Hard · else Again; second replay caps at Hard)
 *   3. transcript  <Ruby> reveal, karaoke highlight, MANDATORY re-listen +0.1×
 *   4. done        emits `listening:set`; a clean set offers the next tier
 * Listen-facet evidence: a transcribed content word → Good on its `listen`
 * card due within 3 days, a missed one → Again (`result.implicit` in a
 * session; `recordImplicit` standalone). A dictation in the Good band
 * (≥ 0.95, not capped by the replay ceiling) at ≥ 1× writes its plain
 * surface to `profile.dictatedSentence` — the Waveform kakejiku's text; the
 * most recent one wins. Constants, the set builder and the graders live in
 * `./set.ts` and are re-exported here.
 *
 * Export convention (D): `meta` + the component; `ListeningArena` takes the
 * standalone props OR `ExerciseProps` (`params.storyId`, `params.rate`):
 * `registerExercise(meta, ListeningArena)`. Deterministic: the set draws from
 * `rngFor(seed, today, storyId)`; time comes from `store.now()`. The text
 * fallback gates on `voiceAudible` (a voice AND volume > 0), not `hasJaVoice`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { voiceAudible } from '@/audio';
import { content, type ContentLoader } from '@/content/loader';
import { toPlain } from '@/content/ruby';
import type { CardKey, ErrorTag, StoryItem, StoryLine } from '@/content/types';
import { recordImplicit } from '@/learn/apply';
import { SPEED_TIER_RATES, services, sfx, speak } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseMeta, ExerciseProps, FeedbackState } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { containsJapanese, normalizeJa } from '@/shared/jp';
import type { AttemptResult } from '@/shared/session-types';
import type { Feel, FuriganaMode, Rating, SpeedTier } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Feedback } from '@/shared/ui/Feedback';
import { KanaInput } from '@/shared/ui/KanaInput';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { IMPLICIT_WINDOW_DAYS, JA_CHOICES_FROM_STATION, PASS_RATIO, REPLAY_BUDGET, buildListeningSet, gradeDictation, implicitListenGrades, isStoryItem, relistenRate, slotFor, voiceSlots, type ListenItem } from './set';
import { S, fill } from './strings';
import './ListeningArena.css';

export const meta: ExerciseMeta = {
  id: 'listening-set',
  facet: null,
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'choices',
};

export {
  DICTATION_MAX_MORAE,
  IMPLICIT_WINDOW_DAYS,
  JA_CHOICES_FROM_STATION,
  PASS_RATIO,
  RELISTEN_DELTA,
  REPLAY_BUDGET,
  SET_MAX,
  SET_MIN_LINES,
  SET_TARGET,
  buildListeningSet,
  gradeDictation,
  implicitListenGrades,
  isStoryItem,
  relistenRate,
  slotFor,
  voiceSlots,
  type DictationGrade,
  type ListenItem,
  type SetOptions,
} from './set';

/** A dictation counts as "perfect" for `profile.dictatedSentence` at normal speed or faster (≥ 0.95 at 1×, store-types `Profile`). */
export const DICTATED_MIN_RATE = 1;
/* ────────────────────────────────────────────────────────────────────────── */
/* Props                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ListeningArenaResult {
  correct: number;
  total: number;
}

export interface ListeningArenaProps {
  storyId: string;
  /** Playback rate (the learner's speed tier preset, or the step's `params.rate`). */
  rate: number;
  onDone(r: ListeningArenaResult): void;
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'get' | 'getAsync'>;
  /** Logged on implicit grades; default `listen:<storyId>`. */
  sessionId?: string;
}

interface ArenaProps extends ListeningArenaProps {
  story?: StoryItem;
  feel?: Feel;
  furigana?: FuriganaMode;
  /** Session path: the runner applies `implicit`; the Arena then never writes cards itself. */
  onResult?(r: AttemptResult): void;
  onReplay?(): void;
}

type Phase = 'listen' | 'questions' | 'transcript' | 'done';

interface ItemOutcome {
  correct: boolean;
  rating: Rating | null;
  score?: number;
  tags: ErrorTag[];
  feedback: FeedbackState;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function ListeningArena(p: ListeningArenaProps | ExerciseProps): JSX.Element {
  if ('step' in p) {
    const params = p.step.params;
    const storyId = params.storyId ?? p.step.itemId ?? '';
    const rate = params.rate ?? SPEED_TIER_RATES[p.speedTier];
    const story = isStoryItem(p.item) && p.item.id === storyId ? p.item : undefined;
    return (
      <Arena
        key={storyId}
        storyId={storyId}
        rate={rate}
        story={story}
        feel={p.feel}
        furigana={p.furigana}
        sessionId={p.step.id}
        onDone={() => undefined}
        onResult={p.onResult}
        onReplay={p.onReplay}
      />
    );
  }
  return <Arena key={p.storyId} {...p} />;
}

function Arena(p: ArenaProps): JSX.Element {
  const loader = p.loader ?? content;
  const settings = store.settings.value;
  const furigana = p.furigana ?? settings.furigana;
  const feel = p.feel ?? settings.feel;
  const station = store.progress.value.station;
  const inSession = typeof p.onResult === 'function';
  const sessionId = p.sessionId ?? `listen:${p.storyId}`;

  const [story, setStory] = useState<StoryItem | null | undefined>(() => {
    if (p.story) return p.story;
    const it = loader.get(p.storyId);
    return it === undefined ? undefined : isStoryItem(it) ? it : null;
  });
  useEffect(() => {
    if (story !== undefined) return;
    let alive = true;
    loader
      .getAsync(p.storyId)
      .then((it) => {
        if (alive) setStory(isStoryItem(it) ? it : null);
      })
      .catch(() => {
        if (alive) setStory(null);
      });
    return () => {
      alive = false;
    };
  }, [story, loader, p.storyId]);

  const lines = story?.lines ?? [];
  const slots = useMemo(() => voiceSlots(lines), [lines]);
  const items = useMemo<ListenItem[]>(
    () => (story ? buildListeningSet(story, { rng: rngFor(store.seed(), store.today(), story.id), station }) : []),
    [story, station],
  );
  const hasVoice = voiceAudible(services.audio);
  const relisten = relistenRate(p.rate);

  const [phase, setPhase] = useState<Phase>('listen');
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullPlays, setFullPlays] = useState(0);
  const [qi, setQi] = useState(0);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [itemReplays, setItemReplays] = useState(0);
  const [answered, setAnswered] = useState<ItemOutcome | null>(null);
  const [outcomes, setOutcomes] = useState<ItemOutcome[]>([]);
  const [relistened, setRelistened] = useState(false);
  const [showEn, setShowEn] = useState(station < JA_CHOICES_FROM_STATION);
  const [result, setResult] = useState<ListeningArenaResult | null>(null);
  const [tierChoice, setTierChoice] = useState<'offer' | 'kept' | number>('offer');

  const startedAt = useRef(store.now());
  const run = useRef(0);
  const totalReplays = useRef(0);
  const implicit = useRef<{ cardKey: CardKey; rating: Rating }[]>([]);
  const finished = useRef(false);

  useEffect(
    () => () => {
      run.current++;
      services.audio.cancel();
    },
    [],
  );

  /** Speaks `indices` in order at `atRate`; resolves false when superseded or unmounted. */
  const playLines = async (indices: readonly number[], atRate: number): Promise<boolean> => {
    const id = ++run.current;
    setBusy(true);
    for (let k = 0; k < indices.length; k++) {
      if (run.current !== id) return false;
      const i = indices[k] as number;
      const line = lines[i];
      if (!line) continue;
      setSpeakingIdx(i);
      await speak(toPlain(line.ja), { voice: slotFor(line, slots), rate: atRate, interrupt: k === 0 });
    }
    if (run.current !== id) return false;
    setSpeakingIdx(null);
    setBusy(false);
    return true;
  };

  const allIndices = lines.map((_, i) => i);
  const fullReplaysLeft = Math.max(0, REPLAY_BUDGET - Math.max(0, fullPlays - 1));

  const playAll = (): void => {
    if (busy || lines.length === 0) return;
    if (fullPlays > 0) {
      if (fullReplaysLeft <= 0) return;
      totalReplays.current++;
      p.onReplay?.();
    }
    void playLines(allIndices, p.rate).then((ok) => {
      if (ok) setFullPlays((n) => n + 1);
    });
  };

  const item = items[qi];
  const itemLine = item && item.kind !== 'gist' ? lines[item.lineIndex] : undefined;

  // A line item plays its line once when it opens (the learner just tapped Next).
  useEffect(() => {
    if (phase !== 'questions' || !item || item.kind === 'gist' || !hasVoice) return;
    void playLines([item.lineIndex], p.rate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qi]);

  const replayItem = (): void => {
    if (phase !== 'questions' || !item || busy || answered) return;
    if (item.kind === 'gist') {
      playAll();
      return;
    }
    if (itemReplays >= REPLAY_BUDGET) return;
    setItemReplays((n) => n + 1);
    totalReplays.current++;
    p.onReplay?.();
    void playLines([item.lineIndex], p.rate);
  };

  const settle = (o: ItemOutcome): void => {
    setAnswered(o);
    setOutcomes((xs) => [...xs, o]);
    sfx(o.correct ? 'correct' : 'wrong');
  };

  const pickChoice = (i: number): void => {
    if (phase !== 'questions' || !item || answered || item.kind === 'dictation') return;
    const choices = item.kind === 'gist' ? item.q.choices : item.choices;
    const answer = item.kind === 'gist' ? item.q.answer : item.answer;
    if (i < 0 || i >= choices.length) return;
    const correct = i === answer;
    const tags: ErrorTag[] = correct ? [] : ['listening'];
    settle({
      correct,
      rating: null,
      tags,
      feedback: {
        kind: correct ? 'correct' : 'wrong',
        correct: correct ? undefined : choices[answer],
        given: correct ? undefined : choices[i],
        errorTags: tags,
        line: correct ? S.correct : S.wrong,
        rating: null,
        ippon: false,
        kiai: false,
        xpDelta: 0,
      },
    });
  };

  const submitDictation = (value: string): void => {
    if (phase !== 'questions' || !item || item.kind !== 'dictation' || answered || !itemLine) return;
    if (normalizeJa(value).length === 0) {
      setNote(S.nothingTyped);
      return;
    }
    setNote(null);
    const g = gradeDictation(value, itemLine);
    let rating = g.rating;
    if (itemReplays >= REPLAY_BUDGET && rating > 2) rating = 2;
    if (rating === 3 && p.rate >= DICTATED_MIN_RATE) {
      // The Waveform kakejiku's text: the most recent perfect dictation, plain surface (art request, round 2b).
      const plain = toPlain(itemLine.ja);
      store.patch('profile', (pr) => (pr.dictatedSentence === plain ? pr : { ...pr, dictatedSentence: plain }));
    }
    implicit.current.push(...implicitListenGrades(itemLine, value, (id) => loader.get(id), store.cards, store.today()));
    const kind = rating === 3 ? 'correct' : rating === 2 ? 'near' : 'wrong';
    settle({
      correct: g.correct,
      rating,
      score: g.score,
      tags: g.tags,
      feedback: {
        kind,
        correct: itemLine.ja,
        given: value,
        diff: g.diff,
        errorTags: g.tags,
        why: fill(S.scoreLine, { pct: Math.round(g.score * 100) }),
        line: kind === 'correct' ? S.correct : kind === 'near' ? S.near : S.wrong,
        rating,
        ippon: false,
        kiai: false,
        xpDelta: 0,
      },
    });
  };

  const next = (): void => {
    if (phase !== 'questions' || !answered) return;
    setAnswered(null);
    setTyped('');
    setNote(null);
    setItemReplays(0);
    if (qi + 1 < items.length) setQi(qi + 1);
    else {
      run.current++;
      services.audio.cancel();
      setBusy(false);
      setSpeakingIdx(null);
      setPhase('transcript');
    }
  };

  const doRelisten = (): void => {
    if (busy || lines.length === 0) return;
    void playLines(allIndices, relisten).then((ok) => {
      if (ok) setRelistened(true);
    });
  };

  const finish = (): void => {
    if (finished.current || !story || (!relistened && hasVoice)) return;
    finished.current = true;
    const correct = outcomes.filter((o) => o.correct).length;
    const total = items.length;
    const ms = Math.max(0, store.now() - startedAt.current);
    const minutes = Math.round((ms / 60000) * 10) / 10;
    const tags = Array.from(new Set(outcomes.flatMap((o) => o.tags)));
    bus.emit('listening:set', { storyId: story.id, correct, total, rate: p.rate, minutes });
    if (p.onResult) {
      p.onResult({
        correct: total > 0 && correct / total >= PASS_RATIO,
        nearMiss: false,
        hintUsed: false,
        guard: false,
        timedOut: false,
        ms,
        errorTags: tags,
        score: total > 0 ? correct / total : 0,
        replays: totalReplays.current,
        implicit: implicit.current.slice(),
      });
    } else {
      for (const g of implicit.current) {
        recordImplicit({ cardKey: g.cardKey, rating: g.rating, exercise: 'listening-set', sessionId, dueWithin: IMPLICIT_WINDOW_DAYS });
      }
    }
    sfx('submit');
    setResult({ correct, total });
    setPhase('done');
    p.onDone({ correct, total });
  };

  useExerciseKeys({
    onChoice: (i) => pickChoice(i),
    onSubmit: () => {
      if (phase === 'questions' && answered) next();
      else if (phase === 'transcript' && relistened) finish();
    },
    onReplay: () => {
      if (phase === 'listen') playAll();
      else if (phase === 'questions') replayItem();
      else if (phase === 'transcript' && !relistened) doRelisten();
    },
  });

  /* ── states ─────────────────────────────────────────────────────────── */

  if (story === undefined) {
    return (
      <div class="arena" data-feel={feel}>
        <p class="arena__state" role="status">
          {S.loading}
        </p>
      </div>
    );
  }
  if (story === null) {
    return (
      <div class="arena" data-feel={feel}>
        <p class="arena__state arena__state--missing" role="status">
          {S.notFound}
        </p>
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div class="arena" data-feel={feel}>
        <p class="arena__state arena__state--missing" role="status">
          {S.noLines}
        </p>
      </div>
    );
  }

  const speakerName = (l: StoryLine): string => l.speaker ?? '';
  const voiceCount = slots.size;

  const header = (
    <header class="arena__head">
      <h2 class="arena__title">
        <span lang="ja" class="arena__title-ja">
          {S.titleJa}
        </span>
        <span>{S.title}</span>
      </h2>
      <div class="arena__meta">
        <span class="chip">{fill(S.speedLabel, { rate: p.rate })}</span>
        <span class="chip">{voiceCount > 1 ? fill(S.voicesLabel, { n: voiceCount }) : S.oneVoiceLabel}</span>
        <span class="chip arena__story-title">{story.titleEn}</span>
      </div>
    </header>
  );

  /* ── listen ─────────────────────────────────────────────────────────── */

  if (phase === 'listen') {
    return (
      <div class="arena arena--listen" data-feel={feel} data-phase="listen">
        {header}
        {hasVoice ? (
          <p class="arena__hint">{S.audioOnly}</p>
        ) : (
          <div class="notice notice--warn arena__notice" role="status">
            {services.audio.hasJaVoice.value ? S.volumeOff : S.noVoice}
          </div>
        )}
        <div class="arena__stage status-window" aria-live="polite">
          {hasVoice ? (
            <div class="arena__waves" data-busy={busy ? 'true' : undefined} aria-hidden="true">
              {lines.map((l, i) => (
                <span key={i} class="arena__wave" data-slot={slotFor(l, slots)} data-on={speakingIdx === i ? 'true' : undefined} />
              ))}
            </div>
          ) : (
            <ol class="arena__lines">
              {lines.map((l, i) => (
                <li key={i} class="arena__line" data-slot={slotFor(l, slots)}>
                  {l.speaker ? (
                    <span class="arena__speaker" lang="ja">
                      {speakerName(l)}
                    </span>
                  ) : null}
                  <Ruby ja={l.ja} mode={furigana} />
                </li>
              ))}
            </ol>
          )}
          <p class="arena__progress">{speakingIdx !== null ? fill(S.lineOf, { i: speakingIdx + 1, n: lines.length }) : busy ? S.playing : ''}</p>
        </div>
        <div class="arena__controls">
          {hasVoice ? (
            fullPlays === 0 ? (
              <button type="button" class="hanko" onClick={playAll} disabled={busy} aria-keyshortcuts="Space">
                {busy ? S.playing : S.play}
              </button>
            ) : (
              <button type="button" class="btn" onClick={playAll} disabled={busy || fullReplaysLeft <= 0} aria-keyshortcuts="Space">
                {S.replay}
                <small>{fullReplaysLeft > 0 ? fill(S.replaysLeft, { n: fullReplaysLeft }) : S.noReplaysLeft}</small>
              </button>
            )
          ) : null}
          {fullPlays > 0 || !hasVoice ? (
            <button type="button" class="hanko" onClick={() => setPhase('questions')} disabled={busy}>
              {S.toQuestions}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  /* ── questions ──────────────────────────────────────────────────────── */

  if (phase === 'questions' && item) {
    const prompt = item.kind === 'gist' ? S.gistPrompt : item.kind === 'choice' ? (item.ja ? S.choicePromptJa : S.choicePromptEn) : S.dictationPrompt;
    const choices = item.kind === 'gist' ? item.q.choices : item.kind === 'choice' ? item.choices : [];
    const correctIdx = item.kind === 'gist' ? item.q.answer : item.kind === 'choice' ? item.answer : -1;
    const pickedIdx = answered && item.kind !== 'dictation' ? choices.findIndex((c, i) => (answered.correct ? i === correctIdx : c === answered.feedback.given)) : -1;
    const jaChoices = item.kind === 'choice' ? item.ja : false;
    const itemReplaysLeft = Math.max(0, REPLAY_BUDGET - itemReplays);
    return (
      <div class="arena arena--questions" data-feel={feel} data-phase="questions">
        {header}
        <p class="arena__progress">{fill(S.questionOf, { i: qi + 1, n: items.length })}</p>
        <div class="arena__question">
          <p class="arena__prompt">{prompt}</p>
          {item.kind === 'gist' ? (
            <p class="arena__q" lang={containsJapanese(item.q.q) ? 'ja' : undefined}>
              {containsJapanese(item.q.q) ? <Ruby ja={item.q.q} mode={furigana} /> : item.q.q}
            </p>
          ) : (
            <div class="arena__line-audio">
              <button type="button" class="btn" onClick={replayItem} disabled={busy || !!answered || itemReplaysLeft <= 0 || !hasVoice} aria-keyshortcuts="Space">
                {busy ? S.playing : S.playLine}
                <small>{itemReplaysLeft > 0 ? fill(S.replaysLeft, { n: itemReplaysLeft }) : S.noReplaysLeft}</small>
              </button>
              {item.kind === 'dictation' && itemReplays >= REPLAY_BUDGET && !answered ? <p class="arena__ceiling">{S.secondReplayCeiling}</p> : null}
              {!hasVoice && itemLine ? (
                <p class="arena__fallback-line" lang="ja">
                  <Ruby ja={itemLine.ja} mode={furigana} />
                </p>
              ) : null}
            </div>
          )}
          {item.kind === 'dictation' ? (
            <div class="arena__dictation">
              <KanaInput
                key={`${qi}`}
                value={typed}
                onChange={setTyped}
                onSubmit={submitDictation}
                autoFocus
                disabled={!!answered}
                label={S.typedField}
                placeholder={S.typedField}
              />
              {!answered ? (
                <button type="button" class="hanko arena__submit" onClick={() => submitDictation(typed)}>
                  {S.submit}
                </button>
              ) : null}
              {note ? (
                <p class="arena__note" role="status">
                  {note}
                </p>
              ) : null}
            </div>
          ) : (
            <ol class="arena__choices" aria-label={S.choicesLabel} data-locked={answered ? 'true' : undefined}>
              {choices.map((c, i) => {
                const state = !answered ? 'idle' : i === correctIdx ? (pickedIdx === i ? 'correct' : 'missed') : pickedIdx === i ? 'wrong' : 'idle';
                const ja = jaChoices || containsJapanese(c);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      class="arena__choice"
                      data-state={state}
                      disabled={!!answered}
                      aria-label={fill(S.choiceN, { n: i + 1 })}
                      aria-keyshortcuts={String(i + 1)}
                      onClick={() => pickChoice(i)}
                    >
                      <kbd aria-hidden="true">{i + 1}</kbd>
                      <span class="arena__choice-text" lang={ja ? 'ja' : undefined}>
                        {ja ? <Ruby ja={c} mode={furigana} /> : c}
                      </span>
                      {state === 'correct' || state === 'missed' ? <span class="arena__mark" aria-hidden="true">○</span> : null}
                      {state === 'wrong' ? <span class="arena__mark" aria-hidden="true">×</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {answered ? (
          <div class="arena__feedback">
            <Feedback state={answered.feedback} feel={feel} />
            <button type="button" class="hanko" onClick={next} aria-keyshortcuts="Enter">
              {qi + 1 < items.length ? S.next : S.toTranscript}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  /* ── transcript ─────────────────────────────────────────────────────── */

  if (phase === 'transcript') {
    return (
      <div class="arena arena--transcript" data-feel={feel} data-phase="transcript">
        {header}
        <div class="arena__transcript-head">
          <h3 class="arena__subtitle">{S.transcript}</h3>
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setShowEn((v) => !v)} aria-pressed={showEn}>
            {showEn ? S.hideEnglish : S.showEnglish}
          </button>
        </div>
        <ol class="arena__transcript" aria-live="off">
          {lines.map((l, i) => (
            <li
              key={i}
              class="arena__line"
              data-slot={slotFor(l, slots)}
              data-speaking={speakingIdx === i ? 'true' : undefined}
              aria-current={speakingIdx === i ? 'true' : undefined}
            >
              {l.speaker ? (
                <span class="arena__speaker" lang="ja" aria-label={fill(S.speakerLabel, { name: l.speaker })}>
                  {speakerName(l)}
                </span>
              ) : null}
              <span class="arena__line-ja">
                <Ruby ja={l.ja} mode={furigana} />
              </span>
              {showEn ? <span class="arena__line-en">{l.en}</span> : null}
              {speakingIdx === i ? <span class="sr-only">{S.nowSpeaking}</span> : null}
            </li>
          ))}
        </ol>
        <div class="arena__controls">
          {hasVoice ? (
            <>
              <p class="arena__hint" role="status">
                {relistened ? S.relistenDone : busy ? fill(S.relistening, { rate: relisten }) : S.relistenRequired}
              </p>
              {!relistened ? (
                <button type="button" class="hanko" onClick={doRelisten} disabled={busy} aria-keyshortcuts="Space">
                  {fill(S.relisten, { rate: relisten })}
                </button>
              ) : null}
            </>
          ) : null}
          <button type="button" class={relistened || !hasVoice ? 'hanko' : 'btn'} onClick={finish} disabled={hasVoice && !relistened} aria-keyshortcuts="Enter">
            {S.finish}
          </button>
        </div>
      </div>
    );
  }

  /* ── done ───────────────────────────────────────────────────────────── */

  const r = result ?? { correct: 0, total: items.length };
  const pass = r.total > 0 && r.correct / r.total >= PASS_RATIO;
  const dictationScores = outcomes.map((o) => o.score).filter((s): s is number => typeof s === 'number');
  const clean = r.total > 0 && r.correct === r.total && dictationScores.every((s) => s >= 0.9);
  const tier = settings.speedTier;
  const atTierRate = Math.abs(SPEED_TIER_RATES[tier] - p.rate) < 1e-9;
  const offerTier = !inSession && clean && atTierRate && tier < 5 && tierChoice === 'offer';
  const acceptTier = (): void => {
    const nextTier = Math.min(5, tier + 1) as SpeedTier;
    store.patch('settings', (s) => ({ ...s, speedTier: nextTier }));
    setTierChoice(nextTier);
  };
  return (
    <div class="arena arena--done" data-feel={feel} data-phase="done">
      {header}
      <div class="arena__result status-window" role="status">
        <h3 class="arena__subtitle">{S.resultTitle}</h3>
        <p class="arena__result-line">{fill(S.resultLine, { correct: r.correct, total: r.total, rate: p.rate })}</p>
        <p class="arena__result-note">{pass ? S.resultPass : S.resultMiss}</p>
        {offerTier ? (
          <div class="arena__tier">
            <p>{S.tierOffer}</p>
            <div class="arena__controls">
              <button type="button" class="hanko" onClick={acceptTier}>
                {fill(S.tierAccept, { tier: tier + 1 })}
              </button>
              <button type="button" class="btn btn--ghost" onClick={() => setTierChoice('kept')}>
                {S.tierKeep}
              </button>
            </div>
          </div>
        ) : null}
        {typeof tierChoice === 'number' ? <p class="arena__result-note">{fill(S.tierAccepted, { tier: tierChoice })}</p> : null}
        {!inSession && clean && atTierRate && tier >= 5 ? <p class="arena__result-note">{S.tierTop}</p> : null}
      </div>
    </div>
  );
}
