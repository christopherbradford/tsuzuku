import { createFakeLoader, DIALOGUE, G, V } from '../../content/fixtures';
import { toKana } from '../../content/ruby';
import type { StoryLine } from '../../content/types';
import { rngFor } from '../../shared/hash';
import { normalizeAnswer } from '../../shared/jp';
import {
  buildTiles,
  chooseOptions,
  goldTiles,
  gradeBuild,
  gradeOption,
  gradeTyped,
  grammarTagFor,
  grammarWrong,
  includesAll,
  okVariant,
  stemsOf,
  swapRegister,
  type DialogueOption,
} from './options';

const loader = createFakeLoader();
const get = (id: string) => loader.get(id);
const rng = () => rngFor('options-test', 1);

const line = (ja: string, tokens: string[], tokenIds?: (string | null)[], extra: Partial<StoryLine> = {}): StoryLine => ({
  ja,
  kana: toKana(ja),
  en: '',
  tokens,
  ...(tokenIds ? { tokenIds } : {}),
  ...extra,
});

const kinds = (opts: DialogueOption[]) => opts.map((o) => o.kind).sort();

describe('chooseOptions — content options', () => {
  it('returns the writer options verbatim (shuffled), recasts defaulting to the best text', () => {
    const l = DIALOGUE.lines[1] as StoryLine; // おはよう、ケン。
    const opts = chooseOptions(l, { register: 'polite', get, rng: rng() });
    expect(opts.length).toBe(3);
    expect(kinds(opts)).toEqual(['best', 'grammar-wrong', 'ok']);
    const texts = opts.map((o) => o.text).sort();
    expect(texts).toEqual(['おはよう。', 'おはようです、ケン。', 'おはよう、ケン。'].sort());
    const best = opts.find((o) => o.kind === 'best') as DialogueOption;
    expect(best.recast).toBe('おはよう、ケン。');
    for (const o of opts) expect(o.recast).toBe('おはよう、ケン。');
  });

  it('every learner line of the fixture dialogue yields exactly one best whose text is the plain line', () => {
    for (const l of DIALOGUE.lines) {
      if (l.speaker !== DIALOGUE.learnerSpeaker) continue;
      const opts = chooseOptions(l, { register: 'polite', get, rng: rng() });
      expect(opts.filter((o) => o.kind === 'best').length).toBe(1);
      expect(opts.length).toBeGreaterThanOrEqual(3);
      expect(opts.length).toBeLessThanOrEqual(4);
    }
  });

  it('is deterministic for a given rng and shuffles with a different seed', () => {
    const l = DIALOGUE.lines[11] as StoryLine; // 4 options
    const a = chooseOptions(l, { register: 'polite', get, rng: rng() }).map((o) => o.text);
    const b = chooseOptions(l, { register: 'polite', get, rng: rng() }).map((o) => o.text);
    expect(a).toEqual(b);
    const orders = new Set<string>();
    for (let i = 0; i < 12; i++) orders.add(chooseOptions(l, { register: 'polite', get, rng: rngFor('seed', i) }).map((o) => o.text).join('|'));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('chooseOptions — synthesized fallback', () => {
  const polite = line('{私|わたし}はコーヒーを{飲|の}みます。', ['私', 'は', 'コーヒー', 'を', '飲みます', '。'], [V.私, G.は, V.コーヒー, null, V.飲む, null], { mustInclude: ['コーヒー', '飲みます'] });

  it('yields 3–4 distinct options with exactly one best equal to the plain line', () => {
    const opts = chooseOptions(polite, { register: 'polite', get, rng: rng() });
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(opts.length).toBeLessThanOrEqual(4);
    expect(opts.filter((o) => o.kind === 'best').length).toBe(1);
    expect(opts.find((o) => o.kind === 'best')?.text).toBe('私はコーヒーを飲みます。');
    const keys = new Set(opts.map((o) => normalizeAnswer(o.text)));
    expect(keys.size).toBe(opts.length);
    for (const o of opts) expect(o.recast).toBe('私はコーヒーを飲みます。');
  });

  it('is deterministic with the same rng', () => {
    const a = chooseOptions(polite, { register: 'polite', get, rng: rng() });
    const b = chooseOptions(polite, { register: 'polite', get, rng: rng() });
    expect(a).toEqual(b);
  });

  it('the register-wrong option is in the other register and the grammar-wrong one differs by a particle or form', () => {
    const opts = chooseOptions(polite, { register: 'polite', get, rng: rng() });
    const reg = opts.find((o) => o.kind === 'register-wrong');
    expect(reg?.text).toBe('私はコーヒーを飲む。');
    const gram = opts.find((o) => o.kind === 'grammar-wrong');
    expect(gram).toBeDefined();
    expect(gradeOption(gram as DialogueOption, '私はコーヒーを飲みます。').tags[0]).toMatch(/particle|conjugation/);
    const ok = opts.find((o) => o.kind === 'ok');
    expect(ok?.text).toBe('コーヒーを飲みます。'); // topic dropped, mustInclude kept
  });
});

describe('swapRegister', () => {
  it('polite target → plain version via conjugate (ます → dictionary, ました → た, ません → ない, です → だ)', () => {
    const get2 = get;
    expect(swapRegister(line('パンを{食|た}べます。', ['パン', 'を', '食べます', '。'], [V.パン, null, V.食べる, null]), { register: 'polite', get: get2 })).toBe('パンを食べる。');
    expect(swapRegister(line('パンを{食|た}べました。', ['パン', 'を', '食べました', '。'], [V.パン, null, V.食べる, null]), { register: 'polite', get: get2 })).toBe('パンを食べた。');
    expect(swapRegister(line('{水|みず}を{飲|の}みません。', ['水', 'を', '飲みません', '。'], [V.水, null, V.飲む, null]), { register: 'polite', get: get2 })).toBe('水を飲まない。');
    expect(swapRegister(line('これは{犬|いぬ}です。', ['これ', 'は', '犬', 'です', '。'], [null, G.は, V.犬, G.です, null]), { register: 'polite', get: get2 })).toBe('これは犬だ。');
    expect(swapRegister(line('コーヒーはおいしいです。', ['コーヒー', 'は', 'おいしい', 'です', '。'], [V.コーヒー, G.は, V.おいしい, G.です, null]), { register: 'polite', get: get2 })).toBe('コーヒーはおいしい。');
    expect(swapRegister(line('{飲|の}みますか。', ['飲みます', 'か', '。'], [V.飲む, null, null]), { register: 'polite', get: get2 })).toBe('飲む。');
  });

  it('casual target → polite version', () => {
    expect(swapRegister(line('パンを{食|た}べる。', ['パン', 'を', '食べる', '。'], [V.パン, null, V.食べる, null]), { register: 'casual', get })).toBe('パンを食べます。');
    expect(swapRegister(line('{水|みず}を{飲|の}んだ。', ['水', 'を', '飲んだ', '。'], [V.水, null, V.飲む, null]), { register: 'casual', get })).toBe('水を飲みました。');
    expect(swapRegister(line('これは{犬|いぬ}だ。', ['これ', 'は', '犬', 'だ', '。'], [null, G.は, V.犬, null, null]), { register: 'casual', get })).toBe('これは犬です。');
    expect(swapRegister(line('おいしい。', ['おいしい', '。'], [V.おいしい, null]), { register: 'casual', get })).toBe('おいしいです。');
    expect(swapRegister(line('{犬|いぬ}。', ['犬', '。'], [V.犬, null]), { register: 'casual', get })).toBe('犬です。');
  });

  it('kana spelling is kept when the token was kana', () => {
    expect(swapRegister(line('のみます。', ['のみます', '。'], [V.飲む, null]), { register: 'polite', get })).toBe('のむ。');
  });

  it('returns null when nothing can be swapped', () => {
    expect(swapRegister(line('おはよう、ケン。', ['おはよう', '、', 'ケン', '。'], [V.おはよう, null, null, null]), { register: 'polite', get })).toBeNull();
    expect(swapRegister(line('パンを食べます。', ['パン', 'を', '食べます', '。']), { register: 'polite', get })).toBeNull(); // no ids → unknown verb
  });
});

describe('grammarWrong / okVariant', () => {
  it('swaps a particle for its plausible partner, deterministically', () => {
    const l = line('{犬|いぬ}は{水|みず}を{飲|の}みます。', ['犬', 'は', '水', 'を', '飲みます', '。'], [V.犬, G.は, V.水, null, V.飲む, null]);
    const a = grammarWrong(l, { get, rng: rng() });
    expect(a).toMatch(/^犬(を水を|は水が)飲みます。$/);
    expect(grammarWrong(l, { get, rng: rng() })).toBe(a);
  });

  it('falls back to a ます-glitch, then a stray です', () => {
    expect(grammarWrong(line('{飲|の}みます。', ['飲みます', '。'], [V.飲む, null]), { get, rng: rng() })).toBe('飲むます。');
    expect(grammarWrong(line('おはよう、ケン。', ['おはよう', '、', 'ケン', '。'], [V.おはよう, null, null, null]), { get, rng: rng() })).toBe('おはようです、ケン。');
    expect(grammarWrong(line('。', ['。']), { get, rng: rng() })).toBeNull();
  });

  it('okVariant drops a leading interjection, a topic, or toggles ね while keeping mustInclude', () => {
    expect(okVariant(line('はい、{飲|の}みます。', ['はい', '、', '飲みます', '。'], undefined, { mustInclude: ['飲みます'] }))).toBe('飲みます。');
    expect(okVariant(line('はい、{私|わたし}もパンを{食|た}べます。', ['はい', '、', '私', 'も', 'パン', 'を', '食べます', '。'], undefined, { mustInclude: ['パン', '食べます'] }))).toBe('私もパンを食べます。');
    expect(okVariant(line('{私|わたし}は{水|みず}を{飲|の}みます。', ['私', 'は', '水', 'を', '飲みます', '。']))).toBe('水を飲みます。');
    expect(okVariant(line('おいしいですね。', ['おいしい', 'です', 'ね', '。']))).toBe('おいしいです。');
    expect(okVariant(line('おいしいです。', ['おいしい', 'です', '。']))).toBe('おいしいですね。');
    // mustInclude blocks the variant that would drop the required word; the next strategy (ね) still applies
    expect(okVariant(line('はい、{飲|の}みます。', ['はい', '、', '飲みます', '。'], undefined, { mustInclude: ['はい'] }))).toBe('はい、飲みますね。');
    expect(okVariant(line('はい、ケン。', ['はい', '、', 'ケン', '。'], undefined, { mustInclude: ['はい'] }))).toBeNull();
    expect(okVariant(line('ケン。', ['ケン', '。']))).toBeNull();
  });

  it('includesAll lists the missing must-include words, normalized', () => {
    expect(includesAll('コーヒーを飲みます', ['コーヒー', '飲みます'])).toEqual([]);
    expect(includesAll('こーひーをのみます', ['コーヒー'])).toEqual([]);
    expect(includesAll('水を飲みます', ['コーヒー', '飲みます'])).toEqual(['コーヒー']);
    expect(includesAll('x', undefined)).toEqual([]);
    // a conjugated form of a must-include word counts
    expect(includesAll('水を飲む', ['飲みます'])).toEqual([]);
    expect(includesAll('水を飲んだ', ['飲みます'])).toEqual([]);
    expect(includesAll('パンをたべる', ['たべます'])).toEqual([]);
    expect(includesAll('水を見ます', ['飲みます'])).toEqual(['飲みます']);
    expect(stemsOf('飲みます')).toEqual(['飲みます', '飲み', '飲']);
    expect(stemsOf('たべます')).toEqual(['たべます', 'たべ']);
    expect(stemsOf('水')).toEqual(['水']);
  });
});

describe('buildTiles', () => {
  it('drops punctuation, keeps every token, never returns the gold order, deterministic', () => {
    const l = DIALOGUE.lines[11] as StoryLine; // 私も水を飲みます。
    const gold = goldTiles(l);
    expect(gold).toEqual(['私', 'も', '水', 'を', '飲みます']);
    const tiles = buildTiles(l, rng());
    expect(tiles.slice().sort()).toEqual(gold.slice().sort());
    expect(tiles).not.toEqual(gold);
    expect(buildTiles(l, rng())).toEqual(tiles);
    for (let i = 0; i < 20; i++) expect(buildTiles(l, rngFor('b', i))).not.toEqual(gold);
  });

  it('a one-tile line comes back as is', () => {
    expect(buildTiles(line('はい。', ['はい', '。']), rng())).toEqual(['はい']);
    expect(buildTiles(line('。', ['。']), rng())).toEqual([]);
  });
});

describe('grading', () => {
  const gold = '私も水を飲みます。';

  it('gradeOption: best/ok correct, register-wrong tagged register, grammar-wrong tagged by the slip', () => {
    expect(gradeOption({ kind: 'best', text: gold }, gold)).toEqual({ correct: true, best: true, tags: [] });
    expect(gradeOption({ kind: 'ok', text: '水を飲みます。' }, gold)).toEqual({ correct: true, best: false, tags: [] });
    expect(gradeOption({ kind: 'register-wrong', text: 'あたしも水、飲む。' }, gold)).toEqual({ correct: false, best: false, tags: ['register'] });
    expect(gradeOption({ kind: 'grammar-wrong', text: '私も水が飲みます。' }, gold).tags).toEqual(['particle']);
    expect(gradeOption({ kind: 'grammar-wrong', text: '犬を水は飲みますか。' }, '犬は水を飲みますか。').tags).toEqual(['word-order']);
    expect(gradeOption({ kind: 'grammar-wrong', text: 'はい、飲むます。' }, 'はい、飲みます。').tags).toEqual(['conjugation']);
    expect(grammarTagFor('おはようです、ケン。', 'おはよう、ケン。')).toBe('conjugation');
  });

  const l = DIALOGUE.lines[11] as StoryLine; // 私も水を飲みます。 accept 私も飲みます。 mustInclude 水, 飲みます

  it('gradeTyped: plain ja or accept → best; kana / width / punctuation variants are equivalent', () => {
    expect(gradeTyped('私も水を飲みます。', l, { register: 'polite' })).toMatchObject({ correct: true, best: true, tags: [] });
    expect(gradeTyped('わたしもみずをのみます', l, { register: 'polite' }).best).toBe(true);
    expect(gradeTyped('私も飲みます。', l, { register: 'polite' }).best).toBe(true);
    expect(gradeTyped('　私も水を飲みます！', l, { register: 'polite' }).best).toBe(true);
  });

  it('gradeTyped: a Block (small kana / long vowel) is a near miss, correct but not best, tagged', () => {
    const r = gradeTyped('わたしもみずをのみまず', l, { register: 'polite' });
    expect(r.nearMiss).toBe('transcription');
    expect(r.correct).toBe(true);
    expect(r.best).toBe(false);
    expect(r.tags).toEqual(['transcription']);
    const r2 = gradeTyped('コーヒーをのみまっす。', line('コーヒーを{飲|の}みます。', ['コーヒー', 'を', '飲みます', '。']), { register: 'polite' });
    expect(r2.nearMiss).toBe('small-kana');
  });

  it('gradeTyped: must-include words + right register → ok; missing words → word-choice; wrong register → register', () => {
    const ok = gradeTyped('水をたくさん飲みます。', l, { register: 'polite' });
    expect(ok).toMatchObject({ correct: true, best: false, tags: [], missing: [], registerOk: true });
    const missing = gradeTyped('コーヒーを飲みます。', l, { register: 'polite' });
    expect(missing.correct).toBe(false);
    expect(missing.tags).toEqual(['word-choice']);
    expect(missing.missing).toEqual(['水']);
    const casual = gradeTyped('私も水を飲む。', l, { register: 'polite' });
    expect(casual.correct).toBe(false);
    expect(casual.tags).toEqual(['register']);
    expect(casual.registerOk).toBe(false);
    const both = gradeTyped('コーヒー飲む。', l, { register: 'polite' });
    expect(both.tags).toEqual(['word-choice', 'register']);
    expect(both.recast).toBe('私も水を飲みます。');
  });

  it('gradeTyped: empty answer is wrong with everything missing', () => {
    const r = gradeTyped('', l, { register: 'polite' });
    expect(r.correct).toBe(false);
    expect(r.missing).toEqual(['水', '飲みます']);
  });

  it('gradeTyped honours a register target (keigo expected)', () => {
    const k = line('{少々|しょうしょう}お{待|ま}ちください。', ['少々', 'お待ちください', '。'], undefined, { mustInclude: ['お待ち'] });
    expect(gradeTyped('少々お待ちくださいませ。', k, { register: 'honorific' }).correct).toBe(true);
    expect(gradeTyped('ちょっと待って。', k, { register: 'honorific' }).tags).toEqual(['word-choice', 'register']);
  });

  it('gradeBuild: gold order or an accept surface is correct; anything else is word-order', () => {
    expect(gradeBuild(['私', 'も', '水', 'を', '飲みます'], l)).toEqual({ correct: true, best: true, tags: [] });
    expect(gradeBuild(['私', 'も', '飲みます'], l)).toEqual({ correct: true, best: true, tags: [] });
    expect(gradeBuild(['水', 'を', '私', 'も', '飲みます'], l)).toEqual({ correct: false, best: false, tags: ['word-order'] });
  });
});
