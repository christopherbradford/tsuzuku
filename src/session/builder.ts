/**
 * TSUZUKU — session plan builder (design 03 §2, §4–§5; 04 §10, §13; 05 §3).
 *
 * `buildPlan(mode)` turns the block template for a mode into a `SessionPlan`:
 * due cards through `@/learn` (`dueCards` → wave → interleave), new Scrolls
 * through `intro-policy`, the load governor (backlog mode, cramming cap, away
 * spread), an exercise per card (`exerciseFor` + the registry; unregistered
 * drills are skipped), fully resolved `StepParams` (choices, tiles,
 * conjugations, sentences, story ids by live coverage), one Michikusa chosen by
 * `hash(seed, day)` from the un-collected pool of stations ≤ current + 1,
 * recheck steps for arcade misses, and `meta` (dueTotal / dueTaken / backlog).
 *
 * +3 / +10 / relearn / Recovery re-presentations are NOT pre-inserted: the
 * runner inserts them from `recordAttempt().stepOffsets` and the Kiai queue, so
 * a resumed session and a fresh one behave the same. The sparring block is
 * sized to leave room for them.
 *
 * A Kumite or Shugyō also carries today's Nemesis steps (dossier / duel,
 * `nemesisBlockSteps`) as a small block ahead of the sparring, their cards held
 * out of the review draws. Grammar cloze on a particle point becomes Particle
 * Duel from Station 5; Form Forge / Form Chain run only on points that declare
 * `unlocksForms`.
 *
 * `loadPlanContext` keeps station entry light (design 07 §6/§9): the current
 * station is preloaded, the next prefetched on idle, and only the cards a plan
 * can draw (the due queue to `showDue` + a reserve, rechecks, Weak Point sets,
 * Nemesis items) have their files fetched; the Dojo (`mode: 'dojo'`) loads none
 * of them. The new-item budget follows the belt table unless the preset is
 * custom (`effectiveNewPerDay`), and `introducedToday` counts from the review
 * log so the cramming cap survives the +3 / +10 graduations.
 *
 * `StepParams.sentence` carries ruby markup for every sentence drill that
 * renders through `<Ruby>` (pattern-cloze, particle-duel, kanji-read,
 * lookalike-duel, transform, judgment-call, scramble, sentence-listen, shadow);
 * `blank` / `blanks` are offsets into `toPlain(sentence)`, and `answer` /
 * `accept` hold plain surfaces. Production Forge keeps a plain sentence.
 *
 * The lower-level pieces (`loadPlanContext`, `stepForCard`, `resolveParams`,
 * `makeStep`, `finalizePlan`, pickers) are exported for the boss, exam, Kage
 * and Dan builders in this folder; `resolveParams` and the item helpers live
 * in `./params`, the pickers and day counters in `./pickers`, both re-exported
 * here. Everything is seeded from `store.seed()` +
 * `store.today()` + the mode; no clock or `Math.random`.
 *
 * Modes `gate`, `shinsa`, `kage` and `dan` have their own builders
 * (`buildGate`, `buildShinsa`, `buildKage`, `buildGauntlet`); `buildPlan`
 * rejects them with a `RangeError` naming the right function.
 */
import {
  type Belt,
  type CardKey,
  type ComponentDef,
  type DrillId,
  type ErrorTag,
  type GrammarItem,
  type KanaItem,
  type KanjiItem,
  type StationBundle,
  type StoryItem,
  type VocabItem,
} from '../content/types';
import { content as appContent, type ContentLoader } from '../content/loader';
import { toPlain } from '../content/ruby';
import { isRegistered } from '../shared/exercise-types';
import { hashSeed, rngFor, type Rng } from '../shared/hash';
import { cardKey as makeKey, parseCardKey } from '../shared/ids';
import type { BlockKind, SessionMode, SessionPlan, SessionSnapshot, Step, StepParams, StepTag } from '../shared/session-types';
import { CardFlag, hasFlag, type CardTuple, type EpochDay, type ItemKind, type SaveMeta, type Settings } from '../shared/store-types';
import { store } from '../store';
import { beltOfStation } from '../store/derived';
import {
  EXPECTED_MAX_MINUTES,
  capFor,
  cardRetrievability,
  dueCards,
  exerciseFor,
  governor,
  interleave,
  kaidenQuota,
  kindOfCards,
  knownSet,
  orderWave,
  queueCardFor,
  recheckCards,
  weakPointSet,
  type QueueCard,
  type Scroll,
} from '../learn';
import { MICHIKUSA_AFTER_REP, MICHIKUSA_DRILL, MODE_MINUTES, estimateStepMs, fitToTime, strandDeficitFor, templateFor, type OutputKind, type PlannedBlock, type TemplateCtx } from './blocks';
import { S } from './engine-strings';
import { duelsReady, nemesisItems, nemesisSteps } from './nemesis';
import { PARTICLE_DUEL_FROM, dedupe, hasParticleHint, isDrillId, isGrammar, isKana, isKanji, isStory, isVocab, knownSentences, pickStories, rateFor, resolveParams } from './params';
import { DUE_LOAD_RESERVE, accuracy7, dueQueue, easiestCards, effectiveNewPerDay, introducedToday, michikusaFor, scrollsForToday, weekStrandMinutes, welcomeSet } from './pickers';
import { scrollSteps } from './scroll';

