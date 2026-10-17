/**
 * TSUZUKU — `#/shinsa/:belt` → `<ShinsaView>`; leaving returns to the belt's
 * exam station (the last station of the belt; design 02 §1).
 */
import type { JSX } from 'preact';
import type { ContentLoader } from '../../content/loader';
import { BELT_IDS } from '../../content/types';
import { href, navigate, type Route } from '../../shared/routes';
import { beltStations } from '../../store/derived';
import type { SessionViewComponent } from '../ScrollView';
import { ShinsaView } from '../ShinsaView';
import { S } from './strings';
import './pages.css';

export interface ShinsaPageProps {
  route: Route;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
}

export default function ShinsaPage(p: ShinsaPageProps): JSX.Element {
  const belt = p.route.name === 'shinsa' && (BELT_IDS as readonly string[]).includes(p.route.belt) ? p.route.belt : null;
  if (!belt) {
    return (
      <section class="page page--shinsa" aria-label={S.shinsaAria}>
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
  const station = beltStations(belt)[1];
  return (
    <section class="page page--shinsa" aria-label={S.shinsaAria}>
      <ShinsaView belt={belt} onExit={() => navigate({ name: 'station', n: station })} loader={p.loader} view={p.view} />
    </section>
  );
}
