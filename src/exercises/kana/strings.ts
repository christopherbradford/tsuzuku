/**
 * TSUZUKU — copy for the kana drills (design 04 §1, Sensei voice 01 §3).
 *
 * Shared drill copy (prompts, controls, feedback lines, arcade notes) lives in
 * `src/exercises/strings.ts`; this file holds what only Kana Flash, Kana Ear,
 * Kana Forge and Gojūon Fighter say. Japanese appears only where the learner
 * can already read it: kana row names (Gojūon unlocks at Station 2).
 * Templates use `{name}` placeholders filled with `fill()`.
 */
export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── shared by the kana drills ───────────────────────────────────────── */
  kanaLabel: 'Kana',
  romajiLabel: 'Romaji',
  romajiField: 'Romaji',
  listen: 'Listen',
  replayHint: 'Space replays',
  seenIn: 'Seen in',
  hiraganaItem: 'Hiragana',
  katakanaItem: 'Katakana',
  skipMissing: 'Continue without this one',

  /* ── Kana Flash ──────────────────────────────────────────────────────── */
  chooseRomaji: 'Choose the romaji.',
  flashTarget: 'Target {s} s',
  flashInTime: 'In time',
  flashOverTime: 'Over the target',
  flashReaction: '{s} s',
  flashAutoNote: 'Submits on its own when the romaji matches.',
  flashVariants: 'Hepburn and Kunrei both count.',

  /* ── Kana Ear ────────────────────────────────────────────────────────── */
  earGridLabel: 'Kana grid',
  earHeard: 'You heard',
  earPromptRomaji: 'Tap the kana for {romaji}.',
  earNoVoice: 'No Japanese voice is available. The romaji is the prompt instead.',
  earTarget: 'The kana',

  /* ── Kana Forge ──────────────────────────────────────────────────────── */
  forgePromptAudio: 'Type the kana you heard.',
  forgePromptRomaji: 'Type this in kana.',
  showRomaji: 'Show romaji',
  romajiShown: 'Romaji shown: the best this rep can earn is Hard.',

  /* ── Gojūon Fighter ──────────────────────────────────────────────────── */
  gojuonTitle: 'Gojūon Fighter',
  gojuonIntro: '{n} kana glide in from the right. Type each one before it lands.',
  gojuonGraded: '{n} are mature kana: a miss comes back untimed next session.',
  gojuonPractice: '{n} are younger kana, shown for practice only.',
  gojuonEmpty: 'No kana are mature yet. This round is practice only.',
  startRound: 'Start round',
  startHint: 'Enter starts',
  opponent: 'Opponent',
  rowName: '{row} row',
  lanternLabel: 'Rival lantern: {n} misses',
  gojuonField: 'Romaji for the kana',
  gojuonStage: 'Kana approaching',
  gojuonProgress: '{i} of {n}',
  landed: 'Landed.',
  hit: 'Hit.',
  hits: 'Hits',
  misses: 'Misses',
  fastest: 'Fastest',
  median: 'Median',
  roundTime: 'Round time',
  recheckCount: '{n} kana come back untimed next session.',
  cleanRound: 'Clean round. Nothing to re-test.',
  reactionList: 'Reaction times',
  practiceTag: 'practice',
  missTag: 'miss',
  seconds: '{s} s',
  gojuonReduced: 'Reduced motion: the bar shrinks instead of the kana gliding.',
} as const;

/** Kana row → the row's Japanese name (opponent label). Keyed by `KanaItem.row`. */
export const ROW_JA: Record<string, string> = {
  a: 'あ行',
  k: 'か行',
  g: 'が行',
  s: 'さ行',
  z: 'ざ行',
  t: 'た行',
  d: 'だ行',
  n: 'な行',
  h: 'は行',
  b: 'ば行',
  p: 'ぱ行',
  m: 'ま行',
  y: 'や行',
  r: 'ら行',
  w: 'わ行',
  nn: 'ん',
  ext: '外来音',
};
