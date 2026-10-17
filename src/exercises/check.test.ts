import { createFakeLoader, V } from '@/content/fixtures';
import type { VocabItem } from '@/content/types';
import {
  acceptForms,
  attempt,
  checkJa,
  checkReading,
  gradeChoice,
  gradeCloze,
  gradeEn,
  gradeOrdering,
  gradePitch,
  gradeScored,
  gradeSlots,
  gradeTyped,
  guardResult,
  kanaOnlyPolicyFor,
  moraScore,
  particleSlip,
  scriptMismatch,
  timeoutResult,
  voicingSlip,
  whyFor,
} from './check';
import { S } from './strings';

const good = (accept: string[], extra: Partial<Parameters<typeof checkJa>[1]> = {}) =>
  ({ accept, kanaOnlyPolicy: 'good', ...extra }) as const;

describe('checkJa — acceptance', () => {
  it('accepts the kanji surface, the kana reading and altForms', () => {
    const o = good(['分かる', 'わかる', '解る']);
    expect(checkJa('分かる', o)).toMatchObject({ correct: true, kind: 'exact', kanaOnly: false, expected: '分かる' });
    expect(checkJa('解る', o)).toMatchObject({ correct: true, kind: 'exact', kanaOnly: false, expected: '解る' });
    expect(checkJa('わかる', o)).toMatchObject({ correct: true, kind: 'exact', kanaOnly: true, nearMiss: false, expected: 'わかる' });
  });

  it('tolerates IME variants: づ/ず, ぢ/じ, long-vowel spellings, katakana, width and punctuation', () => {
    const o = good(['続く', 'つづく']);
    expect(checkJa('つずく', o).correct).toBe(true);
    expect(checkJa('ツヅク', o).correct).toBe(true);
    expect(checkJa(' つづく。', o).correct).toBe(true);
    expect(checkJa('はなぢ', good(['鼻血', 'はなじ'])).correct).toBe(true);
    expect(checkJa('とおきょう', good(['東京', 'とうきょう'])).correct).toBe(true);
    expect(checkJa('こうひい', good(['コーヒー'])).correct).toBe(true);
    expect(checkJa('がくせえ', good(['学生', 'がくせい'])).correct).toBe(true);
  });

  it('flags kana-only; Good policy keeps it a clean correct, Hard policy makes it a Block-shaped correct', () => {
    const g = checkJa('たべる', good(['食べる', 'たべる']));
    expect(g).toMatchObject({ correct: true, nearMiss: false, kanaOnly: true, kind: 'exact', tags: [] });
    const h = checkJa('たべる', { accept: ['食べる', 'たべる'], kanaOnlyPolicy: 'hard' });
    expect(h).toMatchObject({ correct: true, nearMiss: true, kanaOnly: true, kind: 'kana-only', tags: [] });
    // the kanji surface is never kana-only, whatever the policy
    expect(checkJa('食べる', { accept: ['食べる', 'たべる'], kanaOnlyPolicy: 'hard' })).toMatchObject({ correct: true, nearMiss: false, kanaOnly: false });
    // a usually-kana word has no kanji to withhold
    expect(checkJa('おいしい', { accept: ['おいしい', '美味しい'], kanaOnlyPolicy: 'hard' })).toMatchObject({ correct: true, nearMiss: false, kanaOnly: false });
  });

  it('empty input is kind empty and never tagged', () => {
    expect(checkJa('', good(['ねこ']))).toMatchObject({ correct: false, nearMiss: false, kind: 'empty', tags: [], expected: 'ねこ' });
    expect(checkJa(' 。', good(['ねこ'])).kind).toBe('empty');
  });

  it('dedupes and trims the accept list and uses the first entry as the display form', () => {
    expect(checkJa('いぬ', good([' 猫 ', '', 'ねこ', 'ねこ'])).expected).toBe('猫');
  });
});

