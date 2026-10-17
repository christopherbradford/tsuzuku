import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import { bus } from '@/shared/events';
import { route, syncRouteFromLocation } from '@/shared/routes';
import { INTENSITY_PRESETS, newPerDayFor, resetStoreForTests, store } from '@/store';
import { makeTestStore } from '@/store/testing';
import OnboardingPage, { BASIC_HIRAGANA, KANA_TOTAL, TILE_COUNT, beltAfterDays, hoursInApp, kanaMatches, roadMonths, steadyReviewsInAYear } from './OnboardingPage';
import { S, fmt } from './strings';

const markKnownSpy = vi.fn();
vi.mock('@/learn/apply', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/learn/apply')>();
  return {
    ...mod,
    markKnown: (itemId: string, kind: 'kana') => {
      markKnownSpy(itemId, kind);
      return mod.markKnown(itemId, kind);
    },
  };
});

const ROUTE = { name: 'onboarding' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/onboarding';
  syncRouteFromLocation();
  markKnownSpy.mockClear();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  bus.reset();
});

function mount(): void {
  act(() => render(<OnboardingPage route={ROUTE} />, root));
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const click = (sel: string): void => {
  act(() => {
    q<HTMLButtonElement>(sel).click();
  });
};
const setInput = (input: HTMLInputElement, v: string): void => {
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const typeKanaName = (v: string): void => {
  const input = q<HTMLInputElement>('.kana-input__field');
  for (const ch of v) setInput(input, input.value + ch);
};
const stepIs = (name: string): void => expect(root.querySelector('.onb')?.getAttribute('data-step')).toBe(name);

/** Answer the current kana card: correctly, wrongly, or with "Not yet". */
function answerCurrent(how: 'right' | 'wrong' | 'skip'): string {
  const id = q('[data-kana-id]').getAttribute('data-kana-id') ?? '';
  if (how === 'skip') {
    click('[data-kana-skip]');
    return id;
  }
  const card = BASIC_HIRAGANA.find((c) => c.id === id);
  if (!card) throw new Error(`unknown kana ${id}`);
  setInput(q<HTMLInputElement>('[data-kana-input]'), how === 'right' ? card.romaji : 'xx');
  click('[data-kana-check]');
  return id;
}

describe('<OnboardingPage>', () => {
  it('completing the flow patches profile and settings and navigates to the dojo', async () => {
    await makeTestStore();
    mount();
    stepIs('name');
    typeKanaName('hana');
    click('[data-next]');

    stepIs('kana');
    expect(q<HTMLButtonElement>('[data-next]').disabled).toBe(true);
    click('[data-choice="kana-none"]');
    expect(root.querySelector('[data-kana-result]')?.textContent).toContain(fmt(S.onbKanaResult, { known: 0, n: KANA_TOTAL }));
    click('[data-next]');

    stepIs('pace');
    expect(q('[data-choice="pace-standard"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-next]');

    stepIs('voice');
    click('[data-theme-choice="dark"]');
    expect(store.settings.value.theme).toBe('dark');
    click('[data-next]');

    stepIs('done');
    expect(root.textContent).toContain(fmt(S.onbNameSummary, { name: 'はな' }));
    click('[data-finish]');

    const profile = store.profile.value;
    expect(profile.name).toBe('はな');
    expect(profile.nameKana).toBe('はな');
    expect(profile.goals.length).toBeGreaterThan(0);
    const s = store.settings.value;
    expect(s.intensity).toBe('standard');
    expect(s.newPerDay).toEqual(newPerDayFor('white', 'standard'));
    expect(s.maxReviews).toBe(INTENSITY_PRESETS.standard.maxReviews);
    expect(s.retention).toBe(INTENSITY_PRESETS.standard.retention);
    expect(s.speaking).toBe('self');
    expect(s.theme).toBe('dark');
    expect(route.value.name).toBe('dojo');
    expect(markKnownSpy).not.toHaveBeenCalled();
  });

  it('a blank name trains as 無名 / むめい', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(store.profile.value.name).toBe('無名');
    expect(store.profile.value.nameKana).toBe('むめい');
  });

  it('shows the install guide when no Japanese voice exists, and hides it when one does', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    stepIs('voice');
    expect(root.querySelector('[data-voice-guide]')?.textContent).toContain(S.onbVoiceNone);
    expect(root.querySelector('[data-voice-guide]')?.textContent).toContain(S.onbVoiceGuideMac);

    render(null, root);
    const speak = vi.fn(() => Promise.resolve());
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), speak } });
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    expect(root.querySelector('[data-voice-guide]')).toBeNull();
    click('[data-voice-test]');
    expect(speak).toHaveBeenCalledWith('こんにちは', { kana: 'こんにちは' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(root.textContent).toContain(S.onbVoiceHeard);
  });

  it('opting into recognition writes settings.speaking', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    click('[data-speech="recognition"]');
    expect(q('[data-speech="recognition"]').getAttribute('aria-checked')).toBe('true');
    click('[data-next]');
    click('[data-finish]');
    expect(store.settings.value.speaking).toBe('recognition');
  });

  it('intense shows the steady-state warning before it applies', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    stepIs('pace');
    click('[data-choice="pace-intense"]');
    const warn = q('[data-intense-warning]');
    expect(warn.textContent).toContain(fmt(S.onbPaceIntenseWarn, { n: String(steadyReviewsInAYear('intense')) }));
    expect(q('[data-choice="pace-intense"]').getAttribute('aria-pressed')).toBe('false');
    click('[data-intense-no]');
    expect(root.querySelector('[data-intense-warning]')).toBeNull();
    expect(q('[data-choice="pace-standard"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-choice="pace-intense"]');
    click('[data-intense-yes]');
    expect(q('[data-choice="pace-intense"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(store.settings.value.intensity).toBe('intense');
    expect(store.settings.value.maxReviews).toBe(INTENSITY_PRESETS.intense.maxReviews);
    expect(store.settings.value.newPerDay).toEqual(newPerDayFor('white', 'intense'));
  });

  it('markKnown is called only for the kana answered correctly', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-full"]');
    expect(root.textContent).toContain(fmt(S.onbKanaProgress, { i: 1, n: KANA_TOTAL }));
    const right = [answerCurrent('right'), answerCurrent('right'), answerCurrent('right')];
    expect(root.querySelector('.onb__kana-verdict')?.getAttribute('data-ok')).toBe('true');
    answerCurrent('wrong');
    expect(root.querySelector('.onb__kana-verdict')?.getAttribute('data-ok')).toBe('false');
    answerCurrent('wrong');
    for (let i = 0; i < KANA_TOTAL - 5; i++) answerCurrent('skip');
    expect(root.querySelector('[data-kana-result]')?.textContent).toContain(fmt(S.onbKanaResult, { known: 3, n: KANA_TOTAL }));
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(markKnownSpy).toHaveBeenCalledTimes(3);
    expect(markKnownSpy.mock.calls.map((c) => c[0]).sort()).toEqual([...right].sort());
    expect([...store.profile.value.kanaKnown].sort()).toEqual([...right].sort());
    expect(store.cards.count()).toBeGreaterThan(0);
  });

  it('"I read all kana" confirms with twelve tiles and sends only the misses back', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-tiles"]');
    expect(root.textContent).toContain(fmt(S.onbKanaProgress, { i: 1, n: TILE_COUNT }));
    const missedId = answerCurrent('wrong');
    for (let i = 1; i < TILE_COUNT; i++) answerCurrent('right');
    const result = q('[data-kana-result]');
    expect(result.textContent).toContain(fmt(S.onbKanaResult, { known: KANA_TOTAL - 1, n: KANA_TOTAL }));
    const missedKana = BASIC_HIRAGANA.find((c) => c.id === missedId)?.kana ?? '';
    expect(q('[data-sent-back]').textContent).toContain(missedKana);
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(markKnownSpy).toHaveBeenCalledTimes(KANA_TOTAL - 1);
    expect(store.profile.value.kanaKnown).not.toContain(missedId);
  });

  it('Enter in the kana field checks the answer', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-full"]');
    const id = q('[data-kana-id]').getAttribute('data-kana-id');
    const card = BASIC_HIRAGANA.find((c) => c.id === id)!;
    const input = q<HTMLInputElement>('[data-kana-input]');
    setInput(input, card.romaji);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(root.textContent).toContain(fmt(S.onbKanaProgress, { i: 2, n: KANA_TOTAL }));
    expect(root.querySelector('.onb__kana-verdict')?.getAttribute('data-ok')).toBe('true');
  });

  it('in-app hours and months differ per preset and are shown', async () => {
    const casual = hoursInApp('casual');
    const standard = hoursInApp('standard');
    const intense = hoursInApp('intense');
    expect(casual).toBeLessThan(standard);
    expect(standard).toBeLessThan(intense);
    expect(standard).toBeGreaterThan(380);
    expect(standard).toBeLessThan(480);
    expect(casual).toBeGreaterThan(250);
    expect(intense).toBeLessThan(760);
    expect(roadMonths('standard').full).toBe(22);
    expect(roadMonths('standard').partial).toBe(31);
    expect(roadMonths('casual').full).toBeGreaterThan(roadMonths('standard').full);
    expect(roadMonths('intense').full).toBeLessThan(roadMonths('standard').full);
    expect(beltAfterDays('intense', 365)).toBe('black');
    expect(steadyReviewsInAYear('intense')).toBe(400);

    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    expect(q('[data-hours]').textContent).toContain(String(standard));
    click('[data-choice="pace-casual"]');
    expect(q('[data-hours]').textContent).toContain(String(casual));
    expect(q('[data-months]').textContent).toContain(String(roadMonths('casual').full));
  });

  it('kanaMatches accepts Hepburn, kunrei, lone n, wo and typed kana', () => {
    expect(kanaMatches('shi', 'し')).toBe(true);
    expect(kanaMatches('si', 'し')).toBe(true);
    expect(kanaMatches('TSU', 'つ')).toBe(true);
    expect(kanaMatches('tu', 'つ')).toBe(true);
    expect(kanaMatches('n', 'ん')).toBe(true);
    expect(kanaMatches('wo', 'を')).toBe(true);
    expect(kanaMatches('fu', 'ふ')).toBe(true);
    expect(kanaMatches('hu', 'ふ')).toBe(true);
    expect(kanaMatches('ふ', 'ふ')).toBe(true);
    expect(kanaMatches('ka', 'き')).toBe(false);
    expect(kanaMatches('', 'あ')).toBe(false);
    expect(kanaMatches('   ', 'あ')).toBe(false);
  });

  it('the inventory is the 46 basic hiragana with IME-safe ids', () => {
    expect(BASIC_HIRAGANA.length).toBe(46);
    expect(new Set(BASIC_HIRAGANA.map((c) => c.id)).size).toBe(46);
    expect(new Set(BASIC_HIRAGANA.map((c) => c.kana)).size).toBe(46);
    expect(BASIC_HIRAGANA.find((c) => c.kana === 'を')?.id).toBe('k-h-wo');
    expect(BASIC_HIRAGANA.find((c) => c.kana === 'ん')?.id).toBe('k-h-n');
    for (const c of BASIC_HIRAGANA) expect(kanaMatches(c.romaji, c.kana), c.id).toBe(true);
  });

  it('Back returns to the previous step and keeps the kana result', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    stepIs('pace');
    click('[data-back]');
    stepIs('kana');
    expect(root.querySelector('[data-kana-result]')).not.toBeNull();
    expect(q<HTMLButtonElement>('[data-next]').disabled).toBe(false);
  });
});