// Re-exported from `./pickers` and `./params` (see the header).
export { DUE_LOAD_RESERVE, accuracy7, dueQueue, easiestCards, effectiveNewPerDay, introducedToday, michikusaFor, scrollsForToday, weekStrandMinutes, welcomeSet } from './pickers';
export {
  FORM_LABEL,
  PARTICLES,
  PARTICLE_ATOMS,
  PARTICLE_DUEL_FROM,
  PITCH_PATTERNS,
  SPEED_READ_CPM,
  isComponent,
  isDrillId,
  isGrammar,
  isKana,
  isKanji,
  isStory,
  isVocab,
  itemKindOf,
  knownSentences,
  linesWith,
  particleHints,
  pickStories,
  pitchPattern,
  rateFor,
  resolveParams,
  splitBunsetsu,
  storyCoverage,
  type ResolveOpts,
} from './params';

/* ────────────────────────────────────────────────────────────────────────── */
/* Context                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PlanContext {
  loader: ContentLoader;
  today: EpochDay;
  now: number;
  seed: string;
  station: number;
  /** Curriculum belt of `station`. */
  belt: Belt;
  settings: Settings;
  medianMs: SaveMeta['medianMs'];
  bundle: StationBundle | null;
  /** Loaded bundles ≤ station (current included), ascending. */
  bundles: StationBundle[];
  /** Bundle of station + 1 when it exists (Michikusa pool). */
  nextBundle: StationBundle | null;
  components: Map<string, ComponentDef>;
  stories: StoryItem[];
  vocabPool: VocabItem[];
  kanjiPool: KanjiItem[];
  grammarPool: GrammarItem[];
  kanaPool: KanaItem[];
  known: Set<string>;
  rng: Rng;
  available: (id: DrillId) => boolean;
  /** Governor outcome for today. */
  cap: number;
  dueTotal: number;
  backlog: boolean;
  showDue: number;
  newTarget: number;
  newAllowed: number;
  crammingCap: boolean;
  overtraining: boolean;
  /** Step id counter. */
  seq: number;
  planKey: string;
}

export interface PlanOptions {
  station?: number;
  tag?: ErrorTag;
  scrollId?: string;
  seed?: number;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the exercise registry). */
  available?: (id: DrillId) => boolean;
}



async function tryStation(loader: ContentLoader, n: number): Promise<StationBundle | null> {
  if (n < 1 || n > 53) return null;
  try {
    return await loader.station(n);
  } catch {
    return null;
  }
}

