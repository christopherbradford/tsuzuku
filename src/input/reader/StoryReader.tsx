/**
 * TSUZUKU — 旅日記 Tabi Nikki episode reader (design 04 §7, 05 §2/§4, 03 §2.3).
 *
 * Works as the `story-read` exercise step (ExerciseProps: `params.storyId`,
 * result through `onResult`) and standalone on `#/story/:id` (StoryReaderProps,
 * result through `onDone`). Lines reveal one at a time; each line has TTS
 * (`speak(toPlain(ja), {kana})`, dialogue speakers alternate voice slots),
 * furigana fog from `fog.ts` (a reveal is a hint), tap-gloss on every token
 * (item via `tokenIds` → `loader.get` / `getAsync` → `<Gloss>`; its backdrop
 * covers the page, so closing always returns focus to the tapped token), the English
 * line once the line is behind you, i+1 words marked, vertical text from Blue.
 * A silent `createReadingTimer` measures cpm (paused while hidden). Then
 * `<Comprehension>`; ≥ 2/3 is full credit. On finish:
 *   - a gloss tap on an introduced word graded Hard through `capture.onGlossTap`
 *     only when the card is due today and this is not the first read (05 §4);
 *     "first read" = the episode is absent from `progress.storiesRead` (B's
 *     `story:read` reducer appends it), unless the host passes `firstRead`;
 *   - 「捕まえる」Capture / Bookmark on the gloss writes `store.captured` / `bookmarks`
 *     (vocab only: grammar / kanji tokens show "comes with its station Scroll",
 *     since `intro-policy` routes only `v-` captures into Scrolls);
 *   - Kaiden words read with no gloss tap and ≥ 2/3 log Good on their base
 *     card (`recordImplicit`, 05 §2 "implicit evidence counts");
 *   - `story:read` is emitted once (B grants XP, stats, ledger minutes, the
 *     辞書要らず badge); `ledgerLogged` tells a standalone host whether B's
 *     ledger reducer took the minutes, so nothing is logged twice.
 * Speech is cancelled on unmount (a line must not keep speaking into the
 * next session step). Registered by the F barrel as `story-read` (`meta`).
 * Copy in `./strings.ts`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import { segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import type { CardKey, ContentItem, StoryItem, StoryLine } from '@/content/types';
import { recordImplicit } from '@/learn/apply';
import { services, speak } from '@/shared/audio';
import { bus, type Events } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { cardKey, tryKindOfId } from '@/shared/ids';
import { CardFlag, hasFlag, type Feel, type FuriganaMode } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { knownIds } from '@/store/derived';
import { isCapturableId, isCaptured, onGlossTap } from './capture';
import { Comprehension, passes } from './Comprehension';
import { isPunctToken, storyCoverage } from './coverage';
import { bindVisibility, charCount, cpm as cpmOf, cpmBand, createReadingTimer, levelForStation, type CpmBand } from './cpm';
import { fogPredicate } from './fog';
import { Gloss, type CaptureState } from './Gloss';
import { S, fill } from './strings';
import './reader.css';

export const meta: ExerciseMeta = {
  id: 'story-read',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'none',
};

/** Vertical text toggle is offered from Blue (Station 25, design 04 §13). */
export const VERTICAL_FROM_STATION = 25;
/** J-J reveal is the default from Purple (Station 34, design 04 §2). */
export const JJ_FROM_STATION = 34;
/** 辞書要らず: an episode this long, ≥ 2/3, ≤ 2 gloss taps (design 04 §7). */
export const DICTIONARY_FREE_CHARS = 300;
export const DICTIONARY_FREE_TAPS = 2;

export interface StoryReadResult {
  storyId: string;
  correct: number;
  total: number;
  /** ≥ 2/3 (full credit). */
  passed: boolean;
  cpm: number;
  band: CpmBand;
  chars: number;
  ms: number;
  /** Whole minutes handed to `story:read` (the ledger row). */
  minutes: number;
  glossTaps: number;
  /** Fog readings revealed (hints). */
  hints: number;
  dictionaryFree: boolean;
  /** Kaiden base cards that received an implicit Good. */
  kaidenConfirmed: CardKey[];
  /** B's ledger reducer logged the minutes during the `story:read` emit. */
  ledgerLogged: boolean;
  bridge: boolean;
  /** The episode could not be loaded; nothing was emitted. */
  missing: boolean;
}

