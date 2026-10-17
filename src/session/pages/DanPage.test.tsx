/**
 * DanPage.tsx — locked before Shodan, criteria rows with now/target bars, promotion when every criterion holds, the gauntlet run.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeLoader } from '../../content/fixtures';
import { bus } from '../../shared/events';
import type { SessionPlan, Step } from '../../shared/session-types';
import { epochDay } from '../../shared/time';
import { resetStoreForTests, store } from '../../store';
import { DEFAULT_TEST_NOW, makeTestStore } from '../../store/testing';
import type { SessionRunner } from '../runner';
import type { SessionViewComponent } from '../ScrollView';
import DanPage, { Criterion } from './DanPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

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

const settle = async (rounds = 4): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

const captured: { runner: SessionRunner | null } = { runner: null };
const Stub: SessionViewComponent = ({ runner }) => <div data-stub="view">{runner.step.value?.id ?? ''}</div>;
const text = (): string => root.textContent ?? '';
const click = (el: Element | null): void => {
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

function gauntletPlan(): SessionPlan {
  const steps: Step[] = [
    { id: 'dan:2:input', block: 'input', exercise: 'story-read', itemId: 's-04-1', cardKey: null, params: { storyId: 's-04-1' }, timed: false, isNew: false, stepTag: null, exposures: 1, estMs: 60000 },
    { id: 'dan:2:form:0', block: 'reviews', exercise: 'meaning-recall', itemId: 'v-n5-0006', cardKey: null, params: { answer: 'to eat', accept: ['to eat'] }, timed: false, isNew: false, stepTag: null, exposures: 3, estMs: 6000 },
  ];
  return {
    id: 'dan-test',
    mode: 'dan',
    day: TODAY,
    createdAt: DEFAULT_TEST_NOW,
    station: 53,
    steps,
    blocks: [
      { kind: 'input', label: 'Input', estMinutes: 4, stepIds: [steps[0]!.id] },
      { kind: 'reviews', label: 'Dōjō Yaburi', estMinutes: 2, stepIds: [steps[1]!.id] },
    ],
    meta: { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [], storyId: 's-04-1' },
  };
}

async function mount(plan?: SessionPlan): Promise<void> {
  captured.runner = null;
  act(() =>
    render(
      <DanPage
        route={{ name: 'dan' }}
        loader={loader}
        available={() => true}
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
}

describe('<DanPage>', () => {
  it('is locked before the Shodan Shinsa', async () => {
    await makeTestStore();
    await mount();
    expect(text()).toContain('The Dan road opens after the Shodan Shinsa');
    expect(root.querySelector('a[href="#/road"]')).not.toBeNull();
    expect(root.querySelector('.dan-module')).toBeNull();
  });

  it('criteria rows render with now/target and the next module open', async () => {
    await makeTestStore({
      save: {
        profile: { dan: 1, belt: 'black' },
        stats: { threeWays: 60, threeWaysCorrect: 30, rolePlays: 5, rolePlaysAllBest: 2 },
        ledger: { entries: [[TODAY, 600, 0, 1]] },
      },
    });
    await mount();
    expect(text()).toContain('初段 Shodan');
    expect(text()).toContain('Next: 二段 Nidan');
    const modules = root.querySelectorAll('.dan-module');
    expect(modules).toHaveLength(9);
    const nidan = root.querySelector('.dan-module[data-dan="2"]')!;
    expect(nidan.getAttribute('data-current')).toBe('true');
    expect(nidan.getAttribute('data-ready')).toBe('false');
    const rows = Array.from(nidan.querySelectorAll('.dan-criterion'));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelector('.dan-criterion__count')?.textContent)).toEqual(['50 of 90', '40 of 80', '10 of 100']);
    expect(rows[0]?.querySelector('.dan-criterion__label')?.textContent).toContain('90 percent over the last 60');
    expect((rows[2]?.querySelector('.progress__fill') as HTMLElement).style.width).toBe('10%');
    expect(rows.every((r) => r.getAttribute('data-ok') === 'false')).toBe(true);
    // later modules are collapsed
    expect(root.querySelector('.dan-module[data-dan="3"] .dan-criterion')).toBeNull();
    expect(text()).toContain('nearest honest counter stands in');
    // the strand-share line is filled from blocks.STRAND_SHARES.dan (design 03 §5), as percentages
    expect(text()).toContain('Strand shares on the Dan road: 15 % form · 50 % input · 35 % output.');
    // no promotion offered yet
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Take the rank')).toBe(false);
  });

  it('offers the rank when every criterion holds and promotes on tap', async () => {
    await makeTestStore({
      save: {
        profile: { dan: 1, belt: 'black' },
        stats: { threeWays: 60, threeWaysCorrect: 54, rolePlays: 20, rolePlaysAllBest: 16 },
        ledger: { entries: [[TODAY, 100 * 60, 0, 1]] },
      },
    });
    await mount();
    expect(root.querySelector('.dan-module[data-dan="2"]')?.getAttribute('data-ready')).toBe('true');
    const take = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Take the rank');
    expect(take).toBeDefined();
    click(take ?? null);
    await settle(1);
    expect(store.profile.value.dan).toBe(2);
    expect(text()).toContain('Promoted to 二段 Nidan. The road continues.');
    expect(text()).toContain('Next: 三段 Sandan');
  });

  it('runs a gauntlet through the session view and returns to the list when done', async () => {
    await makeTestStore({ save: { profile: { dan: 1, belt: 'black' }, progress: { station: 53 } } });
    await mount(gauntletPlan());
    const start = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Start a gauntlet'));
    click(start ?? null);
    await settle(2);
    expect(root.querySelector('.page--dan')?.getAttribute('data-stage')).toBe('run');
    expect(root.querySelector('[data-stub="view"]')).not.toBeNull();
    const r = captured.runner as SessionRunner;
    let guard = 0;
    while (!r.done.value && r.step.value && guard++ < 5) {
      act(() => {
        r.submit({ correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 3000, errorTags: [], score: 1, selfRating: 3 });
        r.next();
      });
    }
    await settle(2);
    expect(root.querySelector('.page--dan')?.getAttribute('data-stage')).toBe('done');
    expect(text()).toContain('Gauntlet run.');
    expect(root.querySelectorAll('.dan-module')).toHaveLength(9);
  });

  it('Criterion caps the bar at 100 % and marks ok', async () => {
    await makeTestStore();
    act(() => render(<Criterion label="Ledger hours ≥ 100" now={130} target={100} ok />, root));
    expect((root.querySelector('.progress__fill') as HTMLElement).style.width).toBe('100%');
    expect(root.querySelector('.dan-criterion')?.getAttribute('data-ok')).toBe('true');
    expect(root.querySelector('.dan-criterion__count')?.textContent).toBe('130 of 100');
  });
});
