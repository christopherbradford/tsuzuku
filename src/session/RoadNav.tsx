/**
 * TSUZUKU — `<RoadNav>`: the Tōkaidō as a scrolling vertical road (design 01
 * §4.4 "Road Nav", 02 §1, 06 §4).
 *
 *  - 53 stations from `STATIONS`, Nihonbashi above, Sanjō Ōhashi below; belt
 *    bands separate the segments and the road itself is painted in the belt’s
 *    colour (`[data-belt]` → `--belt-color`, components.css).
 *  - Marker per state: cleared = vermilion goshuin seal (gold frame when
 *    perfect, grey corner when assisted), current = lantern, ahead = grey
 *    milestone with the name still readable. Each station carries a seeded
 *    vignette (hill / pine / torii / wave) drawn from `rngFor('road', id)`.
 *  - Every station is a real link (`href()`), one roving tab stop; arrow keys
 *    walk the road, Home/End jump, Enter/Space open. The current station
 *    scrolls into view on mount.
 *  - A "where am I" line summarises the position for screen readers and eyes.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BELTS, STATIONS, type Belt, type StationDef } from '../content/types';
import { rngFor, uniform, weighted, type Rng } from '../shared/hash';
import { href } from '../shared/routes';
import { BELT_NAME } from './engine-strings';
import { S, fill } from './pages/strings';
import './RoadNav.css';

export interface RoadNavProps {
  /** Current station 0–53 (0 = Nihonbashi, nothing started). */
  current: number;
  cleared: number[];
  assisted: number[];
  /** Additive: stations passed at 100 % (gold frame). */
  perfect?: number[];
  onPick(n: number): void;
}

export type StationState = 'cleared' | 'perfect' | 'assisted' | 'current' | 'locked';

export function stationState(n: number, p: Pick<RoadNavProps, 'current' | 'cleared' | 'assisted' | 'perfect'>): StationState {
  if (p.cleared.includes(n)) {
    if (p.assisted.includes(n)) return 'assisted';
    if (p.perfect?.includes(n)) return 'perfect';
    return 'cleared';
  }
  return n === p.current ? 'current' : 'locked';
}

const STATE_LABEL: Record<StationState, string> = {
  cleared: S.stateCleared,
  perfect: S.statePerfect,
  assisted: S.stateAssisted,
  current: S.stateCurrent,
  locked: S.stateLocked,
};

/* ── seeded vignette ────────────────────────────────────────────────────── */

export type Motif = 'hill' | 'pine' | 'torii' | 'wave';
const MOTIFS: readonly Motif[] = ['hill', 'pine', 'torii', 'wave'];

