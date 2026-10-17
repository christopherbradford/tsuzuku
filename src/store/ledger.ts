/**
 * TSUZUKU — Input Ledger 耳目帳 (design 05 §9).
 *
 * Entries are `[day, minutes, kind, source]` (kinds listen · read · watch ·
 * speak; sources app · external). In-app story and listening minutes are
 * logged automatically by `startLedger`; outside minutes come from the
 * end-card prompt or the Ledger page through `addLedgerEntry`, which emits
 * `ledger:entry` AFTER the slice holds the row so `xp.ts` can derive the
 * daily caps from the slice. Field Missions go through `logMission`
 * (`ledger.missions` + a ledger row + `field-mission:done`).
 *
 * Hours: `ledgerHours(m)` by kind (all sources; compacted months count
 * toward the total only); `ledgerHoursBy` filters by source / since;
 * `ledgerByWeek` groups the last N weeks. Weekly target by belt:
 * White 0.5 · Yellow–Orange 1 · Green 3 · Blue–Purple 5 · Brown 7 · Black 8
 * · Dan 8 h. The lifetime goal is 1,500 h and runs past Kyoto.
 */
import type { Belt } from '../content/types';
import { MISSIONS, type MissionDef } from '../shared/catalog';
import { bus } from '../shared/events';
import { weekOf } from '../shared/time';
import {
  LEDGER_KINDS,
  type EpochDay,
  type Ledger,
  type LedgerEntry,
  type LedgerKind,
  type LedgerKindName,
  type LedgerSource,
  type SaveMeta,
  type Store,
} from '../shared/store-types';
import { store as liveStore } from './store';

export const LEDGER_GOAL_HOURS = 1500;
/** External listening hours before the Perapera 耳 axis uncaps (design 05 §11). */
export const EAR_UNCAP_HOURS = 20;

export const WEEKLY_TARGET_HOURS: Record<Belt, number> = {
  white: 0.5,
  yellow: 1,
  orange: 1,
  green: 3,
  blue: 5,
  purple: 5,
  brown: 7,
  black: 8,
};
export const DAN_WEEKLY_TARGET_HOURS = 8;

export function weeklyTargetHours(belt: Belt, dan: number): number {
  return dan > 0 ? DAN_WEEKLY_TARGET_HOURS : WEEKLY_TARGET_HOURS[belt];
}

export const KIND_INDEX: Record<LedgerKindName, LedgerKind> = { listen: 0, read: 1, watch: 2, speak: 3 };

/** Ledger kind a mission's minutes are logged under. */
export function missionKind(m: MissionDef): LedgerKind {
  switch (m.tier) {
    case 1:
      return KIND_INDEX.read;
    case 3:
      return KIND_INDEX.watch;
    default:
      return KIND_INDEX.speak;
  }
}

export interface LedgerInput {
  day: EpochDay;
  minutes: number;
  kind: LedgerKind;
  source: LedgerSource;
  /** Free text → the row's 5th column (`LedgerEntry[4]`); also mirrored into `bookmarks` prefixed by the day. */
  note?: string;
}

function sanitizeMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(24 * 60, Math.max(0, Math.round(minutes)));
}

/** Pure: the ledger with one more row (rows stay sorted by day). */
export function withEntry(l: Ledger, e: LedgerInput): Ledger {
  const minutes = sanitizeMinutes(e.minutes);
  if (minutes <= 0) return l;
  const note = e.note?.trim();
  const row: LedgerEntry = note ? [e.day, minutes, e.kind, e.source, note] : [e.day, minutes, e.kind, e.source];
  const entries = l.entries.slice();
  let i = entries.length;
  while (i > 0 && (entries[i - 1] as LedgerEntry)[0] > e.day) i--;
  entries.splice(i, 0, row);
  return { ...l, entries };
}

/** Add a row and announce it. Minutes ≤ 0 are ignored. */
export function addLedgerEntry(e: LedgerInput, s: Store = liveStore): void {
  const minutes = sanitizeMinutes(e.minutes);
  if (minutes <= 0) return;
  s.patch('ledger', (l) => withEntry(l, { ...e, minutes }));
  if (e.note && e.note.trim().length > 0) {
    const line = `${e.day}: ${e.note.trim()}`;
    s.patch('bookmarks', (b) => (b.includes(line) ? b : [...b, line]));
  }
  bus.emit('ledger:entry', { minutes, kind: e.kind, source: e.source });
}

