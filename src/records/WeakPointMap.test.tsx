import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ERROR_TAGS } from '../content/types';
import { bus } from '../shared/events';
import { findBanned } from '../i18n/banned-phrases';
import type { WeakPoints } from '../shared/store-types';
import { resetStoreForTests, store } from '../store/store';
import { makeTestStore } from '../store/testing';
import { WeakPointMap, weakCells } from './WeakPointMap';

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

function mount(): void {
  act(() => render(<WeakPointMap />, root));
}

describe('<WeakPointMap>', () => {
  it('renders all 14 tags, highlights the active ones first and links to the Weak Point set', async () => {
    await makeTestStore({
      save: {
        weakPoints: {
          particle: { n: 40, ewma: 0.31, active: true, peak: 0.35 },
          voicing: { n: 20, ewma: 0.24, active: true, peak: 0.24 },
          pitch: { n: 30, ewma: 0.03, active: false, peak: 0.28 },
          'word-order': { n: 4, ewma: 0.6, active: false, peak: 0 },
        },
      },
    });
    mount();
    const cells = Array.from(root.querySelectorAll('.heat__cell'));
    expect(cells).toHaveLength(ERROR_TAGS.length);
    expect(cells[0]?.querySelector('.heat__label')?.textContent).toBe('particle');
    expect(cells[1]?.querySelector('.heat__label')?.textContent).toBe('voicing');
    expect(root.querySelectorAll('.heat__cell--active')).toHaveLength(2);
    expect(cells[0]?.querySelector('.heat__marker')?.textContent).toBe('in training');
    const conquered = cells.find((c) => c.querySelector('.heat__label')?.textContent === 'pitch');
    expect(conquered?.querySelector('.heat__marker')?.textContent).toBe('conquered');
    expect(conquered?.querySelector('.heat__sub')?.textContent).toContain('peak 28 %');
    const link = root.querySelector('a.btn') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#/train/weak');
    expect(link.textContent).toBe('Train a Weak Point set');
    expect(root.querySelector('.weakmap__none')).toBeNull();
  });

  it('a tag with too few attempts is not shaded and says so', async () => {
    await makeTestStore({ save: { weakPoints: { 'word-order': { n: 4, ewma: 0.6, active: false, peak: 0 } } } });
    mount();
    const cell = Array.from(root.querySelectorAll('.heat__cell')).find((c) => c.querySelector('.heat__label')?.textContent === 'word order') as HTMLElement;
    expect(cell.style.getPropertyValue('--heat')).toBe('0');
    expect(cell.querySelector('.heat__sub')?.textContent).toBe('too few attempts to say');
  });

  it('with nothing active it shows the calm empty line and no link', async () => {
    await makeTestStore();
    mount();
    expect(root.querySelector('.weakmap__none')?.textContent).toBe('No weak points right now. The map fills in as you train.');
    expect(root.querySelector('a.btn')).toBeNull();
    expect(root.querySelectorAll('.heat__cell')).toHaveLength(14);
  });

  it('copy is never red-alarm: no banned phrase, no exclamation marks, no "fail"', async () => {
    await makeTestStore({ save: { weakPoints: { particle: { n: 40, ewma: 0.5, active: true, peak: 0.5 } } } });
    mount();
    const text = root.textContent ?? '';
    expect(findBanned(text)).toEqual([]);
    expect(text).not.toContain('!');
    expect(text.toLowerCase()).not.toMatch(/\bfail/);
  });

  it('re-renders when the slice changes', async () => {
    await makeTestStore();
    mount();
    expect(root.querySelectorAll('.heat__cell--active')).toHaveLength(0);
    act(() => {
      store.patch('weakPoints', (w) => ({ ...w, listening: { n: 20, ewma: 0.3, active: true, peak: 0.3 } }));
    });
    expect(root.querySelectorAll('.heat__cell--active')).toHaveLength(1);
    expect(root.querySelector('.weakmap__cta-tags')?.textContent).toBe('listening');
  });

  it('weakCells is pure and tolerant of a missing tag entry', () => {
    const partial = { particle: { n: 20, ewma: 0.25, active: true, peak: 0.25 } } as unknown as WeakPoints;
    const cells = weakCells(partial);
    expect(cells).toHaveLength(14);
    expect(cells[0]?.tag).toBe('particle');
    expect(cells[0]?.value).toBe(25);
    expect(cells.every((c) => Number.isFinite(c.value))).toBe(true);
  });
});
