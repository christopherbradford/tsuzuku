/**
 * TSUZUKU — aizuchi (相槌) slots for Taiwa role-play (design 04 §8, 05 §7).
 *
 *  - Slots come from content first: every NPC line with `aizuchiSlot: true`.
 *    Only when a dialogue has NO marks at all does the heuristic fire: an NPC
 *    line whose plain text has a 、 after ≥ 12 characters (a natural pause the
 *    listener fills).
 *  - Backchannel sets: polite はい・ええ・そうですね・へえ・なるほど…; casual
 *    うん・へー・そっか… (はい/ええ/そうですね at Station 7, the full set by 24).
 *  - Window: 2.5 s Yellow–Orange (feedback only, never tagged), 1.8 s Green,
 *    1.2 s from Blue. A missed slot is tagged `aizuchi` only from Green.
 *
 * Pure: belts and lines in, decisions out.
 */
import type { Belt, StoryItem, StoryLine } from '../../content/types';
import { toPlain } from '../../content/ruby';
import { normalizeAnswer } from '../../shared/jp';

export type AizuchiRegister = 'polite' | 'casual';

/** The backchannel sets (design 04 §8; 02 §1 Stations 7 and 24). */
export const AIZUCHI: Readonly<Record<AizuchiRegister, readonly string[]>> = {
  polite: ['はい', 'ええ', 'そうですね', 'へえ', 'なるほど', 'そうですか', 'はいはい', 'ええ、ええ', 'そうなんですね', 'いいですね'],
  casual: ['うん', 'へー', 'へえ', 'そっか', 'なるほど', 'そうなんだ', 'うんうん', 'そうそう', 'ほんと', 'いいね', 'マジで', 'まじで'],
};

/** Response window by belt (ms). */
export const AIZUCHI_WINDOW_MS = { early: 2500, green: 1800, blue: 1200 } as const;

/** Heuristic: a 、 after this many plain characters marks a pause. */
export const HEURISTIC_MIN_CHARS = 12;

const BELT_RANK: Record<Belt, number> = { white: 0, yellow: 1, orange: 2, green: 3, blue: 4, purple: 5, brown: 6, black: 7 };

export function windowMs(belt: Belt): number {
  const r = BELT_RANK[belt];
  if (r <= BELT_RANK.orange) return AIZUCHI_WINDOW_MS.early;
  if (r === BELT_RANK.green) return AIZUCHI_WINDOW_MS.green;
  return AIZUCHI_WINDOW_MS.blue;
}

/** A missed slot is tagged `aizuchi` only from Green. */
export function tagsFrom(belt: Belt): boolean {
  return BELT_RANK[belt] >= BELT_RANK.green;
}

/** The backchannel register of a dialogue (`StoryItem.register`). */
export function aizuchiRegisterOf(story: Pick<StoryItem, 'register'>): AizuchiRegister {
  return story.register === 'casual' || story.register === 'slang' || story.register === 'dialect' ? 'casual' : 'polite';
}

export interface AizuchiSlot {
  lineIndex: number;
  /** Marked by the writer (`aizuchiSlot: true`) rather than inferred. */
  fromContent: boolean;
}

function isNpc(line: StoryLine, learnerSpeaker?: string): boolean {
  return learnerSpeaker === undefined || line.speaker !== learnerSpeaker;
}

/** Heuristic pause: a 、 whose plain-text offset is ≥ 12 characters. */
export function hasHeuristicPause(line: StoryLine): boolean {
  const plain = toPlain(line.ja);
  let seen = 0;
  for (const ch of plain) {
    if (ch === '、') {
      if (seen >= HEURISTIC_MIN_CHARS) return true;
    } else if (!/[\s。！？!?「」]/.test(ch)) seen++;
  }
  return false;
}

/**
 * Slot line indices. Content marks win outright; the heuristic runs only when
 * the dialogue carries none, and only on NPC lines (never the learner's own).
 */
export function aizuchiSlots(lines: readonly StoryLine[], learnerSpeaker?: string): AizuchiSlot[] {
  const marked: AizuchiSlot[] = [];
  lines.forEach((l, i) => {
    if (l.aizuchiSlot === true && isNpc(l, learnerSpeaker)) marked.push({ lineIndex: i, fromContent: true });
  });
  if (marked.length > 0) return marked;
  const inferred: AizuchiSlot[] = [];
  lines.forEach((l, i) => {
    if (isNpc(l, learnerSpeaker) && hasHeuristicPause(l)) inferred.push({ lineIndex: i, fromContent: false });
  });
  return inferred;
}

function keyOf(s: string): string {
  return normalizeAnswer(s);
}

/** Membership in a backchannel set (punctuation / width / kana variants folded). */
export function isAizuchi(text: string, register?: AizuchiRegister): boolean {
  const k = keyOf(text);
  if (k.length === 0) return false;
  const sets = register ? [AIZUCHI[register]] : [AIZUCHI.polite, AIZUCHI.casual];
  return sets.some((set) => set.some((a) => keyOf(a) === k));
}

export interface SlotScore {
  /** A backchannel from either set landed inside the window. */
  hit: boolean;
  /** Tag `aizuchi` on the attempt (missed slot from Green). */
  tag: boolean;
  /** Backchannel given but after the window closed. */
  late: boolean;
  /** The backchannel belonged to the dialogue's register (うん in a polite dialogue is a hit, but off-register). */
  registerOk: boolean;
}

/**
 * Scores one slot. `responseMs` is the time from the end of the NPC line to the
 * learner's tap / utterance (`null` = nothing); `text` is the chosen chip or
 * recognized text (`null` with a non-null time = a tap on a chip of the set).
 */
export function scoreSlot(responseMs: number | null, text: string | null, register: AizuchiRegister, belt: Belt): SlotScore {
  const window = windowMs(belt);
  const valid = text === null ? true : isAizuchi(text);
  const registerOk = text === null ? true : isAizuchi(text, register);
  const answered = responseMs !== null && Number.isFinite(responseMs) && responseMs >= 0 && valid;
  const inTime = answered && (responseMs as number) <= window;
  const hit = inTime;
  return { hit, tag: !hit && tagsFrom(belt), late: answered && !inTime, registerOk: hit ? registerOk : false };
}

/** The chips to offer at a slot (the dialogue's register first, 4–5 chips). */
export function aizuchiChips(register: AizuchiRegister, n = 4): string[] {
  return AIZUCHI[register].slice(0, Math.max(1, n));
}
