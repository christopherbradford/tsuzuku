import {
  civilToDay,
  dayEndMs,
  dayOf,
  dayStartMs,
  dayToCivil,
  daysBetween,
  epochDay,
  formatEraDate,
  formatMinutes,
  isoDate,
  isoWeek,
  isoWeekKey,
  isoWeekYear,
  localToMs,
  minutesUntilDayEnd,
  monthKey,
  safeTz,
  startOfDay,
  weekOf,
  weekStartDay,
  weekdayOf,
} from './time';

const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';
const at = (tz: string, y: number, m: number, d: number, h: number, min = 0) => localToMs({ year: y, month: m, day: d }, h, min, tz);

describe('epochDay — 04:00 boundary', () => {
  const oct17 = civilToDay({ year: 2026, month: 10, day: 17 });

  it('03:59 local belongs to the previous day, 04:00 to the new day', () => {
    expect(epochDay(at(LA, 2026, 10, 17, 3, 59), LA)).toBe(oct17 - 1);
    expect(epochDay(at(LA, 2026, 10, 17, 4, 0), LA)).toBe(oct17);
    expect(epochDay(at(LA, 2026, 10, 17, 23, 59), LA)).toBe(oct17);
    expect(epochDay(at(LA, 2026, 10, 18, 0, 30), LA)).toBe(oct17);
  });

  it('is zone-aware: the same instant can be different days in Tokyo and LA', () => {
    const ms = at(TOKYO, 2026, 10, 17, 4, 0); // 04:00 JST = 19:00Z on the 16th = 12:00 PDT on the 16th
    expect(epochDay(ms, TOKYO)).toBe(oct17);
    expect(epochDay(ms, LA)).toBe(oct17 - 1);
  });

  it('works without a tz (host zone)', () => {
    const d = new Date(2026, 9, 17, 3, 59).getTime();
    const d2 = new Date(2026, 9, 17, 4, 0).getTime();
    expect(epochDay(d2) - epochDay(d)).toBe(1);
    expect(dayOf(d2)).toBe(epochDay(d2));
  });

  it('DST spring forward (2026-03-08, LA): 03:59 is still yesterday, 04:00 is today', () => {
    const mar8 = civilToDay({ year: 2026, month: 3, day: 8 });
    expect(epochDay(at(LA, 2026, 3, 8, 3, 59), LA)).toBe(mar8 - 1);
    expect(epochDay(at(LA, 2026, 3, 8, 4, 0), LA)).toBe(mar8);
    expect(new Date(dayStartMs(mar8, LA)).toISOString()).toBe('2026-03-08T11:00:00.000Z');
  });

  it('DST fall back (2026-11-01, LA)', () => {
    const nov1 = civilToDay({ year: 2026, month: 11, day: 1 });
    expect(epochDay(at(LA, 2026, 11, 1, 3, 59), LA)).toBe(nov1 - 1);
    expect(epochDay(at(LA, 2026, 11, 1, 4, 0), LA)).toBe(nov1);
    expect(new Date(dayStartMs(nov1, LA)).toISOString()).toBe('2026-11-01T12:00:00.000Z');
    // the day before the switch is 25 hours long
    expect(dayStartMs(nov1, LA) - dayStartMs(nov1 - 1, LA)).toBe(25 * 3_600_000);
  });

  it('dayStartMs / dayEndMs bracket every instant of the day', () => {
    for (const h of [4, 5, 12, 23]) {
      const ms = at(TOKYO, 2026, 10, 17, h);
      const day = epochDay(ms, TOKYO);
      expect(dayStartMs(day, TOKYO)).toBeLessThanOrEqual(ms);
      expect(dayEndMs(day, TOKYO)).toBeGreaterThan(ms);
    }
    expect(startOfDay(oct17, TOKYO)).toBe(dayStartMs(oct17, TOKYO));
    expect(new Date(dayStartMs(oct17, TOKYO)).toISOString()).toBe('2026-10-16T19:00:00.000Z');
  });

  it('minutesUntilDayEnd counts to the next 04:00', () => {
    expect(minutesUntilDayEnd(at(TOKYO, 2026, 10, 17, 3, 0), TOKYO)).toBe(60);
    expect(minutesUntilDayEnd(at(TOKYO, 2026, 10, 17, 4, 0), TOKYO)).toBe(24 * 60);
  });
});

