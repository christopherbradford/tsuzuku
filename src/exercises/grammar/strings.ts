/**
 * TSUZUKU — grammar drill copy (Sensei voice, design 01 §3 / 04 §4).
 *
 * Every user-visible string of `src/exercises/grammar/**` lives here
 * (ARCHITECTURE §8), linted by `src/i18n/banned.test.ts`: Pattern Cloze,
 * Particle Duel, Form Forge, Form Chain, plus the generic copy Transform,
 * Scramble and Judgment Call need (their builder owns no strings file).
 * Shared drill copy (controls, Sensei feedback lines, "Correct form",
 * "Also accepted" …) stays in `src/exercises/strings.ts`. Conjugation form
 * labels and one-line rules are tables here so every grammar drill names a
 * form the same way. Templates use `{name}` placeholders filled with `fill()`.
 */
import type { ConjForm, ConjugablePos } from '@/content/types';

export { fill } from '../strings';

export const S = {
  /* ── 文型穴埋め Pattern Cloze ─────────────────────────────────────────── */
  clozePromptTiles: 'Listen, then choose the missing piece.',
  clozePromptTyped: 'Listen, then type the missing piece.',
  clozeBlank: 'blank',
  clozeGloss: 'Meaning',
  clozePattern: 'Pattern',
  clozeShowPattern: 'Show the pattern',
  clozeReplay: 'Replay the sentence',
  clozeTiles: 'Pieces',
  clozeSentence: 'Sentence',

  /* ── 助詞対決 Particle Duel ───────────────────────────────────────────── */
  particlePrompt: 'Choose the particle for each slot.',
  particlePromptOne: 'Choose the particle.',
  particleKeyboard: 'Particles',
  particleKey: 'Particle {particle}',
  particleSlot: 'Slot {n}',
  particleSlotEmpty: 'empty',
  particleSlotFilled: 'Slot {n}: {particle}. Tap to change.',
  particleCheck: 'Check',
  particleClear: 'Clear',
  particleHits: '{hits} of {n} slots right.',
  particleShowPattern: 'Show the pattern',

  /* ── 活用鍛造 Form Forge ──────────────────────────────────────────────── */
  forgePrompt: 'Make the {form}.',
  forgeDictionary: 'Dictionary form',
  forgeTarget: 'Target form',
  forgeShowRule: 'Show the rule',
  forgeRule: 'Rule',
  forgeGroup: 'Group',
  forgeNoForm: 'This form does not exist for this word.',

  /* ── 活用連鎖 Form Chain ──────────────────────────────────────────────── */
  chainPrompt: 'One word, {n} forms. Type each in turn.',
  chainStep: 'Form {i} of {n}',
  chainLog: 'Forms so far',
  chainTally: '{hits} of {n} forms right.',
  chainPerfect: 'Every form clean. Good.',
  chainOneMiss: 'One form slipped. Hard.',
  chainMany: 'More than one slipped. Again, and the rules are below.',
  chainStepRight: 'right',
  chainStepClose: 'close',
  chainStepMiss: 'miss',

  /* ── 変換 Transform (generic copy for the other grammar builder) ─────── */
  transformPrompt: 'Rewrite the sentence as instructed.',
  transformInstruction: 'Instruction',
  transformOriginal: 'Original',
  transformYours: 'Your version',
  transformRegister: 'Register',

  /* ── 並べ替え Scramble ────────────────────────────────────────────────── */
  scramblePrompt: 'Put the pieces in order.',
  scrambleEnglish: 'English',
  scrambleYourOrder: 'Your order',
  scrambleFixes: '{n} fixes',
  scrambleOneFix: '1 fix',
  scrambleNoFix: 'First try',
  scrambleRemovePiece: 'Remove {piece}',
  scrambleAddPiece: 'Add {piece}',

  /* ── 自然か Judgment Call ─────────────────────────────────────────────── */
  judgmentPrompt: 'Natural, or not?',
  judgmentNatural: 'Natural',
  judgmentUnnatural: 'Not natural',
  judgmentWhy: 'Why',
  judgmentCorrected: 'Corrected',
  judgmentMistake: 'The slip',
  judgmentIsNatural: 'This one is natural.',
  judgmentIsUnnatural: 'This one is not natural.',

  /* ── shared grammar states ────────────────────────────────────────────── */
  cannotBuild: 'This card could not be built from the loaded content.',
  shownNotTested: 'Shown, not tested.',
  continue: 'Continue',
  hintUsedNote: 'Hint used: the best this rep can earn is Hard.',
  patternLabel: 'Pattern',
  formationLabel: 'Formation',
  kanaAccepted: 'Kana is accepted here.',
} as const;

