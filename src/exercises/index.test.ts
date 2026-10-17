import type { JSX } from 'preact';
import { DRILL_IDS, RUNNER_IDS, type DrillId } from '@/content/types';
import { isRegistered, listExercises, resetRegistryForTests, resolveExercise, type ExerciseMeta } from '@/shared/exercise-types';
import {
  D_DRILL_FACETS,
  D_DRILL_IDS,
  componentNameOf,
  discoveredModules,
  isExerciseMeta,
  missingDrills,
  registerAll,
  registerFrom,
  registerReport,
  type ExerciseModule,
} from './index';

beforeEach(() => {
  resetRegistryForTests();
});
afterEach(() => {
  resetRegistryForTests();
});

const FOLDER: Record<DrillId, string> = {
  'kana-flash': 'kana/KanaFlash',
  'kana-ear': 'kana/KanaEar',
  'kana-forge': 'kana/KanaForge',
  'gojuon-fighter': 'kana/GojuonFighter',
  'meaning-guard': 'vocab/MeaningGuard',
  'meaning-recall': 'vocab/MeaningRecall',
  'meaning-judge': 'vocab/MeaningJudge',
  'audio-flash': 'vocab/AudioFlash',
  'production-forge': 'vocab/ProductionForge',
  'pitch-ear': 'vocab/PitchEar',
  'component-flash': 'kanji/ComponentFlash',
  'component-assembly': 'kanji/ComponentAssembly',
  'kanji-read': 'kanji/KanjiRead',
  'lookalike-duel': 'kanji/LookalikeDuel',
  'kanji-write': 'kanji/KanjiWrite',
  'pattern-cloze': 'grammar/PatternCloze',
  'particle-duel': 'grammar/ParticleDuel',
  'form-forge': 'grammar/FormForge',
  'form-chain': 'grammar/FormChain',
  transform: 'grammar/Transform',
  scramble: 'grammar/Scramble',
  'judgment-call': 'grammar/JudgmentCall',
  'sentence-listen': 'listening/SentenceListen',
  'minimal-pair': 'listening/MinimalPair',
  'rapid-fire': 'fluency/RapidFire',
  'nemesis-duel': 'fluency/NemesisDossier',
  // F-owned (never registered by D)
  'listening-set': 'input/listening/ListeningSet',
  shadow: 'input/speaking/Shadow',
  'say-three-ways': 'input/speaking/SayThreeWays',
  monologue: 'input/speaking/Monologue',
  'story-read': 'input/reading/StoryRead',
  'speed-read': 'input/reading/SpeedRead',
  'role-play': 'input/taiwa/RolePlay',
  'writing-dojo': 'input/writing/WritingDojo',
  'field-mission': 'input/missions/FieldMission',
};

function metaFor(id: DrillId, over: Partial<ExerciseMeta> = {}): ExerciseMeta {
  const facet = id in D_DRILL_FACETS ? D_DRILL_FACETS[id as keyof typeof D_DRILL_FACETS] : null;
  return { id, facet, needsTts: false, needsStt: false, selfGraded: false, timeable: true, keys: 'choices', ...over };
}

function fakeModule(id: DrillId, over: Partial<ExerciseMeta> = {}, name?: string): [string, ExerciseModule] {
  const path = `./${FOLDER[id]}.tsx`;
  const comp = (): JSX.Element | null => null;
  return [path, { meta: metaFor(id, over), [name ?? componentNameOf(path)]: comp }];
}

function fakeAll(): Record<string, ExerciseModule> {
  return Object.fromEntries(D_DRILL_IDS.map((id) => fakeModule(id)));
}

