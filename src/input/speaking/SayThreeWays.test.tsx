import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G } from '@/content/fixtures';
import type { GrammarItem } from '@/content/types';
import { STT_STATE_LABEL } from '@/audio';
import { installServices, nullStt, resetServices, type SttService } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { AttemptResult, Step } from '@/shared/session-types';
import { epochDay } from '@/shared/time';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore, type TestStoreOptions } from '@/store/testing';
import { S } from '../strings';
import { SayThreeWays, gradeThreeWays, implicitGrammarGrade, meta } from './SayThreeWays';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const MASU = FIXTURE.items[G.ます] as GrammarItem; // register polite, clozeHints ['ます']

let root: HTMLDivElement;
let clock: number;

async function setup(o: { stt?: SttService; store?: TestStoreOptions } = {}): Promise<void> {
  clock = DEFAULT_TEST_NOW;
  await makeTestStore({ now: () => clock, ...o.store });
  bus.reset();
  installServices({ stt: o.stt ?? nullStt });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'tw-1',
    block: 'output',
    exercise: 'say-three-ways',
    itemId: G.ます,
    cardKey: null,
    params: { sentence: 'パンを食べます。', promptEn: 'Say it three ways: casual, polite, keigo. I eat bread.', mode: 'type' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 90000,
    ...over,
  };
}

async function mount(s: Step, item: GrammarItem | null = MASU) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const onHint = vi.fn();
  await act(async () => {
    render(<SayThreeWays step={s} item={item} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={onHint} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} />, root);
    await Promise.resolve();
  });
  return { onResult, onHint };
}

