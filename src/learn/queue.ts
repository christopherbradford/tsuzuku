/**
 * TSUZUKU — queue builder (design 03 §2, 04 §9, §13, 05 §4).
 *
 *  - due selection: Kata order overdue-days × (1 − R) descending regardless of
 *    maturity; in backlog mode most-overdue then lowest-R; an optional Kaiden
 *    lane quota (design 05 §2);
 *  - wave ordering E E E H M H M H M H E E by predicted R (E ≥ 0.9, M 0.8–0.9,
 *    H < 0.8), easy-open / easy-close for the peak-end rule;
 *  - interleave invariants (03 §2.4): no item within `minGap` reps of itself
 *    except +3/+10 steps and Recovery, ≤ `maxSameType` consecutive reps of one
 *    exercise type, facets alternate where possible, `listen` never follows
 *    `listen` of the same word;
 *  - +3/+10 step insertion for new items; Weak Point sets; Rapid Fire / Gojūon
 *    pools (facet S ≥ 14 d); recheck cards (arcade misses, flag 16); prod
 *    prompt rotation (`findBlank`: 〜-affixed words are blanked inside their
 *    host word); Kage pools (15 recent / 15 mature) seeded; exercise choice
 *    per card (04 §13 + the first-2-exposures multiple-choice rule).
 *
 * `RECHECK_FLAG` is `CardFlag.recheck` (16), the arcade-miss bit on `CardTuple[7]`.
 */
import { ERROR_TAGS, type CardKey, type ErrorTag, type ExerciseId, type Facet, type StoryItem, type VocabItem } from '../content/types';
import { CardFlag, hasFlag, type CardsApi, type CardTuple, type EpochDay, type ItemKind, type LogEntry, type Settings } from '../shared/store-types';
import { parseCardKey } from '../shared/ids';
import { rngFor, sample } from '../shared/hash';
import { dayStartMs } from '../shared/time';
import { toPlain } from '../content/ruby';
import { cardRetrievability } from './fsrs';
import { baseFacet } from './item-belt';
import { kindOfCards } from './known';

/** Arcade-miss "re-test untimed next session" bit (design 04 §9) — alias of `CardFlag.recheck`. */
export const RECHECK_FLAG = CardFlag.recheck;
/** Mature = tested facet S ≥ 14 d (one definition everywhere; `grading.ts isMature` is the canonical one). */
const MATURE_DAYS = 14;

export const WAVE_PATTERN = 'EEEHMHMHMHEE';
export const WAVE_EASY_R = 0.9;
export const WAVE_MEDIUM_R = 0.8;
export const DEFAULT_MIN_GAP = 4;
export const DEFAULT_MAX_SAME_TYPE = 3;
export const KAGE_RECENT_DAYS = 14;
export const KAGE_POOL_SIZE = 15;
/** ≈ 3 minutes of reps. */
export const WEAK_SET_SIZE = 20;
export const STEP_PLUS = [3, 10] as const;
export const ARCADE_FACETS: readonly Facet[] = ['rec', 'read', 'cloze'];

export type QueueTag = 'intro' | '+3' | '+10' | 'recovery' | 'relearn';

export interface QueueCard {
  cardKey: CardKey;
  itemId: string;
  kind: ItemKind;
  facet: Facet;
  /** Predicted retrievability today. */
  r: number;
  mature: boolean;
  exposures: number;
  /** Step / recovery marker — exempt from the same-item gap rule. */
  tag?: QueueTag | null;
  /** Resolved exercise (used as the "exercise type" by `interleave` when present). */
  exercise?: ExerciseId;
}

interface Walked {
  key: CardKey;
  itemId: string;
  facet: Facet;
  t: CardTuple;
}

/** One pass over the store: cards plus the facet set of every item (for chunk detection). */
function walk(cards: Pick<CardsApi, 'forEach'>): { list: Walked[]; facets: Map<string, Set<Facet>> } {
  const list: Walked[] = [];
  const facets = new Map<string, Set<Facet>>();
  cards.forEach((key, t) => {
    const { itemId, facet } = parseCardKey(key);
    list.push({ key, itemId, facet, t });
    let set = facets.get(itemId);
    if (!set) {
      set = new Set();
      facets.set(itemId, set);
    }
    set.add(facet);
  });
  return { list, facets };
}

