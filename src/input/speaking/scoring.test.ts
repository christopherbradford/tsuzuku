import { createFakeLoader, DIALOGUE, STORY, V } from '../../content/fixtures';
import type { CardKey, StoryLine } from '../../content/types';
import type { CardTuple } from '../../shared/store-types';
import { card } from '../../store/testing';
import {
  IMPLICIT_WINDOW_DAYS,
  bandFor,
  checklistHints,
  checklistToRating,
  implicitGradesForLine,
  implicitProdGrades,
  implicitRatingFor,
  latticeUnits,
  pitchShape,
  rubyMixedDistance,
  rubyMixedSimilarity,
  scoreRecognition,
  similarity,
  toMorae,
} from './scoring';

const LINE = { ja: '{毎朝|まいあさ}コーヒーを{飲|の}みます。', kana: 'まいあさコーヒーをのみます。' };

describe('toMorae', () => {
  it('folds katakana, drops punctuation, keeps ー and small kana as mora parts', () => {
    expect(toMorae('コーヒーを飲みます。')).toEqual(['こ', 'ー', 'ひ', 'ー', 'を', '飲', 'み', 'ま', 'す']);
    expect(toMorae('きょう、きって')).toEqual(['きょ', 'う', 'き', 'っ', 'て']);
    expect(toMorae('つづく')).toEqual(['つ', 'ず', 'く']);
    expect(toMorae('')).toEqual([]);
  });
});

describe('rubyMixedDistance / lattice', () => {
  it('builds fixed units and two-way ruby units', () => {
    const u = latticeUnits('{飲|の}む');
    expect(u).toEqual([{ kind: 'ruby', base: ['飲'], reading: ['の'] }, { kind: 'fixed', mora: 'む' }]);
  });

  it('is 0 for the plain surface, the kana surface and any mixture', () => {
    expect(rubyMixedDistance('毎朝コーヒーを飲みます', LINE.ja)).toBe(0);
    expect(rubyMixedDistance('まいあさコーヒーをのみます', LINE.ja)).toBe(0);
    expect(rubyMixedDistance('毎朝コーヒーをのみます', LINE.ja)).toBe(0);
    expect(rubyMixedDistance('まいあさコーヒーを飲みます。', LINE.ja)).toBe(0);
  });

  it('counts real differences in morae', () => {
    expect(rubyMixedDistance('毎朝コーヒーを飲みました', LINE.ja)).toBe(2); // ます → ました
    expect(rubyMixedDistance('毎朝お茶を飲みます', LINE.ja)).toBeGreaterThanOrEqual(3);
    // the shortest variant (plain, kanji as single morae) is the cheapest path for an empty hypothesis
    expect(rubyMixedDistance('', LINE.ja)).toBe(toMorae('毎朝コーヒーを飲みます').length);
    expect(rubyMixedDistance('', LINE.ja)).toBe(11);
  });

  it('similarity normalises by the plain length and never exceeds the pure-surface scores', () => {
    expect(rubyMixedSimilarity('毎朝コーヒーを飲みます', LINE.ja)).toBe(1);
    const mixed = rubyMixedSimilarity('毎朝コーヒーをのみます', LINE.ja);
    expect(mixed).toBe(1);
    expect(rubyMixedSimilarity('', LINE.ja)).toBe(0);
    expect(rubyMixedSimilarity('x', '')).toBe(0);
    expect(rubyMixedSimilarity('', '')).toBe(1);
  });
});

