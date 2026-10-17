import { bus } from '../shared/events';
import { dayStartMs, epochDay } from '../shared/time';
import type { DailyRow, EpochDay } from '../shared/store-types';
import { awayStatus, monthRolled, msUntilNextDay, rollIfNeeded, startDayRoll } from './day';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const DAY_MS = 86_400_000;

function row(reps = 10, minutes = 3): DailyRow {
  return { reps, ok: reps, minutes, xp: 0, input: 0 };
}

function rows(days: EpochDay[]): Record<EpochDay, DailyRow> {
  const out: Record<EpochDay, DailyRow> = {};
  for (const d of days) out[d] = row();
  return out;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
  vi.useRealTimers();
});

describe('rollIfNeeded', () => {
  it('rolls once on a fresh save and never again the same day', async () => {
    await makeTestStore({ save: { progress: { station: 1 } } });
    const cap = captureEvents();
    expect(rollIfNeeded(store)).toBe(true);
    expect(rollIfNeeded(store)).toBe(false);
    expect(rollIfNeeded(store)).toBe(false);
    cap.stop();
    expect(store.quests.value.day).toBe(TODAY);
    expect(store.quests.value.ids.length).toBeGreaterThan(0);
    expect(store.quests.value.done).toEqual([]);
    expect(cap.events.filter(([n]) => n === 'day:rolled')).toEqual([['day:rolled', { day: TODAY, awayDays: 0 }]]);
    expect(store.progress.value.awayDays).toBe(0);
    expect(store.progress.value.welcomeBackDue).toBe(false);
  });

  it('at Nihonbashi (station 0) the roll draws no quests; the draw comes with the first station', async () => {
    await makeTestStore();
    expect(rollIfNeeded(store)).toBe(true);
    expect(store.quests.value.day).toBe(TODAY);
    expect(store.quests.value.ids).toEqual([]);
  });

  it('does not roll within the same day, rolls across 04:00 in the profile zone', async () => {
    let clock = DEFAULT_TEST_NOW;
    await makeTestStore({ now: () => clock });
    store.patch('profile', (p) => ({ ...p, tz: 'Asia/Tokyo' }));
    expect(rollIfNeeded(store)).toBe(true);
    const day = store.today();
    // 03:59 local the next calendar day is still `day`.
    clock = dayStartMs(day + 1, 'Asia/Tokyo') - 60_000;
    expect(store.today()).toBe(day);
    expect(rollIfNeeded(store)).toBe(false);
    // 04:00 local: a new day.
    clock = dayStartMs(day + 1, 'Asia/Tokyo');
    expect(store.today()).toBe(day + 1);
    expect(rollIfNeeded(store)).toBe(true);
    expect(store.quests.value.day).toBe(day + 1);
  });

  it('judges every missed day since the last roll through the streak machine', async () => {
    // Trained up to TODAY-4 with a 7-day streak and one freeze token; the app stayed closed since.
    await makeTestStore({
      save: { streak: { current: 7, longest: 7, lastDay: TODAY - 4, totalDays: 7, freezes: 1 }, quests: { day: TODAY - 4, ids: ['clear-due'], done: [] } },
    });
    expect(rollIfNeeded(store)).toBe(true);
    const s = store.streak.value;
    // TODAY-3 missed → token; TODAY-2 missed → ember (TODAY-1); TODAY-1 missed → still embers on the second ember day.
    expect(s.freezes).toBe(0);
    expect(s.ember).toBe(TODAY - 1);
    expect(s.current).toBe(7);
    expect(store.progress.value.awayDays).toBe(0);
  });

  it('awayDays 10 flags the absence, 31 sets welcomeBackDue, and a clock jump backwards never rolls', async () => {
    await makeTestStore({ save: { streak: { current: 3, longest: 3, lastDay: TODAY - 11, totalDays: 3 }, quests: { day: TODAY - 11, ids: [], done: [] } } });
    const cap = captureEvents();
    expect(rollIfNeeded(store)).toBe(true);
    cap.stop();
    expect(store.progress.value.awayDays).toBe(10);
    expect(store.progress.value.welcomeBackDue).toBe(false);
    expect(store.streak.value.current).toBe(0);
    expect(cap.events.filter(([n]) => n === 'day:rolled')).toEqual([['day:rolled', { day: TODAY, awayDays: 10 }]]);

    resetStoreForTests();
    bus.reset();
    await makeTestStore({ save: { streak: { current: 3, longest: 3, lastDay: TODAY - 32, totalDays: 3 } } });
    expect(rollIfNeeded(store)).toBe(true);
    expect(store.progress.value.awayDays).toBe(31);
    expect(store.progress.value.welcomeBackDue).toBe(true);
    // Rolled already; a save from the future (clock went backwards) stays put.
    store.patch('quests', (q) => ({ ...q, day: TODAY + 3 }));
    expect(rollIfNeeded(store)).toBe(false);
  });

  it('a short gap (< 7 days) leaves awayDays at 0', async () => {
    await makeTestStore({ save: { streak: { current: 3, longest: 3, lastDay: TODAY - 4, totalDays: 3 } } });
    rollIfNeeded(store);
    expect(store.progress.value.awayDays).toBe(0);
  });

  it('keeps awayDays through the spread window using the daily rows', async () => {
    // Away 10 days, came back yesterday and trained.
    const daily = rows([TODAY - 20, TODAY - 19, TODAY - 18, TODAY - 17, TODAY - 16, TODAY - 15, TODAY - 14, TODAY - 13, TODAY - 12, TODAY - 1]);
    await makeTestStore({ save: { streak: { current: 1, longest: 9, lastDay: TODAY - 1, totalDays: 10 }, daily, progress: { awayDays: 10 } } });
    rollIfNeeded(store);
    expect(store.progress.value.awayDays).toBe(10);
  });
});

