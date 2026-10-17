/**
 * runner.ts — the rep loop over the real writer (`@/learn/apply`) and a test store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey } from '../content/types';
import { FIXTURE_IDS, V, G, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import type { AttemptResult, SessionPlan, Step } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import { KIAI_RULES } from '../learn';
import { SessionRunner, correctFormOf, type RunnerSnapshot } from './runner';
import { toPlain } from '../content/ruby';
import { checkStepId, pretestStepId, resetScrollCompletions } from './scroll';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

function live(s: number, extra: Partial<{ reps: number; lapses: number; d: number }> = {}): CardTuple {
  return card({ due: TODAY, s, d: extra.d ?? 5, reps: extra.reps ?? 6, lapses: extra.lapses ?? 0, state: 2, last: TODAY - 1 });
}

function step(o: Partial<Step> & { cardKey: CardKey | null; id: string }): Step {
  const itemId = o.itemId ?? (o.cardKey ? o.cardKey.split('#')[0]! : null);
  return {
    block: 'reviews',
    exercise: 'meaning-recall',
    itemId,
    params: { answer: 'x', accept: ['x'] },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 6,
    estMs: 6000,
    ...o,
  };
}

function plan(steps: Step[], mode: SessionPlan['mode'] = 'kata', extra: Partial<SessionPlan['meta']> = {}): SessionPlan {
  return {
    id: `${mode}-test`,
    mode,
    day: TODAY,
    createdAt: DEFAULT_TEST_NOW,
    station: 4,
    steps,
    blocks: [{ kind: steps[0]?.block ?? 'reviews', label: 'Reviews', estMinutes: 1, stepIds: steps.map((s) => s.id) }],
    meta: { dueTotal: steps.length, dueTaken: steps.length, backlog: false, newCount: 0, scrollIds: [], ...extra },
  };
}

function ok(o: Partial<AttemptResult> = {}): AttemptResult {
  return { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2500, errorTags: [], ...o };
}
const miss = (o: Partial<AttemptResult> = {}): AttemptResult => ok({ correct: false, answer: 'nope', ...o });

/** Cards for the station-4 vocab (rec) plus one mature card. */
function vocabCards(s = 5): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of FIXTURE_IDS.vocab) if (id !== V.おはよう && id !== V.はい) out[`${id}#rec`] = live(s);
  return out;
}

const vocabSteps = (n: number): Step[] =>
  FIXTURE_IDS.vocab
    .filter((id) => id !== V.おはよう && id !== V.はい)
    .slice(0, n)
    .map((id, i) => step({ id: `s${i}`, cardKey: `${id}#rec` }));

afterEach(() => {
  resetStoreForTests();
  bus.reset();
  resetScrollCompletions();
});

