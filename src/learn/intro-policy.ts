/**
 * TSUZUKU — what to introduce today (design 05 §3, 03 §2.2, 02 §6).
 *
 *  - A station is partitioned into Scrolls with stable ids `<station>-<n>`:
 *    kana (Stations 1–3), component mini-scrolls (components ride one station
 *    ahead of their first kanji, `StationBundle.componentIds`), then vocab /
 *    kanji / grammar scrolls interleaved in proportion. Scroll size scales by
 *    belt: White–Green 6–8 vocab | 1 grammar | 3 kanji; Blue+ 8–10 vocab | 1
 *    grammar | 4 kanji. Each Scroll names up to 3 Chikaradameshi pretest items.
 *  - A kanji unlocks only when every component is Green OR was introduced
 *    ≥ 7 days ago (a lapsed component never stalls a station).
 *  - Captured words take up to 40 % of the day's vocab budget from Green.
 *  - `nextScrolls` returns the Scrolls to teach today while each kind's
 *    remaining budget is ≥ 1. `newPerDay` is today's budget per kind; a caller
 *    that wants fractional rates (0.75 grammar/day) passes the accumulated carry.
 *
 * Note on "introduced ≥ 7 days ago": cards carry no creation day, so the
 * caller may pass `introducedOn(itemId)` (B can derive it from the log). Without
 * it the fallback is `today − last ≥ 7 || reps ≥ 7`, both lower bounds on age.
 */
import { BELT_IDS, STATIONS, type Belt, type ComponentDef, type ContentItem, type KanjiItem, type StationBundle } from '../content/types';
import type { CardsApi, EpochDay, Settings } from '../shared/store-types';
import { rngFor, sample } from '../shared/hash';
import { beltAtLeast, itemBelt } from './item-belt';

export type ScrollKind = 'vocab' | 'grammar' | 'kanji' | 'component' | 'kana';

export interface Scroll {
  /** `<station>-<n>` (1-based), or `<station>-cap` for the captured-words scroll. */
  id: string;
  station: number;
  kind: ScrollKind;
  itemIds: string[];
  /** Chikaradameshi pretest picks (≤ 3). */
  pretestIds: string[];
}

export const PRETEST_COUNT = 3;
export const CAPTURED_SHARE = 0.4;
export const COMPONENT_LAG_DAYS = 7;
/** Captured words become a sanctioned new-item source from this belt. */
export const CAPTURE_FROM_BELT: Belt = 'green';

export interface ScrollSizes {
  vocab: { min: number; max: number };
  kanji: number;
  grammar: number;
  component: number;
  kana: number;
}

/** Learner belt `a` is at least `b` on the road (White … Black). */
export function learnerBeltAtLeast(a: Belt, b: Belt): boolean {
  return BELT_IDS.indexOf(a) >= BELT_IDS.indexOf(b);
}

export function scrollSizes(belt: Belt): ScrollSizes {
  const big = learnerBeltAtLeast(belt, 'blue');
  return {
    vocab: big ? { min: 8, max: 10 } : { min: 6, max: 8 },
    kanji: big ? 4 : 3,
    grammar: 1,
    component: 5,
    kana: 10,
  };
}

/** Belt of a station number (0 and unknown → white). */
export function stationBelt(n: number): Belt {
  const st = STATIONS.find((s) => s.number === n);
  return st ? st.belt : 'white';
}

/**
 * Splits `items` into ⌈n / target⌉ groups as even as possible (sizes differ by
 * at most one), preserving order.
 */
export function partition<T>(items: readonly T[], target: number): T[][] {
  const n = items.length;
  if (n === 0) return [];
  const size = Math.max(1, Math.floor(target));
  const k = Math.ceil(n / size);
  const base = Math.floor(n / k);
  const extra = n % k;
  const out: T[][] = [];
  let i = 0;
  for (let g = 0; g < k; g++) {
    const len = base + (g < extra ? 1 : 0);
    out.push(items.slice(i, i + len));
    i += len;
  }
  return out;
}

/** Deterministic pretest picks for a scroll id. */
export function pretestFor(scrollId: string, itemIds: readonly string[]): string[] {
  return sample(rngFor('chikaradameshi', scrollId), itemIds, PRETEST_COUNT);
}

