import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, createFakeLoader } from '@/content/fixtures';
import type { StoryItem, StoryLine } from '@/content/types';
import { SPEED_TIER_RATES, installServices, nullAudio, resetServices, type AudioService } from '@/shared/audio';
import { bus } from '@/shared/events';
import { rngFor } from '@/shared/hash';
import { normalizeJa } from '@/shared/jp';
import { href } from '@/shared/routes';
import type { SpeedTier } from '@/shared/store-types';
import { store } from '@/store';
import { captureEvents, makeTestStore } from '@/store/testing';
import { buildListeningSet, type ListenItem } from '../listening/ListeningArena';
import { S } from '../listening/strings';
import ListenPage, { listenIdOf, rateForTier } from './ListenPage';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const loader = createFakeLoader();

/** A device without a Japanese voice: the Arena shows the lines and skips the re-listen, which keeps the page test short. */
function voicelessAudio(): AudioService {
  return { ...nullAudio, muted: signal(false), hasJaVoice: signal(false), speak: () => Promise.resolve() };
}

let root: HTMLDivElement;
beforeEach(async () => {
  await makeTestStore({ save: { settings: { furigana: 'off' } } });
  bus.reset();
  installServices({ audio: voicelessAudio() });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}
function links(): string[] {
  return Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
}
function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

async function completeSet(story: StoryItem): Promise<ListenItem[]> {
  act(() => buttonByText(S.toQuestions).click());
  const items = buildListeningSet(story, { rng: rngFor(store.seed(), store.today(), story.id), station: store.progress.value.station });
  for (const item of items) {
    await flush();
    if (item.kind === 'dictation') {
      const input = root.querySelector('input') as HTMLInputElement;
      type(input, normalizeJa((story.lines[item.lineIndex] as StoryLine).kana));
      act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
    } else {
      const answer = item.kind === 'gist' ? item.q.answer : item.answer;
      act(() => (root.querySelector(`.arena__choice[aria-keyshortcuts="${answer + 1}"]`) as HTMLButtonElement).click());
    }
    act(() => (root.querySelector('.arena__feedback .hanko') as HTMLButtonElement).click());
  }
  act(() => buttonByText(S.finish).click());
  return items;
}

describe('ListenPage helpers', () => {
  it('rateForTier is the speed-tier preset table', () => {
    for (const t of [1, 2, 3, 4, 5] as SpeedTier[]) expect(rateForTier(t)).toBe(SPEED_TIER_RATES[t]);
    expect(rateForTier(1)).toBe(0.75);
    expect(rateForTier(5)).toBe(1.25);
  });

  it('listenIdOf reads the listen route only', () => {
    expect(listenIdOf({ name: 'listen', id: FIXTURE_DIALOGUE_ID })).toBe(FIXTURE_DIALOGUE_ID);
    expect(listenIdOf({ name: 'dojo' })).toBe('');
    expect(listenIdOf({ name: 'story', id: 'x' })).toBe('');
  });
});

describe('<ListenPage>', () => {
  it('plays the set at the rate of settings.speedTier and says which tier that is', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 4 } } });
    act(() => render(<ListenPage route={{ name: 'listen', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    expect(root.querySelector('.listen-page__tier')?.textContent).toBe('Your speed tier is 4: 1.1×. Change it in Settings.');
    expect(root.querySelector('.arena__meta')?.textContent).toContain('Speed 1.1×');
    expect(root.querySelector('.listen-page__note')?.textContent).toBe(S.pageLedger);
  });

  it('the default tier (2) plays at 0.9×', () => {
    act(() => render(<ListenPage route={{ name: 'listen', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    expect(store.settings.value.speedTier).toBe(2);
    expect(root.querySelector('.arena__meta')?.textContent).toContain('Speed 0.9×');
  });

  it('links back to the dojo and to the set’s station', () => {
    act(() => render(<ListenPage route={{ name: 'listen', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    expect(links()).toEqual([href({ name: 'dojo' }), href({ name: 'station', n: 4 })]);
    expect(root.textContent).toContain('Station 4');
  });

  it('a non-listen route or an unknown id shows the Arena’s calm not-found state, with no station link', async () => {
    act(() => render(<ListenPage route={{ name: 'dojo' }} loader={loader} />, root));
    await flush();
    expect(root.querySelector('.arena__state--missing')?.textContent).toBe(S.notFound);
    expect(links()).toEqual([href({ name: 'dojo' })]);
  });

  it('after the set: emits listening:set once (B logs the ledger row), offers listen-again, role-play (dialogues only), read, dojo', async () => {
    const cap = captureEvents();
    act(() => render(<ListenPage route={{ name: 'listen', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    const items = await completeSet(DIALOGUE);
    expect(cap.events.filter(([n]) => n === 'listening:set')).toHaveLength(1);
    expect(cap.events[0]?.[1]).toMatchObject({ storyId: FIXTURE_DIALOGUE_ID, correct: items.length, total: items.length, rate: 0.9 });
    // the page itself never writes the ledger: that is B's startLedger reducer on the event
    expect(store.ledger.value.entries).toEqual([]);
    expect(cap.events.some(([n]) => n === 'ledger:entry')).toBe(false);
    cap.stop();
    const after = root.querySelector('.listen-page__after') as HTMLElement;
    expect(after).not.toBeNull();
    expect(after.textContent).toContain(S.pageRolePlay);
    expect(Array.from(after.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      href({ name: 'taiwa', id: FIXTURE_DIALOGUE_ID }),
      href({ name: 'story', id: FIXTURE_DIALOGUE_ID }),
      href({ name: 'dojo' }),
    ]);
    // listen again restarts the Arena from the listen phase
    act(() => buttonByText(S.pageAgain).click());
    expect(root.querySelector('.listen-page__after')).toBeNull();
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('listen');
  });

  it('a narration (not a dialogue) gets no role-play link', async () => {
    act(() => render(<ListenPage route={{ name: 'listen', id: FIXTURE_STORY_ID }} loader={loader} />, root));
    await completeSet(STORY);
    const after = root.querySelector('.listen-page__after') as HTMLElement;
    expect(after.textContent).not.toContain(S.pageRolePlay);
    expect(after.textContent).toContain(S.pageRead);
  });
});