function toQueueCard(wk: Walked, kind: ItemKind, today: EpochDay): QueueCard {
  return {
    cardKey: wk.key,
    itemId: wk.itemId,
    kind,
    facet: wk.facet,
    r: cardRetrievability(wk.t, today),
    mature: wk.t[1] >= MATURE_DAYS,
    exposures: wk.t[3],
  };
}

function byKey(a: { cardKey: string }, b: { cardKey: string }): number {
  return a.cardKey < b.cardKey ? -1 : a.cardKey > b.cardKey ? 1 : 0;
}

/** Kind for a card key, given the item's facet set (chunk detection). */
export function queueKind(itemId: string, facets: Iterable<Facet>): ItemKind | undefined {
  return kindOfCards(itemId, facets);
}

/** QueueCard for one key read from the store (undefined when absent or not an item). */
export function queueCardFor(cards: CardsApi, key: CardKey, today: EpochDay): QueueCard | undefined {
  const t = cards.get(key);
  if (!t) return undefined;
  const { itemId, facet } = parseCardKey(key);
  const kind = kindOfCards(itemId, Object.keys(cards.byItem(itemId)) as Facet[]);
  if (!kind) return undefined;
  return toQueueCard({ key, itemId, facet, t }, kind, today);
}

export interface DueOpts {
  cards: CardsApi;
  today: EpochDay;
  limit: number;
  backlog: boolean;
  /** When set, Kaiden-flagged cards are capped at this many and the rest fill from the main lane. */
  kaidenQuota?: number;
}

/**
 * Due, unarchived, rated cards. Kata order: overdue × (1 − R) desc (then lowest
 * R); backlog: most overdue, then lowest R. Never includes state-0 cards (they
 * are introduced by Scrolls, not reviews).
 */
export function dueCards(o: DueOpts): QueueCard[] {
  const { list, facets } = walk(o.cards);
  type Scored = QueueCard & { overdue: number; score: number; kaiden: boolean };
  const scored: Scored[] = [];
  for (const wk of list) {
    const t = wk.t;
    if (t[5] === 0 || t[0] > o.today || hasFlag(t[7], CardFlag.archived)) continue;
    const kind = kindOfCards(wk.itemId, facets.get(wk.itemId) ?? []);
    if (!kind) continue;
    const qc = toQueueCard(wk, kind, o.today);
    const overdue = o.today - t[0];
    scored.push({ ...qc, overdue, score: overdue * (1 - qc.r), kaiden: hasFlag(t[7], CardFlag.kaiden) });
  }
  const cmp = o.backlog
    ? (a: Scored, b: Scored) => b.overdue - a.overdue || a.r - b.r || byKey(a, b)
    : (a: Scored, b: Scored) => b.score - a.score || a.r - b.r || byKey(a, b);
  scored.sort(cmp);
  const limit = Math.max(0, o.limit);
  let chosen: Scored[];
  if (o.kaidenQuota === undefined) {
    chosen = scored.slice(0, limit);
  } else {
    const quota = Math.max(0, o.kaidenQuota);
    const kaiden = scored.filter((c) => c.kaiden).slice(0, Math.min(quota, limit));
    const main = scored.filter((c) => !c.kaiden).slice(0, Math.max(0, limit - kaiden.length));
    chosen = [...main, ...kaiden].sort(cmp);
  }
  return chosen.map(({ overdue, score, kaiden, ...qc }) => {
    void overdue;
    void score;
    void kaiden;
    return qc;
  });
}

function poolOf(cards: CardsApi, today: EpochDay, keep: (wk: Walked) => boolean): QueueCard[] {
  const { list, facets } = walk(cards);
  const out: QueueCard[] = [];
  for (const wk of list) {
    if (!keep(wk)) continue;
    const kind = kindOfCards(wk.itemId, facets.get(wk.itemId) ?? []);
    if (!kind) continue;
    out.push(toQueueCard(wk, kind, today));
  }
  return out.sort(byKey);
}

/** Gojūon Fighter pool: kana `rec` cards with S ≥ 14 d (archived kana included). */
export function gojuonPool(cards: CardsApi, today: EpochDay): QueueCard[] {
  return poolOf(cards, today, (wk) => wk.itemId.startsWith('k-') && wk.facet === 'rec' && wk.t[5] !== 0 && wk.t[1] >= MATURE_DAYS);
}

/** Cards flagged by an arcade miss, for an untimed re-test. */
export function recheckCards(cards: CardsApi): QueueCard[] {
  return poolOf(cards, 0, (wk) => (wk.t[7] & RECHECK_FLAG) !== 0).map((c) => ({ ...c, r: 0 }));
}

