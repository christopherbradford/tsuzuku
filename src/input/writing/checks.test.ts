import { GRAMMAR, VOCAB, V } from '../../content/fixtures';
import type { GrammarItem, VocabItem } from '../../content/types';
import {
  BAD_PARTICLE_PAIRS,
  SENTENCE_RANGE_BY_BELT,
  checkWriting,
  conjugationFindings,
  exportText,
  hintVariants,
  kanaOnlyGreenWords,
  particleFindings,
  patternPresent,
  rubricItems,
  sentenceCount,
  sentencesOf,
} from './checks';

const byId = (id: string) => GRAMMAR.find((g) => g.id === id) as GrammarItem;
const DESU = byId('g-n5-001'); // clozeHints ['です']
const WA = byId('g-n5-002'); // clozeHints ['は']
const MASU = byId('g-n5-003');
const vocab = (id: string) => VOCAB.find((v) => v.id === id) as VocabItem;
const GREEN = [vocab(V.飲む), vocab(V.食べる), vocab(V.水), vocab(V.コーヒー), vocab(V.おいしい)];

const TEKUDASAI: GrammarItem = { ...DESU, id: 'g-n5-010', pattern: '〜てください', meaning: 'please do', clozeHints: ['てください'], examples: [], register: 'polite' };

describe('sentences', () => {
  it('splits at 。！？ and line breaks, strips ruby and width', () => {
    expect(sentencesOf('{私|わたし}はハナです。コーヒーを飲みます！\n犬がいますか？')).toEqual(['私はハナです', 'コーヒーを飲みます', '犬がいますか']);
    expect(sentenceCount('')).toBe(0);
    expect(sentenceCount('。。。')).toBe(0);
    expect(sentenceCount('一文だけ')).toBe(1);
    expect(sentenceCount('ＡＢＣ？ はい。')).toBe(2);
  });
});

describe('patternPresent', () => {
  it('detects a clozeHints substring in plain text (ruby stripped)', () => {
    expect(patternPresent('{私|わたし}はハナです。', DESU)).toBe(true);
    expect(patternPresent('私はハナだ。', DESU)).toBe(false);
    expect(patternPresent('コーヒーを飲みます。', MASU)).toBe(true);
    expect(patternPresent('コーヒーを飲む。', MASU)).toBe(false);
    expect(patternPresent('水を飲んでください。', TEKUDASAI)).toBe(true); // voiced て-form variant
    expect(patternPresent('ここで待ってください。', TEKUDASAI)).toBe(true);
    expect(patternPresent('水を飲んで。', TEKUDASAI)).toBe(false);
    expect(hintVariants('てください')).toEqual(['てください', 'でください']);
    expect(hintVariants('たことがある')).toEqual(['たことがある', 'だことがある']);
    expect(hintVariants('です')).toEqual(['です']);
  });

  it('falls back to the rubric regex (pattern core) when clozeHints miss', () => {
    const koto: GrammarItem = { ...DESU, id: 'g-n4-001', pattern: 'Vた + ことがある', clozeHints: ['xyz-never'], examples: [] };
    expect(patternPresent('日本に行ったことがある。', koto)).toBe(true);
    expect(patternPresent('日本に行った。', koto)).toBe(false);
  });

  it('rubricItems carries one rubric per pattern', () => {
    const items = rubricItems([DESU, MASU]);
    expect(items.map((i) => i.id)).toEqual(['g-n5-001', 'g-n5-003']);
    expect(items[0]?.rubric).toContain('〜です');
    expect(new RegExp(items[0]?.regex ?? '', 'u').test('はい、水です')).toBe(true);
  });
});

