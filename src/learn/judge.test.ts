import type { GrammarItem, KanjiItem, VocabItem } from '../content/types';
import { toPlain } from '../content/ruby';
import { mulberry32 } from '../shared/hash';
import { normalizeEn } from '../shared/jp';
import {
  HONESTY_WINDOW,
  honestyRate,
  judgeOptions,
  judgeRate,
  patternCore,
  perceptionJudge,
  pushHonesty,
  rubricJudge,
  rubricPasses,
  shouldJudge,
} from './judge';

function vocab(id: string, word: string, kana: string, meaning: string, pos: VocabItem['pos'] = 'n', extra: Partial<VocabItem> = {}): VocabItem {
  return { id, word, kana, meanings: [meaning], pos, jlpt: 5, tags: [], examples: [], ...extra };
}
function kanji(char: string, meaning: string, components: string[], jlpt: KanjiItem['jlpt'] = 5, extra: Partial<KanjiItem> = {}): KanjiItem {
  return { id: `j-${char}`, char, meanings: [meaning], on: [], kun: [], strokes: 5, jlpt, components, mnemonic: '', examples: [], ...extra };
}
function grammar(id: string, pattern: string, meaning: string, hints: string[], extra: Partial<GrammarItem> = {}): GrammarItem {
  return { id, pattern, meaning, formation: [], explanation: '', jlpt: 5, register: 'neutral', examples: [], clozeHints: hints, mistakes: [], related: [], tags: [], ...extra };
}

describe('judgeRate', () => {
  it('25 at ≥ 95 %, 50 at 90–95, 100 below 90 and for the first 20 checks', () => {
    expect(judgeRate(0.95, 20)).toBe(25);
    expect(judgeRate(1, 200)).toBe(25);
    expect(judgeRate(0.949, 20)).toBe(50);
    expect(judgeRate(0.9, 20)).toBe(50);
    expect(judgeRate(0.899, 20)).toBe(100);
    expect(judgeRate(1, 19)).toBe(100);
    expect(judgeRate(null, 100)).toBe(100);
  });
  it('tolerates percentages', () => {
    expect(judgeRate(96, 50)).toBe(25);
    expect(judgeRate(92, 50)).toBe(50);
  });
});

describe('shouldJudge', () => {
  it.each([25, 50, 100] as const)('samples %i %% within ±1 %% over 10,000 keys', (rate) => {
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (shouldJudge('seed-abc', `v-n5-${String(i).padStart(4, '0')}#rec`, i % 7, rate)) hits++;
    expect(Math.abs(hits / 10_000 - rate / 100)).toBeLessThanOrEqual(0.01);
  });
  it('is deterministic and depends on seed, key and reps', () => {
    const a = shouldJudge('s', 'v-n5-0001#rec', 3, 50);
    expect(shouldJudge('s', 'v-n5-0001#rec', 3, 50)).toBe(a);
    const seq = Array.from({ length: 40 }, (_, i) => shouldJudge('s', 'v-n5-0001#rec', i, 50));
    expect(new Set(seq).size).toBe(2);
    const seeds = Array.from({ length: 40 }, (_, i) => shouldJudge(`s${i}`, 'v-n5-0001#rec', 1, 50));
    expect(new Set(seeds).size).toBe(2);
  });
  it('100 % always judges', () => {
    for (let i = 0; i < 100; i++) expect(shouldJudge('x', `g-n5-${i}#cloze`, i, 100)).toBe(true);
  });
});

describe('honesty bookkeeping', () => {
  it('honestyRate', () => {
    expect(honestyRate(0, 0)).toBeNull();
    expect(honestyRate(19, 20)).toBeCloseTo(0.95);
    expect(honestyRate(30, 20)).toBe(1);
  });
  it('pushHonesty keeps the last 200', () => {
    let w: boolean[] = [];
    for (let i = 0; i < 250; i++) w = pushHonesty(w, i % 2 === 0);
    expect(w).toHaveLength(HONESTY_WINDOW);
    expect(w[w.length - 1]).toBe(false);
  });
});

