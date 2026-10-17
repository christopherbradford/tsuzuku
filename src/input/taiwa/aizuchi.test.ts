import { DIALOGUE, STORY } from '../../content/fixtures';
import type { Belt, StoryLine } from '../../content/types';
import {
  AIZUCHI,
  AIZUCHI_WINDOW_MS,
  aizuchiChips,
  aizuchiRegisterOf,
  aizuchiSlots,
  hasHeuristicPause,
  isAizuchi,
  scoreSlot,
  tagsFrom,
  windowMs,
} from './aizuchi';

const line = (ja: string, speaker: string, extra: Partial<StoryLine> = {}): StoryLine => ({ ja, kana: ja, en: '', tokens: [ja], speaker, ...extra });

describe('aizuchiSlots', () => {
  it('content marks win: the fixture dialogue has two marked NPC lines', () => {
    const slots = aizuchiSlots(DIALOGUE.lines, DIALOGUE.learnerSpeaker);
    expect(slots).toEqual([
      { lineIndex: 4, fromContent: true },
      { lineIndex: 10, fromContent: true },
    ]);
  });

  it('with marks present, a long NPC line with 、 is NOT inferred', () => {
    const lines = [
      line('あのう、すみません、ちょっとお聞きしたいことがあるのですが、いいですか。', 'ケン'),
      line('はい。', 'ハナ'),
      line('コーヒーを飲みますか。', 'ケン', { aizuchiSlot: true }),
    ];
    expect(aizuchiSlots(lines, 'ハナ')).toEqual([{ lineIndex: 2, fromContent: true }]);
  });

  it('heuristic only when no marks: 、 after ≥ 12 chars on NPC lines', () => {
    const lines = [
      line('おはよう、ケン。', 'ハナ'), // learner
      line('きのうはずっと雨でしたけれど、きょうは晴れましたね。', 'ケン'), // 、 after 14 chars
      line('はい、そうですね。', 'ハナ'),
      line('コーヒーを飲みますか。', 'ケン'), // no 、
      line('あ、はい。', 'ケン'), // 、 after 1 char
    ];
    expect(aizuchiSlots(lines, 'ハナ')).toEqual([{ lineIndex: 1, fromContent: false }]);
  });

  it('the learner line never becomes a slot, even when marked by mistake', () => {
    const lines = [line('きのうはずっと雨でしたけれど、きょうは晴れましたね。', 'ハナ', { aizuchiSlot: true }), line('そうですね。', 'ケン')];
    expect(aizuchiSlots(lines, 'ハナ')).toEqual([]);
  });

  it('without a learnerSpeaker every line counts as NPC', () => {
    const lines = [line('きのうはずっと雨でしたけれど、きょうは晴れましたね。', 'A')];
    expect(aizuchiSlots(lines)).toEqual([{ lineIndex: 0, fromContent: false }]);
  });

  it('a story (no dialogue marks, short lines) yields no slots', () => {
    expect(aizuchiSlots(STORY.lines)).toEqual([]);
  });

  it('hasHeuristicPause counts plain characters, ruby stripped, ignoring punctuation', () => {
    expect(hasHeuristicPause(line('{私|わたし}はきのうずっと{雨|あめ}でしたけれど、きょうは{晴|は}れました。', 'A'))).toBe(true);
    expect(hasHeuristicPause(line('はい、そうです。', 'A'))).toBe(false);
    expect(hasHeuristicPause(line('あいうえおかきくけこさ、し。', 'A'))).toBe(false); // 11 chars before 、
    expect(hasHeuristicPause(line('あいうえおかきくけこさし、す。', 'A'))).toBe(true); // 12 chars before 、
  });
});

describe('windowMs / tagsFrom', () => {
  it.each([
    ['white', 2500],
    ['yellow', 2500],
    ['orange', 2500],
    ['green', 1800],
    ['blue', 1200],
    ['purple', 1200],
    ['brown', 1200],
    ['black', 1200],
  ] as [Belt, number][])('%s → %i ms', (belt, ms) => {
    expect(windowMs(belt)).toBe(ms);
  });

  it('tags only from Green', () => {
    expect(tagsFrom('white')).toBe(false);
    expect(tagsFrom('yellow')).toBe(false);
    expect(tagsFrom('orange')).toBe(false);
    expect(tagsFrom('green')).toBe(true);
    expect(tagsFrom('blue')).toBe(true);
    expect(tagsFrom('black')).toBe(true);
    expect(AIZUCHI_WINDOW_MS).toEqual({ early: 2500, green: 1800, blue: 1200 });
  });
});