describe('D_DRILL_IDS', () => {
  it('pins exactly the 26 D-owned drill ids, unique, all DrillIds, none of RUNNER_IDS', () => {
    expect(D_DRILL_IDS.length).toBe(26);
    expect(new Set(D_DRILL_IDS).size).toBe(26);
    expect([...D_DRILL_IDS]).toEqual([
      'kana-flash',
      'kana-ear',
      'kana-forge',
      'gojuon-fighter',
      'meaning-guard',
      'meaning-recall',
      'meaning-judge',
      'audio-flash',
      'production-forge',
      'pitch-ear',
      'component-flash',
      'component-assembly',
      'kanji-read',
      'lookalike-duel',
      'kanji-write',
      'pattern-cloze',
      'particle-duel',
      'form-forge',
      'form-chain',
      'transform',
      'scramble',
      'judgment-call',
      'sentence-listen',
      'minimal-pair',
      'rapid-fire',
      'nemesis-duel',
    ]);
    const drills = new Set<string>(DRILL_IDS);
    const runners = new Set<string>(RUNNER_IDS);
    expect(D_DRILL_IDS.every((id) => drills.has(id))).toBe(true);
    expect(D_DRILL_IDS.some((id) => runners.has(id))).toBe(false);
  });

  it('leaves the 9 F-owned drills alone', () => {
    const d = new Set<string>(D_DRILL_IDS);
    const f = DRILL_IDS.filter((id) => !d.has(id));
    expect(f).toEqual(['listening-set', 'shadow', 'say-three-ways', 'monologue', 'story-read', 'speed-read', 'role-play', 'writing-dojo', 'field-mission']);
  });

  it('pins the facet of every D drill (design 04 / 05 §2)', () => {
    expect(D_DRILL_FACETS).toEqual({
      'kana-flash': 'rec',
      'kana-ear': 'prod',
      'kana-forge': 'prod',
      'gojuon-fighter': null,
      'meaning-guard': 'rec',
      'meaning-recall': 'rec',
      'meaning-judge': 'rec',
      'audio-flash': 'listen',
      'production-forge': 'prod',
      'pitch-ear': 'pitch',
      'component-flash': 'rec',
      'component-assembly': 'comp',
      'kanji-read': 'read',
      'lookalike-duel': 'read',
      'kanji-write': null,
      'pattern-cloze': 'cloze',
      'particle-duel': 'cloze',
      'form-forge': 'prod',
      'form-chain': 'prod',
      transform: 'prod',
      scramble: 'cloze',
      'judgment-call': 'cloze',
      'sentence-listen': null,
      'minimal-pair': null,
      'rapid-fire': null,
      'nemesis-duel': null,
    });
  });
});

