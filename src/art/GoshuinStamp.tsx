/**
 * TSUZUKU — <GoshuinStamp>: one station's goshuin, inline and labelled
 * (design 06 §4).
 *
 * Looks the station up by number, seeds the stamp from the profile seed
 * (`hashSeed(store.seed(), 'goshuin', station)`) so every learner's book is
 * their own, and renders `goshuinSvg` with `cssVars` so the vermilion, gold
 * and grey follow the page theme. `pressed` adds the stamp-press entrance
 * (`GOSHUIN_PRESS_CLASS`) that StampPress can trigger; the thump itself is
 * the host's job (`sfx('stamp')`).
 *
 *  <GoshuinStamp station={7} at={day} perfect={false} assisted={false} />
 *  <GoshuinStamp station={7} at={day} perfect assisted={false} pressed size={240} />
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { hashSeed } from '../shared/hash';
import type { EpochDay } from '../shared/store-types';
import { formatEraDate, isoDate } from '../shared/time';
import { store } from '../store';
import type { Theme } from './color';
import { clampGoshuinSize, goshuinLabel, goshuinSvg, stationByNumber } from './goshuin';
import { S } from './mon-strings';
import { fill } from './strings';
import './GoshuinStamp.css';

export interface GoshuinStampProps {
  /** Station number 1–53. */
  station: number;
  /** Day the gate was cleared. */
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
  /** Rendered px (default 160). */
  size?: number;
  /** Play the press entrance (300 ms; opacity-only under reduced motion). */
  pressed?: boolean;
  /** Show a caption (name, number · romaji, date) under the stamp (default false). */
  caption?: boolean;
  /** Draw a washi page behind the stamp (default transparent). */
  paper?: boolean;
  /** Override the seed (previews, tests); default from the profile seed. */
  seed?: number;
  /** Theme the hex fallbacks resolve for (the inline stamp follows CSS tokens anyway). */
  theme?: Theme;
  class?: string;
}

export const GOSHUIN_DEFAULT_SIZE = 160;
export const GOSHUIN_PRESS_CLASS = 'goshuin--pressed';

/** The stamp seed of a station for a profile: stable per learner, distinct per station. */
export function goshuinSeed(station: number, profileSeed: string = store.seed()): number {
  return hashSeed(profileSeed, 'goshuin', station);
}

export function GoshuinStamp(p: GoshuinStampProps): JSX.Element {
  const size = clampGoshuinSize(p.size ?? GOSHUIN_DEFAULT_SIZE);
  const st = stationByNumber(p.station);
  const seed = p.seed ?? (st ? goshuinSeed(st.number) : 0);
  const svg = useMemo(
    () => (st ? goshuinSvg({ station: st, at: p.at, perfect: p.perfect, assisted: p.assisted, seed, size, theme: p.theme, cssVars: true, paper: p.paper }) : ''),
    [st, p.at, p.perfect, p.assisted, seed, size, p.theme, p.paper],
  );
  if (!st) {
    return (
      <figure class={['goshuin', 'goshuin--missing', p.class ?? ''].filter(Boolean).join(' ')} role="note" data-station={p.station}>
        <figcaption class="goshuin__caption">{fill(S.stampUnknown, { n: p.station })}</figcaption>
      </figure>
    );
  }
  const date = formatEraDate(p.at);
  const label = goshuinLabel(st, p.at, p.perfect, p.assisted);
  const tooltip = fill(S.stampTooltip, { n: st.number, romaji: st.nameRomaji, date });
  const classes = ['goshuin', p.perfect ? 'goshuin--perfect' : '', p.assisted ? 'goshuin--assisted' : '', p.pressed ? GOSHUIN_PRESS_CLASS : '', p.class ?? ''].filter(Boolean).join(' ');
  return (
    <figure class={classes} data-station={st.number} data-perfect={p.perfect ? 'true' : 'false'} data-assisted={p.assisted ? 'true' : 'false'} title={tooltip}>
      <div class="goshuin__svg" role="img" aria-label={label} style={{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML={{ __html: svg }} />
      {p.caption && (
        <figcaption class="goshuin__caption">
          <span class="goshuin__name" lang="ja">
            {st.nameJa}
          </span>
          <span class="goshuin__romaji">
            {st.number} · {st.nameRomaji}
          </span>
          <time class="goshuin__date" lang="ja" dateTime={isoDate(p.at)}>
            {date}
          </time>
          {p.perfect && <span class="goshuin__note">{S.stampPerfect}</span>}
          {p.assisted && <span class="goshuin__note">{S.stampAssisted}</span>}
        </figcaption>
      )}
    </figure>
  );
}