export interface StoryReaderProps {
  storyId: string;
  onDone(r: StoryReadResult): void;
  /** Defaults to the live `content` loader (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Logged on implicit grades; default `story:<id>`. */
  sessionId?: string;
  /**
   * First read of this episode: gloss taps never grade Hard. Defaults to
   * "not yet in `progress.storiesRead`" (B appends the id on `story:read`),
   * read once at mount so finishing the episode does not flip it mid-read.
   */
  firstRead?: boolean;
  feel?: Feel;
  furigana?: FuriganaMode;
  jj?: boolean;
  /** Learner station (band, vertical toggle); default `store.progress.station`. */
  station?: number;
  /** A fog reveal (hint) happened. */
  onHint?(): void;
}

export function isStoryItem(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && 'comprehension' in i && Array.isArray(i.lines);
}

/** Exercise-step props (`step` + `onResult`) versus a component's own props. */
export function isExerciseProps<T extends object>(p: T | ExerciseProps): p is ExerciseProps {
  return 'step' in p && 'onResult' in p;
}

/** Station number from a story id (`s-07-1` → 7), else `undefined`. */
export function storyStation(id: string): number | undefined {
  const m = /^s-(\d{2})-/.exec(id);
  return m ? Number(m[1]) : undefined;
}

/** The save records this episode as read (`progress.storiesRead`, written by B's `story:read` reducer). */
export function isStoryRead(storyId: string): boolean {
  return store.progress.peek().storiesRead?.includes(storyId) ?? false;
}

export function isDictionaryFree(chars: number, correct: number, total: number, glossTaps: number): boolean {
  return chars >= DICTIONARY_FREE_CHARS && passes(correct, total) && glossTaps <= DICTIONARY_FREE_TAPS;
}

/** Speaker labels in order of first appearance (dialogue voice slots a/b alternate by speaker). */
export function speakerSlots(lines: readonly StoryLine[]): Map<string, 'a' | 'b'> {
  const out = new Map<string, 'a' | 'b'>();
  for (const l of lines) {
    if (l.speaker && !out.has(l.speaker)) out.set(l.speaker, out.size % 2 === 0 ? 'a' : 'b');
  }
  return out;
}

export interface CardsLike {
  byItem(itemId: string): Partial<Record<'rec' | 'listen' | 'prod' | 'pitch' | 'read' | 'comp' | 'cloze', readonly number[]>>;
}

/**
 * Kaiden-lane base cards of words the story carries that were read with no
 * gloss tap (design 05 §2: a Kaiden word read in context with ≥ 2/3 logs Good).
 */
export function kaidenEvidence(story: StoryItem, tapped: ReadonlySet<string>, cards: CardsLike, resolve: (id: string) => string = (id) => id): CardKey[] {
  const out: CardKey[] = [];
  const seen = new Set<string>();
  for (const line of story.lines) {
    for (const raw of line.tokenIds ?? []) {
      if (!raw) continue;
      const id = resolve(raw);
      if (seen.has(id) || tapped.has(id)) continue;
      seen.add(id);
      const by = cards.byItem(id);
      const facet = by.rec ? 'rec' : by.prod ? 'prod' : null;
      if (!facet) continue;
      const c = by[facet];
      if (c && hasFlag(c[7] ?? 0, CardFlag.kaiden)) out.push(cardKey(id, facet));
    }
  }
  return out;
}

/** The exercise-step view of a finished read. A missing episode is ungraded (`correct`), never a penalty. */
export function toAttemptResult(r: StoryReadResult): AttemptResult {
  return {
    correct: r.missing ? true : r.passed,
    nearMiss: false,
    hintUsed: r.hints > 0,
    guard: false,
    timedOut: false,
    ms: r.ms,
    errorTags: [],
    score: r.total > 0 ? r.correct / r.total : 0,
  };
}

