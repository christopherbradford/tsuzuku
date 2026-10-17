/**
 * TSUZUKU — block templates and time budgets (design 03 §2, §5).
 *
 *  Kata    3 min   15–25 due reviews, one Michikusa between reps 8 and 9.
 *  Kumite  10–14   warm-up · 1–2 Scrolls · sparring (≥ 2 listen) · output
 *                  micro-block (shadow set / role-play turn) · cooldown.
 *  Shugyō  30–45   warm-up (3 shadowed sentences) · reviews to the cap ·
 *                  2–4 Scrolls · Input (5→12 by belt) · Output (3→7 by belt) ·
 *                  Weak Point set (0–3) · Michikusa · cooldown.
 *  Weak / Welcome Back / Kage / arcade / boss / exam / Dan shapes.
 *
 * Time fitting: reviews never below 60 % of due; Input and Output shrink last.
 * Minute estimates: per-step `estMs`, else the drill's median latency, else a
 * fixed cost (stories, listening sets, role-play, writing…).
 *
 * Pure: nothing here reads the store. The builder fills `stepIds`.
 */
import type { Belt, DrillId, ErrorTag, Facet } from '../content/types';
import type { SaveMeta } from '../shared/store-types';
import type { BlockKind, SessionMode, Step, StepParams } from '../shared/session-types';
import { S, SHINSA_LABEL } from './engine-strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type OutputKind = 'shadow' | 'role-play' | 'three-ways' | 'monologue' | 'writing';
export type InputKind = 'story' | 'listening';
export type Strand = 'form' | 'input' | 'output';

export interface BlockSpec {
  kind: BlockKind;
  /** Reps (reviews, sparring, cooldown, phase items, weak set, ghost set). */
  count?: number;
  /** Scrolls to teach (scroll block). */
  scrollCount?: number;
  minutes: number;
  /** Facet minimums inside the block (sparring: ≥ 2 listen when available). */
  facetMix?: Partial<Record<Facet, number>>;
  outputKind?: OutputKind;
  /** Additive: Input block content. */
  inputKind?: InputKind;
  /** Additive: floor used by `fitToTime` (reps, or scrolls for a scroll block). */
  minCount?: number;
  /** Additive: the Output block is replaced by the weekly Kage set (Mondays, design 03 §2.3). */
  replacement?: 'kage';
  /** Additive: Weak Point tag of a `weak` block. */
  tag?: ErrorTag;
  /** Additive: Gatekeeper phase / Shinsa section index (1-based). */
  phase?: number;
}

export interface PlannedBlock {
  kind: BlockKind;
  label: string;
  minutes: number;
  spec: BlockSpec;
  stepIds: string[];
}

export type TemplateBlock = Omit<PlannedBlock, 'stepIds'>;

