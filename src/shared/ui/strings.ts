/**
 * TSUZUKU — shared UI copy (Sensei voice, design 01 §3).
 * Linted by `src/i18n/banned.test.ts`. Values are plain strings only;
 * templating happens in the components (`{belt}`, `{n}`).
 */
import type { ErrorTag } from '../../content/types';
import type { ItemBelt } from '../store-types';

export const S = {
  // Feedback headlines
  correct: 'Correct.',
  near: 'Blocked. Almost.',
  wrong: "Again. That's the training.",
  guard: 'Good. Now you know what to train.',
  timeout: 'Time. Here is the form.',
  info: 'Note.',
  answerLabel: 'Correct form',
  givenLabel: 'Yours',
  again: 'Once more',
  continue: 'Continue',
  recovery: 'Recovered. Half your combo returns.',
  ippon: 'Ippon',
  kiai: 'Kiai',
  promoted: 'Promoted to {belt} belt',
  judgePass: 'The inspector agrees. Well calibrated.',
  judgeFail: 'The inspector saw it differently. Again on this one.',
  diffLegend: 'Struck characters were extra; dotted characters were missing.',

  // Frame controls
  guardButton: "Don't know",
  hintButton: 'Hint',
  pauseButton: 'Pause',
  resumeButton: 'Resume',
  paused: 'Paused. The dojo waits.',
  stepOf: 'Step {i} of {n}',
  ki: 'Ki',
  combo: 'combo',
  secondsLeft: '{n} s',
  newItem: 'New',
  recoveryStep: 'Recovery',
  relearnStep: 'Relearn',
  introStep: 'Intro',

  // Kana input
  answerField: 'Answer',
  katakanaToggle: 'Katakana mode',
  candidatesHint: 'Space cycles kanji',
  pendingLabel: 'Pending romaji',

  // Ruby
  reveal: 'Show reading',

  // Judge
  judgeTitle: 'Inspection',
  judgeLine: 'The inspector checks everyone.',
  judgeMeaningPrompt: 'Which meaning did you have in mind?',
  judgeRubricPrompt: 'Does your sentence contain this?',
  judgeYes: 'Yes, it is there',
  judgeNo: 'No',
  judgePairPrompt: 'Which did you hear?',
  replay: 'Replay',
} as const;

export const TAG_LABEL: Record<ErrorTag, string> = {
  particle: 'particle',
  conjugation: 'conjugation',
  'vowel-length': 'vowel length',
  voicing: 'voicing',
  'small-kana': 'small kana',
  'kanji-reading': 'kanji reading',
  'kanji-meaning': 'kanji meaning',
  'word-choice': 'word choice',
  register: 'register',
  'word-order': 'word order',
  pitch: 'pitch',
  transcription: 'transcription',
  aizuchi: 'aizuchi',
  listening: 'listening',
};

export const BELT_LABEL: Record<ItemBelt, { en: string; ja: string }> = {
  white: { en: 'White', ja: '白帯' },
  yellow: { en: 'Yellow', ja: '黄帯' },
  green: { en: 'Green', ja: '緑帯' },
  brown: { en: 'Brown', ja: '茶帯' },
  black: { en: 'Black', ja: '黒帯' },
};

/** Fills `{key}` placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