describe('SessionRunner — rep loop', () => {
  it('emits session:started, a Good advances and emits attempt:graded, feedback is correct', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const cap = captureEvents();
    const r = new SessionRunner(plan(vocabSteps(3)), { loader });
    expect(cap.events.filter((e) => e[0] === 'session:started')).toHaveLength(1);
    expect(r.step.value?.id).toBe('s0');
    expect(r.index.value).toBe(0);
    expect(r.total.value).toBe(3);
    r.submit(ok({ answer: 'x' }));
    const graded = cap.events.filter((e) => e[0] === 'attempt:graded');
    expect(graded).toHaveLength(1);
    expect((graded[0]![1] as { rating: number }).rating).toBe(3);
    expect(r.feedback.value?.kind).toBe('correct');
    expect(r.feedback.value?.rating).toBe(3);
    expect(r.feedback.value?.correct).toBe('x');
    expect(r.results).toHaveLength(1);
    expect(r.kiai.value.combo).toBe(1);
    expect(r.kiai.value.ki).toBe(KIAI_RULES.ki.correct);
    expect(r.step.value?.id).toBe('s0');
    r.next();
    expect(r.step.value?.id).toBe('s1');
    expect(r.feedback.value).toBeNull();
    cap.stop();
  });

  it('a second submit before next() is ignored and next() before an answer is a no-op', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const r = new SessionRunner(plan(vocabSteps(2)), { loader });
    r.next();
    expect(r.index.value).toBe(0);
    r.submit(ok());
    r.submit(ok());
    expect(r.results).toHaveLength(1);
  });

  it('a miss on a mature card breaks the combo, re-queues a Recovery 3–8 reps later and restores half the combo', async () => {
    const cards = vocabCards(20);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    const steps = vocabSteps(10);
    const r = new SessionRunner(plan(steps), { loader });
    for (let i = 0; i < 6; i++) {
      r.submit(ok());
      r.next();
    }
    expect(r.kiai.value.combo).toBe(6);
    const missed = r.step.value!;
    r.submit(miss());
    expect(r.kiai.value.combo).toBe(0);
    expect(r.feedback.value?.kind).toBe('wrong');
    expect(r.feedback.value?.diff).toBeDefined();
    const queue = r.steps();
    const recovery = queue.findIndex((s) => s.stepTag === 'recovery' && s.cardKey === missed.cardKey);
    expect(recovery).toBeGreaterThanOrEqual(6 + KIAI_RULES.recovery.min);
    expect(recovery).toBeLessThanOrEqual(6 + KIAI_RULES.recovery.max);
    expect(r.total.value).toBe(queue.length);
    r.next();
    let seen = 0;
    while (r.step.value && r.step.value.stepTag !== 'recovery') {
      r.submit(ok());
      r.next();
      seen++;
    }
    expect(r.step.value?.stepTag).toBe('recovery');
    r.submit(ok());
    expect(r.feedback.value?.recovery).toBe(true);
    expect(r.kiai.value.combo).toBe(seen + 1 + 3);
    expect(r.results.filter((x) => x.stepId.endsWith('~recovery'))).toHaveLength(1);
  });

  it('a Good on a new card inserts +3 and +10 steps with bumped exposures', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const steps = [step({ id: 'n0', cardKey: `${V.水}#rec`, isNew: true, stepTag: 'intro', exposures: 0, exercise: 'meaning-guard', params: { answer: 'water', choices: ['water', 'dog', 'coffee', 'bread'] } }), ...vocabSteps(12).slice(1)];
    const r = new SessionRunner(plan(steps), { loader });
    r.submit(ok({ answer: 'water' }));
    const q = r.steps();
    expect(q[3]?.stepTag).toBe('+3');
    expect(q[3]?.cardKey).toBe(`${V.水}#rec`);
    expect(q[3]?.exposures).toBe(1);
    expect(q[10]?.stepTag).toBe('+10');
    expect(q[10]?.exposures).toBe(2);
    expect(q[10]?.isNew).toBe(false);
    expect(r.total.value).toBe(steps.length + 2);
    // the same card's second Good inserts nothing twice
    r.next();
    for (let i = 1; i < 3; i++) {
      r.submit(ok());
      r.next();
    }
    expect(r.step.value?.stepTag).toBe('+3');
    r.submit(ok());
    expect(r.steps().filter((s) => s.cardKey === `${V.水}#rec` && s.stepTag === '+3')).toHaveLength(1);
  });

  it('boss plans never re-queue', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards(20) });
    const steps = vocabSteps(3).map((s) => ({ ...s, block: 'phase' as const, timed: true, timerMs: 4000 }));
    const r = new SessionRunner(plan(steps, 'gate'), { loader });
    r.submit(miss());
    expect(r.steps()).toHaveLength(3);
    r.next();
    r.timeout();
    expect(r.results[1]?.timedOut).toBe(true);
    expect(r.results[1]?.rating).toBe(2);
    expect(r.feedback.value?.kind).toBe('timeout');
  });
});

