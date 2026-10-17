/**
 * TSUZUKU — Three Kata 三つの型, the daily quests (design 03 §6, 04 §13).
 *
 * The 17 definitions live in `shared/catalog.ts` (strand, fromStation,
 * requires, phase); this module adds the progress event, the belt gate and
 * the deterministic daily draw: `shuffle(rngFor(seed, 'three-kata', day))`
 * over the catalog, then the first eligible quest per strand (never two of
 * one strand). Because the order is fixed per (seed, day), dropping an
 * ineligible quest never reshuffles the others, so a re-draw once the
 * exercise registry has filled keeps the quests the learner already saw.
 * Three gates beyond `fromStation`: `requires` (the drill is registered),
 * `NEEDS_FACET` (a card of that facet exists — `pitch-five` needs a `pitch`
 * card, which only a `pitchConfidence: high` item creates) and `canDo` (the
 * quest can still be completed today), all injected through `PickOptions` so
 * the draw stays pure. `canDo` is fed by the day's **gates**: the session
 * layer, which owns `scrollsForToday` and the Michikusa pool, calls
 * `setQuestGates(day, closed)` with the quests nothing can advance today
 * (`learn-scroll` with no Scroll left or in backlog mode, `michikusa-one`
 * once every fragment of stations ≤ current + 1 is collected — a re-read
 * emits nothing, design 04 §10) and then `revalidateQuests(store)`. A quest
 * already done today is never dropped by a gate, and a gate set for another
 * day is ignored, so yesterday's exhaustion never shapes today's roll. The
 * live draw clamps the station to ≥ 1 like the session builder (station 0 is
 * onboarding only).
 *
 * Per-quest counts persist on the quests slice as an extra JSON-safe prop
 * (`QuestsMemory.n`, like kiai's `lostCombo`); `done` is the contract field.
 * All three done = Full Training Day: `quest:completed { allDone: true }`
 * fires exactly once per day; XP (+50) and `stats.fullDays` follow it.
 */
import { BELTS, type Belt, type DrillId, type Facet } from '../content/types';
import { QUESTS as CATALOG, type QuestDef, type QuestId, type Strand } from '../shared/catalog';
import { bus, type Events } from '../shared/events';
import { isRegistered, listExercises } from '../shared/exercise-types';
import { rngFor, shuffle } from '../shared/hash';
import type { EpochDay, Quests, Store } from '../shared/store-types';
import { isDueReview } from './due';

export const QUEST_COUNT = 3;

export interface QuestRule extends QuestDef {
  /** Belt of `fromStation`. */
  minBelt: Belt;
  /** The bus event that advances the quest. */
  event: keyof Events;
}

const EVENT_OF: Record<QuestId, keyof Events> = {
  'clear-due': 'attempt:graded',
  'learn-scroll': 'scroll:completed',
  'read-episode': 'story:read',
  'shadow-five': 'line:scored',
  'combo-twenty': 'attempt:graded',
  'dictation-five': 'line:scored',
  'chain-three': 'attempt:graded',
  'nemesis-five': 'attempt:graded',
  'pitch-five': 'attempt:graded',
  'rapid-run': 'arcade:done',
  'michikusa-one': 'michikusa:read',
  'speed-read-one': 'story:read',
  'taiwa-aizuchi': 'roleplay:done',
  'three-ways-one': 'output:done',
  'outside-twenty': 'ledger:entry',
  'weak-set-one': 'weak-point:set-done',
  'writing-one': 'output:done',
};

export function beltOfStation(station: number): Belt {
  for (const b of BELTS) if (station >= b.stations[0] && station <= b.stations[1]) return b.id;
  return station <= 0 ? 'white' : 'black';
}

function firstStationOf(belt: Belt): number {
  return BELTS.find((b) => b.id === belt)?.stations[0] ?? 1;
}

export const QUESTS: readonly QuestRule[] = CATALOG.map((q) => ({ ...q, minBelt: beltOfStation(q.fromStation), event: EVENT_OF[q.id] }));

const BY_ID = new Map<QuestId, QuestRule>(QUESTS.map((q) => [q.id, q]));

