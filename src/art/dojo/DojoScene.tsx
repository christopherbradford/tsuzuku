/**
 * TSUZUKU — `<DojoScene/>` (design 06 §5): the home-screen room composed
 * from store state and the real local time.
 *
 *  room (room.ts)     belt → tatami, chosen kanji → scroll, level → lanterns,
 *                     badge categories → Mon shelf, latest goshuin, Kage,
 *                     shōji sky by local hour, seasonal tree by month
 *  hearth (flames.ts) the Tsuzuku Flame state from `store/derived streakState`
 *  bonsai (bonsai.ts) total training days; blooms at 100; pruned after a gap
 *  kotodama (flames)  one flame per Black-belt item (counts from the cards)
 *
 * The SVG is a string rebuilt only when its inputs change (`useMemo` over a
 * key of every input), injected once; signals re-render the component, the
 * memo keeps the DOM still. Room first, flames after an idle slot. Hotspots
 * are real links (`href()`) over the picture: scroll → station, bonsai and
 * hearth → records, racks → collections. Colors are CSS tokens, so the scene
 * follows the page theme; motion respects `settings.reducedMotion` and the
 * Zen feel drops the glow.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { groupByItem, itemBelt, kindOfCards } from '@/learn';
import { STATIONS, type Belt, type CardKey, type Facet } from '../../content/types';
import type { BadgeId } from '../../shared/catalog';
import { hashSeed } from '../../shared/hash';
import { href, type Route } from '../../shared/routes';
import type { CardTuple, Collections, EpochDay, Feel, ItemKind, StampEntry } from '../../shared/store-types';
import { civilParts, weekOf } from '../../shared/time';
import { BADGE_DEFS, store, type FlameState } from '../../store';
import { streakState } from '../../store/derived';
import { svgDoc } from '../svg';
import { BLOOM_DAYS, bonsaiSvg } from './bonsai';
import { emptyCounts, flamesSvg, hearthStateOf, hearthSvg, type HearthState } from './flames';
import { MON_SLOTS, roomSvg, type RoomLayout, type Season, type SkyPhase } from './room';
import { BELT_NAME, S, fill } from './strings';
import './DojoScene.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const SCENE_SIZE = { full: { w: 960, h: 540 }, compact: { w: 960, h: 400 } } as const;
/** Kotodama rendered in the scene (DOM budget ≈ 400 nodes); the counter shows the true total. */
export const KOTODAMA_MAX = { full: 150, compact: 100 } as const;
/** Away days after which the bonsai looks pruned (design 03 §8 "Back from the Mountain"). */
export const PRUNED_AWAY_DAYS = 7;

const PHASE_TEXT: Record<SkyPhase, string> = { dawn: S.phaseDawn, day: S.phaseDay, dusk: S.phaseDusk, night: S.phaseNight };
const SEASON_TEXT: Record<Season, string> = { spring: S.seasonSpring, summer: S.seasonSummer, autumn: S.seasonAutumn, winter: S.seasonWinter };
const HEARTH_TEXT: Record<HearthState, string> = { unlit: S.hearthUnlit, ember: S.hearthEmber, steady: S.hearthSteady, roaring: S.hearthRoaring };

/* ────────────────────────────────────────────────────────────────────────── */
/* Inputs from the store                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SceneInputs {
  w: number;
  h: number;
  belt: Belt;
  level: number;
  dan: number;
  chosenKanji?: string;
  badgeCategories: number;
  latestStamp?: string;
  kageBeaten: boolean;
  hour: number;
  month: number;
  seed: string;
  today: EpochDay;
  totalDays: number;
  streak: number;
  blooming: boolean;
  pruned: boolean;
  counts: Record<ItemKind, number>;
  reducedMotion: boolean;
  feel: Feel;
  flame: FlameState;
  station: number;
  flamesMax: number;
}

interface CardWalk {
  forEach(fn: (k: CardKey, t: CardTuple) => void): void;
}

/** Black-belt items per kind (`learn/item-belt`): the kotodama counts. */
export function blackCounts(cards: CardWalk): Record<ItemKind, number> {
  const out = emptyCounts();
  for (const [itemId, facets] of groupByItem(cards)) {
    const kind = kindOfCards(itemId, Object.keys(facets) as Facet[]);
    if (!kind) continue;
    if (itemBelt(kind, facets) === 'black') out[kind]++;
  }
  return out;
}

const CATEGORY_OF: ReadonlyMap<string, string> = new Map(BADGE_DEFS.map((d) => [d.id, d.category] as const));

/** Distinct badge categories with at least one earned Mon (one shelf slot each). */
export function badgeCategoryCount(badges: Collections['badges']): number {
  const seen = new Set<string>();
  for (const id of Object.keys(badges) as BadgeId[]) {
    const c = CATEGORY_OF.get(id);
    if (c && badges[id] !== undefined) seen.add(c);
  }
  return seen.size;
}

