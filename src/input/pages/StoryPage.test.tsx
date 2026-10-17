import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ContentLoader } from '@/content/loader';
import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, createFakeLoader } from '@/content/fixtures';
import type { StoryItem } from '@/content/types';
import { bus } from '@/shared/events';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { Route } from '@/shared/routes';
import { store } from '@/store';
import { makeTestStore } from '@/store/testing';
import { S } from '../reader/strings';
import StoryPage, { minutesLine, previousEpisodeIds } from './StoryPage';

const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const ANSWERS = STORY.comprehension.map((qq) => qq.choices[qq.answer]);

let root: HTMLDivElement;
let clock = 2_000_000;
let loader: ContentLoader;

beforeEach(async () => {
  clock = 2_000_000;
  loader = createFakeLoader();
  installServices({ audio: nullAudio });
  await makeTestStore({ now: () => clock, save: { progress: { station: 4 } } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  bus.reset();
});

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const qa = (sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null | undefined): void => {
  act(() => (el as HTMLElement | null)?.click());
};
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

function mount(route: Route = { name: 'story', id: FIXTURE_STORY_ID }, l: ContentLoader = loader): void {
  act(() => render(<StoryPage route={route} loader={l} />, root));
}

function finishRead(): void {
  click(q('[data-action="show-rest"]'));
  click(q('[data-action="next"]'));
  for (let i = 0; i < STORY.comprehension.length; i++) {
    const want = ANSWERS[i] as string;
    click(qa('[data-choice]').find((b) => b.textContent?.includes(want)));
    click(q('[data-action="advance"]'));
  }
}

describe('StoryPage helpers', () => {
  it('previousEpisodeIds: same station first, else the previous station 3 → 1, none for the first', () => {
    expect(previousEpisodeIds('s-04-2')).toEqual(['s-04-1']);
    expect(previousEpisodeIds('s-04-1')).toEqual(['s-03-3', 's-03-2', 's-03-1']);
    expect(previousEpisodeIds('s-01-1')).toEqual([]);
    expect(previousEpisodeIds('v-n5-0001')).toEqual([]);
  });

  it('minutesLine says what reached the ledger', () => {
    const base = { minutes: 3 } as Parameters<typeof minutesLine>[0];
    expect(minutesLine(base)).toBe('3 minutes to your ledger');
    expect(minutesLine({ ...base, minutes: 0 })).toBe(S.resultMinutesNone);
  });
});

describe('<StoryPage>', () => {
  it('loads the fixture story: header, station link, kind chip and the reader', async () => {
    mount();
    await settle();
    expect(q('[data-state="reading"]')).not.toBeNull();
    expect(q('.story-page__title')?.getAttribute('lang')).toBe('ja');
    expect(q('.story-page__title rt')?.textContent).toBe('みず');
    expect(q('.story-page__title-en')?.textContent).toBe(STORY.titleEn);
    const station = q('.story-page__chips [data-link="station"]') as HTMLAnchorElement;
    expect(station.getAttribute('href')).toBe('#/station/4');
    expect(station.textContent).toContain('Station 4');
    expect(station.textContent).toContain('保土ヶ谷');
    expect(root.textContent).toContain(S.episodeLabel);
    expect(q('.reader')).not.toBeNull();
    expect(q('[data-field="previously"]')).toBeNull(); // no Station 3 texts in the fixture
    expect(q('[data-field="result"]')).toBeNull();
  });

  it('shows the previous episode recap when it exists', async () => {
    mount({ name: 'story', id: FIXTURE_DIALOGUE_ID });
    await settle();
    expect(q('.story-page__title-en')?.textContent).toBe(DIALOGUE.titleEn);
    expect(root.textContent).toContain(S.dialogueLabel);
    const prev = q('[data-field="previously"]');
    expect(prev).not.toBeNull();
    expect(prev?.textContent).toContain(STORY.titleEn);
    expect(prev?.textContent).toContain(STORY.recapEn);
  });

  it('not found: a calm empty state with the station, road and dojo links', async () => {
    mount({ name: 'story', id: 's-09-9' });
    await settle();
    expect(q('[data-state="missing"]')).not.toBeNull();
    expect(root.textContent).toContain(S.storyMissing);
    expect(root.textContent).toContain(S.storyMissingHint);
    expect((q('[data-link="station"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/station/9');
    expect((q('[data-link="road"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/road');
    expect((q('[data-link="dojo"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/');
    expect(root.querySelector('.reader')).toBeNull();
  });

  it('a non-story route is treated as missing without a station link', async () => {
    mount({ name: 'dojo' });
    await settle();
    expect(q('[data-state="missing"]')).not.toBeNull();
    expect(q('[data-link="station"]')).toBeNull();
  });

  it('loads a story that is not in memory through getAsync', async () => {
    const lazy: ContentLoader = { ...loader, get: () => undefined };
    mount({ name: 'story', id: FIXTURE_STORY_ID }, lazy);
    expect(q('[data-state="loading"]')).not.toBeNull();
    await settle();
    expect(q('[data-state="reading"]')).not.toBeNull();
  });

  it('finishing shows the result, logs the minutes once and offers Read again', async () => {
    mount();
    await settle();
    clock += 120_000;
    finishRead();
    const result = q('[data-field="result"]');
    expect(result).not.toBeNull();
    expect(result?.getAttribute('data-passed')).toBe('true');
    expect(q('.story-page__score')?.textContent).toBe('3/3');
    expect(root.textContent).toContain(S.questionsPassed);
    expect(q('[data-field="cpm"]')?.textContent).toContain('characters per minute');
    expect(q('[data-field="taps"]')?.textContent).toBe(S.resultTapsNone);
    expect(q('[data-field="minutes"]')?.textContent).toBe('2 minutes to your ledger');
    expect(q('[data-field="recap"]')?.textContent).toContain(STORY.recapEn);
    expect(q('.reader')).toBeNull();
    // the page logged the minutes itself (no reducers in this store), exactly one row
    expect(store.ledger.value.entries.length).toBe(1);
    expect(store.ledger.value.entries[0]?.[1]).toBe(2);
    expect(store.ledger.value.entries[0]?.[2]).toBe(1); // read
    expect(store.ledger.value.entries[0]?.[3]).toBe(0); // app
    expect((q('[data-link="ledger"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/ledger');
    expect((q('.story-page__actions [data-link="station"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/station/4');

    click(q('[data-action="read-again"]'));
    expect(q('[data-field="result"]')).toBeNull();
    expect(q('.reader')).not.toBeNull();
    expect(qa('li[data-line]').length).toBe(1);
  });

  it('with B reducers wired the ledger still holds exactly one row', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 4 } }, reducers: true });
    mount();
    await settle();
    clock += 180_000;
    finishRead();
    expect(store.ledger.value.entries.length).toBe(1);
    expect(store.ledger.value.entries[0]?.[1]).toBe(3);
    expect(q('[data-field="minutes"]')?.textContent).toBe('3 minutes to your ledger');
  });

  it('under a minute logs nothing and says so', async () => {
    mount();
    await settle();
    clock += 20_000;
    finishRead();
    expect(store.ledger.value.entries.length).toBe(0);
    expect(q('[data-field="minutes"]')?.textContent).toBe(S.resultMinutesNone);
  });

  it('switching the route loads the other episode', async () => {
    mount();
    await settle();
    expect(q('.story-page__title-en')?.textContent).toBe(STORY.titleEn);
    mount({ name: 'story', id: FIXTURE_DIALOGUE_ID });
    await settle();
    expect(q('.story-page__title-en')?.textContent).toBe(DIALOGUE.titleEn);
  });
});
