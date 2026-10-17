import { bus, type Events } from '../shared/events';
import { epochDay, weekdayOf } from '../shared/time';
import type { Streak } from '../shared/store-types';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from './testing';
import {
  FREEZE_MAX,
  REVIEWS_FOR_A_DAY,
  activeDaysInWeek,
  endVacation,
  flameState,
  onDayRolled,
  onTrainingDay,
  startStreak,
  startVacation,
  type RepairWindow,
} from './streak';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const D0 = 20_000;

function fresh(o: Partial<Streak> = {}): Streak {
  return { current: 0, longest: 0, lastDay: 0, totalDays: 0, freezes: 0, repairs: 0, restDaysTaken: 0, weekly: 0, emberRestores: 0, ...o };
}

/**
 * Simulate a day sequence from D0: `T` trained (Kata), `K` Kumite or larger,
 * `-` missed, with the roll applied at the start of every day. Returns the
 * state after each day and asserts the identity invariants throughout.
 */
function run(seq: string, restDay: number | null = null, start: Streak = fresh(), startDay = D0): { final: Streak; states: Streak[]; flames: string[] } {
  let s = start;
  const states: Streak[] = [];
  const flames: string[] = [];
  let prevTotal = s.totalDays;
  let prevLongest = s.longest;
  for (let i = 0; i < seq.length; i++) {
    const day = startDay + i;
    s = onDayRolled(s, day, restDay);
    flames.push(flameState(s, day, restDay));
    const c = seq[i];
    if (c === 'T' || c === 'K') s = onTrainingDay(s, day, false, { restore: c === 'K' });
    expect(s.totalDays).toBeGreaterThanOrEqual(prevTotal);
    expect(s.longest).toBeGreaterThanOrEqual(prevLongest);
    prevTotal = s.totalDays;
    prevLongest = s.longest;
    states.push(s);
  }
  return { final: s, states, flames };
}

