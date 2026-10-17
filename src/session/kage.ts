/**
 * TSUZUKU — Kage (影), the ghost rival and the weekly test (design 03 §11).
 *
 *  Every week (absolute Monday-based week, `time.weekOf`) a 30-item Ghost Set
 *  is sampled by `hash(seed, week)` through `learn.kagePools`: 15 items
 *  introduced in the last 14 days (graded normally, logged as reviews) and 15
 *  mature items (tested facet S ≥ 14 d) on which the speed index is measured.
 *  score = accuracy on all 30 × speed index on the mature 15, where
 *  speed index = clamp(median personal latency / observed, 0.5, 1.5); stored
 *  as integer points (× 1000). You beat the Kage when you beat your own best
 *  of the last 4 weeks. The hi-score table's "Factory defaults" rows are
 *  derived from the learner's own first result (× 0.6 … × 1.1, katakana
 *  initials) and are replaced by weekly history — never fabricated rivals.
 *  The copy is respectful; the shadow is you.
 */
import type { ContentLoader } from '../content/loader';
import type { DrillId } from '../content/types';
import { bus } from '../shared/events';
import { hashSeed } from '../shared/hash';
import type { SessionPlan, Step, StepResult } from '../shared/session-types';
import { weekOf, weekStartDay } from '../shared/time';
import type { EpochDay, KageState, SaveMeta } from '../shared/store-types';
import { store } from '../store';
import { cardRetrievability, kagePools, type QueueCard } from '../learn';
import { rngFor } from '../shared/hash';
import { DEFAULT_REP_MS, templateFor } from './blocks';
import { S } from './engine-strings';
import { composeReviews, finalizePlan, loadPlanContext, stepForCard } from './builder';

export const KAGE_SET_SIZE = 30;
export const SPEED_INDEX_MIN = 0.5;
export const SPEED_INDEX_MAX = 1.5;
export const SCORE_SCALE = 1000;
export const BEST_WEEKS = 4;
export const HISTORY_KEEP = 52;

/**
 * Multipliers of the learner's FIRST result that seed the hi-score table
 * (design 03 §11 "Factory defaults"), with katakana initials. `score` is the
 * multiplier; `factoryRows(firstScore)` turns them into points.
 */
export const FACTORY_TABLE: readonly { initials: string; score: number }[] = [
  { initials: 'カゲ', score: 1.1 },
  { initials: 'ツヅ', score: 1.0 },
  { initials: 'ミチ', score: 0.9 },
  { initials: 'ハナ', score: 0.8 },
  { initials: 'ケン', score: 0.7 },
  { initials: 'ムメ', score: 0.6 },
];

export interface HiScoreRow {
  initials: string;
  score: number;
  /** Absolute week of a real run; `undefined` for a factory row. */
  week?: number;
  factory: boolean;
}

/** Concrete factory rows from the learner's first score (empty before the first run). */
export function factoryRows(firstScore: number | undefined): HiScoreRow[] {
  if (firstScore === undefined || firstScore <= 0) return [];
  return FACTORY_TABLE.map((f) => ({ initials: f.initials, score: Math.round(firstScore * f.score), factory: true }));
}

