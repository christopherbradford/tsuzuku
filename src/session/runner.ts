/**
 * TSUZUKU — SessionRunner (design 03 §1–§2, §12; 05 §1, §5; ARCHITECTURE §5).
 *
 * The rep loop: current step → `submit(result)` → `recordAttempt()` (rating,
 * FSRS, facet unlock, promotion, store writes, `attempt:graded`, kiai) →
 * `FeedbackState` → `next()`.
 *
 *  - In-session re-presentation comes from the writer: `stepOffsets` (+3 / +10
 *    on a new card, +3 on a learning miss, +5 relearn on a lapse) become copies
 *    of the step inserted that many reps ahead; the Kiai Recovery queue
 *    (3–8 reps after a clean miss on a non-dummy card) becomes a `recovery`
 *    step. Boss / exam / Kage / arcade plans never re-queue (the fight runs to
 *    completion).
 *  - Scroll steps: a Chikaradameshi pretest is graded with `pretest: true`
 *    (a miss writes nothing); a correct pretest and every `intro` check call
 *    `introduceItem` first. `scroll:completed` fires when the last intro check
 *    of a scroll is answered.
 *  - A snapshot (`store.session`) is saved after every submit, pause and
 *    re-queue, so a closed tab resumes at the next step with its kiai state;
 *    it also carries the active milliseconds so far (`RunnerSnapshot`), and
 *    the tally's minutes are that active time, never the wall clock across a
 *    night. Rooms that never resume (Gatekeeper, Shinsa, Kage) pass
 *    `persist: false` and leave the training snapshot alone.
 *  - Emits `session:started` (fresh runs), `session:finished` with the
 *    `SessionResult`, `session:abandoned`, `weak-point:set-done` per tag of a
 *    completed Weak Point block, `welcome-back:done` for a `welcome` plan.
 *    `kiai:entered` is emitted by the writer. XP: `xpDelta` per step is every
 *    `xp:gained` B emitted during the rep (introduction, attempt, completed
 *    Scroll); session-level XP granted during `session:finished` is folded
 *    into `tally.xp`.
 *  - A Michikusa step has no result: the view calls `next()` when read.
 */
import { signal, type Signal } from '@preact/signals';
import type { CardKey, DrillId, ErrorTag } from '../content/types';
import { content as appContent, type ContentLoader } from '../content/loader';
import { bus } from '../shared/events';
import { resolveExercise, type FeedbackState } from '../shared/exercise-types';
import { rngFor } from '../shared/hash';
import { diffChars } from '../shared/jp';
import { SESSION_SCHEMA, type AttemptResult, type KiaiState, type SessionMode, type SessionPlan, type SessionResult, type SessionSnapshot, type Step, type StepResult, type StepTag } from '../shared/session-types';
import { store } from '../store';
import { introduceItem, recordAttempt, type RecordAttemptOutcome } from '../learn/apply';
import { judgeRate, kiaiInit, shouldJudge } from '../learn';
import { itemKindOf } from './builder';
import { tally, trackCeremonies, type CeremonyEvent } from './end-card';
import { afterDuel } from './nemesis';
import { completeScrollById, isIntroCheck, isPretestStep } from './scroll';
import { NOTES_PLAN_PREFIX, completeNotesSession } from './shinsa';
import { S } from './engine-strings';

/** Modes whose plans accept in-session re-queues (steps, relearn, Recovery). */
export const REQUEUE_MODES: ReadonlySet<SessionMode> = new Set<SessionMode>(['kata', 'kumite', 'shugyo', 'weak', 'welcome', 'scroll']);

/** Drills whose result is a self-rating the Judge may sample (design 05 §6). */
export const SELF_GRADED: ReadonlySet<DrillId> = new Set<DrillId>(['meaning-judge', 'kanji-write', 'shadow', 'writing-dojo']);

export interface RunnerOptions {
  resumed?: SessionSnapshot;
  /** Additive: content source for item lookups (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /**
   * Additive: write the snapshot to `store.session` (default `true`). Boss, exam
   * and Kage rooms pass `false`: a fight is never resumed (design 04 §11 "no
   * retreat"), so it must not overwrite the training snapshot the Dojo offers.
   */
  persist?: boolean;
}

/**
 * The stored snapshot, extended with the active time accumulated before the
 * current segment so a session resumed tomorrow earns tonight's minutes, not
 * the night's. Optional and additive: older snapshots load as `activeMs` 0.
 */
