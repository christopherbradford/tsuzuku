/**
 * TSUZUKU — <MonCrest>: one badge crest, inline and labelled (design 06 §2).
 *
 * Renders `monSvg` for a badge id with an accessible label, an optional
 * caption (name, the unlock condition while locked, the earned day once
 * earned) and a tooltip. Names and conditions come from `BADGE_DEFS`
 * (`store/defs-strings`); this component only adds the framing copy from
 * `./mon-strings`. The SVG uses `cssVars` so the gold ring and the accent
 * follow the page theme.
 *
 *  <MonCrest id="kyoto" earned size={128} earnedOn={day} />
 *  <MonCrest id="zen" earned={false} />            // grey stone + condition
 *  <MonCrest id="ippon" earned slam caption={false} />   // ceremony use
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { BadgeId } from '../shared/catalog';
import type { EpochDay } from '../shared/store-types';
import { formatEraDate, isoDate } from '../shared/time';
import { BADGE_DEFS } from '../store';
import type { Theme } from './color';
import { MON_SPECS, clampMonSize, monSeed, monSvg } from './mon';
import { S } from './mon-strings';
import { fill } from './strings';
import './MonCrest.css';

export interface MonCrestProps {
  id: BadgeId;
  earned: boolean;
  /** Rendered px (default 96; design range 48–256). */
  size?: number;
  /** Condition text for a locked crest; defaults to the badge's own rule. */
  describe?: string;
  /** Day the badge was earned → tooltip and caption date (Japanese era format). */
  earnedOn?: EpochDay;
  /** Show the caption under the crest (default true). */
  caption?: boolean;
  /** Add the hanko-slam entrance (−6°, 300 ms; opacity-only under reduced motion). */
  slam?: boolean;
  /** Theme the hex fallbacks are resolved for (the inline crest follows CSS tokens anyway). */
  theme?: Theme;
  class?: string;
}

export const MON_DEFAULT_SIZE = 96;
export const MON_SLAM_CLASS = 'mon--slam';

const BY_ID = new Map(BADGE_DEFS.map((d) => [d.id, d] as const));

export interface MonCrestText {
  nameEn: string;
  nameJa: string;
  /** The unlock rule in plain words. */
  condition: string;
  /** `令和8年10月17日` when `earnedOn` is known. */
  date: string | null;
  /** aria-label for the crest. */
  label: string;
  /** `title` tooltip. */
  tooltip: string;
}

/** Every string the component shows, so hosts (BadgeSlam, MonGrid) can reuse them. */
export function monCrestText(p: Pick<MonCrestProps, 'id' | 'earned' | 'describe' | 'earnedOn'>): MonCrestText {
  const def = BY_ID.get(p.id);
  const nameEn = def?.nameEn ?? p.id;
  const nameJa = def?.nameJa ?? '';
  const condition = p.describe ?? def?.describe ?? S.notYet;
  const date = p.earnedOn === undefined ? null : formatEraDate(p.earnedOn);
  const name = nameJa ? `${nameEn} ${nameJa}` : nameEn;
  let label: string;
  let tooltip: string;
  if (p.earned) {
    label = date ? fill(S.crestEarnedOn, { name, date }) : fill(S.crestEarned, { name });
    tooltip = date ? fill(S.earnedOn, { date }) : nameEn;
  } else {
    label = fill(S.crestLocked, { name, condition });
    tooltip = condition;
  }
  return { nameEn, nameJa, condition, date, label, tooltip };
}

export function MonCrest(p: MonCrestProps): JSX.Element {
  const size = clampMonSize(p.size ?? MON_DEFAULT_SIZE);
  const spec = MON_SPECS[p.id];
  const t = monCrestText(p);
  const svg = useMemo(
    () => monSvg(spec, { size, earned: p.earned, seed: monSeed(p.id), theme: p.theme, cssVars: true }),
    [spec, size, p.earned, p.id, p.theme],
  );
  const classes = ['mon', p.earned ? 'mon--earned' : 'mon--locked', `mon--${spec.ring}`, p.slam ? MON_SLAM_CLASS : '', p.class ?? ''].filter(Boolean).join(' ');
  const showCaption = p.caption ?? true;
  return (
    <figure class={classes} data-badge={p.id} data-tier={spec.ring} data-earned={p.earned ? 'true' : 'false'} title={t.tooltip}>
      <div class="mon__svg" role="img" aria-label={t.label} style={{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML={{ __html: svg }} />
      {showCaption && (
        <figcaption class="mon__caption">
          <span class="mon__name">{t.nameEn}</span>
          {t.nameJa && (
            <span class="mon__ja" lang="ja">
              {t.nameJa}
            </span>
          )}
          {!p.earned && <span class="mon__condition">{t.condition}</span>}
          {p.earned && p.earnedOn !== undefined && (
            <time class="mon__date" lang="ja" dateTime={isoDate(p.earnedOn)}>
              {t.date}
            </time>
          )}
        </figcaption>
      )}
    </figure>
  );
}
