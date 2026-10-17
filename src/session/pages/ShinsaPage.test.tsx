/**
 * ShinsaPage.tsx — route belt → ShinsaView; White's honest "no exam"; a bad route is a not-found.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Belt } from '../../content/types';
import { createFakeLoader } from '../../content/fixtures';
import { bus } from '../../shared/events';
import { resetStoreForTests } from '../../store';
import { makeTestStore } from '../../store/testing';
import type { SessionViewComponent } from '../ScrollView';
import ShinsaPage from './ShinsaPage';

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

describe('<ShinsaPage>', () => {
  it('renders the exam view for the belt in the route with its eligibility', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    act(() => render(<ShinsaPage route={{ name: 'shinsa', belt: 'yellow' }} loader={loader} view={Stub} />, root));
    await settle();
    const view = root.querySelector('.shinsa-view');
    expect(view).not.toBeNull();
    expect(view?.getAttribute('data-stage')).toBe('eligibility');
    expect(root.textContent).toContain('Yellow belt exam');
    expect(root.textContent).toContain('Pass every Gatekeeper of the Yellow belt first.');
  });

  it('White has no exam and says so', async () => {
    await makeTestStore();
    act(() => render(<ShinsaPage route={{ name: 'shinsa', belt: 'white' }} loader={loader} view={Stub} />, root));
    await settle();
    expect(root.textContent).toContain('The White belt has no exam');
  });

  it('an unknown belt or a non-shinsa route is a calm not-found', async () => {
    await makeTestStore();
    act(() => render(<ShinsaPage route={{ name: 'shinsa', belt: 'plaid' as Belt }} loader={loader} view={Stub} />, root));
    expect(root.querySelector('.notice')?.textContent).toContain('Not on this road.');
    act(() => render(<ShinsaPage route={{ name: 'records' }} loader={loader} view={Stub} />, root));
    expect(root.querySelector('.notice')?.textContent).toContain('Not on this road.');
    expect(root.querySelector('a[href="#/road"]')).not.toBeNull();
  });
});
