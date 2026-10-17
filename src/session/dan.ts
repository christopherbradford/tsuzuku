/**
 * TSUZUKU — the Dan road past Kyoto (design 02 §3).
 *
 *  No stations, no Gatekeepers. Each dan is a Dōjō Yaburi (道場破り) module
 *  with machine-checkable promotion criteria read from `stats`, `ledger` and
 *  `streak`, and a 10-minute gauntlet over existing content (a Native Bridge
 *  passage, the learner's captured / mature production cards, and Say It Three
 *  Ways / Monologue / Shadow / Writing by module). Content packs for 二段+ are
 *  release trains; where a design criterion names a stat the save does not
 *  hold yet (keigo role-plays, Kansai recognition, yojijukugo, domain packs),
 *  the nearest honest counter stands in and the label says what is counted.
 *
 *  六段+: one dan per 300 ledger hours beyond 1,000 and 100 training days,
 *  plus weekly Kage wins; 十段 = 1,000 training days + 1,500 ledger hours,
 *  title 続く者.
 */
import { content as appContent, type ContentLoader } from '../content/loader';
import type { CardKey, DrillId, StoryItem } from '../content/types';
import type { SessionPlan, Step } from '../shared/session-types';
import type { SaveMeta } from '../shared/store-types';
import { store } from '../store';
import { templateFor } from './blocks';
import { DAN_NAME, S, fill } from './engine-strings';
import { easiestCards, finalizePlan, loadPlanContext, makeStep, outputBlockSteps, pickDrill, pickStories, queueCardOf, resolveParams, stepForCard, type PlanContext } from './builder';

export interface DanCheck {
  ok: boolean;
  now: number;
  target: number;
}
export interface DanCriterion {
  label: string;
  check(m: SaveMeta): DanCheck;
}
export interface DanModule {
  dan: number;
  nameJa: string;
  nameEn: string;
  criteria: DanCriterion[];
}

export const MAX_DAN = 10;
export const HOURS_PER_DAN = 300;
export const DAYS_PER_DAN = 100;
export const JUDAN_DAYS = 1000;
export const JUDAN_HOURS = 1500;

/** Lifetime ledger hours (entries + monthly aggregates). */
export function ledgerHoursOf(m: SaveMeta): number {
  let minutes = 0;
  for (const e of m.ledger.entries) minutes += e[1];
  for (const v of Object.values(m.ledger.monthly)) minutes += v;
  return minutes / 60;
}

function ratio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function pct(x: number): number {
  return Math.round(x * 100);
}

const ledger = (hours: number): DanCriterion => ({
  label: fill(S.danCritLedger, { n: hours }),
  check: (m) => {
    const now = Math.round(ledgerHoursOf(m));
    return { ok: now >= hours, now, target: hours };
  },
});

const count = (label: string, key: keyof SaveMeta['stats'], target: number): DanCriterion => ({
  label: fill(label, { n: target }),
  check: (m) => ({ ok: m.stats[key] >= target, now: m.stats[key], target }),
});

const rate = (label: string, num: keyof SaveMeta['stats'], den: keyof SaveMeta['stats'], minDen: number, minRate: number): DanCriterion => ({
  label: fill(label, { pct: pct(minRate), n: minDen }),
  check: (m) => {
    const r = ratio(m.stats[num], m.stats[den]);
    return { ok: m.stats[den] >= minDen && r >= minRate, now: pct(r), target: pct(minRate) };
  },
});

/** 二段 … 五段 as design 02 §3 states them (stand-ins labelled). */
export const DAN_MODULES: readonly DanModule[] = [
  {
    dan: 2,
    nameJa: '敬語の段',
    nameEn: S.danNidan,
    criteria: [rate(S.danCritThreeWays, 'threeWaysCorrect', 'threeWays', 60, 0.9), rate(S.danCritRolePlays, 'rolePlaysAllBest', 'rolePlays', 20, 0.8), ledger(100)],
  },
  {
    dan: 3,
    nameJa: '自然体の段',
    nameEn: S.danSandan,
    criteria: [rate(S.danCritAizuchi, 'rolePlaysAizuchi', 'rolePlays', 30, 0.85), count(S.danCritEpisodes, 'episodesRead', 50), ledger(250)],
  },
  {
    dan: 4,
    nameJa: '独白と影の段',
    nameEn: S.danYondan,
    criteria: [count(S.danCritMonologues, 'monologues', 30), count(S.danCritMonologueWords, 'monologueBestWords', 100), count(S.danCritFastListening, 'listeningFastPasses', 20), count(S.danCritShadowLines, 'shadowLines', 500), ledger(450)],
  },
  {
    dan: 5,
    nameJa: '文の段',
    nameEn: S.danGodan,
    criteria: [count(S.danCritVocabBrown, 'vocabBrown', 4000), count(S.danCritCpm, 'speedReadBestCpm', 450), ledger(1000)],
  },
];

