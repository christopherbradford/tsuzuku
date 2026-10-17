/**
 * builder.ts / params.ts over the REAL corpus (public/content), through an
 * fs-backed `createLoader`. Skipped when the corpus is not on disk (CI without
 * content). The fixture corpus (one station, two stories) cannot show that a
 * learner mid-station has a readable episode, that every grammar point with
 * `unlocksForms` has a head word, or that Kanji Read's blank agrees with the
 * sentence's own ruby — this file does.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createLoader, type ContentLoader } from '../content/loader';
import { parseRuby, toPlain } from '../content/ruby';
import type { CardKey, GrammarItem, KanjiItem, StationBundle, StoryItem, VocabItem } from '../content/types';
import { bus } from '../shared/events';
import { equivalentJa } from '../shared/jp';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { buildPlan, isGrammar, isKanji, isVocab, loadPlanContext, movableTiles, pickStories, resolveParams, stepForCard, storyCoverage, type PlanContext } from './builder';
import { dojoFeed } from './dojo-feed';

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'content');
const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const all = (): boolean => true;

function fsFetch(): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const rel = (raw.split(/[?#]/)[0] ?? raw).replace(/^\.\/content\//, '');
    const file = join(CONTENT, rel);
    if (!existsSync(file)) return new Response('not found', { status: 404, statusText: 'Not Found' });
    return new Response(readFileSync(file, 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function corpusLoader(): ContentLoader {
  return createLoader(fsFetch(), './content/');
}

/** A Green review card (S 20 d), not due today. */
function green(): CardTuple {
  return card({ due: TODAY + 10, s: 20, d: 5, reps: 10, lapses: 0, state: 2, last: TODAY - 2 });
}

function bundleIds(b: StationBundle): string[] {
  return [...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.kanaIds, ...b.componentIds];
}

/** Cards for every item of stations < n (base and production facets), all Green. */
async function cardsBelow(loader: ContentLoader, n: number): Promise<Record<CardKey, CardTuple>> {
  const out: Record<CardKey, CardTuple> = {};
  for (let st = 1; st < n; st++) {
    const b = await loader.station(st);
    for (const id of b.vocabIds) {
      out[`${id}#rec`] = green();
      out[`${id}#prod`] = green();
    }
    for (const id of b.kanjiIds) {
      out[`${id}#comp`] = green();
      out[`${id}#read`] = green();
    }
    for (const id of b.grammarIds) {
      out[`${id}#cloze`] = green();
      out[`${id}#prod`] = green();
    }
    for (const id of [...b.kanaIds, ...b.componentIds]) out[`${id}#rec`] = green();
  }
  return out;
}