/**
 * The capture button's meaning for a tapped token. Only vocab is capturable:
 * `learn/intro-policy` routes `v-` captures into the next Scroll and skips
 * every other kind, so a grammar point or kanji gets the `station` line.
 */
export function captureStateFor(itemId: string | null, token: string, introduced: boolean): CaptureState {
  if (!itemId) return store.bookmarks.value.includes(token.trim()) ? 'bookmarked' : 'bookmark';
  if (!isCapturableId(itemId)) return 'none';
  if (introduced) return 'introduced';
  if (tryKindOfId(itemId) !== 'vocab') return 'station';
  return isCaptured(itemId) ? 'captured' : 'capture';
}

/* ────────────────────────────────────────────────────────────────────────── */

export function StoryReader(p: StoryReaderProps | ExerciseProps): JSX.Element {
  if (isExerciseProps(p)) {
    const storyId = p.step.params.storyId ?? p.step.itemId ?? '';
    return (
      <StoryReaderView
        key={p.step.id}
        storyId={storyId}
        sessionId={p.step.id}
        feel={p.feel}
        furigana={p.furigana}
        jj={p.jj}
        onHint={p.onHint}
        onDone={(r) => p.onResult(toAttemptResult(r))}
      />
    );
  }
  return <StoryReaderView {...p} />;
}

interface GlossState {
  lineIndex: number;
  tokenIndex: number;
  token: string;
  reading: string;
  itemId: string | null;
  item: ContentItem | null;
  loading: boolean;
  capture: CaptureState;
}

/** Registers reading-phase keys (Enter = next line, Space = replay) with the frame; unmounts with the phase. */
function ReadingKeys(p: { onNext(): void; onReplay(): void }): null {
  useExerciseKeys({ onSubmit: p.onNext, onReplay: p.onReplay });
  return null;
}

