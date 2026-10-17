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
 * The lower-level pieces (`loadPlanContext`, `stepForCard`, `resolveParams`,
 * `makeStep`, `finalizePlan`, pickers) are exported for the boss, exam, Kage
 * and Dan builders in this folder. Everything is seeded from `store.seed()` +
 * `store.today()` + the mode; no clock or `Math.random`.
 *
 * Modes `gate`, `shinsa`, `kage` and `dan` have their own builders
 * (`buildGate`, `buildShinsa`, `buildKage`, `buildGauntlet`); `buildPlan`
 * rejects them with a `RangeError` naming the right function.
 */
import {
  DRILL_IDS,
  coverageTargetFor,
  type Belt,
  type CardKey,
  type ComponentDef,
  type ConjForm,
  type ContentItem,
  type DrillId,
  type ErrorTag,
  type GrammarItem,
  type KanaItem,
  type KanjiItem,
  type SentenceExample,
  type StationBundle,
  type StoryItem,
  type StoryLine,
  type VocabItem,
} from '../content/types';
import { content as appContent, isChunk, type ContentLoader } from '../content/loader';
import { toPlain } from '../content/ruby';
import { SPEED_TIER_RATES } from '../shared/audio';
import { MISSIONS } from '../shared/catalog';
import { isRegistered } from '../shared/exercise-types';
import { hashSeed, rngFor, sample, shuffle, type Rng } from '../shared/hash';
import { cardKey as makeKey, parseCardKey, tryKindOfId } from '../shared/ids';
import { moraCount } from '../shared/jp';
import type { BlockKind, SessionMode, SessionPlan, SessionSnapshot, Step, StepParams, StepTag } from '../shared/session-types';
import { CardFlag, hasFlag, type CardTuple, type EpochDay, type ItemKind, type SaveMeta, type Settings } from '../shared/store-types';
import { store } from '../store';
import { beltOfStation } from '../store/derived';
import {
  EXPECTED_MAX_MINUTES,
  applicableForms,
  capFor,
  cardRetrievability,
  clozeTiles,
  conjugate,
  dueCards,
  exerciseFor,
  gojuonPool,
  governor,
  interleave,
  isConjugable,
  kaidenQuota,
  kanaGrid,
  kanjiLookalikes,
  kindOfCards,
  knownSet,
  meaningChoices,
  nextScrolls,
  orderWave,
  perceptionJudge,
  prodPrompt,
  queueCardFor,
  rapidFirePool,
  recheckCards,
  scrambleTiles,
  weakPointSet,
  type QueueCard,
  type Scroll,
} from '../learn';
import { MICHIKUSA_AFTER_REP, MICHIKUSA_DRILL, MODE_MINUTES, estimateStepMs, fitToTime, strandDeficitFor, templateFor, type OutputKind, type PlannedBlock, type Strand, type TemplateCtx } from './blocks';
import { S, fill } from './engine-strings';
import { scrollSteps } from './scroll';

/* ────────────────────────────────────────────────────────────────────────── */
/* Local adapters for helpers the `@/learn` barrel does not re-export          */
/* ────────────────────────────────────────────────────────────────────────── */

/** Particle Duel keys (design 04 §4; `learn/distractors.PARTICLES` is not in the barrel). */
export const PARTICLES: readonly string[] = ['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の'];

const ROMAJI_46 = ['a', 'i', 'u', 'e', 'o', 'ka', 'ki', 'ku', 'ke', 'ko', 'sa', 'shi', 'su', 'se', 'so', 'ta', 'chi', 'tsu', 'te', 'to', 'na', 'ni', 'nu', 'ne', 'no', 'ha', 'hi', 'fu', 'he', 'ho', 'ma', 'mi', 'mu', 'me', 'mo', 'ya', 'yu', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'wa', 'wo', 'n'];

const DRILL_SET: ReadonlySet<string> = new Set(DRILL_IDS);
export function isDrillId(x: string): x is DrillId {
  return DRILL_SET.has(x);
}

/** Speed-read cpm targets by level (design 04 §7). */
export const SPEED_READ_CPM: Record<Belt, number> = { white: 80, yellow: 80, orange: 80, green: 150, blue: 250, purple: 250, brown: 350, black: 450 };

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