/** The module for any dan ≥ 2 (六段+ generated; 十段 is the 続く者 rule). */
export function danModuleFor(dan: number): DanModule | null {
  if (dan < 2 || dan > MAX_DAN) return null;
  const listed = DAN_MODULES.find((m) => m.dan === dan);
  if (listed) return listed;
  if (dan === MAX_DAN) {
    return {
      dan,
      nameJa: '続く者',
      nameEn: S.danJudan,
      criteria: [
        { label: fill(S.danCritDays, { n: JUDAN_DAYS }), check: (m) => ({ ok: m.streak.totalDays >= JUDAN_DAYS, now: m.streak.totalDays, target: JUDAN_DAYS }) },
        ledger(JUDAN_HOURS),
      ],
    };
  }
  const k = dan - 5;
  const hours = 1000 + HOURS_PER_DAN * k;
  const days = DAYS_PER_DAN * k;
  return {
    dan,
    nameJa: '維持の段',
    nameEn: S.danRokudan,
    criteria: [
      ledger(hours),
      { label: fill(S.danCritDays, { n: days }), check: (m) => ({ ok: m.streak.totalDays >= days, now: m.streak.totalDays, target: days }) },
      { label: fill(S.danCritKageWins, { n: 10 * k }), check: (m) => ({ ok: m.kage.wins >= 10 * k, now: m.kage.wins, target: 10 * k }) },
    ],
  };
}

export interface DanProgress {
  dan: number;
  nameJa: string;
  nameEn: string;
  criteria: { label: string; ok: boolean; now: number; target: number }[];
  ready: boolean;
}

/** Every module from 二段 to 十段 evaluated against the save. */
export function danProgress(m: SaveMeta): DanProgress[] {
  const out: DanProgress[] = [];
  for (let d = 2; d <= MAX_DAN; d++) {
    const mod = danModuleFor(d);
    if (!mod) continue;
    const criteria = mod.criteria.map((c) => ({ label: c.label, ...c.check(m) }));
    out.push({ dan: d, nameJa: mod.nameJa, nameEn: mod.nameEn, criteria, ready: criteria.every((c) => c.ok) });
  }
  return out;
}

/** The next dan the learner qualifies for (dan + 1 with every criterion met), or `null`. */
export function nextDanReady(m: SaveMeta): number | null {
  const next = m.profile.dan + 1;
  if (m.profile.dan < 1 || next > MAX_DAN) return null;
  const mod = danModuleFor(next);
  if (!mod) return null;
  return mod.criteria.every((c) => c.check(m).ok) ? next : null;
}

/** Applies `profile.dan = dan` when it is the next rank and its criteria hold; returns whether it happened. */
export function promoteDan(dan: number): boolean {
  const m = store.meta();
  if (dan !== m.profile.dan + 1 || nextDanReady(m) !== dan) return false;
  store.patch('profile', (p) => ({ ...p, dan }));
  return true;
}

