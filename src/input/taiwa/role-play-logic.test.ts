import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID } from '@/content/fixtures';
import { toPlain } from '@/content/ruby';
import type { StoryItem, StoryLine } from '@/content/types';
import {
  AIZUCHI_PAUSE_MS,
  IMPLICIT_WINDOW_DAYS,
  SPEAK_MAX_MS,
  gradeTypedKanaAware,
  isStoryItem,
  kanaVariant,
  outcomeFromBuild,
  outcomeFromOption,
  outcomeFromTyped,
  registerTargets,
  resolveLearnerSpeaker,
  summarize,
  tokenReadings,
  turnPlan,
} from './role-play-logic';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const L = (i: number): StoryLine => DIALOGUE.lines[i] as StoryLine;

describe('role-play logic', () => {
  it('constants follow the design: 8 s speak cap, 3-day implicit window, a visible pause after the slot', () => {
    expect(SPEAK_MAX_MS).toBe(8000);
    expect(IMPLICIT_WINDOW_DAYS).toBe(3);
    expect(AIZUCHI_PAUSE_MS).toBeGreaterThan(0);
  });

  it('isStoryItem tells stories from the other content kinds', () => {
    expect(isStoryItem(DIALOGUE)).toBe(true);
    expect(isStoryItem(STORY)).toBe(true);
    expect(isStoryItem(FIXTURE.items['v-n5-0001'])).toBe(false);
    expect(isStoryItem(null)).toBe(false);
  });

  it('resolveLearnerSpeaker: learnerSpeaker wins, else the second speaker, null for a narration', () => {
    expect(resolveLearnerSpeaker(DIALOGUE)).toBe('ハナ');
    expect(resolveLearnerSpeaker({ lines: DIALOGUE.lines })).toBe('ハナ');
    expect(resolveLearnerSpeaker({ learnerSpeaker: 'ゴースト', lines: DIALOGUE.lines })).toBe('ハナ');
    expect(resolveLearnerSpeaker(STORY)).toBeNull();
    expect(resolveLearnerSpeaker({ lines: DIALOGUE.lines.filter((l) => l.speaker === 'ケン') })).toBeNull();
  });

  it('registerTargets carries a registerTarget forward from its line', () => {
    const lines = DIALOGUE.lines.map((l, i) => (i === 2 ? { ...l, registerTarget: 'casual' as const } : l));
    const regs = registerTargets(lines, 'polite');
    expect(regs.slice(0, 2)).toEqual(['polite', 'polite']);
    expect(regs.slice(2).every((r) => r === 'casual')).toBe(true);
    expect(registerTargets(DIALOGUE.lines, 'honorific').every((r) => r === 'honorific')).toBe(true);
  });

  it('turnPlan marks roles, the content aizuchi slots on NPC lines only, and the register per line', () => {
    const plan = turnPlan(DIALOGUE, 'ハナ', 'polite');
    expect(plan.map((t) => t.role)).toEqual(['npc', 'learner', 'npc', 'learner', 'npc', 'learner', 'npc', 'learner', 'npc', 'learner', 'npc', 'learner']);
    expect(plan.filter((t) => t.slot).map((t) => t.lineIndex)).toEqual([4, 10]);
    expect(plan.every((t) => t.register === 'polite')).toBe(true);
    // playing Ken instead: Hana's lines become NPC lines; her lines carry no content slots
    const asKen = turnPlan(DIALOGUE, 'ケン', 'polite');
    expect(asKen.filter((t) => t.role === 'learner').map((t) => t.lineIndex)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(asKen.some((t) => t.slot)).toBe(false);
  });

  it('outcomeFromOption maps option kinds to best / ok / wrong with the register verdict', () => {
    const gold = toPlain(L(5).ja);
    expect(outcomeFromOption(5, { text: gold, kind: 'best', recast: gold }, gold, 10)).toMatchObject({ kind: 'best', registerOk: true, tags: [], ms: 10 });
    expect(outcomeFromOption(5, { text: 'はい、食べます。', kind: 'ok', recast: gold }, gold, 10)).toMatchObject({ kind: 'ok', registerOk: true });
    expect(outcomeFromOption(5, { text: 'うん、食べる。', kind: 'register-wrong', recast: gold }, gold, 10)).toMatchObject({ kind: 'wrong', registerOk: false, tags: ['register'] });
    expect(outcomeFromOption(9, { text: '犬を水は飲みますか。', kind: 'grammar-wrong', recast: gold }, toPlain(L(9).ja), 10)).toMatchObject({ kind: 'wrong', tags: ['word-order'] });
  });

  it('outcomeFromTyped: verbatim is best, a near miss is near, a casual fragment is wrong, a hint caps best at ok', () => {
    expect(outcomeFromTyped(1, 'おはようけん', L(1), 'polite', 5)).toMatchObject({ kind: 'best', registerOk: true });
    expect(outcomeFromTyped(1, 'おはようけん', L(1), 'polite', 5, true)).toMatchObject({ kind: 'ok', hintUsed: true });
    expect(outcomeFromTyped(1, 'おはようございますけん', L(1), 'polite', 5)).toMatchObject({ kind: 'best' }); // accept[]
    expect(outcomeFromTyped(3, 'はいのみまっす', L(3), 'polite', 5)).toMatchObject({ kind: 'near', tags: ['small-kana'] });
    expect(outcomeFromTyped(3, 'うんのむ', L(3), 'polite', 5)).toMatchObject({ kind: 'wrong', registerOk: false, tags: ['word-choice', 'register'] });
  });

  it('kana-aware grading: kana for a kanji-written accept surface or mustInclude word is still the word', () => {
    expect(tokenReadings(L(5)).get('食べます')).toBe('たべます');
    expect(tokenReadings(L(5)).get('私')).toBe('わたし');
    expect(tokenReadings(L(1)).size).toBe(0);
    expect(kanaVariant('私も食べます。', tokenReadings(L(5)))).toBe('わたしもたべます。');
    expect(gradeTypedKanaAware('わたしもたべます', L(5), 'polite').best).toBe(true);
    expect(outcomeFromTyped(5, 'わたしもたべます', L(5), 'polite', 5)).toMatchObject({ kind: 'best' });
    expect(outcomeFromTyped(5, 'はい、ぱんをたべます', L(5), 'polite', 5)).toMatchObject({ kind: 'ok', tags: [] });
    expect(outcomeFromTyped(5, 'はい、ぱんをたべます', L(5), 'casual', 5)).toMatchObject({ kind: 'wrong', tags: ['register'] });
    // a line without kanji grades exactly like gradeTyped
    expect(gradeTypedKanaAware('おはようけん', L(1), 'polite').best).toBe(true);
  });

  it('outcomeFromBuild: the gold order is best, any other order is word-order', () => {
    expect(outcomeFromBuild(1, ['おはよう', 'ケン'], L(1), 3)).toMatchObject({ kind: 'best', given: 'おはようケン' });
    expect(outcomeFromBuild(1, ['ケン', 'おはよう'], L(1), 3)).toMatchObject({ kind: 'wrong', tags: ['word-order'], recast: 'おはよう、ケン。' });
  });

  it('summarize counts best lines, aizuchi hits and the register verdict', () => {
    const r = summarize(
      [
        outcomeFromOption(1, { text: 'a', kind: 'best', recast: 'a' }, 'a', 1),
        outcomeFromOption(3, { text: 'b', kind: 'register-wrong', recast: 'a' }, 'a', 1),
      ],
      [
        { lineIndex: 4, score: { hit: true, tag: false, late: false, registerOk: true }, text: 'はい', ms: 400 },
        { lineIndex: 10, score: { hit: false, tag: true, late: false, registerOk: false }, text: null, ms: null },
      ],
    );
    expect(r).toEqual({ best: 1, total: 2, aizuchiHit: 1, aizuchiTotal: 2, registerOk: false });
    expect(summarize([], [])).toEqual({ best: 0, total: 0, aizuchiHit: 0, aizuchiTotal: 0, registerOk: true });
  });
});
