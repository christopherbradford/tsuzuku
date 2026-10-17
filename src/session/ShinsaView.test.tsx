/**
 * ShinsaView.tsx — eligibility reasons and bars, the exam over the real runner, the 1,000 XP line, the typed-path note, Sensei's Notes.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Belt, CardKey } from '../content/types';
import { STATION_1, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { SessionPlan } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import type { SessionRunner } from './runner';
import type { SessionViewComponent } from './ScrollView';
import { buildShinsa } from './shinsa';
import { ShinsaView, typedPath } from './ShinsaView';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

function live(s: number): CardTuple {
  return card({ due: TODAY + 5, s, d: 5, reps: 10, lapses: 0, state: 2, last: TODAY - 1 });
}

/** Belt items at Brown (shinsa.test pattern). */
function brownCards(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of STATION_4.vocabIds) {
    out[`${id}#rec`] = live(40);
    out[`${id}#prod`] = live(10);
    out[`${id}#listen`] = live(10);
  }
  for (const id of STATION_4.kanjiIds) {
    out[`${id}#comp`] = live(40);
    out[`${id}#read`] = live(10);
  }
  for (const id of STATION_4.grammarIds) {
    out[`${id}#cloze`] = live(40);
    out[`${id}#prod`] = live(10);
  }
  for (const id of STATION_1.vocabIds) out[`${id}#${id === V.おはよう || id === V.はい ? 'prod' : 'rec'}`] = live(40);
  return out;
}

const YELLOW_GATES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

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
});

const settle = async (rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

const captured: { runner: SessionRunner | null } = { runner: null };
const Stub: SessionViewComponent = ({ runner }) => <div data-stub="view">{runner.step.value?.id ?? ''}</div>;
function current(): SessionRunner {
  if (!captured.runner) throw new Error('no runner mounted');
  return captured.runner;
}

function answerAll(r: SessionRunner, correct: boolean): void {
  let guard = 0;
  while (!r.done.value && r.step.value && guard++ < 120) {
    act(() => {
      const step = r.step.value;
      r.submit({ correct, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1500, errorTags: correct ? [] : ['particle'], answer: correct ? (step?.params.answer ?? 'x') : 'nope', ...(correct ? { selfRating: 3 as const, score: 1 } : { score: 0 }) });
      r.next();
    });
  }
}

const hanko = (): HTMLButtonElement => root.querySelector('.hanko') as HTMLButtonElement;
const click = (el: Element | null): void => {
  act(() => {
    (el as HTMLButtonElement).click();
  });
};
const text = (): string => root.textContent ?? '';
const stage = (): string | null => root.querySelector('.shinsa-view')?.getAttribute('data-stage') ?? null;

async function mount(belt: Belt, plan?: SessionPlan): Promise<ReturnType<typeof vi.fn>> {
  const onExit = vi.fn();
  captured.runner = null;
  act(() =>
    render(
      <ShinsaView
        belt={belt}
        onExit={onExit}
        loader={loader}
        available={all}
        view={Stub}
        plan={plan}
        onRunner={(r) => {
          captured.runner = r;
        }}
      />,
      root,
    ),
  );
  await settle();
  return onExit;
}

describe('<ShinsaView> eligibility', () => {
  it('ineligible: lists the reasons with coverage bars and offers no exam', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    await mount('yellow');
    expect(stage()).toBe('eligibility');
    expect(root.querySelector('.shinsa-view')?.getAttribute('data-eligible')).toBe('false');
    const reasons = Array.from(root.querySelectorAll('.shinsa-view__reasons li')).map((li) => li.textContent);
    expect(reasons).toContain('Pass every Gatekeeper of the Yellow belt first.');
    expect(reasons.some((r) => r?.startsWith('Bring 85 percent'))).toBe(true);
    expect(reasons.some((r) => r?.startsWith('Bring 50 percent'))).toBe(true);
    expect(text()).toContain('Gatekeepers remaining: 6.');
    const bars = root.querySelectorAll('.shinsa-cov');
    expect(bars).toHaveLength(2);
    expect(bars[0]?.getAttribute('aria-valuenow')).toBe('0');
    expect(hanko()).toBeNull();
    expect(root.querySelectorAll('.shinsa-view__sections li')).toHaveLength(5);
  });

  it('white has no exam', async () => {
    await makeTestStore();
    await mount('white');
    expect(text()).toContain('The White belt has no exam');
    expect(hanko()).toBeNull();
  });

  it('eligible: bars met, every gate passed, the exam is offered', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: YELLOW_GATES } }, cards: brownCards() });
    await mount('yellow');
    expect(root.querySelector('.shinsa-view')?.getAttribute('data-eligible')).toBe('true');
    expect(text()).toContain('Every Gatekeeper of the belt passed.');
    expect(root.querySelectorAll('.shinsa-cov[data-met="true"]')).toHaveLength(2);
    expect(hanko()?.textContent).toBe('Begin the exam');
    // the first exam keeps furigana (off from Orange, design 04 §12) and says so instead of promising "no furigana"
    expect(text()).toContain('Furigana stays on for this first exam.');
    expect(text()).not.toContain('no furigana');
  });
});