/** Japanese name of the most recent goshuin (latest day; ties → the farther station). */
export function latestStampName(stamps: Record<number, StampEntry>): string | undefined {
  let bestN = -1;
  let bestAt = -Infinity;
  for (const [k, e] of Object.entries(stamps)) {
    const n = Number(k);
    if (!Number.isFinite(n) || !e) continue;
    if (e.at > bestAt || (e.at === bestAt && n > bestN)) {
      bestAt = e.at;
      bestN = n;
    }
  }
  if (bestN < 0) return undefined;
  return STATIONS.find((s) => s.number === bestN)?.nameJa;
}

function localParts(now: number, tz: string): { hour: number; month: number } {
  try {
    const p = civilParts(now, tz);
    return { hour: p.hour, month: p.month };
  } catch {
    const p = civilParts(now);
    return { hour: p.hour, month: p.month };
  }
}

/** Reads every signal the scene depends on (subscribes the caller when used in render). */
export function sceneInputs(o: { compact?: boolean } = {}): SceneInputs {
  const profile = store.profile.value;
  const streak = store.streak.value;
  const progress = store.progress.value;
  const collections = store.collections.value;
  const kage = store.kage.value;
  const settings = store.settings.value;
  // subscribe to card writes; the counts are derived below
  store.cards.version.value;
  const now = store.now();
  const today = store.today();
  const { hour, month } = localParts(now, profile.tz);
  const size = o.compact ? SCENE_SIZE.compact : SCENE_SIZE.full;
  return {
    w: size.w,
    h: size.h,
    belt: profile.belt,
    level: profile.level,
    dan: profile.dan,
    chosenKanji: profile.chosenKanji,
    badgeCategories: badgeCategoryCount(collections.badges),
    latestStamp: latestStampName(collections.stamps),
    kageBeaten: kage.beatenWeek !== undefined && kage.beatenWeek === weekOf(today),
    hour,
    month,
    seed: store.seed(),
    today,
    totalDays: streak.totalDays,
    streak: streak.current,
    blooming: streak.totalDays >= BLOOM_DAYS,
    pruned: progress.awayDays >= PRUNED_AWAY_DAYS,
    counts: blackCounts(store.cards),
    reducedMotion: Boolean(settings.reducedMotion),
    feel: settings.feel,
    flame: streakState(),
    station: progress.station,
    flamesMax: o.compact ? KOTODAMA_MAX.compact : KOTODAMA_MAX.full,
  };
}

