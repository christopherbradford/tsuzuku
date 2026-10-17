import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_DIALOGUE_ID, V, createFakeLoader } from '@/content/fixtures';
import { toPlain } from '@/content/ruby';
import type { StoryItem, StoryLine } from '@/content/types';
import { SPEED_TIER_RATES, installServices, nullAudio, resetServices, type AudioService, type SpeakOptions } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { cardKey } from '@/shared/ids';
import { normalizeJa } from '@/shared/jp';
import type { AttemptResult, Step } from '@/shared/session-types';
import { store } from '@/store';
import { captureEvents, card, makeTestStore } from '@/store/testing';
import {
  ListeningArena,
  REPLAY_BUDGET,
  SET_MAX,
  buildListeningSet,
  gradeDictation,
  implicitListenGrades,
  meta,
  relistenRate,
  voiceSlots,
  type ListenItem,
} from './ListeningArena';
import { S } from './strings';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const loader = createFakeLoader();

interface SpeakCall {
  text: string;
  o?: SpeakOptions;
}

function fakeAudio(hasVoice = true): { audio: AudioService; calls: SpeakCall[] } {
  const calls: SpeakCall[] = [];
  const audio: AudioService = {
    ...nullAudio,
    muted: signal(false),
    hasJaVoice: signal(hasVoice),
    speak: (text, o) => {
      calls.push({ text, o });
      return Promise.resolve();
    },
    cancel: vi.fn(),
  };
  return { audio, calls };
}