describe('checkJa — near misses (Block)', () => {
  it('small っ dropped or added → nearMiss tagged small-kana', () => {
    expect(checkJa('きて', good(['切手', 'きって']))).toMatchObject({ correct: false, nearMiss: true, tags: ['small-kana'], kind: 'near', nearKind: 'small-kana', expected: 'きって' });
    expect(checkJa('きって', good(['来て', 'きて']))).toMatchObject({ nearMiss: true, tags: ['small-kana'] });
    expect(checkJa('がこう', good(['学校', 'がっこう'])).tags).toEqual(['small-kana']);
  });

  it('ゃ/や glide slip → small-kana', () => {
    expect(checkJa('きやく', good(['客', 'きゃく'])).tags).toEqual(['small-kana']);
    expect(checkJa('しゆう', good(['しゅう'])).tags).toEqual(['small-kana']);
  });

  it('long vowel too short / too long → vowel-length', () => {
    expect(checkJa('おばさん', good(['おばあさん']))).toMatchObject({ nearMiss: true, tags: ['vowel-length'] });
    expect(checkJa('おばあさん', good(['おばさん']))).toMatchObject({ nearMiss: true, tags: ['vowel-length'] });
    expect(checkJa('ときょう', good(['東京', 'とうきょう'])).tags).toEqual(['vowel-length']);
    expect(checkJa('コーヒ', good(['コーヒー'])).tags).toEqual(['vowel-length']);
    expect(checkJa('べんきょ', good(['勉強', 'べんきょう'])).tags).toEqual(['vowel-length']);
  });

  it('one character off on ≥ 5 chars → transcription; a voicing-only difference is tagged voicing instead', () => {
    expect(checkJa('たべました', good(['たべまして']))).toMatchObject({ nearMiss: true, tags: ['transcription'], nearKind: 'transcription' });
    expect(checkJa('たべましだ', good(['たべました']))).toMatchObject({ nearMiss: true, tags: ['voicing'], nearKind: 'transcription' });
  });

  it('short words: a voicing slip is a plain miss tagged voicing (not a Block)', () => {
    expect(checkJa('にほんこ', good(['日本語', 'にほんご']))).toMatchObject({ correct: false, nearMiss: false, kind: 'wrong', tags: ['voicing'] });
    expect(checkJa('たべまず', good(['たべます']))).toMatchObject({ nearMiss: false, kind: 'wrong', tags: ['voicing'] });
  });

  it('a plain miss carries missTags and the display form', () => {
    const r = checkJa('いぬ', good(['猫', 'ねこ'], { missTags: ['kanji-reading'] }));
    expect(r).toMatchObject({ correct: false, nearMiss: false, kind: 'wrong', tags: ['kanji-reading'], expected: '猫' });
  });
});

describe('checkJa — particle slips (production)', () => {
  it('a trailing particle on the word is a Block tagged particle, not a fail', () => {
    const r = checkJa('みずを', good(['水', 'みず']));
    expect(r).toMatchObject({ correct: false, nearMiss: true, kind: 'particle', tags: ['particle'], expected: 'みず' });
  });

  it('は↔が and に↔へ swaps inside a sentence are particle slips', () => {
    expect(checkJa('わたしががくせいです', good(['私は学生です', 'わたしはがくせいです'])).kind).toBe('particle');
    expect(checkJa('東京に行く', good(['東京へ行く'])).kind).toBe('particle');
    expect(checkJa('わたしは', good(['わたし'])).kind).toBe('particle');
  });

  it('never fires on a bare particle, a leading particle, a changed word, or when disabled', () => {
    expect(checkJa('が', good(['は'])).kind).toBe('wrong');
    expect(checkJa('はな', good(['がな'])).kind).toBe('wrong');
    expect(checkJa('みずに', good(['水', 'みず'], { particleSlip: false })).kind).toBe('wrong');
    expect(particleSlip('いぬを', 'ねこを')).toBe(false);
    expect(particleSlip('みず', 'みず')).toBe(false);
    expect(particleSlip('', 'みず')).toBe(false);
  });
});

