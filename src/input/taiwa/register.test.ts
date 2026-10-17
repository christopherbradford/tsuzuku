import type { RegisterTag } from '../../content/types';
import {
  detectRegister,
  markers,
  markersDetailed,
  normalizeForRegister,
  registerFor,
  registerMatches,
  splitClauses,
  stripFinalParticles,
  type Register,
} from './register';

/** The 60-sentence table (plus extras): [sentence, expected register]. */
const TABLE: [string, Register][] = [
  // ── casual (plain) ───────────────────────────────────────────────────
  ['コーヒーを飲む。', 'casual'],
  ['明日、学校に行く？', 'casual'],
  ['これは犬だ。', 'casual'],
  ['昨日は雨だった。', 'casual'],
  ['うん、食べる。', 'casual'],
  ['はい、食べる。', 'casual'], // はい is used in both registers (review round 2, #2)
  ['今、何してる？', 'casual'],
  ['食べちゃった。', 'casual'],
  ['早く来いよ。', 'casual'],
  ['おいしいね。', 'casual'],
  ['行かない。', 'casual'],
  ['行かなかったよ。', 'casual'],
  ['ちょっと待って。', 'casual'],
  ['それ、本当？', 'casual'],
  ['一緒に行こう。', 'casual'],
  ['知らないけど、たぶん来るだろう。', 'casual'],
  ['おはよう、ケン。', 'casual'],
  ['やっぱり無理かも。', 'casual'],
  ['映画、見に行かない？', 'casual'],
  ['これ、食べていい？', 'casual'],
  ['雨が降ってるから、傘を持ってって。', 'casual'],
  ['あたしも水、飲む。', 'casual'],
  ['食べるかな。', 'casual'],
  ['そうなんだ。', 'casual'],
  ['いいよ。', 'casual'],
  // ── polite ───────────────────────────────────────────────────────────
  ['コーヒーを飲みます。', 'polite'],
  ['私はハナです。', 'polite'],
  ['明日、学校に行きますか。', 'polite'],
  ['昨日は雨でした。', 'polite'],
  ['はい、食べます。', 'polite'],
  ['今、何をしていますか。', 'polite'],
  ['食べてしまいました。', 'polite'],
  ['早く来てください。', 'polite'],
  ['おいしいですね。', 'polite'],
  ['行きません。', 'polite'],
  ['行きませんでした。', 'polite'],
  ['ちょっと待ってください。', 'polite'],
  ['それは本当ですか。', 'polite'],
  ['一緒に行きましょう。', 'polite'],
  ['知りませんが、たぶん来るでしょう。', 'polite'],
  ['おはようございます。', 'polite'],
  ['食べると思います。', 'polite'],
  ['すみません、水をください。', 'polite'],
  ['映画を見に行きませんか。', 'polite'],
  ['ありがとうございます。', 'polite'],
  ['よろしくお願いします。', 'polite'],
  ['そうですよね。', 'polite'],
  ['はい、おいしいです。', 'polite'],
  ['犬は水を飲みますか。', 'polite'],
  // ── keigo ────────────────────────────────────────────────────────────
  ['コーヒーをいただきます。', 'keigo'],
  ['先生がいらっしゃいます。', 'keigo'],
  ['少々お待ちください。', 'keigo'],
  ['こちらでございます。', 'keigo'],
  ['明日、伺います。', 'keigo'],
  ['田中と申します。', 'keigo'],
  ['ご確認いただけますか。', 'keigo'],
  ['社長がおっしゃいました。', 'keigo'],
  ['お名前をお聞かせください。', 'keigo'],
  ['資料をお送りいたします。', 'keigo'],
  ['どうぞご覧ください。', 'keigo'],
  ['明日は休ませていただきます。', 'keigo'],
  ['先生はもう召し上がりましたか。', 'keigo'],
  ['こちらにお座りになりますか。', 'keigo'],
  ['駅までご案内します。', 'keigo'],
  ['かしこまりました。', 'keigo'],
  ['いらっしゃいませ。', 'keigo'],
  ['社長は会議室にいらっしゃいますか。', 'keigo'],
  ['お手伝いいたしましょうか。', 'keigo'],
  // ── mixed ────────────────────────────────────────────────────────────
  ['私は学生です。でも、コーヒーは飲まない。', 'mixed'],
  ['先生がいらっしゃった。', 'mixed'],
  ['おいしいですね。食べる？', 'mixed'],
  ['うん、行きます。', 'mixed'],
  ['ご覧になった？', 'mixed'],
];

describe('detectRegister — the sentence table', () => {
  it('has at least 60 rows', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
  });

  it.each(TABLE)('%s → %s', (sentence, want) => {
    expect(detectRegister(sentence)).toBe(want);
  });
});

