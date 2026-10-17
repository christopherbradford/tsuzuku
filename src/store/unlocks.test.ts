import type { CardKey } from '../content/types';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { KANA_SETS, type TriggerEvent } from './badge-defs';
import { resetStoreForTests, store } from './store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore, testSave } from './testing';
import {
  INDEXED_EVENTS,
  applyUnlocks,
  evaluateAll,
  evaluateFor,
  gatesClearedFor,
  isEmptyResult,
  promoteIfReady,
  reduceGate,
  reduceShinsa,
  runUnlocks,
  startUnlocks,
} from './unlocks';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function stable(s: number): CardTuple {
  return card({ s, state: 2, reps: 5, due: TODAY + 1, last: TODAY });
}

let stop: (() => void) | null = null;
let cap: ReturnType<typeof captureEvents> | null = null;

function events(name?: string): [string, unknown][] {
  const all = cap?.events ?? [];
  return name ? all.filter((e) => e[0] === name) : all;
}

afterEach(() => {
  stop?.();
  stop = null;
  cap?.stop();
  cap = null;
  resetStoreForTests();
  bus.reset();
});

describe('evaluateAll (pure)', () => {
  it('a fresh save yields nothing', () => {
    const r = evaluateAll(testSave());
    expect(isEmptyResult(r)).toBe(true);
  });

  it('lists unearned badges, unlockable wallpapers and pending reveals, skipping what is already earned', () => {
    const m = testSave({
      save: {
        stats: { sessions: 100, reviews: 600 },
        collections: { badges: { 'first-step': 10 }, wallpapers: { 'great-wave': { at: 0, reforges: 0, revealed: 1 } } },
      },
    });
    const r = evaluateAll(m);
    expect(r.badges).toContain('tsuzuku');
    expect(r.badges).not.toContain('first-step');
    expect(r.wallpapers).toEqual(['end-card']);
    expect(r.reveals).toEqual([['great-wave', 2]]);
  });

  it('never lists quadrant 4 as a reveal: 100 % is the unlock', () => {
    const r = evaluateAll(testSave({ save: { stats: { reviews: 1000 } } }));
    expect(r.wallpapers).toContain('great-wave');
    expect(r.reveals.find((x) => x[0] === 'great-wave')).toBeUndefined();
  });

  it('evaluateFor checks only the definitions indexed to the event', () => {
    const m = testSave({ save: { stats: { sessions: 1 } } });
    const ev: TriggerEvent = { name: 'arcade:done', payload: { mode: 'gojuon', correct: 46, misses: 0, ms: 50_000, recheck: [] } };
    const r = evaluateFor(m, ev);
    expect(r.badges).toEqual(['gojuon-perfect']);
    expect(INDEXED_EVENTS).toContain('arcade:done');
    expect(INDEXED_EVENTS).toContain('gate:result');
  });
});

