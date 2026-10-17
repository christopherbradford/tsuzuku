/**
 * MichikusaStep.tsx — emits once, adds to collections.michikusa, "again" for a collected fragment.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_IDS, createFakeLoader } from '../content/fixtures';
import { installServices, nullAudio, resetServices } from '../shared/audio';
import { bus } from '../shared/events';
import { resetStoreForTests, store } from '../store';
import { captureEvents, makeTestStore } from '../store/testing';
import { MichikusaStep, collectMichikusa } from './MichikusaStep';

const loader = createFakeLoader();
const PROVERB = 'm-04-2';
const HISTORY = 'm-04-1';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  bus.reset();
});

function mount(p: Parameters<typeof MichikusaStep>[0]): void {
  act(() => render(<MichikusaStep {...p} />, root));
}

const click = (el: Element | null): void => {
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

describe('<MichikusaStep>', () => {
  it('renders the fragment with ruby and emits michikusa:read once on Continue, adding it to the Library', async () => {
    await makeTestStore();
    const cap = captureEvents();
    const onDone = vi.fn();
    mount({ id: PROVERB, onDone, loader });
    expect(root.querySelector('.michikusa__title')?.textContent).toBe('Dumplings over flowers');
    expect(root.querySelector('.michikusa__ja ruby')).not.toBeNull();
    expect(root.querySelector('.michikusa__kana')?.textContent).toBe('はなよりだんご');
    expect(root.querySelector('.michikusa__state')?.textContent).toBe('New fragment');
    expect(root.querySelector('.michikusa')?.getAttribute('data-again')).toBeNull();
    expect(root.querySelector('.michikusa__kind')?.textContent).toBe('Proverb');

    const btn = root.querySelector('.michikusa__continue');
    click(btn);
    click(btn);
    expect(onDone).toHaveBeenCalledTimes(1);
    const reads = cap.events.filter((e) => e[0] === 'michikusa:read');
    expect(reads).toHaveLength(1);
    expect(reads[0]![1]).toEqual({ id: PROVERB });
    expect(store.collections.value.michikusa).toEqual([PROVERB]);
    cap.stop();
  });

  it('a collected fragment is flagged again and emits nothing (no XP)', async () => {
    await makeTestStore({ save: { collections: { michikusa: [HISTORY] } } });
    const cap = captureEvents();
    const onDone = vi.fn();
    mount({ id: HISTORY, onDone, loader });
    expect(root.querySelector('.michikusa')?.getAttribute('data-again')).toBe('true');
    expect(root.querySelector('.michikusa__state')?.textContent).toContain('Again');
    expect(root.querySelector('.michikusa__source')?.textContent).toContain('Hiroshige');
    click(root.querySelector('.michikusa__continue'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(cap.events.filter((e) => e[0] === 'michikusa:read')).toHaveLength(0);
    expect(store.collections.value.michikusa).toEqual([HISTORY]);
    cap.stop();
  });

  it('Listen speaks the plain surface with the kana reading', async () => {
    await makeTestStore();
    const speak = vi.fn(() => Promise.resolve());
    installServices({ audio: { ...nullAudio, speak } });
    mount({ id: PROVERB, onDone: () => undefined, loader });
    click(root.querySelector('.michikusa__listen'));
    expect(speak).toHaveBeenCalledWith('花より団子', { kana: 'はなよりだんご' });
    // A fragment without a quote has no Listen button.
    mount({ id: HISTORY, onDone: () => undefined, loader });
    expect(root.querySelector('.michikusa__listen')).toBeNull();
  });

  it('an unknown id degrades to a calm missing line and Continue still works without writing anything', async () => {
    await makeTestStore();
    const cap = captureEvents();
    const onDone = vi.fn();
    mount({ id: 'm-99-9', onDone, loader });
    await act(async () => {
      await Promise.resolve();
    });
    expect(root.querySelector('[role="status"]')?.textContent).toBe('This fragment is not on the road yet. The next one will be.');
    click(root.querySelector('.michikusa__continue'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(cap.events.filter((e) => e[0] === 'michikusa:read')).toHaveLength(0);
    expect(store.collections.value.michikusa).toEqual([]);
    cap.stop();
  });

  it('collectMichikusa is idempotent', async () => {
    await makeTestStore();
    const cap = captureEvents();
    expect(collectMichikusa(FIXTURE_IDS.michikusa[0]!)).toBe(true);
    expect(collectMichikusa(FIXTURE_IDS.michikusa[0]!)).toBe(false);
    expect(cap.events.filter((e) => e[0] === 'michikusa:read')).toHaveLength(1);
    expect(store.collections.value.michikusa).toHaveLength(1);
    cap.stop();
  });

  it('the Continue button is focused on mount for keyboard users', async () => {
    await makeTestStore();
    mount({ id: PROVERB, onDone: () => undefined, loader });
    expect(document.activeElement).toBe(root.querySelector('.michikusa__continue'));
  });
});