describe('judgeOptions — 4-option meaning Judge', () => {
  const pool: VocabItem[] = [
    vocab('v-n5-0001', '食べる', 'たべる', 'to eat', 'v1', { confusables: ['v-n5-0002'], station: 4 }),
    vocab('v-n5-0002', '飲む', 'のむ', 'to drink', 'v5', { station: 4 }),
    vocab('v-n5-0003', '見る', 'みる', 'to see', 'v1', { station: 4 }),
    vocab('v-n5-0004', '寝る', 'ねる', 'to sleep', 'v1', { station: 5 }),
    vocab('v-n5-0005', '起きる', 'おきる', 'to wake up', 'v1', { station: 5 }),
    vocab('v-n5-0006', '水', 'みず', 'water', 'n', { station: 4 }),
    vocab('v-n5-0007', '食事', 'しょくじ', 'a meal (to eat)', 'n', { station: 4 }),
    vocab('v-n5-0008', '餌', 'えさ', 'eat', 'n', { station: 9 }),
  ];
  it('includes the confusable and two same-POS distractors, all distinct and never the answer', () => {
    for (let seed = 0; seed < 25; seed++) {
      const o = judgeOptions(pool[0]!, pool, mulberry32(seed));
      expect(o.correct).toBe('to eat');
      expect(o.distractors).toContain('to drink');
      expect(new Set(o.distractors.map(normalizeEn)).size).toBe(3);
      for (const d of o.distractors) expect(normalizeEn(d)).not.toBe(normalizeEn('to eat'));
      // "eat" normalizes to the answer ("to" stripped) and must never appear
      expect(o.distractors).not.toContain('eat');
      // same-POS preferred: the two others are v1 verbs
      const others = o.distractors.filter((d) => d !== 'to drink');
      for (const d of others) expect(['to see', 'to sleep', 'to wake up']).toContain(d);
    }
  });
  it('is deterministic for a seed', () => {
    expect(judgeOptions(pool[0]!, pool, mulberry32(3))).toEqual(judgeOptions(pool[0]!, pool, mulberry32(3)));
  });
  it('pads from fallbacks when the pool is tiny', () => {
    const o = judgeOptions(pool[0]!, [pool[0]!], mulberry32(1));
    expect(o.distractors).toHaveLength(3);
    expect(new Set(o.distractors).size).toBe(3);
  });
  it('kanji: look-alike first, then same-level', () => {
    const k = [
      kanji('未', 'not yet', ['tree'], 4, { lookalikes: ['j-末'] }),
      kanji('末', 'end', ['tree'], 4),
      kanji('木', 'tree', ['tree'], 5),
      kanji('本', 'book', ['tree'], 5),
      kanji('日', 'sun', ['sun'], 4),
      kanji('月', 'moon', ['moon'], 4),
    ];
    const o = judgeOptions(k[0]!, k, mulberry32(9));
    expect(o.correct).toBe('not yet');
    expect(o.distractors).toContain('end');
    expect(new Set(o.distractors).size).toBe(3);
    expect(o.distractors).not.toContain('not yet');
  });
  it('never uses a secondary meaning of the item as a distractor (vocab and kanji)', () => {
    const v = [
      vocab('v-n1-0001', '因果', 'いんが', 'cause and effect', 'n', { meanings: ['cause and effect', 'karma'], station: 40 }),
      vocab('v-n1-0002', '業', 'ごう', 'karma', 'n', { station: 40 }),
      vocab('v-n1-0003', '山', 'やま', 'mountain', 'n', { station: 40 }),
      vocab('v-n1-0004', '川', 'かわ', 'river', 'n', { station: 40 }),
      vocab('v-n1-0005', '海', 'うみ', 'sea', 'n', { station: 40 }),
    ];
    for (let seed = 0; seed < 25; seed++) {
      const o = judgeOptions(v[0]!, v, mulberry32(seed));
      expect(o.correct).toBe('cause and effect');
      expect(o.distractors).not.toContain('karma');
      expect(new Set(o.distractors.map(normalizeEn)).size).toBe(3);
    }
    const k = [
      kanji('日', 'sun', ['sun'], 5, { meanings: ['sun', 'day'] }),
      kanji('曜', 'day', ['sun'], 4, { meanings: ['day of the week', 'day'] }),
      kanji('月', 'moon', ['moon'], 5),
      kanji('木', 'tree', ['tree'], 5),
      kanji('火', 'fire', ['fire'], 5),
      kanji('水', 'water', ['water'], 5),
    ];
    for (let seed = 0; seed < 25; seed++) {
      const o = judgeOptions(k[0]!, k, mulberry32(seed));
      expect(o.correct).toBe('sun');
      expect(o.distractors).not.toContain('day');
      expect(o.distractors).not.toContain('day of the week');
      expect(new Set(o.distractors.map(normalizeEn)).size).toBe(3);
    }
  });
  it('grammar: related point first', () => {
    const g = [
      grammar('g-n5-001', '〜てください', 'please do …', ['てください'], { related: ['g-n5-002'] }),
      grammar('g-n5-002', '〜ないでください', 'please do not …', ['ないでください']),
      grammar('g-n5-003', '〜ましょう', 'let’s …', ['ましょう']),
      grammar('g-n5-004', '〜たい', 'want to …', ['たい']),
      grammar('g-n5-005', '〜から', 'because …', ['から']),
    ];
    const o = judgeOptions(g[0]!, g, mulberry32(2));
    expect(o.correct).toBe('please do …');
    expect(o.distractors).toContain('please do not …');
    expect(new Set(o.distractors).size).toBe(3);
  });
});