function isVocab(i: ContentItem | null | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i;
}
function isKanji(i: ContentItem | null | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i;
}
function isGrammar(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}
function isKana(i: ContentItem | null | undefined): i is KanaItem {
  return !!i && 'romaji' in i && 'script' in i;
}
function isStory(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && 'stationId' in i;
}
function isComponent(i: ContentItem | null | undefined): i is ComponentDef {
  return !!i && 'char' in i && 'name' in i && !('strokes' in i);
}
export { isVocab, isKanji, isGrammar, isKana, isStory, isComponent };

/** Item kind from an id and (when loaded) its content: set-phrase / aizuchi vocab is `chunk`. */
export function itemKindOf(itemId: string, item?: ContentItem): ItemKind | null {
  const k = tryKindOfId(itemId);
  if (k === 'vocab') return item && isChunk(item) ? 'chunk' : 'vocab';
  if (k === 'kana' || k === 'kanji' || k === 'grammar' || k === 'component') return k;
  return null;
}

/** 7-day accuracy from the daily rows (`ok / reps`), with the rep count behind it. */
export function accuracy7(daily: SaveMeta['daily'], today: EpochDay): { acc7: number; n: number } {
  let ok = 0;
  let reps = 0;
  for (let d = today - 6; d <= today; d++) {
    const row = daily[d];
    if (!row) continue;
    ok += row.ok;
    reps += row.reps;
  }
  return { acc7: reps > 0 ? ok / reps : 1, n: reps };
}