let root: HTMLDivElement;
beforeEach(async () => {
  await makeTestStore({ save: { settings: { furigana: 'off' } } });
  bus.reset();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

/** Lets every awaited `speak()` in a playback chain settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function click(sel: string): void {
  const el = root.querySelector(sel) as HTMLButtonElement | null;
  if (!el) throw new Error(`no element ${sel}`);
  act(() => el.click());
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
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

function expectedItems(): ListenItem[] {
  return buildListeningSet(DIALOGUE, { rng: rngFor(store.seed(), store.today(), DIALOGUE.id), station: store.progress.value.station });
}

function mountStandalone(rate = 0.9) {
  const onDone = vi.fn();
  act(() => render(<ListeningArena storyId={FIXTURE_DIALOGUE_ID} rate={rate} onDone={onDone} loader={loader} />, root));
  return { onDone };
}

/** Answers every item correctly (gist / choice by index, dictation by typing the kana). */
async function answerAll(items: ListenItem[], o: { wrongAt?: number } = {}): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await flush();
    const item = items[i] as ListenItem;
    expect(root.querySelector('.arena__progress')?.textContent).toBe(`Question ${i + 1} of ${items.length}`);
    if (item.kind === 'dictation') {
      const line = DIALOGUE.lines[item.lineIndex] as StoryLine;
      const input = root.querySelector('input') as HTMLInputElement;
      type(input, o.wrongAt === i ? 'あいうえおかきくけこ' : normalizeJa(line.kana));
      enter(input);
    } else {
      const answer = item.kind === 'gist' ? item.q.answer : item.answer;
      const pick = o.wrongAt === i ? (answer + 1) % 4 : answer;
      click(`.arena__choice[aria-keyshortcuts="${pick + 1}"]`);
    }
    expect(root.querySelector('.feedback')).not.toBeNull();
    click('.arena__feedback .hanko');
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

describe('listening set helpers', () => {
  it('meta follows the export convention: listening-set, null facet, choices, needsTts', () => {
    expect(meta).toMatchObject({ id: 'listening-set', facet: null, keys: 'choices', needsTts: true, needsStt: false, selfGraded: false });
  });

  it('voice slots alternate by first appearance; unlabelled lines use a', () => {
    const slots = voiceSlots(DIALOGUE.lines);
    expect(slots.get('ケン')).toBe('a');
    expect(slots.get('ハナ')).toBe('b');
    expect(voiceSlots([{ ja: 'a', kana: 'a', en: '', tokens: ['a'] }]).get('')).toBe('a');
  });

  it('relistenRate adds 0.1 without float noise', () => {
    expect(relistenRate(0.9)).toBe(1);
    expect(relistenRate(1.1)).toBe(1.2);
    expect(relistenRate(1.25)).toBe(1.35);
  });

  it('buildListeningSet: gist first, 5–8 items, choices of 4 with a right index, deterministic', () => {
    const a = expectedItems();
    const b = expectedItems();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(a.length).toBeLessThanOrEqual(SET_MAX);
    expect(a.slice(0, 3).every((i) => i.kind === 'gist')).toBe(true);
    expect(a.slice(3).every((i) => i.kind !== 'gist')).toBe(true);
    for (const item of a) {
      if (item.kind !== 'choice') continue;
      expect(item.choices).toHaveLength(4);
      expect(new Set(item.choices).size).toBe(4);
      expect(item.ja).toBe(false);
      expect(item.choices[item.answer]).toBe((DIALOGUE.lines[item.lineIndex] as StoryLine).en);
    }
    const other = buildListeningSet(DIALOGUE, { rng: rngFor('other-seed'), station: 4 });
    expect(other.length).toBeGreaterThanOrEqual(5);
  });

  it('from Green the choice items carry the Japanese line itself', () => {
    const items = buildListeningSet(DIALOGUE, { rng: rngFor('x'), station: 16 });
    const choice = items.find((i) => i.kind === 'choice');
    expect(choice).toBeDefined();
    if (choice && choice.kind === 'choice') {
      expect(choice.ja).toBe(true);
      expect(choice.choices[choice.answer]).toBe((DIALOGUE.lines[choice.lineIndex] as StoryLine).ja);
    }
  });

  it('gradeDictation: exact → Good, a small-kana slip → Hard (Block), noise → Again with the listening tag', () => {
    const line = DIALOGUE.lines[3] as StoryLine; // はい、のみます。
    expect(gradeDictation('はいのみます', line)).toMatchObject({ rating: 3, correct: true, tags: [] });
    expect(gradeDictation('はい、飲みます。', line).score).toBeLessThan(1); // kanji is not the kana surface
    const slip = gradeDictation('はいのみまっす', line);
    expect(slip.rating).toBe(2);
    expect(slip.tags).toEqual(['small-kana']);
    const miss = gradeDictation('あいうえおかきくけこ', line);
    expect(miss.rating).toBe(1);
    expect(miss.correct).toBe(false);
    expect(miss.tags).toEqual(['listening']);
    expect(miss.diff.length).toBeGreaterThan(0);
  });

  it('implicitListenGrades: due listen cards get Good when the word was heard, Again when not; others skipped', async () => {
    const today = store.today();
    await makeTestStore({
      cards: {
        [cardKey(V.飲む, 'listen')]: card({ due: today, s: 3, state: 2 }),
        [cardKey(V.はい, 'listen')]: card({ due: today + 1, s: 3, state: 2 }),
        [cardKey(V.水, 'listen')]: card({ due: today + 10, s: 30, state: 2 }),
      },
    });
    const line = DIALOGUE.lines[11] as StoryLine; // 私も水を飲みます。 (私 has no listen card here)
    const got = implicitListenGrades(line, 'わたしものみます', (id) => loader.get(id), store.cards, store.today());
    expect(got).toEqual([{ cardKey: cardKey(V.飲む, 'listen'), rating: 3 }]);
    const missed = implicitListenGrades(line, 'わたしもみずを', (id) => loader.get(id), store.cards, store.today());
    expect(missed).toEqual([{ cardKey: cardKey(V.飲む, 'listen'), rating: 1 }]);
    const aizuchiLine = DIALOGUE.lines[3] as StoryLine; // はい、のみます。
    const two = implicitListenGrades(aizuchiLine, 'はいのみます', (id) => loader.get(id), store.cards, store.today());
    expect(two.map((g) => g.cardKey).sort()).toEqual([cardKey(V.はい, 'listen'), cardKey(V.飲む, 'listen')].sort());
    expect(implicitListenGrades({ ...line, tokenIds: undefined }, 'x', (id) => loader.get(id), store.cards, store.today())).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('<ListeningArena>', () => {
  it('shows a loading line, then a calm state for an unknown set', async () => {
    installServices({ audio: fakeAudio().audio });
    act(() => render(<ListeningArena storyId="s-99-9" rate={1} onDone={vi.fn()} loader={loader} />, root));
    expect(root.querySelector('.arena__state')?.textContent).toBe(S.loading);
    await flush();
    expect(root.querySelector('.arena__state--missing')?.textContent).toBe(S.notFound);
  });

  it('keeps the text hidden until every question is answered, then reveals the transcript', async () => {
    const { audio } = fakeAudio();
    installServices({ audio });
    mountStandalone();
    const plains = DIALOGUE.lines.map((l) => toPlain(l.ja));
    const hidden = (): boolean => plains.every((t) => !(root.textContent ?? '').includes(t));
    expect(root.getAttribute('data-phase')).toBeNull();
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('listen');
    expect(hidden()).toBe(true);
    expect(root.querySelector('.arena__transcript')).toBeNull();
    // the Questions button waits for the first full listen
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.includes(S.toQuestions))).toBe(false);
    click('.hanko');
    await flush();
    expect(hidden()).toBe(true);
    act(() => buttonByText(S.toQuestions).click());
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('questions');
    await flush();
    // the first items are gist questions: still no line text anywhere
    expect(hidden()).toBe(true);
    const items = expectedItems();
    await answerAll(items);
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('transcript');
    expect(root.querySelector('.arena__transcript')).not.toBeNull();
    for (const t of plains) expect(root.textContent).toContain(t);
    expect(root.querySelectorAll('.arena__transcript .arena__line')).toHaveLength(DIALOGUE.lines.length);
  });

  it('speakers alternate voice slots a / b through the whole listen, at the given rate', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    mountStandalone(0.9);
    click('.hanko');
    await flush();
    expect(calls).toHaveLength(DIALOGUE.lines.length);
    calls.forEach((c, i) => {
      expect(c.text).toBe(toPlain((DIALOGUE.lines[i] as StoryLine).ja));
      expect(c.o?.voice).toBe(i % 2 === 0 ? 'a' : 'b');
      expect(c.o?.rate).toBe(0.9);
    });
    expect(calls[0]?.o?.interrupt).toBe(true);
    expect(calls[1]?.o?.interrupt).toBe(false);
  });

  it('full-listen replays are budgeted at 2; the button then locks honestly', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    mountStandalone();
    click('.hanko');
    await flush();
    const n = DIALOGUE.lines.length;
    for (let k = 1; k <= REPLAY_BUDGET; k++) {
      const btn = buttonByText(S.replay);
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toContain(`${REPLAY_BUDGET - k + 1} replays left`);
      act(() => btn.click());
      await flush();
      expect(calls).toHaveLength(n * (k + 1));
    }
    const btn = buttonByText(S.replay);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain(S.noReplaysLeft);
  });

  it('re-listens at +0.1× with karaoke highlight before Finish unlocks, then emits listening:set and calls onDone', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const { onDone } = mountStandalone(0.9);
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    const items = expectedItems();
    await answerAll(items, { wrongAt: 0 });
    const finish = buttonByText(S.finish);
    expect(finish.disabled).toBe(true);
    const before = calls.length;
    act(() => buttonByText('Listen again at 1×').click());
    // the chain is running: the first line is highlighted before the fake speak resolves it
    const relistenCalls = (): SpeakCall[] => calls.slice(before);
    await flush();
    expect(relistenCalls()).toHaveLength(DIALOGUE.lines.length);
    for (const c of relistenCalls()) expect(c.o?.rate).toBe(1);
    expect(root.querySelector('.arena__hint')?.textContent).toBe(S.relistenDone);
    expect(root.querySelector('[data-speaking="true"]')).toBeNull();
    const finish2 = buttonByText(S.finish);
    expect(finish2.disabled).toBe(false);
    act(() => finish2.click());
    const ev = cap.events.find(([n]) => n === 'listening:set');
    cap.stop();
    expect(ev).toBeDefined();
    expect(ev?.[1]).toMatchObject({ storyId: FIXTURE_DIALOGUE_ID, correct: items.length - 1, total: items.length, rate: 0.9 });
    expect((ev?.[1] as { minutes: number }).minutes).toBeGreaterThanOrEqual(0);
    expect(onDone).toHaveBeenCalledWith({ correct: items.length - 1, total: items.length });
    expect(root.querySelector('.arena__result-line')?.textContent).toBe(`${items.length - 1} of ${items.length} right at 0.9×`);
    // one miss: no tier offer
    expect(root.querySelector('.arena__tier')).toBeNull();
  });

  it('a clean set at the tier rate offers the next tier; accepting patches settings.speedTier', async () => {
    const { audio } = fakeAudio();
    installServices({ audio });
    const tier = store.settings.value.speedTier;
    mountStandalone(SPEED_TIER_RATES[tier]);
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(expectedItems());
    act(() => buttonByText('Listen again at').click());
    await flush();
    act(() => buttonByText(S.finish).click());
    expect(root.querySelector('.arena__tier')).not.toBeNull();
    act(() => buttonByText(`Tier ${tier + 1} from now`).click());
    expect(store.settings.value.speedTier).toBe(tier + 1);
    expect(root.querySelector('.arena__tier')).toBeNull();
    expect(root.textContent).toContain(`Tier ${tier + 1}.`);
  });

  it('without a Japanese voice it says so, shows the lines as text and lets Finish through without a re-listen', async () => {
    installServices({ audio: fakeAudio(false).audio });
    mountStandalone();
    expect(root.querySelector('.arena__notice')?.textContent).toBe(S.noVoice);
    expect(root.querySelectorAll('.arena__lines .arena__line')).toHaveLength(DIALOGUE.lines.length);
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(expectedItems());
    const finish = buttonByText(S.finish);
    expect(finish.disabled).toBe(false);
    act(() => finish.click());
    expect(root.querySelector('.arena__result')).not.toBeNull();
  });

  it('with a voice but the master volume at 0 (canSpeak false) it shows the lines as text with the volume notice instead of a silent Play', async () => {
    const { audio, calls } = fakeAudio(true);
    installServices({ audio: { ...audio, canSpeak: signal(false) } as AudioService });
    mountStandalone();
    expect(root.querySelector('.arena__notice')?.textContent).toBe(S.volumeOff);
    expect(root.querySelectorAll('.arena__lines .arena__line')).toHaveLength(DIALOGUE.lines.length);
    expect(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === S.play)).toBeUndefined();
    act(() => buttonByText(S.toQuestions).click());
    expect(calls).toEqual([]);
    await answerAll(expectedItems());
    expect(buttonByText(S.finish).disabled).toBe(false);
  });

  it('as an exercise it reads params.storyId / rate, reports once through onResult with implicit listen grades, and never writes cards itself', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off' } },
      cards: Object.fromEntries(DIALOGUE.vocabIds.map((id) => [cardKey(id, 'listen'), card({ due: today, s: 2, state: 2 })])),
    });
    const { audio } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const onResult = vi.fn<(r: AttemptResult) => void>();
    const onReplay = vi.fn();
    const step: Step = {
      id: 'ls-1',
      block: 'input',
      exercise: 'listening-set',
      itemId: FIXTURE_DIALOGUE_ID,
      cardKey: null,
      params: { storyId: FIXTURE_DIALOGUE_ID, rate: 1.1 },
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 0,
      estMs: 300000,
    };
    const props: ExerciseProps = {
      step,
      item: DIALOGUE,
      feel: 'dojo',
      furigana: 'off',
      jj: false,
      speedTier: 2,
      exposures: 0,
      onResult,
      onHint: () => undefined,
      onReplay,
      requestJudge: () => Promise.resolve(true),
    };
    act(() => render(<ListeningArena {...props} />, root));
    expect(root.textContent).toContain('Speed 1.1×');
    click('.hanko');
    await flush();
    act(() => buttonByText(S.replay).click());
    await flush();
    expect(onReplay).toHaveBeenCalledTimes(1);
    act(() => buttonByText(S.toQuestions).click());
    const items = expectedItems();
    await answerAll(items);
    act(() => buttonByText('Listen again at 1.2×').click());
    await flush();
    act(() => buttonByText(S.finish).click());
    cap.stop();
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: true, nearMiss: false, guard: false, hintUsed: false, timedOut: false, score: 1, replays: 1, errorTags: [] });
    const dictations = items.filter((i) => i.kind === 'dictation');
    if (dictations.length > 0) {
      expect(r.implicit?.length ?? 0).toBeGreaterThan(0);
      expect(r.implicit?.every((g) => g.rating === 3 && g.cardKey.endsWith('#listen'))).toBe(true);
    }
    // the card itself is untouched: the runner applies `implicit`
    const first = r.implicit?.[0];
    if (first) expect(store.cards.get(first.cardKey)?.[3]).toBe(0);
    expect(cap.events.filter(([n]) => n === 'listening:set')).toHaveLength(1);
    expect(cap.events.some(([n]) => n === 'attempt:graded')).toBe(false);
  });

  it('standalone, a correct dictation writes Good on a due listen card through recordImplicit', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off' } },
      cards: Object.fromEntries(DIALOGUE.vocabIds.map((id) => [cardKey(id, 'listen'), card({ due: today, s: 2, state: 2 })])),
    });
    const items = expectedItems();
    const dictation = items.find((i): i is Extract<ListenItem, { kind: 'dictation' }> => i.kind === 'dictation');
    if (!dictation) return; // the seeded set has no dictation line: nothing to assert
    const line = DIALOGUE.lines[dictation.lineIndex] as StoryLine;
    const ids = (line.tokenIds ?? []).filter((id): id is string => !!id && id.startsWith('v-'));
    expect(ids.length).toBeGreaterThan(0);
    const { audio } = fakeAudio();
    installServices({ audio });
    mountStandalone();
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(items);
    act(() => buttonByText('Listen again at').click());
    await flush();
    act(() => buttonByText(S.finish).click());
    const graded = ids.map((id) => store.cards.get(cardKey(id, 'listen'))).filter((c): c is NonNullable<typeof c> => !!c);
    expect(graded.some((c) => c[3] >= 1)).toBe(true);
  });
});

