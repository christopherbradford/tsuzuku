/**
 * snapshot.ts — a saved snapshot is data: only well-formed card keys are resumable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import { V } from '../content/fixtures';
import { SESSION_SCHEMA, type SessionPlan, type SessionSnapshot, type Step } from '../shared/session-types';
import { epochDay } from '../shared/time';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, makeTestStore } from '../store/testing';
import { kiaiInit } from '../learn';
import { isResumableSnapshot, loadSnapshot } from './snapshot';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const good = `${V.犬}#rec` as CardKey;
const bad = 'v-n5-0001' as CardKey; // no facet

function step(id: string, cardKey: CardKey | null, params: Step['params'] = { answer: 'x', accept: ['x'] }): Step {
  return { id, block: 'reviews', exercise: 'meaning-recall', itemId: cardKey ? cardKey.split('#')[0]! : null, cardKey, params, timed: false, isNew: false, stepTag: null, exposures: 6, estMs: 6000 };
}
function plan(steps: Step[]): SessionPlan {
  return { id: 'kata-test', mode: 'kata', day: TODAY, createdAt: DEFAULT_TEST_NOW, station: 4, steps, blocks: [{ kind: 'reviews', label: 'Reviews', estMinutes: 1, stepIds: steps.map((s) => s.id) }], meta: { dueTotal: steps.length, dueTaken: steps.length, backlog: false, newCount: 0, scrollIds: [] } };
}
function snap(steps: Step[], extra: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { schema: SESSION_SCHEMA, plan: plan(steps), cursor: 0, results: [], kiai: kiaiInit(), ...extra };
}

afterEach(() => resetStoreForTests());

describe('isResumableSnapshot', () => {
  it('accepts a runner-written snapshot: null or well-formed step keys, pools and a Recovery queue of card keys', () => {
    expect(isResumableSnapshot(snap([step('a', good), step('b', null, { pool: [good] })]))).toBe(true);
    expect(isResumableSnapshot(snap([step('a', good)], { kiai: { ...kiaiInit(), recoveryQueue: [{ cardKey: good, at: 3 }] } }))).toBe(true);
    expect(isResumableSnapshot(snap([]))).toBe(true);
  });

  it('refuses a step, pool, result or Recovery entry whose key is not a card key, and a wrong schema or shape', () => {
    expect(isResumableSnapshot(snap([step('a', bad)]))).toBe(false);
    expect(isResumableSnapshot(snap([step('a', 'x#nope' as CardKey)]))).toBe(false);
    expect(isResumableSnapshot(snap([step('a', undefined as unknown as null)]))).toBe(false);
    expect(isResumableSnapshot(snap([step('a', null, { pool: [good, bad] })]))).toBe(false);
    expect(isResumableSnapshot(snap([step('a', good)], { kiai: { ...kiaiInit(), recoveryQueue: [{ cardKey: bad, at: 1 }] } }))).toBe(false);
    expect(isResumableSnapshot(snap([step('a', good)], { results: [{ stepId: 'a', cardKey: bad } as never] }))).toBe(false);
    expect(isResumableSnapshot({ ...snap([step('a', good)]), schema: 'tsuzuku.session/0' as never })).toBe(false);
    expect(isResumableSnapshot({ ...snap([]), plan: { id: 'x' } as never })).toBe(false);
    expect(isResumableSnapshot({ ...snap([]), cursor: Number.NaN })).toBe(false);
    expect(isResumableSnapshot(null)).toBe(false);
    expect(isResumableSnapshot(undefined)).toBe(false);
  });
});

describe('loadSnapshot', () => {
  it('returns the saved session only when it is resumable', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    expect(loadSnapshot()).toBeNull();
    const ok = snap([step('a', good)]);
    store.session.save(ok);
    expect(loadSnapshot()).toEqual(ok);
    store.session.save(snap([step('a', bad)]));
    expect(loadSnapshot()).toBeNull();
    // not cleared here: the next run's save replaces it, and reading never writes
    expect(store.session.load()).not.toBeNull();
  });
});
