/**
 * TSUZUKU — shared exercise copy (Sensei voice, design 01 §3 / 04 §0).
 *
 * Every user-visible string of `src/exercises/**` lives here (ARCHITECTURE §8),
 * linted by `src/i18n/banned.test.ts`. Terse, warm, dry; "you", never guilt.
 * Japanese appears only where the learner can already read it (kana names,
 * pitch-type kanji next to their English label). Templates use `{name}`
 * placeholders filled with `fill()` (re-exported from `@/shared/ui/strings`).
 */
import type { ErrorTag } from '@/content/types';
import type { NearMissKind } from '@/shared/jp';

export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── prompts ─────────────────────────────────────────────────────────── */
  chooseMeaning: 'Choose the meaning.',
  typeMeaning: 'Type the meaning in English.',
  typeReading: 'Type the reading.',
  typeKana: 'Type the kana.',
  typeRomaji: 'Type the romaji.',
  typeJapanese: 'Type it in Japanese.',
  typeMissing: 'Type the missing piece.',
  typeWhatYouHeard: 'Listen, then type what you heard.',
  typeTheForm: 'Type the {form} form.',
  tapKanaHeard: 'Tap the kana you heard.',
  tapDropMora: 'Tap the mora where the pitch drops.',
  choosePitch: 'Which contour did you hear?',
  whichDidYouHear: 'Which did you hear?',
  orderTiles: 'Put the pieces in order.',
  fillParticles: 'Choose each particle.',
  pickParts: 'Pick the parts that build this kanji.',
  naturalOrNot: 'Natural, or not?',
  recallSilently: 'Recall the meaning, then reveal.',
  rateYourself: 'How did it go?',

  /* ── controls ────────────────────────────────────────────────────────── */
  submit: 'Submit',
  replay: 'Replay',
  reveal: 'Reveal',
  continue: 'Continue',
  again: 'Once more',
  clear: 'Clear',
  undo: 'Undo',
  showEnglish: 'Show English',
  iMeantThat: 'I meant that',
  notThat: 'No. Mark it.',
  meantPrompt: 'Did you mean that?',
  answerField: 'Answer',
  englishField: 'Meaning in English',
  rateAgain: 'Again',
  rateHard: 'Hard',
  rateGood: 'Good',
  natural: 'Natural',
  unnatural: 'Not natural',

  /* ── choice grid ─────────────────────────────────────────────────────── */
  choicesLabel: 'Choices',
  choiceN: 'Choice {n}',
  yourPick: 'your answer',
  correctPick: 'correct',
  missedPick: 'the answer',

  /* ── pitch ───────────────────────────────────────────────────────────── */
  pitchLabel: 'Pitch accent',
  pitchFlat: 'No drop',
  pitchDropAfter: 'Drop after {mora}',
  pitchAria: 'Pitch {type}: drop after mora {mora} of {n}',
  pitchAriaFlat: 'Pitch {type}: no drop, {n} morae',
  pitchGlyphAria: 'Pitch contour: {type}',
  pitchPickerLabel: 'Where does the pitch drop?',
  pitchParticle: 'particle',
  moraLabel: 'Mora {n}: {kana}',
  pitchHeiban: 'Flat',
  pitchAtamadaka: 'Head-high',
  pitchNakadaka: 'Mid-high',
  pitchOdaka: 'Tail-high',

  /* ── feedback lines (Sensei voice) ───────────────────────────────────── */
  correct: 'Correct.',
  miss: "Again. That's the training.",
  near: 'Blocked. Almost.',
  guard: 'Good. Now you know what to train.',
  timeout: 'Time. Here is the form.',
  kanaOnlyGood: 'Kana accepted. The kanji comes with time.',
  kanaOnlyHard: 'Right word. From Green, the kanji counts.',
  particleSlip: 'The word is right. The particle slipped.',
  overrideLogged: 'Noted. The inspector may ask about this one.',
  firstTry: 'First try.',
  afterFix: 'Fixed once. Hard.',

  /* ── labels ──────────────────────────────────────────────────────────── */
  correctForm: 'Correct form',
  alsoAccepted: 'Also accepted',
  yours: 'Yours',
  collocations: 'Often with',
  definition: 'Definition',
  mnemonic: 'Mnemonic',
  components: 'Parts',
  confusable: 'Easily confused with',
  explanation: 'Why',
  reading: 'Reading',
  meaning: 'Meaning',
  dictionaryForm: 'Dictionary form',
  instruction: 'Instruction',
  replaysLeft: '{n} replays left',
  noReplaysLeft: 'No replays left',
  secondReplayCeiling: 'Second replay: the best this rep can earn is Hard.',

  /* ── why lines by error kind ─────────────────────────────────────────── */
  whySmallKana: 'Small っ or ゃ: a stop or a glide changes the word.',
  whyVowelLength: 'Long vowel: one beat longer or shorter is a different word.',
  whyTranscription: 'One character off.',
  whyVoicing: 'Voicing: the dakuten changes the consonant.',
  whyParticle: 'The particle sets the role of the word before it.',
  whyScriptKatakana: 'Katakana here.',
  whyScriptHiragana: 'Hiragana here.',
  whyPitch: 'The drop comes after mora {mora}.',
  whyPitchFlat: 'No drop: the pitch stays up.',
  whyWordOrder: 'Particles travel with their word; the verb closes the sentence.',
  whyConjugation: 'Check the verb group, then the form.',
  whyKanjiReading: 'This word carries a different reading of the kanji.',
  whyKanjiMeaning: 'Same parts, different kanji.',
  whyRegister: 'Right idea, wrong register for the listener.',
  whyWordChoice: 'Close in meaning, different in use.',
  whyListening: 'Replay once and listen for the beats.',
  whyAizuchi: 'A short はい or ええ keeps the conversation moving.',

  /* ── fluency / arcade ────────────────────────────────────────────────── */
  roundOver: 'Round over.',
  recheckNote: 'Misses come back untimed next session.',
  personalBest: 'Personal best',
  reactionTime: 'Reaction time',
  lanternDims: 'The lantern dims.',
  freePlay: 'Free play. XP was earned on the first run today.',
  combo: 'combo',
  secondsLeft: '{n} s left',

  /* ── nemesis ─────────────────────────────────────────────────────────── */
  nemesisTitle: 'Nemesis',
  nemesisIntro: 'This one keeps slipping. Study the dossier; the duel comes later.',
  extraSentences: 'In context',
  duelProgress: 'Duel {n} of 3',

  /* ── misc states ─────────────────────────────────────────────────────── */
  loading: 'Loading…',
  noAudio: 'No voice available. Read the kana instead.',
  itemMissing: 'This item is not in the loaded content. Skipping is fine.',
  nothingTyped: 'Type something first.',
  hintUsed: 'Hint used: the best this rep can earn is Hard.',
} as const;