/** The versus-screen table: real weekly history first, factory rows filling the rest, best first, ≤ 6 rows. */
export function hiScoreTable(k: KageState, you = S.kageYou): HiScoreRow[] {
  const history = k.history.slice().sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const first = k.history.slice().sort((a, b) => a[0] - b[0])[0]?.[1];
  const real: HiScoreRow[] = history.map(([week, score]) => ({ initials: you, score, week, factory: false }));
  const rows = [...real, ...factoryRows(first)].sort((a, b) => b.score - a.score || (a.factory === b.factory ? 0 : a.factory ? 1 : -1));
  return rows.slice(0, FACTORY_TABLE.length);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Availability                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** A Ghost Set is due when this week's has not been run (`week` 0 = never). */
export function kageDueThisWeek(k: KageState, today: EpochDay): boolean {
  return k.week === 0 || weekOf(today) > k.week;
}

/** The Monday the current week started. */
export function kageWeekStart(today: EpochDay): EpochDay {
  return weekStartDay(weekOf(today));
}

export interface KageStanding {
  week: number;
  due: boolean;
  beatenThisWeek: boolean;
  /** Best of the last 4 weeks (0 before any run). */
  best: number;
  lastScore: number | null;
  line: string;
}

export function kageStanding(k: KageState, today: EpochDay): KageStanding {
  const week = weekOf(today);
  const due = kageDueThisWeek(k, today);
  const beatenThisWeek = k.beatenWeek === week;
  const best = k.best4.length > 0 ? Math.max(...k.best4) : 0;
  const last = k.history.length > 0 ? (k.history[k.history.length - 1] as [number, number])[1] : null;
  let line: string;
  if (due) line = k.history.length === 0 ? S.kageFirstRun : S.kageIntro;
  else if (beatenThisWeek) line = S.kageBeat;
  else line = S.kageDone;
  return { week, due, beatenThisWeek, best, lastScore: last, line };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Building                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface KageOptions {
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
}

export function recentStepId(i: number): string {
  return `kage:r:${i}`;
}
export function matureStepId(i: number, exercise: DrillId): string {
  return `kage:m:${i}:${exercise}`;
}
export function isMatureKageStep(stepId: string): boolean {
  return stepId.startsWith('kage:m:');
}
export function exerciseOfKageStep(stepId: string): DrillId | null {
  const parts = stepId.split(':');
  return parts[0] === 'kage' && parts[1] === 'm' && parts[3] ? (parts[3] as DrillId) : null;
}

/** Deterministic per (seed, week): the same set all week, a different one next Monday. */
export async function buildKage(today: EpochDay, seed: string, o: KageOptions = {}): Promise<SessionPlan> {
  const week = weekOf(today);
  const weekSeed = hashSeed(seed, week);
  const ctx = await loadPlanContext({ loader: o.loader, available: o.available, seed: weekSeed, mode: 'kage' });
  // The whole week runs the same set in the same order: draws, the 14-day recency window and retrievability are
  // all anchored on the week's Monday, so items do not age in or out of the Ghost Set mid-week.
  ctx.rng = rngFor(seed, 'kage', week);
  const anchor = kageWeekStart(today);
  const pools = kagePools(store.cards, store.log.recent(5000), anchor, weekSeed);
  const matureKeys = new Set(pools.mature.map((c) => c.cardKey));
  const anchored = (c: QueueCard): QueueCard => {
    const t = store.cards.get(c.cardKey);
    return t ? { ...c, r: cardRetrievability(t, anchor) } : c;
  };
  const all: QueueCard[] = [...pools.recent, ...pools.mature].map(anchored);
  try {
    await ctx.loader.load(Array.from(new Set(all.map((c) => c.itemId))).filter((id) => ctx.loader.get(id) === undefined));
  } catch {
    /* offline: unloaded items are skipped */
  }
  const ordered = composeReviews(all);
  const steps: Step[] = [];
  let r = 0;
  let m = 0;
  for (const qc of ordered) {
    const mature = matureKeys.has(qc.cardKey);
    const s = stepForCard(ctx, { ...qc, exposures: Math.max(qc.exposures, 2) }, 'reviews', { id: mature ? `kage:m:${m}:pending` : recentStepId(r) });
    if (!s) continue;
    if (mature) {
      s.id = matureStepId(m, s.exercise);
      m++;
    } else {
      delete s.timerMs;
      r++;
    }
    steps.push(s);
  }
  const t = templateFor('kage', { belt: ctx.belt, station: ctx.station, backlog: false, dueCount: 0, weakTags: [], strandDeficit: null })[0]!;
  return finalizePlan(ctx, 'kage', [{ ...t, stepIds: steps.map((s) => s.id), steps }], { dueTotal: 0, dueTaken: steps.length, backlog: false, newCount: 0, scrollIds: [] });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scoring                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface KageScore {
  /** accuracy × speed index, × 1000, rounded. */
  score: number;
  accuracy: number;
  speedIndex: number;
  /** Additive: reps counted / mature reps measured. */
  reps: number;
  matureReps: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Accuracy over the set × the mean speed index of the mature half
 * (`clamp(median / observed, 0.5, 1.5)`; the median falls back to the 8 s rep
 * budget when the drill has none yet). Steps whose ids are not Kage ids are
 * treated as the whole set with no mature half.
 */
export function scoreKage(steps: StepResult[], medianMs: SaveMeta['medianMs']): KageScore {
  let set = steps.filter((s) => s.stepId.startsWith('kage:'));
  if (set.length === 0) set = steps;
  const reps = set.length;
  const correct = set.filter((s) => s.correct && !s.guard).length;
  const accuracy = reps > 0 ? correct / reps : 0;
  const mature = set.filter((s) => isMatureKageStep(s.stepId));
  let speedIndex = 1;
  if (mature.length > 0) {
    let sum = 0;
    for (const s of mature) {
      const ex = exerciseOfKageStep(s.stepId);
      const median = (ex ? medianMs[ex] : undefined) ?? DEFAULT_REP_MS;
      const observed = Math.max(1, s.ms);
      sum += clamp(median / observed, SPEED_INDEX_MIN, SPEED_INDEX_MAX);
    }
    speedIndex = sum / mature.length;
  }
  return {
    score: Math.round(accuracy * speedIndex * SCORE_SCALE),
    accuracy: Math.round(accuracy * 1000) / 1000,
    speedIndex: Math.round(speedIndex * 1000) / 1000,
    reps,
    matureReps: mature.length,
  };
}

/** Beat = strictly above the best of the last 4 weeks (never on the first run: the shadow is you). */
export function beatsKage(k: KageState, score: number): boolean {
  return k.best4.length > 0 && score > Math.max(...k.best4);
}

/**
 * Records this week's run and emits `kage:result`. A second run in the same
 * week is free play: nothing is written or emitted (`counted: false`).
 */
export function finishKage(score: number, week: number): { beat: boolean; counted: boolean } {
  const k = store.kage.value;
  if (k.week === week) return { beat: k.beatenWeek === week, counted: false };
  const beat = beatsKage(k, score);
  store.patch('kage', (prev) => {
    const history = prev.history.filter(([w]) => w !== week).concat([[week, score]]).sort((a, b) => a[0] - b[0]).slice(-HISTORY_KEEP);
    const best4 = history.slice(-BEST_WEEKS).map(([, s]) => s);
    const next: KageState = { ...prev, week, history, best4, wins: prev.wins + (beat ? 1 : 0) };
    if (beat) next.beatenWeek = week;
    return next;
  });
  bus.emit('kage:result', { week, score, beat });
  return { beat, counted: true };
}

/** Result line for the versus screen. */
export function kageResultLine(beat: boolean, firstRun: boolean): string {
  if (firstRun) return S.kageFirstRun;
  return beat ? S.kageBeat : S.kageHeld;
}