describe('SessionRunner — snapshot, resume, pause', () => {
  it('saves a snapshot after each submit with the cursor on the next step', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const r = new SessionRunner(plan(vocabSteps(4)), { loader });
    expect(store.session.load()?.cursor).toBe(0);
    r.submit(ok());
    const snap = store.session.load()!;
    expect(snap.cursor).toBe(1);
    expect(snap.results).toHaveLength(1);
    expect(snap.kiai.combo).toBe(1);
    expect(snap.plan.steps).toHaveLength(4);
    r.next();
    r.submit(ok());
    expect(store.session.load()?.cursor).toBe(2);
  });

  it('resumes at the cursor with results and kiai, without a second session:started', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const p = plan(vocabSteps(4));
    const r = new SessionRunner(p, { loader });
    r.submit(ok());
    r.next();
    r.submit(ok());
    const snap = store.session.load()!;
    const cap = captureEvents();
    const back = SessionRunner.resume({ loader })!;
    expect(back).not.toBeNull();
    expect(cap.events.some((e) => e[0] === 'session:started')).toBe(false);
    cap.stop();
    expect(back.resumed).toBe(true);
    expect(back.index.value).toBe(snap.cursor);
    expect(back.step.value?.id).toBe('s2');
    expect(back.results).toHaveLength(2);
    expect(back.kiai.value.combo).toBe(2);
    expect(back.stepsLeft()).toBe(2);
    back.submit(ok());
    back.next();
    back.submit(ok());
    back.next();
    expect(back.done.value?.resumed).toBe(true);
    expect(back.done.value?.tally.reps).toBe(4);
    expect(store.session.load()).toBeNull();
  });

  it('pause excludes paused time from the step clock and the tally', async () => {
    let now = DEFAULT_TEST_NOW;
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards(), now: () => now });
    const r = new SessionRunner(plan(vocabSteps(1)), { loader });
    now += 2000;
    r.pause();
    expect(r.paused.value).toBe(true);
    now += 60_000;
    r.resume();
    expect(r.elapsedMs()).toBe(2000);
    now += 1000;
    r.submit(ok({ ms: 0 }));
    expect(r.results[0]?.ms).toBe(3000);
    r.next();
    expect(r.done.value?.tally.minutes).toBeCloseTo(0.1, 1);
  });
});

describe('SessionRunner — finish, tally, events', () => {
  it('the tally matches the steps and session:finished carries it', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards(20) });
    const cap = captureEvents();
    const r = new SessionRunner(plan(vocabSteps(5)), { loader });
    // The miss on a mature card queues a Recovery step, so the session runs 6 reps.
    const answers = [ok(), ok(), miss(), ok(), ok({ nearMiss: true })];
    let i = 0;
    while (!r.done.value) {
      r.submit(answers[i] ?? ok());
      r.next();
      i++;
    }
    const done = r.done.value!;
    expect(done.planId).toBe('kata-test');
    expect(done.tally.reps).toBe(6);
    expect(done.tally.correct).toBe(5);
    expect(done.tally.accuracy).toBe(Math.round((5 / 6) * 1000) / 1000);
    expect(done.tally.bestCombo).toBe(3);
    expect(done.tally.xp).toBe(done.steps.reduce((a, s) => a + s.xpDelta, 0));
    expect(done.steps.map((s) => s.rating)).toEqual([3, 3, 1, 3, 2, 3]);
    expect(done.steps[5]!.stepId.endsWith('~recovery')).toBe(true);
    const finished = cap.events.filter((e) => e[0] === 'session:finished');
    expect(finished).toHaveLength(1);
    expect((finished[0]![1] as { tally: { reps: number } }).tally.reps).toBe(6);
    expect(store.session.load()).toBeNull();
    cap.stop();
  });

  it('a weak plan emits weak-point:set-done per tag; a welcome plan emits welcome-back:done', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const cap = captureEvents();
    const weak = vocabSteps(2).map((s) => ({ ...s, block: 'weak' as const, params: { ...s.params, tag: 'particle' as const } }));
    const r = new SessionRunner(plan(weak, 'weak'), { loader });
    r.submit(ok());
    r.next();
    r.submit(ok());
    r.next();
    expect(cap.events.filter((e) => e[0] === 'weak-point:set-done')).toEqual([['weak-point:set-done', { tag: 'particle' }]]);
    const w = new SessionRunner(plan(vocabSteps(1).map((s) => ({ ...s, id: 'w0' })), 'welcome'), { loader });
    w.submit(ok());
    w.next();
    expect(cap.events.filter((e) => e[0] === 'welcome-back:done')).toHaveLength(1);
    cap.stop();
  });

  it('abandon emits session:abandoned with the steps answered and clears the snapshot', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const cap = captureEvents();
    const r = new SessionRunner(plan(vocabSteps(3)), { loader });
    r.submit(ok());
    r.next();
    r.abandon();
    expect(r.abandoned.value).toBe(true);
    expect(r.done.value).toBeNull();
    expect(cap.events.filter((e) => e[0] === 'session:abandoned')).toEqual([['session:abandoned', { sessionId: 'kata-test', steps: 1 }]]);
    expect(store.session.load()).toBeNull();
    cap.stop();
  });

  it('a Michikusa step needs no answer: next() advances; an empty plan finishes at once', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const steps = [step({ id: 'm', cardKey: null, itemId: 'm-04-1', block: 'michikusa', exercise: 'story-read', params: { michikusaId: 'm-04-1' } }), ...vocabSteps(1)];
    const r = new SessionRunner(plan(steps), { loader });
    expect(r.step.value?.block).toBe('michikusa');
    r.next();
    expect(r.step.value?.id).toBe('s0');
    expect(r.results).toHaveLength(0);
    const empty = new SessionRunner(plan([]), { loader });
    expect(empty.done.value?.tally.reps).toBe(0);
  });

  it('guard() submits an honest miss; hint() marks the result', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards(20) });
    const r = new SessionRunner(plan(vocabSteps(2)), { loader });
    r.guard();
    expect(r.results[0]?.guard).toBe(true);
    expect(r.results[0]?.rating).toBe(1);
    expect(r.feedback.value?.kind).toBe('guard');
    r.next();
    r.hint();
    r.submit(ok());
    expect(r.results[1]?.hintUsed).toBe(true);
    expect(r.results[1]?.rating).toBe(2);
  });
});