describe('kanaOnlyGreenWords', () => {
  it('flags Green words written in kana only; kanji or kanji-stem use clears them', () => {
    expect(kanaOnlyGreenWords('まいにちみずをのみます。', GREEN)).toEqual(['飲む', '水']);
    expect(kanaOnlyGreenWords('毎日みずを飲みます。', GREEN)).toEqual(['水']);
    expect(kanaOnlyGreenWords('毎日水を飲みます。', GREEN)).toEqual([]);
    expect(kanaOnlyGreenWords('パンをたべました。', GREEN)).toEqual(['食べる']);
    expect(kanaOnlyGreenWords('パンを食べました。', GREEN)).toEqual([]);
  });

  it('never flags loanwords, usually-kana words, or words absent from the text', () => {
    expect(kanaOnlyGreenWords('コーヒーはおいしいです。', GREEN)).toEqual([]);
    expect(kanaOnlyGreenWords('こーひーはおいしいです。', GREEN)).toEqual([]);
    expect(kanaOnlyGreenWords('犬がいます。', GREEN)).toEqual([]);
    expect(kanaOnlyGreenWords('', GREEN)).toEqual([]);
  });

  it('a katakana spelling of the reading counts as kana-only too', () => {
    expect(kanaOnlyGreenWords('ミズをのむ。', GREEN)).toEqual(['飲む', '水']);
  });

  it('boundaries: みずうみ never flags 水, のみます never flags 見る, する／来る verbs are skipped', () => {
    const miru: VocabItem = { ...vocab(V.食べる), id: 'v-n5-0100', word: '見る', kana: 'みる', pos: 'v1' };
    const kuru: VocabItem = { ...vocab(V.食べる), id: 'v-n5-0101', word: '来る', kana: 'くる', pos: 'v-irr' };
    expect(kanaOnlyGreenWords('みずうみへ行きます。', GREEN)).toEqual([]);
    expect(kanaOnlyGreenWords('コーヒーをのみます。', [miru])).toEqual([]);
    expect(kanaOnlyGreenWords('テレビをみます。', [miru])).toEqual(['見る']);
    expect(kanaOnlyGreenWords('できますか。', [kuru])).toEqual([]);
    expect(kanaOnlyGreenWords('水をのんでください。', GREEN)).toEqual(['飲む']);
  });
});

describe('particleFindings', () => {
  it('flags doubled and clashing particle pairs with their sentence index', () => {
    const f = particleFindings('水をを飲みます。犬がを見ます。');
    expect(f.map((x) => [x.detail, x.sentence])).toEqual([
      ['をを', 0],
      ['がを', 1],
    ]);
    for (const x of f) {
      expect(x.code).toBe('particle');
      expect(x.tag).toBe('particle');
    }
  });

  it('flags a dangling object particle and leaves valid pairs alone', () => {
    expect(particleFindings('水を。').map((x) => x.detail)).toEqual(['を$']);
    expect(particleFindings('駅へ。').map((x) => x.detail)).toEqual(['へ$']);
    expect(particleFindings('ここには犬がいます。学校では勉強します。友だちとは話しました。日本へは行きません。')).toEqual([]);
    expect(particleFindings('私はハナです。')).toEqual([]);
    expect(BAD_PARTICLE_PAIRS).toContain('をが');
    expect(BAD_PARTICLE_PAIRS).not.toContain('には');
  });
});

describe('conjugationFindings', () => {
  it('finds dictionary form + ます for known verbs and offers the engine fix', () => {
    const f = conjugationFindings('毎日水を飲むます。パンを食べるました。', GREEN);
    expect(f).toEqual([
      { code: 'conjugation', tag: 'conjugation', detail: '飲むます', fix: '飲みます' },
      { code: 'conjugation', tag: 'conjugation', detail: '食べるました', fix: '食べました' },
    ]);
  });

  it('kana spellings get kana fixes; correct forms produce nothing', () => {
    expect(conjugationFindings('みずをのむます。', GREEN)).toEqual([{ code: 'conjugation', tag: 'conjugation', detail: 'のむます', fix: 'のみます' }]);
    expect(conjugationFindings('水を飲みます。パンを食べました。', GREEN)).toEqual([]);
    expect(conjugationFindings('水を飲む。', [])).toEqual([]);
  });
});

