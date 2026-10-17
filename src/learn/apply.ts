/**
 * TSUZUKU — the ONE impure module of the learning core (ARCHITECTURE §0, §5;
 * module plan `src/learn/apply.ts`). Imported directly as `@/learn/apply`,
 * never from the pure barrel (a store ↔ learn cycle otherwise).
 *
 *  recordAttempt()   rating (grading) → FSRS (scheduler) → facet unlock with
 *                    warm start → nemesis / archive / Kaiden flags → item-belt
 *                    promotion + first `prod` success → `store.cards` /
 *                    `store.log` writes → optional `kiaiStep()` → emits
 *                    `attempt:graded`, `item:promoted`, `kiai:entered`.
 *  recordImplicit()  side grade on another card (gloss tap, dictation / shadow
 *                    content words, Kaiden story evidence): writes card + log,
 *                    announces a promotion, never emits `attempt:graded`.
 *  introduceItem()   creates the first facet cards, emits `item:introduced`.
 *  markKnown()       既知 — Easy start on every initial facet, no steps.
 *  retireItem()      退 — archive flag on every card of an item (reversible).
 *  defeatNemesis()   writes `leech.defeat()` on the flagged cards, emits
 *                    `nemesis:defeated`.
 *
 * XP amounts are decided only in B: this module emits facts and captures the
 * `xp:gained` events B emits synchronously in response, so `StepResult.xpDelta`
 * is what the reducers actually granted for this rep (0 when none are wired).
 *
 * Determinism: `today`/`now` come from `store`; the FSRS tie-break rng is
 * seeded from `store.seed()` + card key + reps; a caller may pass `rng`.
 */
import { DRILL_IDS, ERROR_TAGS, type CardKey, type ContentItem, type Facet } from '../content/types';
import { content } from '../content/loader';
import { bus } from '../shared/events';
import { rngFor, type Rng } from '../shared/hash';
import { cardKey as makeCardKey, parseCardKey } from '../shared/ids';
import { resolveExercise, type ExerciseMeta } from '../shared/exercise-types';
import type { AttemptResult, KiaiState, Step, StepResult } from '../shared/session-types';
import {
  CardFlag,
  hasFlag,
  withFlag,
  withoutFlag,
  type CardTuple,
  type EpochDay,
  type ItemBelt,
  type ItemKind,
  type LogEntry,
  type Rating,
} from '../shared/store-types';
import { store } from '../store';
import { grade, isMature, type GradeOutcome } from './grading';
import { beltPromotion, itemBelt, productionFacet } from './item-belt';
import { kiaiStep, type KiaiStepResult } from './kiai';
import { kindOfCards } from './known';
import { defeat, isNemesis, markNemesis, qualifiesNemesis } from './leech';
import {
  STEP_OFFSETS,
  applyRating,
  initialFacets,
  isKaiden,
  kichiStart,
  newCard,
  shouldArchive,
  stepOffsetsFor,
  unlockableFacets,
  warmStart,
  withKaidenFlag,
  type ScheduleOpts,
} from './scheduler';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Implicit dictation / shadow grades apply only to cards due within this many days (design 05 §4). */
export const IMPLICIT_DUE_WINDOW = 3;
/** "Fast" for ki / Ippon = faster than this × the personal median (design 05 §5). */
export const FAST_FACTOR = 0.8;
/** Ippon: "lapsed within 30 d". */
export const RECENT_LAPSE_DAYS = 30;
/** Ippon: "D ≥ 7". */
export const IPPON_DIFFICULTY = 7;
/** `isSlow` needs ≥ 50 samples; the log scan stops once that many are counted. */
const MEDIAN_N_CAP = 50;