describe('<ShinsaView> exam', () => {
  it('passing shows the 1,000 XP line, promotes the belt and notes the typed path when speaking was never used', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: YELLOW_GATES } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 1, { loader, available: all });
    expect(plan.steps.length).toBeGreaterThan(0);
    const cap = captureEvents();
    await mount('yellow', plan);
    click(hanko());
    await settle(2);
    expect(stage()).toBe('section');
    expect(text()).toContain(`Section 1 of ${plan.blocks.length}`);
    const r = current();
    expect(r.paused.value).toBe(true);
    click(hanko());
    expect(stage()).toBe('exam');
    expect(root.querySelector('[data-stub="view"]')).not.toBeNull();
    // sections advance behind their cards; answer through all of them
    let guard = 0;
    while (!r.done.value && guard++ < 10) {
      if (stage() === 'section') click(hanko());
      const block = plan.blocks.find((b) => b.stepIds.includes(r.step.value?.id ?? ''));
      const ids = new Set(block?.stepIds ?? []);
      let inner = 0;
      while (r.step.value && ids.has(r.step.value.id) && !r.done.value && inner++ < 60) {
        act(() => {
          const step = r.step.value;
          r.submit({ correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1500, errorTags: [], answer: step?.params.answer ?? 'x', selfRating: 3, score: 1 });
          r.next();
        });
      }
    }
    await settle(2);
    expect(stage()).toBe('result');
    expect(root.querySelector('.shinsa-view')?.getAttribute('data-passed')).toBe('true');
    expect(text()).toContain('Passed. The ceremony follows.');
    expect(text()).toContain('+1,000 XP');
    expect(text()).toContain('The Yellow belt is yours.');
    expect(store.profile.value.belt).toBe('yellow');
    expect(store.progress.value.shinsaPassed).toContain('yellow');
    expect(cap.events.filter((e) => e[0] === 'shinsa:result')).toHaveLength(1);
    // fresh learner, default speaking = self → role-play typed, no shadow lines yet
    expect(text()).toContain('Speaking: untested (typed path)');
    expect(root.querySelectorAll('.shinsa-result__row')).toHaveLength(5);
    cap.stop();
  });

  it('the typed-path note is absent once the learner has spoken (shadow lines)', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: YELLOW_GATES }, stats: { shadowLines: 12, shadowPass: 10 } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 2, { loader, available: all });
    expect(typedPath(plan, { shadowLines: 12, monologues: 0 })).toBe(false);
    expect(typedPath(plan, { shadowLines: 0, monologues: 0 })).toBe(true);
    const spoken: SessionPlan = { ...plan, steps: plan.steps.map((s) => (s.exercise === 'role-play' ? { ...s, params: { ...s.params, mode: 'speak' as const } } : s)) };
    expect(typedPath(spoken, { shadowLines: 0, monologues: 0 })).toBe(false);
    await mount('yellow', plan);
    click(hanko());
    await settle(2);
    const r = current();
    click(hanko());
    let guard = 0;
    while (!r.done.value && guard++ < 10) {
      if (stage() === 'section') click(hanko());
      answerAll(r, true);
    }
    await settle(2);
    expect(stage()).toBe('result');
    expect(text()).not.toContain('typed path');
  });

  it('a failed exam says "Not yet", writes Sensei’s Notes, and the Notes session reopens the retake', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: YELLOW_GATES } }, cards: brownCards() });
    const plan = await buildShinsa('yellow', 3, { loader, available: all });
    await mount('yellow', plan);
    click(hanko());
    await settle(2);
    const r = current();
    let guard = 0;
    while (!r.done.value && guard++ < 10) {
      if (stage() === 'section') click(hanko());
      answerAll(r, false);
    }
    await settle(2);
    expect(stage()).toBe('result');
    expect(root.querySelector('.shinsa-view')?.getAttribute('data-passed')).toBe('false');
    expect(text()).toContain('Not yet. The gate will still be here.');
    expect(text()).not.toContain('+1,000 XP');
    expect(store.progress.value.shinsaNotes?.belt).toBe('yellow');
    expect(store.profile.value.belt).toBe('white');
    expect(text()).toContain('Sensei’s Notes');
    expect(text()).toContain('Tags: particle');
    const notesBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Train Sensei’s Notes') as HTMLButtonElement;
    expect(notesBtn).toBeDefined();
    // the Notes session: a weak-mode plan over the noted cards; finishing it clears the notes
    captured.runner = null;
    click(notesBtn);
    await settle(3);
    expect(stage()).toBe('notes');
    const notes = current();
    expect(notes.plan.mode).toBe('weak');
    expect(notes.plan.id.startsWith('shinsa-notes-')).toBe(true);
    answerAll(notes, true);
    await settle(3);
    expect(store.progress.value.shinsaNotes).toBeUndefined();
    expect(stage()).toBe('eligibility');
    expect(text()).toContain('Notes session done. The retake is open.');
    // the notes gate is lifted; coverage honestly fell with the failed reps, so the bars say what remains
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Train Sensei’s Notes')).toBe(false);
    expect(text()).not.toContain('Train one Sensei’s Notes session first.');
    expect(root.querySelectorAll('.shinsa-cov')).toHaveLength(2);
  });
});

describe('<ShinsaView> stale Notes', () => {
  it('Notes that hold no cards complete on the spot: the retake opens instead of an empty session', async () => {
    await makeTestStore({ save: { progress: { station: 9, stationsCleared: YELLOW_GATES, shinsaNotes: { belt: 'yellow', items: [], tags: ['particle'] } } }, cards: brownCards() });
    await mount('yellow');
    expect(stage()).toBe('eligibility');
    expect(text()).toContain('Train one Sensei’s Notes session first.');
    const notesBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Train Sensei’s Notes') as HTMLButtonElement;
    expect(notesBtn).toBeDefined();
    click(notesBtn);
    await settle(4);
    expect(stage()).toBe('eligibility');
    expect(store.progress.value.shinsaNotes).toBeUndefined();
    expect(text()).toContain('Notes session done. The retake is open.');
    expect(text()).not.toContain('Train one Sensei’s Notes session first.');
    expect(text()).not.toContain('The exam has no sections to run yet');
  });
});