describe('detectRegister — input shapes', () => {
  it('reads through ruby markup and width variants', () => {
    expect(detectRegister('{私|わたし}はハナです。')).toBe('polite');
    expect(detectRegister('{毎朝|まいあさ}コーヒーを{飲|の}む。')).toBe('casual');
    expect(detectRegister('行きますか？')).toBe('polite');
    expect(detectRegister('行く?')).toBe('casual');
    expect(detectRegister('  行きます　')).toBe('polite');
  });

  it('ignores quoted speech', () => {
    expect(detectRegister('先生は「食べろ」と言いました。')).toBe('polite');
    expect(detectRegister('彼は『行きます』と言った。')).toBe('casual');
  });

  it('empty and punctuation-only input is plain (no markers)', () => {
    expect(detectRegister('')).toBe('casual');
    expect(detectRegister('。')).toBe('casual');
    expect(markers('')).toEqual([]);
  });

  it('a line of only neutral aizuchi is polite-compatible', () => {
    expect(detectRegister('なるほど。')).toBe('polite');
    expect(detectRegister('えっと、なるほど。')).toBe('polite');
  });

  it('the set phrase いただきます alone is polite; with an object it is humble keigo', () => {
    expect(detectRegister('いただきます。')).toBe('polite');
    expect(detectRegister('お茶をいただきます。')).toBe('keigo');
  });

  it('bare ください is polite; くださいます is keigo', () => {
    expect(detectRegister('水をください。')).toBe('polite');
    expect(detectRegister('先生が本をくださいました。')).toBe('keigo');
  });

  it('subordinate plain forms do not make a polite sentence casual', () => {
    expect(detectRegister('雨が降ったら、家にいます。')).toBe('polite');
    expect(detectRegister('行くかどうか分かりません。')).toBe('polite');
    expect(detectRegister('食べたいです。')).toBe('polite');
  });

  it('polite + keigo in one sentence is keigo, not mixed', () => {
    expect(detectRegister('はい、少々お待ちください。')).toBe('keigo');
    expect(detectRegister('田中と申します。よろしくお願いします。')).toBe('keigo');
  });

  // Review round 2, #2: real Taiwa gold lines that used to read `mixed` against their own target.
  it('a predicate-less fragment carries no register: echo questions, exclamations, case particles, vocatives, short fragments', () => {
    expect(detectRegister('肩で？人が人を運んで川を渡ったということですか。')).toBe('polite'); // s-24-1#5
    expect(detectRegister('三日も？それで、島田と金谷の町が大きくなったんですか。')).toBe('polite'); // s-24-1#9
    expect(detectRegister('十一回！怖くないですか。')).toBe('polite'); // s-13-2#6
    expect(detectRegister('田中さん！いつから後ろにいたんですか。')).toBe('polite'); // s-37-2#9
    expect(detectRegister('本当に。昔の道が全部書いてありますね。')).toBe('polite'); // s-37-2#13
    expect(detectRegister('アオですよ、ケン。')).toBe('polite'); // s-08-2#16: the vocative after the predicate is skipped
    expect(detectRegister('さようなら、みやさん。')).toBe('polite'); // s-01-2#15 accept
    expect(detectRegister('え、本気？')).toBe('casual'); // s-52-2#3 accept: no predicate at all is plain
    expect(detectRegister('五十三。朝ごはんは七時。晴れ。歩いた。はい、これで全部。')).toBe('casual'); // s-53-2#16
  });

  it('a trailing subordinate clause takes the register of its polite remainder, else none', () => {
    expect(detectRegister('時計のほうが正しいと思いますけど。')).toBe('polite'); // s-51-2#6 accept
    expect(detectRegister('来年、また来ます。京都から戻ってきたら。')).toBe('polite'); // s-39-2#11
    expect(detectRegister('はい、日本橋から。今日で四十一番目の町です。')).toBe('polite'); // s-41-2#23
    expect(detectRegister('行くけど。')).toBe('casual'); // alone: no predicate = plain
    expect(detectRegister('はい。松の道までは大丈夫だったんですが、急にざあざあ降ってきて。')).toBe('polite'); // s-35-1#1: て trailing off after んですが
    expect(detectRegister('ちょっと待って。')).toBe('casual'); // a plain request stays plain
    expect(detectRegister('知らないけど、たぶん来るだろう。')).toBe('casual');
  });

  it('soft set phrases (はい・ええ・いただきます・じゃあ・えっ) never clash with a real final', () => {
    expect(detectRegister('じゃあ、きっと晴れますね。')).toBe('polite'); // s-47-2#13
    expect(detectRegister('えっ、いいんですか。ありがとうございます。')).toBe('polite'); // s-37-2#23
    expect(detectRegister('いただきます。おいしい！塩と風だけ？')).toBe('casual'); // s-12-2#12
    expect(detectRegister('いただきます。あ、野菜が甘い。')).toBe('casual'); // s-29-2#25
    expect(detectRegister('はい、はい。食べながら見る。')).toBe('casual'); // s-13-2#2
    expect(detectRegister('ええ？でも山は優しいって。')).toBe('casual'); // s-13-2#10
    expect(detectRegister('はい。')).toBe('polite');
    expect(detectRegister('ええ、ええ。')).toBe('polite');
    expect(detectRegister('いただきます。')).toBe('polite');
    // genuinely polite set phrases still contrast with a casual final
    expect(detectRegister('ありがとうございます。ケン、これ、日記に書いてもいい？')).toBe('mixed'); // s-34-2#23
    expect(detectRegister('ありがとう。暑かったでしょう？水、飲んで。')).toBe('mixed'); // s-16-2#12: a でしょう final against 飲んで
  });
});