describe('awayStatus (pure)', () => {
  it('a learner who never trained is not away', () => {
    expect(awayStatus({}, TODAY)).toEqual({ awayDays: 0, returnedDaysAgo: 0, newPaused: false, spreadDaysLeft: 0 });
  });

  it('returning today after 10 missed days: paused, spread of 7', () => {
    const daily = rows([TODAY - 12, TODAY - 11]);
    expect(awayStatus(daily, TODAY)).toEqual({ awayDays: 10, returnedDaysAgo: 0, newPaused: true, spreadDaysLeft: 7 });
  });

  it('two days back: pause lifted, spread continues; a week back: over', () => {
    const daily = rows([TODAY - 12, TODAY - 11, TODAY - 2, TODAY - 1]);
    expect(awayStatus(daily, TODAY)).toEqual({ awayDays: 8, returnedDaysAgo: 2, newPaused: false, spreadDaysLeft: 5 });
    const week = rows([TODAY - 30, TODAY - 7, TODAY - 6, TODAY - 5, TODAY - 4, TODAY - 3, TODAY - 2, TODAY - 1]);
    expect(awayStatus(week, TODAY).awayDays).toBe(0);
  });

  it('a gap under seven days is not an absence', () => {
    const daily = rows([TODAY - 5, TODAY - 1]);
    expect(awayStatus(daily, TODAY).awayDays).toBe(0);
  });
});

describe('startDayRoll', () => {
  it('rolls on start, on visibilitychange, on session:started and at the next 04:00; stops cleanly', async () => {
    vi.useFakeTimers();
    let clock = DEFAULT_TEST_NOW;
    await makeTestStore({ now: () => clock });
    const cap = captureEvents();
    const stop = startDayRoll(store);
    expect(store.quests.value.day).toBe(TODAY);
    const rolls = (): number => cap.events.filter(([n]) => n === 'day:rolled').length;
    expect(rolls()).toBe(1);

    // Same day: nothing.
    document.dispatchEvent(new Event('visibilitychange'));
    bus.emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    expect(rolls()).toBe(1);

    // Tab comes back the next day.
    clock += DAY_MS;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rolls()).toBe(2);
    expect(store.quests.value.day).toBe(TODAY + 1);

    // A session starting on yet another day rolls first.
    clock += DAY_MS;
    bus.emit('session:started', { sessionId: 's2', mode: 'kata', zen: false });
    expect(rolls()).toBe(3);

    // The timer fires at the boundary while the tab stays open.
    const wait = msUntilNextDay(store);
    expect(wait).toBeGreaterThan(0);
    clock += wait;
    await vi.advanceTimersByTimeAsync(wait);
    expect(rolls()).toBe(4);
    expect(store.quests.value.day).toBe(TODAY + 3);

    // welcome-back:done clears the flag.
    store.patch('progress', (p) => ({ ...p, welcomeBackDue: true }));
    bus.emit('welcome-back:done', {});
    expect(store.progress.value.welcomeBackDue).toBe(false);

    stop();
    cap.stop();
    clock += DAY_MS;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.quests.value.day).toBe(TODAY + 3);
  });

  it('monthRolled flags the first roll of a new month', () => {
    expect(monthRolled(0, TODAY)).toBe(false);
    expect(monthRolled(TODAY - 1, TODAY)).toBe(false);
    expect(monthRolled(TODAY - 31, TODAY)).toBe(true);
  });
});