export function StoryReaderView(p: StoryReaderProps): JSX.Element {
  const loader = p.loader ?? content;
  const settings = store.settings.value;
  const cardsVersion = store.cards.version.value;
  const learnerStation = p.station ?? store.progress.value.station;
  const furigana = p.furigana ?? settings.furigana;
  const jj = p.jj ?? (settings.jj || learnerStation >= JJ_FROM_STATION);
  // Read once per episode: finishing emits `story:read`, which must not flip the gloss rule mid-read.
  const recorded = useMemo(() => isStoryRead(p.storyId), [p.storyId]);
  const firstRead = p.firstRead ?? !recorded;
  const sessionId = p.sessionId ?? `story:${p.storyId}`;

  const [fetched, setFetched] = useState<StoryItem | null | 'missing'>(() => {
    const it = loader.get(p.storyId);
    return isStoryItem(it) ? it : null;
  });
  const story = fetched === 'missing' ? null : fetched;

  useEffect(() => {
    if (fetched !== null) return;
    let alive = true;
    loader
      .getAsync(p.storyId)
      .then((it) => {
        if (alive) setFetched(isStoryItem(it) ? it : 'missing');
      })
      .catch(() => {
        if (alive) setFetched('missing');
      });
    return () => {
      alive = false;
    };
  }, [fetched, loader, p.storyId]);

  const [phase, setPhase] = useState<'reading' | 'questions'>('reading');
  const [revealed, setRevealed] = useState(1);
  const [showEn, setShowEn] = useState(false);
  const [vertical, setVertical] = useState(settings.verticalText && learnerStation >= VERTICAL_FROM_STATION);
  const [glossTaps, setGlossTaps] = useState(0);
  const [hints, setHints] = useState(0);
  const [gloss, setGloss] = useState<GlossState | null>(null);
  const tapped = useRef(new Set<string>());
  const tappedTokens = useRef(new Set<string>());
  const finished = useRef(false);
  const latest = useRef(p);
  latest.current = p;

  const timer = useMemo(() => createReadingTimer(store.now), []);
  // A line still being spoken must not carry into the next step.
  useEffect(() => () => services.audio.cancel(), []);
  useEffect(() => {
    if (!story || timer.started()) return;
    timer.start();
    const unbind = bindVisibility(timer, document);
    return unbind;
  }, [story, timer]);

  const fog = useMemo(() => fogPredicate(store.cards, furigana), [furigana, cardsVersion]);
  const slots = useMemo(() => speakerSlots(story?.lines ?? []), [story]);
  const coverage = useMemo(() => (story ? storyCoverage(story, knownIds()) : null), [story, cardsVersion]);
  const chars = useMemo(() => (story ? charCount(story.lines) : 0), [story]);
  const rng = useMemo(() => rngFor(store.seed(), store.today(), p.storyId, 'comprehension'), [p.storyId]);

  const listRef = useRef<HTMLOListElement>(null);
  // i+1 and tapped marks on the token spans `<Ruby>` renders (attributes Preact does not manage).
  useEffect(() => {
    const root = listRef.current;
    if (!root || !story) return;
    root.querySelectorAll<HTMLElement>('li[data-line]').forEach((li) => {
      const li_ = Number(li.dataset.line);
      const line = story.lines[li_];
      if (!line) return;
      const plus = new Set((line.plusOne ?? []).map((id) => loader.resolveId(id)));
      li.querySelectorAll<HTMLElement>('.ruby__token[data-token]').forEach((span) => {
        const ti = Number(span.dataset.token);
        const raw = line.tokenIds?.[ti] ?? null;
        const id = raw ? loader.resolveId(raw) : null;
        if (id && plus.has(id)) span.setAttribute('data-plus-one', 'true');
        else span.removeAttribute('data-plus-one');
        if (tappedTokens.current.has(`${li_}:${ti}`)) span.setAttribute('data-tapped', 'true');
      });
    });
  });

  const lines = story?.lines ?? [];
  const n = lines.length;
  const current = Math.min(revealed, n) - 1;

  const speakLine = (i: number): void => {
    const line = lines[i];
    if (!line) return;
    const slot = line.speaker ? slots.get(line.speaker) : undefined;
    void speak(toPlain(line.ja), { kana: line.kana, ...(slot ? { voice: slot } : {}) });
  };

  const next = (): void => {
    if (phase !== 'reading' || !story) return;
    setGloss(null);
    if (revealed < n) setRevealed(revealed + 1);
    else {
      timer.pause();
      setPhase('questions');
    }
  };

  const onReveal = (): void => {
    setHints((h) => h + 1);
    latest.current.onHint?.();
  };

  const onTokenTap =
    (lineIndex: number) =>
    (token: string, index: number): void => {
      const line = lines[lineIndex];
      if (!line || isPunctToken(token)) return;
      const raw = line.tokenIds?.[index] ?? null;
      const itemId = raw ? loader.resolveId(raw) : null;
      const tokenJa = segmentsToTokens(line.ja, line.tokens)[index]?.ja ?? token;
      const reading = toKana(tokenJa);
      setGlossTaps((t) => t + 1);
      tappedTokens.current.add(`${lineIndex}:${index}`);
      let introduced = false;
      if (itemId) {
        tapped.current.add(itemId);
        if (isCapturableId(itemId)) {
          const by = store.cards.byItem(itemId);
          introduced = Object.keys(by).length > 0;
          if (introduced) {
            const base = by.rec ?? by.prod ?? by.comp ?? by.cloze;
            const dueToday = !!base && base[0] <= store.today();
            onGlossTap({ token, itemId, introduced: true, dueWithin3: dueToday && !firstRead, sessionId, exercise: 'story-read' });
          }
        }
      }
      const item = itemId ? (loader.get(itemId) ?? null) : null;
      setGloss({ lineIndex, tokenIndex: index, token, reading, itemId, item, loading: !!itemId && !item, capture: captureStateFor(itemId, token, introduced) });
      if (itemId && !item) {
        loader
          .getAsync(itemId)
          .then((it) => setGloss((g) => (g && g.itemId === itemId ? { ...g, item: it ?? null, loading: false } : g)))
          .catch(() => setGloss((g) => (g && g.itemId === itemId ? { ...g, loading: false } : g)));
      }
    };

  const onCapture = (): void => {
    if (!gloss || (gloss.capture !== 'capture' && gloss.capture !== 'bookmark')) return;
    const out = onGlossTap({ token: gloss.token, itemId: gloss.itemId, introduced: false, dueWithin3: false, sessionId, exercise: 'story-read' });
    const next_: CaptureState = out.kind === 'captured' || out.kind === 'already-captured' ? 'captured' : out.kind === 'bookmarked' || out.kind === 'already-bookmarked' ? 'bookmarked' : gloss.capture;
    setGloss({ ...gloss, capture: next_ });
  };

  const finish = (correct: number, total: number): void => {
    if (finished.current || !story) return;
    finished.current = true;
    const ms = timer.stop();
    const measured = cpmOf(chars, ms);
    const passed = passes(correct, total);
    const kaidenConfirmed: CardKey[] = [];
    if (passed) {
      for (const k of kaidenEvidence(story, tapped.current, store.cards, (id) => loader.resolveId(id))) {
        if (recordImplicit({ cardKey: k, rating: 3, exercise: 'story-read', sessionId })) kaidenConfirmed.push(k);
      }
    }
    const minutes = Math.round(ms / 60_000);
    const payload: Events['story:read'] = { storyId: story.id, mode: 'read', chars, cpm: measured, correct, total, glossTaps, minutes, bridge: story.bridge === true };
    const before = store.ledger.peek().entries.length;
    bus.emit('story:read', payload);
    const ledgerLogged = store.ledger.peek().entries.length > before;
    latest.current.onDone({
      storyId: story.id,
      correct,
      total,
      passed,
      cpm: measured,
      band: cpmBand(measured, levelForStation(learnerStation) ?? 'n5'),
      chars,
      ms,
      minutes,
      glossTaps,
      hints,
      dictionaryFree: isDictionaryFree(chars, correct, total, glossTaps),
      kaidenConfirmed,
      ledgerLogged,
      bridge: story.bridge === true,
      missing: false,
    });
  };

  const skipMissing = (): void => {
    if (finished.current) return;
    finished.current = true;
    latest.current.onDone({
      storyId: p.storyId,
      correct: 0,
      total: 0,
      passed: false,
      cpm: 0,
      band: 'below',
      chars: 0,
      ms: 0,
      minutes: 0,
      glossTaps: 0,
      hints: 0,
      dictionaryFree: false,
      kaidenConfirmed: [],
      ledgerLogged: false,
      bridge: false,
      missing: true,
    });
  };

  if (fetched === 'missing') {
    return (
      <section class="reader" aria-label={S.episodeLabel} data-state="missing">
        <div class="notice notice--warn" role="status">
          <strong>{S.storyMissing}</strong>
          <span>{S.storyMissingHint}</span>
        </div>
        <div>
          <button type="button" class="btn" onClick={skipMissing} data-action="skip">
            {S.resultContinue}
          </button>
        </div>
      </section>
    );
  }
  if (!story) {
    return (
      <section class="reader" aria-label={S.episodeLabel} data-state="loading">
        <p class="reader__hint" role="status">
          {S.storyLoading}
        </p>
      </section>
    );
  }

  const titleMode: FuriganaMode = furigana === 'off' ? 'off' : 'always';
  const allShown = revealed >= n;

  return (
    <section class="reader" aria-label={S.episodeLabel} data-state={phase} data-feel={p.feel ?? settings.feel}>
      <header class="reader__head">
        <h2 class="reader__title" lang="ja">
          <Ruby ja={story.titleJa} mode={titleMode} />
        </h2>
        <p class="reader__title-en">{story.titleEn}</p>
        <ul class="reader__chips" aria-label={S.episodeLabel}>
          <li class="chip">{story.kind === 'dialogue' ? S.dialogueLabel : S.episodeLabel}</li>
          <li class="chip">{S.registerLabel[story.register] ?? story.register}</li>
          {story.bridge ? (
            <li class="chip chip--accent" title={S.bridgeHint} data-field="bridge">
              {S.bridgeChip}
            </li>
          ) : null}
          <li class="chip">{fill(S.charsLabel, { n: chars })}</li>
          {coverage ? (
            <li class="chip" data-field="coverage">
              {fill(S.coverage, { known: coverage.known, total: coverage.total })}
            </li>
          ) : null}
        </ul>
        {story.bridge ? <p class="reader__hint">{S.bridgeHint}</p> : null}
      </header>

      <div class="reader__toolbar">
        <button type="button" class="btn btn--ghost btn--sm" aria-pressed={showEn ? 'true' : 'false'} onClick={() => setShowEn((v) => !v)} data-action="toggle-en">
          {showEn ? S.hideEnglish : S.showEnglish}
        </button>
        {learnerStation >= VERTICAL_FROM_STATION ? (
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            aria-pressed={vertical ? 'true' : 'false'}
            data-action="toggle-vertical"
            onClick={() => {
              const v = !vertical;
              setVertical(v);
              store.patch('settings', (s) => (s.verticalText === v ? s : { ...s, verticalText: v }));
            }}
          >
            {vertical ? S.horizontal : S.vertical}
          </button>
        ) : null}
        <span class="reader__progress" aria-live="polite" data-field="progress">
          {fill(S.readingProgress, { i: Math.min(revealed, n), n })}
        </span>
      </div>
      <p class="reader__hint">{furigana === 'fog' || furigana === 'tap' ? `${S.tapGlossHint} ${S.revealHint}` : S.tapGlossHint}</p>

      <ol ref={listRef} class={vertical ? 'reader__lines reader__lines--vertical' : 'reader__lines'} data-vertical={vertical ? 'true' : undefined}>
        {lines.slice(0, revealed).map((line, i) => {
          const hasTokens = line.tokens.length > 0;
          const enVisible = showEn && (i < current || phase === 'questions');
          const plus = (line.plusOne ?? []).length > 0;
          return (
            <li key={i} class="reader__line" data-line={i} data-current={i === current && phase === 'reading' ? 'true' : undefined} data-plus-one={plus ? 'true' : undefined}>
              {line.speaker ? (
                <span class="reader__speaker" lang="ja">
                  {line.speaker}
                </span>
              ) : null}
              <Ruby
                ja={line.ja}
                mode={furigana}
                fog={fog}
                onReveal={onReveal}
                vertical={vertical}
                class="reader__ja"
                {...(hasTokens ? { tokens: line.tokens, onTokenTap: onTokenTap(i) } : {})}
              />
              {enVisible ? (
                <p class="reader__en" data-field="en">
                  {line.en}
                </p>
              ) : null}
              <div class="reader__line-tools">
                <button type="button" class="btn btn--ghost btn--sm" onClick={() => speakLine(i)} aria-label={S.listenLine} data-action="listen">
                  {S.listenLine}
                </button>
                {plus ? (
                  <span class="chip chip--accent" title={S.plusOneHint} data-field="plus-one">
                    {S.plusOneChip}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {phase === 'reading' ? (
        <div class="reader__toolbar">
          <ReadingKeys onNext={next} onReplay={() => speakLine(current)} />
          <button type="button" class="btn" onClick={next} data-action="next" aria-keyshortcuts="Enter">
            {allShown ? S.finishReading : S.nextLine}
          </button>
          {!allShown ? (
            <button type="button" class="btn btn--ghost" onClick={() => setRevealed(n)} data-action="show-rest">
              {S.showRest}
            </button>
          ) : null}
          {!showEn && current === 0 ? <span class="reader__hint">{S.englishLocked}</span> : null}
        </div>
      ) : (
        <Comprehension questions={story.comprehension} rng={rng} onDone={(r) => finish(r.correct, r.total)} />
      )}

      {gloss ? <Gloss item={gloss.item} token={gloss.token} reading={gloss.reading} jj={jj} loading={gloss.loading} capture={gloss.capture} onCapture={onCapture} onClose={() => setGloss(null)} /> : null}
    </section>
  );
}