const inputs = (): HTMLInputElement[] => Array.from(root.querySelectorAll<HTMLInputElement>('input.kana-input__field'));
function type(input: HTMLInputElement, text: string): void {
  act(() => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function clickAsync(sel: string): Promise<void> {
  const el = root.querySelector<HTMLButtonElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    el!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('three-ways helpers', () => {
  it('meta: say-three-ways, null facet, kana keys, no TTS/STT requirement', () => {
    expect(meta).toEqual({ id: 'say-three-ways', facet: null, needsTts: false, needsStt: false, selfGraded: false, timeable: false, keys: 'kana' });
  });

  it('gradeThreeWays classifies each version and counts the ones that land', () => {
    const g = gradeThreeWays({ casual: 'パンを食べる。', polite: 'パンを食べます。', keigo: 'パンをいただきます。' });
    expect(g.rows.map((r) => r.detected)).toEqual(['casual', 'polite', 'keigo']);
    expect(g.rows.map((r) => r.ok)).toEqual([true, true, true]);
    expect(g.correct).toBe(3);
    expect(g.rows[1]!.markers).toContain('食べます');

    const slip = gradeThreeWays({ casual: 'パンを食べます。', polite: 'パンを食べます。', keigo: 'パンを食べます。' });
    expect(slip.rows.map((r) => r.ok)).toEqual([false, true, false]);
    expect(slip.correct).toBe(1);

    const mixed = gradeThreeWays({ casual: 'うん、食べます。', polite: '', keigo: 'パンを召し上がる。' });
    expect(mixed.rows[0]!.detected).toBe('mixed');
    expect(mixed.rows[1]!.detected).toBeNull();
    expect(mixed.rows[2]!.detected).toBe('mixed');
    expect(mixed.correct).toBe(0);
  });

  it('implicitGrammarGrade writes only for a prod card due within 3 days, Good when the polite version lands with the pattern', () => {
    const g = gradeThreeWays({ casual: 'パンを食べる。', polite: 'パンを食べます。', keigo: 'パンをいただきます。' });
    const due = { get: () => card({ due: TODAY + 2, s: 5, reps: 3, state: 2 }) };
    expect(implicitGrammarGrade(MASU, g, due, TODAY)).toEqual([{ cardKey: `${G.ます}#prod`, rating: 3 }]);
    const far = { get: () => card({ due: TODAY + 10, s: 20, reps: 3, state: 2 }) };
    expect(implicitGrammarGrade(MASU, g, far, TODAY)).toEqual([]);
    expect(implicitGrammarGrade(MASU, g, { get: () => undefined }, TODAY)).toEqual([]);
    const bad = gradeThreeWays({ casual: 'パンを食べる。', polite: 'パンを食べた。', keigo: 'パンをいただきます。' });
    expect(implicitGrammarGrade(MASU, bad, due, TODAY)).toEqual([{ cardKey: `${G.ます}#prod`, rating: 1 }]);
    expect(implicitGrammarGrade(null, g, due, TODAY)).toEqual([]);
  });
});

describe('<SayThreeWays>', () => {
  it('three typed versions are classified, counted and emitted', async () => {
    await setup({ store: { cards: { [`${G.ます}#prod`]: card({ due: TODAY, s: 5, reps: 3, state: 2 }) } } });
    const cap = captureEvents();
    const { onResult } = await mount(step());
    expect(root.querySelector('.three-ways')?.getAttribute('data-mode')).toBe('type');
    expect(inputs().length).toBe(3);
    expect(root.querySelector<HTMLButtonElement>('[data-action="check"]')?.disabled).toBe(true);
    const [c, po, k] = inputs() as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
    type(c, 'パンを食べる');
    type(po, 'パンを食べます');
    type(k, 'パンをいただきます');
    expect(root.querySelector<HTMLButtonElement>('[data-action="check"]')?.disabled).toBe(false);
    clock += 20_000;
    await clickAsync('[data-action="check"]');
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]![0];
    expect(r.correct).toBe(true);
    expect(r.errorTags).toEqual([]);
    expect(r.ms).toBe(20_000);
    expect(r.answer).toBe('パンを食べる / パンを食べます / パンをいただきます');
    expect(r.implicit).toEqual([{ cardKey: `${G.ます}#prod`, rating: 3 }]);
    const out = cap.events.filter(([n]) => n === 'output:done');
    expect(out).toEqual([['output:done', { kind: 'three-ways', registersCorrect: 3, path: 'self' }]]);
    expect(root.querySelectorAll('[data-verdict="hit"]').length).toBe(3);
    expect(root.querySelector('.speak__verdict')?.textContent).toBe('3 of 3 registers landed.');
    expect(root.querySelector('.speak__result')?.getAttribute('data-kind')).toBe('correct');
    // the model shows after the check with its register
    expect(root.textContent).toContain('パンを食べます。');
    cap.stop();
  });

  it('a slipped register is tagged, counted as 2 of 3 and shown row by row; an empty row blocks the check', async () => {
    await setup();
    const { onResult, onHint } = await mount(step());
    const [c, po, k] = inputs() as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
    type(c, 'パンを食べます'); // polite where casual was asked
    type(po, 'パンを食べます');
    act(() => {
      k.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(onResult).not.toHaveBeenCalled();
    expect(root.querySelector('.speak__status')?.textContent).toBe(S.threeWaysEmpty);
    await clickAsync('[data-action="model"]');
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain(S.threeWaysModel);
    type(k, 'パンをいただきます');
    await clickAsync('[data-action="check"]');
    const r = onResult.mock.calls[0]![0];
    expect(r.correct).toBe(false);
    expect(r.nearMiss).toBe(true);
    expect(r.hintUsed).toBe(true);
    expect(r.errorTags).toEqual(['register']);
    const rows = Array.from(root.querySelectorAll('.three-ways__row')).map((el) => el.getAttribute('data-verdict'));
    expect(rows).toEqual(['miss', 'hit', 'hit']);
    expect(root.querySelector('[data-register="casual"] [data-ok="false"]')?.textContent).toContain(S.registerPolite);
    expect(root.querySelector('.speak__verdict')?.textContent).toBe('2 of 3 registers landed.');
  });

  it('speak mode fills a row from the recognizer and reports the recognition path', async () => {
    const recognize = vi.fn(() => Promise.resolve({ alternatives: ['パンを食べる'] }));
    await setup({ stt: { available: true, recognize, abort: () => undefined }, store: { save: { settings: { speaking: 'recognition' } } } });
    const cap = captureEvents();
    const { onResult } = await mount(step({ params: { sentence: 'パンを食べます。', promptEn: 'I eat bread.', mode: 'speak' } }));
    expect(root.querySelector('.three-ways')?.getAttribute('data-mode')).toBe('speak');
    await clickAsync('[data-action="speak-casual"]');
    expect(recognize).toHaveBeenCalledWith({ maxMs: 8000 });
    expect(inputs()[0]!.value).toBe('パンを食べる');
    const [, po, k] = inputs() as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
    type(po, 'パンを食べます');
    type(k, 'パンをいただきます');
    await clickAsync('[data-action="check"]');
    expect(onResult.mock.calls[0]![0].correct).toBe(true);
    expect(cap.events.filter(([n]) => n === 'output:done')[0]![1]).toMatchObject({ kind: 'three-ways', registersCorrect: 3, path: 'recognition' });
    cap.stop();
  });

  it('speak mode names a typed recognizer failure (no network) instead of "nothing heard"', async () => {
    const stt = { available: true, recognize: () => Promise.resolve(null), abort: () => undefined, state: signal<'network'>('network') };
    await setup({ stt, store: { save: { settings: { speaking: 'recognition' } } } });
    await mount(step({ params: { sentence: 'パンを食べます。', promptEn: 'I eat bread.', mode: 'speak' } }));
    await clickAsync('[data-action="speak-casual"]');
    expect(root.querySelector('.speak__status')?.textContent).toBe(STT_STATE_LABEL.network);
    expect(root.textContent).not.toContain(S.shadowNoSpeech);
  });

  it('speak mode falls back to typing when recognition is not opted in', async () => {
    await setup({ stt: { available: true, recognize: () => Promise.resolve(null), abort: () => undefined } });
    await mount(step({ params: { sentence: 'パンを食べます。', mode: 'speak' } }));
    expect(root.querySelector('.three-ways')?.getAttribute('data-mode')).toBe('type');
    expect(root.querySelector('[data-action="speak-casual"]')).toBeNull();
    expect(root.querySelector('.speak__prompt')?.textContent).toBe(S.threeWaysPrompt);
  });
});
