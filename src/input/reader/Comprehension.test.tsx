import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_STORY_ID } from '@/content/fixtures';
import type { ComprehensionQuestion, StoryItem } from '@/content/types';
import { rngFor } from '@/shared/hash';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { Comprehension, JaOrPlain, passes, prepareQuestions } from './Comprehension';
import { S } from './strings';

const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const QS: ComprehensionQuestion[] = STORY.comprehension; // answers 1, 2, 0

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const choice = (i: number): HTMLButtonElement => q(`[data-choice="${i}"]`) as HTMLButtonElement;
const click = (el: HTMLElement | null): void => {
  act(() => el?.click());
};
const key = (k: string): void => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
};

function mount(questions: ComprehensionQuestion[] = QS, extra: Partial<Parameters<typeof Comprehension>[0]> = {}): ReturnType<typeof vi.fn> {
  const onDone = vi.fn();
  act(() => render(<Comprehension questions={questions} onDone={onDone} {...extra} />, root));
  return onDone;
}

describe('Comprehension helpers', () => {
  it('prepareQuestions keeps content order without an rng and tags the answer', () => {
    const prep = prepareQuestions(QS);
    expect(prep.length).toBe(3);
    expect(prep[0]?.choices.map((c) => c.text)).toEqual(QS[0]?.choices);
    expect(prep[0]?.choices.filter((c) => c.correct).map((c) => c.text)).toEqual(['Coffee']);
  });

  it('prepareQuestions shuffles deterministically with an rng and keeps exactly one correct choice', () => {
    const a = prepareQuestions(QS, rngFor('seed', 1, 's'));
    const b = prepareQuestions(QS, rngFor('seed', 1, 's'));
    expect(a).toEqual(b);
    for (const pq of a) {
      expect(pq.choices.filter((c) => c.correct).length).toBe(1);
      expect(pq.choices.map((c) => c.text).sort()).toEqual([...(QS.find((x) => x.q === pq.q)?.choices ?? [])].sort());
    }
    // over a few seeds at least one order differs from the content order
    const moved = [1, 2, 3, 4, 5].some((s) => prepareQuestions(QS, rngFor('x', s)).some((pq, i) => pq.choices.map((c) => c.text).join() !== QS[i]?.choices.join()));
    expect(moved).toBe(true);
  });

  it('a ruby choice is announced by its plain surface, never the markup (Station 16+ choices)', () => {
    const qs: ComprehensionQuestion[] = [{ q: '{何|なに}を{買|か}いましたか。', choices: ['{桜|さくら}えび', '{地図|ちず}', 'パン', 'お{茶|ちゃ}'], answer: 0 }];
    mount(qs);
    const labels = Array.from(root.querySelectorAll('.comp__choice')).map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels[0]).toBe(`${S.questionChoiceN.replace('{n}', '1')}: 桜えび`);
    expect(labels.some((l) => /[{|}]/.test(l))).toBe(false);
    expect(root.querySelectorAll('.comp__choice ruby').length).toBeGreaterThan(0);
  });

  it('passes: two of three or better', () => {
    expect(passes(2, 3)).toBe(true);
    expect(passes(3, 3)).toBe(true);
    expect(passes(1, 3)).toBe(false);
    expect(passes(0, 0)).toBe(false);
    expect(passes(1, 1)).toBe(true);
  });

  it('JaOrPlain renders Japanese through Ruby with lang="ja" and English as plain text', () => {
    act(() => render(<JaOrPlain text="ハナは{何|なに}を{飲|の}みますか。" />, root));
    expect(q('[lang="ja"]')).not.toBeNull();
    expect(root.querySelectorAll('ruby').length).toBe(2);
    render(null, root);
    act(() => render(<JaOrPlain text="What does Hana drink?" />, root));
    expect(q('[lang="ja"]')).toBeNull();
    expect(root.textContent).toBe('What does Hana drink?');
  });
});

