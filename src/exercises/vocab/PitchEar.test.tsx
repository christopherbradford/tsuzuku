import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, V } from '@/content/fixtures';
import type { VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { PITCH_TYPES, pitchType } from '../PitchLine';
import { PitchEar, meta, minimalPairOf, pitchChoiceTypes, pitchTypeOfLabel } from './PitchEar';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock });
  installServices({ audio: { ...nullAudio, speak } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const NOMU = FIXTURE.items[V.飲む] as VocabItem; // のむ pitch 1 → 頭高 (high confidence)
const MIZU = FIXTURE.items[V.水] as VocabItem; // みず pitch 0 → 平板
const INU = FIXTURE.items[V.犬] as VocabItem; // いぬ pitch 2 → 尾高
const COFFEE = FIXTURE.items[V.コーヒー] as VocabItem; // コーヒー pitch 3 of 4 → 中高
const PATTERNS = ['平板', '頭高', '中高', '尾高'];

function step(item: VocabItem, over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'pitch-ear',
    itemId: item.id,
    cardKey: `${item.id}#pitch`,
    params: { answer: PATTERNS[PITCH_TYPES.indexOf(pitchType(item.kana, item.pitch ?? 0))], choices: PATTERNS },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 3,
    estMs: 6000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };

function props(item: VocabItem | null = NOMU, over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(item ?? NOMU),
    item,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 3,
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
  act(() => render(framed ? inFrame(<PitchEar {...p} />, p.step) : <PitchEar {...p} />, root));
}

function key(k: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const glyphs = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.pitch-choice'));
const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers pitch-ear on the pitch facet with choice keys, TTS, no speed pressure', () => {
    expect(meta).toMatchObject({ id: 'pitch-ear', facet: 'pitch', keys: 'choices', needsTts: true, timeable: false });
  });
});

describe('<PitchEar>', () => {
  it('draws four contour glyphs and the correct index follows pitchType', () => {
    mount(props(NOMU));
    expect(glyphs().length).toBe(4);
    expect(glyphs().map((b) => b.getAttribute('data-type'))).toEqual(['heiban', 'atamadaka', 'nakadaka', 'odaka']);
    expect(glyphs().every((b) => b.querySelector('.pitch-glyph') !== null)).toBe(true);
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('1');
    mount(props(MIZU, { step: step(MIZU) }));
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('0');
    mount(props(INU, { step: step(INU) }));
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('3');
    mount(props(COFFEE, { step: step(COFFEE) }));
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('2');
  });

  it('the right glyph is Good and reveals the word’s own pitch line; the answer is the pattern name', () => {
    const p = props(NOMU);
    mount(p);
    expect(q('.pitch-line')).toBeNull();
    clock += 1700;
    act(() => glyphs()[1]?.click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: '頭高', ms: 1700, replays: 0 });
    expect(glyphs()[1]?.getAttribute('data-state')).toBe('correct');
    expect(q('.pitch-contrast .pitch-line')?.getAttribute('data-type')).toBe('atamadaka');
    expect(q('.pitch-choices')?.getAttribute('data-locked')).toBe('true');
    expect(root.textContent).toContain('text-to-speech approximation');
    expect(q('.vocab__collocation')).not.toBeNull();
  });

  it('a wrong glyph is Again tagged pitch, with the missed glyph shown', () => {
    const p = props(NOMU);
    mount(p);
    act(() => glyphs()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, errorTags: ['pitch'], answer: '平板' });
    expect(glyphs()[0]?.getAttribute('data-state')).toBe('wrong');
    expect(glyphs()[1]?.getAttribute('data-state')).toBe('missed');
    act(() => glyphs()[1]?.click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
  });

  it('digits pick through the frame and Space replays; replays are counted', () => {
    const p = props(NOMU);
    mount(p, true);
    expect(speak).toHaveBeenCalledWith('飲む', { kana: 'のむ' });
    key(' ');
    expect(speak).toHaveBeenCalledTimes(2);
    expect(p.onReplay).toHaveBeenCalledTimes(1);
    key('2');
    expect(result(p)).toMatchObject({ correct: true, replays: 1 });
    key(' ');
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('honours the planner’s choice order', () => {
    const p = props(NOMU, { step: step(NOMU, { params: { answer: '頭高', choices: ['尾高', '中高', '頭高', '平板'] } }) });
    mount(p);
    expect(glyphs().map((b) => b.getAttribute('data-type'))).toEqual(['odaka', 'nakadaka', 'atamadaka', 'heiban']);
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('2');
    act(() => glyphs()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true, answer: '頭高' });
  });

  it('a word without pitch data, or no item, shows the notice and continues as a soft timeout', () => {
    const noPitch: VocabItem = { ...NOMU, pitch: undefined, pitchConfidence: undefined };
    const p = props(noPitch, { step: step(NOMU) });
    mount(p);
    expect(q('.missing-item')).not.toBeNull();
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
    const n = props(null, { step: step(NOMU) });
    mount(n);
    expect(q('.missing-item')).not.toBeNull();
  });
});

describe('helpers', () => {
  it('pitchTypeOfLabel reads kanji, English and type names', () => {
    expect(pitchTypeOfLabel('平板')).toBe('heiban');
    expect(pitchTypeOfLabel('Head-high')).toBe('atamadaka');
    expect(pitchTypeOfLabel(' nakadaka ')).toBe('nakadaka');
    expect(pitchTypeOfLabel('尾高')).toBe('odaka');
    expect(pitchTypeOfLabel('flat?')).toBeNull();
  });

  it('pitchChoiceTypes keeps a complete planner order and falls back otherwise', () => {
    expect(pitchChoiceTypes({ choices: ['尾高', '中高', '頭高', '平板'] })).toEqual(['odaka', 'nakadaka', 'atamadaka', 'heiban']);
    expect(pitchChoiceTypes({ choices: ['尾高', '中高'] })).toEqual([...PITCH_TYPES]);
    expect(pitchChoiceTypes({ choices: ['尾高', '尾高', '頭高', '平板'] })).toEqual([...PITCH_TYPES]);
    expect(pitchChoiceTypes({})).toEqual([...PITCH_TYPES]);
  });

  it('minimalPairOf finds a homophone with a different pitch (雨 / 飴) and ignores the rest', () => {
    const ame1: VocabItem = { ...MIZU, id: 'v-n5-0101', word: '雨', kana: 'あめ', meanings: ['rain'], pitch: 1 };
    const ame0: VocabItem = { ...MIZU, id: 'v-n5-0102', word: '飴', kana: 'あめ', meanings: ['candy'], pitch: 0 };
    const same: VocabItem = { ...MIZU, id: 'v-n5-0103', word: '天', kana: 'あめ', meanings: ['heaven'], pitch: 1 };
    const noPitch: VocabItem = { ...MIZU, id: 'v-n5-0104', word: 'アメ', kana: 'あめ', meanings: ['x'], pitch: undefined };
    expect(minimalPairOf(ame1, [same, noPitch, NOMU, ame0])?.id).toBe('v-n5-0102');
    expect(minimalPairOf(ame1, [same, NOMU])).toBeNull();
    expect(minimalPairOf(ame1, [])).toBeNull();
  });
});
