/**
 * TSUZUKU — store copy (Sensei voice, design 01 §3). Linted by
 * `src/i18n/banned.test.ts`. Plain strings only; templating (`{n}`) happens
 * in the UI that renders them (`fill()` from `shared/ui/strings`).
 */
import type { LedgerKindName } from '../shared/store-types';

export const S = {
  // Tsuzuku Flame (design 03 §7) — states
  flameLit: 'The flame is lit.',
  flameGold: 'Full training day. The flame burns gold.',
  flameEmber: 'Embers. One Kumite or more relights the flame.',
  flameFrozen: 'Frozen. Your place is kept.',
  flameRest: 'Planned rest. Even samurai rest.',
  flameBroken: 'The flame is out. Light it again today.',

  // Streak moments
  freezeApplied: 'Rest is training. A freeze token held the flame.',
  freezeEarned: 'A freeze token for seven straight days.',
  restDayTaken: 'Even samurai rest.',
  emberRestored: 'The flame is back in full.',
  repairOpened: 'Fall seven, rise eight. Train three of the next five days and the count returns.',
  repaired: 'Seven falls, eight rises. Your count is restored.',
  vacationStarted: 'Vacation. The flame is frozen until you return.',
  keptPlace: 'The dojo kept your place.',
  welcomeBackDue: 'Welcome back. The first session is twenty things you still know.',
  totalDays: '{n} days trained',
  currentStreak: '{n}-day streak',

  // Three Kata (design 03 §6)
  questsTitle: 'Three Kata',
  questDone: 'Done',
  questProgress: '{n} of {target}',
  fullDay: 'All three done. Full training day.',

  // XP (design 06 §1) — reasons shown next to "+n"
  xpReason: {
    review: 'review',
    recovery: 'recovery',
    ippon: 'ippon',
    'first-prod': 'first production',
    promotion: 'item belt',
    combo: 'combo',
    introduced: 'new item',
    scroll: 'scroll',
    episode: 'episode',
    'speed-read': 'speed read',
    listening: 'listening set',
    dictation: 'dictation line',
    shadow: 'shadow line',
    'shadow-set': 'shadow set',
    'role-play': 'role-play',
    'three-ways': 'three ways',
    monologue: 'monologue',
    'reduce-expand': 'reduce and expand',
    writing: 'writing dojo',
    'weak-set': 'weak point set',
    'rapid-fire': 'rapid fire',
    michikusa: 'michikusa',
    'full-day': 'full training day',
    gate: 'gatekeeper',
    shinsa: 'shinsa',
    kage: 'kage',
    nemesis: 'nemesis',
    'field-mission': 'field mission',
    'external-input': 'outside input',
    'ledger-entry': 'ledger entry',
  },
  levelUp: 'Level {n}. Effort, counted.',
  levelLine: 'Level = effort. Belt = skill.',

  // Input Ledger 耳目帳 (design 05 §9)
  ledgerTitle: 'Input Ledger',
  ledgerReported: '(reported)',
  ledgerGoal: '1,500 hours of real listening, reading and conversation. The road past Kyoto.',
  ledgerWeekly: 'This week: {h} h of {target} h outside the app.',
  ledgerHoursTotal: '{h} h logged',
  ledgerSourceApp: 'in the app',
  ledgerSourceExternal: 'outside',
  missionLogged: 'Mission logged. Minutes go to the ledger.',
  missionUnknown: 'That mission is not on the list.',
  firstConversation: 'A real conversation. That is the whole point.',

  // Weak Points 弱点 (design 05 §7)
  weakActive: 'Weak point. A three-minute set is in your next Shugyō.',
  weakCleared: 'Weak point cleared.',
  weakNone: 'No weak points right now.',

  // Backup (design 07 §5)
  backupFilename: 'tsuzuku-backup',
  exportDone: 'Saved. Keep it somewhere that is not this browser.',
  importNotJson: 'That file is not readable as a TSUZUKU backup.',
  importNotBackup: 'That file does not look like a TSUZUKU save.',
  importNewer: 'That backup comes from a newer version of TSUZUKU. Update first, then import.',
  importCompressed: 'That is a compressed backup. Choose the file itself, not its text.',
  importTooLarge: 'That file is far larger than any TSUZUKU backup. Choose the backup file itself.',
  importNoShard: 'A card shard in the backup could not be read and was skipped.',
  importNoLog: 'The review log in the backup could not be read and was skipped.',
  importRepaired: 'Some fields in that backup were not readable and will start from their defaults.',
  importMerge: 'Merge: keeps the higher streak and XP, every badge from both, and the newer copy of each card.',
  importReplace: 'Replace: this browser takes the backup exactly, cards included.',
  importApplied: 'Imported. Reload to start from the new save.',
  importInvalid: 'Nothing was changed.',
  summaryStreak: 'Streak',
  summaryXp: 'XP',
  summaryCards: 'Cards',
  summaryBadges: 'Badges',
  summaryDays: 'Days trained',
  summaryGained: '{n} cards gained',
  summaryLost: '{n} cards not in the backup',

  // Home summary
  backlogLine: 'The gatekeeper holds the line. {shown} of your {due} reviews today; the rest wait without penalty.',
  restLine: 'Rest.',
} as const;

export const LEDGER_KIND_LABEL: Record<LedgerKindName, string> = {
  listen: 'listening',
  read: 'reading',
  watch: 'watching',
  speak: 'speaking',
};
