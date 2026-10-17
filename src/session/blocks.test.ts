/**
 * blocks.ts — templates, time fitting, estimates (design 03 §2, §5).
 */
import { describe, expect, it } from 'vitest';
import type { Step } from '../shared/session-types';
import {
  FIXED_STEP_MS,
  KATA_MAX_REVIEWS,
  MICHIKUSA_MS,
  MODE_MINUTES,
  SPARRING_LISTEN_MIN,
  estimateMs,
  estimateStepMs,
  fitToTime,
  inputMinutesFor,
  outputKindsFor,
  outputMinutesFor,
  strandDeficitFor,
  templateFor,
  type TemplateCtx,
} from './blocks';

const ctx = (o: Partial<TemplateCtx> = {}): TemplateCtx => ({
  belt: 'yellow',
  station: 5,
  backlog: false,
  dueCount: 40,
  weakTags: [],
  strandDeficit: null,
  newTarget: 4,
  day: 20000,
  ...o,
});

describe('templateFor — Kata', () => {
  it('has only reviews and one Michikusa', () => {
    const t = templateFor('kata', ctx());
    expect(t.map((b) => b.kind)).toEqual(['reviews', 'michikusa']);
    expect(t[0]!.spec.count).toBe(Math.min(KATA_MAX_REVIEWS, 40));
    expect(t[0]!.minutes).toBeLessThanOrEqual(3);
  });

  it('never asks for more reviews than are due', () => {
    expect(templateFor('kata', ctx({ dueCount: 7 }))[0]!.spec.count).toBe(7);
    expect(templateFor('kata', ctx({ dueCount: 0 }))[0]!.spec.count).toBe(0);
  });
});

describe('templateFor — Kumite', () => {
  it('has warm-up, 1–2 Scrolls, sparring with ≥ 2 listen, Michikusa, an output micro-block and a cooldown', () => {
    const t = templateFor('kumite', ctx());
    expect(t.map((b) => b.kind)).toEqual(['warmup', 'scroll', 'sparring', 'michikusa', 'output', 'cooldown']);
    const scroll = t.find((b) => b.kind === 'scroll')!;
    expect(scroll.spec.scrollCount).toBe(2);
    expect(scroll.spec.minCount).toBe(1);
    const sparring = t.find((b) => b.kind === 'sparring')!;
    expect(sparring.spec.facetMix?.listen).toBe(SPARRING_LISTEN_MIN);
    expect(sparring.spec.count).toBe(15);
    const output = t.find((b) => b.kind === 'output')!;
    expect(output.minutes).toBe(1.5);
    expect(['shadow', 'role-play']).toContain(output.spec.outputKind);
  });

  it('plans one Scroll when the new-item budget is already met and none in backlog mode', () => {
    expect(templateFor('kumite', ctx({ newTarget: 0 })).find((b) => b.kind === 'scroll')!.spec.scrollCount).toBe(1);
    expect(templateFor('kumite', ctx({ backlog: true })).some((b) => b.kind === 'scroll')).toBe(false);
  });

  it('offers a role-play turn only from Station 7', () => {
    for (let day = 0; day < 4; day++) expect(templateFor('kumite', ctx({ station: 5, day })).find((b) => b.kind === 'output')!.spec.outputKind).toBe('shadow');
    const kinds = new Set([0, 1, 2, 3].map((day) => templateFor('kumite', ctx({ station: 8, day })).find((b) => b.kind === 'output')!.spec.outputKind));
    expect(kinds.has('role-play')).toBe(true);
    expect(templateFor('kumite', ctx({ station: 8, strandDeficit: 'output', day: 2 })).find((b) => b.kind === 'output')!.spec.outputKind).toBe('role-play');
  });
});

