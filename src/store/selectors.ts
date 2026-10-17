/**
 * TSUZUKU — composite read-model for the UI groups (store group B).
 *
 * The module-plan selectors (`dueCount`, `isBacklog`, `beltEligibility`,
 * `stationProgress`, `forecastCounts`, `knownVocabCount`) are implemented in
 * `./derived` (the contract barrel UI imports directly) and re-exported here
 * so both import paths agree. This file adds the summaries a page needs in
 * one call: the Dojo home (`homeSummary`), Records (`recordsSummary`,
 * `activityDays`, `retention`) and the Ledger page (`ledgerSummary`).
 *
 * Everything reads the live `store`; `today` defaults to `store.today()`.
 */
import type { Belt, ErrorTag } from '../content/types';
import { BELTS, STATIONS } from '../content/types';
import type { EpochDay, Progress, Streak } from '../shared/store-types';
import { awayStatus, type AwayStatus } from './day';
import { dueCount, forecastCounts, isBacklog, reviewCap, xpToNextLevel, type ForecastCounts, type XpProgress } from './derived';
import { ledgerHours, ledgerByWeek, weekProgress, LEDGER_GOAL_HOURS, type LedgerHours, type WeekRow } from './ledger';
import { isFullDay, questProgress, type QuestProgress } from './quests';
import { honesty } from './stats';
import { store } from './store';
import { flameState, type FlameState } from './streak';
import { activeTags, conqueredTags, topWeakPoints, type WeakPointRow } from './weak-points';

export { dueCount, isBacklog, beltEligibility, stationProgress, forecastCounts, knownVocabCount } from './derived';
export type { BeltEligibility, StationProgress, ForecastCounts } from './derived';

/* ────────────────────────────────────────────────────────────────────────── */
/* Home                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface StreakSummary {
  state: FlameState;
  current: number;
  longest: number;
  totalDays: number;
  freezes: number;
  /** Repair window open: days trained of the three needed. */
  repair: { done: number; needed: number; daysLeft: number } | null;
  fullDay: boolean;
}

export interface HomeSummary {
  today: EpochDay;
  belt: Belt;
  station: number;
  /** Station name in Japanese (日本橋 at station 0). */
  stationJa: string;
  titleJa: string;
  level: XpProgress;
  streak: StreakSummary;
  forecast: ForecastCounts;
  /** Backlog mode (design 03 §5): due > 2 × cap; `shown` is today's cap. */
  backlog: { active: boolean; due: number; shown: number };
  quests: QuestProgress[];
  away: AwayStatus & { welcomeBackDue: boolean };
  /** A session snapshot is waiting. */
  resume: boolean;
}

export function streakSummary(s: Streak = store.streak.value, today: EpochDay = store.today()): StreakSummary {
  const q = store.quests.value;
  const fullDay = q.day === today && isFullDay(q);
  const w = s.repairWindow;
  const repair = w && today <= w.start + 4 ? { done: w.done, needed: 3, daysLeft: w.start + 4 - today + 1 } : null;
  return {
    state: flameState(s, today, store.settings.value.restDay, fullDay),
    current: s.current,
    longest: s.longest,
    totalDays: s.totalDays,
    freezes: s.freezes,
    repair,
    fullDay,
  };
}

export function stationNameJa(n: number): string {
  if (n <= 0) return '日本橋';
  return STATIONS.find((s) => s.number === n)?.nameJa ?? '三条大橋';
}

export function beltTitleJa(belt: Belt): string {
  return BELTS.find((b) => b.id === belt)?.titleJa ?? '';
}

