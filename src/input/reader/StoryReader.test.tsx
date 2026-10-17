import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ContentLoader } from '@/content/loader';

/** The live `content` singleton delegates to whatever loader a test installs (fixture loader by default). */
const H = vi.hoisted(() => ({ loader: null as unknown }));
vi.mock('@/content/loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/loader')>();
  const content = new Proxy(orig.content, {
    get(target, key) {
      const l = (H.loader as Record<PropertyKey, unknown> | null) ?? (target as unknown as Record<PropertyKey, unknown>);
      const v = l[key as string];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(l) : v;
    },
  });
  return { ...orig, content };
});

import { FIXTURE, FIXTURE_STORY_ID, V, createFakeLoader } from '@/content/fixtures';
import type { StoryItem } from '@/content/types';
import { installServices, nullAudio, resetServices, type AudioService } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { CardFlag } from '@/shared/store-types';
import { store } from '@/store';
import { captureEvents, card, makeTestStore } from '@/store/testing';
import { StoryReader, StoryReaderView, isDictionaryFree, kaidenEvidence, meta, speakerSlots, storyStation, toAttemptResult, type StoryReadResult } from './StoryReader';
import { S } from './strings';

const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const ANSWERS = STORY.comprehension.map((qq) => qq.choices[qq.answer]);

let root: HTMLDivElement;
let clock = 1_000_000;
let loader: ContentLoader;
let spoken: [string, unknown][];

beforeEach(async () => {
  clock = 1_000_000;
  loader = createFakeLoader();
  H.loader = loader;
  spoken = [];
  const audio: AudioService = { ...nullAudio, speak: (t, o) => ((spoken.push([t, o]), Promise.resolve())) };
  installServices({ audio });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  bus.reset();
});

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const qa = (sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null | undefined): void => {
  act(() => (el as HTMLElement | null)?.click());
};

async function makeStore(o: Parameters<typeof makeTestStore>[0] = {}): Promise<void> {
  await makeTestStore({ now: () => clock, save: { progress: { station: 4 } }, ...o });
}

function mount(over: Partial<Parameters<typeof StoryReaderView>[0]> = {}): ReturnType<typeof vi.fn<(r: StoryReadResult) => void>> {
  const onDone = vi.fn<(r: StoryReadResult) => void>();
  act(() => render(<StoryReaderView storyId={FIXTURE_STORY_ID} loader={loader} furigana="always" onDone={onDone} {...over} />, root));
  return onDone;
}

/** Token span for `token` inside line `li` (the line must be revealed). */
function tokenEl(li: number, token: string): HTMLElement | undefined {
  const line = STORY.lines[li] as StoryItem['lines'][number];
  const ti = line.tokens.indexOf(token);
  return q(`li[data-line="${li}"] .ruby__token[data-token="${ti}"]`) ?? undefined;
}

function revealAll(): void {
  click(q('[data-action="show-rest"]'));
}

/** Answers every question correctly (choices may be shuffled). */
function answerAll(wrongAt: number[] = []): void {
  for (let i = 0; i < STORY.comprehension.length; i++) {
    const buttons = qa('[data-choice]');
    const want = ANSWERS[i] as string;
    const target = wrongAt.includes(i) ? buttons.find((b) => !b.textContent?.includes(want)) : buttons.find((b) => b.textContent?.includes(want));
    click(target);
    click(q('[data-action="advance"]'));
  }
}

function finishRead(wrongAt: number[] = []): void {
  revealAll();
  click(q('[data-action="next"]')); // → questions
  answerAll(wrongAt);
}