/** English label with the Japanese ending, used wherever a form is named. */
export const FORM_LABEL: Record<ConjForm, string> = {
  masu: 'polite present (〜ます)',
  masen: 'polite negative (〜ません)',
  mashita: 'polite past (〜ました)',
  'masen-deshita': 'polite past negative (〜ませんでした)',
  masho: 'polite volitional (〜ましょう)',
  te: 'て-form',
  nai: 'plain negative (〜ない)',
  ta: 'plain past (〜た)',
  nakatta: 'plain past negative (〜なかった)',
  potential: 'potential (can do)',
  volitional: 'volitional (shall we)',
  passive: 'passive (〜れる / 〜られる)',
  causative: 'causative (make or let do)',
  'causative-passive': 'causative-passive (be made to do)',
  imperative: 'imperative (command)',
  prohibitive: 'prohibitive (〜な, do not)',
  ba: 'conditional (〜ば)',
  tara: 'conditional (〜たら)',
  tai: 'desire (〜たい)',
  'te-iru': 'progressive or state (〜ている)',
  'adj-neg': 'negative (〜くない / 〜じゃない)',
  'adj-past': 'past (〜かった / 〜だった)',
  'adj-past-neg': 'past negative (〜くなかった / 〜じゃなかった)',
  'adj-te': 'て-form (〜くて / 〜で)',
  'adj-adv': 'adverbial (〜く / 〜に)',
  'adj-ba': 'conditional (〜ければ / 〜なら)',
};

/** One-line rule per form; shown as the hint in Form Forge and after a Form Chain miss. */
export const FORM_HINT: Record<ConjForm, string> = {
  masu: 'Group 1: last kana to its い-row, then ます (飲む → 飲みます). Group 2: drop る, add ます.',
  masen: 'Build the ます-stem, then ません.',
  mashita: 'Build the ます-stem, then ました.',
  'masen-deshita': 'Build the ます-stem, then ませんでした.',
  masho: 'Build the ます-stem, then ましょう.',
  te: 'Group 1 by last kana: う・つ・る → って, む・ぶ・ぬ → んで, く → いて, ぐ → いで, す → して; 行く → 行って. Group 2: drop る, add て.',
  nai: 'Group 1: last kana to its あ-row (う → わ), then ない. Group 2: drop る, add ない. する → しない, 来る → こない.',
  ta: 'The same change as the て-form, with た or だ in place of て or で.',
  nakatta: 'The ない-stem, then なかった.',
  potential: 'Group 1: last kana to its え-row, then る. Group 2: drop る, add られる (れる is colloquial). する → できる.',
  volitional: 'Group 1: last kana to its お-row, then う. Group 2: drop る, add よう. する → しよう, 来る → こよう.',
  passive: 'Group 1: あ-row, then れる. Group 2: drop る, add られる. する → される.',
  causative: 'Group 1: あ-row, then せる. Group 2: drop る, add させる. する → させる.',
  'causative-passive': 'Causative stem, then られる: あ-row + せられる (Group 1 often shortens to される); Group 2: drop る, add させられる.',
  imperative: 'Group 1: last kana to its え-row. Group 2: drop る, add ろ. する → しろ, 来る → こい.',
  prohibitive: 'Dictionary form, then な.',
  ba: 'Last kana to its え-row, then ば. Group 2: drop る, add れば.',
  tara: 'Plain past, then ら.',
  tai: 'The ます-stem, then たい.',
  'te-iru': 'The て-form, then いる.',
  'adj-neg': 'い-adjective: drop い, add くない. な-adjective: add じゃない. いい → よくない.',
  'adj-past': 'い-adjective: drop い, add かった. な-adjective: add だった.',
  'adj-past-neg': 'い-adjective: drop い, add くなかった. な-adjective: add じゃなかった.',
  'adj-te': 'い-adjective: drop い, add くて. な-adjective: add で.',
  'adj-adv': 'い-adjective: drop い, add く. な-adjective: add に.',
  'adj-ba': 'い-adjective: drop い, add ければ. な-adjective: add なら.',
};

/** Verb / adjective group names shown next to the dictionary form. */
export const POS_GROUP_LABEL: Record<ConjugablePos, string> = {
  v1: 'Group 2 verb (る-verb)',
  v5: 'Group 1 verb (う-verb)',
  'v-irr': 'Irregular verb',
  'adj-i': 'い-adjective',
  'adj-na': 'な-adjective',
};
