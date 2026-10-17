/**
 * TSUZUKU — facet lifecycle (design 05 §2, §3, §8).
 *
 *  - card creation per item kind (`initialFacets`), and every facet an item may
 *    ever grow (`facetsFor`);
 *  - staggered facet unlock with warm start (S₀ = k × S_parent, D₀ = D_parent):
 *      vocab   listen  rec   S ≥ 2 d  × 0.5
 *      vocab   prod    rec   S ≥ 4 d  × 0.3
 *      vocab   pitch   prod  S ≥ 7 d  × 0.5   (only `pitchConfidence: 'high'`)
 *      kanji   read    comp  S ≥ 1 d  × 0.5
 *      grammar prod    cloze S ≥ 7 d  × 0.4
 *  - in-session steps: new cards owe +3/+10, a learning miss +3, a lapse +5
 *    (`STEP_OFFSETS`; the runner reads the step-pending flag);
 *  - Kaiden lane: every facet S ≥ 120 d; daily share max(10, 15 % of the cap);
 *  - archival: kana S > 180 d, component / pitch S > 90 d;
 *  - 既知 Easy start (`kichiStart`).
 *
 * Kaiden max interval. Design 05 §1 caps intervals at 365 d. The lane's own
 * assertion (15k Kaiden cards, cap 240 → quota 36/day, overdue ≤ 7 d) is
 * arithmetically impossible at 365 (15,000 / 365 ≈ 41 due/day > 36), so
 * Kaiden-flagged cards schedule with `KAIDEN_MAX_INTERVAL` = 730 d
 * (15,000 / 730 ≈ 21/day). Everything else keeps 365.
 */
import type { ContentItem, Facet, VocabItem } from '../content/types';
import { CardFlag, hasFlag, withFlag, withoutFlag, type CardTuple, type EpochDay, type ItemKind, type Rating } from '../shared/store-types';
import { MAX_INTERVAL, RATING_EASY, round2, schedule, stepPending as fsrsStepPending, type FsrsScheduleOpts } from './fsrs';

export interface UnlockRule {
  kind: ItemKind;
  facet: Facet;
  from: Facet;
  /** Parent stability threshold (days). */
  minS: number;
  /** Warm-start factor on the parent's stability. */
  factor: number;
  /** Extra item condition. */
  requires?: 'pitchHigh';
}

export const UNLOCK_RULES: readonly UnlockRule[] = [
  { kind: 'vocab', facet: 'listen', from: 'rec', minS: 2, factor: 0.5 },
  { kind: 'vocab', facet: 'prod', from: 'rec', minS: 4, factor: 0.3 },
  { kind: 'vocab', facet: 'pitch', from: 'prod', minS: 7, factor: 0.5, requires: 'pitchHigh' },
  { kind: 'kanji', facet: 'read', from: 'comp', minS: 1, factor: 0.5 },
  { kind: 'grammar', facet: 'prod', from: 'cloze', minS: 7, factor: 0.4 },
];

/** Archive thresholds in days of stability (strictly greater). */
export const ARCHIVE_THRESHOLDS = { kana: 180, component: 90, pitch: 90 } as const;

export const KAIDEN_S = 120;
export const KAIDEN_SHARE = 0.15;
export const KAIDEN_MIN = 10;
/** See the module header. */
export const KAIDEN_MAX_INTERVAL = 730;

/** In-session re-presentation offsets, in reps. */
export const STEP_OFFSETS = { intro: [3, 10], learningMiss: [3], relearn: [5] } as const;

/** Facets created at introduction. */
export function initialFacets(kind: ItemKind): Facet[] {
  switch (kind) {
    case 'kana':
      return ['rec', 'prod'];
    case 'component':
      return ['rec'];
    case 'vocab':
      return ['rec'];
    case 'kanji':
      return ['comp'];
    case 'grammar':
      return ['cloze'];
    case 'chunk':
      return ['prod'];
  }
}

/** A `VocabItem` whose pitch is dataset-confirmed spawns a pitch card. */
export function hasPitchCard(item: ContentItem | undefined): boolean {
  if (!item || !('pos' in item) || !('meanings' in item)) return false;
  const v = item as VocabItem;
  return v.pitch !== undefined && v.pitchConfidence === 'high';
}

/** Every facet an item of this kind may ever have (pitch only with the item's confidence). */
export function facetsFor(kind: ItemKind, item?: ContentItem): Facet[] {
  const out = initialFacets(kind);
  for (const r of UNLOCK_RULES) {
    if (r.kind !== kind) continue;
    if (r.requires === 'pitchHigh' && !hasPitchCard(item)) continue;
    out.push(r.facet);
  }
  return out;
}

