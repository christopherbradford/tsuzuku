/**
 * StationPage.tsx — quotas from STATIONS, progress bars, scrolls, texts, Michikusa count, gate button disabled with its reason until ready, Shinsa link.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../../content/types';
import { STATION_4, V, createFakeLoader } from '../../content/fixtures';
import { bus } from '../../shared/events';
import { epochDay } from '../../shared/time';
import type { CardTuple } from '../../shared/store-types';
import { resetStoreForTests } from '../../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../../store/testing';
import StationPage, { groupItems } from './StationPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

function live(s: number): CardTuple {
  return card({ due: TODAY + 3, s, d: 5, reps: 8, lapses: 0, state: 2, last: TODAY - 1 });
}

function stationCards(o: { greenCount?: number; only?: number } = {}): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  let ids = [...STATION_4.vocabIds, ...STATION_4.kanjiIds, ...STATION_4.grammarIds];
  if (o.only !== undefined) ids = ids.slice(0, o.only);
  const greenCount = o.greenCount ?? ids.length;
  ids.forEach((id, i) => {
    const s = i < greenCount ? 8 : 2;
    if (id.startsWith('v-')) out[`${id}#rec`] = live(s);
    else if (id.startsWith('j-')) out[`${id}#comp`] = live(s);
    else out[`${id}#cloze`] = live(s);
  });
  return out;
}

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

const settle = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

async function mount(n: number): Promise<void> {
  act(() => render(<StationPage route={{ name: 'station', n }} loader={loader} />, root));
  await settle();
}
const text = (): string => root.textContent ?? '';

describe('<StationPage>', () => {
  it('renders the header, keeper and quotas from STATIONS', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    await mount(4);
    expect(text()).toContain('保土ヶ谷');
    expect(text()).toContain('Hodogaya');
    expect(text()).toContain('坂の関守');
    expect(text()).toContain('Hill Keeper keeps this gate.');
    expect(text()).toContain('Yellow belt · JLPT N5');
    const chips = Array.from(root.querySelectorAll('.station-quotas .chip')).map((c) => c.textContent);
    expect(chips).toEqual(['60 words', '8 kanji', '8 patterns', '3 texts']);
    expect(root.querySelector('.station-head')?.getAttribute('data-belt')).toBe('yellow');
  });

  it('kana stations say "the kana" and no kanji / patterns', async () => {
    await makeTestStore({ save: { progress: { station: 1 } } });
    await mount(1);
    const chips = Array.from(root.querySelectorAll('.station-quotas .chip')).map((c) => c.textContent);
    expect(chips).toEqual(['the kana', '20 words', '3 texts']);
    expect(text()).toContain('Tide Keeper');
  });

  it('gate button is disabled with the reason until every item is introduced and 80 % are Green', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ only: 10 }) });
    await mount(4);
    const btn = root.querySelector('.hanko') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-describedby')).toBe('station-gate-reason');
    expect(root.querySelector('#station-gate-reason')?.textContent).toContain('10 of 14 introduced, 10 Green');
    // progress bars read the same numbers
    const bars = root.querySelectorAll('.station-bar');
    expect(bars).toHaveLength(2);
    expect(bars[0]?.getAttribute('aria-valuenow')).toBe('10');
    expect(bars[0]?.getAttribute('aria-valuemax')).toBe('14');
    expect(text()).toContain('10 of 14 introduced');
  });

  it('gate button becomes a link when ready; scrolls, texts and Michikusa are listed', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, collections: { michikusa: ['m-04-1'] } }, cards: stationCards() });
    await mount(4);
    const gate = root.querySelector('.hanko') as HTMLAnchorElement;
    expect(gate.tagName).toBe('A');
    expect(gate.getAttribute('href')).toBe('#/gate/4');
    expect(text()).toContain('The gate is open. 坂の関守 Hill Keeper waits.');
    // scrolls with links
    const scrolls = root.querySelectorAll('.station-scroll');
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls[0]?.querySelector('a')?.getAttribute('href')).toMatch(/^#\/scroll\/4-\d+$/);
    expect(scrolls[0]?.textContent).toContain('Scroll 1');
    // texts: the story and the dialogue, dialogue gets a role-play link
    const stories = Array.from(root.querySelectorAll('.station-story'));
    expect(stories).toHaveLength(2);
    expect(stories[0]?.textContent).toContain('水と犬');
    expect(stories[0]?.querySelector('a')?.getAttribute('href')).toBe('#/story/s-04-1');
    expect(stories[1]?.textContent).toContain('Role-play');
    expect(stories[1]?.querySelectorAll('a')[2]?.getAttribute('href')).toBe('#/taiwa/s-04-2');
    // michikusa count
    expect(text()).toContain('1 of 2 collected');
    expect(text()).toContain('1 more at Hodogaya');
    // items by kind with item belts
    expect(root.querySelector('.station-items[data-kind="vocab"]')).not.toBeNull();
    expect(root.querySelector('.station-items[data-kind="chunk"]')).toBeNull();
    const item = root.querySelector(`.station-item[data-item="${V.飲む}"]`);
    expect(item?.className).toContain('belt--green');
    expect(item?.textContent).toBe('飲む');
    expect(root.querySelector('.station-items[data-kind="component"]')).not.toBeNull();
  });

  it('a cleared station shows the stamp line; belt-final stations link to the Shinsa', async () => {
    await makeTestStore({ save: { progress: { station: 10, stationsCleared: [1, 2, 3, 4, 5, 6, 7, 8, 9] } } });
    await mount(9);
    expect(text()).toContain('The Yellow belt exam is taken here, after the gate.');
    expect(root.querySelector('a[href="#/shinsa/yellow"]')).not.toBeNull();
    // station 9 has no fixture bundle → honest content note, no gate button offered
    expect(text()).toContain('not on the road yet');
    await mount(4);
    expect(text()).toContain('Cleared. The stamp is in your book.');
    expect(root.querySelector('.hanko')).toBeNull();
  });

  it('station 0 is Nihonbashi (onboarding) and unknown stations show a calm not-found', async () => {
    await makeTestStore();
    await mount(0);
    expect(text()).toContain('Nihonbashi');
    expect(root.querySelector('a[href="#/onboarding"]')).not.toBeNull();
    await mount(77);
    expect(text()).toContain('Not on this road.');
    expect(root.querySelector('a[href="#/road"]')).not.toBeNull();
  });

  it('groupItems separates chunks from words and keeps kinds in order', () => {
    const groups = groupItems({ ...STATION_4, kanaIds: ['k-h-a'], vocabIds: [V.飲む, V.おはよう, V.はい] }, (id) => loader.get(id));
    expect(groups.map((g) => g.kind)).toEqual(['kana', 'vocab', 'chunk', 'kanji', 'component', 'grammar']);
    expect(groups[1]?.ids).toEqual([V.飲む]);
    expect(groups[2]?.ids).toEqual([V.おはよう, V.はい]);
  });
});
