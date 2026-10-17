import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, V } from '@/content/fixtures';
import type { VocabItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { card, makeTestStore } from '@/store/testing';
import { ProductionForge, forgePrompt, kanaOnlyPolicy, meta } from './ProductionForge';

let root: HTMLDivElement;
let clock = 1_000_000;

const NOMU = FIXTURE.items[V.飲む] as VocabItem; // 飲む · のむ · kanjiIds ['j-飲'] · example 毎朝コーヒーを飲みます。
const MIZU = FIXTURE.items[V.水] as VocabItem; // 水 · みず · example 水をください。

beforeEach(async () => {
  clock = 1_000_000;
  await makeTestStore({ now: () => clock, save: { progress: { station: 5 } }, cards: { 'j-飲#read': card({ s: 8, reps: 4, state: 2 }) } });
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
    exercise: 'production-forge',
    itemId: item.id,
    cardKey: `${item.id}#prod`,
    params: {
      sentence: '毎朝コーヒーを飲みます。',
      blank: [7, 9],
      promptEn: 'to drink — I drink coffee every morning.',
      answer: item.word,
      accept: [item.word, item.kana],
      candidates: [item.word],
    },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 5,
    estMs: 9000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> };

function props(item: VocabItem | null = NOMU, over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(item ?? NOMU),
    item,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 5,
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

function mount(p: ExerciseProps, framed = false): HTMLInputElement {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<ProductionForge {...p} />, p.step) : <ProductionForge {...p} />, root));
  return root.querySelector('input') as HTMLInputElement;
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function key(target: EventTarget, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers production-forge on the prod facet with kana keys', () => {
    expect(meta).toMatchObject({ id: 'production-forge', facet: 'prod', keys: 'kana', selfGraded: false, timeable: true });
  });
});

