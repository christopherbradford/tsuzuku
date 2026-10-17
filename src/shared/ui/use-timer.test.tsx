import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useTimer, type TimerHandle } from './use-timer';

let root: HTMLDivElement;
let clock = 0;
const now = (): number => clock;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
  setVisibility('visible');
});

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

let handle: TimerHandle | null = null;
function Harness(p: { running: boolean; deadline?: number; startedAt?: number; onTimeout?: () => void }) {
  handle = useTimer({
    running: p.running,
    deadlineMs: p.deadline,
    startedAt: p.startedAt,
    now,
    tickMs: 100,
    onTimeout: p.onTimeout,
  });
  return <span data-elapsed={handle.elapsed.value}>{Math.round(handle.progress.value * 100)}</span>;
}

/** Advance the injected clock and the interval together. */
function tick(ms: number): void {
  clock += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useTimer', () => {
  it('counts elapsed time only while running', () => {
    act(() => render(<Harness running />, root));
    const h = handle as TimerHandle;
    tick(500);
    expect(h.elapsed.value).toBe(500);
    act(() => render(<Harness running={false} />, root));
    tick(500);
    expect(h.elapsed.value).toBe(500);
    act(() => render(<Harness running />, root));
    tick(250);
    expect(h.elapsed.value).toBe(750);
  });

  it('pauses while the document is hidden', () => {
    act(() => render(<Harness running />, root));
    const h = handle as TimerHandle;
    tick(300);
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    tick(1000);
    expect(h.elapsed.value).toBe(300);
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    tick(200);
    expect(h.elapsed.value).toBe(500);
  });

  it('progress clamps to 1, timedOut flips once, onTimeout fires once', () => {
    const onTimeout = vi.fn();
    act(() => render(<Harness running deadline={1000} onTimeout={onTimeout} />, root));
    const h = handle as TimerHandle;
    tick(500);
    expect(h.progress.value).toBeCloseTo(0.5);
    expect(h.remaining.value).toBe(500);
    expect(h.timedOut.value).toBe(false);
    tick(1500);
    expect(h.progress.value).toBe(1);
    expect(h.remaining.value).toBe(0);
    expect(h.timedOut.value).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    tick(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe('100');
  });

  it('pause()/resume() and reset()', () => {
    act(() => render(<Harness running deadline={1000} />, root));
    const h = handle as TimerHandle;
    tick(400);
    act(() => h.pause());
    expect(h.paused.value).toBe(true);
    tick(400);
    expect(h.elapsed.value).toBe(400);
    act(() => h.resume());
    tick(100);
    expect(h.elapsed.value).toBe(500);
    act(() => h.reset());
    expect(h.elapsed.value).toBe(0);
    expect(h.timedOut.value).toBe(false);
    tick(1200);
    expect(h.timedOut.value).toBe(true);
  });

  it('startedAt back-dates the start on the injected clock', () => {
    clock = 5000;
    act(() => render(<Harness running startedAt={4000} />, root));
    const h = handle as TimerHandle;
    expect(h.elapsed.value).toBe(1000);
    tick(100);
    expect(h.elapsed.value).toBe(1100);
    act(() => h.reset(5000));
    expect(h.elapsed.value).toBe(100);
  });

  it('without a deadline progress stays 0', () => {
    act(() => render(<Harness running />, root));
    const h = handle as TimerHandle;
    tick(3000);
    expect(h.progress.value).toBe(0);
    expect(h.remaining.value).toBe(0);
    expect(h.timedOut.value).toBe(false);
  });
});