/** Rapid Fire pool: `rec` / `read` / `cloze` cards with S ≥ 14 d (archived included). */
export function rapidFirePool(cards: CardsApi, today: EpochDay): QueueCard[] {
  return poolOf(cards, today, (wk) => ARCADE_FACETS.includes(wk.facet) && wk.t[5] !== 0 && wk.t[1] >= MATURE_DAYS);
}

export interface ProdPrompt {
  /** Plain sentence (ruby stripped). */
  sentence: string;
  kana: string;
  en: string;
  /** `[start, end)` of the target surface in `sentence`; `[0, 0]` when not found. */
  blank: [number, number];
}

const CONJUGABLE = new Set(['v1', 'v5', 'v-irr', 'adj-i', 'adj-na']);
const TILDE_RE = /[〜～]/g;

/**
 * `[start, end)` of the target surface in a plain sentence, `[0, 0]` when not
 * found. Candidates: the word and its alt forms, then — for 〜-prefixed
 * suffixes / counters and 〜-suffixed prefixes (〜放題, 〜巻, お〜) — the bare
 * form attached inside its host word (the last occurrence for a suffix, so
 * 人 in 三人 beats 友人 earlier in the sentence; the first for a prefix), then
 * the kana, then for conjugables the longest stem that occurs. Shared by the
 * prod prompt here, Production Forge and the Nemesis duel.
 */
export function findBlank(plain: string, item: Pick<VocabItem, 'word' | 'kana' | 'pos' | 'altForms'>): [number, number] {
  const full = [item.word, ...(item.altForms ?? [])];
  for (const c of full) {
    if (!c) continue;
    const i = plain.indexOf(c);
    if (i >= 0) return [i, i + c.length];
  }
  for (const c of full) {
    if (!c || !TILDE_RE.test(c)) continue;
    TILDE_RE.lastIndex = 0;
    const bare = c.replace(TILDE_RE, '');
    if (!bare) continue;
    const suffix = /^[〜～]/.test(c);
    const i = suffix ? plain.lastIndexOf(bare) : plain.indexOf(bare);
    if (i >= 0) return [i, i + bare.length];
  }
  TILDE_RE.lastIndex = 0;
  if (item.kana) {
    const i = plain.indexOf(item.kana);
    if (i >= 0) return [i, i + item.kana.length];
  }
  if (CONJUGABLE.has(item.pos)) {
    for (const c of [item.word, item.kana]) {
      for (let len = c.length - 1; len >= 1; len--) {
        const stem = c.slice(0, len);
        const i = plain.indexOf(stem);
        if (i >= 0) return [i, i + len];
      }
    }
  }
  return [0, 0];
}

/** Every prompt for a word: its examples, then story lines whose `tokenIds` name it. */
export function prodPrompts(item: VocabItem, stories: readonly StoryItem[]): ProdPrompt[] {
  const out: ProdPrompt[] = [];
  for (const ex of item.examples) {
    const sentence = toPlain(ex.ja);
    out.push({ sentence, kana: ex.kana, en: ex.en, blank: findBlank(sentence, item) });
  }
  for (const story of stories) {
    for (const line of story.lines) {
      const ids = line.tokenIds;
      if (!ids) continue;
      const idx = ids.indexOf(item.id);
      if (idx < 0) continue;
      let offset = 0;
      for (let i = 0; i < idx; i++) offset += (line.tokens[i] ?? '').length;
      const tok = line.tokens[idx] ?? '';
      const sentence = toPlain(line.ja);
      const blank: [number, number] = tok && sentence.slice(offset, offset + tok.length) === tok ? [offset, offset + tok.length] : findBlank(sentence, item);
      out.push({ sentence, kana: line.kana, en: line.en, blank });
    }
  }
  if (out.length === 0) out.push({ sentence: item.word, kana: item.kana, en: item.meanings[0] ?? '', blank: [0, item.word.length] });
  return out;
}

/** The prompt for rep `rep` (rotates through `prodPrompts`). */
export function prodPrompt(item: VocabItem, stories: StoryItem[], rep: number): ProdPrompt {
  const all = prodPrompts(item, stories);
  const i = ((Math.floor(rep) % all.length) + all.length) % all.length;
  return all[i] as ProdPrompt;
}