describe('scoreRecognition', () => {
  it('a real Chrome-style alternative containing kanji scores ≥ 0.95 against its ruby line', () => {
    const r = scoreRecognition(['毎朝コーヒーを飲みます'], LINE);
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(r.best).toBe('毎朝コーヒーを飲みます');
    expect(r.scores).toEqual([r.score]);
  });

  it('best of 5: picks the highest alternative and reports it verbatim', () => {
    const alts = ['毎朝 コーヒー を 飲み ました', '毎朝コーヒーを飲みます。', 'マイアサコーヒーヲノミマス', 'まいあさこーひーをのみます', '毎日コーヒーを飲みます'];
    const r = scoreRecognition(alts, LINE);
    expect(r.score).toBe(1);
    expect(['毎朝コーヒーを飲みます。', 'マイアサコーヒーヲノミマス', 'まいあさこーひーをのみます']).toContain(r.best);
    expect(r.best).toBe('毎朝コーヒーを飲みます。'); // first to reach the max
    expect(r.scores.length).toBe(5);
    expect(r.scores[0]).toBeLessThan(1);
    expect(r.scores[4]).toBeLessThan(1);
  });

  it('only the first five alternatives count', () => {
    const r = scoreRecognition(['a', 'b', 'c', 'd', 'e', '毎朝コーヒーを飲みます'], LINE);
    expect(r.score).toBeLessThan(0.5);
    expect(r.scores.length).toBe(5);
  });

  it('near sentences land in the Hard band, unrelated ones in Again', () => {
    const near = scoreRecognition(['毎朝コーヒーを飲みました'], LINE); // 2 of 13 morae off
    expect(near.score).toBeGreaterThanOrEqual(0.8);
    const blocked = scoreRecognition(['毎朝お茶を飲む'], LINE);
    expect(blocked.score).toBeLessThan(0.8);
    const wrong = scoreRecognition(['今日は雨です'], LINE);
    expect(wrong.score).toBeLessThan(0.6);
  });

  it('kana-only recognizer output scores against the kana surface; mixed output through the lattice', () => {
    expect(similarity('まいあさコーヒーをのみます', LINE).score).toBe(1);
    const mixed = similarity('毎朝コーヒーをのみます', LINE);
    expect(mixed.score).toBe(1);
    expect(mixed.variant).toBe('mixed');
    const plain = similarity('毎朝コーヒーを飲みます', LINE);
    expect(plain.variant).toBe('plain');
  });

  it('a long-vowel slip costs one mora (つづく-style ぢ/づ folding is free)', () => {
    const r = scoreRecognition(['毎朝コヒーを飲みます'], LINE);
    expect(r.score).toBeCloseTo(1 - 1 / 11, 6); // plain surface: 11 morae, one missing
    expect(similarity('つづく', { ja: 'つずく', kana: 'つずく' }).score).toBe(1);
  });

  it('empty alternatives → 0 and empty best', () => {
    expect(scoreRecognition([], LINE)).toEqual({ score: 0, best: '', variant: 'plain', scores: [] });
    expect(scoreRecognition([''], LINE).score).toBe(0);
  });

  it('works on every fixture line (plain surface always perfect)', () => {
    for (const l of [...STORY.lines, ...DIALOGUE.lines]) {
      const plain = l.ja.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1');
      expect(scoreRecognition([plain], l).score).toBe(1);
      expect(scoreRecognition([l.kana], l).score).toBe(1);
    }
  });
});

describe('bands', () => {
  it('bandFor follows SHADOW_BANDS', () => {
    expect(bandFor(1)).toBe(3);
    expect(bandFor(0.8)).toBe(3);
    expect(bandFor(0.79)).toBe(2);
    expect(bandFor(0.6)).toBe(2);
    expect(bandFor(0.59)).toBe(1);
    expect(bandFor(0)).toBe(1);
  });

  it('implicitRatingFor writes Good or Again, nothing for a Blocked line', () => {
    expect(implicitRatingFor(0.9)).toBe(3);
    expect(implicitRatingFor(0.7)).toBeNull();
    expect(implicitRatingFor(0.3)).toBe(1);
  });
});

describe('checklist', () => {
  it('maps 3/3 → Good, 2/3 → Hard, ≤ 1 → Again', () => {
    expect(checklistToRating({ mora: true, longVowels: true, pitch: true })).toBe(3);
    expect(checklistToRating({ mora: true, longVowels: true, pitch: false })).toBe(2);
    expect(checklistToRating({ mora: false, longVowels: true, pitch: true })).toBe(2);
    expect(checklistToRating({ mora: true, longVowels: false, pitch: false })).toBe(1);
    expect(checklistToRating({ mora: false, longVowels: false, pitch: false })).toBe(1);
  });

  it('pitchShape from the nucleus', () => {
    expect(pitchShape(0, 3)).toBe('heiban');
    expect(pitchShape(1, 3)).toBe('atamadaka');
    expect(pitchShape(2, 3)).toBe('nakadaka');
    expect(pitchShape(3, 3)).toBe('odaka');
    expect(pitchShape(undefined, 3)).toBeNull();
    expect(pitchShape(2, 0)).toBeNull();
    expect(pitchShape(-1, 3)).toBeNull();
  });

  it('checklistHints counts morae and finds long vowels', () => {
    const h = checklistHints('まいあさコーヒーをのみます。', 1);
    expect(h.morae).toBe(13);
    expect(h.longVowels).toEqual(['こー', 'ひー']);
    expect(h.pitch).toBe('atamadaka');
    expect(checklistHints('おばあさん').longVowels).toEqual(['ばあ']);
    expect(checklistHints('とうきょう').longVowels).toEqual(['とう', 'ょう']);
    expect(checklistHints('せんせい').longVowels).toEqual(['せい']);
    expect(checklistHints('きて').longVowels).toEqual([]);
    expect(checklistHints('きって').morae).toBe(3);
  });
});