const DAY_MS = 86_400_000;

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Everything the runner knows about the rep besides the step and its result. */
export interface AttemptContext {
  sessionId: string;
  /** Inside a Gatekeeper Flash/Strike phase (default: `step.block === 'phase'`). */
  boss?: boolean;
  /** Outcome of a Judge check on a self-rated Good (`fail` forces Again). */
  judge?: 'pass' | 'fail';
  /** Chikaradameshi pretest: a miss carries no FSRS penalty. */
  pretest?: boolean;
  /** story-read: the episode's first read (gloss taps are free). */
  firstRead?: boolean;
  /** Override the item kind (default: from the id and the facets it holds; `chunk` detected). */
  kind?: ItemKind;
  /** Override the content item (default: `content.get(itemId)`; only pitch unlock reads it). */
  item?: ContentItem;
  /** Which keys the drill uses (default: the registry's meta, else `'none'`). */
  keys?: ExerciseMeta['keys'];
  /** Speed ring visible (default: `settings.feel !== 'zen'`). */
  speedRingShown?: boolean;
  /** Override "faster than 0.8 × median" (ki / Ippon). */
  fast?: boolean;
  /**
   * Kiai state before this rep. When given, `kiaiStep()` runs here so
   * `attempt:graded` carries real `ippon / kiai / combo / recovery` and the
   * result holds the next state. Without it those fields are `false / 0`.
   */
  kiai?: KiaiState;
  /** Index of this rep in the session (Recovery queue offsets). */
  repIndex?: number;
  /** Deterministic rng for FSRS tie-breaks and the Recovery offset. */
  rng?: Rng;
}

/** Module-plan input shape: `recordAttempt({ sessionId, step, result, boss? })`. */
export interface RecordAttemptInput extends AttemptContext {
  step: Step;
  result: AttemptResult;
}

/** `StepResult` (ARCHITECTURE §5) plus the facts the runner and tests need. */
export interface RecordAttemptOutcome extends StepResult {
  /** The card after this rep (`null` when nothing was written and none existed). */
  card: CardTuple | null;
  /** The card before this rep. */
  prev: CardTuple | null;
  itemId: string | null;
  kind: ItemKind | null;
  facet: Facet | null;
  /** The belt change announced (`promotion` is its `to`, per `StepResult`). */
  promoted?: { from: ItemBelt; to: ItemBelt };
  /** First Good-or-better on the item's production facet. */
  firstProd: boolean;
  /** `isMature(prev)` — the tested facet had S ≥ 14 d before this rep. */
  mature: boolean;
  grade: GradeOutcome;
  /** In-session re-presentation offsets this card now owes (`[3, 10]`, `[3]`, `[5]`, `[]`). */
  stepOffsets: readonly number[];
  /** Facet cards created by warm start on this rep. */
  unlocked: CardKey[];
  /** The card became a Nemesis on this rep. */
  nemesis: boolean;
  /** The card was archived on this rep. */
  archived: boolean;
  /** A log row was pushed. */
  logged: boolean;
  /** The arcade-miss recheck flag was set. */
  recheckSet: boolean;
  /** Implicit side grades applied (`result.implicit`, filtered by the due window). */
  implicitApplied: CardKey[];
  /** Present when `ctx.kiai` was given. */
  kiaiState?: KiaiState;
  kiaiResult?: KiaiStepResult;
}

export interface ImplicitGrade {
  cardKey: CardKey;
  rating: Rating;
  exercise: Step['exercise'];
  sessionId: string;
  /** Skip unless the card is due within this many days (`IMPLICIT_DUE_WINDOW` for dictation / shadow). */
  dueWithin?: number;
  ms?: number;
  rng?: Rng;
}

