/**
 * TSUZUKU — the story linker: token → item id (CONTENT_GUIDE §14.2 / V20).
 *
 * Shared by `assign-stations.ts` (`content:assign` writes `StoryLine.tokenIds`
 * through `linkStories`) and `validate-content.ts` (V19 / V20 and the V36
 * segmentation). Runs under Node's native type stripping (erasable TypeScript
 * only); `assign-stations.ts` re-exports everything here for older imports.
 *
 * `buildMatchPool` turns a cumulative allowlist (+ a story's plusOne words)
 * into the lookups `matchToken` consults, in this order:
 *  1. `exact`    — word / kana / altForm (`〜` stripped) → id; the first
 *     allowlisted item keeps a surface. The kana reading of an affix (総〜,
 *     高〜, 〜性) is not a surface: a bound morpheme never stands alone, so a
 *     bare そう / こう / せい token is never the affix.
 *  2. `forms`    — generated inflections (`inflectedForms`) of the verbs and
 *     of an `aux` copula item: polite ます-row, ない / なかった, た / て with the
 *     godan onbin (って った / んで んだ / いて いた / いで いだ / して した; 行く
 *     and いく・ゆく take って), the contracted てる / てた, ば, volitional,
 *     godan 〜たい; the する (し・します・しない・した・して・しよう・すれば) and
 *     来る (き・きます・こない・きた・きて・こよう・くれば) paradigms; ではない /
 *     じゃありません / じゃなかった / でしょう … for です. A form is matched
 *     whole, so it is always the longest surface and never a shorter word's
 *     stem (出して → 出す, not the 出 stem of 出る; いきます → 行く, not the
 *     いき stem of 生きる). Which surfaces inflect: every kana-written
 *     surface (word, kana altForm, or the kana reading of an `AUX_VERBS`
 *     lexeme), and kanji surfaces with a one-character stem or a する
 *     compound — a longer kanji stem is already unambiguous for step 4. The
 *     kana reading of any other kanji verb does not inflect (なった is not
 *     鳴る, しまった is not 閉まる): stories write content verbs in kanji with
 *     ruby. Collisions: an `AUX_VERBS` lexeme beats a content verb (きた →
 *     来る, not 着る; いって → 行く, not 言う or 要る), otherwise the first
 *     allowlisted item wins. A kana token that `exact` knows only as the
 *     READING of a kanji word (きた ← 北, した ← 下, いない ← 以内) yields to
 *     a generated form for the same reason — and, since stories write content
 *     words in kanji with ruby, to every other reading of the token as well:
 *     a function token (に is the particle, not 二; さん the suffix, not 三;
 *     こと the nominaliser, not 琴), a name or a numeral — but not to an
 *     inflection stem (わたし is 私, not the わた stem of 渡す), so it sits
 *     between step 3 and step 4 (わたし → 私, たぶん → 多分). The reading of an
 *     `AUX_VERBS` lexeme is a real surface (いく おく みる くる link to 行く 置く
 *     見る 来る once allowlisted — auxiliaries are written in kana). The kana stage is the
 *     exception (`kanaStage`, Stations 1–3: all-kana text written against the
 *     White set), where the reading wins right after the forms (いち、に、さん
 *     counts 二 and 三). Outside the kana stage a kana-written word beats the
 *     mere reading of a kanji word registered before it (いや over 嫌, なる
 *     over 鳴る); in it, the first allowlisted item keeps the surface. A kanji
 *     homograph that a longer
 *     stem of another verb also inflects to (降りました: 降る / 降りる) goes to
 *     the longest stem, like every prefix match (`resolveForm`). Bare し / き
 *     are not forms (し is the conjunction particle; き alone is never
 *     written for 来).
 *  3. function tokens (`FUNCTION_TOKENS`), cast / story names, kanji numerals
 *     → known, unlinked. A form of an allowlisted verb that is also a
 *     function token (します, いった, もらって …) is linked by step 2; before
 *     the verb is introduced it stays a function token.
 *  4. `prefixes` — inflection stems, longest first (a single-kanji stem only
 *     before okurigana or at token end, `stemApplies`), then counters after a
 *     numeral, grammar clozeHints and name + suffix.
 */
import { hasKanji } from '../src/content/ruby.ts';
import type { GrammarItem, StationBundle, VocabItem } from '../src/content/types.ts';