describe('templateFor — Shugyō', () => {
  it.each([
    ['white', 5, 3],
    ['yellow', 5, 3],
    ['orange', 5, 3],
    ['green', 7, 4],
    ['blue', 9, 5],
    ['purple', 9, 5],
    ['brown', 12, 7],
    ['black', 12, 7],
  ] as const)('%s belt: Input %i min, Output %i min', (belt, input, output) => {
    expect(inputMinutesFor(belt)).toBe(input);
    expect(outputMinutesFor(belt)).toBe(output);
    const t = templateFor('shugyo', ctx({ belt }));
    expect(t.find((b) => b.kind === 'input')!.minutes).toBe(input);
    expect(t.find((b) => b.kind === 'output')!.minutes).toBe(output);
  });

  it('has the full block order, 2–4 Scrolls and a Weak Point set only when a tag is active', () => {
    const t = templateFor('shugyo', ctx({ newTarget: 5 }));
    expect(t.map((b) => b.kind)).toEqual(['warmup', 'reviews', 'scroll', 'input', 'output', 'michikusa', 'cooldown']);
    expect(t.find((b) => b.kind === 'scroll')!.spec.scrollCount).toBe(4);
    expect(templateFor('shugyo', ctx({ newTarget: 0 })).find((b) => b.kind === 'scroll')!.spec.scrollCount).toBe(2);
    const weak = templateFor('shugyo', ctx({ weakTags: ['particle'] }));
    expect(weak.map((b) => b.kind)).toContain('weak');
    expect(weak.find((b) => b.kind === 'weak')!.spec.tag).toBe('particle');
    expect(weak.find((b) => b.kind === 'weak')!.minutes).toBe(3);
  });

  it('the strand bias chooses Input over Output and vice versa', () => {
    const base = templateFor('shugyo', ctx({ belt: 'green' }));
    const inputBiased = templateFor('shugyo', ctx({ belt: 'green', strandDeficit: 'input' }));
    const outputBiased = templateFor('shugyo', ctx({ belt: 'green', strandDeficit: 'output' }));
    const min = (t: typeof base, k: string) => t.find((b) => b.kind === k)!.minutes;
    expect(min(inputBiased, 'input')).toBeGreaterThan(min(base, 'input'));
    expect(min(inputBiased, 'output')).toBeLessThan(min(base, 'output'));
    expect(min(outputBiased, 'output')).toBeGreaterThan(min(base, 'output'));
    expect(min(outputBiased, 'input')).toBeLessThan(min(base, 'input'));
  });

  it('a due Kage set replaces the Output block on Mondays', () => {
    const t = templateFor('shugyo', ctx({ kageDue: true }));
    const out = t.find((b) => b.kind === 'output')!;
    expect(out.spec.replacement).toBe('kage');
    expect(out.spec.count).toBe(30);
    expect(out.minutes).toBe(5);
  });

  it('warm-up is three shadowed sentences and reviews stay within 8–12 minutes', () => {
    const t = templateFor('shugyo', ctx({ dueCount: 200 }));
    expect(t[0]!.spec.outputKind).toBe('shadow');
    expect(t[0]!.spec.count).toBe(3);
    expect(t[1]!.minutes).toBe(12);
    expect(templateFor('shugyo', ctx({ dueCount: 10 }))[1]!.minutes).toBe(8);
  });
});

describe('templateFor — other modes', () => {
  it('boss and exam shapes', () => {
    const gate = templateFor('gate', ctx());
    expect(gate.map((b) => b.spec.count)).toEqual([20, 20, 12, 3]);
    expect(gate.every((b) => b.kind === 'phase')).toBe(true);
    const shinsa = templateFor('shinsa', ctx());
    expect(shinsa).toHaveLength(5);
    expect(shinsa.map((b) => b.spec.count)).toEqual([10, 2, 30, 6, 1]);
  });

  it('weak / welcome / kage / arcade / scroll / dan', () => {
    expect(templateFor('weak', ctx({ weakTags: ['voicing'] }))[0]!.spec.tag).toBe('voicing');
    expect(templateFor('welcome', ctx()).map((b) => b.kind)).toEqual(['reviews', 'michikusa']);
    expect(templateFor('welcome', ctx())[0]!.spec.count).toBe(20);
    expect(templateFor('kage', ctx())[0]!.spec.count).toBe(30);
    expect(templateFor('rapid', ctx())[0]!.kind).toBe('sparring');
    expect(templateFor('gojuon', ctx())[0]!.kind).toBe('sparring');
    expect(templateFor('scroll', ctx())[0]!.spec.scrollCount).toBe(1);
    const dan = templateFor('dan', ctx());
    expect(dan.reduce((a, b) => a + b.minutes, 0)).toBe(MODE_MINUTES.dan);
  });

  it('output kinds unlock by station (design 04 §13)', () => {
    expect(outputKindsFor(5)).toEqual(['shadow']);
    expect(outputKindsFor(7)).toEqual(['shadow', 'role-play']);
    expect(outputKindsFor(30)).toEqual(['shadow', 'role-play', 'writing', 'three-ways', 'monologue']);
  });
});

