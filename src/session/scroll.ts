/**
 * TSUZUKU — Scroll (巻物) flow (design 03 §2.2, 04 §4 "Grammar Scroll", 05 §3).
 *
 *  Chikaradameshi pretest (≤ 3 items, before teaching; a miss is expected and
 *  carries no FSRS penalty) → teach cards (vocab: word / pitch / collocations /
 *  example · grammar: pattern / formation / explanation / examples / contrast ·
 *  kanji: components / mnemonic / reading / words · kana: glyph / mnemonic /
 *  example word · component: glyph / name / hint) → one immediate check per
 *  item on its base facet (`stepTag: 'intro'`; the runner calls
 *  `introduceItem` on it), then a second immediate check for every other
 *  facet an item is born with (`initialFacets`: kana `prod` → Kana Ear, Kana
 *  Forge as fallback) → noticing: the station episode's lines that contain
 *  the new items. The second check exists because a card created at
 *  introduction but never served stays in state 0, no unlock rule reaches a
 *  born facet and the due queue never serves a state-0 card: without it a
 *  kana's `prod` card would never run and kana could never reach Brown.
 *
 * Step ids are stable and self-describing so the runner and the end card can
 * find them without the Scroll object:
 *   `scroll:<scrollId>:pre:<itemId>`            pretest
 *   `scroll:<scrollId>:check:<itemId>`          immediate check (intro, base facet)
 *   `scroll:<scrollId>:check:<itemId>#<facet>`  immediate check of another born facet
 *
 * `completeScroll` emits `scroll:completed` exactly once per scroll id
 * (flawless = every immediate check correct; the pretest is excluded).
 */
import type { ContentItem, DrillId, Facet, GrammarItem, KanaItem, KanjiItem, StoryItem, VocabItem, ComponentDef } from '../content/types';
import { isChunk } from '../content/loader';
import { toPlain } from '../content/ruby';
import { bus } from '../shared/events';
import { cardKey as makeKey, tryKindOfId } from '../shared/ids';
import type { Rng } from '../shared/hash';
import type { Step, StepParams, StepResult } from '../shared/session-types';
import type { ItemKind, Settings } from '../shared/store-types';
import { baseFacet, exerciseFor, initialFacets, type QueueCard, type Scroll } from '../learn';
import { S } from './engine-strings';

export const PRETEST_PREFIX = 'pre';
export const CHECK_PREFIX = 'check';

export interface ScrollStepOptions {
  station?: number;
  settings?: Settings;
  /** Drill availability (default: everything). */
  available?: (id: DrillId) => boolean;
  /** Full param resolution (the builder passes `resolveParams`); default: minimal params from the item. */
  resolve?: (exercise: DrillId, item: ContentItem, qc: QueueCard) => StepParams;
  estMs?: (exercise: DrillId, params: StepParams) => number;
}

export interface ScrollStepsResult {
  pretest: Step[];
  /** Item ids in teaching order. */
  teach: string[];
  checks: Step[];
  noticing?: { storyId: string; lineIndexes: number[] };
}

const DEFAULT_SETTINGS: Pick<Settings, 'jj'> = { jj: false };

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function isVocab(i: ContentItem | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i;
}
function isKanji(i: ContentItem | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i;
}
function isGrammar(i: ContentItem | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}
function isKana(i: ContentItem | undefined): i is KanaItem {
  return !!i && 'romaji' in i && 'script' in i;
}
function isComponent(i: ContentItem | undefined): i is ComponentDef {
  return !!i && 'char' in i && 'name' in i && !('strokes' in i);
}

/** Item kind of a scroll item from its id and content (`chunk` for set phrases / aizuchi). */
export function scrollItemKind(itemId: string, item: ContentItem | undefined): ItemKind | null {
  const k = tryKindOfId(itemId);
  if (k === 'vocab') return item && isChunk(item) ? 'chunk' : 'vocab';
  if (k === 'kana' || k === 'kanji' || k === 'grammar' || k === 'component') return k;
  return null;
}

export function pretestStepId(scrollId: string, itemId: string): string {
  return `scroll:${scrollId}:${PRETEST_PREFIX}:${itemId}`;
}
export function checkStepId(scrollId: string, itemId: string, facet?: Facet): string {
  return `scroll:${scrollId}:${CHECK_PREFIX}:${itemId}${facet ? `#${facet}` : ''}`;
}