describe('civil helpers', () => {
  it('civilToDay / dayToCivil roundtrip', () => {
    for (const c of [
      { year: 1970, month: 1, day: 1 },
      { year: 2000, month: 2, day: 29 },
      { year: 2026, month: 10, day: 17 },
      { year: 2099, month: 12, day: 31 },
    ]) {
      expect(dayToCivil(civilToDay(c))).toEqual(c);
    }
    expect(civilToDay({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(civilToDay({ year: 2026, month: 10, day: 17 })).toBe(20743);
  });

  it('daysBetween, weekdayOf, weekOf, weekStartDay', () => {
    expect(daysBetween(10, 17)).toBe(7);
    expect(daysBetween(17, 10)).toBe(-7);
    expect(weekdayOf(0)).toBe(4); // 1970-01-01 was a Thursday
    expect(weekdayOf(civilToDay({ year: 2026, month: 10, day: 17 }))).toBe(6); // Saturday
    expect(weekOf(0)).toBe(0);
    expect(weekOf(3)).toBe(0); // Sunday 1970-01-04
    expect(weekOf(4)).toBe(1); // Monday 1970-01-05
    expect(weekdayOf(weekStartDay(weekOf(20743)))).toBe(1);
    expect(weekStartDay(weekOf(20743))).toBeLessThanOrEqual(20743);
  });

  it('isoDate and monthKey', () => {
    expect(isoDate(20743)).toBe('2026-10-17');
    expect(monthKey(20743)).toBe('2026-10');
    expect(isoDate(0)).toBe('1970-01-01');
  });
});

describe('isoWeek', () => {
  const d = (y: number, m: number, dd: number) => civilToDay({ year: y, month: m, day: dd });
  it('matches known dates', () => {
    expect(isoWeek(d(2026, 10, 17))).toBe(42);
    expect(isoWeek(d(2026, 1, 1))).toBe(1);
    expect(isoWeek(d(2021, 1, 3))).toBe(53);
    expect(isoWeekYear(d(2021, 1, 3))).toBe(2020);
    expect(isoWeek(d(2020, 12, 31))).toBe(53);
    expect(isoWeek(d(2024, 12, 30))).toBe(1);
    expect(isoWeekYear(d(2024, 12, 30))).toBe(2025);
    expect(isoWeek(d(2015, 12, 31))).toBe(53);
    expect(isoWeek(d(2016, 1, 4))).toBe(1);
  });
  it('isoWeekKey', () => {
    expect(isoWeekKey(d(2026, 10, 17))).toBe('2026-W42');
    expect(isoWeekKey(d(2021, 1, 3))).toBe('2020-W53');
  });
});

describe('formatting', () => {
  it('formatEraDate', () => {
    expect(formatEraDate(civilToDay({ year: 2026, month: 10, day: 17 }))).toBe('令和8年10月17日');
    expect(formatEraDate(civilToDay({ year: 2019, month: 5, day: 1 }))).toBe('令和元年5月1日');
    expect(formatEraDate(civilToDay({ year: 2019, month: 4, day: 30 }))).toBe('平成31年4月30日');
    expect(formatEraDate(civilToDay({ year: 1989, month: 1, day: 8 }))).toBe('平成元年1月8日');
    expect(formatEraDate(civilToDay({ year: 1989, month: 1, day: 7 }))).toBe('昭和64年1月7日');
    expect(formatEraDate(civilToDay({ year: 1900, month: 6, day: 1 }))).toBe('1900年6月1日');
  });
  it('formatMinutes', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(17.6)).toBe('18 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(65)).toBe('1 h 05 min');
    expect(formatMinutes(135)).toBe('2 h 15 min');
    expect(formatMinutes(-3)).toBe('0 min');
  });
});

describe('safeTz', () => {
  it('keeps every zone the host resolves (trimmed) and falls back to UTC for the rest', () => {
    expect(safeTz('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(safeTz(' America/Los_Angeles ')).toBe('America/Los_Angeles');
    expect(safeTz('Etc/GMT+8')).toBe('Etc/GMT+8');
    expect(safeTz('US/Pacific')).toBe('US/Pacific');
    expect(safeTz(undefined)).toBe('UTC');
    expect(safeTz(null)).toBe('UTC');
    expect(safeTz('')).toBe('UTC');
    expect(safeTz('UTC\nX:1')).toBe('UTC');
    expect(safeTz('Asia/Tokyo;TZID=x')).toBe('UTC');
    expect(safeTz('Nowhere/Town')).toBe('UTC');
  });
});
