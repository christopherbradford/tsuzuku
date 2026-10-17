import { BELT_IDS } from '../content/types';
import { MISSIONS } from '../shared/catalog';
import { bus } from '../shared/events';
import { epochDay, weekOf } from '../shared/time';
import type { Ledger } from '../shared/store-types';
import {
  KIND_INDEX,
  LEDGER_GOAL_HOURS,
  addLedgerEntry,
  externalListeningHours,
  ledgerByWeek,
  ledgerHours,
  ledgerHoursBy,
  logMission,
  missionKind,
  startLedger,
  weekProgress,
  weeklyTargetHours,
  withEntry,
} from './ledger';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('weekly target (design 05 §9)', () => {
  it('rises by belt and is 8 h on the Dan road', () => {
    const expected: Record<(typeof BELT_IDS)[number], number> = { white: 0.5, yellow: 1, orange: 1, green: 3, blue: 5, purple: 5, brown: 7, black: 8 };
    for (const b of BELT_IDS) expect(weeklyTargetHours(b, 0)).toBe(expected[b]);
    expect(weeklyTargetHours('black', 1)).toBe(8);
    expect(weeklyTargetHours('white', 2)).toBe(8);
    expect(LEDGER_GOAL_HOURS).toBe(1500);
  });
});

describe('aggregation (pure)', () => {
  const ledger: Ledger = {
    entries: [
      [TODAY - 40, 60, 0, 1], // listen, external
      [TODAY - 3, 30, 1, 0], // read, app
      [TODAY - 2, 90, 2, 1], // watch, external
      [TODAY - 1, 15, 3, 1], // speak, external
      [TODAY, 45, 0, 0], // listen, app
    ],
    monthly: { '2024-01': 120 },
    missions: [],
  };

  it('ledgerHours by kind, total includes compacted months', () => {
    const m = { ...store.meta(), ledger };
    expect(ledgerHours(m)).toEqual({ total: 6, listen: 1.75, read: 0.5, watch: 1.5, speak: 0.25 });
    expect(ledgerHoursBy(m, { source: 1 })).toEqual({ total: 2.75, listen: 1, read: 0, watch: 1.5, speak: 0.25 });
    expect(ledgerHoursBy(m, { since: TODAY - 3, until: TODAY - 1 }).total).toBe(2.25);
    expect(externalListeningHours(m)).toBe(2.5);
  });

  it('ledgerByWeek groups the last N weeks oldest first', () => {
    const m = { ...store.meta(), ledger };
    const rows = ledgerByWeek(m, TODAY, 2);
    expect(rows.length).toBe(2);
    expect(rows[1].week).toBe(weekOf(TODAY));
    expect(rows[0].week).toBe(weekOf(TODAY) - 1);
    const sum = rows.reduce((a, r) => a + r.total, 0);
    const recent = ledger.entries.filter((e) => weekOf(e[0]) >= weekOf(TODAY) - 1).reduce((a, e) => a + e[1], 0);
    expect(sum).toBe(recent);
    for (const r of rows) expect(r.external + r.app).toBe(r.total);
  });

  it('weekProgress compares external minutes of this week with the belt target', () => {
    const m = { ...store.meta(), ledger: { ...ledger, entries: [[TODAY, 20, 0, 1], [TODAY, 10, 1, 0]] as Ledger['entries'] } };
    const p = weekProgress(m, TODAY);
    expect(p).toEqual({ minutes: 20, targetHours: 0.5, ratio: 20 / 30 });
    expect(weekProgress({ ...m, profile: { ...m.profile, belt: 'green' } }, TODAY).ratio).toBeCloseTo(20 / 180, 6);
  });

  it('withEntry keeps rows sorted by day and ignores empty minutes', () => {
    const l = withEntry({ entries: [[10, 5, 0, 1], [20, 5, 0, 1]], monthly: {}, missions: [] }, { day: 15, minutes: 7.4, kind: 1, source: 0 });
    expect(l.entries).toEqual([[10, 5, 0, 1], [15, 7, 1, 0], [20, 5, 0, 1]]);
    const same = { entries: [], monthly: {}, missions: [] };
    expect(withEntry(same, { day: 1, minutes: 0, kind: 1, source: 0 })).toBe(same);
    expect(withEntry(same, { day: 1, minutes: Number.NaN, kind: 1, source: 0 })).toBe(same);
  });
});

