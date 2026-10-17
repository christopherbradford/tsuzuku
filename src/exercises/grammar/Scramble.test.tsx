import { render, type ComponentChildren, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import type { ExerciseProps } from '@/shared/exercise-types';
import { mulberry32 } from '@/shared/hash';
import type { AttemptResult, Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { Scramble, meta, orderTiles, scrambleSetup, splitTail } from './Scramble';

const TILES = ['犬', 'は', '水', 'を', '飲みます', '。'];
const SENTENCE = '{犬|いぬ}は{水|みず}を{飲|の}みます。';

let root: HTMLDivElement;
beforeEach(async () => {
  await makeTestStore();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'sc-1',
    block: 'reviews',
    exercise: 'scramble',
    itemId: 'g-n5-002',
    cardKey: 'g-n5-002#cloze',
    params: { tiles: TILES, sentence: SENTENCE, promptEn: 'The dog drinks water.' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 3,
    estMs: 9000,
    ...over,
  };
}

function frame(s: Step, children: ComponentChildren): JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(s: Step, framed = false) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const onHint = vi.fn();
  const el = (
    <Scramble step={s} item={null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={3} onResult={onResult} onHint={onHint} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} />
  );
  act(() => render(framed ? frame(s, el) : el, root));
  return { onResult, onHint };
}

const bank = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.scramble__tile'));
const placed = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.scramble__placed'));
const tileNamed = (t: string): HTMLButtonElement => bank().find((b) => b.textContent?.replace(/^\d/, '') === t) as HTMLButtonElement;
const check = (): HTMLButtonElement => root.querySelector('.scramble__check') as HTMLButtonElement;
const control = (label: string): HTMLButtonElement => Array.from(root.querySelectorAll<HTMLButtonElement>('.scramble__controls .btn')).find((b) => b.textContent === label) as HTMLButtonElement;
function click(b: HTMLButtonElement): void {
  act(() => {
    b.click();
  });
}
function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
function placeAll(order: string[]): void {
  for (const t of order) click(tileNamed(t));
}

describe('scramble helpers', () => {
  it('meta follows the D export convention', () => {
    expect(meta).toMatchObject({ id: 'scramble', facet: 'cloze', keys: 'choices' });
  });

  it('splitTail keeps trailing punctuation out of the bank', () => {
    expect(splitTail(TILES)).toEqual({ pieces: ['犬', 'は', '水', 'を', '飲みます'], tail: ['。'] });
    expect(splitTail(['a', '。', 'b'])).toEqual({ pieces: ['a', '。', 'b'], tail: [] });
  });

  it('orderTiles rebuilds the expected order from the plain sentence (longest match first) or returns null', () => {
    expect(orderTiles(['を', '飲みます', '犬', '水', 'は'], '犬は水を飲みます。')).toEqual(['犬', 'は', '水', 'を', '飲みます']);
    expect(orderTiles(['は', 'はい'], 'はいは')).toEqual(['はい', 'は']);
    expect(orderTiles(['犬', 'は'], '犬は水')).toBeNull();
    expect(orderTiles(['犬', 'は', '水'], '犬は')).toBeNull();
  });

  it('setup: shuffles in-order tiles deterministically and never into the original order', () => {
    const a = scrambleSetup({ tiles: TILES, sentence: SENTENCE }, mulberry32(7));
    const b = scrambleSetup({ tiles: TILES, sentence: SENTENCE }, mulberry32(7));
    expect(a.order).toEqual(b.order);
    expect(a.expected).toEqual(['犬', 'は', '水', 'を', '飲みます']);
    expect(a.tail).toEqual(['。']);
    expect(a.order).not.toEqual([0, 1, 2, 3, 4]);
    expect([...a.order].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('setup: tiles that already arrive shuffled stay as given; alternates come from params.accept', () => {
    const s = scrambleSetup({ tiles: ['水', 'を', '犬', 'は', '飲みます', '。'], sentence: SENTENCE, accept: ['水を犬は飲みます。', ' '] }, mulberry32(1));
    expect(s.order.map((i) => s.expected[i])).toEqual(['水', 'を', '犬', 'は', '飲みます']);
    expect(s.alternates).toEqual([['水を犬は飲みます。']]);
  });

  it('setup: duplicate tiles map to distinct expected slots', () => {
    const s = scrambleSetup({ tiles: ['人', 'も', '犬', 'も', '飲みます'], answer: '人も犬も飲みます' }, mulberry32(3));
    expect([...s.order].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('setup: an interior 、 tile (splitBunsetsu emits it on its own) never becomes a piece and leaves no -1 slot', () => {
    const s = scrambleSetup({ tiles: ['三時です', '、', '今', '。'], sentence: '{今|いま}、{三時|さんじ}です。' }, mulberry32(5));
    expect(s.expected).toEqual(['今', '三時です']);
    expect(s.tail).toEqual(['。']);
    expect([...s.order].sort()).toEqual([0, 1]);
    expect(s.order.map((i) => s.expected[i])).toEqual(['三時です', '今']);
  });
});

describe('<Scramble>', () => {
  it('renders the English, the bank with digit hints and the tail punctuation; Check is disabled until complete', () => {
    mount(step());
    expect(root.querySelector('.scramble__en')?.textContent).toBe('The dog drinks water.');
    expect(bank().length).toBe(5);
    expect(bank()[0]?.querySelector('kbd')?.textContent).toBe('1');
    expect(bank()[0]?.getAttribute('aria-keyshortcuts')).toBe('1');
    expect(root.querySelector('.scramble__tail')?.textContent).toBe('。');
    expect(check().disabled).toBe(true);
  });

  it('a sentence with a mid-sentence 、 renders only real tiles: no empty tile, no "undefined" label, and it grades Good in order', () => {
    const s = step({ params: { tiles: ['三時です', '、', '今', '。'], sentence: '{今|いま}、{三時|さんじ}です。', promptEn: 'It is three o\'clock now.' } });
    const { onResult } = mount(s);
    expect(bank().length).toBe(2);
    expect(bank().map((b) => b.getAttribute('aria-label'))).not.toContain(expect.stringContaining('undefined'));
    expect(bank().every((b) => (b.querySelector('span[lang="ja"]')?.textContent ?? '').length > 0)).toBe(true);
    expect(root.querySelector('.scramble__tail')?.textContent).toBe('。');
    click(tileNamed('今'));
    click(tileNamed('三時です'));
    click(check());
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: '今 三時です 。' });
  });

  it('first try in the right order → Good (correct, no near miss, no tags)', () => {
    const { onResult } = mount(step());
    placeAll(['犬', 'は', '水', 'を', '飲みます']);
    expect(placed().map((b) => b.textContent)).toEqual(['犬', 'は', '水', 'を', '飲みます']);
    expect(check().disabled).toBe(false);
    click(check());
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], hintUsed: false, answer: '犬 は 水 を 飲みます 。' });
    expect(root.querySelector('.scramble__line')?.textContent).toBe('First try.');
    expect(root.querySelector('.scramble__result')?.getAttribute('data-kind')).toBe('correct');
  });

  it('one fix (tap a placed tile back) → Hard: correct + nearMiss, tagged word-order', () => {
    const { onResult } = mount(step());
    placeAll(['犬', '水']);
    click(placed()[1] as HTMLButtonElement); // remove 水 — one fix
    placeAll(['は', '水', 'を', '飲みます']);
    click(check());
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: true, errorTags: ['word-order'] });
    expect(root.querySelector('.scramble__line')?.textContent).toBe('Fixed once. Hard.');
  });

  it('two fixes (Undo, Clear) → Again even when the final order is right', () => {
    const { onResult } = mount(step());
    placeAll(['犬', '水']);
    click(control('Undo'));
    click(control('Clear'));
    expect(root.querySelector('.scramble__fixes')?.textContent).toContain('2 fixes');
    placeAll(['犬', 'は', '水', 'を', '飲みます']);
    click(check());
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['word-order'] });
    expect(root.querySelector('.scramble__line')?.textContent).toBe('Several fixes. Again.');
  });

  it('a wrong final order → Again with the correct sentence revealed through <Ruby>', () => {
    const { onResult } = mount(step());
    placeAll(['水', 'を', '犬', 'は', '飲みます']);
    click(check());
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['word-order'] });
    expect(root.querySelector('.scramble__line')?.textContent).toBe('Not this order.');
    expect(root.querySelector('.scramble__correct rt')?.textContent).toBe('いぬ');
    expect(root.querySelector('.scramble__why')?.textContent).toContain('Particles travel');
    // everything locks after grading
    expect(bank().every((b) => b.disabled)).toBe(true);
  });

  it('alternate orders from params.accept are accepted as Good', () => {
    const { onResult } = mount(step({ params: { tiles: TILES, sentence: SENTENCE, accept: ['水を犬は飲みます。'] } }));
    placeAll(['水', 'を', '犬', 'は', '飲みます']);
    click(check());
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [] });
  });

  it('keys 1–9 place bank tiles and Enter checks when inside the frame', () => {
    const { onResult } = mount(step(), true);
    const shown = bank().map((b) => b.textContent?.replace(/^\d/, '') ?? '');
    // press the digits in the order that spells the sentence
    for (const t of ['犬', 'は', '水', 'を', '飲みます']) press(String(shown.indexOf(t) + 1));
    expect(placed().length).toBe(5);
    press('Enter');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]?.correct).toBe(true);
  });

  it('hint places the next correct piece, calls onHint once and marks hintUsed', () => {
    const { onResult, onHint } = mount(step());
    click(control('Hint'));
    click(control('Hint'));
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(placed().map((b) => b.textContent)).toEqual(['犬', 'は']);
    placeAll(['水', 'を', '飲みます']);
    click(check());
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('a step without tiles shows the honest empty state and Continue reports a clean result', () => {
    const { onResult } = mount(step({ params: {} }));
    expect(root.querySelector('.scramble__empty')).not.toBeNull();
    click(root.querySelector('.hanko') as HTMLButtonElement);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]?.correct).toBe(true);
  });

  it('Check never fires twice', () => {
    const { onResult } = mount(step());
    placeAll(['犬', 'は', '水', 'を', '飲みます']);
    click(check());
    press('Enter');
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