export interface ImplicitOutcome {
  cardKey: CardKey;
  card: CardTuple;
  promoted?: { from: ItemBelt; to: ItemBelt };
  unlocked: CardKey[];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

let histoVersion = -1;
let histo = new Map<EpochDay, number>();

/** Cards due per day — the FSRS load-balancing hook; memoised on `cards.version`. */
function loadOnDay(d: EpochDay): number {
  const v = store.cards.version.peek();
  if (v !== histoVersion) {
    const m = new Map<EpochDay, number>();
    store.cards.forEach((_k, t) => {
      if (hasFlag(t[7], CardFlag.archived)) return;
      m.set(t[0], (m.get(t[0]) ?? 0) + 1);
    });
    histo = m;
    histoVersion = v;
  }
  return histo.get(d) ?? 0;
}

function scheduleOpts(key: CardKey, prev: CardTuple | null, rng?: Rng): ScheduleOpts {
  return {
    retention: store.settings.value.retention,
    loadOnDay,
    rng: rng ?? rngFor(store.seed(), key, prev ? prev[3] : 0),
  };
}

function tagsMask(tags: readonly string[]): number {
  let m = 0;
  for (const t of tags) {
    const i = ERROR_TAGS.indexOf(t as (typeof ERROR_TAGS)[number]);
    if (i >= 0) m |= 1 << i;
  }
  return m;
}

function exerciseIdx(ex: string): number {
  return Math.max(0, DRILL_IDS.indexOf(ex as (typeof DRILL_IDS)[number]));
}

/** Samples behind the drill's median, capped at the slow-rule threshold. */
function medianSamples(idx: number): number {
  let n = 0;
  for (const e of store.log.recent(5000)) {
    if (e[4] === idx && ++n >= MEDIAN_N_CAP) break;
  }
  return n;
}

function kindFor(itemId: string, facets: Iterable<Facet>, override?: ItemKind): ItemKind | null {
  return override ?? kindOfCards(itemId, facets) ?? null;
}

function withFlags(card: CardTuple, flags: number): CardTuple {
  if (flags === card[7]) return card;
  return [card[0], card[1], card[2], card[3], card[4], card[5], card[6], flags];
}

/** Runs the emits in `fn` and returns the XP B granted synchronously while they ran. */
function captureXp(fn: () => void): number {
  let xp = 0;
  const off = bus.on('xp:gained', (p) => {
    xp += p.amount;
  });
  try {
    fn();
  } finally {
    off();
  }
  return xp;
}

/**
 * Post-write pipeline shared by every writer: unlock facets (warm start),
 * sync the Kaiden flag across the item's cards, detect a promotion.
 */
function afterWrite(
  itemId: string,
  kind: ItemKind,
  item: ContentItem | undefined,
  before: Partial<Record<Facet, CardTuple>>,
): { promoted?: { from: ItemBelt; to: ItemBelt }; unlocked: CardKey[] } {
  const today = store.today();
  const unlocked: CardKey[] = [];
  let after = store.cards.byItem(itemId);

  for (const u of unlockableFacets(itemId, kind, item, after)) {
    const parent = after[u.from];
    if (!parent) continue;
    const key = makeCardKey(itemId, u.facet);
    store.cards.set(key, warmStart(parent, u.factor, today));
    unlocked.push(key);
  }
  if (unlocked.length > 0) after = store.cards.byItem(itemId);

  const kaiden = isKaiden(after);
  for (const f of Object.keys(after) as Facet[]) {
    const c = after[f];
    if (!c) continue;
    const next = withKaidenFlag(c, kaiden);
    if (next !== c) store.cards.set(makeCardKey(itemId, f), next);
  }
  if (unlocked.length > 0 || kaiden) after = store.cards.byItem(itemId);

  const promo = beltPromotion(itemBelt(kind, before), itemBelt(kind, after));
  return promo ? { promoted: promo, unlocked } : { unlocked };
}

function emitPromotion(itemId: string, kind: ItemKind, p: { from: ItemBelt; to: ItemBelt } | undefined): void {
  if (p) bus.emit('item:promoted', { itemId, kind, from: p.from, to: p.to });
}

/** Schedules `prev` (or a fresh card) with `rating`, honouring the learning-step-miss rule. */
function scheduleCard(key: CardKey, prev: CardTuple | null, rating: Rating, stepMiss: boolean, rng?: Rng): CardTuple {
  const today = store.today();
  let base = prev ?? newCard(today);
  // A learning-step miss on a card already in review (e.g. a warm-started
  // facet with < 3 reviews) must not count a lapse: schedule it as a learning
  // card so FSRS takes the step path (state 1, step-pending, lapses unchanged).
  if (stepMiss && (base[5] === 2 || base[5] === 3)) {
    base = [base[0], base[1], base[2], base[3], base[4], 1, base[6], base[7]];
  }
  return applyRating(base, rating, today, scheduleOpts(key, prev, rng)).card;
}

/** Nemesis + archive flags after a schedule. */
function flagAfterSchedule(kind: ItemKind, facet: Facet, card: CardTuple): { card: CardTuple; nemesis: boolean; archived: boolean } {
  let next = card;
  let nemesis = false;
  let archived = false;
  if (qualifiesNemesis(next)) {
    next = markNemesis(next);
    nemesis = true;
  }
  if (!hasFlag(next[7], CardFlag.archived) && shouldArchive(kind, facet, next)) {
    next = withFlags(next, withFlag(next[7], CardFlag.archived));
    archived = true;
  }
  return { card: next, nemesis, archived };
}

function hadSuccess(key: CardKey, prev: CardTuple | null): boolean {
  if (!prev || prev[3] === 0) return false;
  return store.log.forCard(key).some((e) => e[2] >= 3);
}

function lapsedRecently(key: CardKey, prev: CardTuple | null): boolean {
  if (!prev || prev[4] === 0) return false;
  const since = store.now() - RECENT_LAPSE_DAYS * DAY_MS;
  return store.log.forCard(key).some((e) => e[2] === 1 && e[0] >= since);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* recordAttempt                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export function recordAttempt(input: RecordAttemptInput): RecordAttemptOutcome;
export function recordAttempt(step: Step, result: AttemptResult, ctx: AttemptContext): RecordAttemptOutcome;
export function recordAttempt(a: RecordAttemptInput | Step, b?: AttemptResult, c?: AttemptContext): RecordAttemptOutcome {
  const i: RecordAttemptInput = b !== undefined ? { ...(c as AttemptContext), step: a as Step, result: b } : (a as RecordAttemptInput);
  const { step, result } = i;
  const today = store.today();
  const settings = store.settings.value;

  // ── identify the card ────────────────────────────────────────────────
  const key = step.cardKey;
  const parsed = key ? parseCardKey(key) : null;
  const itemId = step.itemId ?? parsed?.itemId ?? null;
  const facet = parsed?.facet ?? null;
  const prev = key ? (store.cards.get(key) ?? null) : null;
  const before = itemId ? store.cards.byItem(itemId) : {};
  const kind = itemId ? kindFor(itemId, facet ? [...(Object.keys(before) as Facet[]), facet] : (Object.keys(before) as Facet[]), i.kind) : null;
  const item = i.item ?? (itemId ? content.get(itemId) : undefined);

  // ── grade ────────────────────────────────────────────────────────────
  const idx = exerciseIdx(step.exercise);
  const keys = i.keys ?? resolveExercise(step.exercise)?.meta.keys ?? 'none';
  const medianMs = store.medianMs.value[step.exercise];
  const medianN = medianMs === undefined ? 0 : medianSamples(idx);
  const g = grade(result, {
    card: prev,
    medianMs,
    medianN,
    today,
    exercise: step.exercise,
    keys,
    boss: i.boss ?? step.block === 'phase',
    classic: settings.classicGrading,
    speedRingShown: i.speedRingShown ?? settings.feel !== 'zen',
    speedGrading: settings.speedGrading,
    recheck: step.params.recheck === true,
    firstRead: i.firstRead,
    exposures: step.exposures,
    judge: i.judge,
    pretest: i.pretest,
  });
  const rating = g.rating;
  const mature = isMature(prev);

  // ── write ────────────────────────────────────────────────────────────
  let card: CardTuple | null = prev;
  let logged = false;
  let recheckSet = false;
  let nemesis = false;
  let archived = false;
  let stepOffsets: readonly number[] = [];
  let firstProd = false;
  let promoted: { from: ItemBelt; to: ItemBelt } | undefined;
  let unlocked: CardKey[] = [];
  const implicitApplied: CardKey[] = [];

  if (key && itemId && kind && facet) {
    if (g.recheck) {
      if (prev && !hasFlag(prev[7], CardFlag.recheck)) {
        card = withFlags(prev, withFlag(prev[7], CardFlag.recheck));
        store.cards.set(key, card);
        recheckSet = true;
      }
    } else if (rating !== null) {
      const scheduled = scheduleCard(key, prev, rating, g.stepMiss, i.rng);
      const flagged = flagAfterSchedule(kind, facet, step.params.recheck ? withFlags(scheduled, withoutFlag(scheduled[7], CardFlag.recheck)) : scheduled);
      card = flagged.card;
      nemesis = flagged.nemesis;
      archived = flagged.archived;
      store.cards.set(key, card);
      store.log.push([store.now(), key, rating, Math.max(0, Math.round(result.ms)), idx, tagsMask(result.errorTags)] as LogEntry);
      logged = true;
      stepOffsets = g.stepMiss ? STEP_OFFSETS.learningMiss : stepOffsetsFor(prev ?? newCard(today), rating);
      firstProd = facet === productionFacet(kind) && rating >= 3 && !hadSuccess(key, prev);
      const post = afterWrite(itemId, kind, item, before);
      promoted = post.promoted;
      unlocked = post.unlocked;
    }
  }

  // ── implicit side grades (dictation / shadow content words) ──────────
  const sidePromotions: { itemId: string; kind: ItemKind; p: { from: ItemBelt; to: ItemBelt } }[] = [];
  for (const im of result.implicit ?? []) {
    if (im.cardKey === key) continue;
    const r = recordImplicit({ cardKey: im.cardKey, rating: im.rating, exercise: step.exercise, sessionId: i.sessionId, dueWithin: IMPLICIT_DUE_WINDOW, ms: result.ms, rng: i.rng }, { emit: false });
    if (!r) continue;
    implicitApplied.push(im.cardKey);
    if (r.promoted) {
      const { itemId: sid } = parseCardKey(im.cardKey);
      const sk = kindFor(sid, Object.keys(store.cards.byItem(sid)) as Facet[]);
      if (sk) sidePromotions.push({ itemId: sid, kind: sk, p: r.promoted });
    }
  }

  // ── kiai (optional) ──────────────────────────────────────────────────
  let kiaiState: KiaiState | undefined;
  let kiaiResult: KiaiStepResult | undefined;
  if (i.kiai) {
    const fast = i.fast ?? (medianMs !== undefined && medianMs > 0 && result.ms > 0 && result.ms < FAST_FACTOR * medianMs);
    kiaiResult = kiaiStep(i.kiai, {
      correct: result.correct,
      nearMiss: result.nearMiss,
      guard: result.guard,
      hintUsed: result.hintUsed,
      mature,
      fast,
      difficultOrLapsed: !!prev && (prev[2] >= IPPON_DIFFICULTY || (key !== null && lapsedRecently(key, prev))),
      cardReviews: prev ? prev[3] : 0,
      isRecovery: step.stepTag === 'recovery',
      cardKey: key,
      repIndex: i.repIndex,
      mcFirstExposures: keys === 'choices' && step.exposures < 2,
      rng: i.rng ?? (key ? rngFor(store.seed(), key, prev ? prev[3] : 0, 'recovery') : undefined),
    });
    kiaiState = kiaiResult.state;
  }
  const ippon = kiaiResult?.ippon ?? false;
  const kiai = kiaiResult?.kiaiActive ?? false;
  const combo = kiaiState?.combo ?? 0;
  const ki = kiaiState?.ki ?? 0;
  const recovery = kiaiResult?.restoredHalf ?? false;

  // ── emit ─────────────────────────────────────────────────────────────
  const xpDelta = captureXp(() => {
    bus.emit('attempt:graded', {
      ...result,
      sessionId: i.sessionId,
      exercise: step.exercise,
      itemId,
      kind,
      facet,
      cardKey: key,
      rating,
      judge: i.judge,
      mature,
      ippon,
      kiai,
      combo,
      recovery,
      firstProd,
    });
    if (itemId && kind) emitPromotion(itemId, kind, promoted);
    for (const s of sidePromotions) emitPromotion(s.itemId, s.kind, s.p);
    if (kiaiResult?.kiaiEntered) bus.emit('kiai:entered', {});
  });

  const out: RecordAttemptOutcome = {
    ...result,
    stepId: step.id,
    cardKey: key,
    rating,
    ki,
    combo,
    ippon,
    kiai,
    xpDelta,
    card,
    prev,
    itemId,
    kind,
    facet,
    firstProd,
    mature,
    grade: g,
    stepOffsets,
    unlocked,
    nemesis,
    archived,
    logged,
    recheckSet,
    implicitApplied,
  };
  if (promoted) {
    out.promotion = promoted.to;
    out.promoted = promoted;
  }
  if (kiaiState && kiaiResult) {
    out.kiaiState = kiaiState;
    out.kiaiResult = kiaiResult;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* recordImplicit                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Side grade on an existing card. Skips (returns `null`) when the card does
 * not exist or is not due within `dueWithin` days. Writes the card and a log
 * row, runs unlock / Kaiden / promotion, emits `item:promoted` (unless
 * `emit: false`), never `attempt:graded`.
 */
export function recordImplicit(g: ImplicitGrade, o: { emit?: boolean } = {}): ImplicitOutcome | null {
  const prev = store.cards.get(g.cardKey);
  if (!prev) return null;
  const today = store.today();
  if (g.dueWithin !== undefined && prev[0] > today + g.dueWithin) return null;
  const { itemId, facet } = parseCardKey(g.cardKey);
  const before = store.cards.byItem(itemId);
  const kind = kindFor(itemId, Object.keys(before) as Facet[]);
  if (!kind) return null;

  const scheduled = scheduleCard(g.cardKey, prev, g.rating, false, g.rng);
  const { card } = flagAfterSchedule(kind, facet, scheduled);
  store.cards.set(g.cardKey, card);
  store.log.push([store.now(), g.cardKey, g.rating, Math.max(0, Math.round(g.ms ?? 0)), exerciseIdx(g.exercise), 0] as LogEntry);
  const post = afterWrite(itemId, kind, content.get(itemId), before);
  if (o.emit !== false) emitPromotion(itemId, kind, post.promoted);
  const out: ImplicitOutcome = { cardKey: g.cardKey, card, unlocked: post.unlocked };
  if (post.promoted) out.promoted = post.promoted;
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* introduceItem / markKnown / retireItem / defeatNemesis                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Creates the item's initial facet cards (`scheduler.initialFacets`), due
 * today, and emits `item:introduced`. Idempotent: facets that already exist
 * are left alone; returns only the keys created (`[]` = already introduced,
 * nothing emitted).
 */
export function introduceItem(itemId: string, kind: ItemKind, station: number): CardKey[] {
  const today = store.today();
  const created: CardKey[] = [];
  for (const f of initialFacets(kind)) {
    const key = makeCardKey(itemId, f);
    if (store.cards.get(key)) continue;
    store.cards.set(key, newCard(today));
    created.push(key);
  }
  if (created.length > 0) bus.emit('item:introduced', { itemId, kind, station });
  return created;
}

/**
 * 既知 "I already know this": every initial facet starts Easy (S₀ = w[3],
 * review state, no in-session steps). Cards that have already been reviewed
 * are left alone. Kana ids are added to `profile.kanaKnown`. Emits
 * `item:introduced` when the item had no cards before (station = current).
 */
export function markKnown(itemId: string, kind: ItemKind): CardKey[] {
  const today = store.today();
  const hadCards = Object.keys(store.cards.byItem(itemId)).length > 0;
  const written: CardKey[] = [];
  for (const f of initialFacets(kind)) {
    const key = makeCardKey(itemId, f);
    const prev = store.cards.get(key);
    if (prev && (prev[5] !== 0 || prev[3] > 0)) continue;
    store.cards.set(key, kichiStart(today, scheduleOpts(key, prev ?? null)));
    written.push(key);
  }
  if (kind === 'kana') {
    store.patch('profile', (p) => (p.kanaKnown.includes(itemId) ? p : { ...p, kanaKnown: [...p.kanaKnown, itemId] }));
  }
  if (!hadCards && written.length > 0) {
    bus.emit('item:introduced', { itemId, kind, station: store.progress.value.station });
  }
  return written;
}

/** 退 Retire (or un-retire): sets/clears the archive flag on every card of the item. Returns the keys changed. */
export function retireItem(itemId: string, retired = true): CardKey[] {
  const cards = store.cards.byItem(itemId);
  const changed: CardKey[] = [];
  for (const f of Object.keys(cards) as Facet[]) {
    const c = cards[f];
    if (!c) continue;
    const flags = retired ? withFlag(c[7], CardFlag.archived) : withoutFlag(c[7], CardFlag.archived);
    if (flags === c[7]) continue;
    const key = makeCardKey(itemId, f);
    store.cards.set(key, withFlags(c, flags));
    changed.push(key);
  }
  return changed;
}

/**
 * The Duel is won: every Nemesis-flagged card of the item takes
 * `leech.defeat()` (flag cleared, S = 3 d, lapses 0); emits `nemesis:defeated`
 * when at least one card was flagged. Returns the keys rewritten.
 */
export function defeatNemesis(itemId: string): CardKey[] {
  const today = store.today();
  const cards = store.cards.byItem(itemId);
  const changed: CardKey[] = [];
  for (const f of Object.keys(cards) as Facet[]) {
    const c = cards[f];
    if (!c || !isNemesis(c)) continue;
    const key = makeCardKey(itemId, f);
    store.cards.set(key, defeat(c, today));
    changed.push(key);
  }
  if (changed.length > 0) bus.emit('nemesis:defeated', { itemId });
  return changed;
}
