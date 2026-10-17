import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices } from '../../shared/audio';
import { makeTestStore } from '../../store/testing';
import {
  appendToSvg,
  currentFeel,
  isInteractive,
  loadGoshuinStamp,
  loadMon,
  loadMonCrest,
  loadWallpapers,
  playSfx,
  prefersReducedMotion,
  setLazyArtForTests,
  trapTab,
  useLazy,
  useTimeline,
} from './support';

let root: HTMLDivElement;
beforeEach(async () => {
  await makeTestStore();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  setLazyArtForTests(null);
  vi.useRealTimers();
});

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

describe('useTimeline', () => {
  function Probe(p: { at: readonly number[]; reduced: boolean; endAt?: number; onEnd?: () => void }): JSX.Element {
    const phase = useTimeline(p.at, { reduced: p.reduced, endAt: p.endAt, onEnd: p.onEnd });
    return <div data-phase={phase} />;
  }
  const phaseOf = (): string | null => root.querySelector('[data-phase]')?.getAttribute('data-phase') ?? null;

  it('advances through the phases in order and fires onEnd at endAt', () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    act(() => render(<Probe at={[0, 100, 300]} reduced={false} endAt={500} onEnd={onEnd} />, root));
    expect(phaseOf()).toBe('0');
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(phaseOf()).toBe('0');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(phaseOf()).toBe('1');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(phaseOf()).toBe('2');
    expect(onEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('reduced motion starts on the last phase (static card) but still completes at endAt', () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    act(() => render(<Probe at={[0, 100, 300]} reduced endAt={200} onEnd={onEnd} />, root));
    expect(phaseOf()).toBe('2');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('clears its timers on unmount', () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    act(() => render(<Probe at={[0, 100]} reduced={false} endAt={200} onEnd={onEnd} />, root));
    act(() => render(null, root));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('motion and feel', () => {
  it('prefersReducedMotion follows the store setting', async () => {
    expect(prefersReducedMotion()).toBe(false);
    await makeTestStore({ save: { settings: { reducedMotion: true } } });
    expect(prefersReducedMotion()).toBe(true);
  });

  it('playSfx goes through the audio slot except in Zen', async () => {
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    expect(currentFeel()).toBe('dojo');
    playSfx('badge');
    expect(sfx).toHaveBeenCalledWith('badge');
    await makeTestStore({ save: { settings: { feel: 'zen' } } });
    expect(currentFeel()).toBe('zen');
    playSfx('stamp');
    expect(sfx).toHaveBeenCalledTimes(1);
  });
});

describe('lazy sibling art', () => {
  it('serves injected doubles and treats null as "not built"', async () => {
    const Fake = (): JSX.Element => <i />;
    setLazyArtForTests({ MonCrest: Fake, GoshuinStamp: null, mon: null, wallpapers: null });
    expect(await loadMonCrest()).toBe(Fake);
    expect(await loadGoshuinStamp()).toBeNull();
    expect(await loadMon()).toBeNull();
    expect(await loadWallpapers()).toBeNull();
  });

  it('real loaders never throw: each resolves to a module or null', async () => {
    setLazyArtForTests(null);
    const results = await Promise.all([loadMonCrest(), loadGoshuinStamp(), loadMon(), loadWallpapers()]);
    expect(results[0] === null || typeof results[0] === 'function').toBe(true);
    expect(results[1] === null || typeof results[1] === 'function').toBe(true);
    expect(results[2] === null || typeof results[2]!.monSvg === 'function').toBe(true);
    expect(results[3] === null || typeof results[3]!.renderWallpaper === 'function').toBe(true);
  });

  it('useLazy resolves once and reports settled', async () => {
    const Fake = (): JSX.Element => <i />;
    setLazyArtForTests({ MonCrest: Fake });
    function Probe(): JSX.Element {
      const m = useLazy(loadMonCrest);
      return <div data-settled={String(m.settled)} data-has={String(m.value !== null)} />;
    }
    act(() => render(<Probe />, root));
    expect(root.querySelector('[data-settled]')?.getAttribute('data-settled')).toBe('false');
    await settle();
    const el = root.querySelector('[data-settled]')!;
    expect(el.getAttribute('data-settled')).toBe('true');
    expect(el.getAttribute('data-has')).toBe('true');
  });
});

describe('focus helpers', () => {
  it('isInteractive recognises controls and their descendants', () => {
    root.innerHTML = '<button><span id="in"></span></button><p id="out"></p><a id="plain"></a><a href="#/" id="link"></a>';
    expect(isInteractive(root.querySelector('#in'))).toBe(true);
    expect(isInteractive(root.querySelector('#out'))).toBe(false);
    expect(isInteractive(root.querySelector('#plain'))).toBe(false);
    expect(isInteractive(root.querySelector('#link'))).toBe(true);
    expect(isInteractive(null)).toBe(false);
  });

  it('trapTab wraps from the last control to the first and back', () => {
    root.innerHTML = '<div id="dlg" tabindex="-1"><button id="a">a</button><button id="b">b</button></div>';
    const dlg = root.querySelector<HTMLElement>('#dlg')!;
    const a = root.querySelector<HTMLElement>('#a')!;
    const b = root.querySelector<HTMLElement>('#b')!;
    b.focus();
    const fwd = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    trapTab(fwd, dlg);
    expect(fwd.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    trapTab(back, dlg);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
    dlg.focus();
    const fromDialog = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    trapTab(fromDialog, dlg);
    expect(document.activeElement).toBe(b);
  });

  it('appendToSvg injects before the closing tag', () => {
    expect(appendToSvg('<svg><g/></svg>', '<text>x</text>')).toBe('<svg><g/><text>x</text></svg>');
    expect(appendToSvg('not svg', '<x/>')).toBe('not svg');
  });
});
