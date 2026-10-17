/**
 * TSUZUKU — Nemesis (宿敵) orchestration (design 04 §9, 05 §8).
 *
 *  ≥ 8 lapses on a facet → Nemesis (flag 2, set by the writer). Day 0: the
 *  dossier (components, mnemonic, extra sentences, confusable side by side);
 *  14 days in context only (cloze, story — ordinary sessions); then the Duel
 *  chain prod → listen → cloze (filtered to the facets the item has), one duel
 *  per day. Three wins on three distinct days → `defeatNemesis` (flag cleared,
 *  S reset to 3 d) and `nemesis:defeated`.
 *
 *  Steps use the `nemesis-duel` drill: `params.phase` 1 = dossier, 3 = duel,
 *  `params.pool` = the item's Nemesis card keys; the duel step's `cardKey` is
 *  the facet to fight. The drill component renders the facet prompt from the
 *  resolved params (production-forge / audio-flash / pattern-cloze shapes).
 */
import type { CardKey, ContentItem, DrillId, Facet, SentenceExample, VocabItem, KanjiItem, GrammarItem } from '../content/types';
import { content as appContent, type ContentLoader } from '../content/loader';
import { toPlain } from '../content/ruby';
import { cardKey as makeKey, parseCardKey } from '../shared/ids';
import type { Step, StepParams, StepResult } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { EpochDay } from '../shared/store-types';
import { store } from '../store';
import { defeatNemesis } from '../learn/apply';
import { duelProgress, isNemesis, nemesisPhase, type QueueCard } from '../learn';
import { S } from './engine-strings';
import { isGrammar, isKanji, isVocab, itemKindOf, linesWith, loadPlanContext, resolveParams } from './builder';

export const DUEL_DRILL: DrillId = 'nemesis-duel';
export const DUEL_WINS_NEEDED = 3;

/** Facet → the drill shape the duel step's params follow. */
export const DUEL_FACET_DRILL: Partial<Record<Facet, DrillId>> = { prod: 'production-forge', listen: 'audio-flash', cloze: 'pattern-cloze', rec: 'meaning-recall', read: 'kanji-read', comp: 'component-assembly' };

export type NemesisPhase = ReturnType<typeof nemesisPhase>;

export interface NemesisEntry {
  itemId: string;
  keys: CardKey[];
  phase: NemesisPhase;
  /** Next facet to duel (duel phase only). */
  next: Facet | null;
  wins: number;
  line: string;
}

function dayOfMs(ms: number): EpochDay {
  try {
    return epochDay(ms, store.profile.value.tz);
  } catch {
    return epochDay(ms);
  }
}

