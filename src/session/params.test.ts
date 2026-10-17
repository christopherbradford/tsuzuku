/**
 * params.ts — resolved step params: bunsetsu tiles, Form Chain links, Minimal Pair sides (design 04 §4, §5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey, GrammarItem } from '../content/types';
import { FIXTURE_IDS, G, V, createFakeLoader } from '../content/fixtures';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { loadPlanContext, resolveParams, splitBunsetsu } from './builder';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

function due(s = 5): CardTuple {
  return card({ due: TODAY, s, d: 5, reps: 6, lapses: 0, state: 2, last: TODAY - 1, flags: 0 });
}

/** Base-facet cards for every fixture item (builder.test pattern). */
function allCards(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of FIXTURE_IDS.vocab) out[`${id}#${id === V.おはよう || id === V.はい ? 'prod' : 'rec'}`] = due();
  for (const id of FIXTURE_IDS.kanji) out[`${id}#comp`] = due();
  for (const id of FIXTURE_IDS.grammar) out[`${id}#cloze`] = due();
  for (const id of FIXTURE_IDS.component) out[`${id}#rec`] = due();
  return out;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('bunsetsu tiles and Minimal Pair (design 04 §4, §5)', () => {
  it('splitBunsetsu never cuts a particle that continues a word (ありがとう・ながら・とき・べからず) and keeps のは/のが on the word', () => {
    expect(splitBunsetsu('ありがとうございました。')).toEqual(['ありがとうございました', '。']);
    expect(splitBunsetsu('残念ながら、行けません。')).toEqual(['残念ながら', '、', '行けません', '。']);
    expect(splitBunsetsu('失敗したときこそ学ぶ。')).toEqual(['失敗したときこそ学ぶ', '。']);
    expect(splitBunsetsu('忘るべからず。')).toEqual(['忘るべからず', '。']);
    expect(splitBunsetsu('助けるのが友達というものだ。')).toEqual(['助けるのが', '友達というものだ', '。']);
    expect(splitBunsetsu('来るのは恐縮です。')).toEqual(['来るのは', '恐縮です', '。']);
    // a particle before kanji, katakana or punctuation still closes its tile
    expect(splitBunsetsu('これはペンです。')).toEqual(['これは', 'ペンです', '。']);
    expect(splitBunsetsu('本を読む。')).toEqual(['本を', '読む', '。']);
    expect(splitBunsetsu('私の。')).toEqual(['私の', '。']);
  });

  it('Minimal Pair speaks either half of the pair across draws, and the answer is always one of the choices', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = resolveParams(ctx, 'minimal-pair', loader.get(V.犬)!, { rep: i });
      expect(p.choices).toHaveLength(2);
      expect(p.choices).toContain(p.answer);
      seen.add(p.answer as string);
    }
    expect(seen.size).toBe(2);
    expect(seen.has('いぬ')).toBe(true);
  });
});

describe('Form Chain links (design 04 §4 "one verb, 5 target forms")', () => {
  it('a one-form point still yields 5 links: its own form first, then forms of points already met, then any form the verb takes', async () => {
    await makeTestStore({ save: { progress: { station: 12 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const ta: GrammarItem = { ...loader.get<GrammarItem>(G.ます)!, id: 'g-n5-064', unlocksForms: ['ta'] };
    const one = resolveParams(ctx, 'form-chain', ta, { rep: 0 });
    expect(one.forms).toHaveLength(5);
    expect(one.forms![0]).toBe('ta');
    expect(new Set(one.forms).size).toBe(5);
    expect(one.answers).toHaveLength(5);
    for (const a of one.answers!) expect(a.length).toBeGreaterThan(0);
    expect(one.accept!.length).toBeGreaterThanOrEqual(5);
    // forms unlocked by an already-introduced point (station ≤ current) are preferred over arbitrary padding
    const met: GrammarItem = { ...ta, id: 'g-n5-046', unlocksForms: ['te', 'te-iru'], station: 4 };
    const chain = resolveParams({ ...ctx, grammarPool: [met] }, 'form-chain', ta, { rep: 0 });
    expect(chain.forms![0]).toBe('ta');
    expect(chain.forms!.slice(1, 3).sort()).toEqual(['te', 'te-iru']);
    expect(chain.forms).toHaveLength(5);
    // a point ahead on the road counts only once the learner knows it
    const ahead: GrammarItem = { ...met, id: 'g-n5-077', unlocksForms: ['potential'], station: 14 };
    const known = resolveParams({ ...ctx, grammarPool: [ahead], known: new Set([...ctx.known, ahead.id]) }, 'form-chain', ta, { rep: 0 });
    expect(known.forms![1]).toBe('potential');
  });
});
