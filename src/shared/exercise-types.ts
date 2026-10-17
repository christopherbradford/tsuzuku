/**
 * TSUZUKU — exercise contracts and registry (ARCHITECTURE §4).
 *
 * D and F register components; E resolves and renders them inside
 * `<ExerciseFrame>`. Only the 35 `DRILL_IDS` are ever registered.
 */
import type { ComponentChildren, FunctionComponent } from 'preact';
import { DRILL_IDS, type ContentItem, type DrillId, type ErrorTag, type ExerciseId, type Facet } from '../content/types';
import type { ItemBelt, Rating, Settings } from './store-types';
import type { AttemptResult, Step, StepParams } from './session-types';

export type { AttemptResult } from './session-types';

/** Judge Card requests (design 05 §6). */
export type JudgeRequest =
  | { correct: string; distractors: [string, string, string] } // 4-option meaning Judge
  | { rubric: string; regex: string } // rubric Judge (Final Form, writing)
  | { minimalPair: [string, string] }; // perception Judge (shadow fallback)

export interface ExerciseProps<P extends StepParams = StepParams> {
  step: Step & { params: P };
  item: ContentItem | null;
  feel: Settings['feel'];
  furigana: Settings['furigana'];
  /** J-J reveal (Station 34+ or setting). */
  jj: boolean;
  speedTier: 1 | 2 | 3 | 4 | 5;
  exposures: number;
  onResult(r: AttemptResult): void;
  onHint(): void;
  onReplay(): void;
  requestJudge(o: JudgeRequest): Promise<boolean>;
}

export type FeedbackKind = 'correct' | 'near' | 'wrong' | 'guard' | 'timeout' | 'info';

/** What `<Feedback>` renders after a rep (design 04 §0 "Feedback"). */
export interface FeedbackState {
  kind: FeedbackKind;
  /** The correct form (plain surface). */
  correct?: string;
  /** What the learner gave. */
  given?: string;
  /** `jp.diffChars` output: 0 same · 1 extra/wrong in given · 2 missing. */
  diff?: [string, 0 | 1 | 2][];
  errorTags: ErrorTag[];
  /** One line of why, or a confusable contrast. */
  why?: string;
  /** Sensei line ("Again. That's the training."). */
  line?: string;
  rating: Rating | null;
  ippon: boolean;
  kiai: boolean;
  promotion?: ItemBelt;
  xpDelta: number;
  /** Combo half-restored after a Recovery. */
  recovery?: boolean;
  judge?: 'pass' | 'fail';
}

export interface ExerciseFrameProps {
  step: Step;
  index: number;
  total: number;
  ki: number;
  combo: number;
  comboTier: 0 | 1 | 2 | 3;
  timer: { ms: number; startedAt: number } | null;
  feel: Settings['feel'];
  feedback: FeedbackState | null;
  onGuard(): void;
  /**
   * Legacy, no longer called by the frame: hints are the drill's own
   * (`ExerciseProps.onHint` counts them in the host); the frame's `?` key and
   * Hint button reach the drill through `useExerciseKeys({ onHint })`.
   */
  onHint?(): void;
  onPause(): void;
  onContinue(): void;
  /** Space replay, forwarded to the exercise's `onReplay` by the runner. */
  onReplay?(): void;
  /** Keys 1–9, forwarded to a choices exercise by the runner. */
  onChoice?(index: number): void;
  children: ComponentChildren;
}

export interface ExerciseMeta {
  id: DrillId;
  facet: Facet | null;
  needsTts: boolean;
  needsStt: boolean;
  selfGraded: boolean;
  timeable: boolean;
  /** Which keys the frame forwards: numeric choices, free text, kana IME, none. */
  keys: 'choices' | 'text' | 'kana' | 'none';
}

export type ExerciseComponent = FunctionComponent<ExerciseProps>;
export interface RegisteredExercise {
  meta: ExerciseMeta;
  Component: ExerciseComponent;
}

const registry = new Map<DrillId, RegisteredExercise>();
const DRILL_SET: ReadonlySet<string> = new Set(DRILL_IDS);

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/** Registers a drill. Throws on an unknown id; a duplicate throws in dev and overwrites in prod. */
export function registerExercise(meta: ExerciseMeta, c: FunctionComponent<ExerciseProps>): void {
  if (!DRILL_SET.has(meta.id)) throw new RangeError(`registerExercise: "${meta.id}" is not a DrillId`);
  if (registry.has(meta.id)) {
    if (isDev()) throw new Error(`registerExercise: "${meta.id}" registered twice`);
    console.warn(`registerExercise: "${meta.id}" re-registered`);
  }
  registry.set(meta.id, { meta, Component: c });
}

/** Resolves a drill; runner ids and unregistered drills return `undefined` (the builder skips them). */
export function resolveExercise(id: ExerciseId): RegisteredExercise | undefined {
  return registry.get(id as DrillId);
}

export function isRegistered(id: ExerciseId): boolean {
  return registry.has(id as DrillId);
}

/** Registered metas in `DRILL_IDS` order. */
export function listExercises(): ExerciseMeta[] {
  const out: ExerciseMeta[] = [];
  for (const id of DRILL_IDS) {
    const e = registry.get(id);
    if (e) out.push(e.meta);
  }
  return out;
}

export function resetRegistryForTests(): void {
  registry.clear();
}