/** A never-reviewed card, due today, state 0. */
export function newCard(today: EpochDay): CardTuple {
  return [today, 0, 0, 0, 0, 0, today, 0];
}

/**
 * Warm-started child facet: S₀ = factor × S_parent, D₀ = D_parent, review state,
 * due today (its first rep is the introduction of the facet; no +3/+10 steps).
 */
export function warmStart(parent: CardTuple, factor: number, today: EpochDay): CardTuple {
  const s0 = Math.max(0.01, round2(parent[1] * factor));
  const d0 = parent[2] > 0 ? parent[2] : 5;
  return [today, s0, d0, 0, 0, 2, today, 0];
}

/** Facets that may be created now, with their parent and warm-start factor. */
export function unlockableFacets(
  itemId: string,
  kind: ItemKind,
  item: ContentItem | undefined,
  cards: Partial<Record<Facet, CardTuple>>,
): { facet: Facet; from: Facet; factor: number }[] {
  void itemId;
  const out: { facet: Facet; from: Facet; factor: number }[] = [];
  for (const r of UNLOCK_RULES) {
    if (r.kind !== kind) continue;
    if (cards[r.facet]) continue;
    if (r.requires === 'pitchHigh' && !hasPitchCard(item)) continue;
    const parent = cards[r.from];
    if (!parent) continue;
    if (hasFlag(parent[7], CardFlag.archived)) continue;
    if (parent[1] < r.minS) continue;
    out.push({ facet: r.facet, from: r.from, factor: r.factor });
  }
  return out;
}

/** Threshold check only (the writer decides whether to flag). */
export function shouldArchive(kind: ItemKind, facet: Facet, card: CardTuple): boolean {
  const s = card[1];
  if (kind === 'kana') return s > ARCHIVE_THRESHOLDS.kana;
  if (kind === 'component') return s > ARCHIVE_THRESHOLDS.component;
  if (facet === 'pitch') return s > ARCHIVE_THRESHOLDS.pitch;
  return false;
}

/** Every present facet has S ≥ 120 d (and there is at least one). */
export function isKaiden(cards: Partial<Record<Facet, CardTuple>>): boolean {
  let n = 0;
  for (const c of Object.values(cards)) {
    if (!c) continue;
    n++;
    if (c[1] < KAIDEN_S) return false;
  }
  return n > 0;
}

export function withKaidenFlag(card: CardTuple, kaiden: boolean): CardTuple {
  const flags = kaiden ? withFlag(card[7], CardFlag.kaiden) : withoutFlag(card[7], CardFlag.kaiden);
  if (flags === card[7]) return card;
  return [card[0], card[1], card[2], card[3], card[4], card[5], card[6], flags];
}

export interface ScheduleOpts extends FsrsScheduleOpts {
  retention: number;
  loadOnDay: (d: EpochDay) => number;
  rng: () => number;
  maxInterval?: number;
}

/**
 * FSRS over a card. Kaiden-flagged cards use `KAIDEN_MAX_INTERVAL` unless the
 * caller passes `maxInterval`. `stepPending` reports whether the runner owes
 * in-session steps (+3/+10 on a new card, +3 on a learning miss, +5 on a lapse).
 */
export function applyRating(card: CardTuple, g: Rating, today: EpochDay, o: ScheduleOpts): { card: CardTuple; stepPending: boolean } {
  const maxInterval = o.maxInterval ?? (hasFlag(card[7], CardFlag.kaiden) ? KAIDEN_MAX_INTERVAL : MAX_INTERVAL);
  const next = schedule(card, g, today, { ...o, maxInterval });
  return { card: next, stepPending: fsrsStepPending(next) };
}

/** Which in-session offsets a just-rated card owes, in reps from now. */
export function stepOffsetsFor(prev: CardTuple, g: Rating): readonly number[] {
  if (g === RATING_EASY) return [];
  if (prev[5] === 0) return STEP_OFFSETS.intro;
  if (prev[5] === 2) return g === 1 ? STEP_OFFSETS.relearn : [];
  return g === 1 ? STEP_OFFSETS.learningMiss : [];
}

/** Kaiden lane share of today's review cap: max(10, 15 %). */
export function kaidenQuota(reviewCap: number): number {
  return Math.max(KAIDEN_MIN, Math.round(KAIDEN_SHARE * Math.max(0, reviewCap)));
}

/** 既知 "I already know this": Easy on a new card, straight to review, no steps. */
export function kichiStart(today: EpochDay, o: ScheduleOpts): CardTuple {
  return applyRating(newCard(today), RATING_EASY, today, o).card;
}