export function danTitle(dan: number): string {
  return DAN_NAME[dan] ?? `${dan}段`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Gauntlet                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface GauntletOptions {
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
}

/** Output kind by module: 二段 three ways · 三段 role-play · 四段 monologue · 五段 writing · 六段+ rotation. */
export function gauntletOutputKind(dan: number, rotation: number): 'three-ways' | 'role-play' | 'monologue' | 'writing' | 'shadow' {
  switch (dan) {
    case 2:
      return 'three-ways';
    case 3:
      return 'role-play';
    case 4:
      return 'monologue';
    case 5:
      return 'writing';
    default: {
      const kinds = ['three-ways', 'role-play', 'monologue', 'writing', 'shadow'] as const;
      return kinds[rotation % kinds.length] as (typeof kinds)[number];
    }
  }
}

/** Best-known production cards (prod / read / cloze facets, review state, unarchived), highest retrievability first. */
export function productionCards(ctx: PlanContext, n: number, exclude: ReadonlySet<CardKey>): ReturnType<typeof easiestCards> {
  const all = easiestCards(ctx, Number.MAX_SAFE_INTEGER, exclude);
  return all.filter((c) => c.facet === 'prod' || c.facet === 'read' || c.facet === 'cloze').slice(0, n);
}

function bridgePassage(ctx: PlanContext): StoryItem | undefined {
  const covered = pickStories(ctx, { kind: 'story', station: ctx.station });
  const bridge = covered.find((s) => s.bridge) ?? ctx.stories.find((s) => s.bridge);
  if (bridge) return bridge;
  return covered[0] ?? ctx.stories.filter((s) => s.kind === 'story').sort((a, b) => (b.id < a.id ? -1 : 1))[0];
}

/** The highest station the corpus ships (53 in the real corpus; the fixture stops earlier). */
export async function topStation(loader: ContentLoader): Promise<number> {
  try {
    const m = await loader.manifest();
    const top = Math.max(0, ...m.stations.map((s) => s.number));
    return top > 0 ? Math.min(53, top) : 53;
  } catch {
    return 53;
  }
}

/** A 10-minute Dōjō Yaburi: 4 min Native Bridge input · 2 min production over captured / mature words · 4 min output by module. */
export async function buildGauntlet(dan: number, seed: number, o: GauntletOptions = {}): Promise<SessionPlan> {
  const loader = o.loader ?? appContent;
  const station = await topStation(loader);
  const ctx = await loadPlanContext({ station, loader, available: o.available, seed, mode: `dan-${dan}` });
  const template = templateFor('dan', { belt: ctx.belt, station, backlog: false, dueCount: 0, weakTags: [], strandDeficit: null, day: ctx.today });
  const blocks: { kind: Step['block']; label: string; minutes: number; spec: ReturnType<typeof templateFor>[number]['spec']; stepIds: string[]; steps: Step[] }[] = [];
  let storyId: string | undefined;

  for (const t of template) {
    let steps: Step[] = [];
    if (t.kind === 'input') {
      const ex = pickDrill(ctx, 'story-read');
      const story = bridgePassage(ctx);
      if (ex && story) {
        steps = [makeStep(ctx, { block: 'input', exercise: ex, itemId: story.id, cardKey: null, params: resolveParams(ctx, ex, story, { storyId: story.id }), id: `dan:${dan}:input` })];
        storyId = story.id;
      }
    } else if (t.kind === 'reviews') {
      const n = t.spec.count ?? 12;
      const used = new Set<string>();
      const captured = store.captured.value.map((id) => queueCardOf(ctx, `${id}#prod`)).filter((c): c is NonNullable<typeof c> => c !== undefined);
      let pool = captured.slice(0, n);
      if (pool.length < n) pool = pool.concat(productionCards(ctx, n - pool.length, new Set<CardKey>(pool.map((c) => c.cardKey))));
      pool.forEach((qc, i) => {
        if (used.has(qc.cardKey)) return;
        used.add(qc.cardKey);
        const s = stepForCard(ctx, { ...qc, exposures: Math.max(2, qc.exposures) }, 'reviews', { id: `dan:${dan}:form:${i}` });
        if (s) steps.push(s);
      });
    } else if (t.kind === 'output') {
      const kind = gauntletOutputKind(dan, ctx.today);
      steps = outputBlockSteps(ctx, kind, kind === 'shadow' ? 5 : 1, storyId);
    }
    blocks.push({ kind: t.kind, label: t.kind === 'reviews' ? S.blockGauntlet : t.label, minutes: t.minutes, spec: t.spec, stepIds: steps.map((s) => s.id), steps });
  }
  const plan = finalizePlan(ctx, 'dan', blocks, { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [], ...(storyId ? { storyId } : {}) }, { templateMinutes: true });
  return plan;
}