export interface RunnerSnapshot extends SessionSnapshot {
  activeMs?: number;
}

export interface SubmitOptions {
  /** Outcome of a Judge check shown for this self-rated Good. */
  judge?: 'pass' | 'fail';
}

export interface StepTimer {
  ms: number;
  startedAt: number;
}

function toStepResult(o: RecordAttemptOutcome): StepResult {
  const r: StepResult = {
    stepId: o.stepId,
    cardKey: o.cardKey,
    rating: o.rating,
    ki: o.ki,
    combo: o.combo,
    ippon: o.ippon,
    kiai: o.kiai,
    xpDelta: o.xpDelta,
    correct: o.correct,
    nearMiss: o.nearMiss,
    hintUsed: o.hintUsed,
    guard: o.guard,
    timedOut: o.timedOut,
    ms: o.ms,
    errorTags: o.errorTags.slice(),
  };
  if (o.answer !== undefined) r.answer = o.answer;
  if (o.selfRating !== undefined) r.selfRating = o.selfRating;
  if (o.score !== undefined) r.score = o.score;
  if (o.replays !== undefined) r.replays = o.replays;
  if (o.promotion) r.promotion = o.promotion;
  return r;
}

/** Correct surface of a step for the Feedback panel. */
export function correctFormOf(step: Step): string | undefined {
  const p = step.params;
  if (p.answer !== undefined && p.answer !== '') return p.answer;
  if (p.accept && p.accept.length > 0) return p.accept[0];
  if (p.answers && p.answers.length > 0) return p.answers.join('・');
  return undefined;
}

export function feedbackFor(step: Step, result: AttemptResult, out: RecordAttemptOutcome, pretest: boolean): FeedbackState {
  const kind: FeedbackState['kind'] = result.guard ? 'guard' : result.timedOut && !result.correct ? 'timeout' : result.correct && !result.nearMiss ? 'correct' : result.nearMiss ? 'near' : 'wrong';
  const fb: FeedbackState = {
    kind,
    errorTags: result.errorTags.slice(),
    rating: out.rating,
    ippon: out.ippon,
    kiai: out.kiai,
    xpDelta: out.xpDelta,
  };
  const correct = correctFormOf(step);
  if (correct !== undefined) fb.correct = correct;
  if (result.answer !== undefined) fb.given = result.answer;
  if (correct !== undefined && result.answer !== undefined && result.answer !== correct) fb.diff = diffChars(result.answer, correct);
  if (out.promotion) fb.promotion = out.promotion;
  if (out.kiaiResult?.restoredHalf) fb.recovery = true;
  if (out.grade.reason === 'judge-fail') fb.judge = 'fail';
  if (pretest) fb.line = S.pretestLine;
  return fb;
}

export class SessionRunner {
  readonly plan: SessionPlan;
  readonly step: Signal<Step | null>;
  readonly index: Signal<number>;
  readonly total: Signal<number>;
  readonly kiai: Signal<KiaiState>;
  readonly feedback: Signal<FeedbackState | null>;
  readonly done: Signal<SessionResult | null>;
  readonly paused: Signal<boolean>;
  readonly timer: Signal<StepTimer | null>;
  readonly abandoned: Signal<boolean>;
  /** Results so far (the snapshot's `results`). */
  readonly results: StepResult[];
  /** Reward events B emitted during this session, in order. */
  readonly ceremonies: CeremonyEvent[];
  readonly resumed: boolean;
  readonly startedAt: number;

  private queue: Step[];
  private readonly loader: ContentLoader;
  private readonly persist: boolean;
  private stepStartedAt: number;
  private pausedAt: number | null = null;
  private pausedMs = 0;
  /** Paused time over the whole run (every step), excluded from the tally. */
  private pausedTotalMs = 0;
  /** Active time from earlier segments (a resumed snapshot) and the clock this segment started on. */
  private readonly activeBaseMs: number;
  private readonly segmentStartedAt: number;
  private hintCount = 0;
  private answered = false;
  private finished = false;
  private readonly stopCeremonies: () => void;
  private readonly scrollsDone = new Set<string>();