describe('set membership', () => {
  it('the design sets are present', () => {
    for (const a of ['はい', 'ええ', 'そうですね', 'へえ', 'なるほど']) expect(AIZUCHI.polite).toContain(a);
    for (const a of ['うん', 'へー']) expect(AIZUCHI.casual).toContain(a);
  });

  it('isAizuchi folds punctuation, width and katakana', () => {
    expect(isAizuchi('はい。', 'polite')).toBe(true);
    expect(isAizuchi('そうですね！', 'polite')).toBe(true);
    expect(isAizuchi('ハイ', 'polite')).toBe(true);
    expect(isAizuchi('へえ', 'polite')).toBe(true);
    expect(isAizuchi('へー', 'casual')).toBe(true);
    expect(isAizuchi('うん', 'polite')).toBe(false);
    expect(isAizuchi('うん', 'casual')).toBe(true);
    expect(isAizuchi('うん')).toBe(true);
    expect(isAizuchi('コーヒー')).toBe(false);
    expect(isAizuchi('')).toBe(false);
    expect(isAizuchi('。')).toBe(false);
  });

  it('aizuchiRegisterOf maps story registers', () => {
    expect(aizuchiRegisterOf({ register: 'polite' })).toBe('polite');
    expect(aizuchiRegisterOf({ register: 'neutral' })).toBe('polite');
    expect(aizuchiRegisterOf({ register: 'casual' })).toBe('casual');
    expect(aizuchiRegisterOf({ register: 'slang' })).toBe('casual');
    expect(aizuchiRegisterOf(DIALOGUE)).toBe('polite');
  });

  it('aizuchiChips offers the register set first', () => {
    expect(aizuchiChips('polite')).toEqual(['はい', 'ええ', 'そうですね', 'へえ']);
    expect(aizuchiChips('casual', 2)).toEqual(['うん', 'へー']);
    expect(aizuchiChips('casual', 0).length).toBe(1);
  });
});

describe('scoreSlot', () => {
  it('a backchannel inside the window is a hit, never tagged', () => {
    expect(scoreSlot(1000, 'はい', 'polite', 'yellow')).toEqual({ hit: true, tag: false, late: false, registerOk: true });
    expect(scoreSlot(2500, null, 'polite', 'orange')).toEqual({ hit: true, tag: false, late: false, registerOk: true });
    expect(scoreSlot(1800, 'ええ', 'polite', 'green').hit).toBe(true);
    expect(scoreSlot(1200, 'うん', 'casual', 'blue').hit).toBe(true);
  });

  it('no tag before Green: a miss at Yellow–Orange is feedback only', () => {
    expect(scoreSlot(null, null, 'polite', 'yellow')).toEqual({ hit: false, tag: false, late: false, registerOk: false });
    expect(scoreSlot(4000, 'はい', 'polite', 'orange')).toEqual({ hit: false, tag: false, late: true, registerOk: false });
    expect(scoreSlot(null, null, 'polite', 'white').tag).toBe(false);
  });

  it('from Green a miss or a late answer is tagged', () => {
    expect(scoreSlot(null, null, 'polite', 'green')).toEqual({ hit: false, tag: true, late: false, registerOk: false });
    expect(scoreSlot(1801, 'はい', 'polite', 'green')).toEqual({ hit: false, tag: true, late: true, registerOk: false });
    expect(scoreSlot(1201, 'はい', 'polite', 'blue').tag).toBe(true);
    expect(scoreSlot(1200, 'はい', 'polite', 'blue').tag).toBe(false);
  });

  it('a wrong word in time is not a backchannel (miss); a cross-register backchannel is a hit but off-register', () => {
    expect(scoreSlot(500, 'コーヒー', 'polite', 'green')).toEqual({ hit: false, tag: true, late: false, registerOk: false });
    expect(scoreSlot(500, 'うん', 'polite', 'green')).toEqual({ hit: true, tag: false, late: false, registerOk: false });
    expect(scoreSlot(500, 'なるほど', 'casual', 'green').registerOk).toBe(true);
  });

  it('nonsense timings are misses', () => {
    expect(scoreSlot(-1, 'はい', 'polite', 'green').hit).toBe(false);
    expect(scoreSlot(Number.NaN, 'はい', 'polite', 'green').hit).toBe(false);
    expect(scoreSlot(Number.POSITIVE_INFINITY, 'はい', 'polite', 'green').hit).toBe(false);
  });
});
