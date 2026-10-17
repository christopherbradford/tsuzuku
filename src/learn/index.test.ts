/**
 * The barrel must export every module-plan name of both halves. A static
 * import makes a broken barrel fail at `tsc` time and here; the loop below
 * pins the name list.
 */
import * as learn from './index';

const SCHEDULING_NAMES = [
  // fsrs
  'W',
  'retrievability',
  'nextInterval',
  'initialStability',
  'initialDifficulty',
  'nextDifficulty',
  'nextStability',
  'sameDayStability',
  'schedule',
  'GOLDEN',
  // scheduler
  'facetsFor',
  'newCard',
  'warmStart',
  'unlockableFacets',
  'shouldArchive',
  'isKaiden',
  'applyRating',
  'kaidenQuota',
  // item-belt
  'itemBelt',
  'baseFacet',
  'productionFacet',
  'BELT_ORDER',
  // known
  'isKnown',
  'knownSet',
  // governors
  'capFor',
  'steadyStateReviews',
  'governor',
  // intro-policy
  'scrollsForStation',
  'nextScrolls',
  // queue
  'dueCards',
  'gojuonPool',
  'recheckCards',
  'prodPrompt',
  'orderWave',
  'interleave',
  'insertSteps',
  'exerciseFor',
  'weakPointSet',
  'rapidFirePool',
  'kagePools',
  'buildQueue',
  'interleaveViolations',
  'prodPrompts',
  'findBlank',
  'RECHECK_FLAG',
];

const GRADING_NAMES = [
  'toRating',
  'isMature',
  'isSlow',
  'SCORE_BANDS',
  'judgeRate',
  'shouldJudge',
  'judgeOptions',
  'rubricJudge',
  'perceptionJudge',
  'KIAI_RULES',
  'kiaiInit',
  'kiaiStep',
  'isNemesis',
  'nemesisPhase',
  'duelProgress',
  'defeat',
  'meaningChoices',
  'kanaGrid',
  'kanjiLookalikes',
  'clozeTiles',
  'scrambleTiles',
  'conjugate',
  'applicableForms',
  'isConjugable',
  // additive re-exports (CHANGELOG 2026-10-17)
  'SHADOW_BANDS',
  'MATURE_S',
  'rubricPasses',
  'honestyRate',
  'comboTier',
  'dueRecoveries',
  'nextDuelKey',
  'wonToday',
  'PARTICLES',
  'particleOptions',
  'minimalPairPartner',
  'acceptedSurfaces',
  'applicableFormsFor',
  'conjugateAll',
];

describe('learn barrel', () => {
  const mod: Record<string, unknown> = learn;
  it('exports every scheduling-half and grading-half name', () => {
    for (const name of [...SCHEDULING_NAMES, ...GRADING_NAMES]) {
      expect(mod[name], name).toBeDefined();
    }
  });
  it('is not empty and has no undefined export', () => {
    const names = Object.keys(mod);
    expect(names.length).toBeGreaterThan(SCHEDULING_NAMES.length + GRADING_NAMES.length);
    for (const n of names) expect(mod[n], n).toBeDefined();
  });
});
