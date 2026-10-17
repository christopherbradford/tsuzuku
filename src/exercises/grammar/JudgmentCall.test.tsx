import { render, type ComponentChildren, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G } from '@/content/fixtures';
import type { GrammarItem } from '@/content/types';
import { mulberry32 } from '@/shared/hash';
import type { AttemptResult, Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { JudgmentCall, judgmentCase, meta, mistakeTag, parseMistake } from './JudgmentCall';

const desu = FIXTURE.items[G.です] as GrammarItem; // mistake: × 学生ですです → ○ 学生です (one です per clause)
const wa = FIXTURE.items[G.は] as GrammarItem; // mistake: × 私がハナです → ○ 私はハナです (…)
const masu = FIXTURE.items[G.ます] as GrammarItem; // mistake: × 食べるます → ○ 食べます (…)

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
    id: 'jc-1',
    block: 'reviews',
    exercise: 'judgment-call',
    itemId: G.です,
    cardKey: `${G.です}#cloze`,
    params: {},
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 5,
    estMs: 6000,
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

function mount(s: Step, item: GrammarItem | null, framed = false) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const el = (
    <JudgmentCall step={s} item={item} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={5} onResult={onResult} onHint={() => undefined} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} />
  );
  act(() => render(framed ? frame(s, el) : el, root));
  return { onResult };
}

const choices = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
function click(b: HTMLButtonElement | null): void {
  act(() => {
    b?.click();
  });
}
function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('judgment helpers', () => {
  it('meta follows the D export convention', () => {
    expect(meta).toMatchObject({ id: 'judgment-call', facet: 'cloze', keys: 'choices' });
  });

  it('parseMistake reads the V14 format with or without the why, and rejects other lines', () => {
    expect(parseMistake('× 学生ですです → ○ 学生です (one です per clause)')).toEqual({ wrong: '学生ですです', right: '学生です', why: 'one です per clause' });
    expect(parseMistake('× 食べるます → ○ 食べます')).toEqual({ wrong: '食べるます', right: '食べます' });
    expect(parseMistake('x 私が → o 私は （topic）')).toEqual({ wrong: '私が', right: '私は', why: 'topic' });
    expect(parseMistake('Use は for the topic.')).toBeNull();
    expect(parseMistake('× → ○ 学生です')).toBeNull();
  });

  it('mistakeTag: particle swap → particle, permutation → word-order, else conjugation', () => {
    expect(mistakeTag('私がハナです', '私はハナです')).toBe('particle');
    expect(mistakeTag('水を犬は飲みます', '犬は水を飲みます')).toBe('word-order');
    expect(mistakeTag('食べるます', '食べます')).toBe('conjugation');
    expect(mistakeTag('学生ですです', '学生です')).toBe('conjugation');
  });

  it('judgmentCase: params.sentence matching a mistake is unnatural with its right form and why', () => {
    const c = judgmentCase(desu, { sentence: '学生ですです' }, mulberry32(1));
    expect(c).toMatchObject({ natural: false, right: '学生です', why: 'one です per clause', tag: 'conjugation' });
  });

  it('judgmentCase: an example sentence is natural; params.answer pins the verdict either way', () => {
    const c = judgmentCase(desu, { sentence: '{私|わたし}はハナです。' }, mulberry32(1));
    expect(c).toMatchObject({ natural: true, why: 'I am Hana.' });
    expect(judgmentCase(desu, { sentence: '学生ですです', answer: '○' }, mulberry32(1))?.natural).toBe(true);
    expect(judgmentCase(desu, { sentence: '犬です', answer: 'unnatural', accept: ['犬だ'] }, mulberry32(1))).toMatchObject({ natural: false, right: '犬だ' });
  });

  it('judgmentCase: without a sentence the draw is deterministic and covers both verdicts across seeds', () => {
    const a = judgmentCase(wa, {}, mulberry32(11));
    const b = judgmentCase(wa, {}, mulberry32(11));
    expect(a).toEqual(b);
    const verdicts = new Set<boolean>();
    for (let s = 0; s < 40; s++) verdicts.add(judgmentCase(wa, {}, mulberry32(s))?.natural as boolean);
    expect(verdicts).toEqual(new Set([true, false]));
    expect(judgmentCase(null, {}, mulberry32(1))).toBeNull();
  });
});

describe('<JudgmentCall>', () => {
  it('shows the sentence through <Ruby> and two choices ○ / ×', () => {
    mount(step({ params: { sentence: '{私|わたし}はハナです。' } }), desu);
    expect(root.querySelector('.judgment__sentence rt')?.textContent).toBe('わたし');
    expect(choices().length).toBe(2);
    expect(choices()[0]?.textContent).toContain('Natural');
    expect(choices()[1]?.textContent).toContain('Not natural');
    expect(root.querySelector('.judgment__explain')).toBeNull();
  });

  it('explanation is shown after the answer: the right form and the why for an unnatural sentence', () => {
    const { onResult } = mount(step({ params: { sentence: '学生ですです' } }), desu);
    click(choices()[1] as HTMLButtonElement);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, errorTags: [], answer: '×' });
    const ex = root.querySelector('.judgment__explain');
    expect(ex?.getAttribute('data-kind')).toBe('correct');
    expect(ex?.querySelector('.judgment__right')?.textContent).toContain('学生です');
    expect(ex?.querySelector('.judgment__detail')?.textContent).toBe('one です per clause');
    expect(choices()[1]?.getAttribute('data-state')).toBe('correct');
  });

  it('a wrong call is graded Again with the mistake tag, and still shows the explanation', () => {
    const { onResult } = mount(step({ itemId: G.は, cardKey: `${G.は}#cloze`, params: { sentence: '私がハナです' } }), wa);
    click(choices()[0] as HTMLButtonElement);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['particle'] });
    expect(root.querySelector('.judgment__explain')?.getAttribute('data-kind')).toBe('wrong');
    expect(root.querySelector('.judgment__right')?.textContent).toContain('私はハナです');
    expect(choices()[1]?.getAttribute('data-state')).toBe('missed');
  });

  it('a natural sentence explains itself with the pattern and meaning', () => {
    const { onResult } = mount(step({ itemId: G.ます, cardKey: `${G.ます}#cloze`, params: { sentence: 'パンを{食|た}べます。' } }), masu);
    click(choices()[0] as HTMLButtonElement);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, answer: '○' });
    expect(root.querySelector('.judgment__why')?.textContent).toContain('〜ます');
    expect(root.querySelector('.judgment__detail')?.textContent).toBe('I eat bread.');
  });

  it('digits 1 / 2 pick inside the frame; a second answer is ignored', () => {
    const { onResult } = mount(step({ params: { sentence: '学生ですです' } }), desu, true);
    press('2');
    press('1');
    click(choices()[0] as HTMLButtonElement);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]?.correct).toBe(true);
  });

  it('with no item and no sentence the empty state offers Continue', () => {
    const { onResult } = mount(step({ itemId: null, cardKey: null }), null);
    expect(root.querySelector('.judgment__empty')).not.toBeNull();
    click(root.querySelector('.hanko'));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]?.correct).toBe(true);
    expect(root.querySelector('.hanko')).toBeNull();
  });
});