describe('day sequences (design 03 §7)', () => {
  const table: [string, string, Partial<Streak>][] = [
    ['three days', 'TTT', { current: 3, longest: 3, totalDays: 3, freezes: 0 }],
    ['a freeze token every 7 days', 'TTTTTTT', { current: 7, freezes: 1 }],
    ['tokens hold at 3', 'T'.repeat(28), { current: 28, freezes: FREEZE_MAX }],
    ['a token covers a missed day', 'TTTTTTT-T', { current: 8, freezes: 0, totalDays: 8 }],
    ['two tokens cover two separate misses', 'T'.repeat(14) + '-T-T', { current: 16, freezes: 0 }],
    ['no token: ember, then a Kumite restores', 'TT-K', { current: 3, emberRestores: 1, totalDays: 3 }],
    ['a Kata keeps the day; the flame is not restored', 'TT-T', { current: 3, emberRestores: 0, totalDays: 3 }],
    ['both ember days missed: broken, repair window open', 'TT----', { current: 0, repairs: 0, totalDays: 2 }],
    ['repair: three of the next five restore the count', 'TT---TT-T', { current: 5, repairs: 1, totalDays: 5 }],
    ['repair window fails after five days', 'TT---T----T', { current: 1, repairs: 0, totalDays: 4 }],
    ['nothing ever trained: nothing to judge', '---', { current: 0, totalDays: 0 }],
  ];
  it.each(table)('%s', (_label, seq, expected) => {
    const { final } = run(seq);
    for (const [k, v] of Object.entries(expected)) expect(final[k as keyof Streak]).toBe(v);
  });

  it('ember timeline: embers for two days, then out', () => {
    const { states, flames } = run('TT---');
    expect(states[2].ember).toBeUndefined(); // judged on the next roll
    expect(states[3].ember).toBe(D0 + 3);
    expect(flames[3]).toBe('ember');
    expect(flames[4]).toBe('ember');
    // Rolling into the day after both ember days breaks the streak.
    const after = onDayRolled(states[4], D0 + 5, null);
    expect(after.current).toBe(0);
    expect(after.ember).toBeUndefined();
    expect(flameState(after, D0 + 5, null)).toBe('broken');
    const w = after.repairWindow as RepairWindow;
    expect(w).toEqual({ start: D0 + 5, done: 0, prev: 2 });
  });

  it('a stale ember goes out after a Kata without breaking anything', () => {
    const { states, flames } = run('TT-TT');
    expect(states[3].ember).toBe(D0 + 3);
    expect(flames[4]).toBe('lit');
    expect(states[4].current).toBe(4);
    const rolled = onDayRolled(states[4], D0 + 5, null);
    expect(rolled.ember).toBeUndefined();
    expect(rolled.current).toBe(4);
  });

  it('one repair per 30 days', () => {
    const { final } = run('TT---TTT');
    expect(final.repairs).toBe(1);
    expect(final.lastRepairDay).toBe(D0 + 7);
    // Break again right away (embers, then two misses): no window this time.
    const again = run('----', null, final, D0 + 8).final;
    expect(again.current).toBe(0);
    expect(again.repairWindow).toBeUndefined();
    expect(again.totalDays).toBe(final.totalDays);
    // Thirty days later a break opens a window again.
    let later: Streak = { ...final, lastDay: D0 + 40, current: 3 };
    for (const d of [D0 + 42, D0 + 43, D0 + 44]) later = onDayRolled(later, d, null);
    expect(later.current).toBe(0);
    expect(later.repairWindow).toEqual({ start: D0 + 44, done: 0, prev: 3 });
  });

  it('a planned rest day never breaks the streak and consumes no token', () => {
    const missed = D0 + 2;
    const restDay = weekdayOf(missed);
    const { final, flames } = run('TT-T', restDay);
    expect(final.current).toBe(3);
    expect(final.restDaysTaken).toBe(1);
    expect(final.freezes).toBe(0);
    expect(final.ember).toBeUndefined();
    // On the rest day itself (trained yesterday) the flame reads 'rest'.
    expect(flames[2]).toBe('rest');
    // The morning after a rest day the flame is lit, not frozen.
    expect(flames[3]).toBe('lit');
  });

  it('rest days only count while a streak is alive', () => {
    const restDay = weekdayOf(D0 + 1);
    const { final } = run('--', restDay);
    expect(final.restDaysTaken).toBe(0);
  });

  it('freeze applies before ember', () => {
    const { states } = run('TTTTTTT-');
    expect(states[7].freezes).toBe(1);
    const judged = onDayRolled(states[7], D0 + 8, null);
    expect(judged.freezes).toBe(0);
    expect(judged.ember).toBeUndefined();
    expect(judged.current).toBe(7);
    expect(flameState(judged, D0 + 8, null)).toBe('frozen');
  });

  it('vacation freezes the flame; judgment resumes after it ends', () => {
    let s = run('TTT').final;
    s = startVacation(s, D0 + 10, D0 + 3);
    expect(s.vacationUntil).toBe(D0 + 10);
    expect(flameState(s, D0 + 4, null)).toBe('frozen');
    for (let d = D0 + 3; d <= D0 + 11; d++) s = onDayRolled(s, d, null);
    expect(s.current).toBe(3);
    expect(s.vacationUntil).toBe(D0 + 10);
    s = onDayRolled(s, D0 + 12, null); // day 11 missed, after the vacation
    expect(s.vacationUntil).toBeUndefined();
    expect(s.ember).toBe(D0 + 12);
    expect(startVacation(fresh(), D0 + 90, D0).vacationUntil).toBe(D0 + 30);
    expect(endVacation(s)).toBe(s);
  });

  it('onTrainingDay and onDayRolled are idempotent', () => {
    const s = onTrainingDay(fresh(), D0);
    expect(onTrainingDay(s, D0)).toBe(s);
    const rolled = onDayRolled(s, D0 + 1, null);
    expect(rolled).toBe(s);
    expect(onDayRolled(rolled, D0 + 1, null)).toBe(rolled);
  });

  it('weekly flame counts on the fifth active day of a week', () => {
    const base = fresh({ current: 4, lastDay: D0 - 1, totalDays: 4 });
    expect(onTrainingDay(base, D0, false, { activeDaysThisWeek: 4 }).weekly).toBe(0);
    expect(onTrainingDay(base, D0, false, { activeDaysThisWeek: 5 }).weekly).toBe(1);
    expect(onTrainingDay(base, D0, false, { activeDaysThisWeek: 6 }).weekly).toBe(0);
    const monday = Math.floor((D0 + 3) / 7) * 7 - 3;
    const daily = { [monday]: { reps: 5, ok: 5, minutes: 1, xp: 0, input: 0 }, [monday + 1]: { reps: 0, ok: 0, minutes: 3, xp: 0, input: 0 }, [monday + 2]: { reps: 0, ok: 0, minutes: 0, xp: 0, input: 0 } };
    expect(activeDaysInWeek(daily, monday + 3)).toBe(3);
  });

  it('flameState mirrors the visible states', () => {
    const base = fresh({ current: 3, longest: 5, lastDay: TODAY, totalDays: 10, weekly: 1 });
    expect(flameState(base, TODAY, null)).toBe('lit');
    expect(flameState(base, TODAY, null, true)).toBe('gold');
    expect(flameState({ ...base, lastDay: TODAY - 1 }, TODAY, null)).toBe('lit');
    expect(flameState({ ...base, lastDay: TODAY - 1, ember: TODAY }, TODAY, null)).toBe('ember');
    expect(flameState({ ...base, vacationUntil: TODAY + 3 }, TODAY, null)).toBe('frozen');
    expect(flameState({ ...base, current: 0, lastDay: TODAY - 9 }, TODAY, null)).toBe('broken');
    expect(flameState({ ...base, lastDay: TODAY - 2 }, TODAY, null)).toBe('frozen');
    expect(flameState({ ...base, lastDay: TODAY - 1 }, TODAY, weekdayOf(TODAY))).toBe('rest');
    const w: RepairWindow = { start: TODAY - 1, done: 1, prev: 9 };
    expect(flameState({ ...base, current: 1, lastDay: TODAY - 1, repairWindow: w }, TODAY, null)).toBe('broken');
  });
});

