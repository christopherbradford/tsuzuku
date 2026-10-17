import { signal } from '@preact/signals';
import { render, type FunctionComponent } from 'preact';
import { act } from 'preact/test-utils';
import { navigate, syncRouteFromLocation, type Route } from '@/shared/routes';
import { resetStoreForTests } from '@/store';
import { makeTestStore } from '@/store/testing';
import { S } from '@/i18n/strings';
import { App, ErrorBoundary } from './App';
import type { PageModule } from './pages';

const Shows: FunctionComponent<{ route: Route }> = (p) => <h2 id="page">{p.route.name}</h2>;
const Throws: FunctionComponent<{ route: Route }> = () => {
  throw new Error('page boom');
};

const pages = async (r: Route): Promise<PageModule> => {
  if (r.name === 'records') return { Page: Throws };
  if (r.name === 'library') throw new Error('not built');
  if (r.name === 'about') return { Page: Shows, props: { extra: 1 } };
  return { Page: Shows };
};

let root: HTMLDivElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  vi.restoreAllMocks();
});

describe('<App>', () => {
  it('shows the loading state until store.ready, then the layout and the page', async () => {
    resetStoreForTests();
    act(() => render(<App pageFor={pages} />, root));
    expect(root.querySelector('.app-loading')?.textContent).toContain(S.loading);
    expect(root.querySelector('.layout')).toBeNull();
    await act(async () => {
      await makeTestStore();
    });
    await flush();
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
  });

  it('swaps the page on route change and passes injected props', async () => {
    await makeTestStore();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
    act(() => navigate({ name: 'about' }));
    await flush();
    expect(root.querySelector('#page')?.textContent).toBe('about');
    act(() => navigate({ name: 'settings' }));
    await flush();
    expect(root.querySelector('#page')?.textContent).toBe('settings');
  });

  it('keeps the previous page dimmed while the next one loads', async () => {
    await makeTestStore();
    let release: (() => void) | null = null;
    const slow = async (r: Route): Promise<PageModule> => {
      if (r.name === 'road') await new Promise<void>((res) => (release = res));
      return { Page: Shows };
    };
    act(() => render(<App pageFor={slow} />, root));
    await flush();
    act(() => navigate({ name: 'road' }));
    expect(root.querySelector('.page-stale #page')?.textContent).toBe('road');
    release!();
    await flush();
    expect(root.querySelector('.page-stale')).toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('road');
  });

  it('the error boundary catches a throwing page: "Rest. Reload." with a reload button; nav survives', async () => {
    await makeTestStore();
    const reload = vi.fn();
    act(() => render(<App pageFor={pages} reload={reload} />, root));
    await flush();
    act(() => navigate({ name: 'records' }));
    await flush();
    const fallback = root.querySelector('.app-error');
    expect(fallback?.querySelector('h1')?.textContent).toBe('Rest. Reload.');
    expect(fallback?.textContent).toContain(S.errorBody);
    expect(fallback?.textContent).toContain('page boom');
    const btn = fallback?.querySelector<HTMLButtonElement>('.app-error__reload');
    expect(btn?.textContent).toBe(S.reload);
    act(() => btn?.click());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.nav')).not.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    // navigating away resets the boundary
    act(() => navigate({ name: 'about' }));
    await flush();
    expect(root.querySelector('.app-error')).toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('about');
  });

  it('a page module that fails to load shows the calm missing-room state with a retry', async () => {
    await makeTestStore();
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    act(() => navigate({ name: 'library' }));
    await flush();
    const err = root.querySelector('.page-error');
    expect(err?.textContent).toContain(S.pageMissing);
    expect(err?.textContent).toContain('not built');
    expect(err?.querySelector('a')?.getAttribute('href')).toBe('#/');
    expect(err?.querySelector('button')?.textContent).toBe(S.reload);
  });

  it('renders overlays, and a throwing overlay is swallowed silently', async () => {
    await makeTestStore();
    const Overlay: FunctionComponent = () => <div id="overlay" />;
    const Bad: FunctionComponent = () => {
      throw new Error('overlay boom');
    };
    act(() => render(<App pageFor={pages} overlays={[Overlay, Bad]} />, root));
    await flush();
    expect(root.querySelector('#overlay')).not.toBeNull();
    expect(root.querySelector('.app-error')).toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
  });

  it('overlays handed over as a signal mount when the art barrel resolves after first paint', async () => {
    await makeTestStore();
    const Overlay: FunctionComponent = () => <div id="overlay" />;
    const overlays = signal<FunctionComponent[]>([]);
    act(() => render(<App pageFor={pages} overlays={overlays} />, root));
    await flush();
    expect(root.querySelector('#overlay')).toBeNull();
    act(() => {
      overlays.value = [Overlay];
    });
    await flush();
    expect(root.querySelector('#overlay')).not.toBeNull();
    expect(root.querySelector('#page')?.textContent).toBe('dojo');
  });

  it('applies the theme to the document while mounted', async () => {
    await makeTestStore({ save: { settings: { feel: 'arcade' } } });
    act(() => render(<App pageFor={pages} />, root));
    await flush();
    expect(document.documentElement.getAttribute('data-feel')).toBe('arcade');
    expect(document.body.classList.contains('feel-arcade')).toBe(true);
  });
});

describe('<ErrorBoundary>', () => {
  it('renders children when nothing throws and nothing in silent mode on error', () => {
    act(() =>
      render(
        <ErrorBoundary>
          <span id="ok" />
        </ErrorBoundary>,
        root,
      ),
    );
    expect(root.querySelector('#ok')).not.toBeNull();
    act(() =>
      render(
        <ErrorBoundary silent>
          <Throws route={{ name: 'dojo' }} />
        </ErrorBoundary>,
        root,
      ),
    );
    expect(root.textContent).toBe('');
  });
});
