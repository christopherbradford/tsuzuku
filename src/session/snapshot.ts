/**
 * TSUZUKU — the saved session snapshot as data (ARCHITECTURE §5 `SessionSnapshot`).
 *
 * `store.session` is opaque to the store, so nothing validates it before it is
 * offered as "Resume" or scheduled; the card keys in a snapshot come from a
 * save, and a hand-edited or older-build snapshot must never reach
 * `recordAttempt` (which parses the key) or the Nemesis / Rapid Fire pools.
 * `isResumableSnapshot` is the guard — current schema, a plan whose steps carry
 * `null` or `isCardKey` keys (`params.pool` likewise), results and a kiai
 * Recovery queue on well-formed keys — and `loadSnapshot()` is the one reader
 * TrainPage, the Dojo feed and `SessionRunner.resume` use. A snapshot that
 * fails is not resumed; the next session's save replaces it.
 */
import type { CardKey } from '../content/types';
import { isCardKey } from '../shared/ids';
import { SESSION_SCHEMA, type KiaiState, type SessionPlan, type SessionSnapshot, type Step, type StepResult } from '../shared/session-types';
import { store } from '../store';

function keyOk(k: unknown): k is CardKey {
  return typeof k === 'string' && isCardKey(k);
}

function stepOk(s: Partial<Step> | null | undefined): boolean {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string') return false;
  if (s.cardKey !== null && !keyOk(s.cardKey)) return false;
  const pool = s.params?.pool;
  return pool === undefined || (Array.isArray(pool) && pool.every(keyOk));
}

function resultOk(r: Partial<StepResult> | null | undefined): boolean {
  return !!r && typeof r === 'object' && (r.cardKey === null || keyOk(r.cardKey));
}

/** A snapshot the runner can resume (see the module header). */
export function isResumableSnapshot(snap: SessionSnapshot | null | undefined): snap is SessionSnapshot {
  if (!snap || typeof snap !== 'object' || snap.schema !== SESSION_SCHEMA) return false;
  const plan = snap.plan as Partial<SessionPlan> | undefined;
  if (!plan || typeof plan !== 'object' || typeof plan.id !== 'string' || !Array.isArray(plan.steps) || !Array.isArray(plan.blocks)) return false;
  if (!Number.isFinite(snap.cursor) || !Array.isArray(snap.results)) return false;
  const kiai = snap.kiai as Partial<KiaiState> | undefined;
  if (!kiai || typeof kiai !== 'object' || !Array.isArray(kiai.recoveryQueue) || !kiai.recoveryQueue.every((q) => !!q && keyOk(q.cardKey))) return false;
  return plan.steps.every(stepOk) && snap.results.every(resultOk);
}

/** The saved session when it can be resumed, else `null`. */
export function loadSnapshot(): SessionSnapshot | null {
  const snap = store.session.load();
  return isResumableSnapshot(snap) ? snap : null;
}