type Band = 'E' | 'M' | 'H';

export function waveBand(r: number): Band {
  if (r >= WAVE_EASY_R) return 'E';
  if (r >= WAVE_MEDIUM_R) return 'M';
  return 'H';
}

const FALLBACK: Record<Band, Band[]> = { E: ['E', 'M', 'H'], M: ['M', 'H', 'E'], H: ['H', 'M', 'E'] };

/**
 * Wave order E E E H M H M H M H E E by predicted R. Opens with the easiest
 * cards; the next two easiest are held back to close the set (peak-end).
 */
export function orderWave(cards: QueueCard[]): QueueCard[] {
  if (cards.length <= 2) return cards.slice();
  const sorted = cards.slice().sort((a, b) => b.r - a.r || byKey(a, b));
  const closers = sorted.length >= 5 ? sorted.slice(3, 5) : [];
  const closerKeys = new Set(closers.map((c) => c.cardKey));
  const rest = sorted.filter((c) => !closerKeys.has(c.cardKey));
  const buckets: Record<Band, QueueCard[]> = { E: [], M: [], H: [] };
  for (const c of rest) buckets[waveBand(c.r)].push(c);
  buckets.H.reverse();
  const out: QueueCard[] = [];
  let i = 0;
  while (out.length < rest.length) {
    const want = WAVE_PATTERN[i % WAVE_PATTERN.length] as Band;
    for (const b of FALLBACK[want]) {
      const next = buckets[b].shift();
      if (next) {
        out.push(next);
        break;
      }
    }
    i++;
  }
  return out.concat(closers);
}

export interface InterleaveOpts {
  maxSameType: number;
  minGap: number;
}

/**
 * Exercise type for the run rule: the resolved exercise when the builder set
 * it, else kind:facet split by the first-2-exposures rule (multiple choice vs
 * typed), which is what `exerciseFor` keys on.
 */
function typeOf(c: QueueCard): string {
  return c.exercise ?? `${c.kind}:${c.facet}:${c.exposures < 2 ? 'mc' : 'typed'}`;
}

function isExempt(c: QueueCard): boolean {
  return c.tag !== undefined && c.tag !== null;
}

function fits(out: QueueCard[], c: QueueCard, o: InterleaveOpts): boolean {
  const n = out.length;
  if (n === 0) return true;
  const prev = out[n - 1] as QueueCard;
  if (prev.facet === 'listen' && c.facet === 'listen' && prev.itemId === c.itemId) return false;
  if (!isExempt(c)) {
    for (let j = n - 1; j >= Math.max(0, n - o.minGap); j--) {
      const p = out[j] as QueueCard;
      if (p.itemId === c.itemId && !isExempt(p)) return false;
    }
  }
  let run = 0;
  const t = typeOf(c);
  for (let j = n - 1; j >= 0 && typeOf(out[j] as QueueCard) === t; j--) run++;
  return run < o.maxSameType;
}

/** Counts invariant violations in a sequence (0 = all 03 §2.4 constraints hold). */
export function interleaveViolations(seq: readonly QueueCard[], o: InterleaveOpts = { maxSameType: DEFAULT_MAX_SAME_TYPE, minGap: DEFAULT_MIN_GAP }): number {
  let v = 0;
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i] as QueueCard;
    const prev = seq[i - 1];
    if (prev && prev.facet === 'listen' && c.facet === 'listen' && prev.itemId === c.itemId) v++;
    if (!isExempt(c)) {
      for (let j = i - 1; j >= Math.max(0, i - o.minGap); j--) {
        const p = seq[j] as QueueCard;
        if (p.itemId === c.itemId && !isExempt(p)) {
          v++;
          break;
        }
      }
    }
    let run = 1;
    for (let j = i - 1; j >= 0 && typeOf(seq[j] as QueueCard) === typeOf(c); j--) run++;
    if (run > o.maxSameType) v++;
  }
  return v;
}

