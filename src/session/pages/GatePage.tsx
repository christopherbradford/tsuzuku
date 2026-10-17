/**
 * TSUZUKU — `#/gate/:n` → `<GateView>`; leaving returns to the station.
 * Stations outside 1–53 show a calm not-found.
 */
import type { JSX } from 'preact';
import type { ContentLoader } from '../../content/loader';
import { href, navigate, type Route } from '../../shared/routes';
import { GateView } from '../GateView';
import type { SessionViewComponent } from '../ScrollView';
import { S } from './strings';
import './pages.css';

export interface GatePageProps {
  route: Route;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
}

export default function GatePage(p: GatePageProps): JSX.Element {
  const n = p.route.name === 'gate' ? p.route.n : 0;
  if (n < 1 || n > 53) {
    return (
      <section class="page page--gate" aria-label={S.gateAria}>
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
  return (
    <section class="page page--gate" aria-label={S.gateAria}>
      <GateView station={n} onExit={() => navigate({ name: 'station', n })} loader={p.loader} view={p.view} />
    </section>
  );
}
