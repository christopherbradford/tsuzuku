/**
 * TSUZUKU — banned UI copy (design 01 §3, 06 §7).
 *
 * Shame, guilt, urgency and hype have no place in the Sensei voice. The CI
 * lint (`banned.test.ts`) greps every `strings.ts` and every `.tsx` under
 * `src/` against this list. Each entry is a case-insensitive RegExp; keep
 * them narrow enough that honest copy ("Not yet.", "Again.") never trips.
 *
 * Streak shame        "You lost your streak", "Don't break (your streak)", "Streak at risk"
 * Guilt               "Don't let … down", "You let … down", "we miss you", "lazy"
 * Urgency / countdown "Only X hours left", "Hurry", "Last chance", "Act now", "Expires", "Before it's too late"
 * Hype                "You're on fire", "Oops", "Awesome job", "Insert coin", emoji spam
 * Guilt exclamations  a shame word followed by an exclamation mark
 */

export const BANNED: RegExp[] = [
  // streak shame
  /you (have |'ve |’ve )?lost your streak/i,
  /don(’|')?t break( your| the)?( streak)?\b/i,
  /streak (is )?(at risk|in danger|about to (end|break))/i,
  /keep your streak alive/i,
  /your streak (will|is going to) (end|break|die)/i,

  // guilt
  /don(’|')?t let [^.!?\n]{0,40}down/i,
  /you let [^.!?\n]{0,40}down/i,
  /we miss(ed)? you/i,
  /\blazy\b/i,
  /\bslacking\b/i,
  /you (should|ought to) (be )?(ashamed|embarrassed)/i,
  /\bshame on you\b/i,

  // urgency and countdowns
  /\bonly \d+ (more )?(hours?|minutes?|days?|seconds?) (left|remain)/i,
  /\b\d+ (hours?|minutes?|seconds?) (left|remaining) (to|before|until)\b/i,
  /\bhurry( up)?\b/i,
  /\blast chance\b/i,
  /\bact now\b/i,
  /\bexpires? (in|soon|today|tonight)\b/i,
  /\bbefore (it(’|')?s|its) too late\b/i,
  /\blimited[- ]time\b/i,
  /\bdon(’|')?t miss (out|this|your)\b/i,
  /\btime is running out\b/i,
  /\bclock is ticking\b/i,

  // hype and arcade clichés the design forbids ("Insert Coin" stays: it is a kakejiku title, 06 §3;
  // the okaeri screen's "insert coin" prompt is a design review item, not a grep)
  /\byou(’|')?re on fire\b/i,
  /\boops\b/i,
  /\bawesome (job|work)\b/i,
  /\bsuper (job|work|star)\b/i,
  /\bgame over\b/i,
  /\byou (died|lost a life|are dead)\b/i,
  /\bepic fail\b/i,

  // guilt exclamations: a shame word, then "!"
  /\b(wrong|incorrect|missed|lost|failed|failure|broke|broken|too bad|oh no|nope|try again)[^.!?\n]{0,30}!/i,

  // emoji spam: three or more pictographs in a row
  /(?:\p{Extended_Pictographic}️?){3,}/iu,
];

export interface BannedHit {
  /** The regex that matched (its `source` names the rule). */
  rule: RegExp;
  /** The offending text. */
  match: string;
  /** Character offset of the match in the scanned text. */
  index: number;
}

/** Every banned match in `text`, in document order. */
export function findBanned(text: string): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const rule of BANNED) {
    const re = new RegExp(rule.source, rule.flags.includes('g') ? rule.flags : `${rule.flags}g`);
    for (const m of text.matchAll(re)) {
      hits.push({ rule, match: m[0], index: m.index ?? 0 });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Line number (1-based) of a character offset. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
