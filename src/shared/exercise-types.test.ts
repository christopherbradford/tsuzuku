import type { FunctionComponent } from 'preact';
import type { DrillId } from '../content/types';
import {
  isRegistered,
  listExercises,
  registerExercise,
  resetRegistryForTests,
  resolveExercise,
  type AttemptResult,
  type ExerciseMeta,
  type ExerciseProps,
} from './exercise-types';
import type { StepResult } from './session-types';

const Dummy: FunctionComponent<ExerciseProps> = () => null;
const meta = (id: DrillId): ExerciseMeta => ({
  id,
  facet: 'rec',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
});

beforeEach(() => resetRegistryForTests());

describe('exercise registry', () => {
  it('register / resolve roundtrip', () => {
    registerExercise(meta('meaning-guard'), Dummy);
    const r = resolveExercise('meaning-guard');
    expect(r?.Component).toBe(Dummy);
    expect(r?.meta.id).toBe('meaning-guard');
    expect(isRegistered('meaning-guard')).toBe(true);
    expect(resolveExercise('kana-flash')).toBeUndefined();
    expect(resolveExercise('gatekeeper')).toBeUndefined(); // runner ids are never registered
  });
  it('duplicate registration throws in dev; unknown id always throws', () => {
    registerExercise(meta('kana-flash'), Dummy);
    expect(() => registerExercise(meta('kana-flash'), Dummy)).toThrow(/twice/);
    expect(() => registerExercise(meta('not-a-drill' as DrillId), Dummy)).toThrow(RangeError);
  });
  it('listExercises follows DRILL_IDS order; reset clears', () => {
    registerExercise(meta('production-forge'), Dummy);
    registerExercise(meta('kana-flash'), Dummy);
    expect(listExercises().map((m) => m.id)).toEqual(['kana-flash', 'production-forge']);
    resetRegistryForTests();
    expect(listExercises()).toEqual([]);
  });
  it('types: StepResult extends AttemptResult', () => {
    expectTypeOf<StepResult>().toMatchTypeOf<AttemptResult>();
  });
});
