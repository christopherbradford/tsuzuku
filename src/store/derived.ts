/**
 * TSUZUKU — derived read-model (group B, contract tier; ARCHITECTURE §0).
 *
 * UI groups (A, E, F, G) import this file directly. It is NOT re-exported by
 * `src/store/index.ts` because it imports the pure learning core `@/learn`
 * (retrievability, item belts, known set, review caps). Every function reads
 * the live `store`; the `*Now` / `projectedArrival` forms take explicit data
 * so Records can recompute on open and tests can run without the singleton.
 *
 * Module-plan API: dueCount, isBacklog, beltEligibility, stationProgress,
 * forecastCounts, knownVocabCount, projectedArrival, peraperaNow. Extras:
 * currentBelt, currentStation, knownCounts, itemBeltOf, peraperaIndex,
 * projection, xpToNextLevel, streakState.
 */
import { BELT_ORDER, baseFacet, capFor, cardRetrievability, itemBelt, kindOfCards, knownSet } from '@/learn';
import { BELTS, BELT_IDS, type Belt, type CardKey, type Facet, type StationBundle } from '../content/types';
import { parseCardKey, tryKindOfId } from '../shared/ids';
import { epochDay, weekdayOf } from '../shared/time';
import type {
  CardTuple,
  CardsApi,
  EpochDay,
  ItemBelt,
  ItemKind,
  LogEntry,
  SaveMeta,
  Streak,
} from '../shared/store-types';
import { newPerDayFor, newPerDayTotal } from './defaults';
import { store } from './store';

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** EpochDay of `ms` in `tz`, falling back to the host zone on a bad zone id. */
function dayIn(ms: number, tz: string): EpochDay {
  try {
    return epochDay(ms, tz);
  } catch {
    return epochDay(ms);
  }
}

/** `kana`/`vocab`/`kanji`/`grammar`/`component` from an item id (chunks read as vocab). */
export function kindOfItem(itemId: string): ItemKind | null {
  const k = tryKindOfId(itemId);
  return k === 'kana' || k === 'vocab' || k === 'kanji' || k === 'grammar' || k === 'component' ? k : null;
}

function beltRank(b: ItemBelt): number {
  return BELT_ORDER.indexOf(b);
}

const GREEN = beltRank('green');
const BROWN = beltRank('brown');

/**
 * Item kind from an id and the facets it holds (`learn/known.kindOfCards`): a
 * vocab id with a `prod` card and no `rec` card is a chunk.
 */
export function kindFor(itemId: string, facets: Partial<Record<Facet, CardTuple>>): ItemKind | null {
  return kindOfCards(itemId, Object.keys(facets) as Facet[]) ?? null;
}

/** Item belt of `itemId` from its facet cards (White when it has no cards). */
export function itemBeltOf(itemId: string, kind?: ItemKind | null, cards: CardsApi = store.cards): ItemBelt {
  const facets = cards.byItem(itemId);
  const k = kind ?? kindFor(itemId, facets);
  if (!k) return 'white';
  return itemBelt(k, facets);
}

export { cardRetrievability };

/** Stations of a belt (inclusive range). */
export function beltStations(belt: Belt): [number, number] {
  const def = BELTS.find((b) => b.id === belt);
  return def ? def.stations : [1, 3];
}

/** The belt a station belongs to. */
export function beltOfStation(station: number): Belt {
  for (const b of BELTS) if (station >= b.stations[0] && station <= b.stations[1]) return b.id;
  return station <= 0 ? 'white' : 'black';
}

/** Items a bundle contributes to coverage: vocab/kanji/grammar (+ kana at White). */
export function bundleItemIds(b: StationBundle): string[] {
  const ids = [...b.vocabIds, ...b.kanjiIds, ...b.grammarIds];
  return beltOfStation(b.number) === 'white' ? [...b.kanaIds, ...ids] : ids;
}

/** Stations whose Gatekeeper precedes a Shinsa (design 02 §1). */
export const SHINSA_STATIONS: readonly number[] = BELTS.filter((b) => b.id !== 'white').map((b) => b.stations[1]);

