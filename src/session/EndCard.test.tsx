/**
 * EndCard.tsx — ledger tap adds an entry; Another Kata only while reviews remain due; copy passes the banned list.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardKey } from '../content/types';
import { V } from '../content/fixtures';
import { findBanned } from '../i18n/banned-phrases';
import { installServices, nullAudio, resetServices } from '../shared/audio';
import { bus } from '../shared/events';
import type { JikaiYokoku, SessionResult, StepResult } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import type { CeremonyEvent } from './end-card';
import { EndCard, LEDGER_MINUTES, ceremonyLines } from './EndCard';
import { S } from './strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  bus.reset();
});

function res(o: Partial<StepResult> = {}): StepResult {
  return { stepId: 's', cardKey: `${V.犬}#rec`, rating: 3, ki: 8, combo: 1, ippon: false, kiai: false, xpDelta: 2, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 3000, errorTags: [], ...o };
}

function result(o: Partial<SessionResult> = {}, tally: Partial<SessionResult['tally']> = {}): SessionResult {
  const steps = [res(), res({ combo: 2, ippon: true }), res({ correct: false, rating: 1, combo: 0 })];
  return {
    planId: 'kata-test',
    mode: 'kata',
    startedAt: DEFAULT_TEST_NOW - 180_000,
    endedAt: DEFAULT_TEST_NOW,
    steps,
    tally: { reps: 3, correct: 2, accuracy: 0.667, bestCombo: 2, ippon: 1, xp: 17, minutes: 3, promotions: [{ itemId: V.水, to: 'green' }], questsDone: ['clear-due'], backlogWaiting: 0, ...tally },
    zen: false,
    resumed: false,
    ...o,
  };
}

const yokoku: JikaiYokoku = {
  sentence: { storyId: 's-04-1', ja: '{私|わたし}は???です。', kana: 'わたしはがくせいです。', maskedToken: 2 },
  words: [
    { itemId: V.犬, kana: 'いぬ' },
    { itemId: V.水, kana: 'みず' },
    { itemId: V.人, kana: 'ひと' },
  ],
  milestone: 'The 坂の関守 Hill Keeper awaits in about 4 days.',
};

function dueCards(n: number): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  const ids = [V.犬, V.水, V.人, V.日, V.私];
  for (let i = 0; i < n && i < ids.length; i++) out[`${ids[i]}#rec`] = card({ due: TODAY, s: 5, reps: 4, state: 2, last: TODAY - 1 });
  return out;
}

type Props = Parameters<typeof EndCard>[0];
function mount(over: Partial<Props> = {}): { onAnother: ReturnType<typeof vi.fn>; onRest: ReturnType<typeof vi.fn> } {
  const onAnother = vi.fn();
  const onRest = vi.fn();
  act(() => render(<EndCard result={result()} yokoku={yokoku} notes={[]} onAnother={onAnother} onRest={onRest} {...over} />, root));
  return { onAnother, onRest };
}

const click = (el: Element | null): void => {
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

describe('<EndCard>', () => {
  it('renders つづく, the tally, promotions, quests, the preview, the proverb and the closing line', async () => {
    await makeTestStore({ cards: dueCards(2) });
    mount();
    expect(root.querySelector('.end-card__tsuzuku')?.textContent).toBe('つづく');
    const text = root.textContent ?? '';
    expect(text).toContain('Reps');
    expect(text).toContain('67%');
    expect(text).toContain('Best combo');
    expect(text).toContain('+17');
    expect(root.querySelector('.end-card__promotion .end-card__belt')?.getAttribute('data-belt')).toBe('green');
    expect(root.querySelector('.end-card__quest')?.textContent).toContain('Clear all due reviews');
    expect(root.querySelector('.end-card__yokoku-ja')?.textContent).toContain('???');
    expect(root.querySelectorAll('.end-card__word')).toHaveLength(3);
    expect(root.querySelector('.end-card__milestone')?.textContent).toBe(yokoku.milestone);
    expect(root.querySelector('.end-card__omikuji-text')?.textContent).toMatch(/—/);
    expect(root.querySelector('.end-card__closing')?.textContent).toBe('Good training. Rest.');
    expect(root.querySelector('.end-card__flame')).not.toBeNull();
  });

  it('ledger tap adds an external entry of the chosen kind and emits ledger:entry', async () => {
    await makeTestStore();
    const cap = captureEvents();
    mount();
    expect(root.querySelector('.end-card__ledger-prompt')?.textContent).toBe('Outside input today? +20 min anime / podcast / reading / conversation.');
    const select = root.querySelector('.end-card__ledger-kind select') as HTMLSelectElement;
    act(() => {
      select.value = 'read';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(root.querySelectorAll('.end-card__ledger-btn')).toHaveLength(LEDGER_MINUTES.length);
    click(root.querySelector('.end-card__ledger-btn[data-minutes="20"]'));
    expect(store.ledger.value.entries).toEqual([[TODAY, 20, 1, 1]]);
    expect(cap.events.filter((e) => e[0] === 'ledger:entry')).toEqual([['ledger:entry', { minutes: 20, kind: 1, source: 1 }]]);
    expect(root.querySelector('.end-card__ledger-done')?.textContent).toBe('Logged. The ledger remembers.');
    expect(root.querySelector('.end-card__ledger-btn')).toBeNull();
    cap.stop();
  });

  it('the ledger prompt is absent once today has an external entry, and can be dismissed', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY, 15, 0, 1]], monthly: {}, missions: [] } } });
    mount();
    expect(root.querySelector('.end-card__ledger')).toBeNull();
    render(null, root);
    resetStoreForTests();
    await makeTestStore();
    mount();
    expect(root.querySelector('.end-card__ledger')).not.toBeNull();
    click(root.querySelector('.end-card__ledger-dismiss'));
    expect(root.querySelector('.end-card__ledger')).toBeNull();
  });

  it('Another Kata shows only while reviews remain due; Rest is always there', async () => {
    await makeTestStore({ cards: dueCards(3) });
    const a = mount();
    expect(root.querySelector('.end-card__another')?.textContent).toBe('Another Kata?');
    expect(root.querySelector('.end-card__due')?.textContent).toBe('3 reviews still due today.');
    click(root.querySelector('.end-card__another'));
    expect(a.onAnother).toHaveBeenCalledTimes(1);
    click(root.querySelector('.end-card__rest'));
    expect(a.onRest).toHaveBeenCalledTimes(1);

    resetStoreForTests();
    await makeTestStore();
    const b = mount();
    expect(root.querySelector('.end-card__another')).toBeNull();
    expect(root.querySelector('.end-card__due')).toBeNull();
    const rest = root.querySelector('.end-card__rest')!;
    expect(rest.textContent).toBe('Rest.');
    expect(rest.classList.contains('hanko')).toBe(true);
    click(rest);
    expect(b.onRest).toHaveBeenCalledTimes(1);
  });

  it('plays the つづく gliss once in Dojo and never in Zen; Zen hides combo and Ippon rows', async () => {
    await makeTestStore();
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    mount();
    mount();
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledWith('tsuzuku');
    render(null, root);
    sfx.mockClear();
    mount({ result: result({ zen: true }) });
    expect(sfx).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain('Best combo');
    expect(root.textContent).not.toContain('一本');
    expect(root.textContent).toContain('Reps');
  });

  it('a Welcome Back day shows the preview only, no tally', async () => {
    await makeTestStore();
    mount({ result: result({ mode: 'welcome' }) });
    expect(root.querySelector('.end-card__tally')).toBeNull();
    expect(root.querySelector('.end-card__welcome')?.textContent).toBe(S.welcomePreviewOnly);
    expect(root.querySelector('.end-card__yokoku')).not.toBeNull();
  });

  it('shows a loading line while the preview is null, and the notes list', async () => {
    await makeTestStore();
    mount({ yokoku: null, notes: ['Spaced beats massed. Tomorrow counts more than more today.', '7 waited today without penalty.'] });
    expect(root.querySelector('.end-card__loading')?.textContent).toBe('Reading tomorrow’s page.');
    const notes = Array.from(root.querySelectorAll('.end-card__note')).map((n) => n.textContent);
    expect(notes).toEqual(['Spaced beats massed. Tomorrow counts more than more today.', '7 waited today without penalty.']);
  });

  it('lists what B granted during the session (badges, stamps, belts, levels), quests excluded', async () => {
    await makeTestStore();
    const ceremonies: CeremonyEvent[] = [
      { name: 'badge:earned', payload: { id: 'first-step' } },
      { name: 'quest:completed', payload: { id: 'clear-due', allDone: false } },
      { name: 'stamp:earned', payload: { station: 4, perfect: true, assisted: false } },
      { name: 'belt:promoted', payload: { belt: 'yellow' } },
      { name: 'level:up', payload: { level: 3 } },
      { name: 'wallpaper:revealed', payload: { id: 'great-wave', quadrant: 2 } },
    ];
    const lines = ceremonyLines(ceremonies);
    expect(lines).toHaveLength(5);
    expect(lines[0]!.text).toContain('First Step');
    expect(lines[1]!.text).toBe('Goshuin · station 4');
    expect(lines[2]!.text).toBe('Yellow belt');
    expect(lines[3]!.text).toBe('Level 3');
    expect(lines[4]!.text).toContain('quadrant 2');
    mount({ ceremonies });
    expect(root.querySelectorAll('.end-card__earned-row')).toHaveLength(5);
    render(null, root);
    mount({ ceremonies: [] });
    expect(root.querySelector('.end-card__earned')).toBeNull();
  });

  it('copy passes the banned list', () => {
    const values: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') values.push(v);
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(S);
    expect(values.length).toBeGreaterThan(50);
    const hits = values.flatMap((v) => findBanned(v).map((h) => `${v} (${h.rule.source})`));
    expect(hits).toEqual([]);
  });
});