describe('StoryReader helpers', () => {
  it('meta registers story-read with no facet and no keys', () => {
    expect(meta).toEqual({ id: 'story-read', facet: null, needsTts: false, needsStt: false, selfGraded: false, timeable: false, keys: 'none' });
  });

  it('storyStation reads the id', () => {
    expect(storyStation('s-04-1')).toBe(4);
    expect(storyStation('s-27-3')).toBe(27);
    expect(storyStation('v-n5-0001')).toBeUndefined();
  });

  it('isDictionaryFree needs ≥ 300 chars, ≥ 2/3 and ≤ 2 taps', () => {
    expect(isDictionaryFree(300, 2, 3, 2)).toBe(true);
    expect(isDictionaryFree(299, 3, 3, 0)).toBe(false);
    expect(isDictionaryFree(400, 1, 3, 0)).toBe(false);
    expect(isDictionaryFree(400, 3, 3, 3)).toBe(false);
  });

  it('speakerSlots alternates a/b by first appearance', () => {
    const slots = speakerSlots([{ speaker: 'ケン' }, { speaker: 'ハナ' }, { speaker: 'ケン' }].map((s) => ({ ...s, ja: '', kana: '', en: '', tokens: [] })));
    expect(slots.get('ケン')).toBe('a');
    expect(slots.get('ハナ')).toBe('b');
    expect(speakerSlots(STORY.lines).size).toBe(0);
  });

  it('toAttemptResult: passed → correct, missing → ungraded correct, hints → hintUsed', () => {
    const base: StoryReadResult = { storyId: 's', correct: 2, total: 3, passed: true, cpm: 100, band: 'at', chars: 100, ms: 60_000, minutes: 1, glossTaps: 0, hints: 0, dictionaryFree: false, kaidenConfirmed: [], ledgerLogged: false, bridge: false, missing: false };
    expect(toAttemptResult(base)).toMatchObject({ correct: true, hintUsed: false, ms: 60_000, score: 2 / 3, errorTags: [] });
    expect(toAttemptResult({ ...base, passed: false, correct: 1, hints: 2 })).toMatchObject({ correct: false, hintUsed: true });
    expect(toAttemptResult({ ...base, missing: true, total: 0, correct: 0 })).toMatchObject({ correct: true, score: 0 });
  });

  it('kaidenEvidence lists Kaiden base cards of untapped words only', () => {
    const cards = {
      byItem: (id: string) => {
        if (id === V.パン) return { rec: card({ flags: CardFlag.kaiden, s: 200 }) };
        if (id === V.犬) return { rec: card({ flags: CardFlag.kaiden, s: 200 }) };
        if (id === V.水) return { rec: card({ s: 20 }) };
        if (id === V.おはよう) return { prod: card({ flags: CardFlag.kaiden, s: 200 }) };
        return {};
      },
    };
    expect(kaidenEvidence(STORY, new Set([V.犬]), cards)).toEqual([`${V.おはよう}#prod`, `${V.パン}#rec`]);
    expect(kaidenEvidence(STORY, new Set(), cards)).toContain(`${V.犬}#rec`);
  });
});

