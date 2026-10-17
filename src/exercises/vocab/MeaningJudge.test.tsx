import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, V } from '@/content/fixtures';
import type { CardKey, VocabItem } from '@/content/types';
import type { AttemptResult, ExerciseProps, JudgeRequest } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { shouldJudge } from '@/learn';
import { store } from '@/store';
import { card, makeTestStore } from '@/store/testing';
import { MeaningJudge, judgeSampled, meta, selfRated } from './MeaningJudge';

let root: HTMLDivElement;
let clock = 1_000_000;

const NOMU = FIXTURE.items[V.飲む] as VocabItem;
const DEF: VocabItem = { ...NOMU, definitionJa: { ja: '{水|みず}やお{茶|ちゃ}を{口|くち}に{入|い}れる。', kana: 'みずやおちゃをくちにいれる。' } };

beforeEach(async () => {
  clock = 1_000_000;
  await makeTestStore({ now: () => clock, cards: { [`${NOMU.id}#rec`]: card({ s: 9, reps: 6, state: 2 }) } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function step(item: VocabItem, over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'meaning-judge',
    itemId: item.id,
    cardKey: `${item.id}#rec`,
    params: { answer: item.meanings[0], accept: item.meanings },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 6,
    estMs: 8000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn>; requestJudge: ReturnType<typeof vi.fn> };

function props(item: VocabItem | null = DEF, over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(item ?? DEF),
    item,
    feel: 'dojo',
    furigana: 'always',
    jj: true,
    speedTier: 3,
    exposures: 6,
    onResult: vi.fn(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as P;
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
  act(() => render(framed ? inFrame(<MeaningJudge {...p} />, p.step) : <MeaningJudge {...p} />, root));
}

function key(k: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const phase = (): string | null => q('.meaning-judge')?.getAttribute('data-phase') ?? null;
const rateBtn = (r: 1 | 2 | 3): HTMLButtonElement => q(`.judge-rate__btn[data-rating="${r}"]`) as HTMLButtonElement;
const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers meaning-judge as a self-graded rec drill with choice keys and no speed pressure', () => {
    expect(meta).toMatchObject({ id: 'meaning-judge', facet: 'rec', selfGraded: true, keys: 'choices', timeable: false });
  });
});

describe('<MeaningJudge>', () => {
  it('recall → Reveal (Enter) shows the J-J definition with English behind a tap; digits do nothing before the reveal', () => {
    const p = props();
    mount(p, true);
    expect(phase()).toBe('recall');
    expect(q('.vocab__definition')).toBeNull();
    key('3');
    expect(p.onResult).not.toHaveBeenCalled();
    clock += 2500;
    key('Enter');
    expect(phase()).toBe('rate');
    expect(q('.vocab__definition')?.textContent).toContain('水');
    expect(q('.vocab__meaning-en')).toBeNull();
    act(() => (Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Show English') as HTMLButtonElement).click());
    expect(q('.vocab__meaning-en')?.textContent).toBe('to drink');
    expect(q('.vocab__kana')?.textContent).toBe('のむ');
  });

  it('self-rating Hard lands in the result as selfRating 2 with the recall latency; no Judge for Hard', async () => {
    const p = props();
    mount(p, true);
    clock += 3000;
    key('Enter');
    clock += 900; // thinking about the rating is not recall time
    key('2');
    await flush();
    expect(p.requestJudge).not.toHaveBeenCalled();
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ selfRating: 2, correct: true, nearMiss: true, ms: 3000, hintUsed: false, guard: false, errorTags: [] });
    expect(rateBtn(2).getAttribute('aria-pressed')).toBe('true');
    expect(rateBtn(1).disabled).toBe(true);
    expect(q('.pitch-line')?.getAttribute('data-type')).toBe('atamadaka');
    expect(q('.vocab__collocation')).not.toBeNull();
  });

  it('Again is selfRating 1, correct false, and never asks the Judge', async () => {
    const p = props();
    mount(p);
    act(() => (q('.hanko') as HTMLButtonElement).click());
    act(() => rateBtn(1).click());
    await flush();
    expect(p.requestJudge).not.toHaveBeenCalled();
    expect(result(p)).toMatchObject({ selfRating: 1, correct: false, nearMiss: false });
    expect(q('[role="status"]')?.textContent).toBe('Again. It comes back soon.');
  });

  it('a sampled Good awaits requestJudge with a 4-option meaning card; fail → selfRating 1', async () => {
    // fresh profile: judgeChecks 0 → the first 20 checks are always sampled
    expect(judgeSampled(`${NOMU.id}#rec`, 's1')).toBe(true);
    const p = props(DEF, { requestJudge: vi.fn(() => Promise.resolve(false)) });
    mount(p);
    act(() => (q('.hanko') as HTMLButtonElement).click());
    act(() => rateBtn(3).click());
    expect(phase()).toBe('judging');
    expect(p.onResult).not.toHaveBeenCalled();
    expect(q('[role="status"]')?.textContent).toBe('The inspector is checking this one.');
    expect(p.requestJudge).toHaveBeenCalledTimes(1);
    const req = p.requestJudge.mock.calls[0]?.[0] as JudgeRequest;
    expect('correct' in req).toBe(true);
    if ('correct' in req) {
      expect(req.correct).toBe('to drink');
      expect(req.distractors.length).toBe(3);
      expect(new Set([req.correct, ...req.distractors]).size).toBe(4);
    }
    await flush();
    expect(result(p)).toMatchObject({ selfRating: 1, correct: false, nearMiss: false });
    expect(phase()).toBe('done');
    expect(q('[data-judge="fail"]')?.textContent).toContain('saw it differently');
  });

  it('a sampled Good that passes keeps selfRating 3', async () => {
    const p = props();
    mount(p);
    act(() => (q('.hanko') as HTMLButtonElement).click());
    act(() => rateBtn(3).click());
    await flush();
    expect(p.requestJudge).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ selfRating: 3, correct: true, nearMiss: false });
    expect(q('[data-judge="pass"]')).not.toBeNull();
  });

  it('a Good that the sample skips is submitted without a Judge', async () => {
    // calibrated profile: 25 % rate; pick a card key the deterministic sample skips
    store.patch('stats', (s) => ({ ...s, judgeChecks: 200, judgePasses: 200, honesty: 1 }));
    let key: CardKey = `${NOMU.id}#rec`;
    let n = 0;
    while (shouldJudge(store.seed(), key, n, 25)) n++;
    store.cards.set(key, card({ s: 9, reps: n, state: 2 }));
    expect(judgeSampled(key, 's1')).toBe(false);
    const p = props();
    mount(p);
    act(() => (q('.hanko') as HTMLButtonElement).click());
    act(() => rateBtn(3).click());
    await flush();
    expect(p.requestJudge).not.toHaveBeenCalled();
    expect(result(p)).toMatchObject({ selfRating: 3, correct: true });
    key = `${NOMU.id}#rec`;
  });

  it('a Judge that cannot be shown leaves the learner rating in place', async () => {
    const p = props(DEF, { requestJudge: vi.fn(() => Promise.reject(new Error('no card'))) });
    mount(p);
    act(() => (q('.hanko') as HTMLButtonElement).click());
    act(() => rateBtn(3).click());
    await flush();
    expect(result(p)).toMatchObject({ selfRating: 3, correct: true });
  });

  it('without a definition the English stands in and says so; a fog tap is a hint', async () => {
    const p = props(NOMU, { furigana: 'tap', step: step(NOMU) });
    mount(p);
    const fogged = q('.ruby__seg--fog') as HTMLElement;
    act(() => fogged.click());
    expect(p.onHint).toHaveBeenCalledTimes(1);
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(q('.vocab__definition')).toBeNull();
    expect(q('.vocab__meaning-en')?.textContent).toContain('to drink');
    expect(q('.vocab__meaning-en')?.textContent).toContain('No Japanese definition');
    act(() => rateBtn(2).click());
    await flush();
    expect(result(p)).toMatchObject({ selfRating: 2, hintUsed: true });
  });

  it('onResult fires once; a second rating is ignored', async () => {
    const p = props();
    mount(p);
    act(() => (q('.hanko') as HTMLButtonElement).click());
    act(() => rateBtn(1).click());
    act(() => rateBtn(2).click());
    await flush();
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p).selfRating).toBe(1);
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props(null, { step: step(NOMU) });
    mount(p);
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });
});

describe('selfRated', () => {
  it('maps Again / Hard / Good onto correct / nearMiss and keeps the rating', () => {
    expect(selfRated(1, { ms: 10 })).toMatchObject({ correct: false, nearMiss: false, selfRating: 1, ms: 10 });
    expect(selfRated(2, { ms: 10 })).toMatchObject({ correct: true, nearMiss: true, selfRating: 2 });
    expect(selfRated(3, { ms: 10, hintUsed: true })).toMatchObject({ correct: true, nearMiss: false, selfRating: 3, hintUsed: true });
  });
});