/** One line of *why* for a near miss or a tagged miss (design 04 §0 "Feedback"). */
export const WHY_BY_TAG: Record<ErrorTag, string> = {
  particle: S.whyParticle,
  conjugation: S.whyConjugation,
  'vowel-length': S.whyVowelLength,
  voicing: S.whyVoicing,
  'small-kana': S.whySmallKana,
  'kanji-reading': S.whyKanjiReading,
  'kanji-meaning': S.whyKanjiMeaning,
  'word-choice': S.whyWordChoice,
  register: S.whyRegister,
  'word-order': S.whyWordOrder,
  pitch: S.whyPitch,
  transcription: S.whyTranscription,
  aizuchi: S.whyAizuchi,
  listening: S.whyListening,
};

/** Why line for a `nearMissKind` result. */
export const WHY_BY_NEAR_MISS: Record<NearMissKind, string> = {
  'small-kana': S.whySmallKana,
  'vowel-length': S.whyVowelLength,
  transcription: S.whyTranscription,
};

export type PitchType = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';

/** English label + the kanji name (shown together so the kanji is never the only signal). */
export const PITCH_TYPE_LABEL: Record<PitchType, { en: string; ja: string }> = {
  heiban: { en: S.pitchHeiban, ja: '平板' },
  atamadaka: { en: S.pitchAtamadaka, ja: '頭高' },
  nakadaka: { en: S.pitchNakadaka, ja: '中高' },
  odaka: { en: S.pitchOdaka, ja: '尾高' },
};