/**
 * Proportional interleave: each group sits at (i + 0.5) / count of its kind;
 * groups are emitted in ascending position (ties: vocab, kanji, grammar).
 */
function interleaveGroups(groups: { kind: ScrollKind; ids: string[] }[][]): { kind: ScrollKind; ids: string[] }[] {
  const placed: { pos: number; order: number; g: { kind: ScrollKind; ids: string[] } }[] = [];
  groups.forEach((list, order) => {
    list.forEach((g, i) => placed.push({ pos: (i + 0.5) / list.length, order, g }));
  });
  placed.sort((a, b) => a.pos - b.pos || a.order - b.order);
  return placed.map((p) => p.g);
}

/** The station's Scrolls in teaching order with stable ids. `get` is accepted for parity with the loader; ids come from the bundle. */
export function scrollsForStation(b: StationBundle, get: (id: string) => ContentItem | undefined): Scroll[] {
  void get;
  const belt = stationBelt(b.number);
  const sizes = scrollSizes(belt);
  const groups: { kind: ScrollKind; ids: string[] }[] = [];
  for (const ids of partition(b.kanaIds, sizes.kana)) groups.push({ kind: 'kana', ids });
  for (const ids of partition(b.componentIds, sizes.component)) groups.push({ kind: 'component', ids });
  groups.push(
    ...interleaveGroups([
      partition(b.vocabIds, sizes.vocab.max).map((ids) => ({ kind: 'vocab' as const, ids })),
      partition(b.kanjiIds, sizes.kanji).map((ids) => ({ kind: 'kanji' as const, ids })),
      partition(b.grammarIds, sizes.grammar).map((ids) => ({ kind: 'grammar' as const, ids })),
    ]),
  );
  return groups.map((g, i) => {
    const id = `${b.number}-${i + 1}`;
    return { id, station: b.number, kind: g.kind, itemIds: g.ids, pretestIds: pretestFor(id, g.ids) };
  });
}

