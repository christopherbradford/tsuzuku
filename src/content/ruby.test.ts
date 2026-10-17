import { hasKanji, kanjiIn, parseRuby, rubyCount, segmentsToTokens, toKana, toPlain, tokensMatchPlain } from './ruby';

/** Gold examples from CONTENT_GUIDE §4, §11, §13, §14. */
const GOLD: [ja: string, plain: string, kana: string][] = [
  ['{私|わたし}は{毎朝|まいあさ}コーヒーを{飲|の}みます。', '私は毎朝コーヒーを飲みます。', 'わたしはまいあさコーヒーをのみます。'],
  ['{毎朝|まいあさ}コーヒーを{飲|の}みます。', '毎朝コーヒーを飲みます。', 'まいあさコーヒーをのみます。'],
  ['ここに{名前|なまえ}を{書|か}いてください。', 'ここに名前を書いてください。', 'ここになまえをかいてください。'],
  ['もう{一度|いちど}{言|い}ってください。', 'もう一度言ってください。', 'もういちどいってください。'],
  ['{少|すこ}し{待|ま}ってください。', '少し待ってください。', 'すこしまってください。'],
  ['{箱根|はこね}の{山|やま}は{高|たか}いですね。', '箱根の山は高いですね。', 'はこねのやまはたかいですね。'],
  ['{水|みず}やお{茶|ちゃ}などを{口|くち}から{体|からだ}に{入|い}れること。', '水やお茶などを口から体に入れること。', 'みずやおちゃなどをくちからからだにいれること。'],
  ['{ATM|エーティーエム}で{お金|おかね}を{下|お}ろす。', 'ATMでお金を下ろす。', 'エーティーエムでおかねをおろす。'],
  ['{三時|さんじ}に{会|あ}いましょう。', '三時に会いましょう。', 'さんじにあいましょう。'],
  ['{人々|ひとびと}', '人々', 'ひとびと'],
  ['ハナはケンと{歩|ある}く。', 'ハナはケンと歩く。', 'ハナはケンとあるく。'],
  ['かな だけ。', 'かな だけ。', 'かな だけ。'],
  ['', '', ''],
];

describe('toPlain / toKana', () => {
  it.each(GOLD)('%s', (ja, plain, kana) => {
    expect(toPlain(ja)).toBe(plain);
    expect(toKana(ja)).toBe(kana);
  });
  it('is stateless across calls (RUBY_RE is /g)', () => {
    const ja = GOLD[0]![0];
    for (let i = 0; i < 5; i++) {
      expect(toPlain(ja)).toBe(GOLD[0]![1]);
      expect(toKana(ja)).toBe(GOLD[0]![2]);
    }
  });
});

describe('parseRuby', () => {
  it('splits into plain and ruby segments, okurigana outside', () => {
    expect(parseRuby('{飲|の}みます')).toEqual([
      { base: '飲', reading: 'の' },
      { base: 'みます', reading: null },
    ]);
    expect(parseRuby('ここに{名前|なまえ}を{書|か}いてください。')).toEqual([
      { base: 'ここに', reading: null },
      { base: '名前', reading: 'なまえ' },
      { base: 'を', reading: null },
      { base: '書', reading: 'か' },
      { base: 'いてください。', reading: null },
    ]);
    expect(parseRuby('かな')).toEqual([{ base: 'かな', reading: null }]);
    expect(parseRuby('')).toEqual([]);
    expect(parseRuby('{ATM|エーティーエム}')).toEqual([{ base: 'ATM', reading: 'エーティーエム' }]);
  });
  it('reconstructs plain and kana from segments', () => {
    for (const [ja, plain, kana] of GOLD) {
      const segs = parseRuby(ja);
      expect(segs.map((s) => s.base).join('')).toBe(plain);
      expect(segs.map((s) => s.reading ?? s.base).join('')).toBe(kana);
    }
  });
  it('rubyCount', () => {
    expect(rubyCount(GOLD[0]![0])).toBe(3);
    expect(rubyCount('かな')).toBe(0);
  });
});

describe('hasKanji / kanjiIn', () => {
  it.each([
    ['飲む', true],
    ['のむ', false],
    ['コーヒー', false],
    ['人々', true],
    ['〆切', true],
    ['ABC', false],
    ['', false],
    ['{飲|の}みます', true],
  ])('hasKanji(%s) = %s', (s, v) => expect(hasKanji(s)).toBe(v));
  it('kanjiIn lists characters in order', () => {
    expect(kanjiIn('私は毎朝コーヒーを飲みます。')).toEqual(['私', '毎', '朝', '飲']);
    expect(kanjiIn('人々')).toEqual(['人', '々']);
    expect(kanjiIn('かな')).toEqual([]);
  });
});

describe('segmentsToTokens', () => {
  it('aligns tokens with their ruby markup', () => {
    const ja = '{箱根|はこね}の{山|やま}は{高|たか}いですね。';
    const tokens = ['箱根', 'の', '山', 'は', '高い', 'です', 'ね', '。'];
    expect(tokensMatchPlain(ja, tokens)).toBe(true);
    const out = segmentsToTokens(ja, tokens);
    expect(out).toEqual([
      { token: '箱根', ja: '{箱根|はこね}' },
      { token: 'の', ja: 'の' },
      { token: '山', ja: '{山|やま}' },
      { token: 'は', ja: 'は' },
      { token: '高い', ja: '{高|たか}い' },
      { token: 'です', ja: 'です' },
      { token: 'ね', ja: 'ね' },
      { token: '。', ja: '。' },
    ]);
    expect(out.map((t) => toPlain(t.ja)).join('')).toBe(toPlain(ja));
    expect(out.map((t) => toKana(t.ja)).join('')).toBe(toKana(ja));
  });
  it('handles a ruby in the middle of a token and plain-only sentences', () => {
    const ja = '{私|わたし}は{毎朝|まいあさ}コーヒーを{飲|の}みます。';
    const tokens = ['私', 'は', '毎朝', 'コーヒー', 'を', '飲みます', '。'];
    const out = segmentsToTokens(ja, tokens);
    expect(out.map((t) => t.ja)).toEqual(['{私|わたし}', 'は', '{毎朝|まいあさ}', 'コーヒー', 'を', '{飲|の}みます', '。']);
    expect(segmentsToTokens('かな だけ。', ['かな', ' ', 'だけ', '。']).map((t) => t.ja)).toEqual(['かな', ' ', 'だけ', '。']);
  });
  it('a ruby straddling a token boundary goes whole to the first token', () => {
    const out = segmentsToTokens('{日本語|にほんご}', ['日本', '語']);
    expect(out[0]).toEqual({ token: '日本', ja: '{日本語|にほんご}' });
    expect(out[1]).toEqual({ token: '語', ja: '語' });
  });
  it('tokensMatchPlain detects mismatches', () => {
    expect(tokensMatchPlain('{山|やま}は', ['山', 'は'])).toBe(true);
    expect(tokensMatchPlain('{山|やま}は', ['やま', 'は'])).toBe(false);
  });
});