/** Fixed Tabi Nikki cast (CONTENT_GUIDE §14.1): always allowlisted names, never unknown tokens. */
export const CAST_NAMES: ReadonlySet<string> = new Set(['ハナ', 'ケン', 'アオ', '田中', '田中さん']);

/**
 * Function tokens that never count as unknown in V20: particles, copula and
 * ます-forms, て-form auxiliaries (dictionary, ます and て forms), する-forms and
 * name suffixes (CONTENT_GUIDE §14.2, extended with their inflections). They
 * are consulted AFTER `exact` and `forms`, so once the verb behind one is
 * allowlisted the token links to it.
 */
export const FUNCTION_TOKENS: ReadonlySet<string> = new Set([
  // particles
  'は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の', 'も', 'か', 'ね', 'よ', 'な', 'わ', 'って',
  'や', 'し', 'ば', 'ても', 'でも', 'のに', 'ので', 'けど', 'けれど', 'けれども', 'のは', 'のが', 'には', 'では', 'とは', 'へは',
  'からは', 'までは', 'とか', 'だけ', 'しか', 'ほど', 'くらい', 'ぐらい', 'ずつ', 'など', 'なんて', 'かな', 'よね', 'ぞ', 'ぜ', 'さ', 'っけ',
  // formal nouns, demonstrative adverbs, the sentence-final もん and the adverbial negative (こと is not 琴, そう is not 僧, なく is not 鳴く)
  'こと', 'もん', 'そう', 'こう', 'なく', 'なくて', 'なかった',
  // the 連用形 あり (〜であり) and the interjections え / おや (not 蟻, 絵, 親)
  'あり', 'え', 'おや',
  // copula and ます-forms
  'です', 'だ', 'でした', 'だった', 'じゃない', 'ではない', 'じゃありません', 'ではありません', 'じゃなかった', 'ではなかった',
  'でしょう', 'だろう', 'ます', 'ません', 'ました', 'ましょう', 'ませんでした', 'ましょうか', 'ませんか', 'なら', 'なの', 'なん',
  // て-form auxiliaries
  'いる', 'います', 'いた', 'いました', 'いない', 'いません', 'いて', 'ある', 'あります', 'あった', 'ありました', 'ない', 'ありません', 'あって',
  'おく', 'おきます', 'おいた', 'おいて', 'みる', 'みます', 'みた', 'みて', 'しまう', 'しまいます', 'しまった', 'しまって',
  'くれる', 'くれます', 'くれた', 'くれて', 'もらう', 'もらいます', 'もらった', 'もらって', 'あげる', 'あげます', 'あげた', 'あげて',
  'いく', 'いきます', 'いった', 'いって', 'くる', 'きます', 'きた', 'きて', 'する', 'します', 'した', 'して', 'しない', 'しません',
  // name suffixes
  'さん', 'ちゃん', 'くん', '様', 'さま', 'たち',
]);

/** て-form auxiliaries / light verbs by kana dictionary form: their kana inflections win a `forms` collision. */
export const AUX_VERBS: ReadonlySet<string> = new Set(['いく', 'ゆく', 'くる', 'いる', 'おる', 'ある', 'おく', 'みる', 'しまう', 'くれる', 'もらう', 'あげる', 'する']);

const PUNCT_TOKEN_RE = /^[\p{P}\p{S}\s]+$/u;
const KANJI_NUMERAL_RE = /^[〇零一二三四五六七八九十百千万億兆]+$/;

/** A generated inflection: the item it belongs to, its stem length and whether the lexeme is an `AUX_VERBS` auxiliary. */
export interface FormEntry {
  id: string;
  stem: number;
  aux: boolean;
}

export interface MatchPool {
  /** exact surface → vocab id */
  exact: Map<string, string>;
  /** generated inflection (`inflectedForms`) → its item */
  forms: Map<string, FormEntry>;
  /** `exact` surfaces that are only the kana reading of a kanji word (きた ← 北); every other reading of the token beats them (module header) */
  readings: Set<string>;
  /** Stations 1–3: all-kana stories written against the White set — a reading wins right after the forms */
  kanaStage: boolean;
  /** inflection stems (longest first) → vocab id, with the surface + pos the stem came from (homograph check) */
  prefixes: { s: string; id: string; surface: string; pos: string }[];
  /** counter surfaces (numeral prefix required) → vocab id */
  counters: { s: string; id: string }[];
  /** grammar clozeHints (longest first) → grammar id */
  hints: { h: string; id: string }[];
  /** plusOne vocab ids included in the pool */
  plusOne: Set<string>;
}

