import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE } from '@/content/fixtures';
import type { KanjiItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import { mulberry32 } from '@/shared/hash';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { LookalikeDuel, MAX_CHOICES, buildDuelPrompt, duelChoices, meta } from './LookalikeDuel';

const EAT = FIXTURE.items['j-食'] as KanjiItem; // examples: 食べる たべる · 食べ物 たべもの
const SUN: KanjiItem = { ...(FIXTURE.items['j-日'] as KanjiItem), lookalikes: ['j-目', 'j-白'] };
const SENTENCE = 'ケンはパンを{食|た}べます。'; // plain: ケンはパンを食べます。 (食 at 6)

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore({ now: 3_000 });
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'ld-1',
    block: 'reviews',
    exercise: 'lookalike-duel',
    itemId: EAT.id,
    cardKey: 'j-食#read',
    params: { sentence: SENTENCE, blank: [6, 7], choices: ['良', '食', '飲', '飯'] },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 4,
    estMs: 5000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: EAT,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 4,
    onResult: vi.fn<(r: AttemptResult) => void>(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> };
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

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const choices = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
const texts = (): string[] => choices().map((b) => b.querySelector('.choice__text')?.textContent ?? '');

describe('LookalikeDuel helpers', () => {
  it('meta: lookalike-duel on the read facet with choice keys', () => {
    expect(meta).toMatchObject({ id: 'lookalike-duel', facet: 'read', keys: 'choices' });
    expect(MAX_CHOICES).toBe(4);
  });

  it('buildDuelPrompt blanks the given range, else the first kanji occurrence, else an example word', () => {
    const a = buildDuelPrompt(EAT, { sentence: SENTENCE, blank: [6, 7] }, 0);
    expect(a).toEqual({ pieces: ['ケンはパンを', '{食|た}', 'べます。'], clue: 'た', mode: 'sentence' });
    const b = buildDuelPrompt(EAT, { sentence: SENTENCE }, 0);
    expect(b?.pieces).toEqual(['ケンはパンを', '{食|た}', 'べます。']);
    expect(buildDuelPrompt(EAT, { sentence: '{水|みず}をください。' }, 0)).toBeNull();
    const c = buildDuelPrompt(EAT, {}, 0);
    expect(c).toEqual({ pieces: ['', '食', 'べる'], clue: 'たべる', mode: 'word' });
    const d = buildDuelPrompt(EAT, {}, 1);
    expect(d).toEqual({ pieces: ['', '食', 'べ物'], clue: 'たべもの', mode: 'word' });
  });

  it('duelChoices keeps params.choices (capped at four, answer kept), else uses the declared look-alikes', () => {
    expect(duelChoices(EAT, { choices: ['良', '食', '飲', '飯'] }, mulberry32(1))).toEqual(['良', '食', '飲', '飯']);
    const capped = duelChoices(EAT, { choices: ['良', '飲', '飯', '飾', '食'] }, mulberry32(1));
    expect(capped.length).toBe(4);
    expect(capped).toContain('食');
    const injected = duelChoices(EAT, { choices: ['良', '飲'] }, mulberry32(2));
    expect(injected.sort()).toEqual(['良', '食', '飲'].sort());
    const declared = duelChoices(SUN, {}, mulberry32(3));
    expect(declared.sort()).toEqual(['日', '白', '目'].sort());
    expect(duelChoices(EAT, {}, mulberry32(3))).toEqual(['食']); // no look-alikes known
  });
});

describe('<LookalikeDuel>', () => {
  it('renders the sentence with a blank, the choices from params, and fills the blank after the right pick', () => {
    const pr = props();
    act(() => render(<LookalikeDuel {...pr} />, root));
    expect(texts()).toEqual(['良', '食', '飲', '飯']);
    expect(q('[data-blank="true"]')?.textContent).toBe('＿');
    expect(q('[data-blank="true"]')?.getAttribute('data-filled')).toBe('false');
    expect(root.textContent).toContain('Which kanji fits the blank?');
    expect(q('.choice-grid')?.getAttribute('data-size')).toBe('lg');
    act(() => choices()[1]?.click());
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, errorTags: [], answer: '食', hintUsed: false, ms: 0 });
    expect(q('[data-blank="true"]')?.getAttribute('data-filled')).toBe('true');
    expect(q('[data-blank="true"]')?.textContent).toContain('食');
    expect(q('[data-blank="true"] rt')?.textContent).toBe('た');
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('correct');
    expect(root.textContent).toContain('ショク');
  });

  it('a blank that cuts through a ruby group shows the rest of the word bare and never duplicates the kanji on reveal', () => {
    const MI: KanjiItem = { ...EAT, id: 'j-未', char: '未', meanings: ['not yet'], on: ['ミ'], kun: [], examples: [{ word: '未来', kana: 'みらい', en: 'future' }], lookalikes: ['j-末'] };
    const pr = props({ item: MI, step: step({ itemId: MI.id, cardKey: 'j-未#read', params: { sentence: '{未来|みらい}は{明|あか}るい。', blank: [0, 1], choices: ['未', '末'] } }) });
    act(() => render(<LookalikeDuel {...pr} />, root));
    const sentence = q('.kj__sentence') as HTMLElement;
    const visible = (): string => Array.from(sentence.querySelectorAll('rt')).reduce((t, rt) => t.replace(rt.textContent ?? '', ''), sentence.textContent ?? '');
    expect(visible()).toBe('＿来は明るい。');
    expect(q('[data-blank="true"]')?.textContent).toBe('＿');
    // the reading of the cut word is still the hint
    const readingBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Reading') as HTMLButtonElement;
    act(() => readingBtn.click());
    expect(q('[data-hint="true"]')?.textContent).toContain('みらい');
    act(() => choices()[0]?.click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, answer: '未', hintUsed: true });
    expect(q('[data-blank="true"]')?.textContent).toBe('未');
    expect(q('[data-blank="true"] rt')).toBeNull();
    expect(visible()).toBe('未来は明るい。');
    expect(sentence.textContent?.match(/来/g)?.length).toBe(1);
  });

  it('a wrong pick through a digit → Again tagged kanji-meaning, right answer marked missed, fires once', () => {
    const s = step();
    const pr = props({ step: s });
    act(() => render(inFrame(<LookalikeDuel {...pr} />, s), root));
    press('3');
    press('2');
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, errorTags: ['kanji-meaning'], answer: '飲' });
    expect(choices()[1]?.getAttribute('data-state')).toBe('missed');
    expect(choices()[2]?.getAttribute('data-state')).toBe('wrong');
    expect(root.textContent).toContain('Same parts, different kanji.');
  });

  it('the reading hint in sentence mode costs a hint', () => {
    const pr = props();
    act(() => render(<LookalikeDuel {...pr} />, root));
    const hint = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Reading') as HTMLButtonElement;
    act(() => hint.click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain('た');
    act(() => choices()[1]?.click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('without a sentence it blanks the kanji inside an example word and shows the kana clue', () => {
    const pr = props({ step: step({ params: { choices: ['食', '良'] } }), exposures: 1 });
    act(() => render(<LookalikeDuel {...pr} />, root));
    expect(q('.kj-duel')?.getAttribute('data-mode')).toBe('word');
    expect(q('.kj__sentence')?.textContent).toBe('＿べ物');
    expect(q('[data-clue="true"]')?.textContent).toContain('たべもの');
    expect(texts()).toEqual(['食', '良']);
    act(() => choices()[0]?.click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
    expect(q('.kj__sentence')?.textContent).toBe('食べ物');
  });

  it('uses the declared look-alikes when params carry no choices', () => {
    const pr = props({ item: SUN, step: step({ itemId: SUN.id, cardKey: 'j-日#read', params: {} }) });
    act(() => render(<LookalikeDuel {...pr} />, root));
    expect(texts().sort()).toEqual(['日', '白', '目'].sort());
  });

  it('with fewer than two choices the kanji is shown, not tested, and Continue emits a Hard-ceiling result', () => {
    const pr = props({ step: step({ params: {} }) });
    act(() => render(<LookalikeDuel {...pr} />, root));
    expect(q('.kj-duel')?.getAttribute('data-state')).toBe('shown');
    expect(q('.choice-grid')).toBeNull();
    expect(root.textContent).toContain('Shown, not tested');
    expect(q('.kj__sentence')?.textContent).toBe('食べる');
    act(() => (q('.hanko') as HTMLButtonElement).click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('without a kanji item it degrades honestly', () => {
    const pr = props({ item: null, step: step({ itemId: null, cardKey: null }) });
    act(() => render(<LookalikeDuel {...pr} />, root));
    expect(q('.kj-duel')?.getAttribute('data-state')).toBe('unavailable');
  });
});
