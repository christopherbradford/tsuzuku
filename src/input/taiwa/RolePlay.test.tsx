import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, V, createFakeLoader } from '@/content/fixtures';
import { toPlain } from '@/content/ruby';
import type { StoryItem, StoryLine } from '@/content/types';
import { STT_STATE_LABEL } from '@/audio';
import { installServices, nullAudio, nullStt, resetServices, type AudioService, type SpeakOptions, type SttService } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { cardKey } from '@/shared/ids';
import type { AttemptResult, Step } from '@/shared/session-types';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '@/store/testing';
import { windowMs } from './aizuchi';
import { chooseOptions } from './options';
import { AIZUCHI_PAUSE_MS, RolePlay, meta, type RolePlayResult } from './RolePlay';
import { S } from './strings';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const loader = createFakeLoader();
const L = (i: number): StoryLine => DIALOGUE.lines[i] as StoryLine;

interface SpeakCall {
  text: string;
  o?: SpeakOptions;
}
function fakeAudio(): { audio: AudioService; calls: SpeakCall[] } {
  const calls: SpeakCall[] = [];
  const audio: AudioService = {
    ...nullAudio,
    muted: signal(false),
    hasJaVoice: signal(true),
    speak: (text, o) => {
      calls.push({ text, o });
      return Promise.resolve();
    },
    cancel: vi.fn(),
  };
  return { audio, calls };
}
function fakeStt(alternatives: string[] | null): SttService & { calls: number } {
  const s = {
    available: true,
    calls: 0,
    recognize: () => {
      s.calls++;
      return Promise.resolve(alternatives ? { alternatives } : null);
    },
    abort: () => undefined,
  };
  return s;
}

let clock = DEFAULT_TEST_NOW;
let root: HTMLDivElement;

async function setup(save: Parameters<typeof makeTestStore>[0] = {}): Promise<void> {
  clock = DEFAULT_TEST_NOW;
  await makeTestStore({ now: () => clock, ...save, save: { settings: { furigana: 'off' }, ...(save.save ?? {}) } });
  bus.reset();
}

beforeEach(async () => {
  await setup();
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  vi.useRealTimers();
});

/** Advances fake timers and the store clock together, flushing resolved speech. */
async function tick(ms = 0): Promise<void> {
  clock += ms;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}