describe('checkJa — script (katakana fold disabled)', () => {
  it('hiragana for a katakana item is kind script, correct false, untagged', () => {
    const r = checkJa('し', { accept: ['シ'], kanaOnlyPolicy: 'good', allowKatakanaFold: false });
    expect(r).toMatchObject({ correct: false, nearMiss: false, kind: 'script', tags: [], expected: 'シ' });
    expect(checkJa('シ', { accept: ['シ'], kanaOnlyPolicy: 'good', allowKatakanaFold: false }).correct).toBe(true);
    expect(checkJa('し', good(['シ'])).correct).toBe(true);
    expect(scriptMismatch('コーヒー', 'こーひー')).toBe(true);
    expect(scriptMismatch('食べる', 'たべる')).toBe(false);
  });
});

describe('voicingSlip', () => {
  it.each([
    ['か', 'が', true],
    ['は', 'ぱ', true],
    ['ば', 'ぱ', true],
    ['にほんこ', 'にほんご', true],
    ['カ', 'が', true],
    ['かが', 'がか', false],
    ['か', 'さ', false],
    ['か', 'かか', false],
    ['', '', false],
  ])('voicingSlip(%s, %s) = %s', (g, e, want) => {
    expect(voicingSlip(g, e)).toBe(want);
  });
});

describe('checkReading', () => {
  it('exact and canonical-equivalent readings pass; on-readings typed in hiragana match katakana', () => {
    expect(checkReading('のむ', 'のむ')).toMatchObject({ correct: true, nearMiss: false, tags: [] });
    expect(checkReading('しょく', 'ショク').correct).toBe(true);
    expect(checkReading('とおきょう', 'とうきょう').correct).toBe(true);
  });
  it('a slip is a Block tagged by kind; a miss is tagged kanji-reading by default', () => {
    expect(checkReading('きて', 'きって')).toMatchObject({ correct: false, nearMiss: true, tags: ['small-kana'] });
    expect(checkReading('ひと', 'にん')).toMatchObject({ correct: false, nearMiss: false, tags: ['kanji-reading'], expected: 'にん' });
    expect(checkReading('ひと', 'にん', null).tags).toEqual([]);
    expect(checkReading('ひと', 'にん', 'transcription').tags).toEqual(['transcription']);
  });
  it('has no particle tolerance', () => {
    expect(checkReading('のむを', 'のむ')).toMatchObject({ correct: false, nearMiss: false });
  });
});

describe('whyFor', () => {
  it('explains each kind with one line from strings', () => {
    expect(whyFor(checkJa('きて', good(['きって'])))).toBe(S.whySmallKana);
    expect(whyFor(checkJa('おばさん', good(['おばあさん'])))).toBe(S.whyVowelLength);
    expect(whyFor(checkJa('みずを', good(['みず'])))).toBe(S.particleSlip);
    expect(whyFor(checkJa('たべる', { accept: ['食べる', 'たべる'], kanaOnlyPolicy: 'hard' }))).toBe(S.kanaOnlyHard);
    expect(whyFor(checkJa('し', { accept: ['シ'], kanaOnlyPolicy: 'good', allowKatakanaFold: false }))).toBe(S.whyScriptKatakana);
    expect(whyFor(checkJa('シ', { accept: ['し'], kanaOnlyPolicy: 'good', allowKatakanaFold: false }))).toBe(S.whyScriptHiragana);
    expect(whyFor(checkJa('いぬ', good(['ねこ'], { missTags: ['kanji-reading'] })))).toBe(S.whyKanjiReading);
    expect(whyFor(checkJa('いぬ', good(['ねこ'])))).toBeUndefined();
    expect(whyFor(checkJa('ねこ', good(['ねこ'])))).toBeUndefined();
  });
});

describe('kanaOnlyPolicyFor', () => {
  it('is good through Orange, hard from Green once every read card is ≥ 7 d, good without read cards', () => {
    expect(kanaOnlyPolicyFor('white', [30])).toBe('good');
    expect(kanaOnlyPolicyFor('orange', [30, 30])).toBe('good');
    expect(kanaOnlyPolicyFor('green', [7])).toBe('hard');
    expect(kanaOnlyPolicyFor('green', [30, 6.9])).toBe('good');
    expect(kanaOnlyPolicyFor('black', [])).toBe('good');
    expect(kanaOnlyPolicyFor('brown', [100, 8])).toBe('hard');
  });
});

