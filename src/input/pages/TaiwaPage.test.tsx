import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_DIALOGUE_ID, createFakeLoader } from '@/content/fixtures';
import type { StoryItem } from '@/content/types';
import { installServices, nullAudio, nullStt, resetServices, type AudioService, type SttService } from '@/shared/audio';
import { bus } from '@/shared/events';
import { rngFor } from '@/shared/hash';
import { href } from '@/shared/routes';
import type { SpeakingMode } from '@/shared/store-types';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from '@/store/testing';
import { AIZUCHI_PAUSE_MS, type TaiwaMode } from '../taiwa/RolePlay';
import { windowMs } from '../taiwa/aizuchi';
import { chooseOptions } from '../taiwa/options';
import { S } from '../taiwa/strings';
import TaiwaPage, { BUILD_THROUGH_STATION, SPEAK_FROM_STATION, TYPE_FROM_STATION, conversationMinutes, modeFor, taiwaIdOf } from './TaiwaPage';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const loader = createFakeLoader();

function fakeAudio(): AudioService {
  return { ...nullAudio, muted: signal(false), hasJaVoice: signal(true), speak: () => Promise.resolve() };
}
const availableStt: SttService = { available: true, recognize: () => Promise.resolve(null), abort: () => undefined };

let clock = DEFAULT_TEST_NOW;
let root: HTMLDivElement;
beforeEach(async () => {
  clock = DEFAULT_TEST_NOW;
  await makeTestStore({ now: () => clock, save: { settings: { furigana: 'off' } } });
  bus.reset();
  installServices({ audio: fakeAudio(), stt: nullStt });
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  vi.useRealTimers();
});

async function tick(ms = 0): Promise<void> {
  clock += ms;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function clickText(text: string): void {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`no button "${text}"`);
  act(() => btn.click());
}
function bestOption(lineIndex: number): string {
  const opts = chooseOptions(DIALOGUE.lines[lineIndex]!, { register: 'polite', get: (id) => loader.get(id), rng: rngFor(store.seed(), store.today(), FIXTURE_DIALOGUE_ID, lineIndex) });
  return opts.find((o) => o.kind === 'best')!.text;
}

describe('modeFor: the mode table by station and device', () => {
  const base = { sttAvailable: false, speaking: 'self' as SpeakingMode, coarsePointer: false };

  it.each([
    [0, 'choose'],
    [7, 'choose'],
    [TYPE_FROM_STATION - 1, 'choose'],
    [TYPE_FROM_STATION, 'type'],
    [15, 'type'],
    [SPEAK_FROM_STATION, 'type'],
    [53, 'type'],
  ] as [number, TaiwaMode][])('station %i with a keyboard and no recognizer → %s', (station, mode) => {
    expect(modeFor({ ...base, station })).toBe(mode);
  });

  it('a touch device builds from Station 10 through Green, types after', () => {
    expect(modeFor({ ...base, station: 9, coarsePointer: true })).toBe('choose');
    expect(modeFor({ ...base, station: 10, coarsePointer: true })).toBe('build');
    expect(modeFor({ ...base, station: 15, coarsePointer: true })).toBe('build');
    expect(modeFor({ ...base, station: BUILD_THROUGH_STATION, coarsePointer: true })).toBe('build');
    expect(modeFor({ ...base, station: BUILD_THROUGH_STATION + 1, coarsePointer: true })).toBe('type');
  });

  it('speak from Green only when recognition is available AND the learner allows it', () => {
    expect(modeFor({ station: 16, sttAvailable: true, speaking: 'recognition', coarsePointer: false })).toBe('speak');
    expect(modeFor({ station: 16, sttAvailable: true, speaking: 'auto', coarsePointer: true })).toBe('speak');
    expect(modeFor({ station: 16, sttAvailable: true, speaking: 'self', coarsePointer: false })).toBe('type');
    expect(modeFor({ station: 16, sttAvailable: true, speaking: 'off', coarsePointer: false })).toBe('type');
    expect(modeFor({ station: 16, sttAvailable: false, speaking: 'recognition', coarsePointer: false })).toBe('type');
    expect(modeFor({ station: 15, sttAvailable: true, speaking: 'recognition', coarsePointer: false })).toBe('type');
  });

  it('conversationMinutes rounds and floors at one for a finished conversation', () => {
    expect(conversationMinutes(0)).toBe(1);
    expect(conversationMinutes(20_000)).toBe(1);
    expect(conversationMinutes(150_000)).toBe(3);
    expect(conversationMinutes(-5)).toBe(1);
  });

  it('taiwaIdOf reads the taiwa route only', () => {
    expect(taiwaIdOf({ name: 'taiwa', id: FIXTURE_DIALOGUE_ID })).toBe(FIXTURE_DIALOGUE_ID);
    expect(taiwaIdOf({ name: 'listen', id: FIXTURE_DIALOGUE_ID })).toBe('');
  });
});