  constructor(plan: SessionPlan, o: RunnerOptions = {}) {
    this.loader = o.loader ?? appContent;
    this.persist = o.persist ?? true;
    const snap = o.resumed;
    this.plan = snap ? snap.plan : plan;
    this.queue = (snap ? snap.plan.steps : plan.steps).slice();
    this.results = snap ? snap.results.slice() : [];
    this.resumed = !!snap;
    this.startedAt = snap ? snap.plan.createdAt : store.now();
    this.activeBaseMs = Math.max(0, (snap as RunnerSnapshot | undefined)?.activeMs ?? 0);
    this.segmentStartedAt = store.now();
    const cursor = snap ? Math.min(snap.cursor, this.queue.length) : 0;
    this.index = signal(cursor);
    this.total = signal(this.queue.length);
    this.step = signal<Step | null>(this.queue[cursor] ?? null);
    this.kiai = signal<KiaiState>(snap ? snap.kiai : kiaiInit());
    this.feedback = signal<FeedbackState | null>(null);
    this.done = signal<SessionResult | null>(null);
    this.paused = signal(false);
    this.timer = signal<StepTimer | null>(null);
    this.abandoned = signal(false);
    const tracker = trackCeremonies();
    this.ceremonies = tracker.events;
    this.stopCeremonies = tracker.stop;
    this.stepStartedAt = store.now();
    if (!snap) {
      bus.emit('session:started', { sessionId: this.plan.id, mode: this.plan.mode, zen: store.settings.value.feel === 'zen' });
      this.save(0);
    }
    if (this.queue.length === 0) this.finish();
    else this.startStep();
  }

  /** Resume the saved session, if any. */
  static resume(o: { loader?: ContentLoader } = {}): SessionRunner | null {
    const snap = store.session.load();
    if (!snap || snap.schema !== SESSION_SCHEMA) return null;
    return new SessionRunner(snap.plan, { resumed: snap, loader: o.loader });
  }

  get sessionId(): string {
    return this.plan.id;
  }

  /** The current queue (plan steps plus re-queues). */
  steps(): readonly Step[] {
    return this.queue;
  }

  /** Reps left after the current one. */
  stepsLeft(): number {
    return Math.max(0, this.queue.length - this.index.value);
  }

  /** Milliseconds on the current step, paused time excluded. */
  elapsedMs(): number {
    const now = this.pausedAt ?? store.now();
    return Math.max(0, now - this.stepStartedAt - this.pausedMs);
  }

  /** Active milliseconds so far: earlier segments plus this one, paused time excluded. */
  activeMs(): number {
    const now = this.pausedAt ?? store.now();
    return this.activeBaseMs + Math.max(0, now - this.segmentStartedAt - this.pausedTotalMs);
  }

  snapshot(cursor = this.index.value): RunnerSnapshot {
    return {
      schema: SESSION_SCHEMA,
      plan: { ...this.plan, steps: this.queue.slice() },
      cursor,
      results: this.results.slice(),
      kiai: this.kiai.value,
      activeMs: this.activeMs(),
    };
  }

  private save(cursor: number): void {
    if (this.finished || !this.persist) return;
    store.session.save(this.snapshot(cursor));
  }

  private startStep(): void {
    const step = this.queue[this.index.value] ?? null;
    this.step.value = step;
    this.total.value = this.queue.length;
    this.stepStartedAt = store.now();
    this.pausedMs = 0;
    this.hintCount = 0;
    this.answered = false;
    this.timer.value = step && step.timerMs !== undefined && step.timerMs > 0 ? { ms: step.timerMs, startedAt: this.stepStartedAt } : null;
  }

  /** Should a Judge Card verify this self-rated result before it is submitted? (design 05 §6) */
  judgeNeeded(r: AttemptResult): boolean {
    const step = this.step.value;
    if (!step || r.selfRating !== 3 || r.guard) return false;
    const meta = resolveExercise(step.exercise)?.meta;
    const selfGraded = meta ? meta.selfGraded : SELF_GRADED.has(step.exercise);
    if (!selfGraded && !store.settings.value.classicGrading) return false;
    const stats = store.stats.value;
    const rate = judgeRate(stats.judgeChecks > 0 ? stats.honesty : null, stats.judgeChecks);
    const key = step.cardKey ?? (step.id as CardKey);
    const reps = step.cardKey ? (store.cards.get(step.cardKey)?.[3] ?? 0) : this.index.value;
    return shouldJudge(store.seed(), key, reps, rate);
  }

  /** Frame `?` key / hint button: counted into the result's `hintUsed`. */
  hint(): void {
    if (this.answered || this.done.value) return;
    this.hintCount++;
  }