describe('startUnlocks: badges', () => {
  it('earns once, keeps the day, and never double-awards', async () => {
    await makeTestStore();
    cap = captureEvents();
    stop = startUnlocks(store);
    expect(events('badge:earned')).toEqual([]);

    store.patch('stats', (s) => ({ ...s, sessions: 1 }));
    expect(events('badge:earned')).toEqual([['badge:earned', { id: 'first-step' }]]);
    expect(store.collections.value.badges['first-step']).toBe(TODAY);

    store.patch('stats', (s) => ({ ...s, sessions: 2, reviews: 5 }));
    store.patch('streak', (s) => ({ ...s, current: 1 }));
    expect(events('badge:earned')).toHaveLength(1);
    expect(store.collections.value.badges['first-step']).toBe(TODAY);
    expect(isEmptyResult(runUnlocks(store))).toBe(true);
  });

  it('nothing is removed when a counter regresses', async () => {
    await makeTestStore();
    cap = captureEvents();
    stop = startUnlocks(store);
    store.patch('streak', (s) => ({ ...s, current: 30, longest: 30 }));
    expect(events('badge:earned').map((e) => (e[1] as { id: string }).id)).toEqual(['three-day', 'seven', 'thirty']);
    store.patch('streak', (s) => ({ ...s, current: 0 }));
    expect(Object.keys(store.collections.value.badges).sort()).toEqual(['seven', 'thirty', 'three-day']);
    expect(events('badge:earned')).toHaveLength(3);
  });

  it('payload-based conditions fire from the event itself', async () => {
    await makeTestStore();
    cap = captureEvents();
    stop = startUnlocks(store);
    bus.emit('arcade:done', { mode: 'gojuon', correct: 46, misses: 0, ms: 59_999, recheck: [] });
    expect(store.collections.value.badges['gojuon-perfect']).toBe(TODAY);
    bus.emit('arcade:done', { mode: 'rapid', correct: 50, misses: 2, ms: 60_000, recheck: [] });
    expect(store.collections.value.wallpapers['insert-coin']?.at).toBe(TODAY);
    bus.emit('welcome-back:done', {});
    expect(store.collections.value.badges.comeback).toBe(TODAY);
    expect(store.collections.value.wallpapers.okaeri?.at).toBe(TODAY);
    // The same event again changes nothing.
    bus.emit('welcome-back:done', {});
    expect(events('badge:earned').filter((e) => (e[1] as { id: string }).id === 'comeback')).toHaveLength(1);
  });

  it('cascades: golden-ear unlocks waveform in the same run; badges come before wallpapers', async () => {
    await makeTestStore();
    cap = captureEvents();
    stop = startUnlocks(store);
    store.patch('stats', (s) => ({ ...s, dictation95at1x: 100 }));
    const names = events().map((e) => e[0]);
    expect(names).toEqual(['badge:earned', 'wallpaper:unlocked']);
    expect(store.collections.value.badges['golden-ear']).toBe(TODAY);
    expect(store.collections.value.wallpapers.waveform).toEqual({ at: TODAY, reforges: 0, revealed: 4 });
  });

  it('kana badges read the cards; the card version triggers re-evaluation', async () => {
    const cards: Record<CardKey, CardTuple> = {};
    for (const id of KANA_SETS.hiraganaBasic.slice(1)) cards[`${id}#rec`] = stable(10);
    await makeTestStore({ cards });
    cap = captureEvents();
    stop = startUnlocks(store);
    expect(store.collections.value.badges.gojuon).toBeUndefined();
    store.cards.set('k-h-a#rec', stable(7));
    expect(store.collections.value.badges.gojuon).toBe(TODAY);
    expect(events('badge:earned')).toEqual([['badge:earned', { id: 'gojuon' }]]);
  });

  it('reconciles an imported save at start (replay without double awards)', async () => {
    await makeTestStore({
      save: { stats: { sessions: 5, reviews: 1200 }, collections: { badges: { 'first-step': 42 } } },
    });
    cap = captureEvents();
    stop = startUnlocks(store);
    const ids = events('badge:earned').map((e) => (e[1] as { id: string }).id);
    expect(ids).toContain('thousand-cuts');
    expect(ids).not.toContain('first-step');
    expect(store.collections.value.badges['first-step']).toBe(42);
    expect(store.collections.value.wallpapers['great-wave']?.at).toBe(TODAY);
  });

  it('stops listening after the returned unsubscribe', async () => {
    await makeTestStore();
    cap = captureEvents();
    const off = startUnlocks(store);
    off();
    store.patch('stats', (s) => ({ ...s, sessions: 1 }));
    bus.emit('welcome-back:done', {});
    expect(events('badge:earned')).toEqual([]);
    expect(store.collections.value.badges).toEqual({});
  });
});

describe('startUnlocks: wallpaper reveals', () => {
  it('quadrants fire once each at 25/50/75 %, the unlock at 100 %, and never regress', async () => {
    await makeTestStore();
    cap = captureEvents();
    stop = startUnlocks(store);
    const reveals = () => events('wallpaper:revealed').filter((e) => (e[1] as { id: string }).id === 'great-wave');

    store.patch('stats', (s) => ({ ...s, reviews: 249 }));
    expect(reveals()).toHaveLength(0);
    store.patch('stats', (s) => ({ ...s, reviews: 250 }));
    expect(reveals()).toEqual([['wallpaper:revealed', { id: 'great-wave', quadrant: 1 }]]);
    expect(store.collections.value.wallpapers['great-wave']).toEqual({ at: 0, reforges: 0, revealed: 1 });

    store.patch('stats', (s) => ({ ...s, reviews: 260 }));
    expect(reveals()).toHaveLength(1);
    // A jump reveals every quadrant passed, in order.
    store.patch('stats', (s) => ({ ...s, reviews: 760 }));
    expect(reveals().map((e) => (e[1] as { quadrant: number }).quadrant)).toEqual([1, 2, 3]);
    // Regression removes nothing.
    store.patch('stats', (s) => ({ ...s, reviews: 10 }));
    expect(store.collections.value.wallpapers['great-wave']?.revealed).toBe(3);

    store.patch('stats', (s) => ({ ...s, reviews: 1000 }));
    expect(reveals()).toHaveLength(3);
    expect(events('wallpaper:unlocked').filter((e) => (e[1] as { id: string }).id === 'great-wave')).toHaveLength(1);
    expect(store.collections.value.wallpapers['great-wave']).toEqual({ at: TODAY, reforges: 0, revealed: 4 });
    store.patch('stats', (s) => ({ ...s, reviews: 2000 }));
    expect(events('wallpaper:unlocked')).toHaveLength(1);
  });

  it('applyUnlocks keeps reforge data on a reveal stub and on unlock', async () => {
    await makeTestStore({ save: { collections: { wallpapers: { onsen: { at: 0, reforges: 2, revealed: 1, lastReforgeDay: 5 } } } } });
    applyUnlocks(store, { badges: [], wallpapers: [], reveals: [['onsen', 2]] });
    expect(store.collections.value.wallpapers.onsen).toEqual({ at: 0, reforges: 2, revealed: 2, lastReforgeDay: 5 });
    applyUnlocks(store, { badges: [], wallpapers: ['onsen'], reveals: [] });
    expect(store.collections.value.wallpapers.onsen).toEqual({ at: TODAY, reforges: 2, revealed: 4, lastReforgeDay: 5 });
    // Applying an empty result is a no-op.
    const before = store.collections.value;
    applyUnlocks(store, { badges: [], wallpapers: [], reveals: [] });
    expect(store.collections.value).toBe(before);
  });
});

