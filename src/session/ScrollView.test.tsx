/**
 * ScrollView.tsx — pretest → teach cards → checks → noticing → onDone, over the real runner and a test store.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATION_1, STATION_4, V, createFakeLoader } from '../content/fixtures';
import type { VocabItem } from '../content/types';
import { bus } from '../shared/events';
import type { AttemptResult } from '../shared/session-types';
import { resetStoreForTests, store } from '../store';
import { makeTestStore } from '../store/testing';
import { scrollsForStation } from '../learn';
import type { SessionRunner } from './runner';
import { resetScrollCompletions, teachModel } from './scroll';
import { ScrollView, TeachCard, buildScrollPlan, loadScroll, loadSessionView, parseScrollId, pitchHighs, type SessionViewComponent } from './ScrollView';

const loader = createFakeLoader();
const all = (): boolean => true;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  bus.reset();
  resetScrollCompletions();
});

const settle = async (rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

function ok(o: Partial<AttemptResult> = {}): AttemptResult {
  return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2500, errorTags: [], ...o };
}

const captured: { runner: SessionRunner | null } = { runner: null };
const Stub: SessionViewComponent = ({ runner }) => {
  captured.runner = runner;
  return <div data-stub="view">{runner.step.value?.id ?? ''}</div>;
};
function current(): SessionRunner {
  if (!captured.runner) throw new Error('no runner mounted');
  return captured.runner;
}

function answerCurrent(): void {
  const r = current();
  act(() => {
    r.submit(ok({ answer: r.step.value?.params.answer ?? 'x' }));
    r.next();
  });
}

describe('parseScrollId / pitchHighs', () => {
  it('accepts <station>-<n> and <station>-cap inside 1–53', () => {
    expect(parseScrollId('4-1')).toEqual({ station: 4, index: 1 });
    expect(parseScrollId('53-12')).toEqual({ station: 53, index: 12 });
    expect(parseScrollId('16-cap')).toEqual({ station: 16, index: 'cap' });
    expect(parseScrollId('0-1')).toBeNull();
    expect(parseScrollId('54-1')).toBeNull();
    expect(parseScrollId('4-0')).toBeNull();
    expect(parseScrollId('abc')).toBeNull();
    expect(parseScrollId('4')).toBeNull();
  });

  it('draws Tokyo pitch: heiban rises, atamadaka falls, nakadaka drops after the nucleus', () => {
    expect(pitchHighs(3, 0)).toEqual({ high: [false, true, true], particleHigh: true });
    expect(pitchHighs(3, 1)).toEqual({ high: [true, false, false], particleHigh: false });
    expect(pitchHighs(3, 2)).toEqual({ high: [false, true, false], particleHigh: false });
    expect(pitchHighs(3, 3)).toEqual({ high: [false, true, true], particleHigh: false });
  });
});

describe('SessionHost', () => {
  it('finds the real <SessionView> on disk through the deferred import', async () => {
    const view = await loadSessionView();
    expect(typeof view).toBe('function');
  });
});

describe('loadScroll / buildScrollPlan', () => {
  it('finds a station scroll by id and builds pretest + intro checks', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const scrolls = scrollsForStation(STATION_4, (id) => loader.get(id));
    const vocab = scrolls.find((s) => s.kind === 'vocab')!;
    const s = await loadScroll(vocab.id, loader);
    expect(s?.id).toBe(vocab.id);
    expect(s?.itemIds).toEqual(vocab.itemIds);
    const built = await buildScrollPlan(s!, { loader, available: all });
    expect(built.plan.mode).toBe('scroll');
    expect(built.plan.meta.scrollIds).toEqual([vocab.id]);
    const pre = built.plan.steps.filter((st) => st.id.includes(':pre:'));
    const checks = built.plan.steps.filter((st) => st.stepTag === 'intro');
    expect(pre).toHaveLength(3);
    expect(checks).toHaveLength(vocab.itemIds.length);
    expect(built.noticing?.storyId).toBe('s-04-1');
    expect(await loadScroll('4-99', loader)).toBeNull();
    expect(await loadScroll('9-1', loader)).toBeNull();
  });

  it('the -cap scroll holds un-introduced captured words and is null when there are none', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, captured: [V.パン, V.コーヒー] } });
    const s = await loadScroll('4-cap', loader);
    expect(s?.kind).toBe('vocab');
    expect(s?.itemIds).toEqual([V.パン, V.コーヒー]);
    resetStoreForTests();
    await makeTestStore({ save: { progress: { station: 4 } } });
    expect(await loadScroll('4-cap', loader)).toBeNull();
  });
});

describe('<ScrollView> captured-words scroll', () => {
  it('the -cap scroll is headed "Captured words", not its id', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, captured: [V.パン, V.コーヒー] } });
    captured.runner = null;
    act(() => render(<ScrollView scrollId="4-cap" onDone={vi.fn()} loader={loader} available={all} view={Stub} />, root));
    await settle();
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).not.toBe('missing');
    expect(root.querySelector('.scroll-card__title')?.textContent).toBe('巻物 Captured words');
  });
});

describe('<TeachCard>', () => {
  it('shows the word, kana, meaning, pitch, examples with Listen, collocations and the contrast item', async () => {
    await makeTestStore();
    const item = loader.get<VocabItem>(V.飲む)!;
    const model = teachModel(item)!;
    const contrast = teachModel(loader.get(V.食べる)!);
    act(() => render(<TeachCard item={item} model={model} index={0} total={1} furigana="always" known={false} onKnown={() => undefined} contrast={contrast} />, root));
    expect(root.querySelector('.teach-card__word')?.textContent).toBe('飲む');
    expect(root.querySelector('.teach-card__kana')?.textContent).toBe('のむ');
    expect(root.querySelector('.teach-card__meaning')?.textContent).toBe('to drink');
    expect(root.querySelector('.pitch-mark svg')?.getAttribute('aria-label')).toContain('drop after mora 1');
    expect(root.querySelectorAll('.teach-card__example')).toHaveLength(1);
    expect(root.querySelector('.teach-card__example ruby')).not.toBeNull();
    expect(root.querySelectorAll('.teach-card__chips .chip')).toHaveLength(2);
    expect(root.querySelector('.teach-card__contrast')?.textContent).toContain('食べる');
    expect(root.querySelector('.teach-card__word')?.closest('[lang="ja"]')).not.toBeNull();
  });
});

describe('<ScrollView>', () => {
  it('runs pretest, unrolls one teach card per item, proceeds to checks, shows noticing, then onDone', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const scroll = scrollsForStation(STATION_4, (id) => loader.get(id)).find((s) => s.kind === 'vocab')!;
    const onDone = vi.fn();
    captured.runner = null;
    act(() => render(<ScrollView scrollId={scroll.id} onDone={onDone} loader={loader} available={all} view={Stub} />, root));
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    await settle();
    // pretest first (Chikaradameshi), hosted in the session view
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).toBe('pretest');
    // the heading shows the Station page's ordinal, never the raw `<station>-<n>` id
    expect(root.querySelector('.scroll-card__title')?.textContent).toBe(`巻物 Scroll ${parseScrollId(scroll.id)!.index}`);
    expect(root.querySelector('.scroll-card__title')?.textContent).not.toContain('4-');
    expect(root.querySelector('[data-stub="view"]')).not.toBeNull();
    expect(root.textContent).toContain('力試し');
    const r = current();
    expect(r.step.value?.id).toContain(':pre:');
    for (let i = 0; i < 3; i++) answerCurrent();
    // the first intro check pauses the runner and unrolls the cards
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).toBe('teach');
    expect(r.paused.value).toBe(true);
    expect(root.querySelectorAll('.teach-card')).toHaveLength(scroll.itemIds.length);
    expect(root.querySelector('[data-stub="view"]')).toBeNull();
    // begin the checks
    act(() => {
      (root.querySelector('.hanko') as HTMLButtonElement).click();
    });
    expect(r.paused.value).toBe(false);
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).toBe('checks');
    let guard = 0;
    while (!r.done.value && guard++ < 40) answerCurrent();
    expect(r.done.value).not.toBeNull();
    // noticing: the episode lines with the new items highlighted
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).toBe('noticing');
    expect(root.querySelectorAll('.scroll-view__line').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.scroll-view__hit').length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      (root.querySelector('.hanko') as HTMLButtonElement).click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    // every item was introduced by its intro check
    for (const id of scroll.itemIds) expect(Object.keys(store.cards.byItem(id)).length).toBeGreaterThan(0);
  });

  it('a scroll without a pretest step opens on the cards; 既知 marks a kana known', async () => {
    await makeTestStore({ save: { progress: { station: 1 } } });
    const scroll = scrollsForStation(STATION_1, (id) => loader.get(id)).find((s) => s.kind === 'kana')!;
    const onDone = vi.fn();
    captured.runner = null;
    act(() => render(<ScrollView scrollId={scroll.id} onDone={onDone} loader={loader} available={(id) => id !== 'kana-flash' && id !== 'kana-ear' && id !== 'kana-forge'} view={Stub} />, root));
    await settle();
    // no kana drill available → no steps → straight to the cards, honest note shown
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).toBe('teach');
    expect(root.querySelectorAll('.teach-card')).toHaveLength(scroll.itemIds.length);
    expect(root.textContent).toContain('No drill for these items is built yet');
    const kanaId = scroll.itemIds[0]!;
    const btn = root.querySelector('.teach-card__foot .btn') as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(store.profile.value.kanaKnown).toContain(kanaId);
    expect(Object.keys(store.cards.byItem(kanaId)).length).toBeGreaterThan(0);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.disabled).toBe(true);
    act(() => {
      (root.querySelector('.hanko') as HTMLButtonElement).click();
    });
    // kana station 1 has no story → straight to done
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).toBe('done');
    act(() => {
      (root.querySelector('.hanko') as HTMLButtonElement).click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('an unknown scroll id shows a calm not-found with a way back', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const onDone = vi.fn();
    act(() => render(<ScrollView scrollId="4-77" onDone={onDone} loader={loader} available={all} view={Stub} />, root));
    await settle();
    expect(root.querySelector('.notice')?.textContent).toContain('No scroll by that name');
    act(() => {
      (root.querySelector('.btn') as HTMLButtonElement).click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('leaving mid-session abandons the runner (snapshot cleared) and calls onExit', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const scroll = scrollsForStation(STATION_4, (id) => loader.get(id)).find((s) => s.kind === 'grammar')!;
    const onDone = vi.fn();
    const onExit = vi.fn();
    captured.runner = null;
    act(() => render(<ScrollView scrollId={scroll.id} onDone={onDone} onExit={onExit} loader={loader} available={all} view={Stub} />, root));
    await settle();
    const r = current();
    expect(store.session.load()).not.toBeNull();
    // pretest answered → teach → leave from the cards
    while (!r.paused.value && !r.done.value) answerCurrent();
    expect(root.querySelector('.scroll-view')?.getAttribute('data-phase')).toBe('teach');
    act(() => {
      (root.querySelector('.scroll-view__actions .btn--ghost') as HTMLButtonElement).click();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(r.abandoned.value).toBe(true);
    expect(store.session.load()).toBeNull();
  });
});