describe('addLedgerEntry / logMission', () => {
  it('adds the row first, then emits ledger:entry; a note fills the 5th column and goes to bookmarks', async () => {
    await makeTestStore();
    let seenRows = -1;
    const off = bus.on('ledger:entry', () => {
      seenRows = store.ledger.value.entries.length;
    });
    const cap = captureEvents();
    addLedgerEntry({ day: TODAY, minutes: 20, kind: KIND_INDEX.watch, source: 1, note: 'anime, episode 3' });
    addLedgerEntry({ day: TODAY, minutes: 0, kind: KIND_INDEX.watch, source: 1 });
    cap.stop();
    off();
    expect(seenRows).toBe(1);
    expect(store.ledger.value.entries).toEqual([[TODAY, 20, 2, 1, 'anime, episode 3']]);
    expect(store.bookmarks.value).toEqual([`${TODAY}: anime, episode 3`]);
    expect(cap.events.filter(([n]) => n === 'ledger:entry')).toEqual([['ledger:entry', { minutes: 20, kind: 2, source: 1 }]]);
  });

  it('logMission records the mission, the minutes and emits field-mission:done with the conversation flag', async () => {
    await makeTestStore();
    const cap = captureEvents();
    logMission('real-conversation', 18);
    logMission('read-aloud-sign', 0);
    logMission('not-a-mission', 10);
    cap.stop();
    const m = store.ledger.value;
    expect(m.missions).toEqual([
      { day: TODAY, tier: 5, conversation: true },
      { day: TODAY, tier: 1, conversation: false },
    ]);
    expect(m.entries).toEqual([
      [TODAY, 18, KIND_INDEX.speak, 1],
      [TODAY, 5, KIND_INDEX.read, 1],
    ]);
    expect(cap.events.filter(([n]) => n === 'field-mission:done')).toEqual([
      ['field-mission:done', { tier: 5, minutes: 18, conversation: true }],
      ['field-mission:done', { tier: 1, minutes: 5, conversation: false }],
    ]);
    const sub = MISSIONS.find((x) => x.id === 'subtitled-twenty')!;
    expect(missionKind(sub)).toBe(KIND_INDEX.watch);
  });
});

describe('startLedger reducer', () => {
  it('logs story and listening minutes automatically as app-source rows', async () => {
    await makeTestStore();
    const stop = startLedger(store);
    const cap = captureEvents();
    bus.emit('story:read', { storyId: 's-04-1', mode: 'read', chars: 400, cpm: 120, correct: 3, total: 3, glossTaps: 0, minutes: 4, bridge: false });
    bus.emit('listening:set', { storyId: 's-04-2', correct: 2, total: 3, rate: 1, minutes: 6 });
    bus.emit('story:read', { storyId: 's-04-1', mode: 'speed', chars: 400, cpm: 300, correct: 1, total: 1, glossTaps: 0, minutes: 0, bridge: false });
    cap.stop();
    expect(store.ledger.value.entries).toEqual([
      [TODAY, 4, KIND_INDEX.read, 0],
      [TODAY, 6, KIND_INDEX.listen, 0],
    ]);
    expect(cap.events.filter(([n]) => n === 'ledger:entry').length).toBe(2);
    stop();
    bus.emit('listening:set', { storyId: 's-04-2', correct: 2, total: 3, rate: 1, minutes: 6 });
    expect(store.ledger.value.entries.length).toBe(2);
  });
});
