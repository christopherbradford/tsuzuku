/**
 * TSUZUKU — kanji drill copy (Sensei voice, design 01 §3 / 04 §3).
 *
 * Every user-visible string of `src/exercises/kanji/**` lives here (ARCHITECTURE §8),
 * linted by `src/i18n/banned.test.ts`. Shared drill copy (controls, Sensei
 * feedback lines, labels such as "Mnemonic" / "Parts") stays in
 * `src/exercises/strings.ts`; this file holds what only the kanji drills say.
 * Templates use `{name}` placeholders filled with `fill()`.
 */
export { fill } from '../strings';

export const S = {
  /* ── 部品 Component Flash ─────────────────────────────────────────────── */
  componentPromptChoices: 'Choose the keyword for this part.',
  componentPromptTyped: 'Type the keyword for this part.',
  componentGlyph: 'Component glyph',
  componentKeyword: 'Keyword',
  componentHint: 'Visual hint',
  componentVariants: 'Also written',
  componentShowHint: 'Show the visual hint',

  /* ── 部品組み Component Assembly ──────────────────────────────────────── */
  assemblyPrompt: 'Build the kanji from its parts.',
  assemblyFrame: 'Kanji frame',
  assemblyLayoutLr: 'left and right',
  assemblyLayoutTb: 'top and bottom',
  assemblyLayoutEnc: 'outside and inside',
  assemblyLayoutLabel: 'Layout: {layout}',
  assemblySlot: 'Part {n}',
  assemblySlotEmpty: 'empty',
  assemblySlotFilled: 'Part {n}: {part}. Tap to remove.',
  assemblyTiles: 'Parts to choose from',
  assemblyTile: '{part}',
  assemblyTileUsed: '{part}, placed',
  assemblyCheck: 'Check',
  assemblyClear: 'Clear',
  assemblyShowMnemonic: 'Show the mnemonic',
  assemblyOrderNote: 'Right parts. In this kanji, {first} sits {where}.',
  assemblyWhereLeft: 'on the left',
  assemblyWhereTop: 'on top',
  assemblyWhereOutside: 'outside',
  assemblyAnswer: 'The parts were {parts}.',
  assemblyLoading: 'Fetching the parts…',
  assemblyNoParts: 'The parts for this kanji are not in the loaded content.',

  /* ── 文中読み Kanji Read ───────────────────────────────────────────────── */
  readPrompt: 'Type the reading of the highlighted word.',
  readPromptWord: 'Type the reading of this word.',
  readTarget: 'Target word',
  readShowGloss: 'Show the meaning',
  readGloss: 'Meaning',

  /* ── 似字対決 Lookalike Duel ──────────────────────────────────────────── */
  lookalikePrompt: 'Which kanji fits the blank?',
  lookalikePromptWord: 'Which kanji completes this word?',
  lookalikeBlank: 'blank',
  lookalikeReading: 'read',
  lookalikeShownNotTested: 'Shown, not tested: not enough look-alikes were available for this kanji.',

  /* ── 書き取り Kanji Write ─────────────────────────────────────────────── */
  writePrompt: 'Write the kanji from memory, then reveal it.',
  writeOptIn: 'Handwriting is practice. It never gates anything.',
  writePad: 'Scratch pad',
  writePadHelp: 'Draw with a finger or a mouse, or write on paper.',
  writeNoCanvas: 'Drawing is not available here. Write on paper, then reveal.',
  writeClear: 'Clear pad',
  writeReveal: 'Reveal',
  writeOverlay: 'The kanji sits at low opacity over your strokes. Compare, then rate yourself.',
  writeRate: 'How close was it?',
  writeRateAgain: 'Not yet',
  writeRateHard: 'Close',
  writeRateGood: 'Got it',
  writeStrokes: '{n} strokes',
  writeInspecting: 'The inspector has a question first.',

  /* ── shared kanji states ──────────────────────────────────────────────── */
  cannotBuild: 'This card could not be built from the loaded content.',
  shownNotTested: 'Shown, not tested.',
  continue: 'Continue',
  hintUsedNote: 'Hint used: the best this rep can earn is Hard.',
  kanjiLabel: 'Kanji',
  onReading: 'On',
  kunReading: 'Kun',
} as const;