describe('<ProductionForge>', () => {
  it('shows the gloss and the sentence with the word blanked, then fills the blank after the answer', () => {
    const p = props();
    const input = mount(p);
    expect(q('.forge__gloss')?.textContent).toBe('to drink — I drink coffee every morning.');
    const sentence = q('.forge__sentence') as HTMLElement;
    expect(sentence.getAttribute('lang')).toBe('ja');
    expect(sentence.textContent).toBe('毎朝コーヒーを＿＿ます。');
    expect(q('.forge__blank')?.getAttribute('data-filled')).toBe('false');
    type(input, 'nomu');
    key(input, 'Enter');
    expect(q('.forge__blank')?.getAttribute('data-filled')).toBe('true');
    expect(sentence.textContent).toBe('毎朝コーヒーを飲みます。');
  });

  it('kana answer is Good through Orange (params policy good) and Hard-flagged from Green (policy hard)', () => {
    const good = props(NOMU, { step: step(NOMU, { params: { ...step(NOMU).params, kanaOnlyPolicy: 'good' } }) });
    const i1 = mount(good);
    expect(q('.production-forge')?.getAttribute('data-policy')).toBe('good');
    clock += 2000;
    type(i1, 'nomu');
    key(i1, 'Enter');
    expect(good.onResult).toHaveBeenCalledTimes(1);
    expect(result(good)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'のむ', ms: 2000, hintUsed: false });
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('true');

    const hard = props(NOMU, { step: step(NOMU, { params: { ...step(NOMU).params, kanaOnlyPolicy: 'hard' } }) });
    const i2 = mount(hard);
    expect(q('.production-forge')?.getAttribute('data-policy')).toBe('hard');
    type(i2, 'nomu');
    key(i2, 'Enter');
    expect(result(hard)).toMatchObject({ correct: true, nearMiss: true, errorTags: [], answer: 'のむ' });
    expect(q('.text-answer__why')?.textContent).toBe('Right word. From Green, the kanji counts.');
    expect(root.textContent).toContain('From Green, writing the kanji counts.');
  });

  it('without a params policy the belt rule applies: Yellow → good, Green with read S ≥ 7 → hard', () => {
    const base = step(NOMU).params;
    delete base.kanaOnlyPolicy;
    expect(kanaOnlyPolicy(NOMU, base)).toBe('good');
    store.patch('progress', (pr) => ({ ...pr, station: 16 }));
    expect(kanaOnlyPolicy(NOMU, base)).toBe('hard');
    store.cards.set('j-飲#read', card({ s: 3, reps: 2, state: 2 }));
    expect(kanaOnlyPolicy(NOMU, base)).toBe('good');
    expect(kanaOnlyPolicy(MIZU, {})).toBe('good'); // no read card yet
    expect(kanaOnlyPolicy(NOMU, { kanaOnlyPolicy: 'hard' })).toBe('hard');
  });

  it('Space cycles the kanji candidates in the field; the kanji form is Good even under the hard policy', () => {
    const p = props(NOMU, { step: step(NOMU, { params: { ...step(NOMU).params, kanaOnlyPolicy: 'hard', candidates: ['飲む', '呑む'] } }) });
    const input = mount(p);
    expect(q('.kana-input__hint')).not.toBeNull();
    type(input, 'nomu');
    expect(input.value).toBe('のむ');
    key(input, ' ');
    expect(input.value).toBe('飲む');
    key(input, ' ');
    expect(input.value).toBe('呑む');
    key(input, ' ');
    expect(input.value).toBe('のむ');
    key(input, ' ');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, nearMiss: false, answer: '飲む' });
  });

  it('a particle slip is a Block tagged particle, not a fail; a wrong word is Again', () => {
    const p = props();
    const input = mount(p);
    type(input, 'nomuwo');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: false, nearMiss: true, errorTags: ['particle'], answer: 'のむを' });
    expect(q('.text-answer__why')?.textContent).toBe('The word is right. The particle slipped.');
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('near');

    const w = props();
    const input2 = mount(w);
    type(input2, 'taberu');
    key(input2, 'Enter');
    expect(result(w)).toMatchObject({ correct: false, nearMiss: false, answer: 'たべる' });
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('false');
  });

  it('「Show the first kana」 is a hint carried into the result', () => {
    const p = props();
    const input = mount(p);
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Show the first kana') as HTMLButtonElement;
    act(() => btn.click());
    expect(p.onHint).toHaveBeenCalledTimes(1);
    expect(q('[role="status"]')?.textContent).toContain('Starts with の');
    act(() => btn.click());
    expect(p.onHint).toHaveBeenCalledTimes(1);
    type(input, 'nomu');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, hintUsed: true });
    expect(q('.pitch-line')?.getAttribute('data-type')).toBe('atamadaka');
    expect(q('.vocab__collocation')).not.toBeNull();
  });

  it('Enter outside the field submits through the frame; onResult fires once', () => {
    const p = props();
    const input = mount(p, true);
    type(input, 'nomu');
    input.blur();
    key(document.body, 'Enter');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    key(document.body, 'Enter');
    key(input, 'Enter');
    expect(p.onResult).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first example when the planner sent no sentence, locating the word itself', () => {
    const p = props(MIZU, { step: step(MIZU, { params: { answer: '水', accept: ['水', 'みず'] } }) });
    mount(p);
    expect(q('.forge__sentence')?.textContent).toBe('＿＿をください。');
    expect(q('.forge__gloss')?.textContent).toBe('water — Water, please.');
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props(null, { step: step(NOMU) });
    mount(p);
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });
});

describe('forgePrompt', () => {
  it('uses params when present and derives sentence, blank and gloss from the first example otherwise', () => {
    expect(forgePrompt(NOMU, { sentence: 'abc飲むdef', blank: [3, 5], promptEn: 'x' })).toEqual({ en: 'x', sentence: 'abc飲むdef', blank: [3, 5] });
    expect(forgePrompt(MIZU, {})).toEqual({ en: 'water — Water, please.', sentence: '水をください。', blank: [0, 1] });
    // a broken blank is re-located; an absent surface yields [0, 0]
    expect(forgePrompt(MIZU, { sentence: '水をください。', blank: [9, 3] }).blank).toEqual([0, 1]);
    expect(forgePrompt(MIZU, { sentence: 'パンをください。' }).blank).toEqual([0, 0]);
  });
});
