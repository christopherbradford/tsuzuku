/**
 * TSUZUKU — pure logic behind <RolePlay> (design 04 §8, 05 §7).
 *
 * Turn planning (who speaks, where the aizuchi slots are, which register each
 * line is scored against), the per-mode line outcomes built on
 * `options.ts` graders, a kana-aware retry of `gradeTyped`, and the debrief
 * summary. No DOM, no store, no clock: everything a test or E's builder can
 * call directly. `RolePlay.tsx` re-exports all of it.
 */
import { KANJI_RE, segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import type { ContentItem, ErrorTag, RegisterTag, StoryItem, StoryLine } from '@/content/types';
import { aizuchiSlots, type SlotScore } from './aizuchi';
import { gradeBuild, gradeOption, gradeTyped, type DialogueOption } from './options';

export type TaiwaMode = 'choose' | 'build' | 'type' | 'speak';

/** The NPC continues this long after the aizuchi window closes (the visible pause). */
export const AIZUCHI_PAUSE_MS = 700;
/** Speak mode cap per line (design 04 §6). */
export const SPEAK_MAX_MS = 8000;
/** Implicit prod grades apply to cards due within this many days (design 05 §4). */
export const IMPLICIT_WINDOW_DAYS = 3;

export function isStoryItem(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && 'comprehension' in i && Array.isArray((i as StoryItem).lines);
}

/** The role the learner plays: `learnerSpeaker`, else the second speaker by appearance; `null` when there is none. */
export function resolveLearnerSpeaker(story: Pick<StoryItem, 'learnerSpeaker' | 'lines'>): string | null {
  const speakers: string[] = [];
  for (const l of story.lines) if (l.speaker && !speakers.includes(l.speaker)) speakers.push(l.speaker);
  if (story.learnerSpeaker && speakers.includes(story.learnerSpeaker)) return story.learnerSpeaker;
  return speakers.length >= 2 ? (speakers[1] as string) : null;
}

/** The register each line is scored against: the latest `registerTarget` at or before it, else `initial`. */
export function registerTargets(lines: readonly StoryLine[], initial: RegisterTag): RegisterTag[] {
  let cur = initial;
  return lines.map((l) => {
    if (l.registerTarget) cur = l.registerTarget;
    return cur;
  });
}

export interface Turn {
  lineIndex: number;
  role: 'npc' | 'learner';
  /** An aizuchi slot opens after this NPC line. */
  slot: boolean;
  register: RegisterTag;
}

/** One turn per line, in order. */
export function turnPlan(story: StoryItem, learner: string, initial: RegisterTag): Turn[] {
  const slots = new Set(aizuchiSlots(story.lines, learner).map((s) => s.lineIndex));
  const regs = registerTargets(story.lines, initial);
  return story.lines.map((l, i) => ({
    lineIndex: i,
    role: l.speaker === learner ? 'learner' : 'npc',
    slot: l.speaker !== learner && slots.has(i),
    register: regs[i] as RegisterTag,
  }));
}

export type LineKind = 'best' | 'ok' | 'near' | 'wrong';

export interface LineOutcome {
  lineIndex: number;
  kind: LineKind;
  given: string;
  recast: string;
  tags: ErrorTag[];
  registerOk: boolean;
  hintUsed: boolean;
  ms: number;
}

export interface SlotOutcome {
  lineIndex: number;
  score: SlotScore;
  text: string | null;
  ms: number | null;
}

export interface RolePlayResult {
  best: number;
  total: number;
  aizuchiHit: number;
  aizuchiTotal: number;
  registerOk: boolean;
}

/** A chosen option as a line outcome. */
export function outcomeFromOption(lineIndex: number, opt: DialogueOption, gold: string, ms: number): LineOutcome {
  const g = gradeOption(opt, gold);
  return {
    lineIndex,
    kind: g.best ? 'best' : g.correct ? 'ok' : 'wrong',
    given: opt.text,
    recast: opt.recast,
    tags: g.tags,
    registerOk: opt.kind !== 'register-wrong',
    hintUsed: false,
    ms,
  };
}

/** Plain token → kana reading for the line's kanji-bearing tokens (飲みます → のみます), from its own ruby. */
export function tokenReadings(line: StoryLine): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of segmentsToTokens(line.ja, line.tokens)) {
    if (!KANJI_RE.test(t.token)) continue;
    const kana = toKana(t.ja);
    if (kana !== t.token) m.set(t.token, kana);
  }
  return m;
}

/** `text` with every kanji-bearing token of the line replaced by its reading, longest tokens first. */
export function kanaVariant(text: string, readings: Map<string, string>): string {
  let out = text;
  for (const [tok, kana] of Array.from(readings.entries()).sort((a, b) => b[0].length - a[0].length)) out = out.split(tok).join(kana);
  return out;
}

/**
 * `gradeTyped`, then — when it did not accept verbatim — once more against the
 * line's `accept[]` / `mustInclude` spelled in kana (the readings the line's own
 * ruby gives), so a learner who types かな for a word written in kanji is not
 * marked `word-choice`. The better of the two grades wins.
 */
export function gradeTypedKanaAware(answer: string, line: StoryLine, register: RegisterTag): ReturnType<typeof gradeTyped> {
  const g = gradeTyped(answer, line, { register });
  if (g.best) return g;
  const readings = tokenReadings(line);
  if (readings.size === 0) return g;
  const kanaLine: StoryLine = {
    ...line,
    accept: (line.accept ?? []).map((a) => kanaVariant(a, readings)),
    mustInclude: (line.mustInclude ?? []).map((w) => kanaVariant(w, readings)),
  };
  const k = gradeTyped(answer, kanaLine, { register });
  if (k.best) return k;
  if (!g.correct && k.correct) return k;
  if (!g.correct && !k.correct && k.tags.length < g.tags.length) return k;
  return g;
}

/** A typed or recognized line as a line outcome (`hintUsed` caps best at ok). */
export function outcomeFromTyped(lineIndex: number, answer: string, line: StoryLine, register: RegisterTag, ms: number, hintUsed = false): LineOutcome {
  const g = gradeTypedKanaAware(answer, line, register);
  let kind: LineKind = g.best ? 'best' : g.nearMiss ? 'near' : g.correct ? 'ok' : 'wrong';
  if (hintUsed && kind === 'best') kind = 'ok';
  return { lineIndex, kind, given: answer, recast: g.recast, tags: g.tags, registerOk: g.best || g.registerOk, hintUsed, ms };
}

/** Built tiles as a line outcome. */
export function outcomeFromBuild(lineIndex: number, order: readonly string[], line: StoryLine, ms: number): LineOutcome {
  const g = gradeBuild(order, line);
  return { lineIndex, kind: g.correct ? 'best' : 'wrong', given: order.join(''), recast: toPlain(line.ja), tags: g.tags, registerOk: true, hintUsed: false, ms };
}

export function summarize(outcomes: readonly LineOutcome[], slots: readonly SlotOutcome[]): RolePlayResult {
  return {
    best: outcomes.filter((o) => o.kind === 'best').length,
    total: outcomes.length,
    aizuchiHit: slots.filter((s) => s.score.hit).length,
    aizuchiTotal: slots.length,
    registerOk: outcomes.every((o) => o.registerOk),
  };
}