export interface TokenMatch {
  /** vocab/grammar id the token resolved to, or null (function token, name, numeral, punctuation, unknown). */
  id: string | null;
  known: boolean;
  punct: boolean;
}

function bareSurface(s: string): string {
  return s.replace(/^〜/, '').replace(/〜$/, '');
}

/** Godan final kana → the i / a / e / o-row kana of the same consonant. */
const GODAN_ROWS: Readonly<Record<string, readonly [string, string, string, string]>> = {
  う: ['い', 'わ', 'え', 'お'], く: ['き', 'か', 'け', 'こ'], ぐ: ['ぎ', 'が', 'げ', 'ご'], す: ['し', 'さ', 'せ', 'そ'], つ: ['ち', 'た', 'て', 'と'],
  ぬ: ['に', 'な', 'ね', 'の'], ぶ: ['び', 'ば', 'べ', 'ぼ'], む: ['み', 'ま', 'め', 'も'], る: ['り', 'ら', 'れ', 'ろ'],
};
const POLITE = ['ます', 'ません', 'ました', 'ませんでした', 'ましょう'] as const;
const NEGATIVE = ['ない', 'なかった'] as const;
const TE_TA = ['て', 'た', 'てる', 'てた'] as const;
const DE_DA = ['で', 'だ', 'でる', 'でた'] as const;
const TAI = ['たい', 'たかった', 'たくない'] as const;
/** Negative, polite-negative and でしょう forms of the copula, linked to an `aux` です / だ item. */
const COPULA_FORMS = ['ではない', 'じゃない', 'ではなかった', 'じゃなかった', 'ではありません', 'じゃありません', 'ではありませんでした', 'じゃありませんでした', 'でしょう'] as const;

/**
 * Whole-token inflections of one surface for the linker's `forms` map (see the
 * module header). Ichidan verbs get no 〜たい (いたい / みたい / きたい are other
 * words), godan verbs do; ある has no 〜ない row (its negative is the function
 * token ない); a kanji 来る compound relies on the 来 stem prefix instead.
 */
export function inflectedForms(surface: string, pos: string): string[] {
  const out: string[] = [];
  const add = (base: string, suffixes: readonly string[]): void => {
    for (const s of suffixes) out.push(base + s);
  };
  if (pos === 'aux') {
    if (surface === 'です' || surface === 'だ') out.push(...COPULA_FORMS);
  } else if (pos === 'v-irr') {
    if (surface.endsWith('する')) {
      const b = surface.slice(0, -2);
      if (b) out.push(`${b}し`);
      add(`${b}し`, [...POLITE, ...NEGATIVE, ...TE_TA, 'よう']);
      out.push(`${b}すれば`);
    } else if (surface.endsWith('くる')) {
      const b = surface.slice(0, -2);
      add(`${b}き`, [...POLITE, ...TE_TA]);
      add(`${b}こ`, [...NEGATIVE, 'よう']);
      out.push(`${b}くれば`);
    }
  } else if (pos === 'v1') {
    if (!surface.endsWith('る')) return out;
    add(surface.slice(0, -1), [...POLITE, ...NEGATIVE, ...TE_TA, 'よう', 'れば', 'られる']);
  } else if (pos === 'v5') {
    const last = surface.slice(-1);
    const rows = GODAN_ROWS[last];
    if (!rows) return out;
    const b = surface.slice(0, -1);
    const [i, a, e, o] = rows;
    add(b + i, [...POLITE, ...TAI]);
    if (!surface.endsWith('ある')) add(b + a, NEGATIVE);
    const voiced = last === 'ぐ' || last === 'ぬ' || last === 'ぶ' || last === 'む';
    const onbin = last === 'す' ? 'し' : last === 'く' && !/(?:行|い|ゆ)く$/.test(surface) ? 'い' : last === 'ぐ' ? 'い' : voiced ? 'ん' : 'っ';
    add(b + onbin, voiced ? DE_DA : TE_TA);
    out.push(`${b}${e}ば`, `${b}${o}う`);
  }
  return out;
}

