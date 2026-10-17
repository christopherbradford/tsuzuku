/**
 * TSUZUKU — copy for the Mon crests and the Goshuin stamps (group G, Sensei
 * voice: terse, warm, dry; design 01 §3). Linted by `src/i18n/banned.test.ts`.
 *
 * Badge names and their unlock conditions are NOT duplicated here: they live
 * in `src/store/defs-strings.ts` and arrive through `BADGE_DEFS`. This file
 * holds only the labels the crest and stamp components add around them, plus
 * the fixed Japanese that is printed inside a stamp. `{key}` slots are filled
 * with `fill()` from `./strings`.
 */
export const S = {
  // ── Mon crest (MonCrest.tsx) ─────────────────────────────────────────
  /** aria-label of an earned crest without a known day. */
  crestEarned: '{name} crest, earned.',
  /** aria-label of an earned crest with its day. */
  crestEarnedOn: '{name} crest, earned {date}.',
  /** aria-label of a crest not yet earned; `{condition}` is the plain rule. */
  crestLocked: '{name} crest, not yet earned. {condition}',
  /** Tooltip on an earned crest. */
  earnedOn: 'Earned {date}',
  /** Short caption under a locked crest when no condition text is known. */
  notYet: 'Not yet.',
  tierBronze: 'Bronze',
  tierSilver: 'Silver',
  tierGold: 'Gold',

  // ── Goshuin stamp (GoshuinStamp.tsx) ─────────────────────────────────
  /** aria-label; `{n}` station number, `{name}` Japanese name, `{romaji}` romanised. */
  stampAlt: 'Goshuin of Station {n}, {name} ({romaji}), cleared {date}.',
  stampPerfect: 'Passed at 100 %: gold frame.',
  stampAssisted: 'Assisted Gate: the grey corner lifts after the Revenge Match.',
  stampTooltip: 'Station {n} · {romaji} · {date}',
  stampUnknown: 'No station {n} on this road.',

  // ── Fixed Japanese printed inside a stamp / the book ─────────────────
  /** 奉拝 — "respectfully visited", the sumi inscription on every goshuin. */
  hohai: '奉拝',
  /** 第…宿 — the post-station ordinal: 第七宿. */
  stationPrefix: '第',
  stationSuffix: '宿',
  /** Title of the stamp book (colophon page). */
  bookTitle: '東海道五十三次',
  bookSubtitle: '御朱印帳',
  /** Count line on the colophon: `{n}` cleared of `{total}`. */
  bookCount: '{n} of {total} gates',
  bookEnd: 'つづく',
} as const;
