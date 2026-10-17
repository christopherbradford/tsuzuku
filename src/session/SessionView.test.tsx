/**
 * SessionView.tsx — a full session over the real runner, writer and a test store,
 * with a stub exercise registered in the shared registry.
 */
import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardKey } from '../content/types';
import { V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import { registerExercise, resetRegistryForTests, type ExerciseProps } from '../shared/exercise-types';
import type { AttemptResult, SessionPlan, Step } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple, LogEntry } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { SessionRunner } from './runner';
import { resetScrollCompletions } from './scroll';
import { SessionView, comboTierOf, previousSessionErrorRate } from './SessionView';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const ITEMS = [V.犬, V.水, V.人, V.日];

let root: HTMLDivElement;
let clock = DEFAULT_TEST_NOW;

beforeEach(() => {
  clock = DEFAULT_TEST_NOW;
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetRegistryForTests();
  resetStoreForTests();
  resetScrollCompletions();
  bus.reset();
});

/* ── stub exercises ─────────────────────────────────────────────────── */

const ok = (o: Partial<AttemptResult> = {}): AttemptResult => ({ correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2500, errorTags: [], answer: 'x', ...o });

function Stub(p: ExerciseProps): JSX.Element {
  return (
    <div class="stub" data-step={p.step.id} data-item={p.item ? 'yes' : 'no'} data-jj={p.jj ? 'true' : 'false'} data-tier={p.speedTier}>
      <button type="button" class="stub-answer" onClick={() => p.onResult(ok())}>
        answer
      </button>
      <button type="button" class="stub-miss" onClick={() => p.onResult(ok({ correct: false, answer: 'nope' }))}>
        miss
      </button>
    </div>
  );
}

function JudgeStub(p: ExerciseProps): JSX.Element {
  return (
    <div class="stub stub--judge" data-step={p.step.id}>
      <button
        type="button"
        class="stub-good"
        onClick={() => {
          void p.requestJudge({ correct: 'dog', distractors: ['cat', 'bird', 'fish'] }).then(() => p.onResult(ok({ selfRating: 3 })));
        }}
      >
        good
      </button>
    </div>
  );
}

function registerStubs(): void {
  registerExercise({ id: 'meaning-recall', facet: 'rec', needsTts: false, needsStt: false, selfGraded: false, timeable: true, keys: 'text' }, Stub);
  registerExercise({ id: 'meaning-judge', facet: 'rec', needsTts: false, needsStt: false, selfGraded: true, timeable: false, keys: 'none' }, JudgeStub);
}

/* ── plan / store helpers ───────────────────────────────────────────── */

function step(o: Partial<Step> & { id: string; cardKey: CardKey | null }): Step {
  const itemId = o.itemId ?? (o.cardKey ? o.cardKey.split('#')[0]! : null);
  return { block: 'reviews', exercise: 'meaning-recall', itemId, params: { answer: 'x', accept: ['x'] }, timed: false, isNew: false, stepTag: null, exposures: 6, estMs: 6000, ...o };
}

function plan(steps: Step[], o: Partial<SessionPlan['meta']> = {}, mode: SessionPlan['mode'] = 'kata'): SessionPlan {
  const reviews = steps.filter((s) => s.block !== 'michikusa');
  const blocks: SessionPlan['blocks'] = [{ kind: 'reviews', label: 'Reviews', estMinutes: 2, stepIds: reviews.map((s) => s.id) }];
  const m = steps.filter((s) => s.block === 'michikusa');
  if (m.length) blocks.push({ kind: 'michikusa', label: 'Michikusa', estMinutes: 0.2, stepIds: m.map((s) => s.id) });
  return { id: `${mode}-view-test`, mode, day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 4, steps, blocks, meta: { dueTotal: reviews.length, dueTaken: reviews.length, backlog: false, newCount: 0, scrollIds: [], ...o } };
}

function cards(ids: readonly string[], s = 5): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of ids) out[`${id}#rec`] = card({ due: TODAY, s, d: 5, reps: 6, lapses: 0, state: 2, last: TODAY - 1 });
  return out;
}