describe('fitToTime', () => {
  it('shrinks reviews but never below 60 % of due', () => {
    const t = templateFor('shugyo', ctx({ dueCount: 100, newTarget: 0 }));
    const fitted = fitToTime(t, 20, { due: 100 });
    const reviews = fitted.find((b) => b.kind === 'reviews')!;
    expect(reviews.spec.count).toBeGreaterThanOrEqual(60);
    expect(fitted.reduce((a, b) => a + b.minutes, 0)).toBeLessThanOrEqual(t.reduce((a, b) => a + b.minutes, 0));
  });

  it('Input and Output shrink last', () => {
    const t = templateFor('shugyo', ctx({ dueCount: 30, newTarget: 0 }));
    const total = t.reduce((a, b) => a + b.minutes, 0);
    const fitted = fitToTime(t, total - 2, { due: 30 });
    const min = (k: string) => fitted.find((b) => b.kind === k)!.minutes;
    expect(min('input')).toBe(inputMinutesFor('yellow'));
    expect(min('output')).toBe(outputMinutesFor('yellow'));
    const squeezed = fitToTime(t, 6, { due: 30 });
    expect(squeezed.find((b) => b.kind === 'input')!.minutes).toBeLessThan(inputMinutesFor('yellow'));
    expect(squeezed.find((b) => b.kind === 'input')!.minutes).toBeGreaterThanOrEqual(2);
    expect(squeezed.find((b) => b.kind === 'output')!.minutes).toBeGreaterThanOrEqual(1);
  });

  it('never grows a plan and leaves a fitting plan untouched', () => {
    const t = templateFor('kata', ctx({ dueCount: 10 }));
    const same = fitToTime(t, 100);
    expect(same.map((b) => b.minutes)).toEqual(t.map((b) => b.minutes));
    expect(same).not.toBe(t);
  });

  it('a Scroll block loses Scrolls one at a time, never below one', () => {
    const t = templateFor('kumite', ctx({ dueCount: 20, newTarget: 4 }));
    const fitted = fitToTime(t, 7, { due: 20 });
    expect(fitted.find((b) => b.kind === 'scroll')!.spec.scrollCount).toBe(1);
  });
});

describe('estimates', () => {
  const step = (exercise: Step['exercise'], params: Step['params'] = {}, estMs = 0, block: Step['block'] = 'reviews'): Step => ({
    id: 'x',
    block,
    exercise,
    itemId: null,
    cardKey: null,
    params,
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs,
  });

  it('uses the drill median, else fixed costs, else rep defaults', () => {
    expect(estimateStepMs('meaning-recall', {}, { 'meaning-recall': 6500 })).toBe(6500);
    expect(estimateStepMs('story-read', {}, {})).toBe(FIXED_STEP_MS['story-read']);
    expect(estimateStepMs('meaning-guard', { choices: ['a', 'b', 'c', 'd'] }, {})).toBe(4000);
    expect(estimateStepMs('production-forge', { answer: '水' }, {})).toBe(10000);
    expect(estimateStepMs('pitch-ear', {}, {})).toBe(8000);
    expect(estimateStepMs('monologue', { seconds: 120 }, {})).toBe(135_000);
  });

  it('sums steps, honoring a step’s own estMs and charging a Michikusa 10 s', () => {
    const steps = [step('meaning-recall', {}, 5000), step('story-read'), step('kana-flash', {}, 0, 'michikusa')];
    expect(estimateMs(steps, {})).toBe(5000 + FIXED_STEP_MS['story-read']! + MICHIKUSA_MS);
  });
});

describe('strandDeficitFor', () => {
  it('names the strand most below its weekly share, within a 2-point tolerance', () => {
    expect(strandDeficitFor({ form: 60, input: 25, output: 15 }, 'yellow')).toBeNull();
    expect(strandDeficitFor({ form: 90, input: 5, output: 5 }, 'yellow')).toBe('input');
    expect(strandDeficitFor({ form: 50, input: 50, output: 0 }, 'yellow')).toBe('output');
    expect(strandDeficitFor({ form: 0, input: 0, output: 0 }, 'yellow')).toBeNull();
    expect(strandDeficitFor({ form: 80, input: 10, output: 10 }, 'brown')).toBe('input');
    expect(strandDeficitFor({ form: 70, input: 30, output: 0 }, 'black', 1)).toBe('output');
  });
});
