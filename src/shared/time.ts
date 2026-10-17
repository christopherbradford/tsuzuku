/**
 * TSUZUKU — day math with the 04:00 local boundary (design 03 §1, 05 §1).
 *
 * Every function takes an explicit `nowMs` and an optional IANA `tz`; without
 * `tz` the host's local zone is used. No `Date.now()` here (store.now()).
 */
import type { EpochDay } from './store-types';

export const DAY_BOUNDARY_HOUR = 4;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_MINUTE = 60_000;

export interface CivilDate {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
}
export interface CivilParts extends CivilDate {
  hour: number;
  minute: number;
  second: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Civil wall-clock parts of `ms` in `tz` (or the host zone). */
export function civilParts(ms: number, tz?: string): CivilParts {
  if (!tz) {
    const d = new Date(ms);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  }
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Proleptic-Gregorian civil date → days since 1970-01-01 (calendar day, not the 04:00 day). */
export function civilToDay(c: CivilDate): number {
  return Math.floor(Date.UTC(c.year, c.month - 1, c.day) / MS_PER_DAY);
}

/** Inverse of `civilToDay`. */
export function dayToCivil(day: number): CivilDate {
  const d = new Date(day * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Zone offset (ms to add to UTC to get wall-clock) at `utcMs` in `tz`. */
function zoneOffsetMs(utcMs: number, tz: string): number {
  const p = civilParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant at which wall-clock `c` + `hour:minute` occurs in `tz` (or the host zone). */
export function localToMs(c: CivilDate, hour = 0, minute = 0, tz?: string): number {
  if (!tz) return new Date(c.year, c.month - 1, c.day, hour, minute, 0, 0).getTime();
  const guess = Date.UTC(c.year, c.month - 1, c.day, hour, minute, 0);
  const first = guess - zoneOffsetMs(guess, tz);
  // Second pass fixes a guess that fell on the other side of a DST switch.
  const second = guess - zoneOffsetMs(first, tz);
  return second;
}

/**
 * The learner's day: the calendar date of `nowMs`, minus one when the local
 * hour is before 04:00. 03:59 belongs to the previous day; 04:00 to the new one.
 */
export function epochDay(nowMs: number, tz?: string): EpochDay {
  const p = civilParts(nowMs, tz);
  const day = civilToDay(p);
  return p.hour < DAY_BOUNDARY_HOUR ? day - 1 : day;
}
/** Alias of `epochDay`. */
export const dayOf = epochDay;

/** The instant the learner's `day` begins: 04:00 local on its calendar date. */
export function dayStartMs(day: EpochDay, tz?: string): number {
  return localToMs(dayToCivil(day), DAY_BOUNDARY_HOUR, 0, tz);
}
/** Alias of `dayStartMs`. */
export const startOfDay = dayStartMs;

/** First instant of the next day (exclusive end of `day`). */
export function dayEndMs(day: EpochDay, tz?: string): number {
  return dayStartMs(day + 1, tz);
}

/** Minutes from `nowMs` until the next 04:00 boundary. */
export function minutesUntilDayEnd(nowMs: number, tz?: string): number {
  return Math.max(0, Math.ceil((dayEndMs(epochDay(nowMs, tz), tz) - nowMs) / MS_PER_MINUTE));
}

export function daysBetween(a: EpochDay, b: EpochDay): number {
  return b - a;
}

/** 0 Sunday … 6 Saturday, of the day's calendar date. */
export function weekdayOf(day: EpochDay): number {
  return (((day % 7) + 7 + 4) % 7 + 7) % 7;
}

/** Absolute Monday-based week index (week 0 contains 1970-01-01); seeds the Kage set. */
export function weekOf(day: EpochDay): number {
  return Math.floor((day + 3) / 7);
}

/** Monday of the absolute week `week` (inverse of `weekOf`). */
export function weekStartDay(week: number): EpochDay {
  return week * 7 - 3;
}

function isoWeekParts(day: EpochDay): { week: number; year: number } {
  const c = dayToCivil(day);
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day));
  const dow = (d.getUTCDay() + 6) % 7; // Mon 0 … Sun 6
  d.setUTCDate(d.getUTCDate() - dow + 3); // the Thursday of this ISO week
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = Date.UTC(isoYear, 0, 4 - jan4dow + 3);
  const week = 1 + Math.round((d.getTime() - week1Thursday) / (7 * MS_PER_DAY));
  return { week, year: isoYear };
}

/** ISO-8601 week number 1–53 of the day's calendar date. */
export function isoWeek(day: EpochDay): number {
  return isoWeekParts(day).week;
}

/** ISO week-numbering year of the day's calendar date. */
export function isoWeekYear(day: EpochDay): number {
  return isoWeekParts(day).year;
}

/** `2026-W42`. */
export function isoWeekKey(day: EpochDay): string {
  const { week, year } = isoWeekParts(day);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` of the day's calendar date. */
export function isoDate(day: EpochDay): string {
  const c = dayToCivil(day);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

/** `YYYY-MM` — key for `ledger.monthly` and `perapera.months`. */
export function monthKey(day: EpochDay): string {
  const c = dayToCivil(day);
  return `${c.year}-${String(c.month).padStart(2, '0')}`;
}

interface Era {
  name: string;
  /** First calendar day of the era. */
  from: CivilDate;
}
const ERAS: readonly Era[] = [
  { name: '令和', from: { year: 2019, month: 5, day: 1 } },
  { name: '平成', from: { year: 1989, month: 1, day: 8 } },
  { name: '昭和', from: { year: 1926, month: 12, day: 25 } },
];

/** `令和8年10月17日`; year 1 prints as 元年. Dates before 昭和 fall back to the western year. */
export function formatEraDate(day: EpochDay): string {
  const c = dayToCivil(day);
  for (const era of ERAS) {
    if (day >= civilToDay(era.from)) {
      const y = c.year - era.from.year + 1;
      return `${era.name}${y === 1 ? '元' : y}年${c.month}月${c.day}日`;
    }
  }
  return `${c.year}年${c.month}月${c.day}日`;
}

/** `18 min`, `1 h`, `1 h 05 min`. */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`;
}
