/**
 * TSUZUKU — copy specific to Transform / Scramble / Judgment Call
 * (Sensei voice, design 01 §3 / 04 §4). Generic prompts and controls come
 * from `src/exercises/strings.ts`; this file holds only what these three
 * drills say. Templates use `{name}` placeholders filled with `fill()`.
 */
import type { ConjForm, RegisterTag } from '@/content/types';

export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── Transform ───────────────────────────────────────────────────────── */
  transformPrompt: 'Rewrite the sentence.',
  transformTo: 'Make it {target}.',
  transformWith: 'Rewrite it using {pattern}.',
  transformForm: 'the {form} form',
  original: 'Original',
  target: 'Target',
  hint: 'Hint',
  hintCeiling: 'Hint used: the best this rep can earn is Hard.',
  hintStartsWith: 'It starts with',
  hintPattern: 'Pattern',
  typeRewrite: 'Type the rewritten sentence.',

  /* ── Scramble ────────────────────────────────────────────────────────── */
  scramblePrompt: 'Put the pieces in order.',
  tileBank: 'Pieces',
  answerRow: 'Your sentence',
  emptyRow: 'Tap the pieces in order.',
  placeTile: 'Place {tile}',
  removeTile: 'Remove {tile}',
  undo: 'Undo',
  clearRow: 'Clear',
  check: 'Check',
  firstTry: 'First try.',
  afterFix: 'Fixed once. Hard.',
  manyFixes: 'Several fixes. Again.',
  wrongOrder: 'Not this order.',
  fixCount: '{n} fixes',
  correctOrder: 'Correct order',
  hintPlaced: 'Hint: the next piece was placed for you.',
  nothingToOrder: 'Nothing to order here. Continue.',

  /* ── Judgment Call ───────────────────────────────────────────────────── */
  judgmentPrompt: 'Natural, or not?',
  natural: 'Natural',
  unnatural: 'Not natural',
  explanation: 'Why',
  naturalLine: 'Natural. {pattern} — {meaning}.',
  unnaturalLine: 'Not natural. Say it this way:',
  noExplanation: 'This one follows the pattern as taught.',
  judgmentCorrect: 'Good call.',
  judgmentMiss: 'Not this time. Read the why.',
  noSentence: 'No sentence to judge here. Continue.',
} as const;

/** Conjugation form labels (English first, the Japanese marker beside it). */
export const FORM_LABEL: Record<ConjForm, string> = {
  masu: 'polite (ます)',
  masen: 'polite negative (ません)',
  mashita: 'polite past (ました)',
  'masen-deshita': 'polite past negative (ませんでした)',
  masho: 'polite volitional (ましょう)',
  te: 'te (て)',
  nai: 'plain negative (ない)',
  ta: 'plain past (た)',
  nakatta: 'plain past negative (なかった)',
  potential: 'potential',
  volitional: 'volitional',
  passive: 'passive',
  causative: 'causative',
  'causative-passive': 'causative-passive',
  imperative: 'imperative',
  prohibitive: 'prohibitive (な)',
  ba: 'conditional (ば)',
  tara: 'conditional (たら)',
  tai: 'desire (たい)',
  'te-iru': 'progressive (ている)',
  'adj-neg': 'negative',
  'adj-past': 'past',
  'adj-past-neg': 'past negative',
  'adj-te': 'te',
  'adj-adv': 'adverbial',
  'adj-ba': 'conditional (ば)',
};

/** Register targets as the instruction names them. */
export const REGISTER_LABEL: Record<RegisterTag, string> = {
  neutral: 'neutral',
  polite: 'polite (です・ます)',
  casual: 'casual (plain form)',
  formal: 'formal',
  written: 'written style',
  honorific: 'honorific (sonkeigo)',
  humble: 'humble (kenjōgo)',
  slang: 'slang',
  dialect: 'dialect',
  literary: 'literary',
};