function clickText(text: string): void {
  const b = buttonByText(text);
  act(() => b.click());
}
function phase(): string | null {
  return root.querySelector('.taiwa')?.getAttribute('data-phase') ?? null;
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
function optionOfKind(lineIndex: number, kind: 'best' | 'ok' | 'register-wrong' | 'grammar-wrong'): string {
  const opts = chooseOptions(L(lineIndex), { register: 'polite', get: (id) => loader.get(id), rng: rngFor(store.seed(), store.today(), FIXTURE_DIALOGUE_ID, lineIndex) });
  const o = opts.find((x) => x.kind === kind);
  if (!o) throw new Error(`line ${lineIndex} has no ${kind} option`);
  return o.text;
}

function mount(mode: 'choose' | 'build' | 'type' | 'speak', extra: { storyId?: string; loader?: typeof loader } = {}) {
  const onDone = vi.fn<(r: RolePlayResult) => void>();
  act(() => render(<RolePlay storyId={extra.storyId ?? FIXTURE_DIALOGUE_ID} mode={mode} onDone={onDone} loader={extra.loader ?? loader} />, root));
  return { onDone };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('<RolePlay>', () => {
  it('meta follows the export convention: role-play, null facet, needsTts', () => {
    expect(meta).toMatchObject({ id: 'role-play', facet: null, keys: 'choices', needsTts: true, needsStt: false, selfGraded: false });
  });

  it('calm states: unknown id, and a narration with no second speaker', async () => {
    installServices({ audio: fakeAudio().audio });
    mount('choose', { storyId: 's-99-9' });
    expect(root.querySelector('.taiwa__state')?.textContent).toBe(S.loading);
    await tick();
    expect(root.querySelector('.taiwa__state--missing')?.textContent).toBe(S.notFound);
    render(null, root);
    mount('choose', { storyId: FIXTURE_STORY_ID });
    expect(root.querySelector('.taiwa__state--missing')?.textContent).toBe(S.notDialogue);
  });

  it('plays the fixture dialogue: NPC lines through slot b, learner prompts, choose grading best / ok / wrong, aizuchi hit and miss, roleplay:done with counts', async () => {
    const today = store.today();
    await setup({ cards: Object.fromEntries(DIALOGUE.vocabIds.map((id) => [cardKey(id, 'prod'), card({ due: today, s: 2, state: 2 })])) });
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const { onDone } = mount('choose');

    expect(phase()).toBe('intro');
    expect(root.textContent).toContain('You play');
    expect(root.querySelector('.taiwa__role strong')?.textContent).toBe('ハナ');
    clickText(S.begin);
    await tick();
    // line 0 (Ken) spoken on slot b, then Hana's first prompt
    expect(calls[0]).toMatchObject({ text: toPlain(L(0).ja), o: { voice: 'b' } });
    expect(phase()).toBe('learner');
    expect(root.querySelector('.taiwa__cue')?.textContent).toBe(`Say: ${L(1).en}`);
    expect(root.querySelectorAll('.taiwa__option')).toHaveLength(3);
    expect(root.querySelector('.taiwa__npc-ja')?.textContent).toBe(toPlain(L(0).ja));

    clickText(optionOfKind(1, 'best'));
    expect(phase()).toBe('feedback');
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    expect(root.querySelector('.taiwa__recast')).toBeNull();
    clickText(S.continue);
    await tick();
    expect(phase()).toBe('learner');
    expect(root.querySelector('.taiwa__npc-ja')?.textContent).toBe(toPlain(L(2).ja));

    clickText(optionOfKind(3, 'ok'));
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.ok);
    expect(root.querySelector('.taiwa__recast .taiwa__model')?.textContent).toBe(toPlain(L(3).ja));
    clickText(S.continue);
    await tick();
    // line 4 carries an aizuchi slot: the NPC waits, chips are up
    expect(phase()).toBe('slot');
    expect(root.querySelectorAll('.taiwa__chip')).toHaveLength(4);
    await tick(600);
    clickText('はい');
    expect(root.querySelector('.taiwa__slot-note')?.textContent).toBe(S.aizuchiHit);
    expect(phase()).toBe('learner');

    clickText(optionOfKind(5, 'register-wrong'));
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.wrong);
    expect(root.querySelector('.taiwa__tags .chip')?.getAttribute('data-tag')).toBe('register');
    clickText(S.continue);
    await tick();
    clickText(optionOfKind(7, 'best'));
    clickText(S.continue);
    await tick();
    clickText(optionOfKind(9, 'grammar-wrong'));
    expect(root.querySelector('.taiwa__tags .chip')?.getAttribute('data-tag')).toBe('word-order');
    clickText(S.continue);
    await tick();
    // line 10: let the window close — the NPC pauses visibly, then continues
    expect(phase()).toBe('slot');
    await tick(windowMs(store.profile.value.belt) + AIZUCHI_PAUSE_MS + 1);
    expect(phase()).toBe('learner');
    expect(root.querySelector('.taiwa__slot-note')?.textContent).toBe(`ケン waited for a nod. Fill the pause next time.`);
    clickText(optionOfKind(11, 'best'));
    clickText(S.continue);
    await tick();

    expect(phase()).toBe('debrief');
    const expected: RolePlayResult = { best: 3, total: 6, aizuchiHit: 1, aizuchiTotal: 2, registerOk: false };
    expect(onDone).toHaveBeenCalledWith(expected);
    const ev = cap.events.filter(([n]) => n === 'roleplay:done');
    cap.stop();
    expect(ev).toHaveLength(1);
    expect(ev[0]?.[1]).toEqual({ storyId: FIXTURE_DIALOGUE_ID, ...expected });
    expect(root.textContent).toContain('3 of 6 lines at their best');
    expect(root.textContent).toContain('1 of 2 backchannels on time');
    expect(root.textContent).toContain(S.registerSlipOne);
    expect(root.querySelectorAll('.taiwa__correction')).toHaveLength(3);
    // standalone: implicit prod grades were written (Good on おはよう, Again on 食べる)
    expect(store.cards.get(cardKey(V.おはよう, 'prod'))?.[3]).toBe(1);
    expect(store.cards.get(cardKey(V.食べる, 'prod'))?.[4]).toBe(1);
    // the white belt never tags a missed slot
    expect(root.querySelector('.taiwa__slots .chip[data-hit="false"]')?.textContent).toContain(S.slotMissed);
  });

  it('type mode: typed lines are matched against ja ∪ accept; a casual, incomplete answer is recast with word-choice + register', async () => {
    installServices({ audio: fakeAudio().audio });
    mount('type');
    clickText(S.begin);
    await tick();
    const input = () => root.querySelector('input') as HTMLInputElement;
    type(input(), 'ohayoukenn');
    expect(input().value).toBe('おはようけん');
    enter(input());
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    clickText(S.continue);
    await tick();
    type(input(), 'unnnomu');
    clickText(S.submit);
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.wrong);
    expect(root.querySelector('.taiwa__recast .taiwa__model')?.textContent).toBe(toPlain(L(3).ja));
    expect(Array.from(root.querySelectorAll('.taiwa__tags .chip')).map((c) => c.getAttribute('data-tag'))).toEqual(['word-choice', 'register']);
    clickText(S.continue);
    await tick();
    await tick(200);
    clickText('はい');
    // the accept[] surface is best too; a hint before it caps the line at ok
    clickText(S.hint);
    expect(root.querySelector('.taiwa__hint-box')?.textContent).toContain('パン、食べます');
    type(input(), 'watashimotabemasu');
    enter(input());
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.ok);
  });

  it('build mode: tiles never show the gold order; the gold order is best, another order is word-order', async () => {
    installServices({ audio: fakeAudio().audio });
    mount('build');
    clickText(S.begin);
    await tick();
    const tiles = () => Array.from(root.querySelectorAll('.taiwa__tiles .taiwa__tile')).map((b) => b.textContent?.replace(/^\d/, ''));
    expect(tiles()).toEqual(['ケン', 'おはよう']);
    clickText(S.submit);
    expect(root.querySelector('.taiwa__note')?.textContent).toBe(S.nothingBuilt);
    clickText('おはよう');
    clickText('ケン');
    expect(root.querySelector('.taiwa__built')?.textContent).toBe('おはようケン');
    clickText(S.submit);
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    clickText(S.continue);
    await tick();
    expect(tiles()).toEqual(['飲みます', 'はい']);
    clickText('飲みます');
    clickText('はい');
    clickText(S.submit);
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.wrong);
    expect(root.querySelector('.taiwa__tags .chip')?.getAttribute('data-tag')).toBe('word-order');
  });

  it('speak mode names a typed recognizer failure (microphone blocked) in place of "nothing heard"', async () => {
    const stt = { ...fakeStt(null), state: signal<'denied'>('denied') };
    installServices({ audio: fakeAudio().audio, stt });
    mount('speak');
    clickText(S.begin);
    await tick();
    clickText(S.speak);
    await tick();
    expect(root.querySelector('.taiwa__note')?.textContent).toBe(STT_STATE_LABEL.denied);
    expect(root.textContent).not.toContain(S.nothingHeard);
    expect(buttonByText(S.typeInstead)).toBeDefined();
  });

  it('speak mode: recognition is scored best-of-alternatives; nothing heard offers a retry or typing; no recognizer → Type mode with a notice', async () => {
    installServices({ audio: fakeAudio().audio, stt: fakeStt(['おはよう、けん。', 'おはよう']) });
    mount('speak');
    expect(root.textContent).toContain('Mode: Speak');
    clickText(S.begin);
    await tick();
    clickText(S.speak);
    await tick();
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    expect(root.textContent).toContain('Heard: おはよう、けん。');
    render(null, root);

    installServices({ stt: fakeStt(null) });
    mount('speak');
    clickText(S.begin);
    await tick();
    clickText(S.speak);
    await tick();
    expect(root.querySelector('.taiwa__note')?.textContent).toBe(S.nothingHeard);
    expect(buttonByText(S.tryAgain)).toBeDefined();
    clickText(S.typeInstead);
    expect(root.querySelector('input')).not.toBeNull();
    render(null, root);

    installServices({ stt: nullStt });
    mount('speak');
    expect(root.textContent).toContain('Mode: Type');
    expect(root.querySelector('.taiwa__notice')?.textContent).toBe(S.speakUnavailable);
  });

  it('register switching: a registerTarget on an NPC line re-targets the next learner lines and shows the shift', async () => {
    const switched: StoryItem = { ...DIALOGUE, lines: DIALOGUE.lines.map((l, i) => (i === 2 ? { ...l, registerTarget: 'casual' } : l)) };
    const custom = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [FIXTURE_DIALOGUE_ID]: switched } });
    installServices({ audio: fakeAudio().audio });
    mount('type', { loader: custom });
    clickText(S.begin);
    await tick();
    const input = () => root.querySelector('input') as HTMLInputElement;
    type(input(), 'ohayouken');
    enter(input());
    clickText(S.continue);
    await tick();
    expect(root.textContent).toContain('Register shift: casual');
    expect(root.textContent).toContain('Register: casual');
    type(input(), 'hainomimasu');
    enter(input());
    // the gold line itself is still best (verbatim wins); a polite non-verbatim line slips register
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    clickText(S.continue);
    await tick();
    await tick(100);
    // a casual target offers the casual backchannel set
    expect(Array.from(root.querySelectorAll('.taiwa__chip')).map((c) => c.textContent?.replace(/^\d/, ''))).toEqual(['うん', 'へー', 'へえ', 'そっか']);
    clickText('うん');
    type(input(), 'hai,panwotabemasu');
    enter(input());
    expect(Array.from(root.querySelectorAll('.taiwa__tags .chip')).map((c) => c.getAttribute('data-tag'))).toEqual(['register']);
  });

  it('as an exercise it reads params, tags a missed slot from Green, reports once through onResult and never writes cards itself', async () => {
    await setup({ save: { profile: { belt: 'green' }, progress: { station: 16 } } });
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const onResult = vi.fn<(r: AttemptResult) => void>();
    const onReplay = vi.fn();
    const step: Step = {
      id: 'rp-1',
      block: 'output',
      exercise: 'role-play',
      itemId: FIXTURE_DIALOGUE_ID,
      cardKey: null,
      params: { storyId: FIXTURE_DIALOGUE_ID, mode: 'choose', rate: 1 },
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 0,
      estMs: 180000,
    };
    const props: ExerciseProps = {
      step,
      item: DIALOGUE,
      feel: 'dojo',
      furigana: 'off',
      jj: false,
      speedTier: 3,
      exposures: 0,
      onResult,
      onHint: () => undefined,
      onReplay,
      requestJudge: () => Promise.resolve(true),
    };
    act(() => render(<RolePlay {...props} />, root));
    clickText(S.begin);
    await tick();
    expect(calls[0]?.o?.rate).toBe(1);
    clickText(S.replayLine);
    await tick();
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    for (const i of [1, 3]) {
      clickText(optionOfKind(i, 'best'));
      clickText(S.continue);
      await tick();
    }
    expect(phase()).toBe('slot');
    await tick(windowMs('green') + AIZUCHI_PAUSE_MS + 1);
    for (const i of [5, 7, 9]) {
      clickText(optionOfKind(i, 'best'));
      clickText(S.continue);
      await tick();
    }
    expect(phase()).toBe('slot');
    clickText('はい');
    clickText(optionOfKind(11, 'best'));
    clickText(S.continue);
    await tick();
    cap.stop();
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: true, nearMiss: false, hintUsed: false, guard: false, score: 1, errorTags: ['aizuchi'] });
    expect(Array.isArray(r.implicit)).toBe(true);
    expect(cap.events.filter(([n]) => n === 'roleplay:done')).toHaveLength(1);
    expect(cap.events[cap.events.length - 1]?.[1]).toMatchObject({ best: 6, total: 6, aizuchiHit: 1, aizuchiTotal: 2, registerOk: true });
    expect(cap.events.some(([n]) => n === 'attempt:graded')).toBe(false);
    expect(store.cards.count()).toBe(0);
  });
});
