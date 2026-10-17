import { QUEST_IDS, QUESTS as CATALOG, type QuestId } from '../shared/catalog';
import { bus, type Events } from '../shared/events';
import { registerExercise, resetRegistryForTests } from '../shared/exercise-types';
import { epochDay } from '../shared/time';
import { QUESTS, QUEST_COUNT, advanceQuest, eligibleQuests, isFullDay, pickQuests, questCounts, questProgress, questsForDay, startQuests } from './quests';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, TEST_SEED, captureEvents, makeTestStore } from './testing';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ALL = (): boolean => true;

function strandOf(id: QuestId): string {
  return CATALOG.find((q) => q.id === id)?.strand ?? '';
}

afterEach(() => {
  resetStoreForTests();
  resetRegistryForTests();
  bus.reset();
});

describe('QUESTS', () => {
  it('wraps the 17 catalog quests with a belt and an event', () => {
    expect(QUESTS.map((q) => q.id)).toEqual([...QUEST_IDS]);
    for (const q of QUESTS) {
      expect(typeof q.event).toBe('string');
      expect(q.minBelt).toBeDefined();
    }
    expect(QUESTS.find((q) => q.id === 'three-ways-one')?.minBelt).toBe('blue');
    expect(QUESTS.find((q) => q.id === 'clear-due')?.minBelt).toBe('white');
  });
});

describe('pickQuests', () => {
  it('is deterministic for (seed, day) and changes with either', () => {
    const a = pickQuests(TEST_SEED, TODAY, 'green', { station: 20, isRegistered: ALL });
    const b = pickQuests(TEST_SEED, TODAY, 'green', { station: 20, isRegistered: ALL });
    expect(a).toEqual(b);
    expect(a.length).toBe(QUEST_COUNT);
    const days = new Set<string>();
    for (let d = 0; d < 20; d++) days.add(pickQuests(TEST_SEED, TODAY + d, 'green', { station: 20, isRegistered: ALL }).join(','));
    expect(days.size).toBeGreaterThan(5);
    expect(pickQuests('another-seed-0000', TODAY, 'green', { station: 20, isRegistered: ALL })).not.toEqual(a);
  });

  it('never draws two quests of one strand', () => {
    for (let d = 0; d < 60; d++) {
      for (const station of [1, 4, 9, 16, 30, 53]) {
        const ids = pickQuests(TEST_SEED, TODAY + d, 'white', { station, isRegistered: ALL });
        const strands = ids.map(strandOf);
        expect(new Set(strands).size).toBe(strands.length);
        expect(ids.length).toBeLessThanOrEqual(QUEST_COUNT);
      }
    }
  });

  it('draws only quests available at the station (fromStation), falling back to the belt\'s first station', () => {
    for (let d = 0; d < 40; d++) {
      const ids = pickQuests(TEST_SEED, TODAY + d, 'white', { station: 2, isRegistered: ALL });
      for (const id of ids) expect(CATALOG.find((q) => q.id === id)!.fromStation).toBeLessThanOrEqual(2);
      // Only form + input strands exist at station 2: at most two quests.
      expect(ids.length).toBeLessThanOrEqual(2);
      const yellow = pickQuests(TEST_SEED, TODAY + d, 'yellow', { isRegistered: ALL });
      for (const id of yellow) expect(CATALOG.find((q) => q.id === id)!.fromStation).toBeLessThanOrEqual(4);
    }
  });

  it('respects `requires`: an unregistered drill keeps its quest out; an empty registry lets everything through', () => {
    expect(eligibleQuests(53, () => false).every((q) => q.requires === undefined)).toBe(true);
    expect(eligibleQuests(53).length).toBe(QUESTS.length); // registry empty → optimistic
    registerExercise({ id: 'kana-flash', facet: 'rec', needsTts: true, needsStt: false, selfGraded: false, timeable: true, keys: 'kana' }, () => null);
    expect(eligibleQuests(53).every((q) => q.requires === undefined)).toBe(true);
    for (let d = 0; d < 30; d++) {
      const ids = pickQuests(TEST_SEED, TODAY + d, 'black', { station: 53, isRegistered: (id) => id === 'shadow' });
      for (const id of ids) {
        const req = CATALOG.find((q) => q.id === id)!.requires;
        expect(req === undefined || req === 'shadow').toBe(true);
      }
    }
  });

  it('dropping an ineligible quest keeps the others in place (stable re-draw)', () => {
    let found = false;
    for (let d = 0; d < 60 && !found; d++) {
      const full = pickQuests(TEST_SEED, TODAY + d, 'black', { station: 53, isRegistered: ALL });
      const withReq = full.filter((id) => CATALOG.find((q) => q.id === id)!.requires !== undefined);
      if (withReq.length === 0) continue;
      found = true;
      const dropped = withReq[0];
      const again = pickQuests(TEST_SEED, TODAY + d, 'black', { station: 53, isRegistered: (x) => x !== CATALOG.find((q) => q.id === dropped)!.requires });
      for (const id of full) if (id !== dropped && CATALOG.find((q) => q.id === id)!.requires !== CATALOG.find((q) => q.id === dropped)!.requires) expect(again).toContain(id);
      expect(again).not.toContain(dropped);
    }
    expect(found).toBe(true);
  });
});

