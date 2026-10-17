import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { FeedbackState } from '../exercise-types';
import type { Step } from '../session-types';
import { ExerciseFrame, useExerciseKeys, type ExerciseFrameProps } from './ExerciseFrame';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const step = (over: Partial<Step> = {}): Step => ({
  id: 's1',
  block: 'reviews',
  exercise: 'meaning-guard',
  itemId: 'v-n5-0001',
  cardKey: 'v-n5-0001#rec',
  params: { choices: ['a', 'b', 'c', 'd'] },
  timed: true,
  timerMs: 4000,
  isNew: false,
  stepTag: null,
  exposures: 3,
  estMs: 6000,
  ...over,
});

const feedback = (over: Partial<FeedbackState> = {}): FeedbackState => ({
  kind: 'correct',
  correct: 'ねこ',
  errorTags: [],
  rating: 3,
  ippon: false,
  kiai: false,
  xpDelta: 2,
  ...over,
});

interface Spies {
  onGuard: ReturnType<typeof vi.fn>;
  onHint: ReturnType<typeof vi.fn>;
  onPause: ReturnType<typeof vi.fn>;
  onContinue: ReturnType<typeof vi.fn>;
  onReplay: ReturnType<typeof vi.fn>;
  onChoice: ReturnType<typeof vi.fn>;
  onResume: ReturnType<typeof vi.fn>;
}

function spies(): Spies {
  return {
    onGuard: vi.fn(),
    onHint: vi.fn(),
    onPause: vi.fn(),
    onContinue: vi.fn(),
    onReplay: vi.fn(),
    onChoice: vi.fn(),
    onResume: vi.fn(),
  };
}

function props(s: Spies, over: Partial<ExerciseFrameProps> = {}): ExerciseFrameProps {
  return {
    step: step(),
    index: 2,
    total: 20,
    ki: 40,
    combo: 12,
    comboTier: 1,
    timer: { ms: 4000, startedAt: 0 },
    feel: 'dojo',
    feedback: null,
    now: () => 0,
    children: <div class="exercise">drill</div>,
    ...s,
    ...over,
  };
}

function mount(p: ExerciseFrameProps): void {
  act(() => render(<ExerciseFrame {...p} />, root));
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

describe('<ExerciseFrame> keys', () => {
  it('Shift+Enter → onGuard, ? → onHint, Esc → onPause (overlay) and Esc again resumes', () => {
    const s = spies();
    mount(props(s));
    press('Enter', { shiftKey: true });
    expect(s.onGuard).toHaveBeenCalledTimes(1);
    press('?', { shiftKey: true });
    expect(s.onHint).toHaveBeenCalledTimes(1);

    press('Escape');
    expect(s.onPause).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.pause-overlay')).not.toBeNull();
    expect(root.querySelector('.exercise-frame')?.getAttribute('data-paused')).toBe('true');
    // other keys are swallowed while paused
    press('?');
    expect(s.onHint).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(root.querySelector('.pause-overlay')).toBeNull();
    expect(s.onResume).toHaveBeenCalledTimes(1);
    expect(s.onPause).toHaveBeenCalledTimes(1);
  });

  it('digits pick a choice through the context handler (0-based), falling back to the onChoice prop', () => {
    const s = spies();
    const picked = vi.fn();
    function Child() {
      useExerciseKeys({ onChoice: picked });
      return <div>child</div>;
    }
    mount(props(s, { children: <Child /> }));
    const e = press('3');
    expect(picked).toHaveBeenCalledWith(2);
    expect(s.onChoice).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);

    mount(props(s));
    press('1');
    expect(s.onChoice).toHaveBeenCalledWith(0);
    // digits typed into an input are left alone
    const input = document.createElement('input');
    root.appendChild(input);
    const e2 = press('2', {}, input);
    expect(e2.defaultPrevented).toBe(false);
    expect(s.onChoice).toHaveBeenCalledTimes(1);
  });

  it('Space replays when no feedback is shown; registered handler wins over the prop', () => {
    const s = spies();
    mount(props(s));
    press(' ');
    expect(s.onReplay).toHaveBeenCalledTimes(1);
    const replay = vi.fn();
    function Child() {
      useExerciseKeys({ onReplay: replay });
      return null;
    }
    mount(props(s, { children: <Child /> }));
    press(' ');
    expect(replay).toHaveBeenCalledTimes(1);
    expect(s.onReplay).toHaveBeenCalledTimes(1);
  });

  it('feedback shown: Enter/Space → onContinue (even from an input), digits/hint/guard inert', () => {
    const s = spies();
    mount(props(s, { feedback: feedback() }));
    expect(root.querySelector('.feedback')).not.toBeNull();
    expect(root.querySelector('.hanko')?.textContent).toContain('Continue');
    press('1');
    press('?');
    press('Enter', { shiftKey: true });
    expect(s.onChoice).not.toHaveBeenCalled();
    expect(s.onHint).not.toHaveBeenCalled();
    expect(s.onGuard).not.toHaveBeenCalled();

    const e = press('Enter');
    expect(s.onContinue).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    press(' ');
    expect(s.onContinue).toHaveBeenCalledTimes(2);

    const input = document.createElement('input');
    root.appendChild(input);
    const e2 = press('Enter', {}, input);
    expect(e2.defaultPrevented).toBe(true);
    expect(s.onContinue).toHaveBeenCalledTimes(3);
  });

  it('Enter without feedback is left to inputs and reaches a registered onSubmit otherwise', () => {
    const s = spies();
    const submit = vi.fn();
    function Child() {
      useExerciseKeys({ onSubmit: submit });
      return <input class="x" />;
    }
    mount(props(s, { children: <Child /> }));
    const input = root.querySelector('input.x') as HTMLInputElement;
    const e = press('Enter', {}, input);
    expect(e.defaultPrevented).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    press('Enter');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(s.onContinue).not.toHaveBeenCalled();
  });

  it('ignores modifier combos and key repeat', () => {
    const s = spies();
    mount(props(s));
    press('?', { metaKey: true });
    press('?', { repeat: true });
    expect(s.onHint).not.toHaveBeenCalled();
  });
});