describe('checkWriting', () => {
  const base = { patterns: [DESU, MASU], register: 'polite' as const, greenWords: GREEN };

  it('counts pattern hits, confirms register, no findings on a clean polite text', () => {
    const r = checkWriting('{私|わたし}はハナです。毎朝コーヒーを飲みます。パンも食べます。', { ...base, belt: 'green' });
    expect(r.patternsHit).toBe(2);
    expect(r.patternsTotal).toBe(2);
    expect(r.patternsMissing).toEqual([]);
    expect(r.registerOk).toBe(true);
    expect(r.sentenceRegisters).toEqual(['polite', 'polite', 'polite']);
    expect(r.kanaOnlyGreen).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.sentences).toBe(3);
    expect(r.chars).toBe('私はハナです'.length + '毎朝コーヒーを飲みます'.length + 'パンも食べます'.length);
  });

  it('reports a missing pattern, a kana-only Green word and a casual sentence', () => {
    const r = checkWriting('私はハナだ。毎朝コーヒーをのみます。', base);
    expect(r.patternsHit).toBe(1); // ます present, です missing
    expect(r.patternsMissing).toEqual(['g-n5-001']);
    expect(r.registerOk).toBe(false);
    expect(r.sentenceRegisters).toEqual(['casual', 'polite']);
    expect(r.kanaOnlyGreen).toEqual(['飲む']);
    expect(r.warnings).toEqual(['pattern-missing:g-n5-001', 'register:私はハナだ', 'kana-only-green:飲む']);
    const reg = r.findings.find((f) => f.code === 'register');
    expect(reg?.tag).toBe('register');
    expect(reg?.sentence).toBe(0);
  });

  it('particle and conjugation findings carry ERROR_TAGS and fixes', () => {
    const r = checkWriting('水をを飲むます。', { ...base, patterns: [] });
    expect(r.warnings).toEqual(['particle:をを', 'conjugation:飲むます']);
    expect(r.findings.map((f) => f.tag)).toEqual(['particle', 'conjugation']);
    expect(r.findings[1]?.fix).toBe('飲みます');
  });

  it('length is checked against the belt range or an explicit range', () => {
    const three = '水です。水です。水です。';
    expect(checkWriting(three, { ...base, patterns: [], belt: 'green' }).warnings).toEqual([]);
    expect(checkWriting(three, { ...base, patterns: [], belt: 'blue' }).warnings).toEqual(['length-short:3/5']);
    expect(checkWriting(three.repeat(5), { ...base, patterns: [], belt: 'black' }).warnings).toEqual(['length-long:15/12']);
    expect(checkWriting(three, { ...base, patterns: [], range: [1, 2] }).warnings).toEqual(['length-long:3/2']);
    expect(checkWriting(three, { ...base, patterns: [] }).warnings).toEqual([]); // no range → no length check
    expect(SENTENCE_RANGE_BY_BELT.green).toEqual([3, 5]);
    expect(SENTENCE_RANGE_BY_BELT.black).toEqual([10, 12]);
  });

  it('empty text: every pattern missing, an empty finding, register trivially ok', () => {
    const r = checkWriting('   ', base);
    expect(r.sentences).toBe(0);
    expect(r.patternsHit).toBe(0);
    expect(r.patternsMissing).toEqual(['g-n5-001', 'g-n5-003']);
    expect(r.registerOk).toBe(true);
    expect(r.warnings).toContain('empty');
  });

  it('a keigo target accepts keigo and flags plain polite', () => {
    const r = checkWriting('少々お待ちください。コーヒーをいただきます。', { ...base, patterns: [], register: 'honorific' });
    expect(r.registerOk).toBe(true);
    const r2 = checkWriting('少々お待ちください。コーヒーを飲みます。', { ...base, patterns: [], register: 'honorific' });
    expect(r2.registerOk).toBe(false);
    expect(r2.warnings).toEqual(['register:コーヒーを飲みます']);
  });

  it('a casual target accepts plain and flags です・ます', () => {
    const r = checkWriting('今日は雨だ。家にいる。', { ...base, patterns: [], register: 'casual' });
    expect(r.registerOk).toBe(true);
    expect(checkWriting('今日は雨です。', { ...base, patterns: [], register: 'casual' }).registerOk).toBe(false);
  });

  it('neutral target only rejects mixed sentences', () => {
    expect(checkWriting('今日は雨だ。明日は晴れです。', { ...base, patterns: [], register: 'neutral' }).registerOk).toBe(true);
    expect(checkWriting('うん、行きます。', { ...base, patterns: [], register: 'neutral' }).registerOk).toBe(false);
  });

  it('は pattern is found through the particle', () => {
    expect(checkWriting('私はハナです。', { ...base, patterns: [WA] }).patternsHit).toBe(1);
    expect(checkWriting('ハナです。', { ...base, patterns: [WA] }).patternsHit).toBe(0);
  });
});

describe('exportText', () => {
  it('returns the plain text plus labelled prompt, patterns and register lines', () => {
    const out = exportText('{私|わたし}はハナです。\nコーヒーを飲みます。', {
      prompt: 'Introduce yourself.',
      patterns: [DESU, MASU],
      register: 'polite',
      labels: { prompt: 'お題', patterns: '文型', register: '文体' },
    });
    expect(out).toBe('私はハナです。\nコーヒーを飲みます。\n\nお題: Introduce yourself.\n文型: 〜です / 〜ます\n文体: polite');
  });

  it('with no extras it is just the trimmed plain text', () => {
    expect(exportText('  はい。 ')).toBe('はい。');
    expect(exportText('はい。', { patterns: [] })).toBe('はい。');
  });
});