export function buildMatchPool(vocab: Iterable<VocabItem>, grammar: Iterable<GrammarItem>, plusOne: Iterable<VocabItem> = [], opts: { kanaStage?: boolean } = {}): MatchPool {
  const pool: MatchPool = { exact: new Map(), forms: new Map(), readings: new Set(), kanaStage: opts.kanaStage === true, prefixes: [], counters: [], hints: [], plusOne: new Set() };
  const add = (v: VocabItem) => {
    const word = typeof v.word === 'string' ? v.word : '';
    const kana = typeof v.kana === 'string' ? v.kana : '';
    const alts = Array.isArray(v.altForms) ? v.altForms.filter((a): a is string => typeof a === 'string') : [];
    if (v.pos === 'counter') {
      for (const s of [word, kana, ...alts]) if (s) pool.counters.push({ s: bareSurface(s), id: v.id });
      return;
    }
    const surfaces = [word, kana, ...alts].map(bareSurface).filter(Boolean);
    const bareKana = bareSurface(kana);
    const reading = hasKanji(word) && bareKana && bareKana !== bareSurface(word) && !alts.map(bareSurface).includes(bareKana) ? bareKana : null;
    // A bound morpheme (総〜, 高〜, 〜性) never stands alone, so its reading cannot be a token on its own: そう is not 総〜.
    const affix = word.includes('〜');
    // An auxiliary lexeme is written in kana by design (ていく, ておく, てみる, てくる), so its reading is a real surface, not a mere reading.
    const auxReading = AUX_VERBS.has(bareKana);
    for (const s of surfaces) {
      if (affix && s === reading) continue;
      if (pool.exact.has(s)) {
        // A kana-written word beats the mere reading of a kanji word registered before it (いや over 嫌, なる over 鳴る) —
        // outside the kana stage, where every word is kana and the first allowlisted item keeps the surface (さん counts 三 before 〜さん).
        if (s !== reading && pool.readings.has(s) && !pool.kanaStage) {
          pool.exact.set(s, v.id);
          pool.readings.delete(s);
        }
        continue;
      }
      pool.exact.set(s, v.id);
      if (s === reading && !auxReading) pool.readings.add(s);
    }
    const aux = auxReading;
    for (const s of surfaces) {
      // Kanji verbs are written in kanji: their kana reading inflects only for the auxiliaries (きた, いって, おいた).
      if (s === reading && !aux) continue;
      // A kanji surface with a 2+-character stem is unambiguous for the prefix rule; forms matter for 1-kanji stems (出す / 出る) and する compounds.
      if (s !== reading && hasKanji(s) && s.length > 2 && v.pos !== 'v-irr') continue;
      for (const f of inflectedForms(s, String(v.pos))) {
        const cur = pool.forms.get(f);
        if (cur && (!aux || cur.aux)) continue;
        pool.forms.set(f, { id: v.id, stem: s.length - 1, aux });
      }
    }
    const pos = String(v.pos);
    if (v.pos === 'v1' || v.pos === 'v5' || v.pos === 'adj-i') {
      for (const s of surfaces) {
        const stem = s.slice(0, -1);
        if (stem.length > 0 && (hasKanji(stem) || stem.length >= 2)) pool.prefixes.push({ s: stem, id: v.id, surface: s, pos });
      }
    } else if (v.pos === 'adj-na' || v.pos === 'n-suru') {
      for (const s of surfaces) if (s.length >= 2 || hasKanji(s)) pool.prefixes.push({ s, id: v.id, surface: s, pos });
    } else if (v.pos === 'v-irr' && word.endsWith('来る')) {
      pool.prefixes.push({ s: word.slice(0, -1), id: v.id, surface: word, pos });
    }
  };
  for (const v of vocab) add(v);
  for (const v of plusOne) {
    pool.plusOne.add(v.id);
    add(v);
  }
  pool.prefixes.sort((a, b) => b.s.length - a.s.length);
  for (const g of grammar) {
    if (!Array.isArray(g.clozeHints)) continue;
    for (const h of g.clozeHints) if (typeof h === 'string' && h.length >= 2) pool.hints.push({ h, id: g.id });
  }
  pool.hints.sort((a, b) => b.h.length - a.h.length);
  return pool;
}

const OKURIGANA_START_RE = /^[ぁ-ゟ]/;