const kataSteps = (): Step[] => [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` }), step({ id: 's1', cardKey: `${ITEMS[1]}#rec` }), step({ id: 'mk', block: 'michikusa', exercise: 'story-read', cardKey: null, itemId: 'm-04-2', params: { michikusaId: 'm-04-2' } }), step({ id: 's2', cardKey: `${ITEMS[2]}#rec` })];

async function setup(o: { steps?: Step[]; feel?: 'zen' | 'dojo' | 'arcade'; meta?: Partial<SessionPlan['meta']> } = {}): Promise<{ runner: SessionRunner; onExit: ReturnType<typeof vi.fn>; onAnother: ReturnType<typeof vi.fn> }> {
  await makeTestStore({ save: { progress: { station: 4 }, settings: o.feel ? { feel: o.feel } : {} }, cards: cards(ITEMS), now: () => clock });
  registerStubs();
  const runner = new SessionRunner(plan(o.steps ?? kataSteps(), o.meta), { loader });
  const onExit = vi.fn();
  const onAnother = vi.fn();
  act(() => render(<SessionView runner={runner} onExit={onExit} onAnother={onAnother} loader={loader} />, root));
  return { runner, onExit, onAnother };
}

const click = (sel: string): void => {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`no element ${sel}`);
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

const press = (key: string, init: KeyboardEventInit = {}): void => {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Lets chained async work (the 次回予告 loads a plan context over several awaits) settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
};

/* ── tests ──────────────────────────────────────────────────────────── */

describe('<SessionView>', () => {
  it('renders the step inside the frame with the Hud and the exercise props', async () => {
    const { runner } = await setup();
    expect(root.querySelector('.hud')).not.toBeNull();
    expect(root.querySelector('.exercise-frame')).not.toBeNull();
    const stub = root.querySelector('.stub')!;
    expect(stub.getAttribute('data-step')).toBe('s0');
    expect(stub.getAttribute('data-item')).toBe('yes');
    expect(stub.getAttribute('data-jj')).toBe('false');
    expect(stub.getAttribute('data-tier')).toBe(String(store.settings.value.speedTier));
    expect(root.querySelector('.exercise-frame__progress')?.textContent).toContain('1 / 4');
    expect(root.querySelector('.forge-bar')).not.toBeNull();
    expect(runner.index.value).toBe(0);
  });

  it('onResult drives the runner: feedback, Continue, next step; a Michikusa step shows the card; the end card follows the last step', async () => {
    const { runner } = await setup();
    const cap = captureEvents();
    click('.stub-answer');
    expect(runner.results).toHaveLength(1);
    expect(root.querySelector('.feedback[data-kind="correct"]')).not.toBeNull();
    expect(cap.events.filter((e) => e[0] === 'attempt:graded')).toHaveLength(1);
    click('.exercise-frame__controls .hanko');
    expect(runner.index.value).toBe(1);
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s1');
    expect(root.querySelector('.feedback')).toBeNull();

    click('.stub-answer');
    press('Enter');
    expect(runner.index.value).toBe(2);
    expect(root.querySelector('.michikusa')).not.toBeNull();
    expect(root.querySelector('.exercise-frame')).toBeNull();
    expect(root.querySelector('.hud')).not.toBeNull();
    click('.michikusa__continue');
    expect(cap.events.filter((e) => e[0] === 'michikusa:read')).toHaveLength(1);
    expect(store.collections.value.michikusa).toEqual(['m-04-2']);
    expect(runner.index.value).toBe(3);
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s2');

    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    expect(runner.done.value).not.toBeNull();
    expect(cap.events.filter((e) => e[0] === 'session:finished')).toHaveLength(1);
    expect(root.querySelector('.end-card')).not.toBeNull();
    expect(root.querySelector('.end-card__loading')).not.toBeNull();
    await settle();
    expect(root.querySelector('.end-card__loading')).toBeNull();
    expect(root.querySelector('.end-card__milestone')?.textContent?.length).toBeGreaterThan(0);
    expect(root.textContent).toContain('Reps');
    expect(root.querySelector('.end-card__tally')?.textContent).toContain('3');
    expect(store.session.load()).toBeNull();
    cap.stop();
  });

  it('a miss re-queues a Recovery rep and the Hud follows the live queue', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: cards(ITEMS, 20), now: () => clock });
    registerStubs();
    const steps = ITEMS.map((id, i) => step({ id: `r${i}`, cardKey: `${id}#rec` }));
    const runner = new SessionRunner(plan(steps), { loader });
    act(() => render(<SessionView runner={runner} onExit={() => undefined} loader={loader} />, root));
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    click('.stub-miss');
    expect(root.querySelector('.feedback[data-kind="wrong"]')).not.toBeNull();
    expect(runner.steps().length).toBeGreaterThan(steps.length);
    expect(root.querySelector('.exercise-frame__progress')?.textContent).toContain(`/ ${runner.steps().length}`);
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe(String(runner.steps().length));
  });

  it('pause saves a snapshot at the current rep and resume continues; the frame overlay shows', async () => {
    const { runner } = await setup();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    press('Escape');
    expect(runner.paused.value).toBe(true);
    expect(root.querySelector('.pause-overlay')).not.toBeNull();
    const snap = store.session.load();
    expect(snap?.cursor).toBe(1);
    expect(snap?.results).toHaveLength(1);
    press('Escape');
    expect(runner.paused.value).toBe(false);
    expect(root.querySelector('.pause-overlay')).toBeNull();
    // A resumed runner picks up at the same rep with the same results.
    render(null, root);
    const resumed = SessionRunner.resume({ loader })!;
    expect(resumed.resumed).toBe(true);
    expect(resumed.index.value).toBe(1);
    act(() => render(<SessionView runner={resumed} onExit={() => undefined} loader={loader} />, root));
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s1');
  });

  it('Leave asks first; keeping the place calls onExit and leaves the snapshot in the store', async () => {
    const { onExit } = await setup();
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    click('.session__leave');
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    click('.session__leave-stay');
    expect(root.querySelector('.session__dialog')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    click('.session__leave');
    click('.session__leave-keep');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(store.session.load()?.cursor).toBe(1);
  });

  it('Shift+Enter guards through the frame and ? counts a hint', async () => {
    const { runner } = await setup();
    const cap = captureEvents();
    press('?');
    press('Enter', { shiftKey: true });
    expect(runner.results[0]?.guard).toBe(true);
    expect(runner.results[0]?.hintUsed).toBe(true);
    expect(root.querySelector('.feedback[data-kind="guard"]')).not.toBeNull();
    expect(cap.events.filter((e) => e[0] === 'attempt:graded')).toHaveLength(1);
    cap.stop();
  });

  it('an unregistered drill shows an honest panel: count as don’t know, or leave', async () => {
    const steps = [step({ id: 'k0', cardKey: `${ITEMS[0]}#rec`, exercise: 'kanji-read' }), step({ id: 's1', cardKey: `${ITEMS[1]}#rec` })];
    const { runner, onExit } = await setup({ steps });
    expect(root.querySelector('.stub')).toBeNull();
    expect(root.querySelector('.session__missing')).not.toBeNull();
    click('.session__missing-guard');
    expect(runner.results[0]?.guard).toBe(true);
    expect(root.querySelector('.session__missing-guard')).toBeNull();
    click('.exercise-frame__controls .hanko');
    expect(root.querySelector('.stub')?.getAttribute('data-step')).toBe('s1');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Judge protocol: a sampled self-rated Good shows the Judge Card and the verdict rides on the submit', async () => {
    const steps = [step({ id: 'j0', cardKey: `${ITEMS[0]}#rec`, exercise: 'meaning-judge', params: { answer: 'dog' } })];
    const { runner } = await setup({ steps });
    const cap = captureEvents();
    click('.stub-good');
    await flush();
    // Honesty has no history yet → every Good is checked (judgeRate 100).
    const judge = root.querySelector('.judge-card');
    expect(judge).not.toBeNull();
    expect(judge?.getAttribute('data-shape')).toBe('meaning');
    expect(root.querySelector('.session__exercise')?.getAttribute('aria-hidden')).toBe('true');
    const options = Array.from(root.querySelectorAll('.judge-card__option'));
    expect(options).toHaveLength(4);
    const correct = options.find((b) => b.textContent?.includes('dog'))!;
    act(() => {
      (correct as HTMLButtonElement).click();
    });
    await flush();
    expect(root.querySelector('.judge-card')).toBeNull();
    expect(runner.results).toHaveLength(1);
    const graded = cap.events.find((e) => e[0] === 'attempt:graded')![1] as { judge?: string; rating: number };
    expect(graded.judge).toBe('pass');
    expect(graded.rating).toBe(3);
    expect(root.querySelector('.feedback__judge')?.textContent).toContain('agrees');
    cap.stop();
  });

  it('Judge protocol: a wrong pick fails the check and the writer forces Again', async () => {
    const steps = [step({ id: 'j0', cardKey: `${ITEMS[0]}#rec`, exercise: 'meaning-judge', params: { answer: 'dog' } })];
    const { runner } = await setup({ steps });
    click('.stub-good');
    await flush();
    const wrong = Array.from(root.querySelectorAll('.judge-card__option')).find((b) => !b.textContent?.includes('dog'))!;
    act(() => {
      (wrong as HTMLButtonElement).click();
    });
    await flush();
    expect(runner.results[0]?.rating).toBe(1);
    expect(root.querySelector('.feedback__judge')?.getAttribute('data-judge')).toBe('fail');
  });

  it('Zen: no ki bar or combo in the frame, progress-only Hud, end card without combo rows', async () => {
    const { runner } = await setup({ feel: 'zen', steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` })] });
    expect(root.querySelector('.ki-bar')).toBeNull();
    expect(root.querySelector('.forge-bar')).toBeNull();
    click('.stub-answer');
    expect(root.querySelector('.combo')).toBeNull();
    click('.exercise-frame__controls .hanko');
    expect(runner.done.value?.zen).toBe(true);
    expect(root.textContent).not.toContain('Best combo');
  });

  it('the end card buttons: Another → onAnother, Rest → onExit', async () => {
    const { onExit, onAnother } = await setup({ steps: [step({ id: 's0', cardKey: `${ITEMS[0]}#rec` })] });
    click('.stub-answer');
    click('.exercise-frame__controls .hanko');
    await flush();
    // Three of the four fixture cards are still due → Another Kata is offered.
    click('.end-card__another');
    expect(onAnother).toHaveBeenCalledTimes(1);
    click('.end-card__rest');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('backlog plans show the honest count instead of the Forge Bar', async () => {
    await setup({ meta: { backlog: true, dueTotal: 310, dueTaken: 120 } });
    expect(root.querySelector('.forge-bar')).toBeNull();
    expect(root.querySelector('.hud__backlog')?.textContent).toContain('120 of your 310 reviews today');
  });

  it('comboTierOf follows the 10 / 25 / 50 thresholds', () => {
    expect([0, 9, 10, 24, 25, 49, 50, 120].map(comboTierOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('previousSessionErrorRate splits the log on a 10-minute gap and ignores entries after the start', () => {
    const t0 = 1_000_000;
    const e = (t: number, rating: 1 | 3): LogEntry => [t, 'v-n5-0001#rec', rating, 3000, 0, 0];
    const log: LogEntry[] = [e(t0, 1), e(t0 + 5_000, 1), e(t0 + 10_000, 3), e(t0 + 2_000_000, 3), e(t0 + 2_005_000, 1), e(t0 + 9_000_000, 1)];
    expect(previousSessionErrorRate(log, t0 + 8_000_000)).toBe(0.5);
    expect(previousSessionErrorRate(log, t0 + 1_000_000)).toBeCloseTo(2 / 3);
    expect(previousSessionErrorRate(log, t0)).toBeNull();
    expect(previousSessionErrorRate([], t0)).toBeNull();
  });
});