describe('gate:result reducer', () => {
  it('pass → cleared station, stamp, stamp:earned once; replays are no-ops', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    cap = captureEvents();
    stop = startUnlocks(store);
    bus.emit('gate:result', { station: 4, outcome: 'pass', score: 0.9, phases: [0.9, 0.9, 0.9, 1] });
    expect(store.progress.value.stationsCleared).toEqual([4]);
    expect(store.collections.value.stamps[4]).toEqual({ at: TODAY, perfect: false, assisted: false });
    expect(events('stamp:earned')).toEqual([['stamp:earned', { station: 4, perfect: false, assisted: false }]]);
    expect(store.collections.value.badges['gatekeepers-respect']).toBe(TODAY);
    expect(store.collections.value.wallpapers['station-sign']?.at).toBe(TODAY);
    bus.emit('gate:result', { station: 4, outcome: 'pass', score: 0.95, phases: [] });
    expect(events('stamp:earned')).toHaveLength(1);
    expect(store.progress.value.stationsCleared).toEqual([4]);
  });

  it('perfect counts once per station; fail changes nothing', async () => {
    await makeTestStore();
    cap = captureEvents();
    stop = startUnlocks(store);
    bus.emit('gate:result', { station: 5, outcome: 'fail', score: 0.5, phases: [] });
    expect(store.progress.value.stationsCleared).toEqual([]);
    expect(events().filter((e) => e[0] !== 'gate:result')).toEqual([]);
    bus.emit('gate:result', { station: 5, outcome: 'perfect', score: 1, phases: [] });
    expect(store.progress.value.perfectGates).toBe(1);
    expect(store.collections.value.stamps[5]?.perfect).toBe(true);
    expect(store.collections.value.badges['perfect-gate']).toBe(TODAY);
    bus.emit('gate:result', { station: 5, outcome: 'perfect', score: 1, phases: [] });
    expect(store.progress.value.perfectGates).toBe(1);
    expect(events('stamp:earned')).toHaveLength(1);
    // A perfect run after a plain pass upgrades the stamp (gold frame) and presses it again.
    bus.emit('gate:result', { station: 6, outcome: 'pass', score: 0.9, phases: [] });
    bus.emit('gate:result', { station: 6, outcome: 'perfect', score: 1, phases: [] });
    expect(store.collections.value.stamps[6]).toEqual({ at: TODAY, perfect: true, assisted: false });
    expect(store.progress.value.perfectGates).toBe(2);
    expect(events('stamp:earned')).toHaveLength(3);
  });

  it('assisted → grey corner; revenge → full stamp, 雪辱 badge, corner removed', async () => {
    await makeTestStore();
    cap = captureEvents();
    stop = startUnlocks(store);
    bus.emit('gate:result', { station: 7, outcome: 'assisted', score: 0.82, phases: [] });
    expect(store.progress.value.assisted).toEqual([7]);
    expect(store.progress.value.stationsCleared).toEqual([7]);
    expect(store.collections.value.stamps[7]).toEqual({ at: TODAY, perfect: false, assisted: true });
    expect(store.collections.value.badges.revenge).toBeUndefined();
    bus.emit('gate:result', { station: 7, outcome: 'revenge', score: 0.9, phases: [] });
    expect(store.progress.value.assisted).toEqual([]);
    expect(store.collections.value.stamps[7]).toEqual({ at: TODAY, perfect: false, assisted: false });
    expect(store.collections.value.badges.revenge).toBe(TODAY);
    expect(events('stamp:earned').map((e) => (e[1] as { assisted: boolean }).assisted)).toEqual([true, false]);
  });

  it('reduceGate is callable directly and keeps stationsCleared sorted', async () => {
    await makeTestStore({ save: { progress: { stationsCleared: [1, 3] } } });
    reduceGate(store, { station: 2, outcome: 'pass', score: 0.9, phases: [] });
    expect(store.progress.value.stationsCleared).toEqual([1, 2, 3]);
  });
});