function greedy(cards: readonly QueueCard[], o: InterleaveOpts, constrainedFirst: boolean): QueueCard[] {
  const remaining = cards.slice();
  const out: QueueCard[] = [];
  const itemLeft = new Map<string, number>();
  const typeLeft = new Map<string, number>();
  for (const c of cards) {
    itemLeft.set(c.itemId, (itemLeft.get(c.itemId) ?? 0) + 1);
    typeLeft.set(typeOf(c), (typeLeft.get(typeOf(c)) ?? 0) + 1);
  }
  while (remaining.length) {
    const prev = out[out.length - 1];
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i] as QueueCard;
      if (!fits(out, c, o)) continue;
      let score = constrainedFirst ? (itemLeft.get(c.itemId) ?? 0) * 1000 + (typeLeft.get(typeOf(c)) ?? 0) * 10 - i * 0.001 : -i;
      if (prev && prev.facet !== c.facet) score += constrainedFirst ? 1 : 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
      if (!constrainedFirst && prev && prev.facet !== c.facet) break;
    }
    if (bestIdx < 0) {
      // Infeasible tail: take the candidate whose same-item rep is farthest back.
      let far = -1;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i] as QueueCard;
        let dist = out.length + 1;
        for (let j = out.length - 1; j >= 0; j--) {
          if ((out[j] as QueueCard).itemId === c.itemId) {
            dist = out.length - j;
            break;
          }
        }
        if (dist > far) {
          far = dist;
          bestIdx = i;
        }
      }
    }
    const pick = remaining.splice(bestIdx, 1)[0] as QueueCard;
    out.push(pick);
    itemLeft.set(pick.itemId, (itemLeft.get(pick.itemId) ?? 1) - 1);
    typeLeft.set(typeOf(pick), (typeLeft.get(typeOf(pick)) ?? 1) - 1);
  }
  return out;
}

/**
 * Reorders as little as possible so the 03 §2.4 invariants hold: the input
 * order is the priority; when the plain greedy pass leaves violations, a
 * most-constrained-first pass is tried and the better of the two is returned.
 */
export function interleave(cards: QueueCard[], o: InterleaveOpts = { maxSameType: DEFAULT_MAX_SAME_TYPE, minGap: DEFAULT_MIN_GAP }): QueueCard[] {
  const a = greedy(cards, o, false);
  const va = interleaveViolations(a, o);
  if (va === 0) return a;
  const b = greedy(cards, o, true);
  return interleaveViolations(b, o) < va ? b : a;
}

/**
 * Inserts each new card as an `intro` step spread evenly through `seq`, with
 * its `+3` and `+10` re-presentations 3 and 10 reps later (appended when the
 * sequence is shorter). Intros are spaced ≥ 11 apart when the sequence allows,
 * so the offsets stay exact.
 */
export function insertSteps(seq: QueueCard[], newOnes: QueueCard[]): QueueCard[] {
  const out = seq.slice();
  const k = newOnes.length;
  if (k === 0) return out;
  const m = seq.length;
  const positions: number[] = [];
  for (let i = 0; i < k; i++) positions.push(Math.min(m, Math.floor(((i + 0.5) * m) / k)));
  const insertAt = (idx: number, c: QueueCard): void => {
    if (idx >= out.length) out.push(c);
    else out.splice(idx, 0, c);
  };
  for (let i = k - 1; i >= 0; i--) {
    const base = newOnes[i] as QueueCard;
    const p = positions[i] as number;
    insertAt(p, { ...base, tag: 'intro' });
    insertAt(p + STEP_PLUS[0], { ...base, tag: '+3' });
    insertAt(p + STEP_PLUS[1], { ...base, tag: '+10' });
  }
  return out;
}

/** Exercise for a card (design 04 §13 availability + the first-2-exposures multiple-choice rule). */
export function exerciseFor(c: QueueCard, station: number, settings: Settings): ExerciseId {
  const first2 = c.exposures < 2;
  switch (c.kind) {
    case 'kana':
      if (c.facet === 'prod') return first2 ? 'kana-ear' : 'kana-forge';
      return 'kana-flash';
    case 'component':
      return 'component-flash';
    case 'chunk':
      return 'shadow';
    case 'vocab':
      switch (c.facet) {
        case 'listen':
          return 'audio-flash';
        case 'prod':
          return 'production-forge';
        case 'pitch':
          return 'pitch-ear';
        default:
          if (first2) return 'meaning-guard';
          return settings.jj && station >= 34 ? 'meaning-judge' : 'meaning-recall';
      }
    case 'kanji':
      if (c.facet === 'read') return station >= 16 && c.mature && c.exposures % 3 === 2 ? 'lookalike-duel' : 'kanji-read';
      return 'component-assembly';
    case 'grammar':
      if (c.facet === 'prod') {
        if (station < 10) return 'pattern-cloze';
        if (station >= 16) return c.exposures % 2 === 1 ? 'transform' : 'form-forge';
        return 'form-forge';
      }
      if (first2) return 'pattern-cloze';
      if (station >= 39 && c.exposures % 3 === 2) return 'judgment-call';
      if (station >= 4 && station <= 24 && c.exposures % 3 === 2) return 'scramble';
      return 'pattern-cloze';
  }
}

