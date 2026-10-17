/**
 * TSUZUKU — fixed Japanese captions of the first seven kakejiku generators
 * (torii-dawn, kana-grid, neon-alley, sakura-storm, great-wave, kanji-stars,
 * fifty-three). Personal values come from `WallpaperData`; piece titles from
 * `art/strings WALLPAPER_NAMES`. Plain strings only, Sensei voice.
 */
export const S = {
  // kana-grid (arcade select screen)
  /** The gojūon as 5 rows × 10 columns, a-i-u-e-o top to bottom; `　` marks an empty slot, ん sits in the わ column. */
  gojuonRows: ['あかさたなはまやらわ', 'いきしちにひみ　り　', 'うくすつぬふむゆるん', 'えけせてねへめ　れ　', 'おこそとのほもよろを'] as readonly string[],
  player1: '1P',
  xpLabel: 'XP',
  msUnit: 'ms',
  noTimes: 'まだ記録なし',
  fastest: '最速',
  slowest: '最遅',

  // neon-alley
  alleySuffix: '横丁',

  // sakura-storm
  streakPrefix: '連続',
  daysSuffix: '日',

  // fifty-three
  edo: '江戸',
  kyoto: '京',
  here: '現在地',
  stationNo: '第',
  stationSuffix: '宿',
  dayCount: '日目',
  departure: '出立前',
} as const;

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const KANJI_UNITS = ['', '十', '百', '千'];

/** `45` → `四十五`, `2026` → `二千二十六`, `0` → `〇` (0–9999; larger numbers fall back to digit-by-digit). */
export function kanjiNumber(n: number): string {
  const v = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  if (v === 0) return KANJI_DIGITS[0]!;
  if (v >= 10_000) return Array.from(String(v), (d) => KANJI_DIGITS[Number(d)]!).join('');
  let out = '';
  const digits = Array.from(String(v), Number);
  for (let i = 0; i < digits.length; i++) {
    const d = digits[i]!;
    const unit = KANJI_UNITS[digits.length - 1 - i]!;
    if (d === 0) continue;
    out += (d === 1 && unit !== '' ? '' : KANJI_DIGITS[d]!) + unit;
  }
  return out;
}

/** Replace every digit run with kanji numerals (tategaki dates: `令和8年1月15日` → `令和八年一月十五日`). */
export function kanjiNumerals(s: string): string {
  return s.replace(/\d+/g, (m) => kanjiNumber(Number(m)));
}
