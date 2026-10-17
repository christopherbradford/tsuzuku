import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE } from '@/content/fixtures';
import type { KanaItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { KanaEar, meta } from './KanaEar';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock });
  installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true) } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const NE = FIXTURE.items['k-h-ne'] as KanaItem;
const KA = FIXTURE.items['k-h-ka'] as KanaItem;
const GRID = ['れ', 'わ', 'ね', 'め', 'ぬ', 'る', 'ろ', 'そ', 'ん'];

function step(over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'kana-ear',
    itemId: NE.id,
    cardKey: 'k-h-ne#prod',
    params: { answer: NE.kana, choices: GRID },
    timed: false,
    isNew: true,
    stepTag: 'intro',
    exposures: 0,
    estMs: 4000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: NE,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 0,
    onResult: vi.fn(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(p: ExerciseProps, framed = false): void {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<KanaEar {...p} />, p.step) : <KanaEar {...p} />, root));
}

function key(k: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const cells = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
const cellText = (b: HTMLButtonElement): string => b.querySelector('.choice__text')?.textContent ?? '';
const result = (p: { onResult: ReturnType<typeof vi.fn> }): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers kana-ear on the prod facet with choice keys and TTS', () => {
    expect(meta).toMatchObject({ id: 'kana-ear', facet: 'prod', keys: 'choices', needsTts: true });
  });
});

describe('<KanaEar>', () => {
  it('speaks the mora on mount and again on Space; replays are counted and reported upward', () => {
    const p = props();
    mount(p, true);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('ね', { kana: 'ね' });
    key(' ');
    key(' ');
    expect(speak).toHaveBeenCalledTimes(3);
    expect(p.onReplay).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.kana-ear__speaker')?.textContent).toContain('Replay');
    act(() => cells()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true, replays: 2, answer: 'ね' });
  });

  it('without a Japanese voice the prompt names the romaji, the Listen button is gone and Space does not count a replay', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(false) } });
    const p = props();
    mount(p, true);
    expect(root.querySelector('.kana-ear')?.getAttribute('data-voice')).toBe('false');
    expect(root.querySelector('.drill__prompt')?.textContent).toBe('Tap the kana for ne.');
    expect(root.querySelector('.kana-ear__novoice')?.textContent).toContain('No Japanese voice');
    expect(root.querySelector('.kana-ear__speaker')).toBeNull();
    expect(root.textContent).not.toContain('Listen');
    key(' ');
    expect(p.onReplay).not.toHaveBeenCalled();
    expect(cells().length).toBe(9);
    act(() => cells()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true, replays: 0, answer: 'ね' });
    expect(root.querySelector('.drill__after')?.textContent).toContain('The kana');
  });

  it('a voice that cannot be heard (canSpeak false) takes the no-voice path too', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true), canSpeak: signal(false) } });
    mount(props(), true);
    expect(root.querySelector('.kana-ear')?.getAttribute('data-voice')).toBe('false');
    expect(root.querySelector('.kana-ear__novoice')).not.toBeNull();
  });

  it('without a voice the romaji prompt for を carries the IME spelling too (o · wo)', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(false) } });
    const WO: KanaItem = { ...NE, id: 'k-h-wo', kana: 'を', romaji: 'o', row: 'w', lookalikes: [], exampleWord: { word: 'を', kana: 'を', en: 'object marker' } };
    const grid = ['を', 'お', 'わ', 'ね', 'れ', 'め', 'ぬ', 'る', 'ろ'];
    const p = props({ item: WO, step: step({ itemId: WO.id, cardKey: 'k-h-wo#prod', params: { answer: 'を', choices: grid } }) });
    mount(p);
    expect(root.querySelector('.drill__prompt')?.textContent).toBe('Tap the kana for o · wo.');
    act(() => cells()[0]?.click());
    expect(result(p)).toMatchObject({ correct: true, answer: 'を' });
  });

  it('renders the 3×3 grid from params.choices and grades the correct index', () => {
    const p = props();
    mount(p, true);
    const grid = root.querySelector('.choice-grid');
    expect(grid?.getAttribute('data-columns')).toBe('3');
    expect(grid?.getAttribute('data-size')).toBe('lg');
    expect(cells().length).toBe(9);
    expect(cells().map(cellText)).toEqual(GRID);
    expect(cells()[0]?.querySelector('[lang="ja"]')).not.toBeNull();
    clock += 1200;
    key('3');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'ね', ms: 1200, replays: 0 });
    expect(cells()[2]?.getAttribute('data-state')).toBe('correct');
    expect(root.querySelector('.drill__after')?.textContent).toContain('ne');
  });

  it('a wrong tap grades Again, shows the missed cell, and locks the grid', () => {
    const p = props();
    mount(p);
    act(() => cells()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, nearMiss: false, answer: 'れ', errorTags: [] });
    expect(cells()[0]?.getAttribute('data-state')).toBe('wrong');
    expect(cells()[2]?.getAttribute('data-state')).toBe('missed');
    act(() => cells()[2]?.click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.kana-ear__speaker')?.hasAttribute('disabled')).toBe(true);
  });

  it('tags voicing when the picked kana differs only by a dakuten', () => {
    const grid = ['が', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら'];
    const p = props({ item: KA, step: step({ itemId: KA.id, cardKey: 'k-h-ka#prod', params: { answer: KA.kana, choices: grid } }) });
    mount(p);
    act(() => cells()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, errorTags: ['voicing'], answer: 'が' });
  });

  it('builds a nine-cell grid containing the kana when the planner gave no choices', () => {
    const p = props({ step: step({ params: {} }) });
    mount(p);
    const texts = cells().map(cellText);
    expect(texts.length).toBe(9);
    expect(new Set(texts).size).toBe(9);
    expect(texts).toContain('ね');
    // deterministic for the same seed / day / step
    mount(props({ step: step({ params: {} }) }));
    expect(cells().map(cellText)).toEqual(texts);
  });

  it('a grid that lacks the answer is rebuilt rather than graded unwinnable', () => {
    const p = props({ step: step({ params: { choices: ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け'] } }) });
    mount(p);
    expect(cells().map(cellText)).toContain('ね');
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props({ item: null });
    mount(p);
    expect(root.querySelector('.missing-item')).not.toBeNull();
    act(() => (root.querySelector('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });
});
