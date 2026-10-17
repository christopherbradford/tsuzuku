import { render } from 'preact';
import { act } from 'preact/test-utils';
import { bus } from '@/shared/events';
import { href } from '@/shared/routes';
import { weekOf } from '@/shared/time';
import { resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, card, makeTestStore, type TestStoreOptions } from '@/store/testing';
import {
  DojoScene,
  KOTODAMA_MAX,
  PRUNED_AWAY_DAYS,
  SCENE_SIZE,
  badgeCategoryCount,
  blackCounts,
  buildScene,
  hotspotsFor,
  latestStampName,
  sceneInputs,
  sceneKey,
} from './DojoScene';
import { S, fill } from './strings';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  bus.reset();
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/** Two Black-belt vocab items and one Black kanji (every facet S ≥ 120 d). */
const BLACK_CARDS: NonNullable<TestStoreOptions['cards']> = {
  'v-n5-0001#rec': card({ s: 200, state: 2, due: 20_600 }),
  'v-n5-0001#prod': card({ s: 150, state: 2, due: 20_600 }),
  'v-n5-0002#rec': card({ s: 300, state: 2, due: 20_600 }),
  'v-n5-0002#prod': card({ s: 130, state: 2, due: 20_600 }),
  'j-食#comp': card({ s: 400, state: 2, due: 20_600 }),
  'j-食#read': card({ s: 125, state: 2, due: 20_600 }),
  // Brown, not Black: production too young
  'v-n5-0003#rec': card({ s: 200, state: 2, due: 20_600 }),
  'v-n5-0003#prod': card({ s: 10, state: 2, due: 20_600 }),
};

async function mount(o: TestStoreOptions = {}, compact = false): Promise<void> {
  await makeTestStore(o);
  act(() => render(<DojoScene compact={compact} />, root));
}

