/**
 * TSUZUKU — `#/listen/:id` standalone Listening Arena page (design 04 §5, 07 §1).
 *
 * Wraps <ListeningArena> at the learner's speed tier
 * (`SPEED_TIER_RATES[settings.speedTier]`), with a way back (dojo, the set's
 * station) and, once the set is done, the natural next steps: listen again,
 * play the same dialogue as a role-play, read the episode. Ledger minutes
 * are NOT logged here: the Arena emits `listening:set` with `minutes`, and
 * B's `startLedger` turns that into the ledger row — logging again would
 * double-count.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import { SPEED_TIER_RATES } from '@/shared/audio';
import { stationOfId } from '@/shared/ids';
import { href, type Route } from '@/shared/routes';
import type { SpeedTier } from '@/shared/store-types';
import { store } from '@/store';
import { ListeningArena, isStoryItem, type ListeningArenaResult } from '../listening/ListeningArena';
import { S, fill } from '../listening/strings';
import './ListenPage.css';

/** The playback rate for a speed tier (the tier presets, design 07 §7). */
export function rateForTier(tier: SpeedTier): number {
  return SPEED_TIER_RATES[tier];
}

/** The `listen` route's id, or `''` for any other route (the Arena then shows its not-found state). */
export function listenIdOf(r: Route): string {
  return r.name === 'listen' ? r.id : '';
}

export interface ListenPageProps {
  route: Route;
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'get' | 'getAsync'>;
}

export default function ListenPage(p: ListenPageProps): JSX.Element {
  const id = listenIdOf(p.route);
  const loader = p.loader ?? content;
  const tier = store.settings.value.speedTier;
  const rate = rateForTier(tier);
  const station = id ? stationOfId(id) : undefined;
  const [result, setResult] = useState<ListeningArenaResult | null>(null);
  const [run, setRun] = useState(0);
  const story = loader.get(id);
  const isDialogue = isStoryItem(story) && story.kind === 'dialogue';

  return (
    <section class="listen-page" aria-label={S.title}>
      <nav class="listen-page__nav" aria-label={S.pageNav}>
        <a class="btn btn--ghost btn--sm" href={href({ name: 'dojo' })}>
          {S.pageBack}
        </a>
        {station !== undefined ? (
          <a class="btn btn--ghost btn--sm" href={href({ name: 'station', n: station })}>
            {fill(S.pageStation, { n: station })}
          </a>
        ) : null}
        <span class="listen-page__tier">{fill(S.pageTier, { tier, rate })}</span>
      </nav>

      <ListeningArena key={`${id}:${run}`} storyId={id} rate={rate} onDone={setResult} loader={loader} />

      {result ? (
        <nav class="listen-page__after" aria-label={S.pageNext}>
          <button
            type="button"
            class="btn"
            onClick={() => {
              setResult(null);
              setRun((n) => n + 1);
            }}
          >
            {S.pageAgain}
          </button>
          {isDialogue ? (
            <a class="btn" href={href({ name: 'taiwa', id })}>
              {S.pageRolePlay}
            </a>
          ) : null}
          <a class="btn" href={href({ name: 'story', id })}>
            {S.pageRead}
          </a>
          <a class="hanko" href={href({ name: 'dojo' })}>
            {S.pageBack}
          </a>
        </nav>
      ) : (
        <p class="listen-page__note">{S.pageLedger}</p>
      )}
    </section>
  );
}