/* ────────────────────────────────────────────────────────────────────────── */
/* Selectors (live store)                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export function currentBelt(): Belt {
  return store.profile.value.belt;
}

export function currentStation(): number {
  return store.progress.value.station;
}

/** Review cap for today (belt-scaled, `learn/governors.capFor`). */
export function reviewCap(): number {
  const s = store.settings.value;
  return capFor(s.intensity, currentBelt(), s.maxReviews);
}

export function dueCount(day: EpochDay = store.today()): number {
  return store.cards.dueOn(day).length;
}

/** Backlog mode: due > 2 × the belt-scaled cap (design 03 §5). */
export function isBacklog(): boolean {
  return dueCount() > 2 * reviewCap();
}

export interface BeltEligibility {
  /** Share of the belt's items at item belt ≥ Green. */
  coverageRec: number;
  /** Share at ≥ Brown. */
  coverageProd: number;
  gatesDone: boolean;
  eligible: boolean;
  total: number;
}

/** Design 02 §2: every Gatekeeper passed, ≥ 85 % Green and ≥ 50 % Brown of the belt's items. */
export function beltEligibility(belt: Belt, bundles: StationBundle[]): BeltEligibility {
  const [from, to] = beltStations(belt);
  const ids: string[] = [];
  for (const b of bundles) if (b.number >= from && b.number <= to) ids.push(...bundleItemIds(b));
  let green = 0;
  let brown = 0;
  for (const id of ids) {
    const r = beltRank(itemBeltOf(id));
    if (r >= GREEN) green++;
    if (r >= BROWN) brown++;
  }
  const total = ids.length;
  const coverageRec = total ? green / total : 0;
  const coverageProd = total ? brown / total : 0;
  const cleared = new Set(store.progress.value.stationsCleared);
  let gatesDone = true;
  for (let n = from; n <= to; n++) if (!cleared.has(n)) gatesDone = false;
  return { coverageRec, coverageProd, gatesDone, eligible: total > 0 && gatesDone && coverageRec >= 0.85 && coverageProd >= 0.5, total };
}

export interface StationProgress {
  introduced: number;
  total: number;
  green: number;
  /** Every item introduced and ≥ 80 % Green. */
  gateReady: boolean;
  cleared: boolean;
}

export function stationProgress(n: number, b: StationBundle): StationProgress {
  const ids = bundleItemIds(b);
  let introduced = 0;
  let green = 0;
  for (const id of ids) {
    const facets = store.cards.byItem(id);
    if (Object.keys(facets).length > 0) introduced++;
    const kind = kindFor(id, facets);
    if (kind && beltRank(itemBelt(kind, facets)) >= GREEN) green++;
  }
  const total = ids.length;
  return {
    introduced,
    total,
    green,
    gateReady: total > 0 && introduced === total && green >= Math.ceil(0.8 * total),
    cleared: store.progress.value.stationsCleared.includes(n),
  };
}

/** Median of the per-drill medians, seconds per rep (design 02 §6.1 budgets 8 s). */
export function medianRepSeconds(): number {
  const vals = Object.values(store.medianMs.value).filter((v): v is number => typeof v === 'number' && v > 0);
  if (vals.length === 0) return 8;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const ms = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return clamp(ms / 1000, 3, 15);
}

export interface ForecastCounts {
  due: number;
  newItems: number;
  minutes: { kata: number; kumite: number; shugyo: number };
}

/** Design 03 §2–§3: due counts × median latency + fixed block estimates. */
export function forecastCounts(): ForecastCounts {
  const due = dueCount();
  const s = store.settings.value;
  const belt = currentBelt();
  const npd = s.intensity === 'custom' ? s.newPerDay : newPerDayFor(belt, s.intensity);
  const newItems = Math.round(newPerDayTotal(npd));
  const rep = medianRepSeconds();
  const cap = reviewCap();
  const inputMin = belt === 'white' || belt === 'yellow' || belt === 'orange' ? 5 : belt === 'green' ? 7 : belt === 'blue' || belt === 'purple' ? 9 : 12;
  const outputMin = belt === 'white' || belt === 'yellow' || belt === 'orange' ? 3 : belt === 'green' ? 4 : belt === 'blue' || belt === 'purple' ? 5 : 7;
  const kata = (Math.min(due, 25) * rep) / 60 + 0.5;
  const kumite = (Math.min(due, 20) * rep) / 60 + (newItems > 0 ? 5 : 0) + (15 * rep) / 60 + 1.5 + 0.5;
  const shugyo = 1.5 + (Math.min(due, cap) * rep) / 60 + (newItems > 0 ? 10 : 0) + inputMin + outputMin + 1;
  return { due, newItems, minutes: { kata: Math.round(kata), kumite: Math.round(kumite), shugyo: Math.round(shugyo) } };
}

