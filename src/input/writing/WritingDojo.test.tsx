import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G, V, createFakeLoader } from '@/content/fixtures';
import type { ContentItem, GrammarItem } from '@/content/types';
import { bus } from '@/shared/events';
import type { JudgeRequest } from '@/shared/exercise-types';
import type { AttemptResult, Step } from '@/shared/session-types';
import { epochDay } from '@/shared/time';
import { WRITING_PREFIX as SHARED_PREFIX, writingSentencesFrom as sharedWritingSentencesFrom } from '@/shared/writing';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore, type TestStoreOptions } from '@/store/testing';
import { S } from '../strings';
import { checkWriting } from './checks';
import {
  WRITING_PREFIX,
  WritingDojo,
  errorTagsFrom,
  findingCopy,
  greenVocab,
  keepSentences,
  liveFindings,
  meta,
  patternsFor,
  targetRegister,
  writingSentencesFrom,
} from './WritingDojo';

const loader = createFakeLoader();
const get = (id: string): ContentItem | undefined => loader.get(id);
const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const DESU = FIXTURE.items[G.です] as GrammarItem;
const MASU = FIXTURE.items[G.ます] as GrammarItem;
const WA = FIXTURE.items[G.は] as GrammarItem;

let root: HTMLDivElement;
let clock: number;
let copied: string[];

async function setup(o: TestStoreOptions = {}): Promise<void> {
  clock = DEFAULT_TEST_NOW;
  copied = [];
  // Writing Dojo opens at Green (design 04 §13): range 3–5 sentences.
  await makeTestStore({ now: () => clock, ...o, save: { profile: { belt: 'green' }, ...(o.save ?? {}) } });
  bus.reset();
}

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
    id: 'wd-1',
    block: 'output',
    exercise: 'writing-dojo',
    itemId: null,
    cardKey: null,
    params: { patternIds: [G.です, G.ます], promptEn: 'Write 3 sentences about your morning. Use the patterns named.', seconds: 180 },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 300000,
    ...over,
  };
}

const nav = (): Pick<Navigator, 'clipboard'> =>
  ({
    clipboard: {
      writeText: (t: string) => {
        copied.push(t);
        return Promise.resolve();
      },
    },
  }) as unknown as Pick<Navigator, 'clipboard'>;