function kebab(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolves a kanji's component name (or id) to the component item id. */
export function componentIdFor(name: string, components: Map<string, ComponentDef>): string | undefined {
  const direct = components.get(name);
  if (direct) return direct.id;
  const byId = components.get(`c-${kebab(name)}`);
  if (byId) return byId.id;
  for (const def of components.values()) {
    if (def.name === name || def.id === name || kebab(def.name) === kebab(name)) return def.id;
  }
  return undefined;
}

export interface KanjiGateInput {
  cards: CardsApi;
  components: Map<string, ComponentDef>;
  today?: EpochDay;
  /** Day an item was introduced (B derives it from the log); enables the exact 7-day rule. */
  introducedOn?: (itemId: string) => EpochDay | undefined;
}

/** Days since a component was introduced, or `undefined` when unknown. */
function componentAge(componentId: string, o: KanjiGateInput): number | undefined {
  if (o.today === undefined) return undefined;
  const introduced = o.introducedOn?.(componentId);
  if (introduced !== undefined) return o.today - introduced;
  const rec = o.cards.byItem(componentId).rec;
  if (!rec) return undefined;
  return o.today - rec[6];
}

/** Green, or introduced ≥ 7 days ago (exact when `introducedOn` is given, else a lower-bound heuristic). */
export function componentReady(componentId: string, o: KanjiGateInput): boolean {
  const facets = o.cards.byItem(componentId);
  const rec = facets.rec;
  if (!rec) return false;
  if (beltAtLeast(itemBelt('component', facets), 'green')) return true;
  const age = componentAge(componentId, o);
  if (age !== undefined && age >= COMPONENT_LAG_DAYS) return true;
  if (o.introducedOn?.(componentId) !== undefined) return false;
  return rec[3] >= COMPONENT_LAG_DAYS;
}

/** Every component of the kanji is ready. Unknown component names never block (content bug, not a learner stall). */
export function isKanjiUnlockable(kanji: KanjiItem, o: KanjiGateInput): boolean {
  for (const name of kanji.components) {
    const cid = componentIdFor(name, o.components);
    if (!cid) continue;
    if (!componentReady(cid, o)) return false;
  }
  return true;
}

/**
 * Days until the kanji unlocks: 0 when unlockable, `null` when a component is
 * not introduced at all (the Scroll says "部品 first"), else the longest wait.
 */
export function kanjiUnlocksIn(kanji: KanjiItem, o: KanjiGateInput): number | null {
  let wait = 0;
  for (const name of kanji.components) {
    const cid = componentIdFor(name, o.components);
    if (!cid) continue;
    if (componentReady(cid, o)) continue;
    if (!o.cards.byItem(cid).rec) return null;
    const age = componentAge(cid, o);
    if (age === undefined) return null;
    wait = Math.max(wait, COMPONENT_LAG_DAYS - age);
  }
  return wait;
}

export interface NextScrollsInput {
  bundle: StationBundle;
  cards: CardsApi;
  /** Captured item ids (new-item queue), oldest first. */
  captured: string[];
  /** Today's budget per kind (accumulated carry allowed). */
  newPerDay: Settings['newPerDay'];
  introducedToday: { vocab: number; kanji: number; grammar: number };
  belt: Belt;
  components: Map<string, ComponentDef>;
  get: (id: string) => ContentItem | undefined;
  today?: EpochDay;
  introducedOn?: (itemId: string) => EpochDay | undefined;
  /** Kana budget (White); default 20. */
  kanaPerDay?: number;
  introducedKanaToday?: number;
  /** Component mini-scroll budget in items; default 10. */
  componentsPerDay?: number;
  introducedComponentsToday?: number;
}

const DEFAULT_KANA_PER_DAY = 20;
const DEFAULT_COMPONENTS_PER_DAY = 10;

function isIntroduced(cards: CardsApi, id: string): boolean {
  return Object.keys(cards.byItem(id)).length > 0;
}

/** Scrolls to teach today, in order: captured words, kana, components, vocab, kanji, grammar. */
export function nextScrolls(o: NextScrollsInput): Scroll[] {
  const station = o.bundle.number;
  const remaining: Record<ScrollKind, number> = {
    vocab: o.newPerDay.vocab - o.introducedToday.vocab,
    kanji: o.newPerDay.kanji - o.introducedToday.kanji,
    grammar: o.newPerDay.grammar - o.introducedToday.grammar,
    kana: (o.kanaPerDay ?? DEFAULT_KANA_PER_DAY) - (o.introducedKanaToday ?? 0),
    component: (o.componentsPerDay ?? DEFAULT_COMPONENTS_PER_DAY) - (o.introducedComponentsToday ?? 0),
  };
  const out: Scroll[] = [];

  if (learnerBeltAtLeast(o.belt, CAPTURE_FROM_BELT) && remaining.vocab >= 1) {
    const seen = new Set<string>();
    const pool: string[] = [];
    for (const id of o.captured) {
      if (seen.has(id) || !id.startsWith('v-') || isIntroduced(o.cards, id)) continue;
      seen.add(id);
      pool.push(id);
    }
    const take = Math.min(pool.length, Math.floor(CAPTURED_SHARE * remaining.vocab));
    if (take > 0) {
      const id = `${station}-cap`;
      const itemIds = pool.slice(0, take);
      out.push({ id, station, kind: 'vocab', itemIds, pretestIds: pretestFor(id, itemIds) });
      remaining.vocab -= take;
    }
  }

  const gate: KanjiGateInput = { cards: o.cards, components: o.components, today: o.today, introducedOn: o.introducedOn };
  const all = scrollsForStation(o.bundle, o.get);
  const order: ScrollKind[] = ['kana', 'component', 'vocab', 'kanji', 'grammar'];
  for (const kind of order) {
    for (const scroll of all) {
      if (scroll.kind !== kind) continue;
      if (remaining[kind] < 1) break;
      let ids = scroll.itemIds.filter((id) => !isIntroduced(o.cards, id));
      if (kind === 'kanji') {
        ids = ids.filter((id) => {
          const k = o.get(id) as KanjiItem | undefined;
          return k !== undefined && isKanjiUnlockable(k, gate);
        });
      }
      if (ids.length === 0) continue;
      const pretestIds = ids.length === scroll.itemIds.length ? scroll.pretestIds : pretestFor(scroll.id, ids);
      out.push({ ...scroll, itemIds: ids, pretestIds });
      remaining[kind] -= ids.length;
    }
  }
  return out;
}