/** Loads what a plan needs and evaluates the governor. */
export async function loadPlanContext(o: PlanOptions & { mode?: string } = {}): Promise<PlanContext> {
  const loader = o.loader ?? appContent;
  const today = store.today();
  const progress = store.progress.value;
  const settings = store.settings.value;
  const station = Math.max(1, Math.min(53, o.station ?? Math.max(1, progress.station)));
  const belt = beltOfStation(station);

  const bundle = await tryStation(loader, station);
  if (bundle) {
    try {
      await loader.preloadStation(station);
    } catch {
      /* the bundle's files failed; whatever is in memory is used */
    }
    // The next station warms on idle (design 07 §6); the loader dedupes and swallows errors.
    if (station < 53) loader.prefetchStation(station + 1);
  }
  const prev = station > 1 ? await tryStation(loader, station - 1) : null;
  const nextBundle = await tryStation(loader, station + 1);
  const bundles = [prev, bundle].filter((b): b is StationBundle => b !== null);
  let components = new Map<string, ComponentDef>();
  try {
    components = await loader.components();
  } catch {
    /* no components file yet */
  }

  // Governor first: it needs only card tuples and the save, and its `showDue` bounds what has to be in memory.
  const cap = capFor(settings.intensity, belt, settings.maxReviews);
  let dueTotal = 0;
  store.cards.forEach((k, t) => {
    void k;
    if (t[0] <= today && t[5] !== 0 && !hasFlag(t[7], CardFlag.archived)) dueTotal++;
  });
  const { acc7, n } = accuracy7(store.daily.value, today);
  const intro = introducedToday(today);
  const npd = effectiveNewPerDay(settings, belt);
  const target = Math.round(npd.vocab + npd.kanji + npd.grammar);
  const minutesToday = store.daily.value[today]?.minutes ?? 0;
  const expected = settings.intensity === 'custom' ? EXPECTED_MAX_MINUTES.standard : EXPECTED_MAX_MINUTES[settings.intensity];
  const gov = governor({
    due: dueTotal,
    cap,
    acc7,
    acc7n: n,
    retention: settings.retention,
    halved: false,
    recoveredDays: 0,
    newToday: intro.vocab + intro.kanji + intro.grammar,
    target,
    minutesToday,
    expectedMaxMinutes: expected,
    awayDays: progress.awayDays,
    daysBack: 0,
  });

  // Only the cards a plan can draw need their items in memory (design 07 §6/§9: station entry ≤ 400 KB, not
  // the whole corpus behind every due card): the due queue up to `showDue` plus a reserve, in the same order
  // `dueQueue` uses, arcade rechecks, and the Weak Point set when a tag is in play. The Dojo needs counts only.
  const dueItems: string[] = [];
  if (o.mode !== 'dojo') {
    const wanted = new Set<string>();
    for (const c of dueCards({ cards: store.cards, today, limit: gov.showDue + DUE_LOAD_RESERVE, backlog: gov.backlog, kaidenQuota: kaidenQuota(cap) })) wanted.add(c.itemId);
    for (const c of recheckCards(store.cards)) wanted.add(c.itemId);
    for (const e of nemesisItems(today)) wanted.add(e.itemId);
    const weak = store.weakPoints.value;
    const tags = new Set<ErrorTag>((Object.keys(weak) as ErrorTag[]).filter((t) => weak[t].active));
    if (o.tag) tags.add(o.tag);
    if (tags.size > 0) {
      const log = store.log.recent(5000);
      for (const tag of tags) for (const c of weakPointSet(tag, store.cards, log, today).slice(0, 20)) wanted.add(c.itemId);
    }
    dueItems.push(...wanted);
    try {
      await loader.load(dueItems.filter((id) => loader.get(id) === undefined));
    } catch {
      /* offline: cards whose content is missing are skipped by stepForCard */
    }
  }

  const vocabPool: VocabItem[] = [];
  const kanjiPool: KanjiItem[] = [];
  const grammarPool: GrammarItem[] = [];
  const kanaPool: KanaItem[] = [];
  const stories: StoryItem[] = [];
  const seen = new Set<string>();
  const addItem = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const it = loader.get(id);
    if (isVocab(it)) vocabPool.push(it);
    else if (isKanji(it)) kanjiPool.push(it);
    else if (isGrammar(it)) grammarPool.push(it);
    else if (isKana(it)) kanaPool.push(it);
    else if (isStory(it)) stories.push(it);
  };
  for (const b of bundles) for (const id of [...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.kanaIds, ...b.storyIds]) addItem(id);
  for (const id of dueItems) addItem(id);
  // Every item the learner holds a card for and whose content is already in memory (older stations' words for pools and the sentence of the day).
  store.cards.forEach((k) => addItem(parseCardKey(k).itemId));

  const planKey = `${o.mode ?? 'plan'}-${today}-${hashSeed(store.seed(), today, o.mode ?? 'plan', o.seed ?? 0, station).toString(16)}`;
  return {
    loader,
    today,
    now: store.now(),
    seed: store.seed(),
    station,
    belt,
    settings,
    medianMs: store.medianMs.value,
    bundle,
    bundles,
    nextBundle,
    components,
    stories,
    vocabPool,
    kanjiPool,
    grammarPool,
    kanaPool,
    known: knownSet(store.cards, today),
    rng: rngFor(store.seed(), today, o.mode ?? 'plan', o.seed ?? 0, station),
    available: o.available ?? ((id) => isRegistered(id)),
    cap,
    dueTotal,
    backlog: gov.backlog,
    showDue: gov.showDue,
    newTarget: gov.newTarget,
    newAllowed: gov.newAllowed,
    crammingCap: gov.crammingCap,
    overtraining: gov.overtraining,
    seq: 0,
    planKey,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Steps                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MakeStepInput {
  block: BlockKind;
  exercise: DrillId;
  itemId: string | null;
  cardKey: CardKey | null;
  params: StepParams;
  timed?: boolean;
  timerMs?: number;
  isNew?: boolean;
  stepTag?: StepTag | null;
  exposures?: number;
  id?: string;
  estMs?: number;
}

export function makeStep(ctx: PlanContext, o: MakeStepInput): Step {
  ctx.seq++;
  const step: Step = {
    id: o.id ?? `${ctx.planKey}:${ctx.seq}`,
    block: o.block,
    exercise: o.exercise,
    itemId: o.itemId,
    cardKey: o.cardKey,
    params: o.params,
    timed: o.timed ?? false,
    isNew: o.isNew ?? false,
    stepTag: o.stepTag ?? null,
    exposures: o.exposures ?? 0,
    estMs: o.estMs ?? estimateStepMs(o.exercise, o.params, ctx.medianMs),
  };
  if (o.timerMs !== undefined) step.timerMs = o.timerMs;
  return step;
}

/** Replaces an unavailable drill by the nearest registered one; `null` when nothing fits (the step is skipped). */
export function pickDrill(ctx: PlanContext, wanted: DrillId): DrillId | null {
  const chain: Record<string, DrillId[]> = {
    'meaning-guard': ['meaning-recall'],
    'meaning-judge': ['meaning-recall', 'meaning-guard'],
    'meaning-recall': ['meaning-guard'],
    'kana-ear': ['kana-forge'],
    'kana-forge': ['kana-ear'],
    'lookalike-duel': ['kanji-read'],
    scramble: ['pattern-cloze'],
    'judgment-call': ['pattern-cloze'],
    transform: ['form-forge', 'pattern-cloze'],
    'form-forge': ['pattern-cloze'],
    'form-chain': ['form-forge', 'pattern-cloze'],
    'particle-duel': ['pattern-cloze'],
    'audio-flash': ['meaning-recall', 'meaning-guard'],
    'writing-dojo': ['transform', 'pattern-cloze'],
    'say-three-ways': ['transform', 'shadow'],
    monologue: ['shadow'],
    'role-play': ['shadow'],
    'speed-read': ['story-read'],
  };
  if (ctx.available(wanted)) return wanted;
  for (const alt of chain[wanted] ?? []) if (ctx.available(alt)) return alt;
  return null;
}

function speedRingMs(ctx: PlanContext, exercise: DrillId): number | undefined {
  if (ctx.settings.feel === 'zen') return undefined;
  const median = ctx.medianMs[exercise];
  return median !== undefined && median > 0 ? Math.round(3 * median) : 3 * 4000;
}

/**
 * A graded step for a due / pool card. `null` when the drill (and its
 * fallbacks) are not registered or the item's content is not in memory.
 */
export function stepForCard(
  ctx: PlanContext,
  qc: QueueCard,
  block: BlockKind,
  o: { exercise?: DrillId; timed?: boolean; timerMs?: number; stepTag?: StepTag | null; isNew?: boolean; rep?: number; id?: string; params?: StepParams } = {},
): Step | null {
  const item = ctx.loader.get(qc.itemId);
  if (!item) return null;
  let wantedRaw: string = o.exercise ?? exerciseFor(qc, ctx.station, ctx.settings);
  // Form Forge / Form Chain drill only the forms a point declares (design 04 §4 "unlocksForms"); a point
  // without them keeps its cloze / transform shape instead of cycling every form of a random verb.
  if ((wantedRaw === 'form-forge' || wantedRaw === 'form-chain') && !(isGrammar(item) && item.unlocksForms && item.unlocksForms.length > 0)) {
    wantedRaw = ctx.station >= 16 ? 'transform' : 'pattern-cloze';
  }
  // Particle Duel: grammar cloze on a particle point from Station 5, once the two multiple-choice exposures are past (design 04 §4).
  if (wantedRaw === 'pattern-cloze' && o.exercise === undefined && qc.facet === 'cloze' && ctx.station >= PARTICLE_DUEL_FROM && qc.exposures >= 2 && hasParticleHint(item)) wantedRaw = 'particle-duel';
  if (wantedRaw === 'particle-duel' && !hasParticleHint(item)) wantedRaw = exerciseFor(qc, ctx.station, ctx.settings);
  if (!isDrillId(wantedRaw)) return null;
  const exercise = pickDrill(ctx, wantedRaw);
  if (!exercise) return null;
  const params = { ...resolveParams(ctx, exercise, item, { qc, rep: o.rep ?? qc.exposures }), ...(o.params ?? {}) };
  const ring = qc.mature && !o.timed ? speedRingMs(ctx, exercise) : undefined;
  return makeStep(ctx, {
    block,
    exercise,
    itemId: qc.itemId,
    cardKey: qc.cardKey,
    params,
    timed: o.timed ?? false,
    timerMs: o.timerMs ?? ring,
    isNew: o.isNew ?? false,
    stepTag: o.stepTag ?? qc.tag ?? null,
    exposures: qc.exposures,
    id: o.id,
  });
}

/** `QueueCard` for a key read from the store (`undefined` when absent). */
export function queueCardOf(ctx: PlanContext, key: CardKey): QueueCard | undefined {
  return queueCardFor(store.cards, key, ctx.today);
}

/** A synthetic `QueueCard` for an item that has no card yet (scroll pretests / intros). */
export function freshQueueCard(itemId: string, kind: ItemKind, facet: QueueCard['facet']): QueueCard {
  return { cardKey: makeKey(itemId, facet), itemId, kind, facet, r: 0, mature: false, exposures: 0 };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pickers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */


export function michikusaStep(ctx: PlanContext): Step | null {
  const m = michikusaFor(ctx);
  if (!m) return null;
  return makeStep(ctx, { block: 'michikusa', exercise: MICHIKUSA_DRILL, itemId: m.id, cardKey: null, params: { michikusaId: m.id }, isNew: m.isNew, estMs: 10_000 });
}


/* ────────────────────────────────────────────────────────────────────────── */
/* Assembly                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PlanMeta {
  dueTotal: number;
  dueTaken: number;
  backlog: boolean;
  newCount: number;
  scrollIds: string[];
  storyId?: string;
  michikusaId?: string;
}

/**
 * Assembles the plan from filled blocks: steps in block order, minute
 * estimates from the steps (or the template's minutes with `templateMinutes`).
 * Empty blocks are dropped.
 */
export function finalizePlan(ctx: PlanContext, mode: SessionMode, blocks: (PlannedBlock & { steps: Step[] })[], meta: PlanMeta, o: { templateMinutes?: boolean } = {}): SessionPlan {
  const kept = blocks.filter((b) => b.steps.length > 0);
  const steps = kept.flatMap((b) => b.steps);
  return {
    id: ctx.planKey,
    mode,
    day: ctx.today,
    createdAt: ctx.now,
    station: ctx.station,
    steps,
    blocks: kept.map((b) => ({
      kind: b.kind,
      label: b.label,
      estMinutes: o.templateMinutes ? b.minutes : Math.round((b.steps.reduce((a, s) => a + (s.estMs > 0 ? s.estMs : estimateStepMs(s.exercise, s.params, ctx.medianMs)), 0) / 60_000) * 10) / 10,
      stepIds: b.steps.map((s) => s.id),
    })),
    meta,
  };
}

function toSteps(ctx: PlanContext, cards: QueueCard[], block: BlockKind, used: Set<CardKey>): Step[] {
  const out: Step[] = [];
  for (const c of cards) {
    const s = stepForCard(ctx, c, block);
    if (!s) continue;
    used.add(c.cardKey);
    out.push(s);
  }
  return out;
}

/** Wave + interleave over a card list. */
export function composeReviews(cards: QueueCard[]): QueueCard[] {
  return interleave(orderWave(cards));
}

function scrollBlockSteps(ctx: PlanContext, scrolls: Scroll[]): { steps: Step[]; itemIds: string[] } {
  const steps: Step[] = [];
  const itemIds: string[] = [];
  for (const sc of scrolls) {
    const parts = scrollSteps(sc, (id) => ctx.loader.get(id), ctx.rng, {
      station: ctx.station,
      settings: ctx.settings,
      available: ctx.available,
      resolve: (ex, item, qc) => resolveParams(ctx, ex, item, { qc, rep: 0 }),
      estMs: (ex, params) => estimateStepMs(ex, params, ctx.medianMs),
    });
    steps.push(...parts.pretest, ...parts.checks);
    itemIds.push(...sc.itemIds);
  }
  return { steps, itemIds };
}

/**
 * Output block steps: a shadow set over known sentences, one role-play turn,
 * one Say It Three Ways, one Monologue (Reduce & Expand over `storyId` from
 * Station 37), or one Writing Dojo piece. An unavailable drill falls back to
 * a 3-line shadow set; with nothing registered the block is empty.
 */
export function outputBlockSteps(ctx: PlanContext, kind: OutputKind | undefined, count: number, storyId?: string): Step[] {
  const out: Step[] = [];
  const dialogues = pickStories(ctx, { kind: 'dialogue' });
  const h = hashSeed(ctx.seed, ctx.today, 'output');
  const fallback = (): Step[] => (kind === 'shadow' ? out : outputBlockSteps(ctx, 'shadow', 3));
  switch (kind) {
    case 'shadow': {
      const ex = pickDrill(ctx, 'shadow');
      if (ex !== 'shadow') return out;
      for (const s of knownSentences(ctx, count)) {
        const vocabId = s.storyId ? ctx.loader.get<StoryItem>(s.storyId)?.lines[s.lineIndex ?? 0]?.tokenIds?.find((x): x is string => x !== null && x.startsWith('v-')) : undefined;
        const params = s.storyId !== undefined ? resolveParams(ctx, ex, null, { storyId: s.storyId, lineIndex: s.lineIndex }) : { sentence: s.sentence, answer: s.kana, accept: dedupe([toPlain(s.sentence), s.kana]), promptEn: s.en, rate: rateFor(ctx) };
        out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: vocabId ?? null, cardKey: null, params }));
      }
      return out;
    }
    case 'role-play': {
      const ex = pickDrill(ctx, 'role-play');
      const story = dialogues[h % Math.max(1, dialogues.length)];
      if (ex !== 'role-play' || !story) return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: story.id, cardKey: null, params: resolveParams(ctx, ex, story, { storyId: story.id }) }));
      return out;
    }
    case 'three-ways': {
      const ex = pickDrill(ctx, 'say-three-ways');
      if (ex !== 'say-three-ways') return fallback();
      const grammar = ctx.grammarPool.filter((g) => ctx.known.has(g.id));
      const g = grammar[h % Math.max(1, grammar.length)] ?? ctx.grammarPool[0];
      if (!g) return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: g.id, cardKey: null, params: resolveParams(ctx, ex, g, { rep: h }) }));
      return out;
    }
    case 'monologue': {
      const ex = pickDrill(ctx, 'monologue');
      if (ex !== 'monologue') return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: null, cardKey: null, params: resolveParams(ctx, ex, null, storyId ? { storyId } : {}) }));
      return out;
    }
    case 'writing': {
      const ex = pickDrill(ctx, 'writing-dojo');
      if (ex !== 'writing-dojo') return fallback();
      out.push(makeStep(ctx, { block: 'output', exercise: ex, itemId: null, cardKey: null, params: resolveParams(ctx, ex, null) }));
      return out;
    }
    default:
      return out;
  }
}