describe('<StoryReaderView>', () => {
  it('renders the fixture story: title, chips, one line first, every line after "Show the rest"', async () => {
    await makeStore();
    mount();
    expect(q('.reader__title')?.getAttribute('lang')).toBe('ja');
    expect(q('.reader__title')?.textContent).toContain('水');
    expect(q('.reader__title-en')?.textContent).toBe(STORY.titleEn);
    expect(q('[data-field="coverage"]')).not.toBeNull();
    expect(qa('li[data-line]').length).toBe(1);
    expect(q('[data-field="progress"]')?.textContent).toBe('Line 1 of 12');
    click(q('[data-action="next"]'));
    expect(qa('li[data-line]').length).toBe(2);
    expect(q('li[data-line="1"]')?.getAttribute('data-current')).toBe('true');
    revealAll();
    expect(qa('li[data-line]').length).toBe(STORY.lines.length);
    expect(q('[data-action="show-rest"]')).toBeNull();
    expect(q('[data-action="next"]')?.textContent).toBe(S.finishReading);
    // every line's Japanese carries lang="ja" and ruby
    expect(qa('li[data-line] .reader__ja[lang="ja"]').length).toBe(STORY.lines.length);
    expect(qa('li[data-line] .ruby__token').length).toBeGreaterThan(20);
  });

  it('tapping a token opens the Gloss with the item and counts a gloss tap', async () => {
    await makeStore();
    const onDone = mount();
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(q('[data-field="meanings"]')?.textContent).toContain('I');
    expect(q('[data-field="reading"]')?.textContent).toBe('わたし');
    // unknown word (no cards) → Capture offered
    expect(q('[data-action="capture"]')).not.toBeNull();
    click(q('[data-action="close"]'));
    expect(q('[role="dialog"]')).toBeNull();
    expect(tokenEl(1, '私')?.getAttribute('data-tapped')).toBe('true');
    finishRead();
    expect(onDone.mock.calls[0]?.[0].glossTaps).toBe(1);
  });

  it('punctuation tokens never open a gloss', async () => {
    await makeStore();
    mount();
    click(tokenEl(0, '。'));
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('finishing emits story:read with cpm > 0, chars, correct/total and calls onDone once', async () => {
    await makeStore();
    const cap = captureEvents();
    const onDone = mount();
    clock += 120_000; // two minutes of reading
    finishRead([1]);
    cap.stop();
    const ev = cap.events.find(([n]) => n === 'story:read');
    expect(ev).toBeDefined();
    const p = ev?.[1] as { storyId: string; mode: string; chars: number; cpm: number; correct: number; total: number; glossTaps: number; minutes: number; bridge: boolean };
    expect(p.storyId).toBe(FIXTURE_STORY_ID);
    expect(p.mode).toBe('read');
    expect(p.chars).toBeGreaterThan(50);
    expect(p.cpm).toBeGreaterThan(0);
    expect(p.cpm).toBe(Math.round((p.chars / 120_000) * 60_000));
    expect(p.correct).toBe(2);
    expect(p.total).toBe(3);
    expect(p.glossTaps).toBe(0);
    expect(p.minutes).toBe(2);
    expect(p.bridge).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.passed).toBe(true);
    expect(r.ledgerLogged).toBe(false); // no reducers in this store
    expect(r.dictionaryFree).toBe(false); // the fixture is short
    expect(r.missing).toBe(false);
  });

  it('with B reducers wired the minutes land in the ledger exactly once (ledgerLogged)', async () => {
    await makeStore({ reducers: true });
    const onDone = mount();
    clock += 180_000;
    finishRead();
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.ledgerLogged).toBe(true);
    expect(store.ledger.value.entries.length).toBe(1);
    expect(store.ledger.value.entries[0]?.[1]).toBe(3);
  });

  it('under 2/3 is not passed and carries no Kaiden evidence', async () => {
    await makeStore({ cards: { [`${V.パン}#rec`]: card({ flags: CardFlag.kaiden, s: 200, state: 2, due: 10_000 }) } });
    const onDone = mount();
    finishRead([0, 1]);
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.correct).toBe(1);
    expect(r.passed).toBe(false);
    expect(r.kaidenConfirmed).toEqual([]);
  });

  it('Kaiden words read without a tap log an implicit Good on pass; a tapped one does not', async () => {
    const today = store.today();
    await makeStore({
      cards: {
        [`${V.パン}#rec`]: card({ flags: CardFlag.kaiden, s: 200, state: 2, due: 50_000, last: 1 }),
        [`${V.犬}#rec`]: card({ flags: CardFlag.kaiden, s: 200, state: 2, due: 50_000, last: 1 }),
      },
    });
    const before = store.log.recent(10).length;
    const onDone = mount();
    revealAll();
    click(tokenEl(7, '犬'));
    click(q('[data-action="close"]'));
    click(q('[data-action="next"]'));
    answerAll();
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.kaidenConfirmed).toEqual([`${V.パン}#rec`]);
    const rows = store.log.recent(10).slice(0, store.log.recent(10).length - before);
    expect(rows.some((e) => e[1] === `${V.パン}#rec` && e[2] === 3)).toBe(true);
    expect(rows.some((e) => e[1] === `${V.犬}#rec`)).toBe(false);
    expect(store.today()).toBeGreaterThanOrEqual(today - 1);
  });

  it('a gloss tap on an introduced word due today grades Hard only on a re-read', async () => {
    const setup = async (): Promise<void> => {
      await makeStore();
      const today = store.today();
      store.cards.set(`${V.私}#rec`, card({ s: 5, d: 5, reps: 4, state: 2, due: today, last: today - 5 }));
    };
    await setup();
    mount({ firstRead: true });
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(q('[data-field="in-training"]')).not.toBeNull();
    expect(q('[data-action="capture"]')).toBeNull();
    expect(store.log.forCard(`${V.私}#rec`).length).toBe(0);
    render(null, root);

    await setup();
    mount({ firstRead: false });
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    const rows = store.log.forCard(`${V.私}#rec`);
    expect(rows.length).toBe(1);
    expect(rows[0]?.[2]).toBe(2);
  });

  it('a gloss tap on an introduced word not due today never grades', async () => {
    await makeStore();
    store.cards.set(`${V.私}#rec`, card({ s: 5, d: 5, reps: 4, state: 2, due: store.today() + 9, last: store.today() - 5 }));
    mount({ firstRead: false });
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(store.log.forCard(`${V.私}#rec`).length).toBe(0);
  });

  it('Capture on an unintroduced word writes store.captured once; Bookmark keeps a corpus-less token', async () => {
    await makeStore();
    mount();
    revealAll();
    click(tokenEl(8, '水'));
    click(q('[data-action="capture"]'));
    expect(store.captured.value).toEqual([V.水]);
    expect(q('[data-action="captured"]')).not.toBeNull();
    expect((q('[data-action="captured"]') as HTMLButtonElement).disabled).toBe(true);
    click(q('[data-action="close"]'));
    // the same word again shows Captured straight away
    click(tokenEl(10, '水'));
    expect(q('[data-action="captured"]')).not.toBeNull();
    click(q('[data-action="close"]'));
    // います has no item behind it
    click(tokenEl(2, 'います'));
    expect(q('[data-field="no-item"]')).not.toBeNull();
    click(q('[data-action="bookmark"]'));
    expect(store.bookmarks.value).toEqual(['います']);
    expect(q('[data-action="bookmarked"]')).not.toBeNull();
    expect(store.captured.value).toEqual([V.水]);
  });

  it('Gloss reading for a kanji token the corpus lacks comes from the line ruby', async () => {
    await makeStore();
    mount();
    revealAll();
    click(tokenEl(9, '三人'));
    expect(q('[data-field="reading"]')?.textContent).toBe('さんにん');
  });

  it('fog reveals count as hints and report onHint', async () => {
    await makeStore({ cards: { 'j-私#read': card({ s: 10, state: 2 }) } });
    const onHint = vi.fn();
    const onDone = mount({ furigana: 'fog', onHint });
    click(q('[data-action="next"]'));
    const fogged = qa('li[data-line="1"] .ruby__seg--fog');
    expect(fogged.length).toBe(1);
    click(fogged[0]);
    expect(onHint).toHaveBeenCalledTimes(1);
    // the fog reveal did not open a gloss
    expect(q('[role="dialog"]')).toBeNull();
    finishRead();
    expect(onDone.mock.calls[0]?.[0].hints).toBe(1);
  });

  it('Listen speaks the plain line with its kana; Space replays the current line in a frame-less page', async () => {
    await makeStore();
    mount();
    click(q('li[data-line="0"] [data-action="listen"]'));
    expect(spoken).toEqual([['おはよう。', { kana: 'おはよう。' }]]);
  });

  it('dialogue speakers alternate voice slots', async () => {
    await makeStore();
    mount({ storyId: 's-04-2' });
    revealAll();
    click(q('li[data-line="0"] [data-action="listen"]'));
    click(q('li[data-line="1"] [data-action="listen"]'));
    expect(spoken[0]?.[1]).toMatchObject({ voice: 'a' });
    expect(spoken[1]?.[1]).toMatchObject({ voice: 'b' });
    expect(q('li[data-line="0"] .reader__speaker')?.textContent).toBe('ケン');
  });

  it('English shows only for lines behind the current one, then for all once the questions open', async () => {
    await makeStore();
    mount();
    expect(q('[data-field="en"]')).toBeNull();
    click(q('[data-action="toggle-en"]'));
    expect(q('[data-action="toggle-en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(qa('[data-field="en"]').length).toBe(0); // the current line stays Japanese
    click(q('[data-action="next"]'));
    expect(qa('[data-field="en"]').length).toBe(1);
    expect(q('li[data-line="0"] [data-field="en"]')?.textContent).toBe(STORY.lines[0]?.en);
    revealAll();
    expect(qa('[data-field="en"]').length).toBe(STORY.lines.length - 1);
    click(q('[data-action="next"]'));
    expect(qa('[data-field="en"]').length).toBe(STORY.lines.length);
    expect(q('.comp')).not.toBeNull();
  });

  it('marks i+1 lines and tokens', async () => {
    await makeStore();
    const plus: StoryItem = { ...STORY, id: 's-04-3', lines: STORY.lines.map((l, i) => (i === 3 ? { ...l, plusOne: [V.コーヒー] } : l)) };
    const fx = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, 's-04-3': plus } });
    mount({ storyId: 's-04-3', loader: fx });
    revealAll();
    expect(q('li[data-line="3"]')?.getAttribute('data-plus-one')).toBe('true');
    expect(q('li[data-line="3"] [data-field="plus-one"]')).not.toBeNull();
    expect(q('li[data-line="3"] .ruby__token[data-token="2"]')?.getAttribute('data-plus-one')).toBe('true');
    expect(q('li[data-line="3"] .ruby__token[data-token="0"]')?.getAttribute('data-plus-one')).toBeNull();
    expect(q('li[data-line="4"]')?.getAttribute('data-plus-one')).toBeNull();
  });

  it('vertical text toggle appears from Blue and patches settings.verticalText', async () => {
    await makeStore({ save: { progress: { station: 25 } } });
    mount({ station: 25 });
    const btn = q('[data-action="toggle-vertical"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    click(btn);
    expect(store.settings.value.verticalText).toBe(true);
    expect(q('.reader__lines')?.getAttribute('data-vertical')).toBe('true');
    expect(q('.reader__ja')?.classList.contains('ruby--vertical')).toBe(true);
    render(null, root);
    await makeStore();
    mount();
    expect(q('[data-action="toggle-vertical"]')).toBeNull();
  });

  it('bridge passages show the Native Bridge chip and emit bridge: true', async () => {
    await makeStore();
    const bridge: StoryItem = { ...STORY, id: 's-27-1', bridge: true };
    const fx = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, 's-27-1': bridge } });
    const cap = captureEvents();
    const onDone = mount({ storyId: 's-27-1', loader: fx });
    expect(q('[data-field="bridge"]')?.textContent).toBe(S.bridgeChip);
    finishRead();
    cap.stop();
    expect((cap.events.find(([n]) => n === 'story:read')?.[1] as { bridge: boolean }).bridge).toBe(true);
    expect(onDone.mock.calls[0]?.[0].bridge).toBe(true);
  });

  it('a missing episode shows a calm notice; Continue reports missing without emitting', async () => {
    await makeStore();
    const cap = captureEvents();
    const onDone = mount({ storyId: 's-09-9' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('[data-state="missing"]')).not.toBeNull();
    expect(root.textContent).toContain(S.storyMissing);
    click(q('[data-action="skip"]'));
    cap.stop();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ missing: true, total: 0 }));
    expect(cap.events.some(([n]) => n === 'story:read')).toBe(false);
  });

  it('loads a story that is not in memory through getAsync', async () => {
    await makeStore();
    const lazy: ContentLoader = { ...loader, get: () => undefined };
    mount({ loader: lazy });
    expect(q('[data-state="loading"]')).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('.reader__title')).not.toBeNull();
  });
});