describe('rubricJudge', () => {
  const g = grammar(
    'g-n4-010',
    'Vた + ことがある',
    'have done … before',
    ['たことがある', 'たことがあります'],
    {
      examples: [
        { ja: '{日本|にほん}へ{行|い}ったことがあります。', kana: 'にほんへいったことがあります。', en: 'I have been to Japan.' },
        { ja: '{寿司|すし}を{食|た}べたことがある。', kana: 'すしをたべたことがある。', en: 'I have eaten sushi.' },
      ],
    },
  );
  it('regex matches every clozeHint and every example', () => {
    const { rubric, regex } = rubricJudge(g);
    expect(rubric).toContain('Vた + ことがある');
    const re = new RegExp(regex, 'u');
    for (const h of g.clozeHints) expect(re.test(h)).toBe(true);
    for (const ex of g.examples) expect(re.test(toPlain(ex.ja))).toBe(true);
    expect(rubricPasses(regex, '{寿司|すし}を{食|た}べたことがある。')).toBe(true);
    expect(rubricPasses(regex, '寿司を食べました。')).toBe(false);
  });
  it('escapes regex metacharacters and survives a pattern-only point', () => {
    const p = grammar('g-n5-099', 'N (は) N です', 'is', []);
    const { regex } = rubricJudge(p);
    expect(() => new RegExp(regex, 'u')).not.toThrow();
    expect(rubricPasses('(', 'anything')).toBe(false);
  });
  it('patternCore strips 〜 and slot letters', () => {
    expect(patternCore('〜てください')).toBe('てください');
    expect(patternCore('Vた + ことがある')).toBe('ことがある');
    expect(patternCore('NはNです')).toBe('です');
  });
});

describe('perceptionJudge', () => {
  it('picks the nearest kana neighbour from the pool', () => {
    const w = vocab('v-n5-0010', '来て', 'きて', 'come (te)');
    const pool = [w, vocab('v-n5-0011', '切手', 'きって', 'stamp'), vocab('v-n5-0012', '机', 'つくえ', 'desk')];
    expect(perceptionJudge(w, pool)).toEqual({ minimalPair: ['きて', 'きって'] });
  });
  it('synthesizes a pair when the pool has none', () => {
    const w = vocab('v-n5-0020', 'おばさん', 'おばさん', 'aunt');
    const [a, b] = perceptionJudge(w, [w]).minimalPair;
    expect(a).toBe('おばさん');
    expect(b).not.toBe('おばさん');
    expect(b.length).toBeGreaterThan(0);
  });
});