function inputSteps(ctx: PlanContext, kind: PlannedBlock['spec']['inputKind']): { steps: Step[]; storyId?: string } {
  const want: DrillId = kind === 'listening' ? 'listening-set' : 'story-read';
  const ex = pickDrill(ctx, want);
  if (!ex) return { steps: [] };
  const stories = pickStories(ctx, { kind: ex === 'listening-set' ? 'dialogue' : 'story' });
  const story = stories[0] ?? (ex === 'listening-set' ? undefined : pickStories(ctx, { kind: 'dialogue' })[0]);
  if (!story) return { steps: [] };
  return { steps: [makeStep(ctx, { block: 'input', exercise: ex, itemId: story.id, cardKey: null, params: resolveParams(ctx, ex, story, { storyId: story.id }) })], storyId: story.id };
}

function weakSteps(ctx: PlanContext, tag: ErrorTag | undefined, count: number, used: Set<CardKey>): Step[] {
  if (!tag) return [];
  const cards = weakPointSet(tag, store.cards, store.log.recent(5000), ctx.today).slice(0, count);
  const steps = toSteps(ctx, composeReviews(cards), 'weak', used);
  for (const s of steps) s.params.tag = tag;
  return steps;
}

function recheckSteps(ctx: PlanContext, used: Set<CardKey>, max: number): Step[] {
  const cards = recheckCards(store.cards).slice(0, max);
  const out: Step[] = [];
  for (const c of cards) {
    const s = stepForCard(ctx, c, 'reviews', { params: { recheck: true } });
    if (!s) continue;
    used.add(c.cardKey);
    out.push(s);
  }
  return out;
}


