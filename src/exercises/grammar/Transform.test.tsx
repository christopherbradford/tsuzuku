import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G, V } from '@/content/fixtures';
import type { GrammarItem, VocabItem } from '@/content/types';
import type { ExerciseProps } from '@/shared/exercise-types';
import type { AttemptResult, Step } from '@/shared/session-types';
import { makeTestStore } from '@/store/testing';
import { Transform, isPermutation, meta, transformAccept, transformInstruction, transformTag } from './Transform';

const nomu = FIXTURE.items[V.飲む] as VocabItem;
const desu = FIXTURE.items[G.です] as GrammarItem;

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
    id: 'tr-1',
    block: 'reviews',
    exercise: 'transform',
    itemId: V.飲む,
    cardKey: `${V.飲む}#prod`,
    params: {},
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 4,
    estMs: 9000,
    ...over,
  };
}

function mount(s: Step, item: ExerciseProps['item']) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const onHint = vi.fn();
  act(() =>
    render(
      <Transform
        step={s}
        item={item}
        feel="dojo"
        furigana="always"
        jj={false}
        speedTier={3}
        exposures={4}
        onResult={onResult}
        onHint={onHint}
        onReplay={() => undefined}
        requestJudge={() => Promise.resolve(true)}
      />,
      root,
    ),
  );
  const input = root.querySelector('input') as HTMLInputElement | null;
  return { onResult, onHint, input };
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}
function enter(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

describe('transform helpers', () => {
  it('meta follows the D export convention', () => {
    expect(meta).toMatchObject({ id: 'transform', facet: 'prod', keys: 'kana', needsTts: false, selfGraded: false });
  });

  it('accept list: params.answer first, then params.accept, deduped and trimmed', () => {
    expect(transformAccept(null, { answer: '飲んだ ', accept: ['のんだ', '飲んだ', ''] })).toEqual(['飲んだ', 'のんだ']);
  });

  it('accept list: a conjugable word + targetForm adds the engine surfaces (kanji, kana, alternates)', () => {
    const acc = transformAccept(nomu, { targetForm: 'te' });
    expect(acc[0]).toBe('飲んで');
    expect(acc).toContain('のんで');
    const pot = transformAccept(nomu, { targetForm: 'potential' });
    expect(pot).toContain('飲める');
    expect(pot).toContain('のめる');
  });

  it('accept list: a grammar point with no answer falls back to the example at lineIndex (plain + kana)', () => {
    expect(transformAccept(desu, {})).toEqual(['私はハナです。', 'わたしはハナです。']);
    expect(transformAccept(desu, { lineIndex: 1 })).toEqual(['これは水です。', 'これはみずです。']);
    expect(transformAccept(desu, { lineIndex: 99 })[0]).toBe('コーヒーはおいしいです。');
    // an explicit answer wins over the example fallback
    expect(transformAccept(desu, { answer: '犬です。' })).toEqual(['犬です。']);
  });

  it('tag mapping: params.tag > targetForm (conjugation) > registerTarget (register) > item kind', () => {
    expect(transformTag(nomu, { tag: 'word-choice', targetForm: 'te' })).toBe('word-choice');
    expect(transformTag(nomu, { targetForm: 'te', registerTarget: 'casual' })).toBe('conjugation');
    expect(transformTag(desu, { registerTarget: 'honorific' })).toBe('register');
    expect(transformTag(nomu, {})).toBe('conjugation');
    expect(transformTag(desu, {})).toBe('word-order');
    expect(transformTag(null, {})).toBe('word-order');
  });

  it('isPermutation spots reordered characters only', () => {
    expect(isPermutation('みずをいぬがのみます', 'いぬがみずをのみます')).toBe(true);
    expect(isPermutation('いぬがみずをのみます', 'いぬがみずをのみます')).toBe(false);
    expect(isPermutation('いぬがみずをのむ', 'いぬがみずをのみます')).toBe(false);
    expect(isPermutation('', '')).toBe(false);
  });

  it('instruction: promptEn, else the form label, the register label, or the pattern', () => {
    expect(transformInstruction(nomu, { promptEn: 'Make it casual past.' })).toBe('Make it casual past.');
    expect(transformInstruction(nomu, { targetForm: 'ta' })).toBe('Make it the plain past (た) form.');
    expect(transformInstruction(desu, { registerTarget: 'honorific' })).toBe('Make it honorific (sonkeigo).');
    expect(transformInstruction(desu, {})).toBe('Rewrite it using 〜です.');
    expect(transformInstruction(null, {})).toBe('Rewrite the sentence.');
  });
});

describe('<Transform>', () => {
  it('shows the original through <Ruby>, the instruction, and grades a correct typed rewrite as Good', () => {
    const { onResult, input } = mount(step({ params: { sentence: '{水|みず}を{飲|の}む。', targetForm: 'te' } }), nomu);
    expect(root.querySelector('.transform__instruction')?.textContent).toBe('Make it the te (て) form.');
    expect(root.querySelector('.transform__source rt')?.textContent).toBe('みず');
    expect(input).not.toBeNull();
    type(input as HTMLInputElement, 'nonde');
    expect((input as HTMLInputElement).value).toBe('のんで');
    enter(input as HTMLInputElement);
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: true, nearMiss: false, hintUsed: false, guard: false, errorTags: [], answer: 'のんで' });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('a plain miss carries the base tag; a permuted answer adds word-order', () => {
    const { onResult, input } = mount(step({ params: { answer: 'いぬがみずをのみます', registerTarget: 'polite' } }), null);
    type(input as HTMLInputElement, 'inugaminomasuwomizu');
    enter(input as HTMLInputElement);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r.correct).toBe(false);
    expect(r.errorTags).toContain('register');
    expect(r.errorTags).toContain('word-order');
  });

  it('a particle slip is a Block (nearMiss, tagged particle), not a miss', () => {
    const { onResult, input } = mount(step({ params: { answer: 'みずをのんで' } }), nomu);
    type(input as HTMLInputElement, 'mizuganonde');
    enter(input as HTMLInputElement);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r.correct).toBe(false);
    expect(r.nearMiss).toBe(true);
    expect(r.errorTags).toEqual(['particle']);
  });

  it('hint reveals the pattern (grammar) or the first characters, calls onHint and marks hintUsed', () => {
    const { onResult, onHint, input } = mount(step({ itemId: G.です, cardKey: `${G.です}#prod`, params: { sentence: 'これは{水|みず}。' , lineIndex: 1 } }), desu);
    const hintBtn = root.querySelector('.transform__tools button') as HTMLButtonElement;
    act(() => hintBtn.click());
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.transform__hint')?.textContent).toContain('〜です');
    expect(hintBtn.disabled).toBe(true);
    type(input as HTMLInputElement, 'korehamizudesu');
    enter(input as HTMLInputElement);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
    // the hint control disappears once answered
    expect(root.querySelector('.transform__tools button')).toBeNull();
  });

  it('with no accept list it shows the honest missing-item state and never fires', () => {
    const { onResult, input } = mount(step({ itemId: null, cardKey: null, params: {} }), null);
    expect(input).toBeNull();
    expect(root.querySelector('.transform__missing')?.textContent).toContain('not in the loaded content');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('fires onResult once even if the widget would submit twice', () => {
    const { onResult, input } = mount(step({ params: { answer: 'のんで' } }), nomu);
    type(input as HTMLInputElement, 'nonde');
    enter(input as HTMLInputElement);
    enter(input as HTMLInputElement);
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