describe('<DojoScene>', () => {
  it('renders the room SVG from a test store with themed tokens and the belt tatami', async () => {
    await mount({ save: { profile: { belt: 'green', level: 23, chosenKanji: '続' }, streak: { totalDays: 42 } } });
    const art = root.querySelector('.dojo-scene__art')!;
    expect(art.getAttribute('role')).toBe('img');
    expect(art.getAttribute('aria-label')).toContain('green belt');
    expect(art.getAttribute('aria-label')).toContain('42 training days');
    const svg = art.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${SCENE_SIZE.full.w} ${SCENE_SIZE.full.h}`);
    expect(svg.querySelectorAll('.room__tatami').length).toBe(5);
    expect(svg.querySelector('.room__kanji text')?.textContent).toBe('続');
    expect(svg.querySelector('.bonsai')).not.toBeNull();
    expect(svg.querySelector('.dj-hf')).not.toBeNull();
    expect(art.innerHTML).toContain('var(--surface, #FFFBF3)');
    // 12:00 UTC test clock → daylight
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-phase')).toBe('day');
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-season')).toBe('winter'); // January
  });

  it('black-item counts feed the kotodama flames after the idle slot', async () => {
    await mount({ cards: BLACK_CARDS });
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-flames')).toBe('pending');
    expect(root.querySelectorAll('.dj-kf').length).toBe(0);
    await act(async () => {
      await tick();
    });
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-flames')).toBe('ready');
    expect(root.querySelectorAll('use.dj-kf').length).toBe(3);
    expect(root.querySelectorAll('use[data-kind="vocab"]').length).toBe(2);
    expect(root.querySelectorAll('use[data-kind="kanji"]').length).toBe(1);
    const caption = root.querySelector('.dojo-scene__caption')!;
    expect(caption.getAttribute('data-total')).toBe('3');
    expect(caption.textContent).toContain(fill(S.kotodamaCount, { total: 3 }));
    expect(caption.querySelector('[lang="ja"]')?.textContent).toBe(S.kotodamaJa);
  });

  it('shows the honest empty line when nothing is Black yet', async () => {
    await mount();
    await act(async () => {
      await tick();
    });
    expect(root.querySelectorAll('.dj-kf').length).toBe(0);
    expect(root.querySelector('.dojo-scene__caption')?.textContent).toContain(S.kotodamaNone);
  });

  it('same store → identical markup (and a pure, keyed build)', async () => {
    await mount({ cards: BLACK_CARDS, save: { profile: { belt: 'blue', level: 41 }, streak: { totalDays: 150, current: 12 } } });
    await act(async () => {
      await tick();
    });
    const first = root.querySelector('.dojo-scene__art')!.innerHTML;
    const other = document.createElement('div');
    document.body.appendChild(other);
    act(() => render(<DojoScene />, other));
    await act(async () => {
      await tick();
    });
    expect(other.querySelector('.dojo-scene__art')!.innerHTML).toBe(first);
    render(null, other);
    other.remove();

    const i = sceneInputs();
    expect(sceneKey(i)).toBe(sceneKey(sceneInputs()));
    expect(buildScene(i, true).svg).toBe(buildScene(i, true).svg);
    expect(buildScene(i, true).svg).toContain('class="dj-kotodama"');
    expect(buildScene(i, false).svg).not.toContain('class="dj-kotodama"');
  });

  it('hour of day lights the room: a 23:00 clock gives night, lit lanterns and the overlay', async () => {
    const NIGHT = Date.UTC(2026, 6, 15, 23, 0, 0); // July, 23:00 UTC (profile tz is UTC)
    await mount({ now: NIGHT, save: { profile: { level: 30 } } });
    const scene = root.querySelector('.dojo-scene')!;
    expect(scene.getAttribute('data-phase')).toBe('night');
    expect(scene.getAttribute('data-season')).toBe('summer');
    expect(root.querySelectorAll('.room__lantern--lit').length).toBe(3);
    expect(root.querySelector('.room__light--night')).not.toBeNull();
    expect(root.querySelector('.room__stars')).not.toBeNull();
  });

  it('reduced-motion path: no keyframes or animation anywhere in the scene', async () => {
    await mount({ cards: BLACK_CARDS, save: { settings: { reducedMotion: true }, streak: { lastDay: 20_468, current: 3 } } });
    await act(async () => {
      await tick();
    });
    const html = root.querySelector('.dojo-scene__art')!.innerHTML;
    expect(root.querySelectorAll('.dj-kf').length).toBe(3);
    expect(html).not.toContain('@keyframes');
    expect(html).not.toContain('animation');
    // and the default path does animate (kotodama drift + hearth flicker)
    render(null, root);
    resetStoreForTests();
    await mount({ cards: BLACK_CARDS, save: { streak: { lastDay: 20_468, current: 3 } } });
    await act(async () => {
      await tick();
    });
    const live = root.querySelector('.dojo-scene__art')!.innerHTML;
    expect(live).toContain('@keyframes dj-kf-drift-0');
    expect(live).toContain('@keyframes dj-hf-flicker');
    expect(live).toContain('prefers-reduced-motion');
  });

  it('hearth follows the streak flame: lit today → steady, full day → roaring, nothing → unlit', async () => {
    await makeTestStore();
    const t = store.today();
    expect(t).toBeGreaterThan(20_000);
    resetStoreForTests();
    await mount({ save: { streak: { lastDay: t, current: 4 } } });
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-hearth')).toBe('steady');
    render(null, root);
    resetStoreForTests();
    await mount({ save: { streak: { lastDay: t, current: 4 }, quests: { day: t, ids: ['clear-due', 'learn-scroll', 'combo-twenty'], done: ['clear-due', 'learn-scroll', 'combo-twenty'] } } });
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-hearth')).toBe('roaring');
    expect(root.querySelectorAll('.dj-hf-tongue').length).toBe(8);
    render(null, root);
    resetStoreForTests();
    await mount();
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-hearth')).toBe('unlit');
    const hearthLink = root.querySelector('[data-hotspot="hearth"]')!;
    expect(hearthLink.getAttribute('aria-label')).toContain(S.hearthUnlit);
  });

  it('hotspots are links built with href(): scroll → station, bonsai/hearth → records, racks → collections', async () => {
    await mount({ save: { progress: { station: 7 }, profile: { belt: 'yellow' }, collections: { badges: { 'first-step': 20_400, seven: 20_401, 'three-day': 20_402 } } } });
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.dojo-scene__hotspot'));
    expect(links.length).toBe(6);
    const by = (id: string): HTMLAnchorElement => root.querySelector(`[data-hotspot="${id}"]`)!;
    expect(by('scroll').getAttribute('href')).toBe(href({ name: 'station', n: 7 }));
    expect(by('scroll').getAttribute('aria-label')).toBe(fill(S.hotspotScroll, { n: 7, name: '平塚' }));
    expect(by('bonsai').getAttribute('href')).toBe(href({ name: 'records' }));
    expect(by('hearth').getAttribute('href')).toBe(href({ name: 'records' }));
    expect(by('rack').getAttribute('href')).toBe(href({ name: 'collections', tab: 'kakejiku' }));
    expect(by('rack').getAttribute('aria-label')).toContain('yellow belt');
    expect(by('shelf').getAttribute('href')).toBe(href({ name: 'collections', tab: 'mon' }));
    expect(by('shelf').getAttribute('aria-label')).toBe(fill(S.hotspotShelf, { n: 2, total: 9 }));
    expect(by('stamps').getAttribute('href')).toBe(href({ name: 'collections', tab: 'goshuin' }));
    for (const a of links) {
      expect(a.getAttribute('aria-label')).toBeTruthy();
      expect(a.style.left.endsWith('%')).toBe(true);
      expect(a.style.width.endsWith('%')).toBe(true);
    }
    expect(root.querySelectorAll('.room__mon--earned').length).toBe(2); // training + streak
  });

  it('station 0 sends the scroll to the road', async () => {
    await mount({ save: { progress: { station: 0 } } });
    expect(root.querySelector('[data-hotspot="scroll"]')?.getAttribute('href')).toBe(href({ name: 'road' }));
    expect(root.querySelector('[data-hotspot="scroll"]')?.getAttribute('aria-label')).toBe(S.hotspotScrollRoad);
  });

  it('collections and kage feed the picture: latest stamp open, Kage sits the week it was beaten', async () => {
    await makeTestStore();
    const t = store.today();
    resetStoreForTests();
    await mount({
      save: {
        collections: { stamps: { 4: { at: 20_300, perfect: false, assisted: false }, 7: { at: 20_400, perfect: true, assisted: false }, 5: { at: 20_400, perfect: false, assisted: false } } },
        kage: { beatenWeek: weekOf(t) },
      },
    });
    expect(root.querySelector('.room__goshuin')).not.toBeNull();
    expect(Array.from(root.querySelectorAll('.room__goshuin text')).map((e) => e.textContent).join('')).toBe('平塚');
    expect(root.querySelector('.room__kage')).not.toBeNull();
    render(null, root);
    resetStoreForTests();
    await mount({ save: { kage: { beatenWeek: weekOf(t) - 1 } } });
    expect(root.querySelector('.room__kage')).toBeNull();
    expect(root.querySelector('.room__book--closed')).not.toBeNull();
  });

  it('bonsai: blooms at 100 days, pruned after a long gap, compact stage', async () => {
    await mount({ save: { streak: { totalDays: 120 }, progress: { awayDays: PRUNED_AWAY_DAYS } } }, true);
    const b = root.querySelector('.bonsai')!;
    expect(b.classList.contains('bonsai--blooming')).toBe(true);
    expect(b.classList.contains('bonsai--pruned')).toBe(true);
    expect(root.querySelectorAll('.bonsai__bloom').length).toBeGreaterThan(0);
    expect(root.querySelector('.dojo-scene')?.classList.contains('dojo-scene--compact')).toBe(true);
    expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe(`0 0 ${SCENE_SIZE.compact.w} ${SCENE_SIZE.compact.h}`);
    render(null, root);
    resetStoreForTests();
    await mount({ save: { streak: { totalDays: 30 }, progress: { awayDays: 0 } } });
    const b2 = root.querySelector('.bonsai')!;
    expect(b2.classList.contains('bonsai--blooming')).toBe(false);
    expect(b2.classList.contains('bonsai--pruned')).toBe(false);
  });

  it('stays under the DOM budget with a full hall of flames', async () => {
    const many: NonNullable<TestStoreOptions['cards']> = {};
    for (let i = 1; i <= 350; i++) {
      const id = `v-n5-${String(i).padStart(4, '0')}`;
      many[`${id}#rec`] = card({ s: 300, state: 2, due: 20_600 });
      many[`${id}#prod`] = card({ s: 200, state: 2, due: 20_600 });
    }
    await mount({ cards: many, save: { profile: { belt: 'black', level: 99, dan: 3, chosenKanji: '道' }, streak: { totalDays: 400 }, collections: { stamps: { 53: { at: 20_500, perfect: true, assisted: false } } } } });
    await act(async () => {
      await tick();
    });
    expect(root.querySelectorAll('.dj-kf').length).toBe(KOTODAMA_MAX.full);
    const caption = root.querySelector('.dojo-scene__caption')!;
    expect(caption.getAttribute('data-total')).toBe('350');
    expect(caption.textContent).toContain(fill(S.kotodamaShown, { rendered: KOTODAMA_MAX.full, total: 350 }));
    expect(root.querySelectorAll('.dojo-scene__art *').length).toBeLessThan(400);
  });
});

