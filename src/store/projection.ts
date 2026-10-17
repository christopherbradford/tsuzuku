/**
 * TSUZUKU — Projected Arrival (design 02 §6.2) and the onboarding honesty
 * estimates (design 01 §2, 02 §6.1).
 *
 *   adherence  = clamp(activeDays(last 28) / 28, 0.3, 1)
 *   realized   = itemsIntroduced(last 28) / activeDays(last 28)
 *   rate(s)    = clamp(realized, 1, newPerDay(belt of s, setting))
 *   gateWait(s)= max(1, 7 − daysSinceLastIntro(s))
 *   daysFor(s) = remaining(s) / rate(s) + gateWait(s)   (+ 2 at a Shinsa station)
 *   projected  = today + Σ daysFor(s) / adherence       (±20 % band)
 *
 * "daily" = adherence 1.0 at the full setting. Null before 14 active days,
 * when `onboardingEstimate` (100 % / 70 % adherence from the station quotas
 * and the preset) stands in. Remaining items come from the StationBundle ids
 * minus the learner's cards; a station whose bundle is not loaded is counted
 * from its quota (`STATIONS`, kana per design 02 §1) and the result says so.
 * The estimate is monotone in remaining items and in realized logs, never
 * earlier than the 1-item/day floor, and never red or counted down (UI).
 */
import { baseFacet, kindOfCards } from '@/learn';
import { BELTS, BELT_IDS, STATIONS, type Belt, type Facet, type StationBundle } from '../content/types';
import { parseCardKey } from '../shared/ids';
import { epochDay } from '../shared/time';
import type { CardTuple, CardsApi, EpochDay, LogEntry, SaveMeta, Settings } from '../shared/store-types';
import { INTENSITY_SCALE, KANA_PER_DAY, STANDARD_NEW_PER_DAY, effectiveNewPerDay, newPerDayTotal } from './defaults';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const MIN_ACTIVE_DAYS = 14;
export const WINDOW_DAYS = 28;
export const ADHERENCE_FLOOR = 0.3;
export const BAND = 0.2;
export const GATE_WAIT_MAX = 7;
export const SHINSA_DAYS = 2;
/** One day per Gatekeeper in the onboarding estimate (design 02 §6.1). */
export const GATE_DAYS = 1;
export const ARRIVAL_STATION = 53;

/** Kana introduced per White station (design 02 §1: 71 + 79 + 88 = 238). */
export const KANA_PER_STATION: Readonly<Record<number, number>> = { 1: 71, 2: 79, 3: 88 };

/** Stations whose Gatekeeper precedes a Shinsa (9 15 24 31 38 46 53). */
export const SHINSA_STATIONS: readonly number[] = BELTS.filter((b) => b.id !== 'white').map((b) => b.stations[1]);

/** Design 02 §6.1 steady-state reviews/day and expected in-app minutes/day at Standard. */
const STEADY_REVIEWS_STANDARD: Record<Belt, number> = { white: 60, yellow: 130, orange: 130, green: 180, blue: 220, purple: 220, brown: 290, black: 270 };
const EXPECTED_MINUTES_STANDARD: Record<Belt, number> = { white: 15, yellow: 25, orange: 25, green: 32, blue: 45, purple: 45, brown: 58, black: 55 };
const SECONDS_PER_REP = 8;
const STANDARD_N5_TOTAL = newPerDayTotal(STANDARD_NEW_PER_DAY.yellow);

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function dayIn(ms: number, tz: string): EpochDay {
  try {
    return epochDay(ms, tz);
  } catch {
    return epochDay(ms);
  }
}

export function beltOfStation(n: number): Belt {
  for (const b of BELTS) if (n >= b.stations[0] && n <= b.stations[1]) return b.id;
  return n <= 0 ? 'white' : 'black';
}

export interface StationQuota {
  kana: number;
  vocab: number;
  kanji: number;
  grammar: number;
  total: number;
}

/** Items a station teaches, from `STATIONS` (kana per design 02 §1). */
export function stationQuota(n: number): StationQuota {
  const def = STATIONS.find((s) => s.number === n);
  const kana = KANA_PER_STATION[n] ?? 0;
  const vocab = def?.quota.vocab ?? 0;
  const kanji = def?.quota.kanji ?? 0;
  const grammar = def?.quota.grammar ?? 0;
  return { kana, vocab, kanji, grammar, total: kana + vocab + kanji + grammar };
}