export function questDef(id: QuestId): QuestRule | undefined {
  return BY_ID.get(id);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Daily draw                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PickOptions {
  /** Current station (default: the belt's first station, the conservative choice). */
  station?: number;
  /** Drill availability; default: the shared registry, or everything while it is still empty (boot). */
  isRegistered?: (id: DrillId) => boolean;
  /** Whether the learner holds any card of a facet (default: yes); gates the quests in `NEEDS_FACET`. */
  hasFacet?: (facet: Facet) => boolean;
  /** Whether the quest can still be completed today (default: yes); the live draw derives it from `setQuestGates`. */
  canDo?: (id: QuestId) => boolean;
}

/** Quests that can only advance once a card of this facet exists in the save. */
export const NEEDS_FACET: Partial<Record<QuestId, Facet>> = { 'pitch-five': 'pitch' };

/** While nothing is registered yet (before `ensureExercises()`), every drill counts as available. */
export function defaultRegistered(id: DrillId): boolean {
  return listExercises().length === 0 || isRegistered(id);
}

const ANY_FACET = (): boolean => true;
const ANY_QUEST = (): boolean => true;

export function eligibleQuests(
  station: number,
  reg: (id: DrillId) => boolean = defaultRegistered,
  hasFacet: (facet: Facet) => boolean = ANY_FACET,
  canDo: (id: QuestId) => boolean = ANY_QUEST,
): QuestRule[] {
  return QUESTS.filter((q) => {
    if (q.fromStation > station) return false;
    if (q.requires !== undefined && !reg(q.requires)) return false;
    const facet = NEEDS_FACET[q.id];
    if (facet !== undefined && !hasFacet(facet)) return false;
    return canDo(q.id);
  });
}

/* Day gates — set by the session layer, consulted by the live draw. */
let gates: { day: EpochDay; closed: ReadonlySet<QuestId> } | null = null;

/**
 * Declare the quests nothing can advance on `day` (replaces the previous
 * set). The session layer calls it from the Dojo feed / plan with
 * `learn-scroll` when `scrollsForToday` is empty or backlog mode is on and
 * `michikusa-one` when `michikusaFor(ctx).isNew` is false, then
 * `revalidateQuests(store)`.
 */
export function setQuestGates(day: EpochDay, closed: Iterable<QuestId>): void {
  gates = { day, closed: new Set(closed) };
}

/** `true` when `id` was declared uncompletable for `day`; gates set for another day do not count. */
export function questClosed(id: QuestId, day: EpochDay): boolean {
  return gates !== null && gates.day === day && gates.closed.has(id);
}

export function resetQuestGatesForTests(): void {
  gates = null;
}

/** Deterministic Three Kata for (seed, day): one quest per strand, in catalog-shuffled order. */
export function pickQuests(seed: string, day: EpochDay, belt: Belt, o: PickOptions = {}): QuestId[] {
  const station = o.station ?? firstStationOf(belt);
  const reg = o.isRegistered ?? defaultRegistered;
  const eligible = new Set(eligibleQuests(station, reg, o.hasFacet ?? ANY_FACET, o.canDo ?? ANY_QUEST).map((q) => q.id));
  const order = shuffle(rngFor(seed, 'three-kata', day), QUESTS);
  const used = new Set<Strand>();
  const out: QuestId[] = [];
  for (const q of order) {
    if (out.length >= QUEST_COUNT) break;
    if (!eligible.has(q.id) || used.has(q.strand)) continue;
    used.add(q.strand);
    out.push(q.id);
  }
  return out;
}

/** `true` when any card key ends in `#facet`. */
export function storeHasFacet(store: Store, facet: Facet): boolean {
  const suffix = `#${facet}`;
  let found = false;
  store.cards.forEach((k) => {
    if (!found && k.endsWith(suffix)) found = true;
  });
  return found;
}

/**
 * `pickQuests` over the live store (belt + station from the save; station 0
 * draws as station 1, like the builder). A quest gated closed for `day` is
 * skipped unless the slice already has it done today.
 */
export function pickDailyQuests(store: Store, day: EpochDay = store.today()): QuestId[] {
  const q = store.quests.value;
  return pickQuests(store.seed(), day, store.profile.value.belt, {
    station: Math.max(1, store.progress.value.station),
    hasFacet: (f) => storeHasFacet(store, f),
    canDo: (id) => !questClosed(id, day) || (q.day === day && q.done.includes(id)),
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Slice helpers                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/** The quests slice plus per-quest counts (JSON-safe extra prop). */
export interface QuestsMemory extends Quests {
  n?: Partial<Record<QuestId, number>>;
}

export function questCounts(q: Quests): Partial<Record<QuestId, number>> {
  return (q as QuestsMemory).n ?? {};
}

/** The slice for `day` with `ids`; progress on quests kept from the same day survives a re-draw. */
export function questsForDay(prev: Quests, day: EpochDay, ids: QuestId[]): Quests {
  if (prev.day === day && prev.ids.length === ids.length && prev.ids.every((id, i) => id === ids[i])) return prev;
  const sameDay = prev.day === day;
  const keep = new Set(ids);
  const prevN = questCounts(prev);
  const n: Partial<Record<QuestId, number>> = {};
  if (sameDay) for (const id of ids) if (prevN[id] !== undefined) n[id] = prevN[id];
  const out: QuestsMemory = { day, ids, done: sameDay ? prev.done.filter((id) => keep.has(id)) : [], n };
  return out;
}

export interface QuestProgress {
  id: QuestId;
  done: boolean;
  n: number;
  target: number;
}

export function questProgress(store: Store): QuestProgress[] {
  const q = store.quests.value;
  const counts = questCounts(q);
  return q.ids.map((id) => {
    const def = BY_ID.get(id);
    const target = def?.target ?? 1;
    const done = q.done.includes(id);
    return { id, done, n: done ? Math.max(target, counts[id] ?? 0) : Math.min(target, counts[id] ?? 0), target };
  });
}

export function isFullDay(q: Quests): boolean {
  return q.ids.length > 0 && q.ids.every((id) => q.done.includes(id));
}

/**
 * Advance one quest. `value` is the new count or an updater over the old
 * one. Returns the same object when nothing changes; `completed` is true on
 * the call that crosses the target.
 */
export function advanceQuest(q: Quests, id: QuestId, value: number | ((prev: number) => number)): { quests: Quests; completed: boolean } {
  if (!q.ids.includes(id) || q.done.includes(id)) return { quests: q, completed: false };
  const def = BY_ID.get(id);
  const target = def?.target ?? 1;
  const prev = questCounts(q)[id] ?? 0;
  const next = Math.max(prev, typeof value === 'function' ? value(prev) : value);
  if (next === prev) return { quests: q, completed: false };
  const completed = next >= target;
  const out: QuestsMemory = { ...q, n: { ...questCounts(q), [id]: next }, done: completed ? [...q.done, id] : q.done };
  return { quests: out, completed };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducer                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const ARCADE: ReadonlySet<string> = new Set(['rapid-fire', 'gojuon-fighter']);

/** Reviews due on `day` (same predicate as the builder: never-reviewed state-0 cards are not reviews). */
function dueReviewCount(store: Store, day: EpochDay): number {
  let n = 0;
  store.cards.forEach((_k, t) => {
    if (isDueReview(t, day)) n++;
  });
  return n;
}

/**
 * Re-draw for today when the registry, the station or the day gates changed
 * since the roll (boot runs before `ensureExercises()`; onboarding moves the
 * learner from station 0, where nothing is drawable; the session layer
 * closes gates once it knows what today can offer). The draw order is
 * stable, so quests that are still eligible stay, with their progress.
 * No-op until the roll has run for today.
 */
export function revalidateQuests(store: Store): void {
  const q = store.quests.value;
  const today = store.today();
  if (q.day !== today) return;
  const ids = pickDailyQuests(store, today);
  if (ids.length === q.ids.length && ids.every((id, i) => id === q.ids[i])) return;
  store.patch('quests', (prev) => questsForDay(prev, today, ids));
}

export function startQuests(store: Store): () => void {
  function advance(id: QuestId, value: number | ((prev: number) => number)): void {
    const q = store.quests.value;
    if (q.day !== store.today()) return;
    const r = advanceQuest(q, id, value);
    if (r.quests === q) return;
    store.patch('quests', () => r.quests);
    if (r.completed) bus.emit('quest:completed', { id, allDone: isFullDay(r.quests) });
  }

  const offs = [
    bus.on('session:started', () => revalidateQuests(store)),
    bus.on('attempt:graded', (p) => {
      if (ARCADE.has(p.exercise)) return;
      if (p.rating !== null) advance('clear-due', (n) => n + 1);
      advance('combo-twenty', (n) => Math.max(n, p.combo));
      if (p.exercise === 'form-chain') advance('chain-three', (n) => n + 1);
      if (p.exercise === 'nemesis-duel') advance('nemesis-five', (n) => n + 1);
      if (p.exercise === 'pitch-ear') advance('pitch-five', (n) => n + 1);
    }),
    bus.on('session:finished', (p) => {
      if (ARCADE.has(p.mode) || p.mode === 'rapid' || p.mode === 'gojuon') return;
      const today = store.today();
      const n = questCounts(store.quests.value)['clear-due'] ?? 0;
      if (n > 0 && dueReviewCount(store, today) === 0) advance('clear-due', BY_ID.get('clear-due')?.target ?? 50);
    }),
    bus.on('scroll:completed', () => advance('learn-scroll', (n) => n + 1)),
    bus.on('story:read', (p) => {
      if (p.mode === 'speed') advance('speed-read-one', (n) => n + 1);
      else if (p.total > 0 && p.correct / p.total >= 2 / 3) advance('read-episode', (n) => n + 1);
    }),
    bus.on('line:scored', (p) => advance(p.kind === 'shadow' ? 'shadow-five' : 'dictation-five', (n) => n + 1)),
    bus.on('arcade:done', (p) => {
      if (p.mode === 'rapid') advance('rapid-run', (n) => n + 1);
    }),
    bus.on('michikusa:read', () => advance('michikusa-one', (n) => n + 1)),
    bus.on('roleplay:done', (p) => {
      if (p.aizuchiTotal > 0 && p.aizuchiHit >= p.aizuchiTotal) advance('taiwa-aizuchi', (n) => n + 1);
    }),
    bus.on('output:done', (p) => {
      if (p.kind === 'three-ways') advance('three-ways-one', (n) => n + 1);
      if (p.kind === 'writing') advance('writing-one', (n) => n + 1);
    }),
    bus.on('ledger:entry', (p) => {
      if (p.source === 1 && p.minutes > 0) advance('outside-twenty', (n) => n + Math.round(p.minutes));
    }),
    bus.on('weak-point:set-done', () => advance('weak-set-one', (n) => n + 1)),
  ];

  return () => {
    for (const off of offs) off();
  };
}