describe('acceptForms', () => {
  const loader = createFakeLoader();
  it('vocab: answer and accept params first, then word, kana, altForms, deduped', () => {
    const item = loader.get<VocabItem>(V.おいしい) as VocabItem;
    expect(acceptForms(item)).toEqual(['おいしい', '美味しい']);
    const eat = loader.get<VocabItem>(V.食べる) as VocabItem;
    expect(acceptForms(eat, { accept: ['たべる'] })).toEqual(['たべる', '食べる']);
    expect(acceptForms(eat, { answer: '食べます', accept: ['たべます'] })).toEqual(['食べます', 'たべます', '食べる', 'たべる']);
  });
  it('kana and kanji items contribute their character; null item uses params only', () => {
    const kana = loader.get('k-h-a');
    expect(kana).toBeDefined();
    expect(acceptForms(kana ?? null)).toEqual(['あ']);
    const kanji = loader.get('j-食');
    expect(kanji).toBeDefined();
    expect(acceptForms(kanji ?? null)).toEqual(['食']);
    expect(acceptForms(null, { answer: 'て' })).toEqual(['て']);
    expect(acceptForms(null)).toEqual([]);
  });
});

describe('AttemptResult builders', () => {
  const ctx = { ms: 1200 };

  it('attempt fills every default', () => {
    expect(attempt({ ms: 5 })).toEqual({ correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 5, errorTags: [] });
  });

  it('gradeChoice: right index clean, wrong index tagged, hint and replays carried, negative ms clamped', () => {
    expect(gradeChoice(2, 2, { ...ctx, answer: 'dog' })).toEqual({ ...attempt({ ms: 1200 }), correct: true, answer: 'dog' });
    const wrong = gradeChoice(1, 2, { ms: -3, hintUsed: true, replays: 1, missTags: ['word-choice'] });
    expect(wrong).toMatchObject({ correct: false, hintUsed: true, replays: 1, ms: 0, errorTags: ['word-choice'] });
  });

  it('gradeTyped mirrors checkJa and attaches the check', () => {
    const r = gradeTyped('きて', { accept: ['切手', 'きって'], kanaOnlyPolicy: 'good' }, ctx);
    expect(r).toMatchObject({ correct: false, nearMiss: true, errorTags: ['small-kana'], answer: 'きて', ms: 1200 });
    expect(r.check.expected).toBe('きって');
    const ok = gradeTyped('切手', { accept: ['切手', 'きって'], kanaOnlyPolicy: 'hard' }, ctx);
    expect(ok).toMatchObject({ correct: true, nearMiss: false, errorTags: [] });
  });

  it('gradeCloze accepts kana-equivalent and alternates, Blocks a particle slip', () => {
    expect(gradeCloze('てください', 'てください', [], ctx).correct).toBe(true);
    expect(gradeCloze('て下さい', 'てください', ['て下さい'], ctx).correct).toBe(true);
    expect(gradeCloze('で', 'に', [], ctx)).toMatchObject({ correct: false, nearMiss: false });
    expect(gradeCloze('がっこうで', 'がっこうに', [], ctx)).toMatchObject({ nearMiss: true, errorTags: ['particle'] });
  });

  it('gradeEn: fuzzy thresholds, override → correct with selfRating 3, miss tags', () => {
    expect(gradeEn('to eat', ['to eat'], ctx)).toMatchObject({ correct: true, fuzzy: true, answer: 'to eat' });
    expect(gradeEn('Eat', ['to eat'], ctx).correct).toBe(true);
    expect(gradeEn('delicous', ['delicious'], ctx).correct).toBe(true); // 1 edit on ≥ 5 chars
    expect(gradeEn('dgo', ['dog'], ctx).correct).toBe(false); // short words must be exact
    const over = gradeEn('drink', ['to eat'], { ...ctx, override: true });
    expect(over).toMatchObject({ correct: true, fuzzy: false, selfRating: 3, errorTags: [] });
    const miss = gradeEn('drink', ['to eat'], { ...ctx, missTags: ['word-choice'] });
    expect(miss).toMatchObject({ correct: false, errorTags: ['word-choice'] });
    expect(miss.selfRating).toBeUndefined();
  });

  it('gradeOrdering: first try Good, one fix Hard, more Again, wrong order Again; alternates and tile splits tolerated', () => {
    const exp = ['わたしは', 'パンを', 'たべます'];
    expect(gradeOrdering(exp, exp, { ...ctx, fixes: 0 })).toMatchObject({ correct: true, nearMiss: false, errorTags: [] });
    expect(gradeOrdering(exp, exp, { ...ctx, fixes: 1 })).toMatchObject({ correct: true, nearMiss: true, errorTags: ['word-order'] });
    expect(gradeOrdering(exp, exp, { ...ctx, fixes: 2 })).toMatchObject({ correct: false, nearMiss: false, errorTags: ['word-order'] });
    expect(gradeOrdering(['パンを', 'わたしは', 'たべます'], exp, { ...ctx, fixes: 0 })).toMatchObject({ correct: false, errorTags: ['word-order'] });
    expect(gradeOrdering(['パンを', 'わたしは', 'たべます'], exp, { ...ctx, fixes: 0, accept: [['パンを', 'わたしは', 'たべます']] }).correct).toBe(true);
    expect(gradeOrdering(['わたし', 'は', 'パンを', 'たべます'], exp, { ...ctx, fixes: 0 }).correct).toBe(true);
  });

  it('gradeSlots: all / some / none', () => {
    expect(gradeSlots(['は', 'を'], ['は', 'を'], ctx)).toMatchObject({ correct: true, hits: 2, errorTags: [] });
    expect(gradeSlots(['が', 'を'], ['は', 'を'], ctx)).toMatchObject({ correct: false, nearMiss: true, hits: 1, errorTags: ['particle'] });
    expect(gradeSlots(['が', null], ['は', 'を'], ctx)).toMatchObject({ correct: false, nearMiss: false, hits: 0, errorTags: ['particle'], answer: 'が ＿' });
    expect(gradeSlots([], [], ctx).correct).toBe(false);
  });

  it('gradePitch tags pitch on a miss', () => {
    expect(gradePitch(1, 1, ctx)).toMatchObject({ correct: true, answer: '1' });
    expect(gradePitch(0, 1, ctx)).toMatchObject({ correct: false, errorTags: ['pitch'] });
  });

  it('moraScore and gradeScored bands (0.95 Good, 0.80 Hard)', () => {
    expect(moraScore('きょうはいいてんきです', 'きょうはいいてんきです')).toBe(1);
    // 10 morae (きょ is one); で→だ plus a dropped す = 2 edits over 10
    expect(moraScore('きょうはいいてんきです', 'きょうはいいてんきだ')).toBeCloseTo(0.8);
    expect(moraScore('きって', 'きて')).toBeCloseTo(1 - 1 / 3);
    expect(gradeScored(1, ctx)).toMatchObject({ correct: true, nearMiss: false, score: 1 });
    expect(gradeScored(0.9, { ...ctx, missTags: ['listening'] })).toMatchObject({ correct: false, nearMiss: true, errorTags: ['listening'], score: 0.9 });
    expect(gradeScored(0.5, ctx)).toMatchObject({ correct: false, nearMiss: false });
    expect(gradeScored(0.7, { ...ctx, bands: { good: 0.8, hard: 0.6 } })).toMatchObject({ nearMiss: true });
    expect(gradeScored(Number.NaN, ctx).score).toBe(0);
    expect(gradeScored(3, ctx).score).toBe(1);
  });

  it('guardResult and timeoutResult set exactly their flag', () => {
    expect(guardResult(ctx)).toEqual({ ...attempt({ ms: 1200 }), guard: true });
    expect(timeoutResult({ ...ctx, answer: 'ね' })).toEqual({ ...attempt({ ms: 1200 }), timedOut: true, answer: 'ね' });
  });
});