/** A Chikaradameshi pretest step: carries `scrollId`, `isNew`, no `stepTag`. */
export function isPretestStep(step: Pick<Step, 'id' | 'params' | 'stepTag' | 'isNew'>): boolean {
  return step.params.scrollId !== undefined && step.stepTag === null && step.isNew && step.id.includes(`:${PRETEST_PREFIX}:`);
}

/** The immediate check that introduces an item (`stepTag: 'intro'` + `scrollId`). */
export function isIntroCheck(step: Pick<Step, 'params' | 'stepTag'>): boolean {
  return step.params.scrollId !== undefined && step.stepTag === 'intro';
}

/** Minimal params when the caller supplies no resolver: the answer and, for first exposures, choices from the scroll's own items. */
function minimalParams(exercise: DrillId, item: ContentItem, peers: ContentItem[], rng: Rng): StepParams {
  const p: StepParams = {};
  const shuffleLocal = <T>(xs: T[]): T[] => {
    const out = xs.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = out[i] as T;
      out[i] = out[j] as T;
      out[j] = t;
    }
    return out;
  };
  if (isVocab(item)) {
    p.answer = item.meanings[0] ?? '';
    p.accept = item.meanings.slice();
    if (exercise === 'meaning-guard') {
      const others = peers.filter(isVocab).filter((v) => v.id !== item.id).map((v) => v.meanings[0] ?? '').filter((m) => m && m !== p.answer);
      p.choices = shuffleLocal([p.answer, ...Array.from(new Set(others)).slice(0, 3)]);
    }
    if (exercise === 'shadow') {
      const ex = item.examples[0];
      p.sentence = ex ? toPlain(ex.ja) : item.word;
      p.answer = ex ? ex.kana : item.kana;
      p.accept = ex ? [toPlain(ex.ja), ex.kana] : [item.word, item.kana];
    }
  } else if (isKana(item)) {
    p.answer = exercise === 'kana-flash' ? item.romaji : item.kana;
    p.accept = [p.answer];
    if (exercise === 'kana-flash') {
      const others = peers.filter(isKana).filter((k) => k.id !== item.id).map((k) => k.romaji);
      p.choices = shuffleLocal([item.romaji, ...Array.from(new Set(others)).slice(0, 3)]);
    } else if (exercise === 'kana-ear') {
      const others = peers.filter(isKana).filter((k) => k.id !== item.id).map((k) => k.kana);
      p.choices = shuffleLocal([item.kana, ...Array.from(new Set(others)).slice(0, 3)]);
    }
  } else if (isKanji(item)) {
    // Component Assembly builds its tiles from the component definitions; the params carry the answer and the frame only.
    p.answer = item.char;
    p.accept = [item.char];
    p.layout = item.components.length <= 1 ? 'enc' : 'lr';
    p.promptEn = item.meanings[0] ?? '';
  } else if (isGrammar(item)) {
    const ex = item.examples[0];
    const sentence = ex ? toPlain(ex.ja) : item.pattern;
    const hint = item.clozeHints.find((h) => sentence.includes(h)) ?? item.clozeHints[0] ?? item.pattern;
    const start = sentence.indexOf(hint);
    p.sentence = sentence;
    p.blank = start >= 0 ? [start, start + hint.length] : [0, 0];
    p.answer = hint;
    p.accept = [hint];
    p.promptEn = ex?.en ?? item.meaning;
    const others = peers.filter(isGrammar).filter((g) => g.id !== item.id).flatMap((g) => g.clozeHints).filter((h) => h !== hint);
    p.tiles = shuffleLocal([hint, ...Array.from(new Set(others)).slice(0, 3)]);
  } else if (isComponent(item)) {
    p.answer = item.name;
    p.accept = [item.name];
    const others = peers.filter(isComponent).filter((c) => c.id !== item.id).map((c) => c.name);
    p.choices = shuffleLocal([item.name, ...Array.from(new Set(others)).slice(0, 3)]);
  }
  return p;
}