describe('slice helpers', () => {
  it('questsForDay keeps same-day progress on kept quests and resets on a new day', () => {
    const q1 = questsForDay({ day: 0, ids: [], done: [] }, TODAY, ['clear-due', 'michikusa-one']);
    expect(q1).toEqual({ day: TODAY, ids: ['clear-due', 'michikusa-one'], done: [], n: {} });
    const adv = advanceQuest(q1, 'clear-due', 12).quests;
    const done = advanceQuest(adv, 'michikusa-one', 1);
    expect(done.completed).toBe(true);
    expect(done.quests.done).toEqual(['michikusa-one']);
    const redrawn = questsForDay(done.quests, TODAY, ['clear-due', 'shadow-five']);
    expect(redrawn.done).toEqual([]);
    expect(questCounts(redrawn)).toEqual({ 'clear-due': 12 });
    expect(questsForDay(redrawn, TODAY + 1, ['clear-due']).done).toEqual([]);
    expect(questCounts(questsForDay(redrawn, TODAY + 1, ['clear-due']))).toEqual({});
    expect(questsForDay(redrawn, TODAY, ['clear-due', 'shadow-five'])).toBe(redrawn);
  });

  it('advanceQuest never lowers a count, ignores unknown or done quests', () => {
    const q = questsForDay({ day: 0, ids: [], done: [] }, TODAY, ['combo-twenty']);
    const a = advanceQuest(q, 'combo-twenty', (n) => Math.max(n, 7)).quests;
    expect(advanceQuest(a, 'combo-twenty', 3).quests).toBe(a);
    expect(advanceQuest(a, 'learn-scroll', 1).quests).toBe(a);
    const d = advanceQuest(a, 'combo-twenty', 25);
    expect(d.completed).toBe(true);
    expect(advanceQuest(d.quests, 'combo-twenty', 30).quests).toBe(d.quests);
    expect(isFullDay(d.quests)).toBe(true);
    expect(isFullDay({ day: TODAY, ids: [], done: [] })).toBe(false);
  });
});