/** Items a bundle contributes: vocab + kanji + grammar, plus kana at White. */
export function bundleItemIds(b: StationBundle): string[] {
  const ids = [...b.vocabIds, ...b.kanjiIds, ...b.grammarIds];
  return beltOfStation(b.number) === 'white' ? [...b.kanaIds, ...ids] : ids;
}

/** Preset scale relative to Standard (custom = the learner's N5 total ÷ 8.75). */
export function presetScale(settings: Settings): number {
  if (settings.intensity !== 'custom') return INTENSITY_SCALE[settings.intensity];
  return Math.max(0.1, newPerDayTotal(settings.newPerDay) / STANDARD_N5_TOTAL);
}

/** The setting's full new-item rate for a belt, kana included at White (items/day, ≥ 1). */
export function fullRateFor(settings: Settings, belt: Belt): number {
  const mix = effectiveNewPerDay(settings, belt);
  const kana = belt === 'white' ? KANA_PER_DAY * presetScale(settings) : 0;
  return Math.max(1, newPerDayTotal(mix) + kana);
}

/** Days in the last `window` with activity (`daily` rows with reps or minutes). Backlog days count. */
export function activeDaysIn(m: SaveMeta, today: EpochDay, window = WINDOW_DAYS): number {
  let n = 0;
  for (let d = today - window + 1; d <= today; d++) {
    const row = m.daily[d];
    if (row && (row.reps > 0 || row.minutes > 0)) n++;
  }
  return n;
}

/** Lifetime active days for the 14-day gate: `streak.totalDays` or the daily rows, whichever is larger. */
export function lifetimeActiveDays(m: SaveMeta): number {
  let rows = 0;
  for (const row of Object.values(m.daily)) if (row.reps > 0 || row.minutes > 0) rows++;
  return Math.max(m.streak.totalDays, rows);
}

/**
 * Distinct items first seen inside the window: the earliest log entry in the
 * ring falls in the window and the base card shows no more reps than the ring
 * holds (so items that predate the ring are not counted).
 */
export function itemsIntroducedIn(log: readonly LogEntry[], cards: CardsApi, today: EpochDay, tz: string, window = WINDOW_DAYS): number {
  const first = new Map<string, EpochDay>();
  const count = new Map<string, number>();
  for (const e of log) {
    const { itemId } = parseCardKey(e[1]);
    const d = dayIn(e[0], tz);
    const f = first.get(itemId);
    if (f === undefined || d < f) first.set(itemId, d);
    count.set(itemId, (count.get(itemId) ?? 0) + 1);
  }
  const from = today - window + 1;
  let n = 0;
  for (const [itemId, d] of first) {
    if (d < from) continue;
    const facets = cards.byItem(itemId);
    const kind = kindOfCards(itemId, Object.keys(facets) as Facet[]);
    const base: CardTuple | undefined = kind ? facets[baseFacet(kind)] : undefined;
    if ((base ? base[3] : 0) <= (count.get(itemId) ?? 0)) n++;
  }
  return n;
}

export interface StationRemaining {
  station: number;
  remaining: number;
  /** Day of the most recent review on any of the station's cards (null = none introduced). */
  lastIntro: EpochDay | null;
  /** True when no bundle was available and the quota stood in. */
  fromQuota: boolean;
}

export function remainingFor(n: number, bundle: StationBundle | undefined, cards: CardsApi): StationRemaining {
  if (!bundle) return { station: n, remaining: stationQuota(n).total, lastIntro: null, fromQuota: true };
  let remaining = 0;
  let lastIntro: EpochDay | null = null;
  for (const id of bundleItemIds(bundle)) {
    const facets = cards.byItem(id);
    const keys = Object.keys(facets) as Facet[];
    if (keys.length === 0) {
      remaining++;
      continue;
    }
    for (const f of keys) {
      const t = facets[f];
      if (t && (lastIntro === null || t[6] > lastIntro)) lastIntro = t[6];
    }
  }
  return { station: n, remaining, lastIntro, fromQuota: false };
}