/** Log a Field Mission by catalog id. Unknown ids are ignored. */
export function logMission(id: string, minutes: number, s: Store = liveStore): void {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) return;
  const today = s.today();
  const mins = sanitizeMinutes(minutes) || m.minutes;
  s.patch('ledger', (l) => ({ ...l, missions: [...l.missions, { day: today, tier: m.tier, conversation: m.conversation }] }));
  addLedgerEntry({ day: today, minutes: mins, kind: missionKind(m), source: 1 }, s);
  bus.emit('field-mission:done', { tier: m.tier, minutes: mins, conversation: m.conversation });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Aggregation                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export interface LedgerHours {
  total: number;
  listen: number;
  read: number;
  watch: number;
  speak: number;
}

export interface HoursFilter {
  source?: LedgerSource;
  /** Inclusive first day. */
  since?: EpochDay;
  /** Inclusive last day. */
  until?: EpochDay;
  /** Count `ledger.monthly` (compacted rows older than two years; kind unknown) toward `total`. Default: only with no filter. */
  includeMonthly?: boolean;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Hours by kind over the rows matching `f`. */
export function ledgerHoursBy(m: SaveMeta, f: HoursFilter = {}): LedgerHours {
  const mins: Record<LedgerKindName, number> = { listen: 0, read: 0, watch: 0, speak: 0 };
  for (const e of m.ledger.entries) {
    if (f.source !== undefined && e[3] !== f.source) continue;
    if (f.since !== undefined && e[0] < f.since) continue;
    if (f.until !== undefined && e[0] > f.until) continue;
    mins[LEDGER_KINDS[e[2]] ?? 'listen'] += e[1];
  }
  let total = mins.listen + mins.read + mins.watch + mins.speak;
  const includeMonthly = f.includeMonthly ?? (f.source === undefined && f.since === undefined && f.until === undefined);
  if (includeMonthly) for (const v of Object.values(m.ledger.monthly)) total += v;
  return {
    total: round2(total / 60),
    listen: round2(mins.listen / 60),
    read: round2(mins.read / 60),
    watch: round2(mins.watch / 60),
    speak: round2(mins.speak / 60),
  };
}

/** Lifetime hours by kind, every source, compacted months included in the total. */
export function ledgerHours(m: SaveMeta): LedgerHours {
  return ledgerHoursBy(m);
}

/** Hours of external listen + watch (the Perapera 耳 cap input). */
export function externalListeningHours(m: SaveMeta): number {
  const h = ledgerHoursBy(m, { source: 1 });
  return round2(h.listen + h.watch);
}

export interface WeekRow {
  /** Absolute Monday-based week index (`time.weekOf`). */
  week: number;
  /** Monday of the week. */
  start: EpochDay;
  minutes: Record<LedgerKindName, number>;
  external: number;
  app: number;
  total: number;
}

/** The last `weeks` weeks ending in `today`'s week, oldest first. */
export function ledgerByWeek(m: SaveMeta, today: EpochDay, weeks = 12): WeekRow[] {
  const last = weekOf(today);
  const first = last - Math.max(1, weeks) + 1;
  const rows = new Map<number, WeekRow>();
  for (let w = first; w <= last; w++) {
    rows.set(w, { week: w, start: w * 7 - 3, minutes: { listen: 0, read: 0, watch: 0, speak: 0 }, external: 0, app: 0, total: 0 });
  }
  for (const e of m.ledger.entries) {
    const w = weekOf(e[0]);
    const row = rows.get(w);
    if (!row) continue;
    row.minutes[LEDGER_KINDS[e[2]] ?? 'listen'] += e[1];
    if (e[3] === 1) row.external += e[1];
    else row.app += e[1];
    row.total += e[1];
  }
  return Array.from(rows.values());
}

/** External minutes logged in `today`'s week versus the belt's weekly target. */
export function weekProgress(m: SaveMeta, today: EpochDay): { minutes: number; targetHours: number; ratio: number } {
  const w = weekOf(today);
  const h = ledgerHoursBy(m, { source: 1, since: w * 7 - 3, until: w * 7 + 3 });
  const minutes = Math.round(h.total * 60);
  const targetHours = weeklyTargetHours(m.profile.belt, m.profile.dan);
  return { minutes, targetHours, ratio: targetHours > 0 ? Math.min(1, minutes / (targetHours * 60)) : 1 };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducer                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export function startLedger(store: Store): () => void {
  const offs = [
    bus.on('story:read', (p) => {
      addLedgerEntry({ day: store.today(), minutes: p.minutes, kind: KIND_INDEX.read, source: 0 }, store);
    }),
    bus.on('listening:set', (p) => {
      addLedgerEntry({ day: store.today(), minutes: p.minutes, kind: KIND_INDEX.listen, source: 0 }, store);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
