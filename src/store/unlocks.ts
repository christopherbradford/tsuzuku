/**
 * TSUZUKU — unlock evaluator (group B).
 *
 * Reduces facts into the collections slice and emits the ceremony events:
 *
 *  - `gate:result`   → goshuin stamp (`collections.stamps`), `progress.stationsCleared`
 *                      / `perfectGates` / `assisted`, `stamp:earned`;
 *  - `shinsa:result` → `progress.shinsaPassed`, `profile.belt` (+ `dan` 1 at Shodan),
 *                      `belt:promoted` once every Gatekeeper of the belt is cleared
 *                      (coverage is checked upstream by `shinsaEligible` before the
 *                      exam is offered; design 02 §2);
 *  - badges and wallpapers: every definition not yet earned is re-checked
 *    whenever a slice it reads changes (a signals `effect` over stats, streak,
 *    progress, ledger, kage, weak points, profile and the card version), and,
 *    for the conditions that read an event payload, on that event (indexed by
 *    `def.events`). Writes `collections.badges` / `collections.wallpapers`
 *    (quadrant reveals at 25/50/75 %, unlock at 100 %), emits `badge:earned`,
 *    `wallpaper:revealed`, `wallpaper:unlocked`.
 *
 * Idempotent: an earned badge is never re-awarded, its day never changes, a
 * reveal quadrant fires once, and nothing is ever removed when a counter
 * regresses. Because evaluation is state-driven, an imported or migrated
 * save is reconciled on the next change (and once at start).
 */
import { effect, untracked } from '@preact/signals';
import { BELTS, BELT_IDS, type Belt } from '../content/types';
import type { BadgeId, WallpaperId } from '../shared/catalog';
import { bus, type EventName, type Events } from '../shared/events';
import type { SaveMeta, StampEntry, Store, WallpaperEntry } from '../shared/store-types';
import { BADGE_DEFS, beltRankOf, type BadgeDef, type CardReader, type TriggerEvent } from './badge-defs';
import { WALLPAPER_DEFS, isUnlocked, revealQuadrant, type WallpaperDef } from './wallpaper-defs';

/* ────────────────────────────────────────────────────────────────────────── */
/* Evaluation (pure)                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

export type RevealQuadrant = 1 | 2 | 3 | 4;

export interface UnlockResult {
  badges: BadgeId[];
  wallpapers: WallpaperId[];
  reveals: [WallpaperId, RevealQuadrant][];
}

export function isEmptyResult(r: UnlockResult): boolean {
  return r.badges.length === 0 && r.wallpapers.length === 0 && r.reveals.length === 0;
}

interface DefSets {
  badges: readonly BadgeDef[];
  wallpapers: readonly WallpaperDef[];
}

function evaluate(m: SaveMeta, defs: DefSets, cards?: CardReader, ev?: TriggerEvent): UnlockResult {
  const out: UnlockResult = { badges: [], wallpapers: [], reveals: [] };
  for (const d of defs.badges) {
    if (m.collections.badges[d.id] !== undefined) continue;
    if (d.when(m, ev, cards)) out.badges.push(d.id);
  }
  for (const d of defs.wallpapers) {
    const entry = m.collections.wallpapers[d.id];
    if (isUnlocked(entry)) continue;
    if (d.when(m, ev, cards)) {
      out.wallpapers.push(d.id);
      continue;
    }
    if (!d.progress) continue;
    const q = Math.min(3, revealQuadrant(d, m, cards));
    const cur = entry?.revealed ?? 0;
    for (let i = cur + 1; i <= q; i++) out.reveals.push([d.id, i as RevealQuadrant]);
  }
  return out;
}

/** Every unearned badge, every locked wallpaper, every pending reveal (import replays, tests). */
export function evaluateAll(m: SaveMeta, cards?: CardReader, ev?: TriggerEvent): UnlockResult {
  return evaluate(m, { badges: BADGE_DEFS, wallpapers: WALLPAPER_DEFS }, cards, ev);
}

const BADGES_BY_EVENT = new Map<EventName, BadgeDef[]>();
const WALLPAPERS_BY_EVENT = new Map<EventName, WallpaperDef[]>();
for (const d of BADGE_DEFS) for (const e of d.events) BADGES_BY_EVENT.set(e, [...(BADGES_BY_EVENT.get(e) ?? []), d]);
for (const d of WALLPAPER_DEFS) for (const e of d.events) WALLPAPERS_BY_EVENT.set(e, [...(WALLPAPERS_BY_EVENT.get(e) ?? []), d]);