/** Items that recently carried `tag`, most frequent first (≤ `WEAK_SET_SIZE`). */
export function weakPointSet(tag: ErrorTag, cards: CardsApi, log: LogEntry[], today: EpochDay): QueueCard[] {
  const bit = 1 << ERROR_TAGS.indexOf(tag);
  if (bit <= 0) return [];
  const counts = new Map<CardKey, { n: number; last: number }>();
  for (const e of log) {
    if ((e[5] & bit) === 0) continue;
    const prev = counts.get(e[1]);
    if (prev) {
      prev.n++;
      prev.last = Math.max(prev.last, e[0]);
    } else counts.set(e[1], { n: 1, last: e[0] });
  }
  const out: (QueueCard & { n: number; last: number })[] = [];
  for (const [key, c] of counts) {
    const t = cards.get(key);
    if (!t || hasFlag(t[7], CardFlag.archived)) continue;
    const qc = queueCardFor(cards, key, today);
    if (qc) out.push({ ...qc, n: c.n, last: c.last });
  }
  out.sort((a, b) => b.n - a.n || b.last - a.last || byKey(a, b));
  return out.slice(0, WEAK_SET_SIZE).map(({ n, last, ...qc }) => {
    void n;
    void last;
    return qc;
  });
}

/**
 * Kage Ghost Set pools: 15 items introduced in the last 14 days (first log
 * entry within the window, base facet card, S < 14 d) and 15 mature cards
 * (S ≥ 14 d, not archived, other items). Deterministic per seed.
 *
 * `log` is the 5,000-row ring, so a mature card's older rows roll off and its
 * only surviving row may sit inside the window; the S < 14 d guard keeps such
 * cards in the mature pool (the two pools are disjoint by construction).
 */
export function kagePools(cards: CardsApi, log: LogEntry[], today: EpochDay, seed: number): { recent: QueueCard[]; mature: QueueCard[] } {
  const cutoff = dayStartMs(today - KAGE_RECENT_DAYS);
  const firstSeen = new Map<string, number>();
  for (const e of log) {
    const { itemId } = parseCardKey(e[1]);
    const prev = firstSeen.get(itemId);
    if (prev === undefined || e[0] < prev) firstSeen.set(itemId, e[0]);
  }
  const recentItems = new Set<string>();
  for (const [itemId, t] of firstSeen) if (t >= cutoff) recentItems.add(itemId);

  const { list, facets } = walk(cards);
  const recentCandidates: QueueCard[] = [];
  const matureCandidates: QueueCard[] = [];
  for (const wk of list) {
    const kind = kindOfCards(wk.itemId, facets.get(wk.itemId) ?? []);
    if (!kind) continue;
    if (hasFlag(wk.t[7], CardFlag.archived) || wk.t[5] === 0) continue;
    if (recentItems.has(wk.itemId) && wk.t[1] < MATURE_DAYS) {
      if (wk.facet === baseFacet(kind)) recentCandidates.push(toQueueCard(wk, kind, today));
    } else if (wk.t[1] >= MATURE_DAYS) {
      matureCandidates.push(toQueueCard(wk, kind, today));
    }
  }
  recentCandidates.sort(byKey);
  matureCandidates.sort(byKey);
  const rng = rngFor('kage', seed);
  return { recent: sample(rng, recentCandidates, KAGE_POOL_SIZE), mature: sample(rng, matureCandidates, KAGE_POOL_SIZE) };
}

export interface BuildQueueOpts extends DueOpts {
  /** New items to introduce (become intro / +3 / +10 steps). */
  newOnes?: QueueCard[];
  minGap?: number;
  maxSameType?: number;
}

/** due → wave → interleave → steps, in one call. */
export function buildQueue(o: BuildQueueOpts): QueueCard[] {
  const due = dueCards(o);
  const waved = orderWave(due);
  const mixed = interleave(waved, { maxSameType: o.maxSameType ?? DEFAULT_MAX_SAME_TYPE, minGap: o.minGap ?? DEFAULT_MIN_GAP });
  return insertSteps(mixed, o.newOnes ?? []);
}