describe('implicitProdGrades', () => {
  const loader = createFakeLoader();
  const get = (id: string) => loader.get(id);
  const TODAY = 20_000;
  function cards(entries: Record<string, CardTuple>): { get(k: CardKey): CardTuple | undefined } {
    const m = new Map(Object.entries(entries));
    return { get: (k) => m.get(k) };
  }

  it('grades only content words with a prod card due within 3 days, deduped', () => {
    const c = cards({
      [`${V.コーヒー}#prod`]: card({ due: TODAY }),
      [`${V.飲む}#prod`]: card({ due: TODAY + IMPLICIT_WINDOW_DAYS }),
      [`${V.私}#prod`]: card({ due: TODAY + IMPLICIT_WINDOW_DAYS + 1 }),
      [`${V.水}#rec`]: card({ due: TODAY }), // no prod card
    });
    const tokens = [V.私, null, V.コーヒー, null, V.飲む, null, V.飲む, V.水, 'g-n5-001'];
    const grades = implicitProdGrades(tokens, get, c, TODAY, 3);
    expect(grades).toEqual([
      { cardKey: `${V.コーヒー}#prod`, rating: 3 },
      { cardKey: `${V.飲む}#prod`, rating: 3 },
    ]);
  });

  it('skips function-word POS, unknown ids, grammar ids and surfaces without a map', () => {
    const c = cards({ [`${V.はい}#prod`]: card({ due: TODAY }), [`${V.犬}#prod`]: card({ due: TODAY }) });
    expect(implicitProdGrades(['犬', 'nonsense', 'g-n5-002', 'v-n5-9999'], get, c, TODAY, 1)).toEqual([]);
    // an interjection (pos int) still counts: it is a content word of the line
    expect(implicitProdGrades([V.はい], get, c, TODAY, 1)).toEqual([{ cardKey: `${V.はい}#prod`, rating: 1 }]);
    // a surfaces map resolves surfaces
    expect(implicitProdGrades(['犬'], get, c, TODAY, 1, { 犬: V.犬 })).toEqual([{ cardKey: `${V.犬}#prod`, rating: 1 }]);
  });

  it('a redirected id resolves through the loader', () => {
    const c = cards({ [`${V.コーヒー}#prod`]: card({ due: TODAY }) });
    // v-n5-0009 redirects to コーヒー in the fixture manifest, but the card key uses the id given
    expect(implicitProdGrades(['v-n5-0009'], get, c, TODAY, 3)).toEqual([]);
  });

  it('implicitGradesForLine: Good/Again by score, nothing for Hard or a line without tokenIds', () => {
    const line = DIALOGUE.lines[2] as StoryLine; // コーヒーを飲みますか。
    const c = cards({ [`${V.コーヒー}#prod`]: card({ due: TODAY }), [`${V.飲む}#prod`]: card({ due: TODAY - 10 }) });
    expect(implicitGradesForLine(line, 0.95, get, c, TODAY).map((g) => g.rating)).toEqual([3, 3]);
    expect(implicitGradesForLine(line, 0.2, get, c, TODAY).map((g) => g.rating)).toEqual([1, 1]);
    expect(implicitGradesForLine(line, 0.7, get, c, TODAY)).toEqual([]);
    expect(implicitGradesForLine({ tokenIds: undefined }, 0.95, get, c, TODAY)).toEqual([]);
  });
});
