/**
 * TSUZUKU — `#/scroll/:id`: `<ScrollView>` for one scroll id (`<station>-<n>`
 * or `<station>-cap`). A malformed id shows a calm not-found; finishing or
 * leaving returns to the scroll's station.
 */
import type { JSX } from 'preact';
import type { ContentLoader } from '../../content/loader';
import { href, navigate, type Route } from '../../shared/routes';
import { ScrollView, parseScrollId, type SessionViewComponent } from '../ScrollView';
import { S } from './strings';
import './pages.css';

export interface ScrollPageProps {
  route: Route;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
}

export default function ScrollPage(p: ScrollPageProps): JSX.Element {
  const id = p.route.name === 'scroll' ? p.route.id : '';
  const ref = parseScrollId(id);
  if (!ref) {
    return (
      <section class="page page--scroll" aria-label={S.scrollAria}>
        <div class="notice">
          <h2>{S.notFoundTitle}</h2>
          <p>{S.notFoundBody}</p>
          <a class="btn" href={href({ name: 'road' })}>
            {S.backToRoad}
          </a>
        </div>
      </section>
    );
  }
  const back = (): void => navigate({ name: 'station', n: ref.station });
  return (
    <section class="page page--scroll" aria-label={S.scrollAria}>
      <ScrollView scrollId={id} onDone={back} onExit={back} loader={p.loader} view={p.view} />
    </section>
  );
}
