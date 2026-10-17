/**
 * TSUZUKU — Weak Point heat map (弱点, design 05 §7) for Records.
 *
 * One cell per error tag (14), shaded by its smoothed error rate (EWMA),
 * with the attempt count, the peak while active, and a marker for tags in
 * training (active: > 20 % with ≥ 15 attempts) or conquered (peaked above
 * 20 %, now under 5 %). Tags with too few attempts say so instead of
 * shading a number nobody should trust. When any tag is active the block
 * links to the Weak Point set (`train/weak`). Copy is calibration, never
 * alarm: a weak point is a thing to train, not a failure.
 */
import type { JSX } from 'preact';
import { ERROR_TAGS, type ErrorTag } from '../content/types';
import { href } from '../shared/routes';
import type { WeakPoints } from '../shared/store-types';
import { TAG_LABEL, fill } from '../shared/ui/strings';
import { store } from '../store';
import { WEAK_ACTIVATE, WEAK_CONQUERED, WEAK_MIN_N, activeTags, conqueredTags } from '../store/weak-points';
import { HeatGrid, type HeatRow } from './charts';
import { S } from './strings';
import './WeakPointMap.css';

export interface WeakCell extends HeatRow {
  tag: ErrorTag;
  /** Enough attempts for the rate to mean something. */
  measured: boolean;
}

/** Pure: the 14 cells, active tags first (most severe first), then the rest by rate. */
export function weakCells(w: WeakPoints): WeakCell[] {
  const active = new Set(activeTags(w));
  const conquered = new Set(conqueredTags(w));
  const cells = ERROR_TAGS.map((tag): WeakCell => {
    const p = w[tag] ?? { n: 0, ewma: 0, active: false, peak: 0 };
    const measured = p.n >= WEAK_MIN_N;
    const pct = Math.round(p.ewma * 100);
    const label = TAG_LABEL[tag];
    const sub = measured ? fill(S.weakAttempts, { n: p.n }) : p.n > 0 ? S.weakTooFew : fill(S.weakAttempts, { n: 0 });
    const peak = p.peak > WEAK_ACTIVATE ? fill(S.weakPeak, { pct: Math.round(p.peak * 100) }) : '';
    return {
      tag,
      label,
      value: measured ? pct : 0,
      sub: peak ? `${sub} · ${peak}` : sub,
      marker: active.has(tag) ? S.weakActive : conquered.has(tag) ? S.weakConquered : undefined,
      active: active.has(tag),
      measured,
      title: fill(S.weakCellLabel, { tag: label, pct, n: p.n }),
    };
  });
  cells.sort((a, b) => Number(b.active) - Number(a.active) || b.value - a.value || (w[b.tag]?.n ?? 0) - (w[a.tag]?.n ?? 0));
  return cells;
}

export function WeakPointMap(): JSX.Element {
  const w = store.weakPoints.value;
  const cells = weakCells(w);
  const active = cells.filter((c) => c.active);
  return (
    <section class="weakmap" aria-labelledby="weakmap-title">
      <header class="weakmap__head">
        <h2 id="weakmap-title" class="weakmap__title">
          <span lang="ja">{S.weakTitleJa}</span> <span class="weakmap__title-en">{S.weakTitle}</span>
        </h2>
        <p class="weakmap__lede">{S.weakLede}</p>
      </header>
      {active.length === 0 ? <p class="weakmap__none">{S.weakNoneActive}</p> : null}
      <HeatGrid rows={cells} caption={S.weakTitle} />
      {active.length > 0 ? (
        <p class="weakmap__cta">
          <a class="btn" href={href({ name: 'train', mode: 'weak' })}>
            {S.weakTrain}
          </a>
          <span class="weakmap__cta-tags">{active.map((c) => c.label).join(' · ')}</span>
        </p>
      ) : null}
      <p class="weakmap__legend">
        <span class="tag">{S.weakActive}</span> {fill(S.percent, { n: Math.round(WEAK_ACTIVATE * 100) })} · {fill(S.weakAttempts, { n: WEAK_MIN_N })}
        {'  '}
        <span class="tag">{S.weakConquered}</span> {fill(S.percent, { n: Math.round(WEAK_CONQUERED * 100) })}
      </p>
    </section>
  );
}
