/**
 * GateView.tsx — intro readiness, four phases advancing with paused phase cards, wall bar, result + rematch rules, no lives.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardKey } from '../content/types';
import { STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { SessionPlan } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { buildGate, rematchAllowed, resetGateAttemptsForTests } from './gatekeeper';
import { S as ES } from './engine-strings';
import { SessionRunner as Runner } from './runner';
import type { SessionRunner } from './runner';
import type { SessionViewComponent } from './ScrollView';
import { GateView, grudgeRepsSince, itemHead, missesIn, phaseIndexOf } from './GateView';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const all = (): boolean => true;

function live(s: number): CardTuple {
  return card({ due: TODAY + 3, s, d: 5, reps: 8, lapses: 0, state: 2, last: TODAY - 1 });
}

/** Station-4 items introduced; `greenCount` of them Green; mature production where asked (gatekeeper.test pattern). */
function stationCards(o: { greenCount?: number; mature?: boolean } = {}): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  const ids = [...STATION_4.vocabIds, ...STATION_4.kanjiIds, ...STATION_4.grammarIds];
  const greenCount = o.greenCount ?? ids.length;
  ids.forEach((id, i) => {
    const s = i < greenCount ? (o.mature ? 20 : 8) : 2;
    if (id.startsWith('v-')) {
      out[`${id}#rec`] = live(s);
      out[`${id}#prod`] = live(o.mature ? 15 : 3);
    } else if (id.startsWith('j-')) {
      out[`${id}#comp`] = live(s);
      out[`${id}#read`] = live(o.mature ? 16 : 4);
    } else {
      out[`${id}#cloze`] = live(s);
      out[`${id}#prod`] = live(o.mature ? 15 : 3);
    }
  });
  for (const id of [V.私, V.犬, V.水]) out[`${id}#rec`] = live(20);
  return out;
}

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetGateAttemptsForTests();
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
const Stub: SessionViewComponent = ({ runner, onExit }) => {
  captured.runner = runner;
  return (
    <div data-stub="view">
      {runner.step.value?.id ?? ''}
      <button type="button" data-stub-exit onClick={onExit} />
    </div>
  );
};
function current(): SessionRunner {
  if (!captured.runner) throw new Error('no runner mounted');
  return captured.runner;
}

function answer(r: SessionRunner, correct: boolean): void {
  act(() => {
    const step = r.step.value;
    r.submit({ correct, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1500, errorTags: [], answer: correct ? (step?.params.answer ?? 'x') : 'nope' });
    r.next();
  });
}

/** Answers every step of block `bi` (the runner keeps accepting while the next phase card shows). */
function answerBlock(r: SessionRunner, plan: SessionPlan, bi: number, correct: boolean): void {
  const ids = new Set(plan.blocks[bi]?.stepIds ?? []);
  let guard = 0;
  while (r.step.value && ids.has(r.step.value.id) && !r.done.value && guard++ < 60) answer(r, correct);
}

const hanko = (): HTMLButtonElement => root.querySelector('.hanko') as HTMLButtonElement;
const click = (el: Element | null): void => {
  act(() => {
    (el as HTMLButtonElement).click();
  });
};
const text = (): string => root.textContent ?? '';

async function mountReady(plan: SessionPlan, save: Record<string, unknown> = {}): Promise<ReturnType<typeof vi.fn>> {
  const onExit = vi.fn();
  captured.runner = null;
  act(() =>
    render(
      <GateView
        station={4}
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
  void save;
  return onExit;
}

describe('<GateView> intro', () => {
  it('names the keeper, lists four phases and offers the fight when the station is ready', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ mature: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 1, loader, available: all });
    await mountReady(plan);
    expect(root.querySelector('.gate-view')?.getAttribute('data-stage')).toBe('intro');
    expect(text()).toContain('坂の関守');
    expect(text()).toContain('Hill Keeper');
    expect(root.querySelectorAll('.gate-view__phases li')).toHaveLength(4);
    expect(hanko()?.textContent).toBe('Face the Gatekeeper');
    expect(text()).not.toMatch(/\blives?\b|\bhearts?\b|♥|❤/i);
  });

  it('is honest when the station is not ready: reason shown, no fight button', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ greenCount: 8 }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 1, loader, available: all });
    await mountReady(plan);
    expect(text()).toContain('The gate is not open yet.');
    expect(text()).toContain('14 of 14 introduced, 8 Green');
    expect(hanko()).toBeNull();
    expect(root.querySelector('.btn--ghost')?.textContent).toBe('Back to the station');
  });

  it('a cleared station shows the stamp line; an assisted clear offers the Revenge Match', async () => {
    await makeTestStore({ save: { progress: { station: 5, stationsCleared: [4], assisted: [4] } }, cards: stationCards({ mature: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 1, loader, available: all });
    await mountReady(plan);
    expect(text()).toContain('Cleared provisionally');
    expect(hanko()?.textContent).toBe('Revenge Match');
  });
});