/** Gatekeeper wait: ≥ 80 % Green needs a week after the last Scroll (design 02 §6.2). */
export function gateWait(lastIntro: EpochDay | null, today: EpochDay): number {
  const since = lastIntro === null ? 0 : Math.max(0, today - lastIntro);
  return Math.max(1, GATE_WAIT_MAX - since);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Projection                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Projection {
  /** At the learner's realized pace and adherence. */
  atPace: EpochDay;
  /** At adherence 1.0 and the full new-item setting. */
  daily: EpochDay;
  /** ±20 % around `atPace`. */
  band: [EpochDay, EpochDay];
  adherence: number;
  realizedRate: number;
  activeDays: number;
  remainingItems: number;
  /** Some station was counted from its quota because its bundle was not loaded. */
  fromQuota: boolean;
}

interface Walk {
  pace: number;
  daily: number;
  remaining: number;
  fromQuota: boolean;
  /** Cumulative pace/daily days after each station. */
  at: Map<number, { pace: number; daily: number }>;
}

function walk(m: SaveMeta, cards: CardsApi, bundles: readonly StationBundle[], target: number, today: EpochDay, realized: number): Walk {
  const cleared = new Set(m.progress.stationsCleared);
  const byNumber = new Map(bundles.map((b) => [b.number, b]));
  const out: Walk = { pace: 0, daily: 0, remaining: 0, fromQuota: false, at: new Map() };
  for (let s = Math.max(1, m.progress.station); s <= target; s++) {
    if (!cleared.has(s)) {
      const belt = beltOfStation(s);
      const full = fullRateFor(m.settings, belt);
      const rate = clamp(realized, 1, full);
      const r = remainingFor(s, byNumber.get(s), cards);
      const wait = gateWait(r.lastIntro, today);
      out.pace += r.remaining / rate + wait;
      out.daily += r.remaining / full + wait;
      out.remaining += r.remaining;
      out.fromQuota = out.fromQuota || r.fromQuota;
      if (SHINSA_STATIONS.includes(s)) {
        out.pace += SHINSA_DAYS;
        out.daily += SHINSA_DAYS;
      }
    }
    out.at.set(s, { pace: out.pace, daily: out.daily });
  }
  return out;
}

function toProjection(today: EpochDay, pace: number, daily: number, adherence: number, realized: number, active: number, remaining: number, fromQuota: boolean): Projection {
  const span = pace / adherence;
  return {
    atPace: today + Math.ceil(span),
    daily: today + Math.ceil(daily),
    band: [today + Math.ceil(span * (1 - BAND)), today + Math.ceil(span * (1 + BAND))],
    adherence,
    realizedRate: realized,
    activeDays: active,
    remainingItems: remaining,
    fromQuota,
  };
}

function paceInputs(m: SaveMeta, cards: CardsApi, today: EpochDay, log: readonly LogEntry[]): { adherence: number; realized: number; active: number } {
  const active = activeDaysIn(m, today);
  const adherence = clamp(active / WINDOW_DAYS, ADHERENCE_FLOOR, 1);
  const realized = active > 0 ? itemsIntroducedIn(log, cards, today, m.profile.tz) / active : 0;
  return { adherence, realized, active };
}

/** Design 02 §6.2; null before 14 active days. `target` = station number (53 = Sanjō Ōhashi). */
export function projectedArrival(
  m: SaveMeta,
  cards: CardsApi,
  bundles: readonly StationBundle[],
  target: number,
  today: EpochDay,
  log: readonly LogEntry[] = [],
): Projection | null {
  if (lifetimeActiveDays(m) < MIN_ACTIVE_DAYS) return null;
  const { adherence, realized, active } = paceInputs(m, cards, today, log);
  const w = walk(m, cards, bundles, target, today, realized);
  return toProjection(today, w.pace, w.daily, adherence, realized, active, w.remaining, w.fromQuota);
}

export interface BeltEta {
  belt: Belt;
  /** The belt's last station (its Shinsa). */
  station: number;
  atPace: EpochDay;
  daily: EpochDay;
  band: [EpochDay, EpochDay];
}

export interface RoadProjection {
  /** Sanjō Ōhashi. */
  arrival: Projection;
  /** Belts still ahead, in road order. */
  belts: BeltEta[];
}

/** Arrival plus the ETA of every belt still ahead, from one pass over the road. Null before 14 active days. */
export function projectRoad(m: SaveMeta, cards: CardsApi, bundles: readonly StationBundle[], today: EpochDay, log: readonly LogEntry[] = []): RoadProjection | null {
  if (lifetimeActiveDays(m) < MIN_ACTIVE_DAYS) return null;
  const { adherence, realized, active } = paceInputs(m, cards, today, log);
  const w = walk(m, cards, bundles, ARRIVAL_STATION, today, realized);
  const arrival = toProjection(today, w.pace, w.daily, adherence, realized, active, w.remaining, w.fromQuota);
  const belts: BeltEta[] = [];
  for (const b of BELTS) {
    if (m.progress.shinsaPassed.includes(b.id)) continue;
    const last = b.stations[1];
    const cum = w.at.get(last);
    if (!cum) continue;
    const span = cum.pace / adherence;
    belts.push({
      belt: b.id,
      station: last,
      atPace: today + Math.ceil(span),
      daily: today + Math.ceil(cum.daily),
      band: [today + Math.ceil(span * (1 - BAND)), today + Math.ceil(span * (1 + BAND))],
    });
  }
  return { arrival, belts };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Onboarding estimate (before 14 active days)                                */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BeltEstimate {
  belt: Belt;
  /** Days at 100 % adherence, gates and Shinsa included. */
  days: number;
  /** Expected in-app minutes per day at the preset. */
  minutesPerDay: number;
  items: StationQuota;
}

export interface OnboardingEstimate {
  days100: number;
  days70: number;
  arrive100: EpochDay;
  arrive70: EpochDay;
  /** Σ days × minutes/day ÷ 60 at 100 % adherence. */
  hoursInApp: number;
  byBelt: BeltEstimate[];
}

/** Expected in-app minutes/day for a belt at the setting: reviews scale with the preset, the blocks do not. */
export function expectedMinutes(settings: Settings, belt: Belt): number {
  const reviewMin = (STEADY_REVIEWS_STANDARD[belt] * SECONDS_PER_REP) / 60;
  const blockMin = EXPECTED_MINUTES_STANDARD[belt] - reviewMin;
  return Math.round((reviewMin * presetScale(settings) + blockMin) * 10) / 10;
}

/**
 * Design 02 §6.1: days per belt = max over the streams of items ÷ rate, plus
 * one day per Gatekeeper and two per Shinsa; shown at 100 % and 70 %
 * adherence with the in-app hours computed from the preset (design 01 §2).
 */
export function onboardingEstimate(settings: Settings, today: EpochDay, fromStation = 1): OnboardingEstimate {
  const start = Math.max(1, fromStation);
  const byBelt: BeltEstimate[] = [];
  const scale = presetScale(settings);
  let days100 = 0;
  let minutes = 0;
  for (const b of BELTS) {
    const from = Math.max(start, b.stations[0]);
    const to = b.stations[1];
    if (from > to) continue;
    const items: StationQuota = { kana: 0, vocab: 0, kanji: 0, grammar: 0, total: 0 };
    for (let s = from; s <= to; s++) {
      const q = stationQuota(s);
      items.kana += q.kana;
      items.vocab += q.vocab;
      items.kanji += q.kanji;
      items.grammar += q.grammar;
      items.total += q.total;
    }
    const mix = effectiveNewPerDay(settings, b.id);
    const streams: [number, number][] = [
      [items.vocab, mix.vocab],
      [items.kanji, mix.kanji],
      [items.grammar, mix.grammar],
      [items.kana, b.id === 'white' ? KANA_PER_DAY * scale : 0],
    ];
    let study = 0;
    for (const [n, rate] of streams) if (n > 0) study = Math.max(study, n / Math.max(rate, 1 / WINDOW_DAYS));
    const gates = (to - from + 1) * GATE_DAYS;
    const shinsa = b.id === 'white' ? 0 : SHINSA_DAYS;
    const days = Math.ceil(study + gates + shinsa);
    const minutesPerDay = expectedMinutes(settings, b.id);
    byBelt.push({ belt: b.id, days, minutesPerDay, items });
    days100 += days;
    minutes += days * minutesPerDay;
  }
  const days70 = Math.ceil(days100 / 0.7);
  return { days100, days70, arrive100: today + days100, arrive70: today + days70, hoursInApp: Math.round(minutes / 60), byBelt };
}

/** Belt ids in road order (UI convenience). */
export const ROAD_BELTS: readonly Belt[] = BELT_IDS;