describe('markers', () => {
  it('lists predicate words, set phrases and keigo forms in order', () => {
    expect(markers('はい、コーヒーを飲みます。')).toEqual(['はい', '飲みます']);
    expect(markers('コーヒーを飲む。')).toEqual(['飲む']);
    expect(markers('これは犬だ。')).toEqual(['犬だ']);
    expect(markers('うん、行きます。')).toEqual(['うん', '行きます']);
    expect(markers('少々お待ちください。')).toEqual(['お待ちください', 'お待ちください']);
    expect(markers('田中と申します。')).toEqual(['申します', '申します']);
  });

  it('markersDetailed carries register, kind and index', () => {
    const d = markersDetailed('はい、飲みます。');
    expect(d[0]).toMatchObject({ surface: 'はい', register: 'polite', kind: 'lexical', index: 0 });
    expect(d[1]).toMatchObject({ surface: '飲みます', register: 'polite', kind: 'final' });
    expect(d[1]?.index).toBe('はい、'.length);
    const k = markersDetailed('先生がいらっしゃった。');
    expect(k.map((m) => m.kind)).toEqual(['keigo', 'final']);
    expect(k.map((m) => m.register)).toEqual(['keigo', 'casual']);
  });

  it('final particles are stripped before the predicate is read', () => {
    expect(stripFinalParticles('飲みますか')).toBe('飲みます');
    expect(stripFinalParticles('食べるよね')).toBe('食べる');
    expect(stripFinalParticles('食べるかな')).toBe('食べる');
    expect(stripFinalParticles('ですね')).toBe('です');
    expect(stripFinalParticles('ね')).toBe('ね');
    expect(markers('飲みますか。')).toEqual(['飲みます']);
  });
});

describe('helpers', () => {
  it('normalizeForRegister strips ruby, quotes, spaces and folds width', () => {
    expect(normalizeForRegister('{私|わたし}は 「はい」 と言った？')).toBe('私はと言った?');
  });

  it('an ellipsis survives width folding and still splits clauses (NFKC turns …… into dots)', () => {
    expect(normalizeForRegister('あ、本当に。……じゃあ、冬に。')).toBe('あ、本当に。…じゃあ、冬に。');
    expect(splitClauses(normalizeForRegister('ええと……冬に、たぶん。')).map((c) => c.text)).toEqual(['ええと', '冬に、たぶん']);
    expect(markersDetailed('あ、本当に。……じゃあ、冬に、必ず。')).toEqual([]); // s-24-1#19: no predicate anywhere
    expect(markersDetailed('ええと……冬に、たぶん。')).toEqual([]); // s-24-1#17
  });

  it('splitClauses keeps offsets and drops empty clauses', () => {
    expect(splitClauses('はい。行きます！どこ？')).toEqual([
      { text: 'はい', index: 0 },
      { text: '行きます', index: 3 },
      { text: 'どこ', index: 8 },
    ]);
    expect(splitClauses('。。')).toEqual([]);
  });
});

describe('registerFor / registerMatches', () => {
  it.each([
    ['honorific', 'keigo'],
    ['humble', 'keigo'],
    ['formal', 'keigo'],
    ['casual', 'casual'],
    ['slang', 'casual'],
    ['dialect', 'casual'],
    ['polite', 'polite'],
    ['neutral', 'polite'],
    ['written', 'polite'],
    ['literary', 'polite'],
  ] as [RegisterTag, Register][])('%s → %s', (tag, want) => {
    expect(registerFor(tag)).toBe(want);
  });

  it('polite target accepts polite and keigo; casual and keigo targets are exact; neutral rejects only mixed', () => {
    expect(registerMatches('飲みます。', 'polite')).toBe(true);
    expect(registerMatches('お茶をいただきます。', 'polite')).toBe(true);
    expect(registerMatches('飲む。', 'polite')).toBe(false);
    expect(registerMatches('飲む。', 'casual')).toBe(true);
    expect(registerMatches('飲みます。', 'casual')).toBe(false);
    expect(registerMatches('お飲みになりますか。', 'honorific')).toBe(true);
    expect(registerMatches('飲みますか。', 'honorific')).toBe(false);
    expect(registerMatches('飲む。', 'neutral')).toBe(true);
    expect(registerMatches('飲みます。', 'neutral')).toBe(true);
    expect(registerMatches('うん、飲みます。', 'neutral')).toBe(false);
  });
});
