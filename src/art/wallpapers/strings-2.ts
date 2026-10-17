/**
 * TSUZUKU — fixed captions for the kakejiku of group G-2 (lantern-river,
 * sumi-dragon, okaeri, vs-wall, wall-broken, tanabata, hanko-garden).
 *
 * Personal text comes from `WallpaperData`; everything else a learner can
 * read on these pieces lives here (ARCHITECTURE §8). Japanese captions are
 * decorative labels in the pieces' own voice; the few Latin strings are
 * arcade-screen idiom (okaeri's hi-score table).
 */
export const S = {
  // lantern-river 灯籠流し
  lanternTitle: '灯籠流し',
  wordsThisMonth: '今月の言葉',

  // sumi-dragon 墨龍
  dragonTitle: '墨龍',
  longestStreak: '最長',
  daysUnit: '日',
  /** Seal glyph when the learner has not chosen a kanji yet. */
  defaultSeal: '続',

  // okaeri おかえり — attract screen, no countdown, no coin
  okaeri: 'おかえり',
  okaeriSub: '道場はあなたの席を取っておきました',
  hiScore: 'HI-SCORE',
  ranks: ['1ST', '2ND', '3RD', '4TH', '5TH'] as readonly string[],
  rowDays: '修行日数',
  rowStreak: '最長連続',
  rowLevel: 'レベル',
  rowStation: '宿場',

  // vs-wall 対戦画面 / wall-broken 壁を越えて
  challenger: '挑戦者',
  wall: '壁',
  wallArc: '壁の章',
  beyond: '越',
  beyondTitle: '壁を越えて',

  // tanabata 七夕
  tanabataTitle: '七夕',

  // hanko-garden 判子の庭
  gardenTitle: '判子の庭',
  crestsUnit: '個の紋',
} as const;