/** The context's template inputs. */
export function templateCtx(ctx: PlanContext, o: { tag?: ErrorTag; kageDue?: boolean } = {}): TemplateCtx {
  const weak = store.weakPoints.value;
  const tags = (Object.keys(weak) as ErrorTag[]).filter((t) => weak[t].active).sort((a, b) => weak[b].ewma - weak[a].ewma);
  const minutes = weekStrandMinutes(ctx.today);
  return {
    belt: ctx.belt,
    station: ctx.station,
    backlog: ctx.backlog,
    dueCount: ctx.showDue,
    weakTags: o.tag ? [o.tag, ...tags.filter((t) => t !== o.tag)] : tags,
    strandDeficit: strandDeficitFor(minutes, ctx.belt, store.profile.value.dan),
    kageDue: o.kageDue ?? false,
    newTarget: ctx.newTarget,
    day: ctx.today,
  };
}

/** Minutes a mode may fill before `fitToTime` trims: the design's upper bound (Kumite 10–14, Shugyō 30–45) plus the Michikusa's 10 s. */
export function fitBudgetMinutes(mode: SessionMode): number {
  const slack = mode === 'kata' ? 0.5 : mode === 'kumite' ? 4.5 : mode === 'shugyo' ? 15.5 : mode === 'welcome' ? 0.5 : 0;
  return MODE_MINUTES[mode] + slack;
}