/** Only the definitions indexed to `ev.name` (cheap per-event path). */
export function evaluateFor(m: SaveMeta, ev: TriggerEvent, cards?: CardReader): UnlockResult {
  return evaluate(m, { badges: BADGES_BY_EVENT.get(ev.name) ?? [], wallpapers: WALLPAPERS_BY_EVENT.get(ev.name) ?? [] }, cards, ev);
}

/** Event names that index at least one definition. */
export const INDEXED_EVENTS: readonly EventName[] = Array.from(new Set<EventName>([...BADGES_BY_EVENT.keys(), ...WALLPAPERS_BY_EVENT.keys()]));

/** Events B itself emits; the state-driven effect covers them, so the bus path skips them. */
const B_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  'xp:gained',
  'level:up',
  'badge:earned',
  'wallpaper:unlocked',
  'wallpaper:revealed',
  'stamp:earned',
  'belt:promoted',
  'streak:changed',
  'quest:completed',
  'day:rolled',
]);

/* ────────────────────────────────────────────────────────────────────────── */
/* Writes                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Write a result into `collections` and emit the ceremony events. Never removes anything. */
export function applyUnlocks(store: Store, r: UnlockResult): void {
  if (isEmptyResult(r)) return;
  const today = store.today();
  store.patch('collections', (c) => {
    const badges = { ...c.badges };
    for (const id of r.badges) if (badges[id] === undefined) badges[id] = today;
    const wallpapers = { ...c.wallpapers };
    for (const [id, q] of r.reveals) {
      const prev = wallpapers[id];
      if (prev && prev.revealed >= q) continue;
      const next: WallpaperEntry = { at: prev?.at ?? 0, reforges: prev?.reforges ?? 0, revealed: q };
      if (prev?.lastReforgeDay !== undefined) next.lastReforgeDay = prev.lastReforgeDay;
      wallpapers[id] = next;
    }
    for (const id of r.wallpapers) {
      const prev = wallpapers[id];
      if (isUnlocked(prev)) continue;
      const next: WallpaperEntry = { at: today, reforges: prev?.reforges ?? 0, revealed: 4 };
      if (prev?.lastReforgeDay !== undefined) next.lastReforgeDay = prev.lastReforgeDay;
      wallpapers[id] = next;
    }
    return { ...c, badges, wallpapers };
  });
  for (const id of r.badges) bus.emit('badge:earned', { id });
  for (const [id, quadrant] of r.reveals) bus.emit('wallpaper:revealed', { id, quadrant });
  for (const id of r.wallpapers) bus.emit('wallpaper:unlocked', { id });
}

/**
 * Evaluate against the live store and apply, repeating while an award
 * unlocks another (golden-ear → waveform, 25 badges → hanko-garden).
 */