/** Every item of stations ≤ n in memory, as a plan context over the cumulative pool. */
async function fullPool(loader: ContentLoader, n: number): Promise<PlanContext & { known: Set<string> }> {
  const ctx = await loadPlanContext({ loader, station: n, available: all });
  const known = new Set<string>();
  const vocabPool: VocabItem[] = [];
  const kanjiPool: KanjiItem[] = [];
  const grammarPool: GrammarItem[] = [];
  const stories: StoryItem[] = [];
  for (let st = 1; st <= n; st++) {
    const b = await loader.station(st);
    await loader.preloadStation(st);
    for (const id of [...bundleIds(b), ...b.storyIds]) {
      known.add(id);
      const it = loader.get(id);
      if (isVocab(it)) vocabPool.push(it);
      else if (isKanji(it)) kanjiPool.push(it);
      else if (isGrammar(it)) grammarPool.push(it);
      else if (it && 'lines' in it) stories.push(it as StoryItem);
    }
  }
  return { ...ctx, known, vocabPool, kanjiPool, grammarPool, stories };
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe.skipIf(!existsSync(join(CONTENT, 'manifest.json')))('plans over the real corpus', () => {
  it.each([5, 10, 20])('station %i mid-station (stations < n Green): the Shugyō has an Input episode and the Dojo shows one', async (n) => {
    const loader = corpusLoader();
    await makeTestStore({ save: { progress: { station: n } }, cards: await cardsBelow(loader, n) });
    const plan = await buildPlan('shugyo', { loader, available: all });
    const input = plan.steps.filter((s) => s.block === 'input');
    expect(input, `station ${n}: blocks ${plan.blocks.map((b) => b.kind).join(',')}`).toHaveLength(1);
    expect(['story-read', 'listening-set']).toContain(input[0]!.exercise);
    expect(plan.meta.storyId).toBe(input[0]!.params.storyId);
    expect(plan.meta.storyId!.startsWith(`s-${String(n - 1).padStart(2, '0')}-`)).toBe(true);
    const feed = await dojoFeed({ loader, teaser: false });
    expect(feed.episodes).toBe(1);
  });

  it('every story is pickable at its own station with the cumulative known set (V20 agreement: plusOne and the White allowlist count)', async () => {
    const loader = corpusLoader();
    await makeTestStore({ save: { progress: { station: 1 } } });
    for (let n = 1; n <= 53; n++) {
      const ctx = await fullPool(loader, n);
      const b = await loader.station(n);
      const own = ctx.stories.filter((s) => b.storyIds.includes(s.id));
      expect(own.length).toBeGreaterThan(0);
      const picked = pickStories({ ...ctx, stories: own }).map((s) => s.id);
      for (const s of own) expect(picked, `${s.id} coverage ${storyCoverage(s, ctx.known, ctx.allowlist).toFixed(3)}`).toContain(s.id);
    }
  });

  it('every grammar point with unlocksForms yields a Form Forge / Form Chain head word over its station pool', async () => {
    const loader = corpusLoader();
    await makeTestStore({ save: { progress: { station: 10 } } });
    const ctx = await fullPool(loader, 53);
    let points = 0;
    for (const g of ctx.grammarPool) {
      if (!g.unlocksForms || g.unlocksForms.length === 0) continue;
      points++;
      const pool = { ...ctx, station: Math.max(10, g.station ?? 10) };
      for (let rep = 0; rep < 7; rep++) {
        const forge = resolveParams(pool, 'form-forge', g, { rep });
        expect(forge.targetForm, `${g.id} rep ${rep} form-forge`).toBeDefined();
        expect(g.unlocksForms).toContain(forge.targetForm);
        expect(forge.answer, `${g.id} rep ${rep}`).toBeTruthy();
        const chain = resolveParams(pool, 'form-chain', g, { rep });
        expect(chain.forms?.length ?? 0, `${g.id} rep ${rep} form-chain`).toBeGreaterThan(0);
      }
    }
    expect(points).toBeGreaterThan(50);
  });

  it('Kanji Read blanks a span whose ruby reads as the accepted answer and never cuts a ruby group', async () => {
    const loader = corpusLoader();
    await makeTestStore({ save: { progress: { station: 12 } } });
    const ctx = await fullPool(loader, 53);
    let prompts = 0;
    let inContext = 0;
    for (const k of ctx.kanjiPool) {
      k.examples.forEach((ex, rep) => {
        const p = resolveParams(ctx, 'kanji-read', k, { rep });
        prompts++;
        const plain = toPlain(p.sentence!);
        const [a, b] = p.blank!;
        expect(plain.slice(a, b), `${k.id} rep ${rep}`).toBe(ex.word);
        if (p.sentence === ex.word) return;
        inContext++;
        // Walk the ruby: no group straddles the blank, and the blank's reading is the answer.
        let off = 0;
        let reading = '';
        for (const seg of parseRuby(p.sentence!)) {
          const s0 = off;
          const s1 = off + seg.base.length;
          off = s1;
          if (s1 <= a || s0 >= b) continue;
          if (seg.reading !== null) {
            expect(s0 >= a && s1 <= b, `${k.id} rep ${rep}: ruby group {${seg.base}|${seg.reading}} cut by the blank in ${p.sentence}`).toBe(true);
            reading += seg.reading;
          } else reading += seg.base.slice(Math.max(a, s0) - s0, Math.min(b, s1) - s0);
        }
        expect(equivalentJa(reading, p.answer!), `${k.id} rep ${rep}: blank reads ${reading}, accepts ${p.answer} in ${p.sentence}`).toBe(true);
      });
    }
    expect(prompts).toBeGreaterThan(2000);
    expect(inContext).toBeGreaterThan(500);
  });

  it('Scramble over the grammar examples: a one-tile sentence is rare and the builder re-routes it to cloze', async () => {
    const loader = corpusLoader();
    await makeTestStore({ save: { progress: { station: 10 } } });
    const ctx = await fullPool(loader, 53);
    const plain = { ...ctx, stories: [] };
    const single: { g: GrammarItem; rep: number }[] = [];
    let examples = 0;
    for (const g of ctx.grammarPool) {
      g.examples.forEach((_, rep) => {
        examples++;
        if (movableTiles(resolveParams(plain, 'scramble', g, { rep }).tiles ?? []) < 2) single.push({ g, rep });
      });
    }
    // も and the bunsetsu starters cut most of them; the rest (honorific ご/お prefixes, bare verbs) stay whole and are re-routed.
    expect(single.length).toBeLessThan(examples * 0.02);
    for (const { g, rep } of single) {
      const qc = { cardKey: `${g.id}#cloze` as CardKey, itemId: g.id, kind: 'grammar' as const, facet: 'cloze' as const, r: 0.9, mature: false, exposures: 4 };
      const step = stepForCard({ ...plain, station: 10 }, qc, 'reviews', { exercise: 'scramble', rep });
      expect(step?.exercise, `${g.id} rep ${rep} ${toPlain(g.examples[rep]!.ja)}`).toBe('pattern-cloze');
    }
  });
});