describe('<GateView> fight', () => {
  it('phases advance behind paused phase cards; the wall chips; a clean fight stamps the station', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ mature: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 2, loader, available: all });
    expect(plan.blocks.length).toBeGreaterThanOrEqual(3);
    const cap = captureEvents();
    const onExit = await mountReady(plan);
    click(hanko());
    await settle(2);
    // phase 1 card: runner paused, keeper named, wall full
    expect(root.querySelector('.gate-view')?.getAttribute('data-stage')).toBe('phase');
    expect(text()).toContain(`Phase 1 of ${plan.blocks.length}`);
    const r = current();
    expect(r.paused.value).toBe(true);
    const wall = root.querySelector('.gate-wall') as HTMLElement;
    expect(wall.getAttribute('aria-valuenow')).toBe(String(plan.steps.length));
    expect(root.querySelector('[data-stub="view"]')).toBeNull();
    click(hanko());
    expect(r.paused.value).toBe(false);
    expect(root.querySelector('.gate-view')?.getAttribute('data-stage')).toBe('fight');
    expect(root.querySelector('[data-stub="view"]')).not.toBeNull();
    // phase 1 answered → phase 2 card with the grudge reveal
    answerBlock(r, plan, 0, true);
    expect(root.querySelector('.gate-view')?.getAttribute('data-stage')).toBe('phase');
    expect(text()).toContain(`Phase 2 of ${plan.blocks.length}`);
    expect(text()).toContain('Nothing slipped.');
    expect(r.paused.value).toBe(true);
    expect(Number((root.querySelector('.gate-wall') as HTMLElement).getAttribute('aria-valuenow'))).toBe(plan.steps.length - (plan.blocks[0]?.stepIds.length ?? 0));
    for (let bi = 1; bi < plan.blocks.length; bi++) {
      click(hanko());
      answerBlock(r, plan, bi, true);
    }
    await settle(2);
    expect(r.done.value).not.toBeNull();
    expect(root.querySelector('.gate-view')?.getAttribute('data-stage')).toBe('result');
    expect(root.querySelector('.gate-view')?.getAttribute('data-outcome')).toBe('perfect');
    expect(text()).toContain('bows');
    expect(root.querySelector('.gate-stamp .seal--perfect')).not.toBeNull();
    expect(root.querySelectorAll('.gate-result__row')).toHaveLength(plan.blocks.length + 1);
    expect(store.progress.value.stationsCleared).toContain(4);
    expect(store.progress.value.station).toBe(5);
    expect(cap.events.filter((e) => e[0] === 'gate:result')).toHaveLength(1);
    expect(text()).not.toMatch(/\blives?\b|\bhearts?\b|♥|❤/i);
    click(root.querySelector('.gate-view__actions .btn'));
    expect(onExit).toHaveBeenCalledTimes(1);
    cap.stop();
  });

  it('a lost fight says "Not yet", keeps the Grudge List and states the rematch rule; the third loss offers the Assisted Gate', async () => {
    await makeTestStore({ save: { progress: { station: 4, gateAttempts: { 4: 2 } } }, cards: stationCards({ mature: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 3, loader, available: all });
    await mountReady(plan);
    click(hanko());
    await settle(2);
    const r = current();
    for (let bi = 0; bi < plan.blocks.length; bi++) {
      click(hanko());
      answerBlock(r, plan, bi, false);
    }
    await settle(2);
    expect(root.querySelector('.gate-view')?.getAttribute('data-outcome')).toBe('fail');
    expect(text()).toContain('Not yet. The gate will still be here.');
    expect(text()).toContain('Train 20 more Grudge reps today');
    expect(store.progress.value.grudge.length).toBeGreaterThan(0);
    // the fight's own misses are not Grudge training; reps logged after the fight are
    expect(grudgeRepsSince(r.done.value!.endedAt)).toBe(0);
    expect(grudgeRepsSince(0)).toBeGreaterThan(0);
    expect(store.progress.value.stationsCleared).not.toContain(4);
    expect(root.querySelectorAll('.gate-grudge .chip').length).toBeGreaterThan(0);
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Fight again')).toBe(false);
    // third non-pass → Assisted Gate on offer, with its banner
    expect(store.progress.value.gateAttempts[4]).toBe(3);
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Assisted Gate')).toBe(true);
    expect(text()).toContain('threshold 80 percent');
    expect(text()).not.toMatch(/\blives?\b|\bhearts?\b|♥|❤/i);
  });

  it('leaving mid-fight abandons the run and keeps the station unchanged', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ mature: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 4, loader, available: all });
    const onExit = await mountReady(plan);
    click(hanko());
    await settle(2);
    const r = current();
    click(hanko());
    answer(r, true);
    // the hosted view's own Leave reaches the gate's exit
    click(root.querySelector('[data-stub-exit]'));
    await settle(1);
    expect(onExit).toHaveBeenCalled();
    expect(r.abandoned.value).toBe(true);
    expect(store.progress.value.stationsCleared).not.toContain(4);
  });
});

