/**
 * TSUZUKU — fixed captions for the G-3 kakejiku (fuji-ridge, koi-dragon,
 * shoji-light, insert-coin, daruma, vending-night, onsen).
 *
 * Personal text (name, chosen kanji, mastered words, counts, dates) comes from
 * `WallpaperData`; only the fixed Japanese captions and the generic arcade
 * attract-screen words live here. Nothing in this file addresses the learner.
 */
export const S = {
  // fuji-ridge — "the line of ninety days", minutes unit
  fujiCaption: '九十日の線',
  minutesUnit: '分',

  // koi-dragon — the gate the koi climbs, kanji counter unit
  koiCaption: '登竜門',
  kanjiUnit: '字',

  // shoji-light — grammar counter unit
  patternUnit: '型',

  // insert-coin — generic arcade attract screen (the piece's own title)
  hiScore: 'HI-SCORE',
  insertCoin: 'INSERT COIN',
  ranks: ['1ST', '2ND', '3RD', '4TH', '5TH'] as readonly string[],
  /** Katakana initials of the house's attract-mode entries (never a real person). */
  houseInitials: ['ツヅ', 'ケイ', 'ゾク', 'ミチ', 'ダン', 'カゲ', 'セン', 'キア'] as readonly string[],

  // daruma — belly kanji when the learner has not chosen one yet
  darumaFallbackKanji: '福',

  // vending-night — the two generic machine indicators
  cold: 'つめたい',
  hot: 'あたたかい',
  katakanaUnit: '語',

  // onsen — the bath mark on the noren, rest-day caption
  yu: 'ゆ',
  restLabel: '休み',
  daysUnit: '日',
} as const;