/** Stable key of the inputs (the memo key). */
export function sceneKey(i: SceneInputs): string {
  return JSON.stringify(i);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Composition (pure)                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BuiltScene {
  svg: string;
  rendered: number;
  total: number;
  phase: SkyPhase;
  season: Season;
  hearth: HearthState;
  crystal: boolean;
  layout: RoomLayout;
}

export function buildScene(i: SceneInputs, withFlames: boolean): BuiltScene {
  const seed = hashSeed(i.seed, 'dojo');
  const room = roomSvg({
    belt: i.belt,
    level: i.level,
    dan: i.dan,
    chosenKanji: i.chosenKanji,
    badgeCategories: i.badgeCategories,
    latestStamp: i.latestStamp,
    kageBeaten: i.kageBeaten,
    hour: i.hour,
    month: i.month,
    seed,
    w: i.w,
    h: i.h,
    slots: MON_SLOTS,
  });
  const L = room.layout;
  const glow = i.feel !== 'zen';
  const { state, crystal } = hearthStateOf(i.flame);
  const hearth = hearthSvg({ state, crystal, seed, x: L.hearth.x, y: L.hearth.y, w: L.hearth.w, h: L.hearth.h, reducedMotion: i.reducedMotion, glow });
  const bonsai = bonsaiSvg({
    totalDays: i.totalDays,
    blooming: i.blooming,
    seed: hashSeed(seed, 'bonsai'),
    x: L.bonsai.x,
    y: L.bonsai.y,
    scale: L.bonsai.scale,
    season: room.season,
    streak: i.streak,
    pruned: i.pruned,
  });
  let total = 0;
  for (const n of Object.values(i.counts)) total += Math.max(0, Math.floor(n));
  const flames = withFlames
    ? flamesSvg({
        counts: i.counts,
        seed: hashSeed(seed, 'kotodama', i.today),
        x: L.hall.x,
        y: L.hall.y,
        w: L.hall.w,
        h: L.hall.h,
        reducedMotion: i.reducedMotion,
        max: i.flamesMax,
        glow,
      })
    : null;
  const overlay = room.layers[room.overlayIndex] ?? '';
  const body = [...room.layers.slice(0, room.overlayIndex), bonsai, overlay, hearth, flames?.svg ?? ''];
  const svg = svgDoc({
    w: i.w,
    h: i.h,
    defs: room.defs,
    body,
    preserveAspectRatio: 'xMidYMid meet',
    attrs: { class: 'dojo-scene__svg', 'aria-hidden': 'true', focusable: 'false', 'data-phase': room.phase, 'data-season': room.season },
  });
  return { svg, rendered: flames?.rendered ?? 0, total, phase: room.phase, season: room.season, hearth: state, crystal, layout: L };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Hotspots                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Hotspot {
  id: 'scroll' | 'bonsai' | 'rack' | 'shelf' | 'stamps' | 'hearth';
  route: Route;
  label: string;
  tip: string;
  /** Percent of the stage. */
  left: number;
  top: number;
  width: number;
  height: number;
}

function pct(v: number, of: number): number {
  return Math.round((v / Math.max(1, of)) * 10000) / 100;
}

export function hotspotsFor(i: SceneInputs, b: BuiltScene): Hotspot[] {
  const L = b.layout;
  const box = (id: Hotspot['id'], r: { x: number; y: number; w: number; h: number }, route: Route, label: string, tip: string): Hotspot => ({
    id,
    route,
    label,
    tip,
    left: pct(r.x, L.w),
    top: pct(r.y, L.h),
    width: pct(r.w, L.w),
    height: pct(r.h, L.h),
  });
  const stationDef = STATIONS.find((s) => s.number === i.station);
  const scrollRoute: Route = stationDef ? { name: 'station', n: stationDef.number } : { name: 'road' };
  const scrollLabel = stationDef ? fill(S.hotspotScroll, { n: stationDef.number, name: stationDef.nameJa }) : S.hotspotScrollRoad;
  const bonsaiBox = { x: L.bonsai.x - 60 * L.sx, y: L.bonsai.y - 150 * L.sy, w: 120 * L.sx, h: 150 * L.sy };
  const hearthText = `${HEARTH_TEXT[b.hearth]}${b.crystal ? ` ${S.hearthCrystal}` : ''}`;
  return [
    box('scroll', L.scroll, scrollRoute, scrollLabel, S.tipScroll),
    box('bonsai', bonsaiBox, { name: 'records' }, fill(S.hotspotBonsai, { days: i.totalDays }), S.tipBonsai),
    box('rack', L.rack, { name: 'collections', tab: 'kakejiku' }, fill(S.hotspotRack, { belt: BELT_NAME[i.belt] }), S.tipRack),
    box('shelf', L.shelf, { name: 'collections', tab: 'mon' }, fill(S.hotspotShelf, { n: Math.min(i.badgeCategories, MON_SLOTS), total: MON_SLOTS }), S.tipShelf),
    box('stamps', L.stamps, { name: 'collections', tab: 'goshuin' }, S.hotspotStamps, S.tipStamps),
    box('hearth', L.hearth, { name: 'records' }, fill(S.hotspotHearth, { state: hearthText }), S.tipHearth),
  ];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Idle scheduling                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

interface IdleGlobal {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

/** Runs `fn` in an idle slot (or next tick); returns the cancel. */
export function afterIdle(fn: () => void): () => void {
  const gl = globalThis as unknown as IdleGlobal;
  if (typeof gl.requestIdleCallback === 'function') {
    const id = gl.requestIdleCallback(fn, { timeout: 800 });
    return () => gl.cancelIdleCallback?.(id);
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DojoSceneProps {
  /** Shorter stage (960 × 400) for narrow layouts. */
  compact?: boolean;
}

export function DojoScene(p: DojoSceneProps = {}): JSX.Element {
  const compact = Boolean(p.compact);
  const inputs = sceneInputs({ compact });
  const key = sceneKey(inputs);
  const [flamesReady, setFlamesReady] = useState(false);
  useEffect(() => afterIdle(() => setFlamesReady(true)), []);
  // `key` stands for every field of `inputs`: the SVG string is rebuilt only when an input changes.
  const built = useMemo(() => buildScene(inputs, flamesReady), [key, flamesReady]);
  const hotspots = useMemo(() => hotspotsFor(inputs, built), [built]);

  const label = fill(S.sceneLabel, {
    belt: BELT_NAME[inputs.belt],
    days: inputs.totalDays,
    phase: PHASE_TEXT[built.phase],
    season: SEASON_TEXT[built.season],
  });
  const partial = built.rendered > 0 && built.rendered < built.total;

  return (
    <div class={`dojo-scene${compact ? ' dojo-scene--compact' : ''}`} data-phase={built.phase} data-season={built.season} data-hearth={built.hearth} data-flames={flamesReady ? 'ready' : 'pending'}>
      <div class="dojo-scene__stage">
        <div class="dojo-scene__art" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: built.svg }} />
        <ul class="dojo-scene__hotspots" aria-label={S.hotspotsLabel}>
          {hotspots.map((h) => (
            <li key={h.id}>
              <a
                class={`dojo-scene__hotspot dojo-scene__hotspot--${h.id}`}
                href={href(h.route)}
                aria-label={h.label}
                title={h.label}
                data-hotspot={h.id}
                style={{ left: `${h.left}%`, top: `${h.top}%`, width: `${h.width}%`, height: `${h.height}%` }}
              >
                <span class="dojo-scene__tip" aria-hidden="true">
                  {h.tip}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p class="dojo-scene__caption" data-total={built.total} data-rendered={built.rendered}>
        <span lang="ja">{S.kotodamaJa}</span>
        <span>{built.total > 0 ? fill(S.kotodamaCount, { total: built.total }) : S.kotodamaNone}</span>
        {partial ? <span class="dojo-scene__muted">{fill(S.kotodamaShown, { rendered: built.rendered, total: built.total })}</span> : null}
      </p>
    </div>
  );
}
