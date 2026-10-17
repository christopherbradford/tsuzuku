/**
 * GatePage.tsx — route param → GateView; stations off the road show a calm not-found.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeLoader } from '../../content/fixtures';
import { bus } from '../../shared/events';
import { resetStoreForTests } from '../../store';
import { makeTestStore } from '../../store/testing';
import type { SessionViewComponent } from '../ScrollView';
import GatePage from './GatePage';

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

describe('<GatePage>', () => {
  it('renders the Gatekeeper view for the station in the route', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    act(() => render(<GatePage route={{ name: 'gate', n: 4 }} loader={loader} view={Stub} />, root));
    await settle();
    const view = root.querySelector('.gate-view');
    expect(view).not.toBeNull();
    expect(view?.getAttribute('data-stage')).toBe('intro');
    expect(root.textContent).toContain('坂の関守');
    expect(root.textContent).toContain('Hill Keeper');
    // nothing introduced yet → the gate is honestly not open
    expect(root.textContent).toContain('The gate is not open yet.');
    expect(root.querySelector('.hanko')).toBeNull();
  });

  it('a station off the road shows a calm not-found', async () => {
    await makeTestStore();
    act(() => render(<GatePage route={{ name: 'gate', n: 99 }} loader={loader} view={Stub} />, root));
    expect(root.querySelector('.notice')?.textContent).toContain('Not on this road.');
    expect(root.querySelector('a[href="#/road"]')).not.toBeNull();
    expect(root.querySelector('.gate-view')).toBeNull();
  });

  it('a non-gate route is a not-found too', async () => {
    await makeTestStore();
    act(() => render(<GatePage route={{ name: 'dojo' }} loader={loader} view={Stub} />, root));
    expect(root.querySelector('.notice')?.textContent).toContain('Not on this road.');
  });
});