  /** Shift+Enter Guard: an honest "don't know". */
  guard(): void {
    this.submit({ correct: false, nearMiss: false, hintUsed: this.hintCount > 0, guard: true, timedOut: false, ms: this.elapsedMs(), errorTags: [] });
  }

  /** Hard-timer expiry on a timed (boss) step; ignored elsewhere. */
  timeout(): void {
    const step = this.step.value;
    if (!step || !step.timed) return;
    this.submit({ correct: false, nearMiss: false, hintUsed: this.hintCount > 0, guard: false, timedOut: true, ms: this.elapsedMs(), errorTags: [] });
  }

  pause(): void {
    if (this.paused.value || this.done.value) return;
    this.paused.value = true;
    this.pausedAt = store.now();
    this.save(this.answered ? this.index.value + 1 : this.index.value);
  }

  resume(): void {
    if (!this.paused.value) return;
    if (this.pausedAt !== null) {
      const slept = Math.max(0, store.now() - this.pausedAt);
      this.pausedMs += slept;
      this.pausedTotalMs += slept;
    }
    this.pausedAt = null;
    this.paused.value = false;
    const step = this.step.value;
    if (step && step.timerMs !== undefined && step.timerMs > 0 && !this.answered) this.timer.value = { ms: step.timerMs, startedAt: this.stepStartedAt + this.pausedMs };
  }

  submit(r: AttemptResult, o: SubmitOptions = {}): void {
    const step = this.step.value;
    if (!step || this.done.value || this.answered) return;
    if (step.block === 'michikusa') {
      this.answered = true;
      this.next();
      return;
    }
    const idx = this.index.value;
    const result: AttemptResult = { ...r, ms: r.ms > 0 ? r.ms : this.elapsedMs(), hintUsed: r.hintUsed || this.hintCount > 0 };
    const pretest = isPretestStep(step);
    const intro = isIntroCheck(step);
    const item = step.itemId ? this.loader.get(step.itemId) : undefined;
    const kind = step.itemId ? itemKindOf(step.itemId, item) : null;

    // Every XP B grants for this rep — the introduction, the graded attempt and a completed Scroll — is the step's
    // `xpDelta`, so the つづく card's XP matches the profile (the writer alone sees only its own emits).
    let xpThisStep = 0;
    const offXp = bus.on('xp:gained', (p) => {
      xpThisStep += p.amount;
    });
    let out: RecordAttemptOutcome;
    try {
      if (step.itemId && kind && (intro || (pretest && result.correct))) introduceItem(step.itemId, kind, this.plan.station);

      out = recordAttempt({
        sessionId: this.plan.id,
        step,
        result,
        kiai: this.kiai.value,
        repIndex: idx,
        rng: rngFor(store.seed(), this.plan.id, step.id, idx),
        boss: step.block === 'phase' && step.timed,
        pretest,
        ...(o.judge ? { judge: o.judge } : {}),
        ...(item ? { item } : {}),
        ...(kind ? { kind } : {}),
      });

      if (out.kiaiState) this.kiai.value = out.kiaiState;
      this.results.push(toStepResult(out));
      this.answered = true;

      if (REQUEUE_MODES.has(this.plan.mode) && !pretest) {
        // A lapse that broke the combo returns as the Recovery rep (3–8 later); the +5 relearn is the same return, not a second one.
        const recovery = step.cardKey && out.kiaiResult?.comboBroken ? this.kiai.value.recoveryQueue.find((q) => q.cardKey === step.cardKey) : undefined;
        for (const offset of out.stepOffsets) {
          const tag: StepTag = offset === 3 ? '+3' : offset === 10 ? '+10' : 'relearn';
          if (tag === 'relearn' && recovery) continue;
          this.requeue(step, idx + offset, tag);
        }
        if (recovery) this.requeue(step, Math.max(idx + 1, recovery.at), 'recovery');
      }

      if (intro && step.params.scrollId) this.checkScroll(step.params.scrollId);
      if (step.exercise === 'nemesis-duel' && step.itemId) afterDuel(step.itemId, this.results, store.today());
    } finally {
      offXp();
    }

    const last = this.results[this.results.length - 1];
    if (last && last.stepId === step.id) last.xpDelta = xpThisStep;
    this.feedback.value = feedbackFor(step, result, { ...out, xpDelta: xpThisStep }, pretest);

    this.save(idx + 1);
  }