describe('SessionRunner — scrolls', () => {
  it('a pretest miss writes nothing; a pretest Good and an intro check introduce the item; scroll:completed fires once', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const cap = captureEvents();
    const sid = '4-1';
    const steps: Step[] = [
      step({ id: pretestStepId(sid, V.水), cardKey: `${V.水}#rec`, isNew: true, exposures: 0, exercise: 'meaning-guard', block: 'scroll', params: { scrollId: sid, answer: 'water', choices: ['water', 'a', 'b', 'c'] } }),
      step({ id: pretestStepId(sid, V.犬), cardKey: `${V.犬}#rec`, isNew: true, exposures: 0, exercise: 'meaning-guard', block: 'scroll', params: { scrollId: sid, answer: 'dog', choices: ['dog', 'a', 'b', 'c'] } }),
      step({ id: checkStepId(sid, V.水), cardKey: `${V.水}#rec`, isNew: true, stepTag: 'intro', exposures: 0, exercise: 'meaning-guard', block: 'scroll', params: { scrollId: sid, answer: 'water', choices: ['water', 'a', 'b', 'c'] } }),
      step({ id: checkStepId(sid, V.犬), cardKey: `${V.犬}#rec`, isNew: true, stepTag: 'intro', exposures: 0, exercise: 'meaning-guard', block: 'scroll', params: { scrollId: sid, answer: 'dog', choices: ['dog', 'a', 'b', 'c'] } }),
    ];
    const r = new SessionRunner(plan(steps, 'kumite', { scrollIds: [sid], newCount: 2 }), { loader });
    r.submit(miss());
    expect(store.cards.get(`${V.水}#rec`)).toBeUndefined();
    expect(r.results[0]?.rating).toBeNull();
    expect(r.feedback.value?.line).toBeTruthy();
    expect(r.steps()).toHaveLength(4);
    r.next();
    r.submit(ok({ answer: 'dog' }));
    expect(store.cards.get(`${V.犬}#rec`)).toBeDefined();
    expect(cap.events.filter((e) => e[0] === 'item:introduced').map((e) => (e[1] as { itemId: string }).itemId)).toEqual([V.犬]);
    r.next();
    r.submit(ok({ answer: 'water' }));
    expect(store.cards.get(`${V.水}#rec`)).toBeDefined();
    expect(cap.events.filter((e) => e[0] === 'scroll:completed')).toHaveLength(0);
    r.next();
    r.submit(ok({ answer: 'dog' }));
    const completed = cap.events.filter((e) => e[0] === 'scroll:completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]![1]).toEqual({ scrollId: sid, itemIds: [V.水, V.犬], flawless: true });
    expect(cap.events.filter((e) => e[0] === 'item:introduced')).toHaveLength(2);
    cap.stop();
  });
});