export interface TemplateCtx {
  belt: Belt;
  station: number;
  backlog: boolean;
  /** Reviews the governor lets the session show today (`showDue`). */
  dueCount: number;
  weakTags: ErrorTag[];
  strandDeficit: Strand | null;
  /** Additive: a Kage Ghost Set is due this week (Mondays replace Output in a Shugyō). */
  kageDue?: boolean;
  /** Additive: new items still owed today (0 = budget met or paused). */
  newTarget?: number;
  /** Additive: rotation key (the day) for alternating Input / Output content. */
  day?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Target minutes per mode (the templates' sum before belt scaling). */
export const MODE_MINUTES: Record<SessionMode, number> = {
  kata: 3,
  kumite: 10,
  shugyo: 30,
  kage: 5,
  weak: 3,
  rapid: 1,
  gojuon: 2,
  gate: 14,
  shinsa: 25,
  scroll: 5,
  welcome: 4,
  dan: 10,
};

/** Design 02 §6.1: 8 s per rep; typed IME reps 9–12 s; multiple choice 4 s. */
export const DEFAULT_REP_MS = 8000;
export const MC_REP_MS = 4000;
export const TYPED_REP_MS = 10000;
export const MICHIKUSA_MS = 10000;
/** Kata: the Michikusa sits between reps 8 and 9 (0-based insert index 8). */
export const MICHIKUSA_AFTER_REP = 8;
export const KATA_MAX_REVIEWS = 25;
export const KATA_MIN_REVIEWS = 15;
export const KUMITE_WARMUP_REVIEWS = 20;
export const SPARRING_REPS = 15;
export const SPARRING_LISTEN_MIN = 2;
export const COOLDOWN_REPS = 3;
export const SHUGYO_WARMUP_SHADOWS = 3;
export const WEAK_SET_REPS = 20;
export const WELCOME_REPS = 20;
export const KAGE_REPS = 30;
export const REVIEW_FLOOR_SHARE = 0.6;

/**
 * A Michikusa card is reading, not a drill; its block kind (`michikusa`) is the
 * discriminator and the step never reaches `recordAttempt`. `Step.exercise`
 * must still be a `DrillId`, so the closest reading drill stands in.
 */
export const MICHIKUSA_DRILL: DrillId = 'story-read';

/** Fixed per-step costs for drills whose latency is not a rep (design 03 §3). */
export const FIXED_STEP_MS: Partial<Record<DrillId, number>> = {
  'story-read': 300_000,
  'speed-read': 120_000,
  'listening-set': 300_000,
  'role-play': 90_000,
  shadow: 20_000,
  'say-three-ways': 90_000,
  monologue: 90_000,
  'writing-dojo': 300_000,
  'rapid-fire': 60_000,
  'gojuon-fighter': 120_000,
  'field-mission': 60_000,
  'nemesis-duel': 15_000,
  'sentence-listen': 15_000,
  'form-chain': 30_000,
  'component-assembly': 12_000,
  'minimal-pair': 5_000,
};

/** Design 03 §2.3: Input minutes by belt. */
export function inputMinutesFor(belt: Belt): number {
  switch (belt) {
    case 'white':
    case 'yellow':
    case 'orange':
      return 5;
    case 'green':
      return 7;
    case 'blue':
    case 'purple':
      return 9;
    case 'brown':
    case 'black':
      return 12;
  }
}

/** Design 03 §2.3: Output minutes by belt. */
export function outputMinutesFor(belt: Belt): number {
  switch (belt) {
    case 'white':
    case 'yellow':
    case 'orange':
      return 3;
    case 'green':
      return 4;
    case 'blue':
    case 'purple':
      return 5;
    case 'brown':
    case 'black':
      return 7;
  }
}

/** Design 03 §5 weekly strand shares (Dan = `dan` key). */
export const STRAND_SHARES: Record<Belt | 'dan', Record<Strand, number>> = {
  white: { form: 0.6, input: 0.25, output: 0.15 },
  yellow: { form: 0.6, input: 0.25, output: 0.15 },
  orange: { form: 0.6, input: 0.25, output: 0.15 },
  green: { form: 0.5, input: 0.32, output: 0.18 },
  blue: { form: 0.4, input: 0.38, output: 0.22 },
  purple: { form: 0.4, input: 0.38, output: 0.22 },
  brown: { form: 0.3, input: 0.45, output: 0.25 },
  black: { form: 0.25, input: 0.45, output: 0.3 },
  dan: { form: 0.15, input: 0.5, output: 0.35 },
};

/**
 * The strand most below its weekly target share, or `null` when every strand
 * is within 2 points (or nothing has been trained yet).
 */
export function strandDeficitFor(minutes: Record<Strand, number>, belt: Belt, dan = 0): Strand | null {
  const total = minutes.form + minutes.input + minutes.output;
  if (total <= 0) return null;
  const target = STRAND_SHARES[dan > 0 ? 'dan' : belt];
  let worst: Strand | null = null;
  let gap = 0.02;
  for (const s of ['form', 'input', 'output'] as const) {
    const g = target[s] - minutes[s] / total;
    if (g > gap) {
      gap = g;
      worst = s;
    }
  }
  return worst;
}

/** Output kinds drillable at a station (design 04 §13), in rotation order. */
export function outputKindsFor(station: number): OutputKind[] {
  const out: OutputKind[] = ['shadow'];
  if (station >= 7) out.push('role-play');
  if (station >= 16) out.push('writing');
  if (station >= 27) out.push('three-ways');
  if (station >= 29) out.push('monologue');
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Templates                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function block(kind: BlockKind, label: string, minutes: number, spec: Omit<BlockSpec, 'kind' | 'minutes'> = {}): TemplateBlock {
  return { kind, label, minutes, spec: { kind, minutes, ...spec } };
}

function repMinutes(count: number, ms = DEFAULT_REP_MS): number {
  return Math.round(((count * ms) / 60_000) * 100) / 100;
}

export function templateFor(mode: SessionMode, ctx: TemplateCtx): TemplateBlock[] {
  const rotation = Math.abs(Math.floor(ctx.day ?? ctx.station));
  switch (mode) {
    case 'kata': {
      const count = Math.min(KATA_MAX_REVIEWS, Math.max(0, ctx.dueCount));
      return [
        block('reviews', S.blockReviews, Math.max(1, Math.min(3, repMinutes(count))), { count, minCount: Math.min(count, KATA_MIN_REVIEWS) }),
        block('michikusa', S.blockMichikusa, MICHIKUSA_MS / 60_000, { count: 1 }),
      ];
    }
    case 'kumite': {
      const warm = Math.min(KUMITE_WARMUP_REVIEWS, Math.max(0, ctx.dueCount));
      const scrolls = ctx.backlog ? 0 : (ctx.newTarget ?? 1) > 0 ? 2 : 1;
      const out: TemplateBlock[] = [block('warmup', S.blockWarmup, 3, { count: warm, minCount: Math.min(warm, 3) })];
      if (scrolls > 0) out.push(block('scroll', S.blockScroll, scrolls === 2 ? 7 : 3.5, { scrollCount: scrolls, minCount: 1 }));
      out.push(block('sparring', S.blockSparring, 3, { count: SPARRING_REPS, minCount: 5, facetMix: { listen: SPARRING_LISTEN_MIN } }));
      out.push(block('michikusa', S.blockMichikusa, MICHIKUSA_MS / 60_000, { count: 1 }));
      const outputKind: OutputKind = ctx.station >= 7 && (ctx.strandDeficit === 'output' || rotation % 2 === 1) ? 'role-play' : 'shadow';
      out.push(block('output', S.blockOutput, 1.5, { outputKind, count: outputKind === 'shadow' ? 3 : 1 }));
      out.push(block('cooldown', S.blockCooldown, 0.5, { count: COOLDOWN_REPS, minCount: 2 }));
      return out;
    }
    case 'shugyo': {
      const reviews = Math.max(0, ctx.dueCount);
      let input = inputMinutesFor(ctx.belt);
      let output = outputMinutesFor(ctx.belt);
      if (ctx.strandDeficit === 'input') {
        input += 2;
        output = Math.max(2, output - 1);
      } else if (ctx.strandDeficit === 'output') {
        output += 2;
        input = Math.max(3, input - 2);
      }
      const out: TemplateBlock[] = [block('warmup', S.blockWarmup, 1.5, { count: SHUGYO_WARMUP_SHADOWS, outputKind: 'shadow', minCount: 3 })];
      out.push(block('reviews', S.blockReviews, Math.max(8, Math.min(12, repMinutes(reviews))), { count: reviews, minCount: Math.ceil(REVIEW_FLOOR_SHARE * reviews) }));
      if (!ctx.backlog) {
        const scrolls = (ctx.newTarget ?? 2) >= 3 ? 4 : (ctx.newTarget ?? 2) >= 1 ? 3 : 2;
        out.push(block('scroll', S.blockScroll, 8 + (scrolls - 2) * 3, { scrollCount: scrolls, minCount: 2 }));
      }
      const inputKind: InputKind = rotation % 2 === 1 ? 'listening' : 'story';
      out.push(block('input', S.blockInput, input, { inputKind, count: 1, minCount: 1 }));
      if (ctx.kageDue) {
        out.push(block('output', S.blockKage, 5, { replacement: 'kage', count: KAGE_REPS, minCount: KAGE_REPS }));
      } else {
        const kinds = outputKindsFor(ctx.station);
        const outputKind = kinds[rotation % kinds.length] as OutputKind;
        out.push(block('output', S.blockOutput, output, { outputKind, count: outputKind === 'shadow' ? 5 : 1, minCount: 1 }));
      }
      const tag = ctx.weakTags[0];
      if (tag) out.push(block('weak', S.blockWeak, 3, { count: WEAK_SET_REPS, minCount: 10, tag }));
      out.push(block('michikusa', S.blockMichikusa, MICHIKUSA_MS / 60_000, { count: 1 }));
      out.push(block('cooldown', S.blockCooldown, 1, { count: COOLDOWN_REPS, minCount: 2 }));
      return out;
    }
    case 'weak': {
      const tag = ctx.weakTags[0];
      return [block('weak', S.blockWeak, 3, { count: WEAK_SET_REPS, minCount: 10, ...(tag ? { tag } : {}) })];
    }
    case 'welcome':
      return [block('reviews', S.blockWelcome, 3, { count: WELCOME_REPS, minCount: WELCOME_REPS }), block('michikusa', S.blockMichikusa, MICHIKUSA_MS / 60_000, { count: 1 })];
    case 'kage':
      return [block('reviews', S.blockKage, 5, { count: KAGE_REPS, minCount: KAGE_REPS })];
    case 'rapid':
      return [block('sparring', S.blockRapid, 1, { count: 1, minCount: 1 })];
    case 'gojuon':
      return [block('sparring', S.blockGojuon, 2, { count: 1, minCount: 1 })];
    case 'scroll':
      return [block('scroll', S.blockScroll, 5, { scrollCount: 1, minCount: 1 })];
    case 'gate':
      return [
        block('phase', S.phaseFlash, 2, { count: 20, phase: 1, minCount: 20 }),
        block('phase', S.phaseStrike, 4, { count: 20, phase: 2, minCount: 20 }),
        block('phase', S.phaseEar, 4, { count: 12, phase: 3, minCount: 12 }),
        block('phase', S.phaseFinalForm, 4, { count: 3, phase: 4, minCount: 3 }),
      ];
    case 'shinsa':
      return [
        block('phase', SHINSA_LABEL.ear, 4, { count: 10, phase: 1, minCount: 10 }),
        block('phase', SHINSA_LABEL.read, 6, { count: 2, phase: 2, minCount: 2 }),
        block('phase', SHINSA_LABEL.form, 8, { count: 30, phase: 3, minCount: 30 }),
        block('phase', SHINSA_LABEL.mouth, 4, { count: 6, phase: 4, minCount: 6 }),
        block('phase', SHINSA_LABEL.write, 3, { count: 1, phase: 5, minCount: 1 }),
      ];
    case 'dan':
      return [
        block('input', S.blockInput, 4, { inputKind: 'story', count: 1, minCount: 1 }),
        block('reviews', S.blockReviews, 2, { count: 12, minCount: 12 }),
        block('output', S.blockOutput, 4, { outputKind: 'three-ways', count: 1, minCount: 1 }),
      ];
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Time fitting                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Shrink order: the review-shaped blocks first, Scrolls, Weak Point, then Input and Output last. */
const SHRINK_ORDER: readonly BlockKind[] = ['cooldown', 'warmup', 'sparring', 'reviews', 'scroll', 'weak', 'input', 'output'];

function totalMinutes(blocks: readonly { minutes: number }[]): number {
  return blocks.reduce((a, b) => a + b.minutes, 0);
}

/**
 * Fits the blocks into `minutes`. Rep blocks lose one rep at a time (never
 * below `spec.minCount`; reviews never below 60 % of `o.due`), Scroll blocks
 * lose a Scroll at a time (≥ 1), Input and Output lose half a minute at a time
 * and only after everything else is at its floor. Never grows anything.
 */
export function fitToTime<B extends TemplateBlock>(blocks: B[], minutes: number, o: { due?: number } = {}): B[] {
  const out = blocks.map((b) => ({ ...b, spec: { ...b.spec } }));
  const perUnit = new Map<number, number>();
  out.forEach((b, i) => {
    const units = b.spec.scrollCount ?? b.spec.count ?? 0;
    perUnit.set(i, units > 0 ? b.minutes / units : 0);
  });
  const floorOf = (b: TemplateBlock): number => {
    if (b.kind === 'reviews') {
      const due = o.due ?? b.spec.count ?? 0;
      return Math.max(b.spec.minCount ?? 0, Math.ceil(REVIEW_FLOOR_SHARE * Math.min(due, b.spec.count ?? due)));
    }
    if (b.kind === 'scroll') return Math.max(1, b.spec.minCount ?? 1);
    return b.spec.minCount ?? 0;
  };
  let guard = 10_000;
  while (totalMinutes(out) > minutes + 1e-9 && guard-- > 0) {
    let shrunk = false;
    for (const kind of SHRINK_ORDER) {
      for (let i = 0; i < out.length; i++) {
        const b = out[i] as B;
        if (b.kind !== kind) continue;
        if (kind === 'input' || kind === 'output') {
          const floor = kind === 'input' ? 2 : 1;
          if (b.minutes - 0.5 >= floor - 1e-9) {
            b.minutes = Math.round((b.minutes - 0.5) * 100) / 100;
            shrunk = true;
          }
        } else if (kind === 'scroll') {
          const n = b.spec.scrollCount ?? 1;
          if (n > floorOf(b)) {
            b.spec.scrollCount = n - 1;
            b.minutes = Math.round((b.minutes - (perUnit.get(i) ?? 0)) * 100) / 100;
            shrunk = true;
          }
        } else {
          const n = b.spec.count ?? 0;
          if (n > floorOf(b)) {
            b.spec.count = n - 1;
            b.minutes = Math.max(0, Math.round((b.minutes - (perUnit.get(i) ?? 0)) * 100) / 100);
            shrunk = true;
          }
        }
        if (shrunk) break;
      }
      if (shrunk) break;
    }
    if (!shrunk) break;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Estimates                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Estimated milliseconds for one step of `exercise` with `params` (median latency, else fixed cost, else rep defaults). */
export function estimateStepMs(exercise: DrillId, params: StepParams, medianMs: SaveMeta['medianMs']): number {
  const fixed = FIXED_STEP_MS[exercise];
  if (fixed !== undefined) {
    if (exercise === 'monologue' && params.seconds) return params.seconds * 1000 + 15_000;
    if (exercise === 'rapid-fire' && params.seconds) return params.seconds * 1000;
    return fixed;
  }
  const median = medianMs[exercise];
  if (median !== undefined && median > 0) return Math.round(median);
  if (params.choices && params.choices.length > 0) return MC_REP_MS;
  if (params.tiles && params.tiles.length > 0) return MC_REP_MS + 2000;
  if (params.answer !== undefined || params.accept !== undefined) return TYPED_REP_MS;
  return DEFAULT_REP_MS;
}

/** Sum of the steps' `estMs` (a step with `estMs` 0 is estimated from its drill). */
export function estimateMs(steps: readonly Step[], medianMs: SaveMeta['medianMs']): number {
  let total = 0;
  for (const s of steps) {
    if (s.block === 'michikusa') {
      total += MICHIKUSA_MS;
      continue;
    }
    total += s.estMs > 0 ? s.estMs : estimateStepMs(s.exercise, s.params, medianMs);
  }
  return total;
}

/** Minutes, one decimal. */
export function msToMinutes(ms: number): number {
  return Math.round(ms / 6000) / 10;
}