  /** Inserts a copy of `step` at `at` (clamped to the queue end) unless an identical pending re-queue exists. */
  private requeue(step: Step, at: number, tag: StepTag): void {
    if (!step.cardKey) return;
    const from = this.index.value + 1;
    for (let i = from; i < this.queue.length; i++) {
      const s = this.queue[i] as Step;
      if (s.cardKey === step.cardKey && s.stepTag === tag) return;
    }
    const exposures = step.exposures + (tag === '+10' ? 2 : 1);
    const copy: Step = {
      ...step,
      id: `${step.id}~${tag}`,
      params: { ...step.params },
      isNew: false,
      stepTag: tag,
      exposures,
      timed: false,
    };
    delete copy.params.recheck;
    delete copy.timerMs;
    const pos = Math.max(from, Math.min(at, this.queue.length));
    this.queue.splice(pos, 0, copy);
    this.total.value = this.queue.length;
  }

  private checkScroll(scrollId: string): void {
    if (this.scrollsDone.has(scrollId)) return;
    const checks = this.queue.filter((s) => isIntroCheck(s) && s.params.scrollId === scrollId);
    const answered = new Set(this.results.map((r) => r.stepId));
    if (!checks.every((s) => answered.has(s.id))) return;
    this.scrollsDone.add(scrollId);
    const itemIds = Array.from(new Set(checks.map((s) => s.itemId).filter((x): x is string => x !== null)));
    completeScrollById(scrollId, itemIds, this.results);
  }

  /** Advances after feedback (or after a Michikusa card). No-op before the current step is answered. */
  next(): void {
    if (this.done.value) return;
    const step = this.step.value;
    if (step && !this.answered && step.block !== 'michikusa') return;
    this.feedback.value = null;
    const nextIdx = this.index.value + 1;
    if (nextIdx >= this.queue.length) {
      this.index.value = nextIdx;
      this.step.value = null;
      this.finish();
      return;
    }
    this.index.value = nextIdx;
    this.startStep();
    this.save(nextIdx);
  }

  private weakTags(): ErrorTag[] {
    const tags = new Set<ErrorTag>();
    for (const s of this.queue) if (s.block === 'weak' && s.params.tag) tags.add(s.params.tag);
    return Array.from(tags);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const endedAt = store.now();
    // Minutes are active time: earlier segments of a resumed run plus this one, pauses excluded. The result's
    // `startedAt` is `endedAt − active`, so B's `endedAt − startedAt` minutes agree with the tally; the wall-clock
    // start stays on `plan.createdAt` / `runner.startedAt`.
    const activeMs = Math.min(this.activeMs(), Math.max(0, endedAt - this.startedAt));
    const activeStart = endedAt - activeMs;
    const quests = store.quests.value;
    const t = tally(this.results, {
      startedAt: activeStart,
      endedAt,
      questsDone: quests.day === store.today() ? quests.done.slice() : [],
      backlogWaiting: this.plan.meta.backlog ? Math.max(0, this.plan.meta.dueTotal - this.plan.meta.dueTaken) : 0,
      pausedMs: 0,
    });
    const result: SessionResult = {
      planId: this.plan.id,
      mode: this.plan.mode,
      startedAt: activeStart,
      endedAt,
      steps: this.results.slice(),
      tally: t,
      zen: store.settings.value.feel === 'zen',
      resumed: this.resumed,
    };
    if (this.persist) store.session.clear();
    let extraXp = 0;
    const off = bus.on('xp:gained', (p) => {
      extraXp += p.amount;
    });
    try {
      bus.emit('session:finished', result);
      for (const tag of this.weakTags()) bus.emit('weak-point:set-done', { tag });
      if (this.plan.mode === 'welcome') bus.emit('welcome-back:done', {});
      if (this.plan.id.startsWith(NOTES_PLAN_PREFIX)) completeNotesSession();
    } finally {
      off();
    }
    if (extraXp > 0) result.tally = { ...t, xp: t.xp + extraXp };
    this.stopCeremonies();
    this.timer.value = null;
    this.done.value = result;
  }

  /** Leaves without a card: `session:abandoned`, snapshot cleared, no tally. */
  abandon(): void {
    if (this.done.value || this.abandoned.value) return;
    this.abandoned.value = true;
    this.finished = true;
    if (this.persist) store.session.clear();
    bus.emit('session:abandoned', { sessionId: this.plan.id, steps: this.results.length });
    this.stopCeremonies();
    this.timer.value = null;
    this.step.value = null;
  }
}
