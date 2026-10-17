/**
 * TSUZUKU — 対話 Taiwa role-play (design 04 §8 `role-play`, 05 §7 aizuchi / register).
 *
 * Plays a `dialogue` StoryItem as a linear gold script. The NPC lines are
 * spoken by TTS slot `b` (and shown with <Ruby>); the learner plays
 * `learnerSpeaker` and answers each of their lines in one mode:
 *   choose  3–4 options (`StoryLine.options`, else `options.ts` synthesis),
 *           keys 1–4; wrong / ok options show their recast
 *   build   tiles from `tokens` (never the gold order), tap to assemble
 *   type    KanaInput, matched against plain ja ∪ accept ∪ mustInclude +
 *           the register markers (`gradeTyped`), recasts mid-flow
 *   speak   `services.stt` → best of ≤ 5 alternatives (`speaking/scoring`),
 *           graded like Type; falls back to Type when recognition is missing;
 *           a typed failure (mic blocked, network: `sttFailure`) is named
 * Aizuchi slots (`aizuchi.ts`): after a marked NPC line the learner must
 * backchannel by chip within the belt's window; the NPC pauses visibly, then
 * continues. A miss is tagged `aizuchi` only from Green. Register switching:
 * a line's `registerTarget` re-targets every later learner line (tag
 * `register`). Debrief: best / aizuchi counts, a register meter and the
 * explicit corrections. Emits `roleplay:done`.
 *
 * Export convention (D): `meta` + the component. `RolePlay` accepts the
 * standalone props OR `ExerciseProps` (`params.storyId`, `params.mode`,
 * `params.registerTarget`): `registerExercise(meta, RolePlay)`.
 * Deterministic: options / tiles draw from `rngFor(seed, today, storyId, line)`;
 * time from `store.now()`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import { toPlain } from '@/content/ruby';
import type { Belt, CardKey, ErrorTag, RegisterTag, StoryItem } from '@/content/types';
import { recordImplicit } from '@/learn/apply';
import { sttFailure } from '@/audio';
import { SPEED_TIER_RATES, services, sfx, speak } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { normalizeJa } from '@/shared/jp';
import type { AttemptResult } from '@/shared/session-types';
import type { Feel, FuriganaMode, Rating } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { KanaInput } from '@/shared/ui/KanaInput';
import { Ruby } from '@/shared/ui/Ruby';
import { TAG_LABEL } from '@/shared/ui/strings';
import { store } from '@/store';
import { bandFor, implicitProdGrades, scoreRecognition } from '../speaking/scoring';
import { aizuchiChips, aizuchiRegisterOf, scoreSlot, windowMs, type AizuchiRegister, type SlotScore } from './aizuchi';
import { buildTiles, chooseOptions, type DialogueOption } from './options';
import { registerFor } from './register';
import {
  AIZUCHI_PAUSE_MS,
  SPEAK_MAX_MS,
  IMPLICIT_WINDOW_DAYS,
  isStoryItem,
  outcomeFromBuild,
  outcomeFromOption,
  outcomeFromTyped,
  resolveLearnerSpeaker,
  summarize,
  turnPlan,
  type LineOutcome,
  type RolePlayResult,
  type SlotOutcome,
  type TaiwaMode,
  type Turn,
} from './role-play-logic';
import { MODE_LABEL, REGISTER_LABEL, S, fill } from './strings';
import './RolePlay.css';

export const meta: ExerciseMeta = {
  id: 'role-play',
  facet: null,
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'choices',
};

export type { TaiwaMode, Turn, LineKind, LineOutcome, SlotOutcome, RolePlayResult } from './role-play-logic';
export {
  AIZUCHI_PAUSE_MS,
  SPEAK_MAX_MS,
  IMPLICIT_WINDOW_DAYS,
  isStoryItem,
  resolveLearnerSpeaker,
  registerTargets,
  turnPlan,
  outcomeFromOption,
  outcomeFromTyped,
  outcomeFromBuild,
  tokenReadings,
  kanaVariant,
  gradeTypedKanaAware,
  summarize,
} from './role-play-logic';

/* ────────────────────────────────────────────────────────────────────────── */
/* Props                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RolePlayProps {
  storyId: string;
  mode: TaiwaMode;
  registerTarget?: RegisterTag;
  onDone(r: RolePlayResult): void;
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'get' | 'getAsync'>;
  /** Logged on implicit grades; default `taiwa:<storyId>`. */
  sessionId?: string;
  /** TTS rate; default the learner's speed tier preset. */
  rate?: number;
}

