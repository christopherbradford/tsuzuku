/**
 * TSUZUKU — fluency / remediation drill copy (Sensei voice, design 01 §3 / 04 §9).
 *
 * Every user-visible string of `src/exercises/fluency/**` lives here
 * (ARCHITECTURE §8), linted by `src/i18n/banned.test.ts`. Arcade energy
 * without hype; the Nemesis is a rival, never a verdict.
 */
import type { Facet } from '@/content/types';

export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── Rapid Fire ──────────────────────────────────────────────────────── */
  rapidTitle: 'Rapid Fire',
  rapidIntro: 'Sixty seconds. Mature cards only. A miss comes back untimed next session.',
  rapidIntroSeconds: '{n} seconds. Mature cards only. A miss comes back untimed next session.',
  start: 'Start',
  secondsLeft: '{n} s',
  timerLabel: 'Time left',
  combo: 'combo',
  correctCount: '{n} correct',
  missCount: '{n} missed',
  correctLabel: 'Correct',
  missesLabel: 'Missed',
  cardsInPool: '{n} cards in the pool',
  roundOver: 'Round over.',
  personalBest: 'Personal best',
  newBest: 'New personal best.',
  recheckNote: 'Misses come back untimed next session. Nothing was marked Again.',
  freePlay: 'Free play. XP was earned on the first run today.',
  firstRunXp: 'First run today: XP counts.',
  emptyPool: 'No mature cards yet. Rapid Fire opens once cards reach 14 days.',
  promptRec: 'Meaning?',
  promptRomaji: 'Romaji?',
  promptRead: 'Reading of the marked word?',
  promptCloze: 'Fill the blank.',
  promptKeyword: 'Keyword?',
  pass: 'Pass',
  finish: 'Finish',
  continue: 'Continue',
  itemMissing: 'This card’s item is not loaded. Passed.',
  bestCombo: 'Best combo',
  elapsed: 'Elapsed',

  /* ── Nemesis ─────────────────────────────────────────────────────────── */
  nemesisTitle: 'Nemesis',
  nemesisIntro: 'This one keeps slipping. Study the dossier; the duel comes later.',
  nemesisContext: 'In context only for now. The duel opens in {n} days.',
  nemesisDuelIntro: 'Duel {n} of 3. Win on three different days to defeat it.',
  nemesisNotFlagged: 'Not a Nemesis yet. A review, then.',
  dossier: 'Dossier',
  history: 'History',
  lapses: '{n} lapses',
  reviews: '{n} reviews',
  lastMissedDays: 'last missed {n} days ago',
  lastMissedToday: 'last missed today',
  neverMissed: 'never missed',
  facetLabel: '{facet} card',
  parts: 'Parts',
  mnemonic: 'Mnemonic',
  meaning: 'Meaning',
  reading: 'Reading',
  readings: 'Readings',
  pattern: 'Pattern',
  formation: 'Formation',
  inContext: 'In context',
  collocations: 'Often with',
  mistakes: 'Common slips',
  confusable: 'Easily confused with',
  noConfusable: 'No confusable on file for this one.',
  sideBySide: 'Side by side',
  duelProgress: 'Duel {n} of 3',
  duelWinsLabel: 'Duel wins',
  duelWonToday: 'Won today. The next duel waits for tomorrow.',
  duelTypeMeaning: 'Type the meaning in English.',
  duelTypeWord: 'Type the word in Japanese.',
  duelTypeHeard: 'Listen, then type what you heard.',
  duelTypeReading: 'Type the reading of the marked word.',
  duelTypeCloze: 'Type the missing piece.',
  duelTypeSentence: 'Say it in Japanese, using the pattern.',
  duelTypeKeyword: 'Type the keyword.',
  duelReplay: 'Replay',
  duelHint: 'Hint',
  duelHintCeiling: 'Hint used: the best this rep can earn is Hard.',
  duelWin: 'Duel won. One step closer.',
  duelBlock: 'Blocked. Almost. The duel holds for today.',
  duelLost: 'The nemesis holds. Tomorrow again.',
  continueDossier: 'Continue',
  itemMissingDossier: 'This item is not in the loaded content. Continue when ready.',
  noVoice: 'No Japanese voice is available. The word is shown instead.',
} as const;

/** Facet names as the dossier shows them (plain English, no jargon). */
export const FACET_LABEL: Record<Facet, string> = {
  rec: 'meaning',
  listen: 'listening',
  prod: 'production',
  pitch: 'pitch',
  read: 'reading',
  comp: 'parts',
  cloze: 'cloze',
};