describe('helpers', () => {
  it('itemHead, phaseIndexOf and missesIn', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ mature: true }) });
    expect(itemHead(loader.get(V.飲む), V.飲む)).toBe('飲む');
    expect(itemHead(loader.get('j-食'), 'j-食')).toBe('食');
    expect(itemHead(loader.get('g-n5-001'), 'g-n5-001')).toBe('〜です');
    expect(itemHead(undefined, 'x')).toBe('x');
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 5, loader, available: all });
    const last = plan.steps[plan.steps.length - 1]!;
    expect(phaseIndexOf(plan, plan.steps[0])).toBe(0);
    expect(phaseIndexOf(plan, last)).toBe(plan.blocks.length - 1);
    expect(phaseIndexOf(plan, null)).toBe(-1);
    const first = plan.steps[0]!;
    const results = [{ stepId: first.id, cardKey: first.cardKey, rating: 1 as const, ki: 0, combo: 0, ippon: false, kiai: false, xpDelta: 0, correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 1000, errorTags: [] }];
    const misses = missesIn(plan, results, plan.blocks[0]!.stepIds);
    expect(misses).toEqual(first.itemId ? [first.itemId] : []);
    expect(missesIn(plan, [], plan.blocks[0]!.stepIds)).toEqual([]);
  });
});

describe('<GateView> and the training snapshot (design 03 §12, 04 §11)', () => {
  it('entering a fight leaves a kept Kata snapshot untouched; unmounting mid-fight abandons the run', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ mature: true }) });
    const kata: SessionPlan = { id: 'kata-kept', mode: 'kata', day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 4, steps: [], blocks: [], meta: { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] } };
    store.session.save({ schema: 'tsuzuku.session/1', plan: { ...kata, steps: [{ id: 'k1', block: 'reviews', exercise: 'meaning-recall', itemId: V.犬, cardKey: `${V.犬}#rec`, params: { answer: 'dog' }, timed: false, isNew: false, stepTag: null, exposures: 3, estMs: 5000 }] }, cursor: 0, results: [], kiai: { ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] } });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 6, loader, available: all });
    await mountReady(plan);
    click(hanko());
    await settle(2);
    const r = current();
    click(hanko());
    answer(r, true);
    expect(store.session.load()?.plan.id).toBe('kata-kept');
    expect(store.session.load()?.plan.mode).toBe('kata');
    const cap = captureEvents();
    act(() => render(null, root));
    expect(r.abandoned.value).toBe(true);
    expect(cap.events.some((e) => e[0] === 'session:abandoned')).toBe(true);
    expect(store.session.load()?.plan.id).toBe('kata-kept');
    cap.stop();
    expect(Runner.resume({ loader })?.plan.id).toBe('kata-kept');
  });

  it('after a loss the result screen and a fresh intro agree on the rematch rule', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ mature: true }) });
    const plan = await buildGate(4, { assisted: false, revenge: false, seed: 9, loader, available: all });
    await mountReady(plan);
    click(hanko());
    await settle(2);
    const r = current();
    for (let bi = 0; bi < plan.blocks.length; bi++) {
      click(hanko());
      answerBlock(r, plan, bi, false);
    }
    await settle(2);
    // the fight's own Again rows are not Grudge training: the result screen and the engine agree the rematch is locked
    expect(text()).toContain('Train 20 more Grudge reps today');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Fight again')).toBe(false);
    expect(rematchAllowed(4)).toMatchObject({ allowed: false, grudgeRepsNeeded: 20 });
    act(() => render(null, root));
    await mountReady(plan);
    expect(root.querySelector('.gate-view')?.getAttribute('data-stage')).toBe('intro');
    expect(text()).not.toContain(ES.rematchOpen);
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Face the Gatekeeper')).toBe(false);
  });
});