/** Items introduced today, by kind (base-facet cards whose `last` is today with one rep or fewer, or state-0 cards created today). */
export function introducedToday(today: EpochDay): { vocab: number; kanji: number; grammar: number; kana: number; component: number } {
  const out = { vocab: 0, kanji: 0, grammar: 0, kana: 0, component: 0 };
  const seen = new Set<string>();
  store.cards.forEach((k, t) => {
    const { itemId, facet } = parseCardKey(k);
    if (seen.has(itemId)) return;
    const kind = tryKindOfId(itemId);
    if (!kind || !(kind in out)) return;
    const base = kind === 'kanji' ? 'comp' : kind === 'grammar' ? 'cloze' : 'rec';
    if (facet !== base && !(kind === 'vocab' && facet === 'prod')) return;
    if (t[6] === today && t[3] <= 2 && (t[5] === 0 || t[5] === 1)) {
      seen.add(itemId);
      out[kind as keyof typeof out]++;
    }
  });
  return out;
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

  // Items behind every due card must be in memory for params (Kaiden lane included; archived excluded).
  const dueKeys: CardKey[] = [];
  store.cards.forEach((k, t) => {
    if (t[0] <= today && t[5] !== 0 && !hasFlag(t[7], CardFlag.archived)) dueKeys.push(k);
  });
  const dueItems = Array.from(new Set(dueKeys.map((k) => parseCardKey(k).itemId)));
  try {
    await loader.load(dueItems.filter((id) => loader.get(id) === undefined));
  } catch {
    /* offline: cards whose content is missing are skipped by stepForCard */
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

  const cap = capFor(settings.intensity, belt, settings.maxReviews);
  const dueTotal = dueKeys.length;
  const { acc7, n } = accuracy7(store.daily.value, today);
  const intro = introducedToday(today);
  const npd = settings.newPerDay;
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
  const wantedRaw = o.exercise ?? exerciseFor(qc, ctx.station, ctx.settings);
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
/* Params                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const FORM_LABEL: Record<ConjForm, string> = {
  masu: 'polite (ます)',
  masen: 'polite negative (ません)',
  mashita: 'polite past (ました)',
  'masen-deshita': 'polite past negative (ませんでした)',
  masho: 'polite volitional (ましょう)',
  te: 'te-form',
  nai: 'plain negative (ない)',
  ta: 'plain past (た)',
  nakatta: 'plain past negative (なかった)',
  potential: 'potential',
  volitional: 'volitional',
  passive: 'passive',
  causative: 'causative',
  'causative-passive': 'causative-passive',
  imperative: 'imperative',
  prohibitive: 'prohibitive (な)',
  ba: 'conditional (ば)',
  tara: 'conditional (たら)',
  tai: 'want to (たい)',
  'te-iru': 'progressive (ている)',
  'adj-neg': 'negative',
  'adj-past': 'past',
  'adj-past-neg': 'past negative',
  'adj-te': 'te-form',
  'adj-adv': 'adverbial',
  'adj-ba': 'conditional (ば)',
};

function dedupe(xs: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const x of xs) if (x && !out.includes(x)) out.push(x);
  return out;
}

function exampleAt(examples: readonly SentenceExample[], rep: number): SentenceExample | undefined {
  if (examples.length === 0) return undefined;
  return examples[((rep % examples.length) + examples.length) % examples.length];
}

/** Pitch pattern name from the nucleus and the mora count (design 04 §2). */
export function pitchPattern(pitch: number, kana: string): string {
  const n = moraCount(kana);
  if (pitch === 0) return '平板';
  if (pitch === 1) return '頭高';
  if (pitch >= n) return '尾高';
  return '中高';
}
export const PITCH_PATTERNS = ['平板', '頭高', '中高', '尾高'] as const;

/** Rate preset for the learner's speed tier (design 04 §5). */
export function rateFor(ctx: PlanContext): number {
  return SPEED_TIER_RATES[ctx.settings.speedTier];
}

/** Story lines (station ≤ current) whose `tokenIds` name `itemId`. */
export function linesWith(ctx: PlanContext, itemId: string): { story: StoryItem; index: number }[] {
  const out: { story: StoryItem; index: number }[] = [];
  for (const story of ctx.stories) {
    story.lines.forEach((line, index) => {
      if (line.tokenIds?.includes(itemId)) out.push({ story, index });
    });
  }
  return out;
}

/** Fraction of resolved tokens the learner knows (`tokenIds` non-null entries). */
export function storyCoverage(story: StoryItem, known: ReadonlySet<string>): number {
  let total = 0;
  let hit = 0;
  for (const line of story.lines) {
    for (const id of line.tokenIds ?? []) {
      if (id === null) continue;
      total++;
      if (known.has(id)) hit++;
    }
  }
  return total === 0 ? 1 : hit / total;
}

/** Stories of the loaded bundles that meet the live coverage target, best coverage first. */
export function pickStories(ctx: PlanContext, o: { kind?: StoryItem['kind']; station?: number } = {}): StoryItem[] {
  const st = o.station ?? ctx.station;
  return ctx.stories
    .filter((s) => (o.kind ? s.kind === o.kind : true))
    .map((s) => ({ s, c: storyCoverage(s, ctx.known) }))
    .filter(({ s, c }) => c >= coverageTargetFor(st, s.bridge === true))
    .sort((a, b) => b.c - a.c || (a.s.id < b.s.id ? -1 : 1))
    .map(({ s }) => s);
}

/** Sentences whose resolved tokens are all known (shadow warm-up), as story lines or vocab examples. */
export function knownSentences(ctx: PlanContext, n: number): { sentence: string; kana: string; en: string; storyId?: string; lineIndex?: number }[] {
  const out: { sentence: string; kana: string; en: string; storyId?: string; lineIndex?: number }[] = [];
  for (const story of ctx.stories) {
    story.lines.forEach((line, lineIndex) => {
      const ids = (line.tokenIds ?? []).filter((x): x is string => x !== null);
      if (ids.length === 0 || !ids.every((id) => ctx.known.has(id))) return;
      out.push({ sentence: toPlain(line.ja), kana: line.kana, en: line.en, storyId: story.id, lineIndex });
    });
  }
  if (out.length < n) {
    for (const v of ctx.vocabPool) {
      if (!ctx.known.has(v.id)) continue;
      const ex = v.examples[0];
      if (ex) out.push({ sentence: toPlain(ex.ja), kana: ex.kana, en: ex.en });
    }
  }
  return sample(ctx.rng, out, n);
}

function splitBunsetsu(plain: string): string[] {
  const particles = PARTICLES.slice().sort((a, b) => b.length - a.length);
  const tiles: string[] = [];
  let cur = '';
  let i = 0;
  while (i < plain.length) {
    const ch = plain[i] as string;
    if ('、。！？'.includes(ch)) {
      if (cur) tiles.push(cur);
      tiles.push(ch);
      cur = '';
      i++;
      continue;
    }
    const p = particles.find((x) => plain.startsWith(x, i) && cur.length > 0);
    if (p) {
      tiles.push(cur + p);
      cur = '';
      i += p.length;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur) tiles.push(cur);
  return tiles;
}

export interface ResolveOpts {
  qc?: QueueCard;
  /** Rotation index (prompt rotation). */
  rep?: number;
  storyId?: string;
  lineIndex?: number;
}

/**
 * Resolved `StepParams` for a drill over an item (design 04 interaction specs).
 * Deterministic: every draw goes through `ctx.rng`.
 */
export function resolveParams(ctx: PlanContext, exercise: DrillId, item: ContentItem | null, o: ResolveOpts = {}): StepParams {
  const rep = o.rep ?? 0;
  const rng = ctx.rng;
  const p: StepParams = {};
  switch (exercise) {
    case 'kana-flash': {
      if (!isKana(item)) break;
      p.answer = item.romaji;
      p.accept = dedupe([item.romaji]);
      if ((o.qc?.exposures ?? 0) < 2) {
        const others = shuffle(rng, ctx.kanaPool.filter((k) => k.id !== item.id && k.romaji !== item.romaji).map((k) => k.romaji));
        const pool = others.length >= 3 ? others : others.concat(shuffle(rng, ROMAJI_46.filter((r) => r !== item.romaji && !others.includes(r))));
        p.choices = shuffle(rng, [item.romaji, ...dedupe(pool).slice(0, 3)]);
      }
      break;
    }
    case 'kana-ear': {
      if (!isKana(item)) break;
      p.answer = item.kana;
      p.choices = kanaGrid(item, ctx.kanaPool, rng);
      break;
    }
    case 'kana-forge': {
      if (!isKana(item)) break;
      p.answer = item.kana;
      p.accept = [item.kana];
      p.promptEn = item.romaji;
      break;
    }
    case 'meaning-guard':
    case 'audio-flash': {
      if (!isVocab(item)) break;
      p.answer = item.meanings[0] ?? '';
      p.accept = dedupe(item.meanings);
      if (exercise === 'meaning-guard' || (o.qc?.exposures ?? 0) < 2) p.choices = meaningChoices(item, ctx.vocabPool, rng);
      break;
    }
    case 'meaning-recall':
    case 'meaning-judge': {
      if (!isVocab(item)) break;
      p.answer = item.meanings[0] ?? '';
      p.accept = dedupe(item.meanings);
      if (item.definitionJa) p.sentence = toPlain(item.definitionJa.ja);
      break;
    }
    case 'production-forge': {
      if (!isVocab(item)) break;
      const prompt = prodPrompt(item, ctx.stories, rep);
      p.sentence = prompt.sentence;
      p.blank = prompt.blank;
      p.promptEn = `${item.meanings[0] ?? ''} — ${prompt.en}`;
      p.answer = item.word;
      p.accept = dedupe([item.word, item.kana, ...(item.altForms ?? [])]);
      const homophones = ctx.vocabPool.filter((v) => v.id !== item.id && v.kana === item.kana && v.word !== item.word).map((v) => v.word);
      p.candidates = dedupe([item.word, ...homophones]);
      const kanjiRead7 = (item.kanjiIds ?? []).some((kid) => {
        const c = store.cards.get(makeKey(kid, 'read'));
        return !!c && c[1] >= 7;
      });
      p.kanaOnlyPolicy = ctx.station >= 16 && kanjiRead7 ? 'hard' : 'good';
      break;
    }
    case 'pitch-ear': {
      if (!isVocab(item) || item.pitch === undefined) break;
      p.answer = pitchPattern(item.pitch, item.kana);
      p.choices = [...PITCH_PATTERNS];
      break;
    }
    case 'component-flash': {
      if (!isComponent(item)) break;
      p.answer = item.name;
      p.accept = [item.name];
      if ((o.qc?.exposures ?? 0) < 2) {
        const others = shuffle(rng, Array.from(ctx.components.values()).filter((c) => c.id !== item.id).map((c) => c.name));
        p.choices = shuffle(rng, [item.name, ...dedupe(others).slice(0, 3)]);
      }
      break;
    }
    case 'component-assembly': {
      if (!isKanji(item)) break;
      const names = item.components;
      const chars = names.map((n) => Array.from(ctx.components.values()).find((c) => c.name === n)?.char ?? n);
      const fillers = shuffle(rng, Array.from(ctx.components.values()).filter((c) => !names.includes(c.name)).map((c) => c.char));
      p.tiles = shuffle(rng, dedupe([...chars, ...fillers]).slice(0, Math.max(8, chars.length)));
      p.answers = chars;
      p.answer = item.char;
      p.accept = [item.char];
      p.layout = names.length <= 1 ? 'enc' : hashSeed(ctx.seed, item.id) % 2 === 0 ? 'lr' : 'tb';
      p.promptEn = `${item.meanings[0] ?? ''} · ${item.on[0] ?? item.kun[0] ?? ''}`;
      break;
    }
    case 'kanji-read':
    case 'lookalike-duel': {
      if (!isKanji(item)) break;
      const ex = item.examples[((rep % item.examples.length) + item.examples.length) % item.examples.length] ?? item.examples[0];
      const word = ex?.word ?? item.char;
      let sentence = word;
      let en = ex?.en ?? '';
      let kana = ex?.kana ?? '';
      const vocab = ctx.vocabPool.find((v) => v.word === word);
      const line = vocab ? linesWith(ctx, vocab.id)[0] : undefined;
      const sx = line ? line.story.lines[line.index] : vocab?.examples[0];
      if (sx) {
        const plain = toPlain(sx.ja);
        if (plain.includes(word)) {
          sentence = plain;
          en = sx.en;
        }
      }
      const start = sentence.indexOf(exercise === 'kanji-read' ? word : item.char);
      p.sentence = sentence;
      p.blank = start >= 0 ? [start, start + (exercise === 'kanji-read' ? word.length : item.char.length)] : [0, 0];
      p.promptEn = en;
      if (exercise === 'kanji-read') {
        p.answer = kana;
        p.accept = dedupe([kana]);
      } else {
        p.answer = item.char;
        p.choices = kanjiLookalikes(item, ctx.kanjiPool, rng);
        p.accept = [item.char];
      }
      break;
    }
    case 'pattern-cloze': {
      if (!isGrammar(item)) break;
      const ex = exampleAt(item.examples, rep);
      const sentence = ex ? toPlain(ex.ja) : item.pattern;
      const hint = item.clozeHints.find((h) => sentence.includes(h)) ?? item.clozeHints[0] ?? item.pattern;
      const start = sentence.indexOf(hint);
      p.sentence = sentence;
      p.blank = start >= 0 ? [start, start + hint.length] : [0, 0];
      p.answer = hint;
      p.accept = dedupe([hint]);
      p.promptEn = ex?.en ?? item.meaning;
      if ((o.qc?.exposures ?? 0) < 2) p.tiles = clozeTiles(item, ctx.grammarPool, rng, hint);
      break;
    }
    case 'particle-duel': {
      if (!isGrammar(item)) break;
      const ex = exampleAt(item.examples, rep);
      const sentence = ex ? toPlain(ex.ja) : item.pattern;
      const blanks: [number, number][] = [];
      const answers: string[] = [];
      const sorted = PARTICLES.slice().sort((a, b) => b.length - a.length);
      for (let i = 0; i < sentence.length && blanks.length < 3; i++) {
        const prt = sorted.find((x) => sentence.startsWith(x, i));
        if (prt && i > 0) {
          blanks.push([i, i + prt.length]);
          answers.push(prt);
          i += prt.length - 1;
        }
      }
      p.sentence = sentence;
      p.blanks = blanks;
      p.answers = answers;
      p.answer = answers[0] ?? '';
      p.choices = [...PARTICLES];
      p.promptEn = ex?.en ?? item.meaning;
      break;
    }
    case 'form-forge':
    case 'form-chain': {
      if (!isGrammar(item)) break;
      const verbs = ctx.vocabPool.filter((v) => isConjugable(v.pos) && v.pos !== 'adj-na' && v.pos !== 'adj-i');
      const pool = verbs.length > 0 ? verbs : ctx.vocabPool.filter((v) => isConjugable(v.pos));
      const verb = pool[((rep % Math.max(1, pool.length)) + pool.length) % Math.max(1, pool.length)];
      if (!verb || !isConjugable(verb.pos)) break;
      const forms = (item.unlocksForms && item.unlocksForms.length > 0 ? item.unlocksForms : applicableForms(verb.pos)).filter((f) => conjugate(verb.word, verb.kana, verb.pos as never, f) !== null);
      if (forms.length === 0) break;
      p.sentence = verb.word;
      p.promptEn = verb.meanings[0] ?? '';
      if (exercise === 'form-forge') {
        const form = forms[((rep % forms.length) + forms.length) % forms.length] as ConjForm;
        const c = conjugate(verb.word, verb.kana, verb.pos as never, form);
        if (!c) break;
        p.targetForm = form;
        p.answer = c.answer;
        p.accept = dedupe([c.answer, c.answerKana, ...c.alt]);
        p.promptEn = fill(S.formForgePrompt, { word: verb.meanings[0] ?? verb.word, form: FORM_LABEL[form] });
      } else {
        const chain = forms.slice(0, 5);
        p.forms = chain;
        p.answers = chain.map((f) => conjugate(verb.word, verb.kana, verb.pos as never, f)?.answer ?? '');
        p.accept = dedupe(chain.flatMap((f) => {
          const c = conjugate(verb.word, verb.kana, verb.pos as never, f);
          return c ? [c.answer, c.answerKana, ...c.alt] : [];
        }));
      }
      break;
    }
    case 'transform': {
      if (!isGrammar(item)) break;
      const target = exampleAt(item.examples, rep);
      const source = exampleAt(item.examples, rep + 1) ?? target;
      if (!target) break;
      p.sentence = source ? toPlain(source.ja) : '';
      p.answer = toPlain(target.ja);
      p.accept = dedupe([toPlain(target.ja), target.kana]);
      p.promptEn = fill(S.transformPrompt, { pattern: item.pattern, en: target.en });
      break;
    }
    case 'scramble': {
      if (!isGrammar(item)) break;
      const line = linesWith(ctx, item.id)[rep % Math.max(1, linesWith(ctx, item.id).length)];
      const ex = line ? line.story.lines[line.index] : exampleAt(item.examples, rep);
      if (!ex) break;
      const plain = toPlain(ex.ja);
      const tokens = line && (ex as StoryLine).tokens.length > 1 ? (ex as StoryLine).tokens : splitBunsetsu(plain);
      p.tiles = scrambleTiles(ex, tokens, rng);
      p.answer = plain;
      p.accept = [plain, ex.kana];
      p.sentence = plain;
      p.promptEn = ex.en;
      break;
    }
    case 'judgment-call': {
      if (!isGrammar(item)) break;
      const mistakes = item.mistakes.map((m) => /×\s*(.+?)\s*→\s*○\s*(.+?)\s*(?:\((.*)\))?\s*$/.exec(m)).filter((m): m is RegExpExecArray => m !== null);
      const useWrong = mistakes.length > 0 && rng() < 0.5;
      if (useWrong) {
        const m = mistakes[Math.floor(rng() * mistakes.length)] as RegExpExecArray;
        p.sentence = (m[1] ?? '').trim();
        p.answer = '×';
        p.accept = [(m[2] ?? '').trim()];
        p.promptEn = (m[3] ?? '').trim() || item.meaning;
      } else {
        const ex = exampleAt(item.examples, rep);
        p.sentence = ex ? toPlain(ex.ja) : item.pattern;
        p.answer = '○';
        p.accept = ['○'];
        p.promptEn = ex?.en ?? item.meaning;
      }
      p.choices = ['○', '×'];
      break;
    }
    case 'sentence-listen':
    case 'shadow': {
      const sx = o.storyId !== undefined && o.lineIndex !== undefined ? ctx.loader.get<StoryItem>(o.storyId)?.lines[o.lineIndex] : undefined;
      const ex = sx ?? (isVocab(item) || isGrammar(item) ? exampleAt(item.examples, rep) : undefined);
      if (ex) {
        p.sentence = toPlain(ex.ja);
        p.answer = ex.kana;
        p.accept = dedupe([toPlain(ex.ja), ex.kana]);
        p.promptEn = ex.en;
      } else if (isVocab(item)) {
        p.sentence = item.word;
        p.answer = item.kana;
        p.accept = dedupe([item.word, item.kana]);
        p.promptEn = item.meanings[0] ?? '';
      }
      if (o.storyId !== undefined) p.storyId = o.storyId;
      if (o.lineIndex !== undefined) p.lineIndex = o.lineIndex;
      p.rate = rateFor(ctx);
      break;
    }
    case 'minimal-pair': {
      if (!isVocab(item)) break;
      const pair = perceptionJudge(item, ctx.vocabPool).minimalPair;
      p.answer = item.kana;
      p.choices = shuffle(rng, [pair[0], pair[1]]);
      p.rate = rateFor(ctx);
      break;
    }
    case 'listening-set':
    case 'story-read':
    case 'speed-read':
    case 'role-play': {
      if (o.storyId !== undefined) p.storyId = o.storyId;
      else if (isStory(item)) p.storyId = item.id;
      if (exercise === 'speed-read') p.rate = SPEED_READ_CPM[ctx.belt];
      else p.rate = rateFor(ctx);
      if (exercise === 'role-play') {
        p.mode = ctx.station < 10 ? 'choose' : ctx.station < 16 ? 'type' : ctx.settings.speaking === 'self' || ctx.settings.speaking === 'off' ? 'type' : 'speak';
        const story = p.storyId ? ctx.loader.get<StoryItem>(p.storyId) : undefined;
        if (story) p.registerTarget = story.register;
      }
      break;
    }
    case 'say-three-ways': {
      const ex = isVocab(item) || isGrammar(item) ? exampleAt(item.examples, rep) : undefined;
      if (ex) {
        p.sentence = toPlain(ex.ja);
        p.promptEn = fill(S.threeWaysPrompt, { en: ex.en });
      }
      p.mode = ctx.settings.speaking === 'self' || ctx.settings.speaking === 'off' ? 'type' : 'speak';
      break;
    }
    case 'monologue': {
      const topics = S.topics;
      const topic = topics[hashSeed(ctx.seed, ctx.today, 'monologue') % topics.length] as string;
      const long = ctx.belt === 'brown' || ctx.belt === 'black';
      p.seconds = long ? 120 : 60;
      p.promptEn = fill(long ? S.monologuePromptLong : S.monologuePrompt, { topic });
      if (ctx.station >= 37 && o.storyId) {
        p.mode = 'reduce-expand';
        p.storyId = o.storyId;
        p.promptEn = fill(S.reduceExpandPrompt, { n: 60 });
      }
      break;
    }
    case 'writing-dojo': {
      const patterns = ctx.grammarPool.filter((g) => ctx.known.has(g.id)).slice(-3);
      p.patternIds = (patterns.length > 0 ? patterns : ctx.grammarPool.slice(0, 2)).map((g) => g.id);
      const n = ctx.belt === 'green' ? 3 : ctx.belt === 'blue' || ctx.belt === 'purple' ? 6 : ctx.belt === 'brown' ? 9 : ctx.belt === 'black' ? 12 : 3;
      p.seconds = n * 60;
      const topic = S.topics[hashSeed(ctx.seed, ctx.today, 'writing') % S.topics.length] as string;
      p.promptEn = fill(S.writingPrompt, { n, topic });
      break;
    }
    case 'rapid-fire': {
      p.pool = rapidFirePool(store.cards, ctx.today).map((c) => c.cardKey);
      p.seconds = 60;
      break;
    }
    case 'gojuon-fighter': {
      p.pool = gojuonPool(store.cards, ctx.today).map((c) => c.cardKey);
      break;
    }
    case 'field-mission': {
      const m = MISSIONS.filter((x) => x.fromStation <= ctx.station).slice(-1)[0] ?? MISSIONS[0];
      if (m) p.missionId = m.id;
      break;
    }
    case 'nemesis-duel':
    case 'kanji-write':
      break;
  }
  return p;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pickers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** One Michikusa for today: `hash(seed, day)` over the un-collected pool of stations ≤ current + 1; a collected one (`isNew: false`) when exhausted. */
export function michikusaFor(ctx: PlanContext): { id: string; isNew: boolean } | null {
  const pool: string[] = [];
  for (const b of ctx.bundles) pool.push(...b.michikusaIds);
  if (ctx.nextBundle) pool.push(...ctx.nextBundle.michikusaIds);
  const uniq = Array.from(new Set(pool)).sort();
  if (uniq.length === 0) return null;
  const collected = new Set(store.collections.value.michikusa);
  const fresh = uniq.filter((id) => !collected.has(id));
  const h = hashSeed(ctx.seed, ctx.today, 'michikusa');
  if (fresh.length > 0) return { id: fresh[h % fresh.length] as string, isNew: true };
  return { id: uniq[h % uniq.length] as string, isNew: false };
}

export function michikusaStep(ctx: PlanContext): Step | null {
  const m = michikusaFor(ctx);
  if (!m) return null;
  return makeStep(ctx, { block: 'michikusa', exercise: MICHIKUSA_DRILL, itemId: m.id, cardKey: null, params: { michikusaId: m.id }, isNew: m.isNew, estMs: 10_000 });
}

/** Due cards for today in Kata order, `limit` at most, honoring backlog mode and the Kaiden lane. */
export function dueQueue(ctx: PlanContext, limit: number, exclude: ReadonlySet<CardKey> = new Set()): QueueCard[] {
  const all = dueCards({ cards: store.cards, today: ctx.today, limit: limit + exclude.size, backlog: ctx.backlog, kaidenQuota: kaidenQuota(ctx.cap) });
  return all.filter((c) => !exclude.has(c.cardKey)).slice(0, Math.max(0, limit));
}

/** Highest-R review-state cards (not due), for cooldowns when nothing due remains. */
export function easiestCards(ctx: PlanContext, n: number, exclude: ReadonlySet<CardKey>): QueueCard[] {
  const out: QueueCard[] = [];
  store.cards.forEach((k, t) => {
    if (exclude.has(k) || t[5] === 0 || hasFlag(t[7], CardFlag.archived)) return;
    const qc = queueCardFor(store.cards, k, ctx.today);
    if (qc) out.push(qc);
  });
  return out.sort((a, b) => b.r - a.r || (a.cardKey < b.cardKey ? -1 : 1)).slice(0, n);
}

/** Cards the learner most likely still knows (Welcome Back set: highest R, review state). */
export function welcomeSet(ctx: PlanContext, n: number): QueueCard[] {
  return easiestCards(ctx, n, new Set());
}

/** Scrolls for today (captured words, kana, components, vocab, kanji, grammar), limited to `max`. */
export function scrollsForToday(ctx: PlanContext, max: number): Scroll[] {
  if (!ctx.bundle || max <= 0) return [];
  const intro = introducedToday(ctx.today);
  const npd = ctx.settings.newPerDay;
  const kanaPerDay = ctx.belt === 'white' ? 20 : 0;
  const scrolls = nextScrolls({
    bundle: ctx.bundle,
    cards: store.cards,
    captured: store.captured.value,
    newPerDay: { vocab: Math.max(npd.vocab, 1), kanji: Math.max(npd.kanji, ctx.bundle.kanjiIds.length > 0 ? 1 : 0), grammar: Math.max(npd.grammar, ctx.bundle.grammarIds.length > 0 ? 1 : 0) },
    introducedToday: { vocab: intro.vocab, kanji: intro.kanji, grammar: intro.grammar },
    belt: beltOfStation(ctx.station),
    components: ctx.components,
    get: (id) => ctx.loader.get(id),
    today: ctx.today,
    kanaPerDay,
    introducedKanaToday: intro.kana,
    introducedComponentsToday: intro.component,
  });
  return scrolls.slice(0, max);
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
        const params = s.storyId !== undefined ? resolveParams(ctx, ex, null, { storyId: s.storyId, lineIndex: s.lineIndex }) : { sentence: s.sentence, answer: s.kana, accept: [s.sentence, s.kana], promptEn: s.en, rate: rateFor(ctx) };
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

/** Strand minutes trained this week, from the ledger (in-app rows: kind listen/watch → input, speak → output, read → input) and the daily rows (form). */
export function weekStrandMinutes(today: EpochDay): Record<Strand, number> {
  const from = today - 6;
  const out: Record<Strand, number> = { form: 0, input: 0, output: 0 };
  for (const e of store.ledger.value.entries) {
    if (e[0] < from || e[0] > today) continue;
    if (e[2] === 3) out.output += e[1];
    else out.input += e[1];
  }
  for (let d = from; d <= today; d++) {
    const row = store.daily.value[d];
    if (row) out.form += Math.max(0, row.minutes - row.input);
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