describe('<StoryReader> as the story-read exercise', () => {
  function step(over: Partial<Step> = {}): Step {
    return { id: 'st-1', block: 'input', exercise: 'story-read', itemId: FIXTURE_STORY_ID, cardKey: null, params: { storyId: FIXTURE_STORY_ID }, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 300_000, ...over };
  }
  function props(over: Partial<ExerciseProps> = {}): ExerciseProps {
    return { step: step(), item: STORY, feel: 'dojo', furigana: 'always', jj: false, speedTier: 3, exposures: 0, onResult: vi.fn(), onHint: vi.fn(), onReplay: vi.fn(), requestJudge: () => Promise.resolve(true), ...over };
  }

  it('reads params.storyId through the live loader and reports onResult after the questions', async () => {
    await makeStore();
    const pr = props();
    act(() => render(<StoryReader {...pr} />, root));
    expect(q('.reader__title')).not.toBeNull();
    clock += 60_000;
    finishRead();
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult).toHaveBeenCalledWith(expect.objectContaining({ correct: true, score: 1, hintUsed: false, guard: false, timedOut: false, ms: 60_000, errorTags: [] }));
  });

  it('under 2/3 reports correct: false; fog reveals forward onHint and hintUsed', async () => {
    await makeStore({ cards: { 'j-私#read': card({ s: 10, state: 2 }) } });
    const pr = props({ furigana: 'fog' });
    act(() => render(<StoryReader {...pr} />, root));
    click(q('[data-action="next"]'));
    click(qa('li[data-line="1"] .ruby__seg--fog')[0]);
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    finishRead([0, 2]);
    expect(pr.onResult).toHaveBeenCalledWith(expect.objectContaining({ correct: false, hintUsed: true }));
  });

  it('falls back to step.itemId when params carry no storyId', async () => {
    await makeStore();
    const pr = props({ step: step({ params: {} }) });
    act(() => render(<StoryReader {...pr} />, root));
    expect(q('.reader__title-en')?.textContent).toBe(STORY.titleEn);
  });
});