describe('helpers', () => {
  it('blackCounts counts items whose every facet is Black', async () => {
    await makeTestStore({ cards: BLACK_CARDS });
    expect(blackCounts(store.cards)).toEqual({ kana: 0, vocab: 2, kanji: 1, grammar: 0, component: 0, chunk: 0 });
  });

  it('badgeCategoryCount counts distinct categories of earned badges', () => {
    expect(badgeCategoryCount({})).toBe(0);
    expect(badgeCategoryCount({ 'first-step': 1 })).toBe(1);
    expect(badgeCategoryCount({ 'first-step': 1, 'thousand-cuts': 2 })).toBe(1); // both training
    expect(badgeCategoryCount({ 'first-step': 1, tsuzuku: 2 })).toBe(2); // training + spirit
    expect(badgeCategoryCount({ 'first-step': 1, seven: 2, gojuon: 3, 'belt-yellow': 4 })).toBe(4);
  });

  it('latestStampName picks the newest day, farther station on a tie', () => {
    expect(latestStampName({})).toBeUndefined();
    expect(latestStampName({ 1: { at: 10, perfect: false, assisted: false } })).toBe('品川');
    expect(latestStampName({ 1: { at: 10, perfect: false, assisted: false }, 2: { at: 9, perfect: false, assisted: false } })).toBe('品川');
    expect(latestStampName({ 3: { at: 10, perfect: false, assisted: false }, 2: { at: 10, perfect: false, assisted: false } })).toBe('神奈川');
  });

  it('hotspotsFor returns percent boxes inside the stage', async () => {
    await makeTestStore();
    const i = sceneInputs();
    const built = buildScene(i, false);
    for (const h of hotspotsFor(i, built)) {
      expect(h.left).toBeGreaterThanOrEqual(0);
      expect(h.top).toBeGreaterThanOrEqual(0);
      expect(h.left + h.width).toBeLessThanOrEqual(100.01);
      expect(h.top + h.height).toBeLessThanOrEqual(100.01);
    }
    expect(DEFAULT_TEST_NOW).toBe(Date.UTC(2026, 0, 15, 12, 0, 0));
  });
});