describe('registerFrom', () => {
  it('registers exactly the 26 D ids with their facets from a full module set, idempotently', () => {
    const mods = fakeAll();
    const r1 = registerFrom(mods);
    expect(r1.skipped).toEqual([]);
    expect(r1.warnings).toEqual([]);
    expect([...r1.registered].sort()).toEqual([...D_DRILL_IDS].sort());
    const metas = listExercises();
    expect(metas.length).toBe(26);
    for (const m of metas) expect(m.facet).toBe(D_DRILL_FACETS[m.id as keyof typeof D_DRILL_FACETS]);
    expect(RUNNER_IDS.some((id) => isRegistered(id))).toBe(false);
    expect(resolveExercise('kana-flash')?.meta.id).toBe('kana-flash');
    // second pass: no duplicate-registration throw, same set
    const r2 = registerFrom(mods);
    expect([...r2.registered].sort()).toEqual([...D_DRILL_IDS].sort());
    expect(listExercises().length).toBe(26);
  });

  it('ignores helper modules without meta and reports a module whose component is misnamed', () => {
    const mods: Record<string, ExerciseModule> = {
      './kana/Lantern.tsx': { Lantern: () => null },
      ...Object.fromEntries([fakeModule('kana-flash'), fakeModule('kana-ear', {}, 'KanaEarView')]),
    };
    const r = registerFrom(mods);
    expect(r.registered).toEqual(['kana-flash']);
    expect(r.skipped).toEqual([{ path: './kana/KanaEar.tsx', reason: 'missing export "KanaEar" (component named like the file)' }]);
    expect(isRegistered('kana-ear')).toBe(false);
  });

  it('reports a malformed meta instead of registering it', () => {
    const r = registerFrom({ './kana/KanaFlash.tsx': { meta: { id: 'kana-flash' }, KanaFlash: () => null } });
    expect(r.registered).toEqual([]);
    expect(r.skipped[0]?.reason).toBe('meta is not an ExerciseMeta');
  });

  it('in dev, a non-D drill id or a facet off the pinned table throws loudly', () => {
    expect(() => registerFrom(Object.fromEntries([fakeModule('shadow')]))).toThrow(/not a D-owned drill id/);
    expect(isRegistered('shadow')).toBe(false);
    expect(() => registerFrom(Object.fromEntries([fakeModule('kana-flash', { facet: 'prod' })]))).toThrow(/facet prod differs from the pinned rec/);
  });

  it('outside dev the same deviations are reported, and the facet deviation still registers', () => {
    vi.stubEnv('DEV', false);
    try {
      const r = registerFrom(Object.fromEntries([fakeModule('shadow'), fakeModule('kana-flash', { facet: 'prod' })]));
      expect(r.skipped).toEqual([{ path: './input/speaking/Shadow.tsx', reason: '"shadow" is not a D-owned drill id' }]);
      expect(r.warnings.length).toBe(1);
      expect(r.registered).toEqual(['kana-flash']);
      expect(isRegistered('kana-flash')).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('isExerciseMeta / componentNameOf', () => {
  it('validates the ExerciseMeta shape field by field', () => {
    expect(isExerciseMeta(metaFor('kana-flash'))).toBe(true);
    expect(isExerciseMeta(metaFor('kana-flash', { facet: null }))).toBe(true);
    expect(isExerciseMeta({ ...metaFor('kana-flash'), id: 'gatekeeper' })).toBe(false);
    expect(isExerciseMeta({ ...metaFor('kana-flash'), facet: 'nope' })).toBe(false);
    expect(isExerciseMeta({ ...metaFor('kana-flash'), keys: 'digits' })).toBe(false);
    expect(isExerciseMeta({ ...metaFor('kana-flash'), needsTts: 'yes' })).toBe(false);
    expect(isExerciseMeta(null)).toBe(false);
    expect(isExerciseMeta('kana-flash')).toBe(false);
  });
  it('derives the component name from the file name', () => {
    expect(componentNameOf('./kana/KanaFlash.tsx')).toBe('KanaFlash');
    expect(componentNameOf('./fluency/NemesisDossier.tsx')).toBe('NemesisDossier');
    expect(componentNameOf('Foo.ts')).toBe('Foo');
  });
});

describe('registerAll (real drill files on disk)', () => {
  it('registers only D ids, every discovered drill follows the export convention, and the rest are reported missing', () => {
    expect(registerReport()).toBeNull();
    registerAll();
    const report = registerReport();
    expect(report).not.toBeNull();
    const dSet = new Set<string>(D_DRILL_IDS);
    const ids = listExercises().map((m) => m.id);
    expect(ids.every((id) => dSet.has(id))).toBe(true);
    expect(RUNNER_IDS.some((id) => isRegistered(id))).toBe(false);
    // a drill file that exists but breaks the convention fails this test with its reason
    expect(report?.skipped).toEqual([]);
    expect(report?.warnings).toEqual([]);
    expect([...ids, ...missingDrills()].sort()).toEqual([...D_DRILL_IDS].sort());
    expect(discoveredModules().every((p) => /^\.\/[a-z-]+\/[A-Z][A-Za-z0-9]*\.tsx$/.test(p))).toBe(true);
    // idempotent
    registerAll();
    expect(listExercises().map((m) => m.id)).toEqual(ids);
  });
});
