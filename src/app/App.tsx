/**
 * TSUZUKU — root component (group A).
 *
 * Waits for `store.ready`, keeps the document's theme/feel classes in sync,
 * renders `<Layout>` around the page resolved by `pages.ts` for the current
 * route, mounts injected overlays (ceremonies) and wraps everything in an
 * error boundary with the "Rest. Reload." copy. A page that throws takes
 * down only the page area: the nav keeps working and the next navigation
 * resets the boundary.
 */
import type { ReadonlySignal } from '@preact/signals';
import { Component, type ComponentChildren, type FunctionComponent, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { href, route, sameRoute, type Route } from '@/shared/routes';
import { store } from '@/store';
import { S } from '@/i18n/strings';
import { Layout } from './Layout';
import { pageFor as defaultPageFor, type PageModule } from './pages';
import { restoreScroll } from './router';
import { startThemeSync } from './theme';
import './App.css';

export interface AppProps {
  /** Overlay components rendered above the layout (G's CeremonyHost); a signal lets main.tsx add them after first paint. */
  overlays?: FunctionComponent[] | ReadonlySignal<FunctionComponent[]>;
  /** Page resolver; defaults to `pages.pageFor` (tests inject their own). */
  pageFor?: (r: Route) => Promise<PageModule>;
  /** Defaults to `location.reload()`. */
  reload?: () => void;
}

function defaultReload(): void {
  if (typeof location !== 'undefined') location.reload();
}

/* ── error boundary ──────────────────────────────────────────────────── */

interface BoundaryProps {
  children: ComponentChildren;
  /** Render nothing on error (decorative overlays). */
  silent?: boolean;
  reload?: () => void;
  /** Called when the learner chooses "Back to the dojo". */
  onHome?: () => void;
}
interface BoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown): void {
    console.error('[app] page crashed', error);
  }

  render(): ComponentChildren {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <section class="app-error status-window" role="alert" aria-labelledby="app-error-title">
        <h1 id="app-error-title" class="app-error__title">
          {S.errorTitle}
        </h1>
        <p class="app-error__body">{S.errorBody}</p>
        <details class="app-error__details">
          <summary>{S.errorDetails}</summary>
          <pre class="app-error__message">{error.message}</pre>
        </details>
        <div class="app-error__actions">
          <button type="button" class="hanko app-error__reload" onClick={() => (this.props.reload ?? defaultReload)()}>
            {S.reload}
          </button>
          <a
            class="btn btn--ghost"
            href={href({ name: 'dojo' })}
            onClick={() => {
              this.setState({ error: null });
              this.props.onHome?.();
            }}
          >
            {S.backToDojo}
          </a>
        </div>
      </section>
    );
  }
}

/* ── page host ───────────────────────────────────────────────────────── */

interface Loaded {
  key: string;
  Page: PageModule['Page'];
  props: Record<string, unknown>;
}

function PageHost(p: { pageFor: (r: Route) => Promise<PageModule>; reload?: () => void }): JSX.Element {
  const r = route.value;
  const key = href(r);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    p.pageFor(r).then(
      (mod) => {
        if (!alive || !sameRoute(route.peek(), r)) return;
        setLoaded({ key, Page: mod.Page, props: mod.props ?? {} });
        restoreScroll(r);
      },
      (err: unknown) => {
        if (!alive) return;
        console.warn('[app] page failed to load', err);
        setFailed({ key, message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      alive = false;
    };
  }, [key, attempt]);

  if (failed && failed.key === key) {
    return (
      <section class="page-error status-window" role="alert">
        <p class="page-error__text">{S.pageMissing}</p>
        <details class="app-error__details">
          <summary>{S.errorDetails}</summary>
          <pre class="app-error__message">{failed.message}</pre>
        </details>
        <div class="app-error__actions">
          <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)}>
            {S.reload}
          </button>
          <a class="btn btn--ghost" href={href({ name: 'dojo' })}>
            {S.backToDojo}
          </a>
        </div>
      </section>
    );
  }

  const current = loaded && loaded.key === key ? loaded : null;
  const stale = loaded && loaded.key !== key ? loaded : null;
  return (
    <>
      {current ? (
        <ErrorBoundary key={current.key} reload={p.reload}>
          <current.Page route={r} {...current.props} />
        </ErrorBoundary>
      ) : stale ? (
        <div class="page-stale" aria-busy="true">
          <ErrorBoundary key={stale.key} silent>
            <stale.Page route={r} {...stale.props} />
          </ErrorBoundary>
        </div>
      ) : (
        <p class="page-loading muted" role="status" aria-live="polite">
          {S.pageLoading}
        </p>
      )}
      {!current ? <span class="visually-hidden" role="status">{S.pageLoading}</span> : null}
    </>
  );
}

/* ── root ────────────────────────────────────────────────────────────── */

export function App(p: AppProps): JSX.Element {
  const ready = store.ready.value;
  useEffect(() => startThemeSync(), []);

  if (!ready) {
    return (
      <div class="app-loading" role="status" aria-live="polite">
        <span class="app-loading__mark brush" lang="ja" aria-hidden="true">
          {S.appNameJa}
        </span>
        <span class="app-loading__text">{S.loading}</span>
      </div>
    );
  }

  const overlays = p.overlays === undefined ? [] : Array.isArray(p.overlays) ? p.overlays : p.overlays.value;
  return (
    <ErrorBoundary reload={p.reload}>
      <Layout>
        <PageHost pageFor={p.pageFor ?? defaultPageFor} reload={p.reload} />
      </Layout>
      {overlays.map((Overlay, i) => (
        <ErrorBoundary key={i} silent>
          <Overlay />
        </ErrorBoundary>
      ))}
    </ErrorBoundary>
  );
}