/**
 * Whether an inflection-stem prefix may claim `token`. A stem of two or more
 * characters always may: that is how compound forms link to their head word
 * (食べ始めた → 食べる, 建て直した → 建てる, 考え方 → 考える). A single-kanji stem
 * (有 ← 有る, 巻 ← 巻く, 甘 ← 甘い, 見 ← 見る) only may when what follows is
 * okurigana — or nothing, the bare ren'yōkei (見に行く) — because a kanji after
 * it starts a different word: 有名, 巻物, 甘酒, 包丁 are not forms of ある, 巻く,
 * 甘い, 包む.
 */
export function stemApplies(stem: string, token: string): boolean {
  if (stem.length > 1) return true;
  const rest = token.slice(stem.length);
  return rest.length === 0 || OKURIGANA_START_RE.test(rest);
}

/** The longest inflection stem that claims `token`, if any. */
function prefixMatch(pool: MatchPool, token: string): MatchPool['prefixes'][number] | undefined {
  for (const p of pool.prefixes) if (token.startsWith(p.s) && stemApplies(p.s, token)) return p;
  return undefined;
}

/**
 * The item behind a generated form. A longer stem of another verb that ALSO
 * inflects to this token is a homograph (降りました: 降りる / 降る; 開けば is not
 * one, 開ける has no such form), and the longest stem wins as it does for every
 * prefix match — unless the form is a kana auxiliary (いきます → 行く even beside
 * the いき stem of 生きる; おりました → おる beside 降りる).
 */
function resolveForm(pool: MatchPool, token: string, form: FormEntry): string {
  if (form.aux && !hasKanji(token)) return form.id;
  const p = prefixMatch(pool, token);
  if (!p || p.id === form.id || p.s.length <= form.stem) return form.id;
  return inflectedForms(p.surface, p.pos).includes(token) ? p.id : form.id;
}

export function matchToken(pool: MatchPool, token: string, names: ReadonlySet<string> = new Set()): TokenMatch {
  if (PUNCT_TOKEN_RE.test(token)) return { id: null, known: true, punct: true };
  const exact = pool.exact.get(token);
  const readingOnly = exact !== undefined && pool.readings.has(token);
  if (exact !== undefined && !readingOnly) return { id: exact, known: true, punct: false };
  const form = pool.forms.get(token);
  if (form !== undefined) return { id: resolveForm(pool, token, form), known: true, punct: false };
  // The kana stage writes every word in kana, so a reading is the word (いち、に、さん); elsewhere it is the last resort (below).
  if (readingOnly && pool.kanaStage) return { id: exact as string, known: true, punct: false };
  if (FUNCTION_TOKENS.has(token)) return { id: null, known: true, punct: false };
  if (names.has(token) || CAST_NAMES.has(token)) return { id: null, known: true, punct: false };
  if (KANJI_NUMERAL_RE.test(token)) return { id: null, known: true, punct: false };
  // The kana reading of a kanji word, once no function token, name or numeral claims the token (わたし → 私, not the わた stem of 渡す; たぶん → 多分).
  if (readingOnly) return { id: exact as string, known: true, punct: false };
  const p = prefixMatch(pool, token);
  if (p) return { id: p.id, known: true, punct: false };
  for (const c of pool.counters) {
    if (token.endsWith(c.s) && token.length > c.s.length && KANJI_NUMERAL_RE.test(token.slice(0, -c.s.length))) return { id: c.id, known: true, punct: false };
  }
  for (const h of pool.hints) if (token === h.h || token.includes(h.h) || (token.length >= 2 && h.h.includes(token))) return { id: h.id, known: true, punct: false };
  for (const nm of [...names, ...CAST_NAMES]) if (token.startsWith(nm) && FUNCTION_TOKENS.has(token.slice(nm.length))) return { id: null, known: true, punct: false };
  return { id: null, known: false, punct: false };
}

/** Allowlist station for a text: Stations 1–3 share the White set. */
export function allowlistStationFor(station: number): number {
  return station <= 3 ? 3 : station;
}

export function cumulativeIds(bundles: readonly StationBundle[], upTo: number, key: 'kanaIds' | 'vocabIds' | 'grammarIds'): Set<string> {
  const out = new Set<string>();
  for (const b of bundles) if (b.number <= upTo) for (const id of b[key] ?? []) out.add(id);
  return out;
}