describe('<Comprehension>', () => {
  it('scores two right and one wrong as 2 of 3 and calls onDone once', () => {
    const onDone = mount();
    expect(q('[data-field="question"]')?.textContent).toBe(QS[0]?.q);
    expect(root.querySelectorAll('[data-choice]').length).toBe(4);

    click(choice(1)); // Coffee: right
    expect(choice(1).getAttribute('data-state')).toBe('correct');
    expect(q('.comp__feedback')?.getAttribute('data-kind')).toBe('correct');
    expect(q('[data-action="advance"]')?.textContent).toBe(S.questionNext);
    click(q('[data-action="advance"]'));

    click(choice(0)); // Hana: wrong, answer Ken (2)
    expect(choice(0).getAttribute('data-state')).toBe('wrong');
    expect(choice(2).getAttribute('data-state')).toBe('answer');
    expect(q('.comp__feedback')?.textContent).toContain(S.questionWrong);
    expect(q('.comp__feedback')?.textContent).toContain('Ken');
    click(q('[data-action="advance"]'));

    click(choice(0)); // Three: right
    expect(q('[data-action="advance"]')?.textContent).toBe(S.questionFinish);
    expect(onDone).not.toHaveBeenCalled();
    click(q('[data-action="advance"]'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ correct: 2, total: 3 });
    // a second advance never fires onDone again
    click(q('[data-action="advance"]'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a pick locks the choices and reports onAnswer', () => {
    const onAnswer = vi.fn();
    mount(QS, { onAnswer });
    click(choice(3));
    expect(onAnswer).toHaveBeenCalledWith(0, false);
    expect(choice(0).disabled).toBe(true);
    click(choice(1));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(q('.comp__score')?.textContent).toBe('0/3');
  });

  it('keys 1–4 pick and Enter advances when no frame is present', () => {
    const onDone = mount();
    key('2');
    expect(choice(1).getAttribute('data-state')).toBe('correct');
    key('3'); // ignored once picked
    expect(choice(2).getAttribute('data-state')).toBeNull();
    key('Enter');
    expect(q('.comp')?.getAttribute('data-index')).toBe('1');
    key('Enter'); // nothing picked: no advance
    expect(q('.comp')?.getAttribute('data-index')).toBe('1');
    key('3');
    key('Enter');
    key('1');
    key('Enter');
    expect(onDone).toHaveBeenCalledWith({ correct: 3, total: 3 });
  });

  it('digits typed into an input are left alone', () => {
    mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    });
    expect(choice(0).getAttribute('data-state')).toBeNull();
    input.remove();
  });

  it('inside an ExerciseFrame the frame forwards digits and Enter (no double handling)', () => {
    const onDone = vi.fn();
    const step: Step = { id: 's', block: 'input', exercise: 'story-read', itemId: null, cardKey: null, params: {}, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 1 };
    act(() =>
      render(
        <ExerciseFrame step={step} index={0} total={1} ki={0} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
          <Comprehension questions={[QS[0] as ComprehensionQuestion]} onDone={onDone} />
        </ExerciseFrame>,
        root,
      ),
    );
    key('2');
    expect(choice(1).getAttribute('data-state')).toBe('correct');
    expect(q('.comp__score')?.textContent).toBe('1/1');
    key('Enter');
    expect(onDone).toHaveBeenCalledWith({ correct: 1, total: 1 });
  });

  it('shuffled choices still score by meaning', () => {
    const onDone = mount(QS, { rng: rngFor('seed', 7) });
    for (let i = 0; i < 3; i++) {
      const right = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-choice]')).find((b) => {
        const want = QS[i]?.choices[QS[i]?.answer ?? 0];
        return b.textContent?.includes(want ?? '');
      });
      click(right ?? null);
      click(q('[data-action="advance"]'));
    }
    expect(onDone).toHaveBeenCalledWith({ correct: 3, total: 3 });
  });

  it('renders Japanese questions through Ruby', () => {
    const jaQ: ComprehensionQuestion = { q: 'ハナは{何|なに}を{飲|の}みますか。', choices: ['{水|みず}', 'コーヒー', 'お{茶|ちゃ}', 'ミルク'], answer: 1 };
    mount([jaQ]);
    expect(q('[data-field="question"] [lang="ja"]')).not.toBeNull();
    expect(q('[data-field="question"] ruby rt')?.textContent).toBe('なに');
    expect(choice(0).querySelector('rt')?.textContent).toBe('みず');
  });

  it('no questions: calls onDone with 0 of 0 and shows the notice', () => {
    const onDone = mount([]);
    expect(onDone).toHaveBeenCalledWith({ correct: 0, total: 0 });
    expect(root.textContent).toContain(S.speedNoQuestions);
  });

  it('every choice is a labelled, focusable button with its key shortcut', () => {
    mount();
    const b = choice(2);
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('aria-label')).toContain('Choice 3');
    expect(b.getAttribute('aria-keyshortcuts')).toBe('3');
  });
});