async function mount(s: Step, o: { judge?: boolean; nav?: Pick<Navigator, 'clipboard'> | null } = {}) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const requestJudge = vi.fn<(req: JudgeRequest) => Promise<boolean>>(() => Promise.resolve(o.judge ?? true));
  const extra = o.nav === null ? { nav: { clipboard: undefined } as unknown as Pick<Navigator, 'clipboard'> } : { nav: o.nav ?? nav() };
  await act(async () => {
    render(<WritingDojo step={s} item={null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={() => undefined} onReplay={() => undefined} requestJudge={requestJudge} loader={loader} {...extra} />, root);
    await Promise.resolve();
  });
  return { onResult, requestJudge };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
function typeText(text: string): void {
  const ta = q<HTMLTextAreaElement>('.dojo-write__text');
  expect(ta).not.toBeNull();
  act(() => {
    ta!.value = text;
    ta!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(sel: string): Promise<void> {
  const el = q<HTMLButtonElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    el!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const TEXT = '私はハナです。毎朝コーヒーを飲みます。パンも食べます。';

describe('writing-dojo helpers', () => {
  it('meta: writing-dojo, null facet, no keys, self-graded (rubric)', () => {
    expect(meta).toEqual({ id: 'writing-dojo', facet: null, needsTts: false, needsStt: false, selfGraded: true, timeable: false, keys: 'none' });
  });

  it('patternsFor skips unknown ids; targetRegister prefers the step, then a non-neutral pattern, then polite', () => {
    expect(patternsFor({ patternIds: [G.です, 'g-n5-999', G.は] }, get).map((g) => g.id)).toEqual([G.です, G.は]);
    expect(targetRegister({ registerTarget: 'casual' }, [DESU])).toBe('casual');
    expect(targetRegister({}, [WA, DESU])).toBe('polite');
    expect(targetRegister({}, [WA])).toBe('polite');
    expect(targetRegister({}, [])).toBe('polite');
  });

  it('keepSentences keeps readable sentences (≥ 4 chars, ≤ 12); writingSentencesFrom reads them back from bookmarks', () => {
    // The bookmark convention is the contract tier's (`@/shared/writing`), which the art tier reads for the wall scrolls (contract #11).
    expect(WRITING_PREFIX).toBe(SHARED_PREFIX);
    expect(writingSentencesFrom).toBe(sharedWritingSentencesFrom);
    // sentencesOf strips the closing punctuation
    expect(keepSentences('私はハナです。はい。毎朝コーヒーを飲みます。')).toEqual(['私はハナです', '毎朝コーヒーを飲みます']);
    const many = Array.from({ length: 15 }, (_, i) => `文${i}です。`).join('');
    expect(keepSentences(many).length).toBe(12);
    expect(writingSentencesFrom([`${WRITING_PREFIX}私はハナです。`, '12345: outside note', `${WRITING_PREFIX}パンを食べます。`])).toEqual(['私はハナです。', 'パンを食べます。']);
  });

  it('findingCopy, liveFindings and errorTagsFrom turn checks into copy and tags', () => {
    const check = checkWriting('パンをを食べるます。', { patterns: [DESU], register: 'polite', greenWords: [FIXTURE.items[V.食べる] as never], range: [3, 5] });
    const live = liveFindings(check);
    expect(live.map((f) => f.code)).toEqual(expect.arrayContaining(['pattern-missing', 'particle', 'conjugation']));
    expect(live.some((f) => f.code === 'length-short')).toBe(false);
    const name = (id: string): string => (id === G.です ? '〜です' : id);
    expect(findingCopy(live.find((f) => f.code === 'pattern-missing')!, name)).toBe('Pattern not found yet: 〜です');
    expect(findingCopy(live.find((f) => f.code === 'conjugation')!, name)).toBe('Conjugation: 食べるます → 食べます');
    expect(findingCopy(live.find((f) => f.code === 'particle')!, name)).toBe('Particle check: をを looks off.');
    expect(errorTagsFrom(check.findings)).toEqual(['particle', 'conjugation']);
  });

  it('greenVocab lists loaded vocab at item-belt Green or better', async () => {
    await setup({
      cards: {
        [`${V.飲む}#rec`]: card({ due: TODAY + 10, s: 12, reps: 5, state: 2 }),
        [`${V.食べる}#rec`]: card({ due: TODAY + 1, s: 2, reps: 2, state: 2 }),
        [`${V.パン}#rec`]: card({ due: TODAY + 30, s: 40, reps: 9, state: 2 }),
      },
    });
    expect(greenVocab(store.cards, get).map((w) => w.id).sort()).toEqual([V.パン, V.飲む].sort());
  });
});

describe('<WritingDojo>', () => {
  it('finishing emits output:done with patternsHit, reports chars and sentences, keeps the sentences and tags nothing on a clean piece', async () => {
    await setup({ save: { stats: { judgeChecks: 50, honesty: 1 } } }); // calibrated: 25 % sample
    const cap = captureEvents();
    const { onResult, requestJudge } = await mount(step());
    expect(root.querySelectorAll('.dojo-write__pattern').length).toBe(2);
    expect(q('[data-pattern="g-n5-001"]')?.getAttribute('data-present')).toBe('false');
    expect(q<HTMLButtonElement>('[data-action="finish"]')?.disabled).toBe(true);
    expect(q('.dojo-write__meta')?.textContent).toContain('3 to 5 sentences');
    typeText(TEXT);
    expect(q('[data-pattern="g-n5-001"]')?.getAttribute('data-present')).toBe('true');
    expect(q('[data-pattern="g-n5-003"]')?.getAttribute('data-present')).toBe('true');
    expect(q('.dojo-write__count')?.textContent).toBe('3 sentences · 24 characters');
    expect(q('.dojo-write__count')?.getAttribute('data-inrange')).toBe('true');
    expect(q('.dojo-write__checks .dojo-write__status')?.textContent).toBe(S.writingChecksClean);
    clock += 120_000;
    await click('[data-action="finish"]');
    const judged = requestJudge.mock.calls.length;
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]![0];
    expect(r.correct).toBe(true);
    expect(r.errorTags).toEqual([]);
    expect(r.answer).toBe(TEXT);
    expect(r.ms).toBe(120_000);
    const out = cap.events.filter(([n]) => n === 'output:done');
    expect(out).toEqual([['output:done', { kind: 'writing', patternsHit: 2, seconds: 120, path: 'self' }]]);
    expect(writingSentencesFrom(store.bookmarks.value)).toEqual(['私はハナです', '毎朝コーヒーを飲みます', 'パンも食べます']);
    expect(q('.dojo-write__verdict')?.textContent).toBe('Finished. 2 of 2 patterns used, 3 sentences.');
    // The closing line is honest both ways: what the art tier reads back is exactly what was kept, and it names the wall scrolls.
    expect(sharedWritingSentencesFrom(store.bookmarks.value)).toEqual(['私はハナです', '毎朝コーヒーを飲みます', 'パンも食べます']);
    expect(q('.dojo-write__result .dojo-write__meta')?.textContent).toBe(S.writingKept);
    expect(S.writingKept).toMatch(/bookmarks/);
    expect(S.writingKept).toMatch(/wall scrolls/);
    if (judged > 0) expect(q('.dojo-write__judge')).not.toBeNull();
    cap.stop();
  });

  it('live checks flag a kana-only Green word, a particle slip and a register slip; the result carries the tags', async () => {
    await setup({ cards: { [`${V.飲む}#rec`]: card({ due: TODAY + 10, s: 12, reps: 5, state: 2 }) }, save: { stats: { judgeChecks: 50, honesty: 1 } } });
    const { onResult } = await mount(step({ params: { patternIds: [G.ます] } }));
    typeText('私はコーヒーをがのみます。パンを食べる。');
    const codes = Array.from(root.querySelectorAll('.dojo-write__finding')).map((el) => el.getAttribute('data-code'));
    expect(codes).toEqual(expect.arrayContaining(['kana-only-green', 'particle', 'register']));
    expect(root.textContent).toContain('飲む is a word you know in kanji');
    await click('[data-action="finish"]');
    const r = onResult.mock.calls[0]![0];
    expect(r.errorTags).toEqual(expect.arrayContaining(['particle', 'register']));
    expect(r.correct).toBe(true);
  });

  it('the rubric self-check says plainly when a ticked pattern is not in the text; the sampled Judge verdict shows', async () => {
    await setup(); // no honesty history → rate 100 → always sampled
    const { onResult, requestJudge } = await mount(step({ params: { patternIds: [G.です] } }), { judge: false });
    typeText('毎朝コーヒーを飲みます。パンも食べます。水も飲みます。');
    act(() => {
      q<HTMLInputElement>('[data-rubric="g-n5-001"]')!.click();
    });
    expect(q('.dojo-write__mismatch')?.textContent).toBe(S.writingRubricMismatch);
    await click('[data-action="finish"]');
    expect(requestJudge).toHaveBeenCalledTimes(1);
    expect(requestJudge.mock.calls[0]![0]).toMatchObject({ regex: 'です' });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(q('.dojo-write__judge')?.getAttribute('data-judge')).toBe('fail');
    expect(q('.dojo-write__judge')?.textContent).toBe(S.writingJudgeFail);
  });

  it('export copies the tutor text; without a clipboard the text is shown to copy by hand', async () => {
    await setup();
    await mount(step());
    typeText(TEXT);
    await click('[data-action="export"]');
    expect(copied.length).toBe(1);
    expect(copied[0]).toContain(TEXT);
    expect(copied[0]).toContain(`${S.writingExportPrompt}: Write 3 sentences`);
    expect(copied[0]).toContain(`${S.writingExportPatterns}: 〜です / 〜ます`);
    expect(copied[0]).toContain(`${S.writingExportRegister}: polite`);
    expect(q('.dojo-write__status[data-status="main"]')?.textContent).toBe(S.writingExported);

    render(null, root);
    await setup();
    await mount(step(), { nav: null });
    typeText(TEXT);
    await click('[data-action="export"]');
    expect(q('.dojo-write__status[data-status="main"]')?.textContent).toBe(S.writingExportFailed);
    expect(q<HTMLTextAreaElement>('.dojo-write__export')?.value).toContain(TEXT);
  });

  it('an empty text cannot be finished; no patterns shows the free-writing note', async () => {
    await setup();
    const { onResult } = await mount(step({ params: { patternIds: [] } }));
    expect(root.textContent).toContain(S.writingNoPatterns);
    expect(q('.dojo-write__rubric')).toBeNull();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(onResult).not.toHaveBeenCalled();
  });

  it('the textarea takes focus on mount even after something else held focus (useAutoFocus, no autofocus attribute)', async () => {
    await setup();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    await mount(step());
    const ta = q<HTMLTextAreaElement>('.dojo-write__text');
    expect(ta).not.toBeNull();
    expect(document.activeElement).toBe(ta);
    expect(ta!.hasAttribute('autofocus')).toBe(false);
    outside.remove();
  });
});