export function homeSummary(): HomeSummary {
  const today = store.today();
  const profile = store.profile.value;
  const progress: Progress = store.progress.value;
  const forecast = forecastCounts();
  const cap = reviewCap();
  const due = forecast.due;
  const away = awayStatus(store.daily.value, today);
  return {
    today,
    belt: profile.belt,
    station: progress.station,
    stationJa: stationNameJa(progress.station),
    titleJa: profile.dan > 0 ? '達人' : beltTitleJa(profile.belt),
    level: xpToNextLevel(profile.xp),
    streak: streakSummary(store.streak.value, today),
    forecast,
    backlog: { active: isBacklog(), due, shown: Math.min(due, cap) },
    quests: questProgress(store),
    away: { ...away, awayDays: Math.max(away.awayDays, progress.awayDays), welcomeBackDue: progress.welcomeBackDue },
    resume: store.session.load() !== null,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Records                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ActivityDay {
  day: EpochDay;
  active: boolean;
  reps: number;
  ok: number;
  minutes: number;
  xp: number;
  input: number;
}

/** The last `n` days ending today, oldest first (heat map / sparklines). */
export function activityDays(n = 28, today: EpochDay = store.today()): ActivityDay[] {
  const daily = store.daily.value;
  const out: ActivityDay[] = [];
  for (let d = today - Math.max(1, n) + 1; d <= today; d++) {
    const r = daily[d];
    out.push({
      day: d,
      active: !!r && (r.reps > 0 || r.minutes > 0),
      reps: r?.reps ?? 0,
      ok: r?.ok ?? 0,
      minutes: r?.minutes ?? 0,
      xp: r?.xp ?? 0,
      input: r?.input ?? 0,
    });
  }
  return out;
}

/** Accuracy (ok ÷ reps) over the last `days`; null with no reps. */
export function retention(days: number, today: EpochDay = store.today()): number | null {
  let reps = 0;
  let ok = 0;
  for (const d of activityDays(days, today)) {
    reps += d.reps;
    ok += d.ok;
  }
  return reps > 0 ? Math.round((ok / reps) * 1000) / 1000 : null;
}

export interface RecordsSummary {
  today: EpochDay;
  retention7: number | null;
  retention30: number | null;
  /** 0–1, null before the first Judge check. */
  honesty: number | null;
  judgeChecks: number;
  days: ActivityDay[];
  activeDays28: number;
  totalDays: number;
  reviews: number;
  weakPoints: WeakPointRow[];
  activeTags: ErrorTag[];
  conquered: ErrorTag[];
  level: XpProgress;
}

export function recordsSummary(o: { days?: number } = {}): RecordsSummary {
  const today = store.today();
  const m = store.meta();
  const days = activityDays(o.days ?? 28, today);
  return {
    today,
    retention7: retention(7, today),
    retention30: retention(30, today),
    honesty: honesty(m),
    judgeChecks: m.stats.judgeChecks,
    days,
    activeDays28: days.filter((d) => d.active).length,
    totalDays: m.streak.totalDays,
    reviews: m.stats.reviews,
    weakPoints: topWeakPoints(m.weakPoints, 14, { includeInactive: true }),
    activeTags: activeTags(m.weakPoints),
    conquered: conqueredTags(m.weakPoints),
    level: xpToNextLevel(m.profile.xp),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ledger                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface LedgerSummary {
  hours: LedgerHours;
  goalHours: number;
  /** 0–1 toward the 1,500 h goal. */
  goalRatio: number;
  week: { minutes: number; targetHours: number; ratio: number };
  weeks: WeekRow[];
  missions: number;
  conversations: number;
}

export function ledgerSummary(weeks = 12): LedgerSummary {
  const m = store.meta();
  const today = store.today();
  const hours = ledgerHours(m);
  return {
    hours,
    goalHours: LEDGER_GOAL_HOURS,
    goalRatio: Math.min(1, hours.total / LEDGER_GOAL_HOURS),
    week: weekProgress(m, today),
    weeks: ledgerByWeek(m, today, weeks),
    missions: m.ledger.missions.length,
    conversations: m.ledger.missions.filter((x) => x.conversation).length,
  };
}

/** Due reviews today after the backlog cap (what a session will actually show). */
export function dueShownToday(): number {
  return Math.min(dueCount(), reviewCap());
}