describe('startStreak reducer', () => {
  function finished(mode: Events['session:finished']['mode'] = 'kata'): Events['session:finished'] {
    return { planId: 'p1', mode, startedAt: DEFAULT_TEST_NOW - 60_000, endedAt: DEFAULT_TEST_NOW, steps: [], tally: { reps: 10, correct: 9, accuracy: 0.9, bestCombo: 5, ippon: 0, xp: 20, minutes: 1, promotions: [], questsDone: [], backlogWaiting: 0 }, zen: false, resumed: false };
  }
  function graded(): Events['attempt:graded'] {
    return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 900, errorTags: [], sessionId: 'p1', exercise: 'kana-flash', itemId: 'k-h-a', kind: 'kana', facet: 'rec', cardKey: 'k-h-a#rec', rating: 3, mature: false, ippon: false, kiai: false, combo: 1, recovery: false, firstProd: false };
  }

  let stop: () => void = () => undefined;
  afterEach(() => {
    stop();
    resetStoreForTests();
    bus.reset();
  });

  it('a finished session credits the day once and announces the flame', async () => {
    await makeTestStore({ save: { streak: { current: 2, lastDay: TODAY - 1, totalDays: 2, longest: 2 } } });
    stop = startStreak(store);
    const cap = captureEvents();
    bus.emit('session:finished', finished());
    bus.emit('session:finished', finished('kumite'));
    cap.stop();
    expect(store.streak.value.current).toBe(3);
    expect(store.streak.value.totalDays).toBe(3);
    expect(cap.events.filter(([n]) => n === 'streak:changed')).toEqual([['streak:changed', { current: 3, state: 'lit' }]]);
  });

  it('twenty graded reviews make a day without a finished session; arcade reps do not', async () => {
    await makeTestStore();
    stop = startStreak(store);
    for (let i = 0; i < REVIEWS_FOR_A_DAY - 1; i++) bus.emit('attempt:graded', graded());
    expect(store.streak.value.lastDay).toBe(0);
    bus.emit('attempt:graded', { ...graded(), exercise: 'rapid-fire', rating: null });
    expect(store.streak.value.lastDay).toBe(0);
    bus.emit('attempt:graded', graded());
    expect(store.streak.value.lastDay).toBe(TODAY);
    expect(store.streak.value.current).toBe(1);
  });

  it('a Kumite inside the ember window restores the flame; all quests done announces gold', async () => {
    await makeTestStore({ save: { streak: { current: 4, lastDay: TODAY - 2, totalDays: 4, longest: 4, ember: TODAY } } });
    stop = startStreak(store);
    const cap = captureEvents();
    bus.emit('session:finished', finished('kumite'));
    expect(store.streak.value.ember).toBeUndefined();
    expect(store.streak.value.emberRestores).toBe(1);
    expect(store.streak.value.current).toBe(5);
    store.patch('quests', (q) => ({ ...q, day: TODAY, ids: ['clear-due', 'michikusa-one'], done: ['clear-due', 'michikusa-one'] }));
    bus.emit('quest:completed', { id: 'michikusa-one', allDone: true });
    bus.emit('day:rolled', { day: TODAY, awayDays: 0 });
    cap.stop();
    const states = cap.events.filter(([n]) => n === 'streak:changed').map(([, p]) => (p as { state: string }).state);
    expect(states).toEqual(['lit', 'gold', 'gold']);
  });
});
