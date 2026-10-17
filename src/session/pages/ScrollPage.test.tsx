/**
 * ScrollPage.tsx — route param → ScrollView; a malformed id shows a calm not-found.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STATION_4, createFakeLoader } from '../../content/fixtures';
import { bus } from '../../shared/events';
import { resetStoreForTests } from '../../store';
import { makeTestStore } from '../../store/testing';
import { scrollsForStation } from '../../learn';
import type { SessionViewComponent } from '../ScrollView';
import ScrollPage from './ScrollPage';

const loader = createFakeLoader();
const Stub: SessionViewComponent = () => <div data-stub="view" />;

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

const settle = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

describe('<ScrollPage>', () => {
  it('a malformed id shows a calm not-found with a way back to the road', async () => {
    await makeTestStore();
    act(() => render(<ScrollPage route={{ name: 'scroll', id: 'not-a-scroll' }} loader={loader} view={Stub} />, root));
    expect(root.querySelector('.notice')?.textContent).toContain('Not on this road.');
    expect(root.querySelector('a[href="#/road"]')).not.toBeNull();
    expect(root.querySelector('.scroll-view')).toBeNull();
    expect(root.textContent).not.toMatch(/error|oops/i);
  });

  it('an id of the right shape at a station without content shows the scroll view’s own not-found', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    act(() => render(<ScrollPage route={{ name: 'scroll', id: '9-1' }} loader={loader} view={Stub} />, root));
    await settle();
    expect(root.querySelector('.scroll-view .notice')?.textContent).toContain('No scroll by that name');
  });

  it('a valid id renders the scroll (cards or pretest) for that station', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const id = scrollsForStation(STATION_4, (x) => loader.get(x)).find((s) => s.kind === 'vocab')!.id;
    act(() => render(<ScrollPage route={{ name: 'scroll', id }} loader={loader} view={Stub} />, root));
    expect(root.querySelector('.scroll-view[aria-busy="true"]')).not.toBeNull();
    await settle();
    const view = root.querySelector('.scroll-view');
    expect(view).not.toBeNull();
    expect(['pretest', 'teach']).toContain(view?.getAttribute('data-phase'));
    // the heading carries the scroll's ordinal (as the Station page names it), never the raw `<station>-<n>` id
    expect(root.textContent).toContain(`Scroll ${id.split('-')[1]}`);
    expect(root.textContent).not.toContain(`Scroll ${id}`);
  });

  it('a non-scroll route is a not-found too', async () => {
    await makeTestStore();
    act(() => render(<ScrollPage route={{ name: 'road' }} loader={loader} view={Stub} />, root));
    expect(root.querySelector('.notice')?.textContent).toContain('Not on this road.');
  });
});