describe('helpers', () => {
  it('correctFormOf prefers the answer, then accept, then joined answers', () => {
    expect(correctFormOf(step({ id: 'a', cardKey: null, params: { answer: '犬' } }))).toBe('犬');
    expect(correctFormOf(step({ id: 'a', cardKey: null, params: { accept: ['いぬ'] } }))).toBe('いぬ');
    expect(correctFormOf(step({ id: 'a', cardKey: null, params: { answers: ['a', 'b'] } }))).toBe('a・b');
    expect(correctFormOf(step({ id: 'a', cardKey: null, params: {} }))).toBeUndefined();
  });

  it('judgeNeeded samples only self-rated Goods', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const steps = [step({ id: 'j', cardKey: `${G.です}#cloze`, exercise: 'meaning-judge' })];
    const r = new SessionRunner(plan(steps), { loader });
    expect(r.judgeNeeded(ok())).toBe(false);
    expect(r.judgeNeeded(ok({ selfRating: 2 }))).toBe(false);
    // first 20 checks are always sampled (rate 100)
    expect(r.judgeNeeded(ok({ selfRating: 3 }))).toBe(true);
    r.submit(ok({ selfRating: 3 }), { judge: 'fail' });
    expect(r.results[0]?.rating).toBe(1);
    expect(r.feedback.value?.judge).toBe('fail');
  });
});

describe('SessionRunner — regressions', () => {
  it('a boss runner with persist: false never touches the training snapshot, finished or abandoned', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards() });
    const kata = new SessionRunner(plan(vocabSteps(4)), { loader });
    kata.submit(ok());
    kata.next();
    const kept = store.session.load()!;
    expect(kept.plan.mode).toBe('kata');
    expect(kept.cursor).toBe(1);
    const gate = new SessionRunner(plan(vocabSteps(2), 'gate'), { loader, persist: false });
    expect(store.session.load()).toEqual(kept);
    gate.submit(ok());
    gate.next();
    expect(store.session.load()).toEqual(kept);
    gate.submit(ok());
    gate.next();
    expect(gate.done.value).not.toBeNull();
    expect(store.session.load()).toEqual(kept);
    const cap = captureEvents();
    const kage = new SessionRunner(plan(vocabSteps(2), 'kage'), { loader, persist: false });
    kage.abandon();
    expect(cap.events.some((e) => e[0] === 'session:abandoned')).toBe(true);
    expect(store.session.load()).toEqual(kept);
    cap.stop();
  });

  it('a session resumed the next day earns its active minutes, not the night (tally, stats, daily row)', async () => {
    let clock = DEFAULT_TEST_NOW;
    await makeTestStore({ save: { progress: { station: 4 } }, cards: vocabCards(), now: () => clock, reducers: true });
    const r = new SessionRunner(plan(vocabSteps(3)), { loader });
    clock += 30_000;
    r.submit(ok());
    r.next();
    expect((store.session.load() as RunnerSnapshot | null)?.activeMs).toBe(30_000);
    clock += 86_400_000;
    const back = SessionRunner.resume({ loader })!;
    clock += 20_000;
    back.submit(ok());
    back.next();
    clock += 10_000;
    back.submit(ok());
    back.next();
    const done = back.done.value!;
    expect(done.tally.minutes).toBe(1);
    expect(done.endedAt - done.startedAt).toBe(60_000);
    expect(store.stats.value.minutes).toBe(1);
    expect(store.daily.value[store.today()]?.minutes).toBe(1);
  });

  it('the つづく XP matches the profile: introduction and Scroll XP ride on the step that earned them', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, reducers: true });
    const sid = '4-1';
    const items = [V.水, V.犬, V.人];
    const steps: Step[] = items.map((id) => step({ id: checkStepId(sid, id), cardKey: `${id}#rec`, isNew: true, stepTag: 'intro', exposures: 0, exercise: 'meaning-guard', block: 'scroll', params: { scrollId: sid, answer: 'x', choices: ['x', 'a', 'b', 'c'] } }));
    const before = store.profile.value.xp;
    const r = new SessionRunner(plan(steps, 'kumite', { scrollIds: [sid], newCount: 3 }), { loader });
    let guard = 0;
    while (!r.done.value && guard++ < 40) {
      r.submit(ok({ answer: 'x' }));
      r.next();
    }
    const done = r.done.value!;
    expect(done.tally.xp).toBe(store.profile.value.xp - before);
    expect(done.tally.xp).toBeGreaterThan(0);
    expect(done.steps.reduce((a, s) => a + s.xpDelta, 0)).toBeLessThanOrEqual(done.tally.xp);
    expect(toPlain('{水|みず}')).toBe('水');
  });
});