/** Every item holding a Nemesis-flagged card, with its phase today. */
export function nemesisItems(today: EpochDay = store.today()): NemesisEntry[] {
  const byItem = new Map<string, CardKey[]>();
  store.cards.forEach((k, t) => {
    if (!isNemesis(t)) return;
    const { itemId } = parseCardKey(k);
    const list = byItem.get(itemId) ?? [];
    list.push(k);
    byItem.set(itemId, list);
  });
  const log = store.log.recent(5000);
  const out: NemesisEntry[] = [];
  for (const [itemId, keys] of Array.from(byItem.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    keys.sort();
    const first = keys[0] as CardKey;
    const card = store.cards.get(first);
    if (!card) continue;
    const phase = nemesisPhase(card, log, today, first, { dayOfMs });
    const available = Object.keys(store.cards.byItem(itemId)) as Facet[];
    const prog = duelProgress(log, itemId, { dayOfMs, available });
    const line = phase === 'dossier' ? S.nemesisDossier : phase === 'context' ? S.nemesisContext : phase === 'duel' ? S.nemesisDuel : S.nemesisDefeated;
    out.push({ itemId, keys, phase, next: phase === 'duel' ? prog.next : null, wins: prog.wins, line });
  }
  return out;
}

/** Items whose duel can be fought today (duel phase, no win logged today yet). */
export function duelsReady(today: EpochDay = store.today()): NemesisEntry[] {
  const log = store.log.recent(5000);
  return nemesisItems(today).filter((e) => {
    if (e.phase !== 'duel' || !e.next) return false;
    const prog = duelProgress(log, e.itemId, { dayOfMs, available: Object.keys(store.cards.byItem(e.itemId)) as Facet[] });
    return !prog.days.includes(today);
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Dossier                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Dossier {
  itemId: string;
  head: string;
  kana?: string;
  meanings: string[];
  mnemonic?: string;
  components: string[];
  /** Up to 3 sentences beyond the first example (story lines first). */
  sentences: SentenceExample[];
  confusable?: ContentItem;
}

/** Components, mnemonic, extra sentences, confusable side by side (design 04 §9). */
export function dossierFor(itemId: string, loader: ContentLoader = appContent, stories: Parameters<typeof linesWith>[0]['stories'] = []): Dossier | null {
  const item = loader.get(itemId);
  if (!item) return null;
  if (isVocab(item)) {
    const d: Dossier = { itemId, head: item.word, kana: item.kana, meanings: item.meanings.slice(), components: (item.kanjiIds ?? []).slice(), sentences: [] };
    for (const story of stories) {
      for (const line of story.lines) if (line.tokenIds?.includes(itemId) && d.sentences.length < 3) d.sentences.push({ ja: line.ja, kana: line.kana, en: line.en });
    }
    for (const ex of item.examples.slice(1)) if (d.sentences.length < 3) d.sentences.push(ex);
    const c = item.confusables?.[0] ? loader.get(item.confusables[0]) : undefined;
    if (c) d.confusable = c;
    if (item.notes) d.mnemonic = item.notes;
    return d;
  }
  if (isKanji(item)) {
    const d: Dossier = { itemId, head: item.char, kana: item.on[0] ?? item.kun[0]?.replace('.', '') ?? '', meanings: item.meanings.slice(), mnemonic: item.mnemonic, components: item.components.slice(), sentences: item.examples.slice(0, 3).map((e) => ({ ja: e.word, kana: e.kana, en: e.en })) };
    const l = item.lookalikes?.[0] ? loader.get(item.lookalikes[0]) : undefined;
    if (l) d.confusable = l;
    return d;
  }
  if (isGrammar(item)) {
    const d: Dossier = { itemId, head: item.pattern, meanings: [item.meaning], mnemonic: item.explanation, components: item.formation.slice(), sentences: item.examples.slice(0, 3) };
    const r = item.related[0] ? loader.get(item.related[0]) : undefined;
    if (r) d.confusable = r;
    return d;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Steps                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface NemesisStepOptions {
  loader?: ContentLoader;
  /** Full param resolution (the builder's `resolveParams`); default: minimal params from the item. */
  resolve?: (drill: DrillId, item: ContentItem, qc: QueueCard) => StepParams;
}

function minimalParams(drill: DrillId, item: ContentItem): StepParams {
  const p: StepParams = {};
  const v = item as VocabItem;
  const k = item as KanjiItem;
  const g = item as GrammarItem;
  if (isVocab(item)) {
    if (drill === 'production-forge') {
      const ex = v.examples[0];
      p.sentence = ex ? toPlain(ex.ja) : v.word;
      p.promptEn = `${v.meanings[0] ?? ''}${ex ? ` — ${ex.en}` : ''}`;
      p.answer = v.word;
      p.accept = Array.from(new Set([v.word, v.kana, ...(v.altForms ?? [])]));
      const i = p.sentence.indexOf(v.word);
      p.blank = i >= 0 ? [i, i + v.word.length] : [0, 0];
    } else {
      p.answer = v.meanings[0] ?? '';
      p.accept = v.meanings.slice();
    }
  } else if (isKanji(item)) {
    const ex = k.examples[0];
    p.sentence = ex?.word ?? k.char;
    p.answer = ex?.kana ?? '';
    p.accept = ex ? [ex.kana] : [];
    p.promptEn = ex?.en ?? k.meanings[0] ?? '';
  } else if (isGrammar(item)) {
    const ex = g.examples[0];
    const sentence = ex ? toPlain(ex.ja) : g.pattern;
    const hint = g.clozeHints.find((h) => sentence.includes(h)) ?? g.clozeHints[0] ?? g.pattern;
    const i = sentence.indexOf(hint);
    p.sentence = sentence;
    p.blank = i >= 0 ? [i, i + hint.length] : [0, 0];
    p.answer = hint;
    p.accept = [hint];
    p.promptEn = ex?.en ?? g.meaning;
  }
  return p;
}

/**
 * Today's Nemesis steps for an item: the dossier on day 0, nothing during the
 * 14 context days, one duel step (the chain's next facet) in the duel phase.
 */
export function nemesisSteps(itemId: string, today: EpochDay, o: NemesisStepOptions = {}): Step[] {
  const loader = o.loader ?? appContent;
  const entry = nemesisItems(today).find((e) => e.itemId === itemId);
  if (!entry || entry.phase === 'none') return [];
  const item = loader.get(itemId);
  const kind = itemKindOf(itemId, item);
  const firstKey = entry.keys[0] as CardKey;
  const card = store.cards.get(firstKey);
  if (!card || !kind) return [];
  if (entry.phase === 'dossier') {
    return [
      {
        id: `nemesis:${itemId}:dossier:${today}`,
        block: 'weak',
        exercise: DUEL_DRILL,
        itemId,
        cardKey: firstKey,
        params: { phase: 1, pool: entry.keys.slice() },
        timed: false,
        isNew: false,
        stepTag: null,
        exposures: card[3],
        estMs: 20_000,
      },
    ];
  }
  if (entry.phase !== 'duel' || !entry.next) return [];
  const key = makeKey(itemId, entry.next);
  const duelCard = store.cards.get(key) ?? card;
  const shape = DUEL_FACET_DRILL[entry.next] ?? 'meaning-recall';
  const qc: QueueCard = { cardKey: key, itemId, kind, facet: entry.next, r: 0, mature: duelCard[1] >= 14, exposures: Math.max(2, duelCard[3]) };
  const params: StepParams = item ? (o.resolve ? o.resolve(shape, item, qc) : minimalParams(shape, item)) : {};
  params.phase = 3;
  params.pool = entry.keys.slice();
  return [
    {
      id: `nemesis:${itemId}:duel:${today}:${entry.next}`,
      block: 'weak',
      exercise: DUEL_DRILL,
      itemId,
      cardKey: key,
      params,
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: duelCard[3],
      estMs: 15_000,
    },
  ];
}

/** `nemesisSteps` with the builder's full param resolution (loads the station context). */
export async function nemesisStepsAsync(itemId: string, today: EpochDay, loader?: ContentLoader): Promise<Step[]> {
  const ctx = await loadPlanContext({ loader, mode: 'nemesis' });
  try {
    if (ctx.loader.get(itemId) === undefined) await ctx.loader.load([itemId]);
  } catch {
    /* offline */
  }
  return nemesisSteps(itemId, today, { loader: ctx.loader, resolve: (drill, item, qc) => resolveParams(ctx, drill, item, { qc, rep: today }) });
}

/**
 * After a duel rep: three wins on three distinct days defeat the Nemesis
 * (`defeatNemesis` clears the flag, S = 3 d, emits `nemesis:defeated`).
 * `steps` lets the caller confirm today's duel result is in; the count comes
 * from the review log the writer keeps.
 */
export function afterDuel(itemId: string, steps: StepResult[], today: EpochDay): { defeated: boolean; wins: number; next: Facet | null; wonToday: boolean } {
  void steps;
  const available = Object.keys(store.cards.byItem(itemId)) as Facet[];
  const prog = duelProgress(store.log.recent(5000), itemId, { dayOfMs, available });
  const wonToday = prog.days.includes(today);
  if (prog.wins >= DUEL_WINS_NEEDED) {
    const changed = defeatNemesis(itemId);
    return { defeated: changed.length > 0, wins: prog.wins, next: null, wonToday };
  }
  return { defeated: false, wins: prog.wins, next: prog.next, wonToday };
}