describe('<ExerciseFrame> HUD', () => {
  it('Dojo shows ki bar, combo with tier and the speed ring for a timed step', () => {
    const s = spies();
    mount(props(s));
    expect(root.querySelector('.ki-bar')?.getAttribute('aria-valuenow')).toBe('40');
    const combo = root.querySelector('.combo');
    expect(combo?.getAttribute('data-tier')).toBe('1');
    expect(combo?.textContent).toContain('12');
    expect(root.querySelector('.speed-ring')).not.toBeNull();
    expect(root.querySelector('.exercise-frame__progress')?.textContent).toContain('3 / 20');
  });

  it('Zen hides ki, combo and timer', () => {
    const s = spies();
    mount(props(s, { feel: 'zen' }));
    expect(root.querySelector('.ki-bar')).toBeNull();
    expect(root.querySelector('.combo')).toBeNull();
    expect(root.querySelector('.speed-ring')).toBeNull();
    expect(root.querySelector('.exercise-frame')?.getAttribute('data-feel')).toBe('zen');
  });

  it('timer ring only when step.timed and a timer is given; combo hidden at 0', () => {
    const s = spies();
    mount(props(s, { step: step({ timed: false }), combo: 0, comboTier: 0 }));
    expect(root.querySelector('.speed-ring')).toBeNull();
    expect(root.querySelector('.combo')).toBeNull();
    mount(props(s, { timer: null }));
    expect(root.querySelector('.speed-ring')).toBeNull();
  });

  it('the ring follows the injected clock and reports onTimeout once', () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const s = spies();
      const onTimeout = vi.fn();
      mount(props(s, { now: () => t, timer: { ms: 1000, startedAt: 0 }, onTimeout }));
      t = 600;
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(root.querySelector('.speed-ring__text')?.textContent).toBe('1');
      t = 1200;
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(root.querySelector('.speed-ring')?.getAttribute('data-timed-out')).toBe('true');
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('controls swap: Guard/Hint before feedback, Continue after; live region announces', () => {
    const s = spies();
    mount(props(s));
    const labels = Array.from(root.querySelectorAll('.exercise-frame__controls button')).map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes("Don't know"))).toBe(true);
    expect(labels.some((l) => l.includes('Hint'))).toBe(true);
    expect(labels.some((l) => l.includes('Continue'))).toBe(false);
    (root.querySelector('.exercise-frame__controls button') as HTMLButtonElement).click();
    expect(s.onGuard).toHaveBeenCalledTimes(1);

    mount(props(s, { feedback: feedback({ kind: 'wrong', given: 'ねご', promotion: 'green' }) }));
    const after = Array.from(root.querySelectorAll('.exercise-frame__controls button')).map((b) => b.textContent ?? '');
    expect(after.some((l) => l.includes('Continue'))).toBe(true);
    expect(after.some((l) => l.includes('Hint'))).toBe(false);
    const live = root.querySelector('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toContain("Again. That's the training.");
    expect(live?.textContent).toContain('Green');
  });

  it('step chips: New and the step tag', () => {
    const s = spies();
    mount(props(s, { step: step({ isNew: true, stepTag: 'recovery' }) }));
    const chips = Array.from(root.querySelectorAll('.exercise-frame__tag')).map((c) => c.textContent);
    expect(chips).toEqual(['New', 'Recovery']);
  });
});