describe('startQuests reducer', () => {
  function graded(o: Partial<Events['attempt:graded']> = {}): Events['attempt:graded'] {
    return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 900, errorTags: [], sessionId: 's', exercise: 'meaning-recall', itemId: 'v-n5-0001', kind: 'vocab', facet: 'rec', cardKey: 'v-n5-0001#rec', rating: 3, mature: false, ippon: false, kiai: false, combo: 1, recovery: false, firstProd: false, ...o };
  }
  let stop: () => void = () => undefined;
  afterEach(() => stop());

  it('advances today\'s quests, completes each once, and allDone fires once per day', async () => {
    await makeTestStore({ save: { quests: { day: TODAY, ids: ['learn-scroll', 'michikusa-one', 'shadow-five'], done: [] } } });
    stop = startQuests(store);
    const cap = captureEvents();
    bus.emit('scroll:completed', { scrollId: '4-1', itemIds: [], flawless: true });
    bus.emit('scroll:completed', { scrollId: '4-2', itemIds: [], flawless: true });
    bus.emit('michikusa:read', { id: 'm-04-1' });
    for (let i = 0; i < 4; i++) bus.emit('line:scored', { kind: 'shadow', score: 0.9, pass: true });
    expect(questProgress(store)).toEqual([
      { id: 'learn-scroll', done: true, n: 1, target: 1 },
      { id: 'michikusa-one', done: true, n: 1, target: 1 },
      { id: 'shadow-five', done: false, n: 4, target: 5 },
    ]);
    bus.emit('line:scored', { kind: 'shadow', score: 0.9, pass: true });
    bus.emit('line:scored', { kind: 'shadow', score: 0.9, pass: true });
    cap.stop();
    const completed = cap.events.filter(([n]) => n === 'quest:completed').map(([, p]) => p);
    expect(completed).toEqual([
      { id: 'learn-scroll', allDone: false },
      { id: 'michikusa-one', allDone: false },
      { id: 'shadow-five', allDone: true },
    ]);
    expect(isFullDay(store.quests.value)).toBe(true);
  });

  it('clear-due counts graded non-arcade reps and completes when nothing is due after a session', async () => {
    await makeTestStore({ save: { quests: { day: TODAY, ids: ['clear-due', 'combo-twenty'], done: [] } } });
    stop = startQuests(store);
    bus.emit('attempt:graded', graded({ combo: 5 }));
    bus.emit('attempt:graded', graded({ exercise: 'rapid-fire', rating: null, combo: 40 }));
    bus.emit('attempt:graded', graded({ rating: null, exercise: 'minimal-pair', combo: 6 }));
    expect(questProgress(store).find((q) => q.id === 'clear-due')?.n).toBe(1);
    expect(questProgress(store).find((q) => q.id === 'combo-twenty')?.n).toBe(6);
    const cap = captureEvents();
    bus.emit('session:finished', { planId: 'p', mode: 'kata', startedAt: 0, endedAt: 1, steps: [], tally: { reps: 1, correct: 1, accuracy: 1, bestCombo: 6, ippon: 0, xp: 2, minutes: 1, promotions: [], questsDone: [], backlogWaiting: 0 }, zen: false, resumed: false });
    cap.stop();
    expect(store.quests.value.done).toEqual(['clear-due']);
    expect(cap.events.filter(([n]) => n === 'quest:completed')).toEqual([['quest:completed', { id: 'clear-due', allDone: false }]]);
  });

  it('ignores events when the slice is not today\'s (the roll has not run)', async () => {
    await makeTestStore({ save: { quests: { day: TODAY - 1, ids: ['michikusa-one'], done: [] } } });
    stop = startQuests(store);
    bus.emit('michikusa:read', { id: 'm-04-1' });
    expect(store.quests.value.done).toEqual([]);
  });

  it('outside-twenty sums external minutes only; speed read and episode map to their quests', async () => {
    await makeTestStore({ save: { quests: { day: TODAY, ids: ['outside-twenty', 'speed-read-one', 'read-episode'], done: [] } } });
    stop = startQuests(store);
    bus.emit('ledger:entry', { minutes: 10, kind: 0, source: 0 });
    bus.emit('ledger:entry', { minutes: 15, kind: 0, source: 1 });
    bus.emit('story:read', { storyId: 's', mode: 'read', chars: 300, cpm: 100, correct: 1, total: 3, glossTaps: 0, minutes: 3, bridge: false });
    expect(questProgress(store).map((q) => q.n)).toEqual([15, 0, 0]);
    bus.emit('ledger:entry', { minutes: 10, kind: 0, source: 1 });
    bus.emit('story:read', { storyId: 's', mode: 'speed', chars: 300, cpm: 200, correct: 1, total: 1, glossTaps: 0, minutes: 1, bridge: false });
    bus.emit('story:read', { storyId: 's', mode: 'read', chars: 300, cpm: 100, correct: 2, total: 3, glossTaps: 0, minutes: 3, bridge: false });
    expect(store.quests.value.done.sort()).toEqual(['outside-twenty', 'read-episode', 'speed-read-one']);
  });

  it('re-draws on session:started after onboarding moved the learner off station 0', async () => {
    await makeTestStore({ save: { quests: { day: TODAY, ids: [], done: [] } } });
    stop = startQuests(store);
    bus.emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    expect(store.quests.value.ids).toEqual([]);
    store.patch('progress', (p) => ({ ...p, station: 1 }));
    bus.emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    expect(store.quests.value.ids.length).toBeGreaterThan(0);
    expect(store.quests.value.day).toBe(TODAY);
  });

  it('re-draws on session:started once the registry shows a drawn drill is missing', async () => {
    await makeTestStore({ save: { progress: { station: 9 }, quests: { day: TODAY, ids: ['clear-due', 'shadow-five'], done: ['clear-due'] } } });
    stop = startQuests(store);
    registerExercise({ id: 'kana-flash', facet: 'rec', needsTts: true, needsStt: false, selfGraded: false, timeable: true, keys: 'kana' }, () => null);
    bus.emit('session:started', { sessionId: 's', mode: 'kata', zen: false });
    const q = store.quests.value;
    expect(q.day).toBe(TODAY);
    expect(q.ids).not.toContain('shadow-five');
    for (const id of q.ids) expect(CATALOG.find((x) => x.id === id)!.requires).toBeUndefined();
    if (q.ids.includes('clear-due')) expect(q.done).toContain('clear-due');
  });
});