/** Known = base-facet retrievability ≥ 0.85 now (`learn/known`). */
export function knownIds(today: EpochDay = store.today()): Set<string> {
  return knownSet(store.cards, today);
}

export function knownVocabCount(): number {
  let n = 0;
  for (const id of knownIds()) if (id.startsWith('v-')) n++;
  return n;
}

export type KnownCounts = Record<'kana' | 'vocab' | 'kanji' | 'grammar' | 'component', number>;

export function knownCounts(): KnownCounts {
  const out: KnownCounts = { kana: 0, vocab: 0, kanji: 0, grammar: 0, component: 0 };
  for (const id of knownIds()) {
    const k = kindOfItem(id);
    if (k && k !== 'chunk') out[k]++;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* XP and streak                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/** Design 02 §5: cumulative XP at which level `L` is reached. */
export function xpAtLevel(level: number): number {
  return 60 * level * level + 100 * level;
}

/** XP needed to go from `level` to `level + 1` (`160 + 120·L`). */
export function xpToNext(level: number): number {
  return 160 + 120 * level;
}

/** Level for a cumulative XP total, clamped to 1–99. */
export function levelFor(xp: number): number {
  let lo = 1;
  let hi = 99;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (xpAtLevel(mid) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface XpProgress {
  level: number;
  xp: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level spans (0 at Lv 99). */
  needed: number;
  /** XP still missing for the next level. */
  remaining: number;
  /** 0–1. */
  progress: number;
}

export function xpToNextLevel(xp: number = store.profile.value.xp): XpProgress {
  const level = levelFor(xp);
  if (level >= 99) return { level, xp, into: xp - xpAtLevel(99), needed: 0, remaining: 0, progress: 1 };
  const floor = xpAtLevel(level);
  const needed = xpToNext(level);
  const into = clamp(xp - floor, 0, needed);
  return { level, xp, into, needed, remaining: needed - into, progress: needed ? into / needed : 1 };
}

export type FlameState = 'lit' | 'gold' | 'ember' | 'frozen' | 'rest' | 'broken';

/**
 * Flame state from the streak slice (design 03 §7). `store/streak.ts`
 * (`flameState`) owns the full state machine; this mirrors its visible states.
 */
export function streakStateOf(s: Streak, today: EpochDay, restDay: number | null, fullDay = false): FlameState {
  if (s.vacationUntil !== undefined && s.vacationUntil >= today) return 'frozen';
  if (s.lastDay === today) return fullDay ? 'gold' : 'lit';
  if (s.ember !== undefined && today - s.ember <= 1) return 'ember';
  if (s.current <= 0) return 'broken';
  if (restDay !== null && weekdayOf(today) === restDay && s.lastDay === today - 1) return 'rest';
  if (s.lastDay === today - 1) return 'lit';
  return 'broken';
}

export function streakState(): FlameState {
  const q = store.quests.value;
  const today = store.today();
  const fullDay = q.day === today && q.ids.length > 0 && q.ids.every((id) => q.done.includes(id));
  return streakStateOf(store.streak.value, today, store.settings.value.restDay, fullDay);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Perapera Index (design 05 §11)                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export const PERAPERA_LABELS: readonly [string, string, string, string, string] = ['語彙', '耳', '読', '口', '場'];

export interface PeraperaResult {
  /** 0–100 each; `場` is 0 with label `—` before Station 21. */
  axes: [number, number, number, number, number];
  labels: string[];
  composite: number;
  /** `(synthetic)` on 耳 always; `(estimated)` on 口 without recognition. */
  flags: string[];
}

function ratio(num: number, den: number, fallback = 0): number {
  return den > 0 ? clamp(num / den, 0, 1) : fallback;
}

/** Hours of listen + watch ledger minutes (external listening for the 耳 cap). */
export function externalListeningHours(m: SaveMeta): number {
  let minutes = 0;
  for (const e of m.ledger.entries) if (e[3] === 1 && (e[2] === 0 || e[2] === 2)) minutes += e[1];
  return minutes / 60;
}

export function peraperaNow(m: SaveMeta, cards: CardsApi, now: number): PeraperaResult {
  const today = dayIn(now, m.profile.tz);
  const st = m.stats;

  // 語彙
  let sumRec = 0;
  let sumProd = 0;
  cards.forEach((k, t) => {
    if (!k.startsWith('v-')) return;
    const facet = k.slice(k.lastIndexOf('#') + 1) as Facet;
    if (facet === 'rec') sumRec += cardRetrievability(t, today);
    else if (facet === 'prod') sumProd += cardRetrievability(t, today);
  });
  const vocab = clamp((0.6 * sumRec) / 10_000 + (0.4 * sumProd) / 6_000, 0, 1) * 100;

  // 耳 (synthetic)
  // No dictation evidence yet → the 0.5 floor, not full credit.
  const dictationAcc = ratio(st.dictation95at1x, st.dictationLines, 0);
  let ear = 20 * m.settings.speedTier * clamp(dictationAcc / 0.9, 0.5, 1);
  if (externalListeningHours(m) < 20) ear = Math.min(ear, 70);
  ear = clamp(ear, 0, 100);

  // 読 — best cpm stands in for the rolling median until stats carries a window.
  const read = clamp((st.speedReadBestCpm / 500) * 100, 0, 100);

  // 口
  const recognition = m.settings.speaking === 'recognition' || m.settings.speaking === 'auto';
  const shadowRate = ratio(st.shadowPass, st.shadowLines);
  const mouth = recognition
    ? 50 * shadowRate + 50 * Math.min(1, st.monologueBestWords / 100)
    : 70 * shadowRate + 30 * Math.min(1, st.monologues / 30);

  // 場
  const registerAvailable = m.progress.station >= 21;
  const register = registerAvailable ? 50 * ratio(st.rolePlaysAllBest, st.rolePlays) + 50 * ratio(st.threeWaysCorrect, st.threeWays) : 0;

  const axes: [number, number, number, number, number] = [
    Math.round(vocab),
    Math.round(ear),
    Math.round(read),
    Math.round(clamp(mouth, 0, 100)),
    Math.round(clamp(register, 0, 100)),
  ];
  const available = registerAvailable ? axes : axes.slice(0, 4);
  const composite = Math.round(available.reduce((a, b) => a + b, 0) / available.length);
  const labels = [...PERAPERA_LABELS];
  if (!registerAvailable) labels[4] = '—';
  const flags = ['(synthetic)'];
  if (!recognition) flags.push('(estimated)');
  return { axes, labels, composite, flags };
}

/** `peraperaNow` over the live store. */
export function peraperaIndex(): PeraperaResult {
  return peraperaNow(store.meta(), store.cards, store.now());
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Projected Arrival (design 02 §6.2)                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Projection {
  /** At the learner's current pace. */
  atPace: EpochDay;
  /** At adherence 1.0 and the full new-item rate. */
  daily: EpochDay;
  /** ±20 % around `atPace`. */
  band: [EpochDay, EpochDay];
  adherence: number;
  realizedRate: number;
}

/** Days in the last 28 with activity (`daily` rows with reps or minutes). */
export function activeDaysIn(m: SaveMeta, today: EpochDay, window = 28): number {
  let n = 0;
  for (let d = today - window + 1; d <= today; d++) {
    const row = m.daily[d];
    if (row && (row.reps > 0 || row.minutes > 0)) n++;
  }
  return n;
}

/** Lifetime active days (for the 14-day gate): `streak.totalDays` or the daily rows, whichever is larger. */
export function lifetimeActiveDays(m: SaveMeta): number {
  let rows = 0;
  for (const row of Object.values(m.daily)) if (row.reps > 0 || row.minutes > 0) rows++;
  return Math.max(m.streak.totalDays, rows);
}

/**
 * Items first seen in the last `window` days: distinct items whose earliest
 * log entry in the ring is inside the window and whose base card has no more
 * reps than the ring shows (so items that predate the ring are not counted).
 */
export function itemsIntroducedIn(log: LogEntry[], cards: CardsApi, today: EpochDay, tz: string, window = 28): number {
  const first = new Map<string, EpochDay>();
  const count = new Map<string, number>();
  for (const e of log) {
    const { itemId } = parseCardKey(e[1]);
    const d = dayIn(e[0], tz);
    const f = first.get(itemId);
    if (f === undefined || d < f) first.set(itemId, d);
    count.set(itemId, (count.get(itemId) ?? 0) + 1);
  }
  let n = 0;
  const from = today - window + 1;
  for (const [itemId, d] of first) {
    if (d < from) continue;
    const facets = cards.byItem(itemId);
    const kind = kindFor(itemId, facets);
    const base = kind ? facets[baseFacet(kind)] : undefined;
    const reps = base ? base[3] : 0;
    if (reps <= (count.get(itemId) ?? 0)) n++;
  }
  return n;
}

export function projectedArrival(
  m: SaveMeta,
  cards: CardsApi,
  bundles: StationBundle[],
  target: number,
  today: EpochDay,
  log: LogEntry[] = [],
): Projection | null {
  if (lifetimeActiveDays(m) < 14) return null;
  const active = activeDaysIn(m, today);
  const adherence = clamp(active / 28, 0.3, 1);
  const realized = active > 0 ? itemsIntroducedIn(log, cards, today, m.profile.tz) / active : 0;
  const cleared = new Set(m.progress.stationsCleared);
  const byNumber = new Map(bundles.map((b) => [b.number, b]));

  let paceDays = 0;
  let dailyDays = 0;
  for (let s = Math.max(1, m.progress.station); s <= target; s++) {
    if (cleared.has(s)) continue;
    const b = byNumber.get(s);
    const belt = beltOfStation(s);
    const setting = m.settings.intensity === 'custom' ? m.settings.newPerDay : newPerDayFor(belt, m.settings.intensity);
    const full = Math.max(1, newPerDayTotal(setting));
    const rate = clamp(realized, 1, full);
    let remaining = 0;
    let lastIntro: EpochDay | null = null;
    if (b) {
      for (const id of bundleItemIds(b)) {
        const facets = cards.byItem(id);
        const keys = Object.keys(facets) as Facet[];
        if (keys.length === 0) {
          remaining++;
        } else {
          for (const f of keys) {
            const t = facets[f];
            if (t && (lastIntro === null || t[6] > lastIntro)) lastIntro = t[6];
          }
        }
      }
    }
    const gateWait = Math.max(1, 7 - (lastIntro === null ? 0 : Math.max(0, today - lastIntro)));
    paceDays += remaining / rate + gateWait;
    dailyDays += remaining / full + gateWait;
    if (SHINSA_STATIONS.includes(s)) {
      paceDays += 2;
      dailyDays += 2;
    }
  }
  const atPaceSpan = paceDays / adherence;
  const atPace = today + Math.ceil(atPaceSpan);
  const daily = today + Math.ceil(dailyDays);
  const band: [EpochDay, EpochDay] = [today + Math.ceil(atPaceSpan * 0.8), today + Math.ceil(atPaceSpan * 1.2)];
  return { atPace, daily, band, adherence, realizedRate: realized };
}

/** `projectedArrival` over the live store (target defaults to Sanjō Ōhashi = 53). */
export function projection(bundles: StationBundle[], target = 53): Projection | null {
  return projectedArrival(store.meta(), store.cards, bundles, target, store.today(), store.log.recent(5000));
}

/** Belt ids in road order (re-exported for UI convenience). */
export const ROAD_BELTS: readonly Belt[] = BELT_IDS;