describe('belt promotion (shinsa:result + gates)', () => {
  it('requires every Gatekeeper of the belt as well as the Shinsa', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: range(1, 8) } } });
    cap = captureEvents();
    stop = startUnlocks(store);
    bus.emit('shinsa:result', { belt: 'yellow', passed: true, sections: { ear: 0.9, read: 0.9, form: 0.9, mouth: 0.9, write: 0.9 } });
    expect(store.progress.value.shinsaPassed).toEqual(['yellow']);
    expect(store.profile.value.belt).toBe('white');
    expect(events('belt:promoted')).toEqual([]);
    // The belt badge follows the Shinsa itself (design 06 §2), the promotion waits for the gate.
    expect(store.collections.value.badges['belt-yellow']).toBe(TODAY);
    expect(gatesClearedFor(store.meta(), 'yellow')).toBe(false);

    bus.emit('gate:result', { station: 9, outcome: 'pass', score: 0.9, phases: [] });
    expect(gatesClearedFor(store.meta(), 'yellow')).toBe(true);
    expect(store.profile.value.belt).toBe('yellow');
    expect(events('belt:promoted')).toEqual([['belt:promoted', { belt: 'yellow' }]]);
  });

  it('promotes at once when the gates are already cleared; a failed exam changes nothing', async () => {
    await makeTestStore({ save: { profile: { belt: 'yellow' }, progress: { station: 15, stationsCleared: range(1, 15), shinsaPassed: ['yellow'] } } });
    cap = captureEvents();
    stop = startUnlocks(store);
    const sections = { ear: 0.9, read: 0.9, form: 0.9, mouth: 0.9, write: 0.9 };
    bus.emit('shinsa:result', { belt: 'orange', passed: false, sections: { ...sections, form: 0.5 } });
    expect(store.progress.value.shinsaPassed).toEqual(['yellow']);
    expect(events('belt:promoted')).toEqual([]);
    bus.emit('shinsa:result', { belt: 'orange', passed: true, sections });
    expect(store.progress.value.shinsaPassed).toEqual(['yellow', 'orange']);
    expect(store.profile.value.belt).toBe('orange');
    expect(store.profile.value.dan).toBe(0);
    expect(events('belt:promoted')).toEqual([['belt:promoted', { belt: 'orange' }]]);
    expect(store.collections.value.badges['belt-orange']).toBe(TODAY);
  });

  it('the Shodan Shinsa sets dan 1 and unlocks kyoto-arrival; Shinsa-gated wallpapers follow their belt', async () => {
    await makeTestStore({ save: { profile: { belt: 'brown' }, progress: { station: 53, stationsCleared: range(1, 53), shinsaPassed: ['yellow', 'orange', 'green', 'blue', 'purple', 'brown'] } } });
    cap = captureEvents();
    stop = startUnlocks(store);
    const sections = { ear: 0.9, read: 0.9, form: 0.9, mouth: 0.9, write: 0.9 };
    bus.emit('shinsa:result', { belt: 'black', passed: true, sections });
    expect(store.profile.value.belt).toBe('black');
    expect(store.profile.value.dan).toBe(1);
    expect(store.collections.value.badges['belt-black']).toBe(TODAY);
    expect(store.collections.value.wallpapers['kyoto-arrival']?.at).toBe(TODAY);
    // Already unlocked at start from the imported shinsaPassed list:
    for (const id of ['fuji-ridge', 'daruma', 'koi-dragon', 'wall-broken'] as const) expect(store.collections.value.wallpapers[id]?.at).toBe(TODAY);
    expect(store.collections.value.badges['beyond-the-wall']).toBe(TODAY);
  });

  it('never demotes: a lower belt Shinsa passed later leaves the belt alone', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' }, progress: { stationsCleared: range(1, 24), shinsaPassed: ['yellow', 'green'] } } });
    cap = captureEvents();
    stop = startUnlocks(store);
    reduceShinsa(store, { belt: 'orange', passed: true, sections: { ear: 1, read: 1, form: 1, mouth: 1, write: 1 } });
    expect(store.profile.value.belt).toBe('green');
    expect(store.progress.value.shinsaPassed).toEqual(['yellow', 'green', 'orange']);
    expect(events('belt:promoted')).toEqual([['belt:promoted', { belt: 'orange' }]]);
    expect(promoteIfReady(store)).toBeNull();
  });
});
