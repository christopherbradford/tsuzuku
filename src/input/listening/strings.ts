/**
 * TSUZUKU — 聴解 Listening Arena copy (Sensei voice, design 01 §3 / 04 §5).
 *
 * Every user-visible string of `src/input/listening/**` lives here
 * (ARCHITECTURE §8), linted by `src/i18n/banned.test.ts`. Terse, warm, dry;
 * "you", never guilt. Templates use `{name}` placeholders filled with
 * `fill()` (re-exported from `@/shared/ui/strings`).
 */
export { fill } from '@/shared/ui/strings';

export const S = {
  /* ── header ──────────────────────────────────────────────────────────── */
  title: 'Listening Arena',
  titleJa: '聴解',
  speedLabel: 'Speed {rate}×',
  voicesLabel: '{n} voices',
  oneVoiceLabel: '1 voice',

  /* ── listen phase ────────────────────────────────────────────────────── */
  audioOnly: 'Audio only. The transcript opens after the questions.',
  play: 'Play',
  playing: 'Playing…',
  replay: 'Replay',
  replaysLeft: '{n} replays left',
  noReplaysLeft: 'No replays left',
  lineOf: 'Line {i} of {n}',
  toQuestions: 'To the questions',
  noVoice: 'No Japanese voice is available on this device. The lines are shown as text instead; the questions still count.',

  /* ── questions phase ─────────────────────────────────────────────────── */
  questionOf: 'Question {i} of {n}',
  gistPrompt: 'From what you heard:',
  choicePromptEn: 'Which meaning did you hear?',
  choicePromptJa: 'Which line did you hear?',
  dictationPrompt: 'Type the line you heard.',
  choicesLabel: 'Choices',
  choiceN: 'Choice {n}',
  playLine: 'Play the line',
  typedField: 'What you heard',
  submit: 'Submit',
  nothingTyped: 'Type something first.',
  next: 'Next',
  toTranscript: 'To the transcript',
  secondReplayCeiling: 'Second replay: the best this line can earn is Hard.',
  correct: 'Correct.',
  near: 'Close. Hard.',
  wrong: "Again. That's the training.",
  scoreLine: '{pct}% of the morae',
  theLine: 'The line',
  diffLegend: 'Struck characters were extra; dotted characters were missing.',

  /* ── transcript phase ────────────────────────────────────────────────── */
  transcript: 'Transcript',
  relistenRequired: 'One more listen, a touch faster. Then the set is done.',
  relisten: 'Listen again at {rate}×',
  relistening: 'Listening again at {rate}×…',
  relistenDone: 'Faster, and you followed it.',
  showEnglish: 'Show English',
  hideEnglish: 'Hide English',
  speakerLabel: 'Speaker {name}',
  nowSpeaking: 'now speaking',
  finish: 'Finish',

  /* ── result ──────────────────────────────────────────────────────────── */
  resultTitle: 'Set complete',
  resultLine: '{correct} of {total} right at {rate}×',
  resultPass: 'Your ear did the work. The words will follow.',
  resultMiss: 'Listening grows by listening. Same set, another day.',
  tierOffer: 'Clean set. Take the next speed tier?',
  tierAccept: 'Tier {tier} from now',
  tierKeep: 'Stay at this tier',
  tierAccepted: 'Tier {tier}. Every voice in the dojo speaks a little faster now.',
  tierTop: 'Top tier. Nothing left to speed up; keep listening.',
  minutesLogged: '{n} min listened, in the ledger',

  /* ── states ──────────────────────────────────────────────────────────── */
  loading: 'Opening the set.',
  notFound: 'This set is not in the loaded content.',
  noLines: 'This set has no lines to play.',

  /* ── standalone page (#/listen/:id) ──────────────────────────────────── */
  pageNav: 'Where to',
  pageNext: 'Next',
  pageBack: 'Back to the dojo',
  pageStation: 'Station {n}',
  pageRolePlay: 'Play it as a conversation',
  pageRead: 'Read the episode',
  pageAgain: 'Listen again',
  pageTier: 'Your speed tier is {tier}: {rate}×. Change it in Settings.',
  pageLedger: 'Listening minutes go to your ledger when the set is done.',
} as const;
