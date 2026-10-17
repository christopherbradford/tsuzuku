/**
 * TSUZUKU — Nemesis (宿敵) detection and the Duel chain (design 04 §9, 05 §8).
 *
 *  ≥ 8 lapses on a facet → Nemesis (flag 2): dossier that day, 14 days in
 *  context only (cloze, story), then the Duel chain prod → listen → cloze.
 *  3 duel wins on 3 distinct days → defeated: flag cleared, S reset to 3 d.
 *
 * Pure: the day of a log entry comes from an injectable `dayOfMs`.
 */
import { DRILL_IDS, type CardKey, type Facet } from '../content/types';
import { cardKey, parseCardKey } from '../shared/ids';
import { CardFlag, hasFlag, withFlag, withoutFlag, type CardTuple, type EpochDay, type LogEntry } from '../shared/store-types';
import { dayOf } from '../shared/time';

/** Lapses on one facet that make an item a Nemesis. */
export const NEMESIS_LAPSES = 8;
/** Days of context-only exposure after the dossier. */
export const NEMESIS_CONTEXT_DAYS = 14;
/** Duel wins, on distinct days, needed to defeat a Nemesis. */
export const DUEL_WINS = 3;
/** Stability after a defeat, days. */
export const DEFEAT_STABILITY = 3;
/** Duel chain order. */
export const DUEL_CHAIN: readonly Facet[] = ['prod', 'listen', 'cloze'];

export type NemesisPhase = 'dossier' | 'context' | 'duel' | 'none';

const DUEL_IDX = DRILL_IDS.indexOf('nemesis-duel');

export interface LeechOptions {
  /** Converts a log timestamp to an epoch day (default host zone). */
  dayOfMs?: (ms: number) => EpochDay;
  /** Count only log rows at or after this timestamp (e.g. the day the Nemesis was flagged). */
  sinceMs?: number;
  /** Facets the item actually has; the chain is filtered to them. */
  available?: readonly Facet[];
}

/** The card carries the Nemesis flag. */
export function isNemesis(card: CardTuple): boolean {
  return hasFlag(card[7], CardFlag.nemesis);
}

/** Lapses have reached the threshold and the card is not flagged yet. */
export function qualifiesNemesis(card: CardTuple): boolean {
  return card[4] >= NEMESIS_LAPSES && !isNemesis(card);
}

/** Sets the Nemesis flag (immutable). */
export function markNemesis(card: CardTuple): CardTuple {
  const next = card.slice() as CardTuple;
  next[7] = withFlag(card[7], CardFlag.nemesis);
  return next;
}

function entriesFor(log: readonly LogEntry[], key: CardKey, sinceMs?: number): LogEntry[] {
  return log.filter((e) => e[1] === key && (sinceMs === undefined || e[0] >= sinceMs)).sort((a, b) => a[0] - b[0]);
}

/**
 * Day the card became a Nemesis: the day of the Again that pushed its lapses
 * to the threshold (the `lapses − 7`-th most recent Again in the log). Falls
 * back to the card's last-review day when the log ring no longer holds it.
 */
export function nemesisDay(card: CardTuple, log: readonly LogEntry[], key: CardKey, o: LeechOptions = {}): EpochDay {
  const dayOfMs = o.dayOfMs ?? dayOf;
  const agains = entriesFor(log, key).filter((e) => e[2] === 1);
  const fromEnd = Math.max(1, card[4] - NEMESIS_LAPSES + 1);
  const hit = agains[agains.length - fromEnd];
  return hit ? dayOfMs(hit[0]) : card[6];
}

/**
 * Phase of a Nemesis card today. `key` is needed to find the card's rows in
 * the log; without it the phase is derived from `card.last`.
 */
export function nemesisPhase(card: CardTuple, log: readonly LogEntry[], today: EpochDay, key?: CardKey, o: LeechOptions = {}): NemesisPhase {
  if (!isNemesis(card)) return 'none';
  const since = key ? nemesisDay(card, log, key, o) : card[6];
  if (today <= since) return 'dossier';
  if (today < since + NEMESIS_CONTEXT_DAYS) return 'context';
  return 'duel';
}

/** Rows written by `nemesis-duel` for any facet of `itemId`. */
export function duelEntries(log: readonly LogEntry[], itemId: string, sinceMs?: number): LogEntry[] {
  return log
    .filter((e) => e[4] === DUEL_IDX && (sinceMs === undefined || e[0] >= sinceMs))
    .filter((e) => {
      try {
        return parseCardKey(e[1]).itemId === itemId;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a[0] - b[0]);
}

/** The chain for an item: `DUEL_CHAIN` filtered to its facets, or its facets when none match. */
export function duelChain(available?: readonly Facet[]): readonly Facet[] {
  if (!available || available.length === 0) return DUEL_CHAIN;
  const filtered = DUEL_CHAIN.filter((f) => available.includes(f));
  return filtered.length > 0 ? filtered : available;
}

/**
 * Duel progress: wins are duel rows rated ≥ Good, counted at most once per
 * distinct day; `days` lists those days; `next` is the facet to duel next
 * (`null` once 3 wins are in).
 */
export function duelProgress(log: readonly LogEntry[], itemId: string, o: LeechOptions = {}): { wins: number; days: EpochDay[]; next: Facet | null } {
  const dayOfMs = o.dayOfMs ?? dayOf;
  const days = new Set<EpochDay>();
  for (const e of duelEntries(log, itemId, o.sinceMs)) if (e[2] >= 3) days.add(dayOfMs(e[0]));
  const sorted = Array.from(days).sort((a, b) => a - b);
  const wins = Math.min(DUEL_WINS, sorted.length);
  const chain = duelChain(o.available);
  const next = wins >= DUEL_WINS ? null : (chain[wins % chain.length] ?? null);
  return { wins, days: sorted, next };
}

/** Card key of the next duel rep for `itemId`, or `null` when the duel is won. */
export function nextDuelKey(log: readonly LogEntry[], itemId: string, o: LeechOptions = {}): CardKey | null {
  const { next } = duelProgress(log, itemId, o);
  return next ? cardKey(itemId, next) : null;
}

/** A win today already counted? (one win per day). */
export function wonToday(log: readonly LogEntry[], itemId: string, today: EpochDay, o: LeechOptions = {}): boolean {
  return duelProgress(log, itemId, o).days.includes(today);
}

/**
 * Defeat: clears the Nemesis flag, resets S to 3 d, lapses to 0 (a fresh
 * count toward any future Nemesis), review state, due in 3 days.
 */
export function defeat(card: CardTuple, today: EpochDay): CardTuple {
  return [today + DEFEAT_STABILITY, DEFEAT_STABILITY, card[2], card[3], 0, 2, today, withoutFlag(card[7], CardFlag.nemesis)];
}
