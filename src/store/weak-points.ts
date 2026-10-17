/**
 * TSUZUKU — Weak Points 弱点 (design 05 §7).
 *
 * Each error tag holds an EWMA error rate (α = 0.2). A tagged attempt pushes
 * it toward 1; an untagged CORRECT attempt on an exercise that could have
 * raised the tag pushes it toward 0 (counts as 0). Untagged misses, Guards and
 * arcade reps say nothing about a tag and are ignored.
 *
 *  active   ewma > 20 % with n ≥ 15 tagged-eligible attempts (three early
 *           misses from zero never fire a set)
 *  cleared  active and ewma < 8 % → `weak-point:cleared` (hysteresis)
 *  peak     highest ewma seen above the activation line; 弱点克服 reads
 *           `peak > 0.2 && ewma < 0.05`.
 *
 * `topWeakPoints` is the Weak Point set's pick order (most severe first).
 */
import { ERROR_TAGS, type ErrorTag, type ExerciseId } from '../content/types';
import { bus, type Events } from '../shared/events';
import type { Store, WeakPoint, WeakPoints } from '../shared/store-types';

export const EWMA_ALPHA = 0.2;
export const WEAK_ACTIVATE = 0.2;
export const WEAK_CLEAR = 0.08;
export const WEAK_MIN_N = 15;
/** 弱点克服: a tag that peaked above 20 % and now sits below 5 %. */
export const WEAK_CONQUERED = 0.05;

/** Exercises that can raise each tag (design 04 per-exercise tag notes). */
export const TAG_EXERCISES: Record<ErrorTag, ExerciseId[]> = {
  particle: ['particle-duel', 'production-forge', 'pattern-cloze', 'transform', 'scramble', 'sentence-listen', 'writing-dojo', 'role-play', 'say-three-ways'],
  conjugation: ['form-forge', 'form-chain', 'transform', 'pattern-cloze', 'production-forge', 'say-three-ways', 'writing-dojo'],
  'vowel-length': ['kana-flash', 'kana-ear', 'kana-forge', 'production-forge', 'sentence-listen', 'minimal-pair', 'audio-flash', 'shadow'],
  voicing: ['kana-flash', 'kana-ear', 'kana-forge', 'production-forge', 'sentence-listen', 'minimal-pair', 'audio-flash', 'shadow'],
  'small-kana': ['kana-flash', 'kana-ear', 'kana-forge', 'production-forge', 'sentence-listen'],
  'kanji-reading': ['kanji-read', 'lookalike-duel', 'kanji-write', 'production-forge'],
  'kanji-meaning': ['component-flash', 'component-assembly', 'kanji-write', 'meaning-guard', 'meaning-recall', 'meaning-judge'],
  'word-choice': ['meaning-guard', 'meaning-recall', 'meaning-judge', 'audio-flash', 'production-forge', 'transform', 'writing-dojo'],
  register: ['transform', 'say-three-ways', 'role-play', 'writing-dojo'],
  'word-order': ['scramble', 'transform', 'writing-dojo'],
  pitch: ['pitch-ear', 'shadow'],
  transcription: ['sentence-listen', 'kana-forge', 'production-forge'],
  aizuchi: ['role-play'],
  listening: ['sentence-listen', 'audio-flash', 'listening-set', 'kana-ear', 'minimal-pair', 'shadow'],
};

const ELIGIBLE: Map<ExerciseId, ErrorTag[]> = (() => {
  const m = new Map<ExerciseId, ErrorTag[]>();
  for (const tag of ERROR_TAGS) {
    for (const ex of TAG_EXERCISES[tag]) {
      const list = m.get(ex);
      if (list) list.push(tag);
      else m.set(ex, [tag]);
    }
  }
  return m;
})();

/** Tags an exercise can raise (empty for arcade and untagged exercises). */
export function tagsForExercise(ex: ExerciseId): readonly ErrorTag[] {
  return ELIGIBLE.get(ex) ?? [];
}

export function freshWeakPoint(): WeakPoint {
  return { n: 0, ewma: 0, active: false, peak: 0 };
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/** One EWMA step for a tag: `hit` = the attempt carried the tag. */
export function stepWeakPoint(w: WeakPoint, hit: boolean): WeakPoint {
  const ewma = round4(w.ewma + EWMA_ALPHA * ((hit ? 1 : 0) - w.ewma));
  const n = w.n + 1;
  let active = w.active;
  if (!active && ewma > WEAK_ACTIVATE && n >= WEAK_MIN_N) active = true;
  else if (active && ewma < WEAK_CLEAR) active = false;
  const peak = ewma > WEAK_ACTIVATE ? Math.max(w.peak, ewma) : w.peak;
  return { n, ewma, active, peak };
}

/** Apply one graded attempt. Returns the same object when no tag is touched. */
export function updateWeakPoints(w: WeakPoints, ev: Pick<Events['attempt:graded'], 'exercise' | 'correct' | 'guard' | 'errorTags'>): WeakPoints {
  const eligible = tagsForExercise(ev.exercise);
  const tagged = new Set<ErrorTag>(ev.errorTags.filter((t): t is ErrorTag => (ERROR_TAGS as readonly string[]).includes(t)));
  if (tagged.size === 0 && (eligible.length === 0 || !ev.correct || ev.guard)) return w;
  let out: WeakPoints | null = null;
  const touch = (tag: ErrorTag, hit: boolean): void => {
    const prev = w[tag] ?? freshWeakPoint();
    const next = stepWeakPoint(prev, hit);
    if (!out) out = { ...w };
    out[tag] = next;
  };
  for (const tag of tagged) touch(tag, true);
  if (ev.correct && !ev.guard) for (const tag of eligible) if (!tagged.has(tag)) touch(tag, false);
  return out ?? w;
}

/** Active tags, most severe first. */
export function activeTags(w: WeakPoints): ErrorTag[] {
  return ERROR_TAGS.filter((t) => w[t]?.active).sort((a, b) => (w[b]?.ewma ?? 0) - (w[a]?.ewma ?? 0));
}

export interface WeakPointRow extends WeakPoint {
  tag: ErrorTag;
}

/** Top-N tags for the Weak Point set: active ones first by ewma, then the rest by ewma (n ≥ 15 only). */
export function topWeakPoints(w: WeakPoints, n = 3, o: { includeInactive?: boolean } = {}): WeakPointRow[] {
  const rows: WeakPointRow[] = [];
  for (const tag of ERROR_TAGS) {
    const p = w[tag];
    if (!p) continue;
    if (p.active || (o.includeInactive && p.n >= WEAK_MIN_N && p.ewma > 0)) rows.push({ tag, ...p });
  }
  rows.sort((a, b) => Number(b.active) - Number(a.active) || b.ewma - a.ewma || b.n - a.n);
  return rows.slice(0, Math.max(0, n));
}

/** Tags that went from > 20 % to < 5 % (badge 弱点克服). */
export function conqueredTags(w: WeakPoints): ErrorTag[] {
  return ERROR_TAGS.filter((t) => {
    const p = w[t];
    return !!p && p.peak > WEAK_ACTIVATE && p.ewma < WEAK_CONQUERED && !p.active;
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducer                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export function startWeakPoints(store: Store): () => void {
  const off = bus.on('attempt:graded', (p) => {
    const before = store.weakPoints.value;
    const after = updateWeakPoints(before, p);
    if (after === before) return;
    store.patch('weakPoints', () => after);
    for (const tag of ERROR_TAGS) {
      if (before[tag]?.active && !after[tag]?.active) bus.emit('weak-point:cleared', { tag });
    }
  });
  return off;
}