export function runUnlocks(store: Store, ev?: TriggerEvent): UnlockResult {
  const total: UnlockResult = { badges: [], wallpapers: [], reveals: [] };
  for (let pass = 0; pass < 4; pass++) {
    const r = ev && pass === 0 ? evaluateFor(store.meta(), ev, store.cards) : evaluateAll(store.meta(), store.cards, pass === 0 ? ev : undefined);
    if (isEmptyResult(r)) break;
    applyUnlocks(store, r);
    total.badges.push(...r.badges);
    total.wallpapers.push(...r.wallpapers);
    total.reveals.push(...r.reveals);
  }
  return total;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Gate and Shinsa reducers                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const PASSING: ReadonlySet<Events['gate:result']['outcome']> = new Set(['pass', 'perfect', 'assisted', 'revenge']);

export function beltStationsOf(belt: Belt): [number, number] {
  const def = BELTS.find((b) => b.id === belt);
  return def ? def.stations : [1, 3];
}

/** Every Gatekeeper of `belt` is in `stationsCleared`. */
export function gatesClearedFor(m: SaveMeta, belt: Belt): boolean {
  const [from, to] = beltStationsOf(belt);
  const set = new Set(m.progress.stationsCleared);
  for (let n = from; n <= to; n++) if (!set.has(n)) return false;
  return true;
}

/** The belt that follows `belt` on the kyū road (`black` has none). */
function promote(store: Store, belt: Belt): void {
  store.patch('profile', (p) => {
    const higher = beltRankOf(belt) > beltRankOf(p.belt);
    const dan = belt === 'black' ? Math.max(p.dan, 1) : p.dan;
    if (!higher && dan === p.dan) return p;
    return { ...p, belt: higher ? belt : p.belt, dan };
  });
}

/**
 * Promote to the highest belt whose Shinsa is passed and whose gates are all
 * cleared, when it outranks the current belt (a deferred promotion after the
 * last gate). Emits `belt:promoted` for it.
 */
export function promoteIfReady(store: Store): Belt | null {
  const m = store.meta();
  let target: Belt | null = null;
  for (const belt of BELT_IDS) {
    if (belt === 'white') continue;
    if (!m.progress.shinsaPassed.includes(belt)) continue;
    if (beltRankOf(belt) <= beltRankOf(m.profile.belt)) continue;
    if (!gatesClearedFor(m, belt)) continue;
    target = belt;
  }
  if (!target) return null;
  promote(store, target);
  bus.emit('belt:promoted', { belt: target });
  return target;
}

/** `gate:result` → stamp + progress, idempotent; emits `stamp:earned` when the stamp is new or upgraded. */
export function reduceGate(store: Store, p: Events['gate:result']): void {
  if (!PASSING.has(p.outcome)) return;
  const today = store.today();
  const prev = store.collections.value.stamps[p.station];
  const perfect = (prev?.perfect ?? false) || p.outcome === 'perfect';
  // A grey corner stays only while every pass of this gate was Assisted.
  const assisted = p.outcome === 'assisted' ? (prev ? prev.assisted : true) : false;
  const next: StampEntry = { at: prev?.at ?? today, perfect, assisted };
  const changed = !prev || prev.perfect !== perfect || prev.assisted !== assisted;

  store.patch('progress', (pr) => {
    let out = pr;
    if (!pr.stationsCleared.includes(p.station)) out = { ...out, stationsCleared: [...pr.stationsCleared, p.station].sort((a, b) => a - b) };
    if (perfect && !(prev?.perfect ?? false)) out = { ...out, perfectGates: out.perfectGates + 1 };
    if (assisted && !pr.assisted.includes(p.station)) out = { ...out, assisted: [...pr.assisted, p.station] };
    if (!assisted && pr.assisted.includes(p.station)) out = { ...out, assisted: pr.assisted.filter((n) => n !== p.station) };
    return out;
  });
  if (changed) {
    store.patch('collections', (c) => ({ ...c, stamps: { ...c.stamps, [p.station]: next } }));
    bus.emit('stamp:earned', { station: p.station, perfect, assisted });
  }
  promoteIfReady(store);
}

/** `shinsa:result` → `shinsaPassed`, belt (when its gates are cleared), `belt:promoted`. */
export function reduceShinsa(store: Store, p: Events['shinsa:result']): void {
  if (!p.passed) return;
  store.patch('progress', (pr) => (pr.shinsaPassed.includes(p.belt) ? pr : { ...pr, shinsaPassed: [...pr.shinsaPassed, p.belt] }));
  if (!gatesClearedFor(store.meta(), p.belt)) return;
  promote(store, p.belt);
  bus.emit('belt:promoted', { belt: p.belt });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducer                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Subscribes the reducers above; returns the unsubscribe (`ReducerStarter`). */
export function startUnlocks(store: Store): () => void {
  const stops: (() => void)[] = [];
  stops.push(bus.on('gate:result', (p) => reduceGate(store, p)));
  stops.push(bus.on('shinsa:result', (p) => reduceShinsa(store, p)));
  for (const name of INDEXED_EVENTS) {
    if (B_EVENTS.has(name)) continue;
    stops.push(
      bus.on(name, (payload) => {
        runUnlocks(store, { name, payload } as TriggerEvent);
      }),
    );
  }
  stops.push(
    effect(() => {
      // Track the slices conditions read; collections is read untracked so our own writes never loop.
      void store.stats.value;
      void store.streak.value;
      void store.progress.value;
      void store.ledger.value;
      void store.kage.value;
      void store.weakPoints.value;
      void store.profile.value;
      void store.cards.version.value;
      untracked(() => {
        try {
          runUnlocks(store);
        } catch (err) {
          console.error('[unlocks] evaluation failed', err);
        }
      });
    }),
  );
  return () => {
    for (const stop of stops) stop();
  };
}
