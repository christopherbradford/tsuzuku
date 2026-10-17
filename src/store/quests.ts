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
 *
 * Per-quest counts persist on the quests slice as an extra JSON-safe prop
 * (`QuestsMemory.n`, like kiai's `lostCombo`); `done` is the contract field.
 * All three done = Full Training Day: `quest:completed { allDone: true }`
 * fires exactly once per day; XP (+50) and `stats.fullDays` follow it.
 */
import { BELTS, type Belt, type DrillId } from '../content/types';
import { QUESTS as CATALOG, type QuestDef, type QuestId, type Strand } from '../shared/catalog';
import { bus, type Events } from '../shared/events';
import { isRegistered, listExercises } from '../shared/exercise-types';
import { rngFor, shuffle } from '../shared/hash';
import type { EpochDay, Quests, Store } from '../shared/store-types';

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
}

/** While nothing is registered yet (before `ensureExercises()`), every drill counts as available. */
export function defaultRegistered(id: DrillId): boolean {
  return listExercises().length === 0 || isRegistered(id);
}

export function eligibleQuests(station: number, reg: (id: DrillId) => boolean = defaultRegistered): QuestRule[] {
  return QUESTS.filter((q) => q.fromStation <= station && (q.requires === undefined || reg(q.requires)));
}

/** Deterministic Three Kata for (seed, day): one quest per strand, in catalog-shuffled order. */
export function pickQuests(seed: string, day: EpochDay, belt: Belt, o: PickOptions = {}): QuestId[] {
  const station = o.station ?? firstStationOf(belt);
  const reg = o.isRegistered ?? defaultRegistered;
  const eligible = new Set(eligibleQuests(station, reg).map((q) => q.id));
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

/** `pickQuests` over the live store (belt + station from the save). */
export function pickDailyQuests(store: Store, day: EpochDay = store.today()): QuestId[] {
  return pickQuests(store.seed(), day, store.profile.value.belt, { station: store.progress.value.station });
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

export function startQuests(store: Store): () => void {
  function advance(id: QuestId, value: number | ((prev: number) => number)): void {
    const q = store.quests.value;
    if (q.day !== store.today()) return;
    const r = advanceQuest(q, id, value);
    if (r.quests === q) return;
    store.patch('quests', () => r.quests);
    if (r.completed) bus.emit('quest:completed', { id, allDone: isFullDay(r.quests) });
  }

  /**
   * Re-draw for today when the registry or the station changed since the
   * roll (boot runs before `ensureExercises()`; onboarding moves the learner
   * from station 0, where nothing is drawable). The draw order is stable, so
   * quests that are still eligible stay, with their progress.
   */
  function revalidate(): void {
    const q = store.quests.value;
    const today = store.today();
    if (q.day !== today) return;
    const ids = pickDailyQuests(store, today);
    if (ids.length === q.ids.length && ids.every((id, i) => id === q.ids[i])) return;
    store.patch('quests', (prev) => questsForDay(prev, today, ids));
  }

  const offs = [
    bus.on('session:started', revalidate),
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
      if (n > 0 && store.cards.dueOn(today).length === 0) advance('clear-due', BY_ID.get('clear-due')?.target ?? 50);
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