function freshCard(itemId: string, kind: ItemKind, facet: Facet = baseFacet(kind)): QueueCard {
  return { cardKey: makeKey(itemId, facet), itemId, kind, facet, r: 0, mature: false, exposures: 0 };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Teach model                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TeachModel {
  kind: ItemKind;
  /** Headline: word / pattern / character / glyph. */
  head: string;
  /** Kana reading (TTS text) when the headline is not kana already. */
  kana?: string;
  /** English gloss(es). */
  meaning: string[];
  /** Pitch nucleus (vocab) when present. */
  pitch?: number;
  /** Teaching lines in display order (formation, explanation, mnemonic, hint…). */
  lines: string[];
  /** Example sentences / words to show with TTS. */
  examples: { ja: string; kana: string; en: string }[];
  /** Collocations (vocab) or component names (kanji). */
  parts: string[];
  /** A contrasting / related item id (grammar `related[0]`, vocab `confusables[0]`, kanji `lookalikes[0]`). */
  contrastId?: string;
}

/** What a Scroll's teach card shows for one item (design 05 §12). */
export function teachModel(item: ContentItem): TeachModel | null {
  if (isVocab(item)) {
    const m: TeachModel = {
      kind: isChunk(item) ? 'chunk' : 'vocab',
      head: item.word,
      kana: item.kana,
      meaning: item.meanings.slice(),
      lines: item.notes ? [item.notes] : [],
      examples: item.examples.map((e) => ({ ja: e.ja, kana: e.kana, en: e.en })),
      parts: (item.collocations ?? []).slice(),
    };
    if (item.pitch !== undefined) m.pitch = item.pitch;
    const c = item.confusables?.[0];
    if (c) m.contrastId = c;
    return m;
  }
  if (isGrammar(item)) {
    const m: TeachModel = {
      kind: 'grammar',
      head: item.pattern,
      meaning: [item.meaning],
      lines: [...item.formation, item.explanation, ...item.mistakes],
      examples: item.examples.map((e) => ({ ja: e.ja, kana: e.kana, en: e.en })),
      parts: item.clozeHints.slice(),
    };
    const r = item.related[0];
    if (r) m.contrastId = r;
    return m;
  }
  if (isKanji(item)) {
    const m: TeachModel = {
      kind: 'kanji',
      head: item.char,
      // The headline reading is spoken and shown: a kun-only kanji drops the okurigana dot (とど.く → とどく); the 訓: line keeps it.
      kana: item.on[0] ?? item.kun[0]?.replace('.', '') ?? '',
      meaning: item.meanings.slice(),
      lines: [item.mnemonic, ...(item.on.length ? [`音: ${item.on.join('・')}`] : []), ...(item.kun.length ? [`訓: ${item.kun.join('・')}`] : [])],
      examples: item.examples.map((e) => ({ ja: e.word, kana: e.kana, en: e.en })),
      parts: item.components.slice(),
    };
    const l = item.lookalikes?.[0];
    if (l) m.contrastId = l;
    return m;
  }
  if (isKana(item)) {
    return {
      kind: 'kana',
      head: item.kana,
      kana: item.kana,
      meaning: [item.romaji],
      lines: [item.mnemonic],
      examples: [{ ja: item.exampleWord.word, kana: item.exampleWord.kana, en: item.exampleWord.en }],
      parts: [],
      ...(item.lookalikes?.[0] ? { contrastId: item.lookalikes[0] } : {}),
    };
  }
  if (isComponent(item)) {
    return {
      kind: 'component',
      head: item.char,
      meaning: [item.name],
      lines: item.hint ? [item.hint] : [],
      examples: [],
      parts: (item.variants ?? []).slice(),
    };
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Steps                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Station episode lines that contain any of `itemIds` (noticing). */
export function noticingFor(station: number, itemIds: readonly string[], get: (id: string) => ContentItem | undefined): { storyId: string; lineIndexes: number[] } | undefined {
  const want = new Set(itemIds);
  for (let n = 1; n <= 9; n++) {
    const story = get(`s-${pad2(station)}-${n}`) as StoryItem | undefined;
    if (!story || !('lines' in story)) continue;
    const lineIndexes: number[] = [];
    story.lines.forEach((line, i) => {
      if (line.tokenIds?.some((id) => id !== null && want.has(id))) lineIndexes.push(i);
    });
    if (lineIndexes.length > 0) return { storyId: story.id, lineIndexes };
  }
  return undefined;
}

/**
 * The Scroll's steps. `pretest` ≤ 3 steps over `s.pretestIds`, `checks` one
 * per item on its base facet (`stepTag: 'intro'`, `isNew`, `exposures: 0`)
 * followed by one per extra born facet (kana `prod`), in item order. Items
 * whose content is not in memory, or whose drill (and fallback) is
 * unavailable, are skipped.
 */
export function scrollSteps(s: Scroll, get: (id: string) => ContentItem | undefined, rng: Rng, o: ScrollStepOptions = {}): ScrollStepsResult {
  const station = o.station ?? s.station;
  const settings = (o.settings ?? DEFAULT_SETTINGS) as Settings;
  const available = o.available ?? (() => true);
  const peers = s.itemIds.map(get).filter((x): x is ContentItem => x !== undefined);

  const drillFor = (kind: ItemKind, qc: QueueCard): DrillId | null => {
    const want = exerciseFor(qc, station, settings) as DrillId;
    if (available(want)) return want;
    const alt: Partial<Record<DrillId, DrillId[]>> = {
      'meaning-guard': ['meaning-recall'],
      'kana-ear': ['kana-forge'],
      'pattern-cloze': [],
      'component-assembly': ['kanji-read'],
      shadow: ['production-forge'],
    };
    for (const a of alt[want] ?? []) if (available(a)) return a;
    void kind;
    return null;
  };

  const make = (itemId: string, id: string, tag: 'intro' | null, facet?: Facet): Step | null => {
    const item = get(itemId);
    if (!item) return null;
    const kind = scrollItemKind(itemId, item);
    if (!kind) return null;
    const qc = freshCard(itemId, kind, facet);
    const exercise = drillFor(kind, qc);
    if (!exercise) return null;
    const params: StepParams = { ...(o.resolve ? o.resolve(exercise, item, qc) : minimalParams(exercise, item, peers, rng)), scrollId: s.id };
    return {
      id,
      block: 'scroll',
      exercise,
      itemId,
      cardKey: qc.cardKey,
      params,
      timed: false,
      isNew: true,
      stepTag: tag,
      exposures: 0,
      estMs: o.estMs ? o.estMs(exercise, params) : params.choices ? 4000 : 8000,
    };
  };

  const pretest: Step[] = [];
  for (const id of s.pretestIds.slice(0, 3)) {
    const st = make(id, pretestStepId(s.id, id), null);
    if (st) pretest.push(st);
  }
  const checks: Step[] = [];
  for (const id of s.itemIds) {
    const st = make(id, checkStepId(s.id, id), 'intro');
    if (st) checks.push(st);
  }
  // Second immediate check for every other facet an item is born with (kana `prod`): after all base checks, so the
  // two reps of one item are spaced. The step is an intro check too (`introduceItem` is idempotent), and its result
  // is the born card's first rep, which takes it out of state 0 and into the due queue.
  for (const id of s.itemIds) {
    const item = get(id);
    const kind = item ? scrollItemKind(id, item) : null;
    if (!kind) continue;
    for (const f of initialFacets(kind)) {
      if (f === baseFacet(kind)) continue;
      const st = make(id, checkStepId(s.id, id, f), 'intro', f);
      if (st) checks.push(st);
    }
  }
  const noticing = noticingFor(s.station, s.itemIds, get);
  const out: ScrollStepsResult = { pretest, teach: s.itemIds.slice(), checks };
  if (noticing) out.noticing = noticing;
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Completion                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

const emitted = new Set<string>();

/** Tests: forget which scrolls have emitted `scroll:completed`. */
export function resetScrollCompletions(): void {
  emitted.clear();
}

export interface ScrollOutcome {
  scrollId: string;
  itemIds: string[];
  /** Every immediate check (pretest excluded) was answered correctly (no Block). */
  flawless: boolean;
  /** Checks answered so far. */
  checked: number;
  /** `scroll:completed` was emitted by this call. */
  emitted: boolean;
}

/** Outcome of a scroll from the step results (by stable step id). */
export function scrollOutcome(scrollId: string, itemIds: readonly string[], results: readonly StepResult[]): Omit<ScrollOutcome, 'emitted'> {
  const prefix = `scroll:${scrollId}:${CHECK_PREFIX}:`;
  const checks = results.filter((r) => r.stepId.startsWith(prefix));
  const flawless = checks.length > 0 && checks.every((r) => r.correct && !r.nearMiss);
  return { scrollId, itemIds: itemIds.slice(), flawless, checked: checks.length };
}

/** Emits `scroll:completed` once per scroll id; returns the outcome. */
export function completeScrollById(scrollId: string, itemIds: readonly string[], results: readonly StepResult[]): ScrollOutcome {
  const base = scrollOutcome(scrollId, itemIds, results);
  if (emitted.has(scrollId)) return { ...base, emitted: false };
  emitted.add(scrollId);
  bus.emit('scroll:completed', { scrollId, itemIds: base.itemIds, flawless: base.flawless });
  return { ...base, emitted: true };
}

/** Module-plan signature: `completeScroll(s, results)`. */
export function completeScroll(s: Scroll, results: StepResult[]): void {
  completeScrollById(s.id, s.itemIds, results);
}

/** Pretest copy for the view. */
export const PRETEST_LINE = S.pretestLine;