export interface Vignette {
  motif: Motif;
  /** Background ridge, closed path in a 48 × 40 box. */
  hill: string;
  /** Motif strokes (path `d` strings). */
  strokes: string[];
  /** Motif fills (path `d` strings). */
  fills: string[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Deterministic per station id: the same hills every visit (design 06: seeds change detail, never value). */
export function vignetteFor(station: StationDef): Vignette {
  const rng: Rng = rngFor('road', station.id);
  const h1 = uniform(rng, 8, 16);
  const h2 = uniform(rng, 6, 14);
  const x1 = uniform(rng, 10, 20);
  const x2 = uniform(rng, 28, 38);
  const mid = (x1 + x2) / 2;
  const hill = `M0 34 Q${r1(x1)} ${r1(34 - h1)} ${r1(mid)} ${r1(34 - Math.min(h1, h2) / 2)} Q${r1(x2)} ${r1(34 - h2)} 48 34 Z`;
  const motif = MOTIFS[weighted(rng, [3, 2, 1, 1])] ?? 'hill';
  const x = r1(uniform(rng, 14, 34));
  const strokes: string[] = [];
  const fills: string[] = [];
  switch (motif) {
    case 'pine':
      strokes.push(`M${x} 34 V26`);
      fills.push(`M${r1(x - 7)} 27 L${x} 17 L${r1(x + 7)} 27 Z`, `M${r1(x - 5)} 21 L${x} 13 L${r1(x + 5)} 21 Z`);
      break;
    case 'torii':
      strokes.push(`M${r1(x - 6)} 34 V19 M${r1(x + 6)} 34 V19`, `M${r1(x - 10)} 19 H${r1(x + 10)}`, `M${r1(x - 7)} 24 H${r1(x + 7)}`);
      break;
    case 'wave':
      strokes.push('M0 31 Q6 25 12 31 T24 31 T36 31 T48 31', 'M6 36 Q12 31 18 36 T30 36 T42 36');
      break;
    default: {
      const cx = r1(uniform(rng, 8, 40));
      fills.push(`M${cx} 12 a4 4 0 1 0 0.1 0 Z`);
    }
  }
  return { motif, hill, strokes, fills };
}

/* ── component ──────────────────────────────────────────────────────────── */

const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

function levelLabel(b: (typeof BELTS)[number]): string {
  return b.level === 'kana' ? S.levelKana : b.level.toUpperCase();
}

export function RoadNav(p: RoadNavProps): JSX.Element {
  const current = Math.max(0, Math.min(53, Math.floor(p.current)));
  const focusStation = current >= 1 ? current : 1;
  const [focusN, setFocusN] = useState(focusStation);
  const links = useRef(new Map<number, HTMLAnchorElement>());
  const vignettes = useMemo(() => new Map(STATIONS.map((st) => [st.number, vignetteFor(st)])), []);

  useEffect(() => {
    setFocusN(focusStation);
    const el = links.current.get(focusStation);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [focusStation]);

  const clearedCount = STATIONS.filter((st) => p.cleared.includes(st.number)).length;
  const currentDef = STATIONS.find((st) => st.number === current);
  const belt: Belt = currentDef?.belt ?? 'white';
  const where = currentDef
    ? fill(S.whereAmI, { n: current, name: `${currentDef.nameJa} ${currentDef.nameRomaji}`, belt: BELT_NAME[belt], cleared: clearedCount })
    : fill(S.whereAmIStart, { belt: BELT_NAME[belt], cleared: clearedCount });

  const move = (from: number, to: number): void => {
    const target = Math.max(1, Math.min(53, to));
    if (target === from) return;
    setFocusN(target);
    links.current.get(target)?.focus();
  };

  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLElement>): void => {
    if (!NAV_KEYS.has(e.key)) return;
    const el = e.target as HTMLElement | null;
    const n = Number(el?.getAttribute?.('data-station'));
    if (!Number.isFinite(n) || n < 1) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') move(n, n + 1);
    else if (e.key === 'ArrowUp') move(n, n - 1);
    else if (e.key === 'Home') move(n, 1);
    else move(n, 53);
  };

  const rows: JSX.Element[] = [];
  for (const b of BELTS) {
    rows.push(
      <li key={`band-${b.id}`} class="tokaido__band" data-belt={b.id}>
        <span class={`belt belt--${b.id}`}>
          <span lang="ja">{b.nameJa}</span> {b.nameEn}
        </span>
        <span class="tokaido__band-line">{fill(S.bandLabel, { belt: b.nameEn, from: b.stations[0], to: b.stations[1], level: levelLabel(b) })}</span>
      </li>,
    );
    for (const st of STATIONS) {
      if (st.belt !== b.id) continue;
      const n = st.number;
      const state = stationState(n, p);
      const v = vignettes.get(n) as Vignette;
      const label = fill(S.stationAria, { n, name: st.nameJa, romaji: st.nameRomaji, belt: BELT_NAME[st.belt], state: STATE_LABEL[state] });
      const sealClass = state === 'locked' ? 'seal seal--locked' : state === 'perfect' ? 'seal seal--perfect' : state === 'assisted' ? 'seal tokaido__seal--assisted' : 'seal';
      rows.push(
        <li key={st.id} class="tokaido__row" data-belt={st.belt} data-state={state}>
          <a
            class="tokaido__station"
            href={href({ name: 'station', n })}
            data-station={n}
            data-state={state}
            aria-label={label}
            aria-current={state === 'current' ? 'step' : undefined}
            tabIndex={n === focusN ? 0 : -1}
            ref={(el) => {
              if (el) links.current.set(n, el);
              else links.current.delete(n);
            }}
            onClick={(e) => {
              e.preventDefault();
              setFocusN(n);
              p.onPick(n);
            }}
          >
            <span class="tokaido__marker" aria-hidden="true">
              {state === 'current' ? (
                <span class="tokaido__lantern" lang="ja">
                  {S.lanternGlyph}
                </span>
              ) : (
                <span class={sealClass} lang="ja">
                  {state === 'locked' ? n : S.stampGlyph}
                </span>
              )}
            </span>
            <svg class={`tokaido__art tokaido__art--${v.motif}`} viewBox="0 0 48 40" width="48" height="40" aria-hidden="true" focusable="false">
              <path class="tokaido__hill" d={v.hill} />
              {v.fills.map((d, i) => (
                <path key={`f${i}`} class="tokaido__fill" d={d} />
              ))}
              {v.strokes.map((d, i) => (
                <path key={`s${i}`} class="tokaido__stroke" d={d} />
              ))}
            </svg>
            <span class="tokaido__text">
              <span class="tokaido__name" lang="ja">
                {st.nameJa}
              </span>
              <span class="tokaido__romaji">
                {n} · {st.nameRomaji}
              </span>
              <span class="tokaido__keeper" lang="ja">
                {st.gateJa}
              </span>
            </span>
            {state === 'current' ? (
              <span class="tokaido__you">
                <span lang="ja" aria-hidden="true">
                  {S.travellerGlyph}
                </span>
                <span class="sr-only">{S.youAreHere}</span>
              </span>
            ) : null}
          </a>
          <span class="tokaido__gate" lang="ja" aria-hidden="true">
            {S.gateGlyph}
          </span>
        </li>,
      );
    }
  }

  return (
    <nav class="tokaido" aria-label={S.roadNavAria} data-belt={belt}>
      <p class="tokaido__where" aria-live="polite">
        {where}
      </p>
      <p class="tokaido__hint">{S.keyboardHint}</p>
      <div class="tokaido__node tokaido__node--start" data-belt="white">
        <span class="seal seal--round" lang="ja" aria-hidden="true">
          橋
        </span>
        <span>{S.startNode}</span>
      </div>
      <ol class="tokaido__list" onKeyDown={onKey}>
        {rows}
      </ol>
      <div class="tokaido__node tokaido__node--arrival" data-belt="black">
        <span class="seal seal--round" lang="ja" aria-hidden="true">
          京
        </span>
        <span>{S.arrivalNode}</span>
      </div>
    </nav>
  );
}
