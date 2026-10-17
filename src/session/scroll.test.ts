/**
 * scroll.ts — Scroll flow: pretest, teach, checks, noticing, completion.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_STORY_ID, G, STATION_1, STATION_4, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import { rngFor } from '../shared/hash';
import type { StepResult } from '../shared/session-types';
import { resetStoreForTests, store } from '../store';
import { captureEvents, makeTestStore } from '../store/testing';
import { dueCards, scrollsForStation, type Scroll } from '../learn';
import { introduceItem, recordAttempt } from '../learn/apply';
import {
  checkStepId,
  completeScroll,
  completeScrollById,
  isIntroCheck,
  isPretestStep,
  noticingFor,
  pretestStepId,
  resetScrollCompletions,
  scrollItemKind,
  scrollOutcome,
  scrollSteps,
  teachModel,
} from './scroll';

const loader = createFakeLoader();
const get = (id: string) => loader.get(id);
const rng = () => rngFor('scroll-test');
const scrolls = scrollsForStation(STATION_4, get);
const vocabScroll = scrolls.find((s) => s.kind === 'vocab')!;
const grammarScroll = scrolls.find((s) => s.kind === 'grammar')!;
const kanjiScroll = scrolls.find((s) => s.kind === 'kanji')!;
const componentScroll = scrolls.find((s) => s.kind === 'component')!;
const kanaScroll = scrollsForStation(STATION_1, get).find((s) => s.kind === 'kana')!;

function res(stepId: string, o: Partial<StepResult> = {}): StepResult {
  return { stepId, cardKey: null, rating: 3, ki: 8, combo: 1, ippon: false, kiai: false, xpDelta: 0, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 3000, errorTags: [], ...o };
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
  resetScrollCompletions();
});

describe('scrollSteps', () => {
  it('a vocab Scroll: ≤ 3 pretest steps, one intro check per item, teach order = item order', () => {
    const r = scrollSteps(vocabScroll, get, rng());
    expect(r.pretest.length).toBeLessThanOrEqual(3);
    expect(r.pretest.length).toBe(Math.min(3, vocabScroll.pretestIds.length));
    expect(r.pretest.every(isPretestStep)).toBe(true);
    expect(r.pretest.every((s) => s.exposures === 0 && s.isNew && s.stepTag === null && s.params.scrollId === vocabScroll.id)).toBe(true);
    expect(r.checks.map((s) => s.itemId)).toEqual(vocabScroll.itemIds);
    expect(r.checks.every(isIntroCheck)).toBe(true);
    expect(r.checks.every((s) => s.exercise === 'meaning-guard' && s.params.choices?.length === 4)).toBe(true);
    expect(r.teach).toEqual(vocabScroll.itemIds);
    for (const s of r.checks) {
      expect(s.cardKey).toBe(`${s.itemId}#rec`);
      expect(s.params.choices).toContain(s.params.answer);
      expect(s.block).toBe('scroll');
    }
    expect(new Set([...r.pretest, ...r.checks].map((s) => s.id)).size).toBe(r.pretest.length + r.checks.length);
  });

  it('kanji, grammar and component Scrolls use their base-facet drills', () => {
    const k = scrollSteps(kanjiScroll, get, rng());
    expect(k.checks.every((s) => s.exercise === 'component-assembly' && s.cardKey?.endsWith('#comp'))).toBe(true);
    expect(k.checks[0]!.params.accept).toEqual([k.checks[0]!.params.answer]);
    expect(k.checks[0]!.params.layout).toBeDefined();
    const g = scrollSteps(grammarScroll, get, rng());
    expect(g.checks.every((s) => s.exercise === 'pattern-cloze' && s.cardKey?.endsWith('#cloze'))).toBe(true);
    expect(g.checks[0]!.params.tiles).toContain(g.checks[0]!.params.answer);
    expect(g.checks[0]!.params.blank).toBeDefined();
    const c = scrollSteps(componentScroll, get, rng());
    expect(c.checks.every((s) => s.exercise === 'component-flash' && s.cardKey?.endsWith('#rec'))).toBe(true);
    expect(c.checks[0]!.params.choices).toHaveLength(4);
  });

  it('a kana Scroll checks both born facets: Kana Flash on rec, then Kana Ear on prod (Kana Forge as fallback), all intro checks', () => {
    const r = scrollSteps(kanaScroll, get, rng());
    const rec = r.checks.filter((s) => s.cardKey?.endsWith('#rec'));
    const prod = r.checks.filter((s) => s.cardKey?.endsWith('#prod'));
    expect(rec.map((s) => s.itemId)).toEqual(kanaScroll.itemIds);
    expect(prod.map((s) => s.itemId)).toEqual(kanaScroll.itemIds);
    expect(r.checks).toHaveLength(2 * kanaScroll.itemIds.length);
    // the prod checks follow every rec check, so the two reps of one kana are spaced
    expect(r.checks.indexOf(prod[0]!)).toBeGreaterThan(r.checks.indexOf(rec[rec.length - 1]!));
    expect(rec.every((s) => s.exercise === 'kana-flash')).toBe(true);
    expect(prod.every((s) => s.exercise === 'kana-ear' && isIntroCheck(s) && s.isNew && s.exposures === 0 && s.params.scrollId === kanaScroll.id)).toBe(true);
    for (const s of prod) {
      expect(s.id).toBe(checkStepId(kanaScroll.id, s.itemId!, 'prod'));
      expect(s.params.answer).toBe((get(s.itemId!) as { kana: string }).kana);
      expect(s.params.choices).toHaveLength(4);
      expect(s.params.choices).toContain(s.params.answer);
    }
    expect(new Set(r.checks.map((s) => s.id)).size).toBe(r.checks.length);
    // teach order and the vocab / kanji / grammar scrolls are unchanged: one check per item
    expect(r.teach).toEqual(kanaScroll.itemIds);
    expect(scrollSteps(vocabScroll, get, rng()).checks).toHaveLength(vocabScroll.itemIds.length);
    // Kana Ear unavailable → Kana Forge; no kana prod drill at all → the prod check is skipped, the rec check stays
    const forge = scrollSteps(kanaScroll, get, rng(), { available: (id) => id !== 'kana-ear' });
    expect(forge.checks.filter((s) => s.cardKey?.endsWith('#prod')).every((s) => s.exercise === 'kana-forge' && s.params.accept?.[0] === s.params.answer)).toBe(true);
    const none = scrollSteps(kanaScroll, get, rng(), { available: (id) => id !== 'kana-ear' && id !== 'kana-forge' });
    expect(none.checks).toHaveLength(kanaScroll.itemIds.length);
    expect(none.checks.every((s) => s.cardKey?.endsWith('#rec'))).toBe(true);
  });

  it('the prod check is the born card’s first rep: it leaves state 0 and reaches the due queue (kana can leave recognition)', async () => {
    await makeTestStore({ save: { progress: { station: 1 } } });
    const r = scrollSteps(kanaScroll, get, rng());
    const id = kanaScroll.itemIds[0]!;
    const rec = r.checks.find((s) => s.itemId === id && s.cardKey?.endsWith('#rec'))!;
    const prod = r.checks.find((s) => s.itemId === id && s.cardKey?.endsWith('#prod'))!;
    const okResult = { correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 2500, errorTags: [] };
    // what the runner does on an intro check
    introduceItem(id, 'kana', 1);
    expect(store.cards.get(prod.cardKey!)![5]).toBe(0);
    recordAttempt({ sessionId: 's', step: rec, result: okResult });
    expect(store.cards.get(prod.cardKey!)![5]).toBe(0); // the rec rep alone never touches prod
    introduceItem(id, 'kana', 1); // idempotent on the second intro check
    const out = recordAttempt({ sessionId: 's', step: prod, result: okResult });
    expect(out.cardKey).toBe(`${id}#prod`);
    const t = store.cards.get(prod.cardKey!)!;
    expect(t[5]).not.toBe(0);
    expect(t[3]).toBe(1);
    expect(out.stepOffsets.length).toBeGreaterThan(0);
    // once due, the queue serves it (state-0 cards are never served)
    const day = Math.max(t[0], store.today());
    expect(dueCards({ cards: store.cards, today: day, limit: 50, backlog: false }).some((c) => c.cardKey === prod.cardKey)).toBe(true);
  });

  it('skips items whose drill is unavailable and items that are not in memory', () => {
    const none = scrollSteps(vocabScroll, get, rng(), { available: (id) => id !== 'meaning-guard' && id !== 'meaning-recall' });
    expect(none.checks).toHaveLength(0);
    const partial = scrollSteps(vocabScroll, (id) => (id === vocabScroll.itemIds[0] ? undefined : get(id)), rng());
    expect(partial.checks).toHaveLength(vocabScroll.itemIds.length - 1);
    expect(partial.teach).toEqual(vocabScroll.itemIds);
  });

  it('uses an injected resolver and estimate', () => {
    const r = scrollSteps(vocabScroll, get, rng(), { resolve: () => ({ answer: 'injected' }), estMs: () => 1234 });
    expect(r.checks.every((s) => s.params.answer === 'injected' && s.params.scrollId === vocabScroll.id && s.estMs === 1234)).toBe(true);
  });

  it('noticing points at the station episode lines that contain the new items', () => {
    const r = scrollSteps(vocabScroll, get, rng());
    expect(r.noticing?.storyId).toBe(FIXTURE_STORY_ID);
    expect(r.noticing!.lineIndexes.length).toBeGreaterThan(0);
    const n = noticingFor(4, [V.犬], get)!;
    expect(n.storyId).toBe(FIXTURE_STORY_ID);
    expect(n.lineIndexes).toEqual([7, 8, 11]);
    expect(noticingFor(9, [V.犬], get)).toBeUndefined();
  });

  it('a chunk is kind chunk and a captured-words scroll id is accepted', () => {
    expect(scrollItemKind(V.おはよう, get(V.おはよう))).toBe('chunk');
    expect(scrollItemKind(V.水, get(V.水))).toBe('vocab');
    expect(scrollItemKind('j-食', get('j-食'))).toBe('kanji');
    expect(scrollItemKind('s-04-1', get('s-04-1'))).toBeNull();
    const cap: Scroll = { id: '4-cap', station: 4, kind: 'vocab', itemIds: [V.おはよう, V.水], pretestIds: [V.水] };
    const r = scrollSteps(cap, get, rng());
    expect(r.checks.map((s) => s.exercise)).toEqual(['shadow', 'meaning-guard']);
    expect(r.checks[0]!.cardKey).toBe(`${V.おはよう}#prod`);
  });
});

describe('pretest grading', () => {
  it('a Chikaradameshi miss is graded as a first exposure: no card, no lapse, rating null', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    const r = scrollSteps(vocabScroll, get, rng());
    const pre = r.pretest[0]!;
    const out = recordAttempt({ sessionId: 's', step: pre, result: { correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 3000, errorTags: [] }, pretest: true });
    expect(out.rating).toBeNull();
    expect(out.grade.reason).toBe('pretest-miss');
    expect(out.card).toBeNull();
    expect(out.logged).toBe(false);
    expect(out.stepOffsets).toEqual([]);
  });
});

describe('teachModel', () => {
  it('shows word / pitch / collocations / example for vocab, pattern / formation / explanation / examples / contrast for grammar, components / mnemonic / reading / words for kanji', () => {
    const v = teachModel(get(V.飲む)!)!;
    expect(v).toMatchObject({ kind: 'vocab', head: '飲む', kana: 'のむ', pitch: 1, parts: ['お茶を飲む', '薬を飲む'], contrastId: V.食べる });
    expect(v.examples[0]!.kana).toBe('まいあさコーヒーをのみます。');
    const g = teachModel(get(G.です)!)!;
    expect(g.kind).toBe('grammar');
    expect(g.head).toBe('〜です');
    expect(g.lines.length).toBeGreaterThanOrEqual(4);
    expect(g.contrastId).toBe(G.は);
    expect(g.examples).toHaveLength(3);
    const k = teachModel(get('j-飲')!)!;
    expect(k).toMatchObject({ kind: 'kanji', head: '飲', parts: ['eat', 'yawn'] });
    expect(k.lines[0]).toContain('EAT');
    expect(k.examples[0]!.ja).toBe('飲む');
    const kana = teachModel(get('k-h-ne')!)!;
    expect(kana).toMatchObject({ kind: 'kana', head: 'ね', meaning: ['ne'], contrastId: 'k-h-re' });
    const c = teachModel(get('c-eat')!)!;
    expect(c).toMatchObject({ kind: 'component', head: '食', meaning: ['eat'], parts: ['飠'] });
    expect(teachModel(get('m-04-1')!)).toBeNull();
    expect(teachModel(get(V.おはよう)!)!.kind).toBe('chunk');
  });
});

describe('completion', () => {
  it('flawless means every check correct with no Block; the pretest is excluded', () => {
    const sid = vocabScroll.id;
    const ids = vocabScroll.itemIds;
    const results = [res(pretestStepId(sid, ids[0]!), { correct: false, rating: null }), ...ids.map((id) => res(checkStepId(sid, id)))];
    expect(scrollOutcome(sid, ids, results)).toMatchObject({ flawless: true, checked: ids.length, itemIds: ids });
    const blocked = results.map((r, i) => (i === 1 ? { ...r, nearMiss: true, rating: 2 as const } : r));
    expect(scrollOutcome(sid, ids, blocked).flawless).toBe(false);
    expect(scrollOutcome(sid, ids, []).flawless).toBe(false);
  });

  it('emits scroll:completed exactly once per scroll id', () => {
    const cap = captureEvents();
    const sid = grammarScroll.id;
    const results = grammarScroll.itemIds.map((id) => res(checkStepId(sid, id)));
    const a = completeScrollById(sid, grammarScroll.itemIds, results);
    expect(a.emitted).toBe(true);
    completeScroll(grammarScroll, results);
    const b = completeScrollById(sid, grammarScroll.itemIds, results);
    expect(b.emitted).toBe(false);
    const events = cap.events.filter((e) => e[0] === 'scroll:completed');
    expect(events).toHaveLength(1);
    expect(events[0]![1]).toEqual({ scrollId: sid, itemIds: grammarScroll.itemIds, flawless: true });
    cap.stop();
  });
});

describe('kun-only kanji reading', () => {
  it('the spoken / shown reading drops the okurigana dot; the 訓: line keeps it', () => {
    const base = get('j-飲')! as import('../content/types').KanjiItem;
    const m = teachModel({ ...base, id: 'j-届', char: '届', on: [], kun: ['とど.く'] })!;
    expect(m.kana).toBe('とどく');
    expect(m.lines.some((l) => l.includes('とど.く'))).toBe(true);
    expect(teachModel(base)!.kana).toBe('イン');
  });
});