interface PlayProps extends RolePlayProps {
  story?: StoryItem;
  feel?: Feel;
  furigana?: FuriganaMode;
  /** Session path: the runner applies `implicit`; the component then never writes cards itself. */
  onResult?(r: AttemptResult): void;
  onReplay?(): void;
}

type Phase = 'intro' | 'npc' | 'slot' | 'learner' | 'feedback' | 'debrief';

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function RolePlay(p: RolePlayProps | ExerciseProps): JSX.Element {
  if ('step' in p) {
    const params = p.step.params;
    const storyId = params.storyId ?? p.step.itemId ?? '';
    const mode: TaiwaMode = params.mode === 'build' || params.mode === 'type' || params.mode === 'speak' ? params.mode : 'choose';
    const story = isStoryItem(p.item) && p.item.id === storyId ? p.item : undefined;
    return (
      <Play
        key={storyId}
        storyId={storyId}
        mode={mode}
        registerTarget={params.registerTarget}
        rate={params.rate ?? SPEED_TIER_RATES[p.speedTier]}
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
  return <Play key={p.storyId} {...p} />;
}

function Play(p: PlayProps): JSX.Element {
  const loader = p.loader ?? content;
  const settings = store.settings.value;
  const furigana = p.furigana ?? settings.furigana;
  const feel = p.feel ?? settings.feel;
  const belt: Belt = store.profile.value.belt;
  const station = store.progress.value.station;
  const rate = p.rate ?? SPEED_TIER_RATES[settings.speedTier];
  const sessionId = p.sessionId ?? `taiwa:${p.storyId}`;
  const sttOk = services.stt.available;
  const mode: TaiwaMode = p.mode === 'speak' && !sttOk ? 'type' : p.mode;

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
  const learner = story ? resolveLearnerSpeaker(story) : null;
  const initialRegister: RegisterTag = p.registerTarget ?? story?.register ?? 'polite';
  const plan = useMemo<Turn[]>(() => (story && learner ? turnPlan(story, learner, initialRegister) : []), [story, learner, initialRegister]);
  const npcName = useMemo(() => lines.find((l) => l.speaker && l.speaker !== learner)?.speaker ?? '', [lines, learner]);

  const [phase, setPhase] = useState<Phase>('intro');
  const [cursor, setCursor] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [showEn, setShowEn] = useState(station < 16);
  const [outcomes, setOutcomes] = useState<LineOutcome[]>([]);
  const [slots, setSlots] = useState<SlotOutcome[]>([]);
  const [slotNote, setSlotNote] = useState<string | null>(null);
  const [built, setBuilt] = useState<number[]>([]);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [stt, setStt] = useState<'idle' | 'listening' | 'none'>('idle');
  /** The recognizer's typed failure (mic blocked, network…) in place of "nothing heard". */
  const [sttNote, setSttNote] = useState<string | null>(null);
  const [typeFallback, setTypeFallback] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [result, setResult] = useState<RolePlayResult | null>(null);

  const run = useRef(0);
  const slotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotOpenedAt = useRef(0);
  const turnStart = useRef(0);
  const outcomesRef = useRef<LineOutcome[]>([]);
  const slotsRef = useRef<SlotOutcome[]>([]);
  const finished = useRef(false);

  useEffect(
    () => () => {
      run.current++;
      if (slotTimer.current) clearTimeout(slotTimer.current);
      services.audio.cancel();
      services.stt.abort();
    },
    [],
  );

  const line = lines[cursor];
  const turn = plan[cursor];
  const register: RegisterTag = turn?.register ?? initialRegister;
  const aiRegister: AizuchiRegister = registerFor(register) === 'casual' ? 'casual' : story ? aizuchiRegisterOf(story) : 'polite';
  const chips = useMemo(() => aizuchiChips(aiRegister, 4), [aiRegister]);
  const lineRng = (i: number) => rngFor(store.seed(), store.today(), p.storyId, i);
  const options = useMemo<DialogueOption[]>(
    () => (line && turn?.role === 'learner' && mode === 'choose' ? chooseOptions(line, { register, get: (id) => loader.get(id), rng: lineRng(cursor) }) : []),
    [line, turn, mode, register, cursor, loader, p.storyId],
  );
  const tiles = useMemo<string[]>(() => (line && turn?.role === 'learner' && mode === 'build' ? buildTiles(line, lineRng(cursor)) : []), [line, turn, mode, cursor, p.storyId]);

  /* ── flow ─────────────────────────────────────────────────────────────── */

  const speakLine = (i: number, voice: 'a' | 'b'): Promise<boolean> => {
    const l = lines[i];
    if (!l) return Promise.resolve(false);
    const id = ++run.current;
    setSpeaking(true);
    return speak(toPlain(l.ja), { voice, rate, interrupt: true }).then(() => {
      if (run.current !== id) return false;
      setSpeaking(false);
      return true;
    });
  };

  const stepInto = (i: number): void => {
    if (!story) return;
    if (i >= plan.length) {
      finishPlay();
      return;
    }
    setCursor(i);
    const t = plan[i] as Turn;
    // A slot verdict stays up through the learner's next turn; the next partner line clears it.
    if (t.role === 'npc') setSlotNote(null);
    if (t.role === 'learner') {
      turnStart.current = store.now();
      setBuilt([]);
      setTyped('');
      setNote(null);
      setHint(false);
      setStt('idle');
      setHeard(null);
      setTypeFallback(false);
      setPhase('learner');
      return;
    }
    setPhase('npc');
    void speakLine(i, 'b').then((ok) => {
      if (!ok) return;
      if (t.slot) openSlot(i);
      else stepInto(i + 1);
    });
  };

  const openSlot = (i: number): void => {
    setPhase('slot');
    slotOpenedAt.current = store.now();
    if (slotTimer.current) clearTimeout(slotTimer.current);
    slotTimer.current = setTimeout(() => {
      slotTimer.current = null;
      recordSlot(i, null, null);
      setSlotNote(fill(S.aizuchiMissed, { name: lines[i]?.speaker ?? npcName }));
      stepInto(i + 1);
    }, windowMs(belt) + AIZUCHI_PAUSE_MS);
  };

  const recordSlot = (i: number, text: string | null, ms: number | null): SlotScore => {
    const score = scoreSlot(ms, text, aiRegister, belt);
    const o: SlotOutcome = { lineIndex: i, score, text, ms };
    slotsRef.current = [...slotsRef.current, o];
    setSlots(slotsRef.current);
    return score;
  };

  const answerSlot = (text: string): void => {
    if (phase !== 'slot') return;
    if (slotTimer.current) clearTimeout(slotTimer.current);
    slotTimer.current = null;
    const ms = Math.max(0, store.now() - slotOpenedAt.current);
    const score = recordSlot(cursor, text, ms);
    sfx(score.hit ? 'correct' : 'wrong');
    setSlotNote(score.hit ? (score.registerOk ? S.aizuchiHit : S.aizuchiOffRegister) : score.late ? S.aizuchiLate : fill(S.aizuchiMissed, { name: npcName }));
    stepInto(cursor + 1);
  };

  const settle = (o: LineOutcome): void => {
    outcomesRef.current = [...outcomesRef.current, o];
    setOutcomes(outcomesRef.current);
    sfx(o.kind === 'wrong' ? 'wrong' : 'correct');
    setPhase('feedback');
  };

  const elapsed = (): number => Math.max(0, store.now() - turnStart.current);

  const pickOption = (i: number): void => {
    if (phase !== 'learner' || mode !== 'choose' || !line) return;
    const opt = options[i];
    if (!opt) return;
    settle(outcomeFromOption(cursor, opt, toPlain(line.ja), elapsed()));
  };

  const tapTile = (i: number): void => {
    if (phase !== 'learner' || mode !== 'build' || built.includes(i) || i < 0 || i >= tiles.length) return;
    setNote(null);
    setBuilt((b) => [...b, i]);
  };

  const submitBuild = (): void => {
    if (phase !== 'learner' || mode !== 'build' || !line) return;
    if (built.length === 0) {
      setNote(S.nothingBuilt);
      return;
    }
    settle(
      outcomeFromBuild(
        cursor,
        built.map((i) => tiles[i] as string),
        line,
        elapsed(),
      ),
    );
  };

  const typing = mode === 'type' || (mode === 'speak' && typeFallback);

  const submitTyped = (value: string): void => {
    if (phase !== 'learner' || !typing || !line) return;
    if (normalizeJa(value).length === 0) {
      setNote(S.nothingTyped);
      return;
    }
    settle(outcomeFromTyped(cursor, value, line, register, elapsed(), hint));
  };

  const startSpeak = (): void => {
    if (phase !== 'learner' || mode !== 'speak' || typing || !line || stt === 'listening') return;
    setStt('listening');
    setHeard(null);
    const id = run.current;
    void services.stt
      .recognize({ maxMs: SPEAK_MAX_MS })
      .then((r) => {
        if (run.current !== id) return;
        if (!r || r.alternatives.length === 0) {
          setSttNote(sttFailure(services.stt)?.label ?? null);
          setStt('none');
          return;
        }
        const rec = scoreRecognition(r.alternatives, { ja: line.ja, kana: line.kana });
        setHeard(rec.best);
        const o = outcomeFromTyped(cursor, rec.best, line, register, elapsed(), hint);
        // A near-perfect recognition that gradeTyped did not accept verbatim still counts as a fine line.
        settle(o.kind === 'wrong' && bandFor(rec.score) === 3 ? { ...o, kind: 'ok', tags: [], registerOk: true } : o);
      })
      .catch(() => {
        if (run.current !== id) return;
        setSttNote(sttFailure(services.stt)?.label ?? null);
        setStt('none');
      });
  };

  const useHint = (): void => {
    if (hint || phase !== 'learner') return;
    setHint(true);
  };

  const finishPlay = (): void => {
    if (finished.current || !story) return;
    finished.current = true;
    const outs = outcomesRef.current;
    const sl = slotsRef.current;
    const r = summarize(outs, sl);
    const tags = new Set<ErrorTag>(outs.flatMap((o) => o.tags));
    if (sl.some((s) => s.score.tag)) tags.add('aizuchi');
    const implicit: { cardKey: CardKey; rating: Rating }[] = [];
    for (const o of outs) {
      const l = lines[o.lineIndex];
      if (!l?.tokenIds || o.kind === 'near') continue;
      implicit.push(...implicitProdGrades(l.tokenIds, (id) => loader.get(id), store.cards, store.today(), o.kind === 'wrong' ? 1 : 3));
    }
    bus.emit('roleplay:done', { storyId: story.id, ...r });
    if (p.onResult) {
      p.onResult({
        correct: r.total > 0 && outs.every((o) => o.kind !== 'wrong'),
        nearMiss: outs.some((o) => o.kind === 'near') && outs.every((o) => o.kind !== 'wrong'),
        hintUsed: outs.some((o) => o.hintUsed),
        guard: false,
        timedOut: false,
        ms: outs.reduce((a, o) => a + o.ms, 0),
        errorTags: Array.from(tags),
        score: r.total > 0 ? r.best / r.total : 0,
        implicit,
      });
    } else {
      for (const g of implicit) recordImplicit({ cardKey: g.cardKey, rating: g.rating, exercise: 'role-play', sessionId, dueWithin: IMPLICIT_WINDOW_DAYS });
    }
    sfx('submit');
    setResult(r);
    setPhase('debrief');
    p.onDone(r);
  };

  const replayNpc = (): void => {
    if (speaking) return;
    const i = turn?.role === 'npc' || phase === 'slot' ? cursor : lastNpcIndex();
    if (i < 0) return;
    p.onReplay?.();
    void speakLine(i, 'b');
  };
  const lastNpcIndex = (): number => {
    for (let i = cursor - 1; i >= 0; i--) if (plan[i]?.role === 'npc') return i;
    return -1;
  };

  useExerciseKeys({
    onChoice: (i) => {
      if (phase === 'slot') {
        const c = chips[i];
        if (c) answerSlot(c);
      } else if (phase === 'learner' && mode === 'choose') pickOption(i);
      else if (phase === 'learner' && mode === 'build') tapTile(i);
    },
    onSubmit: () => {
      if (phase === 'feedback') stepInto(cursor + 1);
      else if (phase === 'learner' && mode === 'build') submitBuild();
      else if (phase === 'intro') stepInto(0);
    },
    onReplay: replayNpc,
  });

  /* ── states ─────────────────────────────────────────────────────────── */

  if (story === undefined) {
    return (
      <div class="taiwa" data-feel={feel}>
        <p class="taiwa__state" role="status">
          {S.loading}
        </p>
      </div>
    );
  }
  if (story === null) {
    return (
      <div class="taiwa" data-feel={feel}>
        <p class="taiwa__state taiwa__state--missing" role="status">
          {S.notFound}
        </p>
      </div>
    );
  }
  if (!learner) {
    return (
      <div class="taiwa" data-feel={feel}>
        <p class="taiwa__state taiwa__state--missing" role="status">
          {S.notDialogue}
        </p>
      </div>
    );
  }

  const header = (
    <header class="taiwa__head">
      <h2 class="taiwa__title">
        <span lang="ja" class="taiwa__title-ja">
          {S.titleJa}
        </span>
        <span>{S.title}</span>
      </h2>
      <div class="taiwa__meta">
        <span class="chip">{fill(S.modeLabel, { mode: MODE_LABEL[mode] })}</span>
        <span class="chip" data-register={register}>
          {fill(S.registerLabel, { register: REGISTER_LABEL[register] })}
        </span>
        <span class="chip taiwa__story-title">{story.titleEn}</span>
      </div>
    </header>
  );

  /* ── intro ──────────────────────────────────────────────────────────── */

  if (phase === 'intro') {
    return (
      <div class="taiwa taiwa--intro" data-feel={feel} data-phase="intro">
        {header}
        <div class="taiwa__card status-window">
          <p class="taiwa__role">
            {fill(S.youPlay, { name: '' })}
            <strong lang="ja">{learner}</strong>
          </p>
          <p class="taiwa__role taiwa__role--partner">
            {fill(S.partner, { name: '' })}
            <strong lang="ja">{npcName}</strong>
          </p>
          <p class="taiwa__hint">{S.introLine}</p>
          {p.mode === 'speak' && !sttOk ? (
            <p class="notice notice--warn taiwa__notice" role="status">
              {S.speakUnavailable}
            </p>
          ) : null}
        </div>
        <div class="taiwa__controls">
          <button type="button" class="hanko" onClick={() => stepInto(0)} aria-keyshortcuts="Enter">
            {S.begin}
          </button>
        </div>
      </div>
    );
  }

  /* ── debrief ────────────────────────────────────────────────────────── */

  if (phase === 'debrief') {
    const r = result ?? summarize(outcomes, slots);
    const slips = outcomes.filter((o) => !o.registerOk).length;
    const corrections = outcomes.filter((o) => o.kind !== 'best');
    const ratio = r.total > 0 ? (r.total - slips) / r.total : 1;
    return (
      <div class="taiwa taiwa--debrief" data-feel={feel} data-phase="debrief">
        {header}
        <div class="taiwa__card status-window" role="status">
          <h3 class="taiwa__subtitle">{S.debriefTitle}</h3>
          <p class="taiwa__result-line">{fill(S.bestLine, { best: r.best, total: r.total })}</p>
          <p class="taiwa__result-line">{r.aizuchiTotal > 0 ? fill(S.aizuchiLine, { hit: r.aizuchiHit, total: r.aizuchiTotal }) : S.noAizuchi}</p>
          <div class="taiwa__meter" role="meter" aria-label={S.registerMeter} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
            <span class="taiwa__meter-label">{S.registerMeter}</span>
            <span class="taiwa__meter-track">
              <span class="taiwa__meter-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </span>
            <span class="taiwa__meter-text">{slips === 0 ? S.registerClean : slips === 1 ? S.registerSlipOne : fill(S.registerSlips, { n: slips })}</span>
          </div>
        </div>
        <section class="taiwa__corrections" aria-label={S.corrections}>
          <h3 class="taiwa__subtitle">{S.corrections}</h3>
          {corrections.length === 0 ? (
            <p class="taiwa__hint">{S.noCorrections}</p>
          ) : (
            <ul class="taiwa__list">
              {corrections.map((o) => (
                <li key={o.lineIndex} class="taiwa__correction" data-kind={o.kind}>
                  <span class="taiwa__label">{S.yours}</span>
                  <span lang="ja" class="taiwa__given">
                    {o.given}
                  </span>
                  <span class="taiwa__label">{S.modelLine}</span>
                  <span class="taiwa__model">
                    <Ruby ja={lines[o.lineIndex]?.ja ?? o.recast} mode={furigana} />
                  </span>
                  {o.tags.length > 0 ? (
                    <span class="taiwa__tags">
                      {o.tags.map((t) => (
                        <span key={t} class="chip chip--tag" data-tag={t}>
                          {TAG_LABEL[t]}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {slots.length > 0 ? (
            <ul class="taiwa__slots" aria-label={S.aizuchiLabel}>
              {slots.map((s) => (
                <li key={s.lineIndex} class="chip" data-hit={s.score.hit ? 'true' : 'false'}>
                  <span lang="ja">{s.text ?? '—'}</span>
                  <span>{s.score.hit ? S.slotHit : s.score.late ? S.slotLate : S.slotMissed}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <p class="taiwa__hint taiwa__closing">{S.closing}</p>
      </div>
    );
  }

  /* ── play ───────────────────────────────────────────────────────────── */

  const npcIdx = turn?.role === 'npc' ? cursor : lastNpcIndex();
  const npcLine = npcIdx >= 0 ? lines[npcIdx] : undefined;
  // The displayed partner line announces a register shift when its target differs from what came before.
  const shiftTo = npcLine?.registerTarget;
  const registerShift = !!shiftTo && (npcIdx === 0 ? initialRegister !== shiftTo : plan[npcIdx - 1]?.register !== shiftTo);
  const last = outcomes[outcomes.length - 1];
  const feedbackLine = phase === 'feedback' && last ? lines[last.lineIndex] : undefined;

  return (
    <div class="taiwa taiwa--play" data-feel={feel} data-phase={phase} data-mode={mode}>
      {header}
      <p class="taiwa__progress">
        {cursor + 1} / {lines.length}
      </p>

      {npcLine ? (
        <div class="taiwa__npc status-window" data-speaking={speaking && phase === 'npc' ? 'true' : undefined} aria-live="polite">
          <div class="taiwa__npc-head">
            <span class="taiwa__speaker" lang="ja">
              {npcLine.speaker}
            </span>
            {registerShift && shiftTo ? <span class="chip chip--accent">{fill(S.registerShift, { register: REGISTER_LABEL[shiftTo] })}</span> : null}
            <button type="button" class="btn btn--ghost btn--sm" onClick={replayNpc} disabled={speaking} aria-keyshortcuts="Space">
              {S.replayLine}
            </button>
            <button type="button" class="btn btn--ghost btn--sm" onClick={() => setShowEn((v) => !v)} aria-pressed={showEn}>
              {showEn ? S.hideEnglish : S.showEnglish}
            </button>
          </div>
          <p class="taiwa__npc-ja">
            <Ruby ja={npcLine.ja} mode={furigana} />
          </p>
          {showEn ? <p class="taiwa__npc-en">{npcLine.en}</p> : null}
          {phase === 'npc' && speaking ? <p class="taiwa__hint">{fill(S.npcSpeaking, { name: npcLine.speaker ?? npcName })}</p> : null}
          {slotNote ? (
            <p class="taiwa__slot-note" role="status">
              {slotNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === 'slot' ? (
        <div class="taiwa__slot" role="group" aria-label={S.aizuchiLabel}>
          <p class="taiwa__prompt">{S.aizuchiPrompt}</p>
          <p class="taiwa__hint">{fill(S.npcWaiting, { name: npcLine?.speaker ?? npcName })}</p>
          <div class="taiwa__chips">
            {chips.map((c, i) => (
              <button key={c} type="button" class="taiwa__chip" lang="ja" aria-label={`${fill(S.aizuchiChipN, { n: i + 1 })}: ${c}`} aria-keyshortcuts={String(i + 1)} onClick={() => answerSlot(c)}>
                <kbd aria-hidden="true">{i + 1}</kbd>
                {c}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {phase === 'learner' && line ? (
        <div class="taiwa__turn">
          <p class="taiwa__prompt">
            <span class="taiwa__label">{S.yourLine}</span>
            <span lang="ja" class="taiwa__you">
              {learner}
            </span>
          </p>
          <p class="taiwa__cue">{fill(S.cue, { en: line.en })}</p>

          {mode === 'choose' ? (
            <>
              <p class="taiwa__hint">{S.choosePrompt}</p>
              <ol class="taiwa__options" aria-label={S.yourLine}>
                {options.map((o, i) => (
                  <li key={o.text}>
                    <button type="button" class="taiwa__option" aria-label={fill(S.optionN, { n: i + 1 })} aria-keyshortcuts={String(i + 1)} onClick={() => pickOption(i)}>
                      <kbd aria-hidden="true">{i + 1}</kbd>
                      <span lang="ja">{o.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {mode === 'build' ? (
            <>
              <p class="taiwa__hint">{S.buildPrompt}</p>
              <div class="taiwa__built" aria-label={S.builtLabel} lang="ja">
                {built.length === 0 ? <span class="taiwa__built-empty" aria-hidden="true">…</span> : null}
                {built.map((i, k) => (
                  <button key={`${i}-${k}`} type="button" class="taiwa__tile taiwa__tile--placed" lang="ja" aria-label={fill(S.removeTile, { tile: tiles[i] ?? '' })} onClick={() => setBuilt((b) => b.filter((x) => x !== i))}>
                    {tiles[i]}
                  </button>
                ))}
              </div>
              <div class="taiwa__tiles" aria-label={S.tilesLabel}>
                {tiles.map((t, i) => (
                  <button key={`${t}-${i}`} type="button" class="taiwa__tile" lang="ja" disabled={built.includes(i)} aria-label={`${fill(S.tileN, { n: i + 1 })}: ${t}`} aria-keyshortcuts={i < 9 ? String(i + 1) : undefined} onClick={() => tapTile(i)}>
                    {i < 9 ? <kbd aria-hidden="true">{i + 1}</kbd> : null}
                    {t}
                  </button>
                ))}
              </div>
              <div class="taiwa__controls">
                <button type="button" class="btn btn--ghost" onClick={() => setBuilt((b) => b.slice(0, -1))} disabled={built.length === 0}>
                  {S.undo}
                </button>
                <button type="button" class="btn btn--ghost" onClick={() => setBuilt([])} disabled={built.length === 0}>
                  {S.clear}
                </button>
                <button type="button" class="hanko" onClick={submitBuild} aria-keyshortcuts="Enter">
                  {S.submit}
                </button>
              </div>
            </>
          ) : null}

          {mode === 'speak' && !typing ? (
            <div class="taiwa__speak">
              <p class="taiwa__hint">{S.speakPrompt}</p>
              <div class="taiwa__controls taiwa__controls--start">
                <button type="button" class="hanko" onClick={startSpeak} disabled={stt === 'listening'} aria-pressed={stt === 'listening'}>
                  {stt === 'listening' ? S.listening : stt === 'none' ? S.tryAgain : S.speak}
                </button>
                <button type="button" class="btn btn--ghost" onClick={() => setTypeFallback(true)}>
                  {S.typeInstead}
                </button>
              </div>
              {stt === 'none' ? (
                <p class="taiwa__note" role="status">
                  {sttNote ?? S.nothingHeard}
                </p>
              ) : null}
            </div>
          ) : null}

          {typing ? (
            <div class="taiwa__type">
              <p class="taiwa__hint">{S.typePrompt}</p>
              <KanaInput key={`${cursor}`} value={typed} onChange={setTyped} onSubmit={submitTyped} autoFocus label={S.typedField} placeholder={S.typedField} />
              <div class="taiwa__controls">
                <button type="button" class="btn btn--ghost btn--sm" onClick={useHint} disabled={hint} aria-pressed={hint}>
                  {S.hint}
                </button>
                <button type="button" class="hanko" onClick={() => submitTyped(typed)}>
                  {S.submit}
                </button>
              </div>
            </div>
          ) : null}

          {(typing || mode === 'speak') && hint ? (
            <p class="taiwa__hint-box" role="status">
              <span lang="ja">{line.mustInclude && line.mustInclude.length > 0 ? fill(S.hintUse, { words: line.mustInclude.join('、') }) : S.hintNone}</span>
              <small>{S.hintCeiling}</small>
            </p>
          ) : null}
          {mode === 'speak' && !typing && !hint ? (
            <button type="button" class="btn btn--ghost btn--sm taiwa__hint-btn" onClick={useHint}>
              {S.hint}
            </button>
          ) : null}
          {note ? (
            <p class="taiwa__note" role="status">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === 'feedback' && last && feedbackLine ? (
        <div class="taiwa__feedback status-window" data-kind={last.kind} role="group" aria-label={S.yourLine}>
          <p class="taiwa__feedback-line">{last.kind === 'best' ? S.best : last.kind === 'ok' ? S.ok : last.kind === 'near' ? S.near : S.wrong}</p>
          {heard ? <p class="taiwa__hint">{fill(S.heard, { text: heard })}</p> : null}
          {last.kind !== 'best' ? (
            <>
              <p class="taiwa__row">
                <span class="taiwa__label">{S.yours}</span>
                <span lang="ja" class="taiwa__given">
                  {last.given}
                </span>
              </p>
              <p class="taiwa__row taiwa__recast">
                <span class="taiwa__label">{S.modelLine}</span>
                <span class="taiwa__model">
                  <Ruby ja={feedbackLine.ja} mode={furigana} />
                </span>
              </p>
            </>
          ) : null}
          {last.tags.length > 0 ? (
            <p class="taiwa__tags">
              {last.tags.map((t) => (
                <span key={t} class="chip chip--tag" data-tag={t}>
                  {TAG_LABEL[t]}
                </span>
              ))}
            </p>
          ) : null}
          <div class="taiwa__controls">
            <button type="button" class="btn btn--ghost" onClick={() => void speakLine(last.lineIndex, 'a')} disabled={speaking}>
              {S.hearModel}
            </button>
            <button type="button" class="hanko" onClick={() => stepInto(cursor + 1)} aria-keyshortcuts="Enter">
              {S.continue}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