describe('profile.dictatedSentence (the Waveform kakejiku text)', () => {
  function dictationAt(items: ListenItem[]): { index: number; line: StoryLine } {
    const index = items.findIndex((i) => i.kind === 'dictation');
    expect(index).toBeGreaterThanOrEqual(0); // the seeded fixture set carries one
    const item = items[index] as Extract<ListenItem, { kind: 'dictation' }>;
    return { index, line: DIALOGUE.lines[item.lineIndex] as StoryLine };
  }
  async function runSet(rate: number, o: { wrongAt?: number } = {}): Promise<void> {
    const { audio } = fakeAudio();
    installServices({ audio });
    mountStandalone(rate);
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(expectedItems(), o);
  }

  it('a perfect dictation at 1× writes the plain surface (no ruby markup); the newest replaces the previous one', async () => {
    act(() => store.patch('profile', (p) => ({ ...p, dictatedSentence: '前の文。' })));
    const { line } = dictationAt(expectedItems());
    expect(line.ja).toMatch(/\{/); // the fixture line carries ruby, so plain ≠ ja
    await runSet(1);
    const s = store.profile.value.dictatedSentence;
    expect(typeof s).toBe('string');
    expect(s).toBe(toPlain(line.ja));
    expect(s).not.toMatch(/[{}|]/);
  });

  it('a partial dictation leaves it untouched', async () => {
    const { index } = dictationAt(expectedItems());
    await runSet(1, { wrongAt: index });
    expect(store.profile.value.dictatedSentence).toBeUndefined();
  });

  it('a perfect dictation at a slowed rate (< 1×) does not count', async () => {
    await runSet(0.9);
    expect(store.profile.value.dictatedSentence).toBeUndefined();
  });
});