describe('<TaiwaPage>', () => {
  it('picks the mode from the learner’s station and says so; links back to the dojo and the station', () => {
    act(() => render(<TaiwaPage route={{ name: 'taiwa', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    expect(root.querySelector('.taiwa-page__mode')?.textContent).toBe('Choose mode for your station and device.');
    expect(root.textContent).toContain('Mode: Choose');
    expect(Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([href({ name: 'dojo' }), href({ name: 'station', n: 4 })]);
    expect(root.querySelector('.taiwa-page__note')?.textContent).toBe(S.pageLedger);
  });

  it('Station 12 types; Station 20 speaks when a recognizer is present and allowed', async () => {
    await makeTestStore({ now: () => clock, save: { settings: { furigana: 'off' }, progress: { station: 12 } } });
    act(() => render(<TaiwaPage route={{ name: 'taiwa', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    expect(root.textContent).toContain('Type mode for your station');
    render(null, root);
    await makeTestStore({ now: () => clock, save: { settings: { furigana: 'off', speaking: 'recognition' }, progress: { station: 20 } } });
    installServices({ stt: availableStt });
    act(() => render(<TaiwaPage route={{ name: 'taiwa', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    expect(root.textContent).toContain('Speak mode for your station');
  });

  it('a non-taiwa route shows the calm not-found state', async () => {
    act(() => render(<TaiwaPage route={{ name: 'records' }} loader={loader} />, root));
    await tick();
    expect(root.querySelector('.taiwa__state--missing')?.textContent).toBe(S.notFound);
  });

  it('when the conversation ends it logs the speaking minutes to the ledger (kind speak, app) and offers the next steps', async () => {
    const cap = captureEvents();
    act(() => render(<TaiwaPage route={{ name: 'taiwa', id: FIXTURE_DIALOGUE_ID }} loader={loader} />, root));
    clickText(S.begin);
    await tick(5_000);
    for (const i of [1, 3, 5, 7, 9, 11]) {
      await tick(20_000);
      clickText(bestOption(i));
      clickText(S.continue);
      await tick();
      if (i === 3 || i === 9) await tick(windowMs(store.profile.value.belt) + AIZUCHI_PAUSE_MS + 1);
    }
    expect(root.querySelector('.taiwa')?.getAttribute('data-phase')).toBe('debrief');
    const entries = store.ledger.value.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual([store.today(), 2, 3, 0]);
    expect(cap.events.filter(([n]) => n === 'roleplay:done')).toHaveLength(1);
    expect(cap.events.find(([n]) => n === 'ledger:entry')?.[1]).toEqual({ minutes: 2, kind: 3, source: 0 });
    cap.stop();
    expect(root.querySelector('.taiwa-page__logged')?.textContent).toBe('2 min of conversation, in the ledger');
    const after = root.querySelector('.taiwa-page__after') as HTMLElement;
    expect(Array.from(after.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      href({ name: 'listen', id: FIXTURE_DIALOGUE_ID }),
      href({ name: 'story', id: FIXTURE_DIALOGUE_ID }),
      href({ name: 'dojo' }),
    ]);
    clickText(S.pageAgain);
    expect(root.querySelector('.taiwa-page__after')).toBeNull();
    expect(root.querySelector('.taiwa')?.getAttribute('data-phase')).toBe('intro');
  });
});
