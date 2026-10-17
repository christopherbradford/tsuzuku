import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { MockInstance } from 'vitest';
import { FIXTURE } from '@/content/fixtures';
import type { KanjiItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { KanjiWrite, PAD_SIZE, judgeDistractors, meta, wantsJudge } from './KanjiWrite';

const EAT = FIXTURE.items['j-食'] as KanjiItem;
const CHOICES = ['eat', 'drink', 'person', 'sun', 'tree'];

interface FakeCtx {
  calls: string[];
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  strokeStyle: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

function fakeCtx(): FakeCtx {
  const ctx: FakeCtx = {
    calls: [],
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    beginPath: () => ctx.calls.push('beginPath'),
    moveTo: (x, y) => ctx.calls.push(`moveTo ${Math.round(x)},${Math.round(y)}`),
    lineTo: (x, y) => ctx.calls.push(`lineTo ${Math.round(x)},${Math.round(y)}`),
    stroke: () => ctx.calls.push('stroke'),
    clearRect: (x, y, w, h) => ctx.calls.push(`clearRect ${x},${y},${w},${h}`),
  };
  return ctx;
}

let root: HTMLDivElement;
let ctx: FakeCtx | null;
let getContext: MockInstance<HTMLCanvasElement['getContext']>;
const asGetContext = (fn: () => unknown): HTMLCanvasElement['getContext'] => fn as unknown as HTMLCanvasElement['getContext'];

beforeAll(async () => {
  await makeTestStore({ now: 20_000 });
});
beforeEach(() => {
  ctx = fakeCtx();
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(asGetContext(() => ctx));
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  getContext.mockRestore();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'kw-1',
    block: 'reviews',
    exercise: 'kanji-write',
    itemId: EAT.id,
    cardKey: null,
    params: {},
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 6,
    estMs: 15000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; requestJudge: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: EAT,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 6,
    onResult: vi.fn<(r: AttemptResult) => void>(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; requestJudge: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={3} ki={0} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function pointer(el: Element, type: string, x: number, y: number): void {
  act(() => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    el.dispatchEvent(e);
  });
}

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const btn = (text: string): HTMLButtonElement => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) as HTMLButtonElement;
const canvas = (): HTMLCanvasElement => root.querySelector('canvas') as HTMLCanvasElement;
const rateBtn = (r: 1 | 2 | 3): HTMLButtonElement => root.querySelector(`.kj-rate__btn[data-rating="${r}"]`) as HTMLButtonElement;

describe('KanjiWrite helpers', () => {
  it('meta: kanji-write, no facet, self-graded, no keys', () => {
    expect(meta).toMatchObject({ id: 'kanji-write', facet: null, selfGraded: true, timeable: false, keys: 'none' });
  });

  it('judgeDistractors skips every meaning of the kanji and needs three', () => {
    expect(judgeDistractors(EAT.meanings, CHOICES)).toEqual(['drink', 'person', 'sun']);
    expect(judgeDistractors(EAT.meanings, ['Food', 'drink', 'person'])).toBeNull();
    expect(judgeDistractors(EAT.meanings, undefined)).toBeNull();
  });

  it('wantsJudge samples every Good while no Judge check has been recorded', () => {
    expect(wantsJudge('j-食#comp')).toBe(true);
  });
});

describe('<KanjiWrite>', () => {
  it('renders the prompt, meaning, readings, stroke count and a drawable canvas', () => {
    act(() => render(<KanjiWrite {...props()} />, root));
    expect(root.textContent).toContain('Write the kanji from memory');
    expect(root.textContent).toContain('eat · food');
    expect(root.textContent).toContain('ショク');
    expect(root.textContent).toContain('た・べる');
    expect(root.textContent).toContain('9 strokes');
    expect(canvas().width).toBe(PAD_SIZE);
    expect(q('.kj-pad')?.getAttribute('data-can-draw')).toBe('true');
    expect(ctx?.lineCap).toBe('round');
    expect(q('[data-overlay="true"]')).toBeNull();
    expect(q('[data-answer="true"]')).toBeNull(); // the kanji is not shown before the reveal
    expect(root.textContent).not.toContain(EAT.mnemonic);
  });

  it('pointer strokes draw on the pad and Clear wipes it', () => {
    act(() => render(<KanjiWrite {...props()} />, root));
    const c = canvas();
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAD_SIZE, height: PAD_SIZE, right: PAD_SIZE, bottom: PAD_SIZE, x: 0, y: 0, toJSON: () => ({}) });
    expect(btn('Clear pad').disabled).toBe(true);
    pointer(c, 'pointerdown', 10, 20);
    pointer(c, 'pointermove', 30, 40);
    pointer(c, 'pointerup', 30, 40);
    pointer(c, 'pointermove', 50, 60); // not drawing any more
    expect(ctx?.calls).toEqual(['beginPath', 'moveTo 10,20', 'lineTo 10,20', 'stroke', 'lineTo 30,40', 'stroke']);
    expect(q('.kj-write')?.getAttribute('data-drawn')).toBe('true');
    act(() => btn('Clear pad').click());
    expect(ctx?.calls.at(-1)).toBe(`clearRect 0,0,${PAD_SIZE},${PAD_SIZE}`);
    expect(q('.kj-write')?.getAttribute('data-drawn')).toBe('false');
  });

  it('Reveal overlays the kanji at low opacity, shows the mnemonic and the three ratings', () => {
    act(() => render(<KanjiWrite {...props()} />, root));
    act(() => btn('Reveal').click());
    expect(q('[data-overlay="true"]')?.textContent).toBe('食');
    expect(q('[data-answer="true"]')?.textContent).toBe('食');
    expect(root.textContent).toContain(EAT.mnemonic);
    expect(root.querySelectorAll('.kj-rate__btn').length).toBe(3);
    expect(q('.kj-write')?.getAttribute('data-phase')).toBe('rate');
  });

  it('self-rating emits selfRating: Again → correct false, Hard → nearMiss, no Judge without distractors', () => {
    const pr = props();
    act(() => render(<KanjiWrite {...pr} />, root));
    act(() => btn('Reveal').click());
    act(() => rateBtn(1).click());
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ selfRating: 1, correct: false, nearMiss: false, guard: false, hintUsed: false, ms: 0 });
    expect(pr.requestJudge).not.toHaveBeenCalled();
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('wrong');

    act(() => render(null, root));
    const pr2 = props();
    act(() => render(<KanjiWrite {...pr2} />, root));
    act(() => btn('Reveal').click());
    act(() => rateBtn(2).click());
    expect(pr2.onResult.mock.calls[0]?.[0]).toMatchObject({ selfRating: 2, correct: true, nearMiss: true });

    act(() => render(null, root));
    const pr3 = props();
    act(() => render(<KanjiWrite {...pr3} />, root));
    act(() => btn('Reveal').click());
    act(() => rateBtn(3).click());
    expect(pr3.onResult.mock.calls[0]?.[0]).toMatchObject({ selfRating: 3, correct: true, nearMiss: false });
    expect(pr3.requestJudge).not.toHaveBeenCalled();
  });

  it('a Good with three meaning distractors asks the Judge first, then emits selfRating 3', async () => {
    const pr = props({ step: step({ params: { choices: CHOICES } }) });
    act(() => render(<KanjiWrite {...pr} />, root));
    act(() => btn('Reveal').click());
    act(() => rateBtn(3).click());
    expect(pr.requestJudge).toHaveBeenCalledWith({ correct: 'eat', distractors: ['drink', 'person', 'sun'] });
    expect(q('.kj-write')?.getAttribute('data-phase')).toBe('judge');
    expect(root.textContent).toContain('inspector');
    expect(pr.onResult).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ selfRating: 3, correct: true });
    expect(q('.kj-write')?.getAttribute('data-phase')).toBe('done');
  });

  it('keys through the frame: Enter reveals, digits 1–3 rate only after the reveal, and the result fires once', () => {
    const s = step();
    const pr = props({ step: s });
    act(() => render(inFrame(<KanjiWrite {...pr} />, s), root));
    press('2');
    expect(pr.onResult).not.toHaveBeenCalled();
    press('Enter');
    expect(q('.kj-write')?.getAttribute('data-phase')).toBe('rate');
    press('2');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ selfRating: 2 });
    press('3');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
  });

  it('without a 2D context it says to write on paper and Reveal still works', () => {
    getContext.mockImplementation(asGetContext(() => null));
    const pr = props();
    act(() => render(<KanjiWrite {...pr} />, root));
    expect(q('.kj-pad')?.getAttribute('data-can-draw')).toBe('false');
    expect(root.textContent).toContain('Write on paper, then reveal.');
    act(() => btn('Reveal').click());
    act(() => rateBtn(1).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ selfRating: 1 });
  });

  it('without a kanji item it degrades honestly', () => {
    const pr = props({ item: null, step: step({ itemId: null }) });
    act(() => render(<KanjiWrite {...pr} />, root));
    expect(q('.kj-write')?.getAttribute('data-state')).toBe('unavailable');
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });
});