/**
 * Today's Nemesis steps (design 04 §9): the day-0 dossier of every newly flagged
 * item and one duel per duel-ready item, with the builder's full params. They
 * ride inside a Kumite or larger as a small block ahead of the sparring.
 */
export function nemesisBlockSteps(ctx: PlanContext): Step[] {
  if (pickDrill(ctx, 'nemesis-duel') !== 'nemesis-duel') return [];
  const entries = [...nemesisItems(ctx.today).filter((e) => e.phase === 'dossier'), ...duelsReady(ctx.today)];
  const out: Step[] = [];
  for (const e of entries) out.push(...nemesisSteps(e.itemId, ctx.today, { loader: ctx.loader, resolve: (d, i, qc) => resolveParams(ctx, d, i, { qc, rep: ctx.today }) }));
  return out;
}

/** `buildPlan` for the training modes; see the module header for the boss / exam / Kage / Dan builders. */
export async function buildPlan(mode: SessionMode, o: PlanOptions = {}): Promise<SessionPlan> {
  if (mode === 'gate' || mode === 'shinsa' || mode === 'kage' || mode === 'dan') {
    const fn = mode === 'gate' ? 'buildGate' : mode === 'shinsa' ? 'buildShinsa' : mode === 'kage' ? 'buildKage' : 'buildGauntlet';
    throw new RangeError(`buildPlan: mode "${mode}" is built by ${fn}() in src/session`);
  }
  const ctx = await loadPlanContext({ ...o, mode });
  const template = fitToTime(templateFor(mode, templateCtx(ctx, { tag: o.tag })), fitBudgetMinutes(mode), { due: ctx.showDue });
  const used = new Set<CardKey>();
  const blocks: (PlannedBlock & { steps: Step[] })[] = [];
  const meta: PlanMeta = { dueTotal: ctx.dueTotal, dueTaken: 0, backlog: ctx.backlog, newCount: 0, scrollIds: [] };
  let dueBudget = ctx.showDue;

  // Nemesis dossier / duel steps come first so their cards are held out of every review draw: the duel is the item's rep of the day.
  const nemesis = mode === 'kumite' || mode === 'shugyo' ? nemesisBlockSteps(ctx) : [];
  for (const s of nemesis) if (s.cardKey) used.add(s.cardKey);

  // Sparring wants ≥ 2 listen reps where available (design 03 §2.2): hold them back from the warm-up.
  const sparringSpec = template.find((t) => t.kind === 'sparring')?.spec;
  const listenWanted = sparringSpec?.facetMix?.listen ?? 0;
  const reserved: QueueCard[] = listenWanted > 0 ? dueQueue(ctx, Math.max(ctx.showDue, 1), used).filter((c) => c.facet === 'listen').slice(0, listenWanted) : [];
  for (const c of reserved) used.add(c.cardKey);

  const takeDue = (n: number): QueueCard[] => {
    const cards = dueQueue(ctx, Math.min(n, Math.max(0, dueBudget)), used);
    for (const c of cards) used.add(c.cardKey);
    dueBudget -= cards.length;
    meta.dueTaken += cards.length;
    return cards;
  };

  for (const t of template) {
    const spec = t.spec;
    let steps: Step[] = [];
    if (t.kind === 'sparring' && nemesis.length > 0) {
      const minutes = Math.round((nemesis.reduce((a, s) => a + s.estMs, 0) / 60_000) * 10) / 10;
      blocks.push({ kind: 'weak', label: S.blockNemesis, minutes, spec: { kind: 'weak', minutes, count: nemesis.length }, stepIds: nemesis.map((s) => s.id), steps: nemesis });
    }
    switch (t.kind) {
      case 'reviews': {
        if (mode === 'welcome') {
          steps = toSteps(ctx, composeReviews(welcomeSet(ctx, spec.count ?? 20)), 'reviews', used);
          meta.dueTaken += steps.length;
        } else {
          const rechecks = recheckSteps(ctx, used, 5);
          const cards = takeDue(Math.max(0, (spec.count ?? 0) - rechecks.length));
          steps = [...rechecks, ...toSteps(ctx, composeReviews(cards), 'reviews', used)];
          meta.dueTaken -= cards.length - steps.filter((s) => !s.params.recheck).length;
          if (mode === 'kata') {
            const m = michikusaStep(ctx);
            if (m && steps.length > 0) {
              steps.splice(Math.min(MICHIKUSA_AFTER_REP, steps.length), 0, m);
              meta.michikusaId = m.params.michikusaId;
            }
          }
        }
        break;
      }
      case 'warmup': {
        if (spec.outputKind === 'shadow' && pickDrill(ctx, 'shadow') === 'shadow') {
          const sh = outputBlockSteps(ctx, 'shadow', spec.count ?? 3);
          for (const s of sh) s.block = 'warmup';
          steps = sh;
        }
        if (steps.length === 0) {
          const cards = takeDue(spec.count ?? 3);
          steps = toSteps(ctx, composeReviews(cards), 'warmup', used);
        }
        break;
      }
      case 'scroll': {
        const max = ctx.newTarget > 0 ? (spec.scrollCount ?? 1) : spec.minCount ?? 1;
        const scrolls = ctx.newAllowed > 0 || ctx.newTarget > 0 ? scrollsForToday(ctx, max) : [];
        const sb = scrollBlockSteps(ctx, scrolls);
        steps = sb.steps;
        meta.scrollIds.push(...scrolls.map((s) => s.id));
        meta.newCount += sb.itemIds.length;
        break;
      }
      case 'sparring': {
        if (mode === 'rapid' || mode === 'gojuon') {
          const ex = pickDrill(ctx, mode === 'rapid' ? 'rapid-fire' : 'gojuon-fighter');
          if (ex) steps = [makeStep(ctx, { block: 'sparring', exercise: ex, itemId: null, cardKey: null, params: resolveParams(ctx, ex, null) })];
          break;
        }
        const room = Math.max(5, (spec.count ?? 15) - 2 * meta.newCount);
        const listenMin = spec.facetMix?.listen ?? 0;
        for (const c of reserved) used.delete(c.cardKey);
        const pool = dueQueue(ctx, Math.max(room * 2, 20), used);
        const listen = [...reserved, ...pool.filter((c) => c.facet === 'listen' && !reserved.some((r) => r.cardKey === c.cardKey))].slice(0, listenMin);
        const rest = pool.filter((c) => !listen.some((l) => l.cardKey === c.cardKey)).slice(0, Math.max(0, room - listen.length));
        const chosen = [...listen, ...rest].slice(0, Math.min(room, Math.max(0, dueBudget) + listen.length));
        for (const c of chosen) used.add(c.cardKey);
        dueBudget -= chosen.length;
        meta.dueTaken += chosen.length;
        steps = toSteps(ctx, composeReviews(chosen), 'sparring', used);
        break;
      }
      case 'input': {
        const r = inputSteps(ctx, spec.inputKind);
        steps = r.steps;
        if (r.storyId) meta.storyId = r.storyId;
        break;
      }
      case 'output': {
        steps = outputBlockSteps(ctx, spec.outputKind, spec.count ?? 3, meta.storyId);
        break;
      }
      case 'weak': {
        steps = weakSteps(ctx, spec.tag ?? o.tag, spec.count ?? 20, used);
        break;
      }
      case 'michikusa': {
        if (mode === 'kata') break; // placed inside the reviews block, between reps 8 and 9
        const m = michikusaStep(ctx);
        if (m) {
          steps = [m];
          meta.michikusaId = m.params.michikusaId;
        }
        break;
      }
      case 'cooldown': {
        const n = spec.count ?? 3;
        let cards = takeDue(n);
        if (cards.length < n) cards = cards.concat(easiestCards(ctx, n - cards.length, used));
        for (const c of cards) used.add(c.cardKey);
        steps = toSteps(ctx, cards.sort((a, b) => b.r - a.r), 'cooldown', used);
        break;
      }
      case 'phase':
        break;
    }
    blocks.push({ kind: t.kind, label: t.label, minutes: t.minutes, spec, stepIds: steps.map((s) => s.id), steps });
  }
  return finalizePlan(ctx, mode, blocks, meta);
}

/** The plan a snapshot was taken from (its steps include the runner's re-queues). */
export function planFromSnapshot(s: SessionSnapshot): SessionPlan {
  return s.plan;
}

/** Retrievability helper re-exported for the feed and end card. */
export function retrievabilityOf(t: CardTuple, today: EpochDay): number {
  return cardRetrievability(t, today);
}

/** Item kind for a key from the store's facets (chunks detected). */
export function kindForKey(key: CardKey): ItemKind | null {
  const { itemId } = parseCardKey(key);
  return kindOfCards(itemId, Object.keys(store.cards.byItem(itemId)) as QueueCard['facet'][]) ?? null;
}
