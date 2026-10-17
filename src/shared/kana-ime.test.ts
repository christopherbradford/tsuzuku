import { convertLive, finalizeIme, hasPending, imeStep, romajiToKana, wantsKatakana } from './kana-ime';

/** romaji → hiragana; every row is also asserted in katakana mode. */
const TABLE: [string, string][] = [
  // gojūon
  ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
  ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
  ['sa', 'さ'], ['shi', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
  ['ta', 'た'], ['chi', 'ち'], ['tsu', 'つ'], ['te', 'て'], ['to', 'と'],
  ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
  ['ha', 'は'], ['hi', 'ひ'], ['fu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
  ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
  ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
  ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
  ['wa', 'わ'], ['wo', 'を'], ['nn', 'ん'],
  // dakuten / handakuten
  ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
  ['za', 'ざ'], ['ji', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
  ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
  ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
  ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
  // yōon
  ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
  ['sha', 'しゃ'], ['shu', 'しゅ'], ['sho', 'しょ'],
  ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['cho', 'ちょ'],
  ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'],
  ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
  ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'],
  ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
  ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'],
  ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'],
  ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'],
  ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
  // Kunrei and other accepted spellings
  ['si', 'し'], ['ti', 'ち'], ['tu', 'つ'], ['hu', 'ふ'], ['zi', 'じ'],
  ['sya', 'しゃ'], ['syu', 'しゅ'], ['syo', 'しょ'],
  ['tya', 'ちゃ'], ['tyu', 'ちゅ'], ['tyo', 'ちょ'],
  ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
  ['jya', 'じゃ'], ['cya', 'ちゃ'], ['dzu', 'づ'], ['dji', 'ぢ'],
  // small kana via x / l
  ['xa', 'ぁ'], ['xi', 'ぃ'], ['xu', 'ぅ'], ['xe', 'ぇ'], ['xo', 'ぉ'],
  ['la', 'ぁ'], ['li', 'ぃ'], ['lu', 'ぅ'], ['le', 'ぇ'], ['lo', 'ぉ'],
  ['xya', 'ゃ'], ['xyu', 'ゅ'], ['xyo', 'ょ'], ['xtsu', 'っ'], ['ltsu', 'っ'], ['xtu', 'っ'],
  // long vowel mark
  ['-', 'ー'], ['a-', 'あー'], ['ko-hi-', 'こーひー'], ['ra-men', 'らーめん'],
  // sokuon
  ['matte', 'まって'], ['kitte', 'きって'], ['gakkou', 'がっこう'], ['zasshi', 'ざっし'], ['kippu', 'きっぷ'],
  ['ikkyo', 'いっきょ'], ['kkya', 'っきゃ'], ['ssu', 'っす'], ['ttsu', 'っつ'], ['motto', 'もっと'],
  // ん — nn, n', n + consonant, Hepburn m before labials, "nn" + vowel = ん + n-row
  ['kann', 'かん'], ["kan'", 'かん'], ["kan'i", 'かんい'], ['kanna', 'かんな'], ['kannna', 'かんな'],
  ['konnichiwa', 'こんにちわ'], ['konnnichiha', 'こんにちは'], ["kon'nichiha", 'こんにちは'],
  ['shimbun', 'しんぶん'], ['shinbun', 'しんぶん'], ['sampo', 'さんぽ'], ['sanpo', 'さんぽ'], ['gamma', 'がんま'],
  ['kanni', 'かんに'], ['kanno', 'かんの'], ['onna', 'おんな'], ['sannen', 'さんねん'], ['sanka', 'さんか'],
  ['hon', 'ほん'], ['n', 'ん'], ['annai', 'あんない'], ['kinenn', 'きねん'], ["kin'en", 'きんえん'], ['tennin', 'てんにん'],
  ['honya', 'ほにゃ'], ["hon'ya", 'ほんや'], ['honnya', 'ほんにゃ'], ['konnyaku', 'こんにゃく'], ['kinyoubi', 'きにょうび'], ["kin'youbi", 'きんようび'],
  ['itchi', 'いっち'], ['matcha', 'まっちゃ'], ['kotchi', 'こっち'],
  // words from the design docs
  ['tsuduku', 'つづく'], ['tsuzuku', 'つずく'], ['hyakuren', 'ひゃくれん'], ['shugyou', 'しゅぎょう'], ['kumite', 'くみて'],
  ['kata', 'かた'], ['kiai', 'きあい'], ['ippon', 'いっぽん'], ['sekimori', 'せきもり'], ['michikusa', 'みちくさ'],
  ['toukyou', 'とうきょう'], ['nihonbashi', 'にほんばし'], ['sanjouoohashi', 'さんじょうおおはし'], ['perapera', 'ぺらぺら'],
  ['onegaishimasu', 'おねがいします'], ['arigatou', 'ありがとう'], ['sumimasen', 'すみません'], ['ohayou', 'おはよう'],
  ['watashi', 'わたし'], ['tabemasu', 'たべます'], ['nomimashita', 'のみました'], ['ikimasen', 'いきません'],
  ['gakusei', 'がくせい'], ['sensei', 'せんせい'], ['benkyou', 'べんきょう'], ['denwa', 'でんわ'], ['shinkansen', 'しんかんせん'],
  ['kyouto', 'きょうと'], ['ryokou', 'りょこう'], ['jitensha', 'じてんしゃ'], ['chotto', 'ちょっと'], ['zenzen', 'ぜんぜん'],
  // uppercase is folded (katakana comes from the option, never from Caps Lock here)
  ['ONAJI', 'おなじ'], ['Kanji', 'かんじ'],
  // kana passes through, romaji after kana converts
  ['あいう', 'あいう'], ['あいうka', 'あいうか'], ['アイウka', 'アイウか'],
];

const EXTENDED: [string, string][] = [
  ['fa', 'ファ'], ['fi', 'フィ'], ['fe', 'フェ'], ['fo', 'フォ'], ['fyu', 'フュ'],
  ['va', 'ヴァ'], ['vi', 'ヴィ'], ['vu', 'ヴ'], ['ve', 'ヴェ'], ['vo', 'ヴォ'], ['vyu', 'ヴュ'],
  ['she', 'シェ'], ['je', 'ジェ'], ['che', 'チェ'],
  ['tsa', 'ツァ'], ['tsi', 'ツィ'], ['tse', 'ツェ'], ['tso', 'ツォ'],
  ['thi', 'ティ'], ['dhi', 'ディ'], ['thu', 'テュ'], ['dhu', 'デュ'], ['twu', 'トゥ'], ['dwu', 'ドゥ'],
  ['whi', 'ウィ'], ['whe', 'ウェ'], ['who', 'ウォ'], ['wi', 'ウィ'], ['we', 'ウェ'], ['ye', 'イェ'], ['kwa', 'クァ'], ['kwo', 'クォ'],
  ['ko-hi-', 'コーヒー'], ['pa-thi-', 'パーティー'], ['konbini', 'コンビニ'], ['hanba-ga-', 'ハンバーガー'], ['terebi', 'テレビ'],
];

describe('kana-ime table (hiragana + katakana modes)', () => {
  it.each(TABLE)('%s → %s', (romaji, kana) => {
    expect(finalizeIme(romaji)).toBe(kana);
    expect(romajiToKana(romaji)).toBe(kana);
  });
  it.each(TABLE)('%s → %s in katakana mode', (romaji, kana) => {
    // katakana mode: romaji and any typed hiragana both come out as katakana
    const expected = kana.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    expect(finalizeIme(romaji, { katakana: true })).toBe(expected);
  });
  it.each(EXTENDED)('%s → %s (katakana mode)', (romaji, kana) => {
    expect(finalizeIme(romaji, { katakana: true })).toBe(kana);
    expect(romajiToKana(romaji, { katakana: true })).toBe(kana);
  });
});

describe('imeStep — live conversion with pending romaji', () => {
  it.each([
    ['', '', ''],
    ['k', '', 'k'],
    ['ky', '', 'ky'],
    ['sh', '', 'sh'],
    ['ts', '', 'ts'],
    ['tt', '', 'tt'],
    ['ka', 'か', ''],
    ['kan', 'か', 'n'],
    ['kann', 'かん', ''],
    ['kani', 'かに', ''],
    ['hon', 'ほ', 'n'],
    ['honn', 'ほん', ''],
    ['n', '', 'n'],
    ['nn', 'ん', ''],
    ['ny', '', 'ny'],
    ['nya', 'にゃ', ''],
    ['shimbu', 'しんぶ', ''],
    ['shimbun', 'しんぶ', 'n'],
    ['matt', 'ま', 'tt'],
    ['matte', 'まって', ''],
    ['mb', 'ん', 'b'],
    ['x', '', 'x'],
    ['xts', '', 'xts'],
    ['xtsu', 'っ', ''],
    ['ko-h', 'こー', 'h'],
    ['ko-hi-', 'こーひー', ''],
    ['あいうk', 'あいう', 'k'],
    ['kanj', 'かん', 'j'],
    ['kanji', 'かんじ', ''],
  ])('imeStep(%s) → text %s, pending %s', (buffer, text, pending) => {
    expect(imeStep(buffer)).toEqual({ text, pending });
    expect(hasPending(buffer)).toBe(pending.length > 0);
  });

  it('katakana mode converts the resolved text only', () => {
    expect(imeStep('kan', { katakana: true })).toEqual({ text: 'カ', pending: 'n' });
    expect(imeStep('ko-hi-', { katakana: true })).toEqual({ text: 'コーヒー', pending: '' });
    expect(imeStep('matt', { katakana: true })).toEqual({ text: 'マ', pending: 'tt' });
  });

  it('convertLive mirrors imeStep with a kana alias', () => {
    expect(convertLive('kan')).toEqual({ text: 'か', pending: 'n', kana: 'か' });
    expect(convertLive('kan', { katakana: true }).kana).toBe('カ');
  });

  it('is stable keystroke by keystroke (prefix conversions never regress a settled kana)', () => {
    const word = 'shinkansen';
    let settled = '';
    for (let i = 1; i <= word.length; i++) {
      const { text } = imeStep(word.slice(0, i));
      // the resolved part only grows or stays, except that a pending n may fold into ん later
      expect(text.startsWith(settled.replace(/ん$/, '')) || settled.startsWith(text)).toBe(true);
      settled = text;
    }
    expect(finalizeIme(word)).toBe('しんかんせん');
  });
});

describe('finalizeIme', () => {
  it('resolves a trailing n to ん and leaves other dangling romaji visible', () => {
    expect(finalizeIme('hon')).toBe('ほん');
    expect(finalizeIme('kak')).toBe('かk');
    expect(finalizeIme('tt')).toBe('tt');
    expect(finalizeIme('')).toBe('');
    expect(finalizeIme('nn')).toBe('ん');
    expect(finalizeIme('kann')).toBe('かん');
  });
  it('wantsKatakana detects katakana answers', () => {
    expect(wantsKatakana('コーヒー')).toBe(true);
    expect(wantsKatakana('ファ')).toBe(true);
    expect(wantsKatakana('こーひー')).toBe(false);
    expect(wantsKatakana('コーヒーを飲む')).toBe(false);
    expect(wantsKatakana('')).toBe(false);
  });
});
