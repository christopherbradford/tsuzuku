import { DRILL_IDS } from '../content/types';
import { CardFlag, hasFlag, type CardTuple, type LogEntry } from '../shared/store-types';
import {
  DEFEAT_STABILITY,
  NEMESIS_LAPSES,
  defeat,
  duelChain,
  duelProgress,
  isNemesis,
  markNemesis,
  nemesisDay,
  nemesisPhase,
  nextDuelKey,
  qualifiesNemesis,
  wonToday,
} from './leech';

const DAY = 86_400_000;
const dayOfMs = (ms: number) => Math.floor(ms / DAY);
const at = (day: number, n = 0) => day * DAY + n * 60_000;
const DUEL = DRILL_IDS.indexOf('nemesis-duel');
const RECALL = DRILL_IDS.indexOf('meaning-recall');

function card(o: Partial<{ lapses: number; flags: number; last: number; s: number; reps: number }> = {}): CardTuple {
  return [100, o.s ?? 20, 7.5, o.reps ?? 30, o.lapses ?? 0, 2, o.last ?? 100, o.flags ?? 0];
}
const KEY = 'v-n5-0042#prod' as const;

function againsOn(days: number[], key = KEY): LogEntry[] {
  return days.map((d, i) => [at(d, i), key, 1, 2000, RECALL, 0] as LogEntry);
}

describe('threshold', () => {
  it('isNemesis reads the flag; qualifiesNemesis reads lapses', () => {
    expect(isNemesis(card({ lapses: 8 }))).toBe(false);
    expect(qualifiesNemesis(card({ lapses: 7 }))).toBe(false);
    expect(qualifiesNemesis(card({ lapses: NEMESIS_LAPSES }))).toBe(true);
    const flagged = markNemesis(card({ lapses: 8 }));
    expect(isNemesis(flagged)).toBe(true);
    expect(qualifiesNemesis(flagged)).toBe(false);
    expect(hasFlag(flagged[7], CardFlag.nemesis)).toBe(true);
  });
  it('markNemesis keeps other flags and does not mutate', () => {
    const c = card({ flags: CardFlag.kaiden });
    const f = markNemesis(c);
    expect(hasFlag(f[7], CardFlag.kaiden)).toBe(true);
    expect(c[7]).toBe(CardFlag.kaiden);
  });
});

describe('phase timeline', () => {
  const log = againsOn([10, 20, 30, 40, 50, 60, 70, 80]); // 8th Again on day 80
  const c = markNemesis(card({ lapses: 8, last: 80 }));
  it('nemesisDay is the day of the Again that reached the threshold', () => {
    expect(nemesisDay(c, log, KEY, { dayOfMs })).toBe(80);
    // a 9th lapse later: the flagging Again is still the 8th
    const log9 = againsOn([10, 20, 30, 40, 50, 60, 70, 80, 85]);
    expect(nemesisDay(markNemesis(card({ lapses: 9 })), log9, KEY, { dayOfMs })).toBe(80);
  });
  it('dossier on the day, context for 14 days, then duel', () => {
    expect(nemesisPhase(c, log, 80, KEY, { dayOfMs })).toBe('dossier');
    expect(nemesisPhase(c, log, 81, KEY, { dayOfMs })).toBe('context');
    expect(nemesisPhase(c, log, 93, KEY, { dayOfMs })).toBe('context');
    expect(nemesisPhase(c, log, 94, KEY, { dayOfMs })).toBe('duel');
    expect(nemesisPhase(c, log, 500, KEY, { dayOfMs })).toBe('duel');
  });
  it('a card without the flag is in no phase', () => {
    expect(nemesisPhase(card({ lapses: 8 }), log, 100, KEY, { dayOfMs })).toBe('none');
  });
  it('falls back to card.last when the log ring lost the rows', () => {
    expect(nemesisPhase(c, [], 80, KEY, { dayOfMs })).toBe('dossier');
    expect(nemesisPhase(c, [], 90)).toBe('context');
  });
});

describe('duel progress', () => {
  const item = 'v-n5-0042';
  const win = (day: number, facet: string, n = 0): LogEntry => [at(day, n), `${item}#${facet}` as LogEntry[1], 3, 1500, DUEL, 0];
  const loss = (day: number, facet: string, n = 0): LogEntry => [at(day, n), `${item}#${facet}` as LogEntry[1], 1, 1500, DUEL, 0];

  it('chain is prod → listen → cloze', () => {
    expect(duelProgress([], item, { dayOfMs })).toEqual({ wins: 0, days: [], next: 'prod' });
    expect(duelProgress([win(100, 'prod')], item, { dayOfMs })).toEqual({ wins: 1, days: [100], next: 'listen' });
    expect(duelProgress([win(100, 'prod'), win(101, 'listen')], item, { dayOfMs }).next).toBe('cloze');
    expect(nextDuelKey([win(100, 'prod')], item, { dayOfMs })).toBe('v-n5-0042#listen');
  });
  it('3 wins must be on 3 distinct days', () => {
    const sameDay = [win(100, 'prod', 1), win(100, 'listen', 2), win(100, 'cloze', 3)];
    expect(duelProgress(sameDay, item, { dayOfMs }).wins).toBe(1);
    expect(wonToday(sameDay, item, 100, { dayOfMs })).toBe(true);
    const spread = [win(100, 'prod'), win(101, 'listen'), win(103, 'cloze')];
    const p = duelProgress(spread, item, { dayOfMs });
    expect(p).toEqual({ wins: 3, days: [100, 101, 103], next: null });
    expect(nextDuelKey(spread, item, { dayOfMs })).toBeNull();
  });
  it('losses and non-duel rows do not count; sinceMs limits the window', () => {
    const log: LogEntry[] = [loss(100, 'prod'), [at(101), `${item}#prod`, 3, 1000, RECALL, 0], win(102, 'prod')];
    expect(duelProgress(log, item, { dayOfMs }).wins).toBe(1);
    expect(duelProgress(log, item, { dayOfMs, sinceMs: at(103) }).wins).toBe(0);
    expect(duelProgress([win(100, 'prod')], 'v-n5-0043', { dayOfMs }).wins).toBe(0);
  });
  it('the chain is filtered to the facets the item has', () => {
    expect(duelChain(['read', 'comp'])).toEqual(['read', 'comp']);
    expect(duelChain(['cloze', 'prod'])).toEqual(['prod', 'cloze']);
    expect(duelProgress([], 'j-食', { dayOfMs, available: ['read', 'comp'] }).next).toBe('read');
  });
});

describe('defeat', () => {
  it('clears the nemesis flag, resets S to 3 d and lapses to 0, due in 3 days', () => {
    const c = markNemesis(card({ lapses: 9, flags: CardFlag.kaiden, s: 40, reps: 50 }));
    const d = defeat(c, 1000);
    expect(isNemesis(d)).toBe(false);
    expect(hasFlag(d[7], CardFlag.kaiden)).toBe(true);
    expect(d[1]).toBe(DEFEAT_STABILITY);
    expect(d[4]).toBe(0);
    expect(d[0]).toBe(1003);
    expect(d[6]).toBe(1000);
    expect(d[5]).toBe(2);
    expect(d[3]).toBe(50);
    expect(d[2]).toBe(c[2]);
    expect(qualifiesNemesis(d)).toBe(false);
    expect(c[4]).toBe(9); // immutable
  });
});
