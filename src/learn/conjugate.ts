/**
 * TSUZUKU — conjugation engine (design 04 §4 form-forge / form-chain; CONTENT_GUIDE §15).
 *
 * POS × ConjForm → `{answer, answerKana, alt}`; works on kanji or kana
 * surfaces. Godan endings are read from the final kana; ichidan from the
 * stem; irregulars する / 来る (and their compounds), 行く (te/ta), ある
 * (defective: ない / なかった), 要る (defective), honorific godan
 * (くださる → ください・くださいます), いい/よい (stem よ), ない. ら抜き
 * potentials and short causatives come back as `alt`. Pure, table-driven.
 */
import { CONJ_FORMS, type ConjForm, type ConjugablePos, type Pos } from '../content/types';

export interface Conjugation {
  /** Plain surface (kanji as in the head word). */
  answer: string;
  /** Kana-only surface. */
  answerKana: string;
  /** Other accepted surfaces (plain and kana), never equal to `answer`. */
  alt: string[];
}

/** The 20 verb forms, canonical order. */
export const VERB_FORMS: readonly ConjForm[] = CONJ_FORMS.slice(0, 20);
/** The 6 adjective forms, canonical order. */
export const ADJ_FORMS: readonly ConjForm[] = CONJ_FORMS.slice(20);

const VERB_FORM_SET: ReadonlySet<string> = new Set(VERB_FORMS);
const ADJ_FORM_SET: ReadonlySet<string> = new Set(ADJ_FORMS);
const CONJUGABLE: ReadonlySet<string> = new Set<ConjugablePos>(['v1', 'v5', 'v-irr', 'adj-i', 'adj-na']);

/** Forms that do not exist for a defective head word (bare kana key). */
export const DEFECTIVE: Readonly<Record<string, readonly ConjForm[]>> = {
  ある: ['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai', 'te-iru'],
  いる_v5: ['volitional', 'imperative', 'prohibitive', 'tai', 'passive', 'causative', 'causative-passive', 'te-iru'],
};

export function isConjugable(pos: Pos): pos is ConjugablePos {
  return CONJUGABLE.has(pos);
}

export function isVerbPos(pos: ConjugablePos): boolean {
  return pos === 'v1' || pos === 'v5' || pos === 'v-irr';
}

/** Verbs: 20 forms; adjectives: 6 forms. */
export function applicableForms(pos: ConjugablePos): ConjForm[] {
  return (isVerbPos(pos) ? VERB_FORMS : ADJ_FORMS).slice();
}

/** `applicableForms` minus the forms a defective head word (ある, 要る) lacks. */
export function applicableFormsFor(word: string, kana: string, pos: ConjugablePos): ConjForm[] {
  const forms = applicableForms(pos);
  const defective = pos === 'v5' ? DEFECTIVE[kana === 'いる' ? 'いる_v5' : kana] : undefined;
  if (!defective) return forms;
  return forms.filter((f) => !defective.includes(f));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tables                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

interface GodanRow {
  a: string;
  i: string;
  e: string;
  o: string;
  te: string;
  ta: string;
}

const GODAN: Readonly<Record<string, GodanRow>> = {
  う: { a: 'わ', i: 'い', e: 'え', o: 'お', te: 'って', ta: 'った' },
  く: { a: 'か', i: 'き', e: 'け', o: 'こ', te: 'いて', ta: 'いた' },
  ぐ: { a: 'が', i: 'ぎ', e: 'げ', o: 'ご', te: 'いで', ta: 'いだ' },
  す: { a: 'さ', i: 'し', e: 'せ', o: 'そ', te: 'して', ta: 'した' },
  つ: { a: 'た', i: 'ち', e: 'て', o: 'と', te: 'って', ta: 'った' },
  ぬ: { a: 'な', i: 'に', e: 'ね', o: 'の', te: 'んで', ta: 'んだ' },
  ぶ: { a: 'ば', i: 'び', e: 'べ', o: 'ぼ', te: 'んで', ta: 'んだ' },
  む: { a: 'ま', i: 'み', e: 'め', o: 'も', te: 'んで', ta: 'んだ' },
  る: { a: 'ら', i: 'り', e: 'れ', o: 'ろ', te: 'って', ta: 'った' },
};

/** Honorific godan verbs whose masu stem and imperative end in い (くださいます・ください). */
const HONORIFIC = ['くださる', 'いらっしゃる', 'おっしゃる', 'なさる', 'ござる'];

/** Kana-only paradigms of the two irregular verbs (prefix added by the caller). */
const SURU: Readonly<Record<string, [string, ...string[]]>> = {
  masu: ['します'],
  masen: ['しません'],
  mashita: ['しました'],
  'masen-deshita': ['しませんでした'],
  masho: ['しましょう'],
  te: ['して'],
  nai: ['しない'],
  ta: ['した'],
  nakatta: ['しなかった'],
  potential: ['できる'],
  volitional: ['しよう'],
  passive: ['される'],
  causative: ['させる', 'さす'],
  'causative-passive': ['させられる'],
  imperative: ['しろ', 'せよ'],
  prohibitive: ['するな'],
  ba: ['すれば'],
  tara: ['したら'],
  tai: ['したい'],
  'te-iru': ['している'],
};

const KURU: Readonly<Record<string, [string, ...string[]]>> = {
  masu: ['きます'],
  masen: ['きません'],
  mashita: ['きました'],
  'masen-deshita': ['きませんでした'],
  masho: ['きましょう'],
  te: ['きて'],
  nai: ['こない'],
  ta: ['きた'],
  nakatta: ['こなかった'],
  potential: ['こられる', 'これる'],
  volitional: ['こよう'],
  passive: ['こられる'],
  causative: ['こさせる', 'こさす'],
  'causative-passive': ['こさせられる'],
  imperative: ['こい'],
  prohibitive: ['くるな'],
  ba: ['くれば'],
  tara: ['きたら'],
  tai: ['きたい'],
  'te-iru': ['きている'],
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function lastChar(s: string): string {
  return Array.from(s).slice(-1)[0] ?? '';
}
function dropLast(s: string, n = 1): string {
  const cps = Array.from(s);
  return cps.slice(0, Math.max(0, cps.length - n)).join('');
}

/** Builds the result from a word stem, a kana stem and suffixes (first = answer). */
function build(wStem: string, kStem: string, suffixes: readonly string[]): Conjugation {
  const [main, ...alts] = suffixes;
  const answer = wStem + (main ?? '');
  const answerKana = kStem + (main ?? '');
  const alt: string[] = [];
  const push = (s: string) => {
    if (s !== answer && !alt.includes(s)) alt.push(s);
  };
  for (const a of alts) {
    push(wStem + a);
    push(kStem + a);
  }
  return { answer, answerKana, alt };
}

/** Same as `build`, but each suffix carries its own word/kana spelling (irregular kanji okurigana). */
function buildPairs(pairs: readonly [word: string, kana: string][]): Conjugation {
  const [first, ...rest] = pairs;
  const answer = first ? first[0] : '';
  const answerKana = first ? first[1] : '';
  const alt: string[] = [];
  const push = (s: string) => {
    if (s !== answer && !alt.includes(s)) alt.push(s);
  };
  for (const [w, k] of rest) {
    push(w);
    push(k);
  }
  return { answer, answerKana, alt };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Verbs                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function godan(word: string, kana: string, form: ConjForm): Conjugation | null {
  const last = lastChar(kana);
  const row = GODAN[last];
  if (!row) return null;
  // The word must end in the same kana; otherwise fall back to the kana surface.
  const w = lastChar(word) === last ? word : kana;
  const wStem = dropLast(w);
  const kStem = dropLast(kana);
  const isIku = (kana.endsWith('いく') || kana.endsWith('ゆく')) && last === 'く';
  const honorific = HONORIFIC.some((h) => kana.endsWith(h));
  const iStem = honorific ? 'い' : row.i;
  const te = isIku ? 'って' : row.te;
  const ta = isIku ? 'った' : row.ta;

  switch (form) {
    case 'masu':
      return build(wStem, kStem, [iStem + 'ます']);
    case 'masen':
      return build(wStem, kStem, [iStem + 'ません']);
    case 'mashita':
      return build(wStem, kStem, [iStem + 'ました']);
    case 'masen-deshita':
      return build(wStem, kStem, [iStem + 'ませんでした']);
    case 'masho':
      return build(wStem, kStem, [iStem + 'ましょう']);
    case 'te':
      return build(wStem, kStem, [te]);
    case 'nai':
      return build(wStem, kStem, [row.a + 'ない']);
    case 'ta':
      return build(wStem, kStem, [ta]);
    case 'nakatta':
      return build(wStem, kStem, [row.a + 'なかった']);
    case 'potential':
      return build(wStem, kStem, [row.e + 'る']);
    case 'volitional':
      return build(wStem, kStem, [row.o + 'う']);
    case 'passive':
      return build(wStem, kStem, [row.a + 'れる']);
    case 'causative':
      return build(wStem, kStem, [row.a + 'せる', row.a + 'す']);
    case 'causative-passive':
      return build(wStem, kStem, last === 'す' ? [row.a + 'せられる'] : [row.a + 'せられる', row.a + 'される']);
    case 'imperative':
      return build(wStem, kStem, [honorific ? 'い' : row.e]);
    case 'prohibitive':
      return build(w, kana, ['な']);
    case 'ba':
      return build(wStem, kStem, [row.e + 'ば']);
    case 'tara':
      return build(wStem, kStem, [ta + 'ら']);
    case 'tai':
      return build(wStem, kStem, [row.i + 'たい']);
    case 'te-iru':
      return build(wStem, kStem, [te + 'いる']);
    default:
      return null;
  }
}

function ichidan(word: string, kana: string, form: ConjForm): Conjugation | null {
  if (lastChar(kana) !== 'る') return null;
  const w = lastChar(word) === 'る' ? word : kana;
  const wStem = dropLast(w);
  const kStem = dropLast(kana);
  switch (form) {
    case 'masu':
      return build(wStem, kStem, ['ます']);
    case 'masen':
      return build(wStem, kStem, ['ません']);
    case 'mashita':
      return build(wStem, kStem, ['ました']);
    case 'masen-deshita':
      return build(wStem, kStem, ['ませんでした']);
    case 'masho':
      return build(wStem, kStem, ['ましょう']);
    case 'te':
      return build(wStem, kStem, ['て']);
    case 'nai':
      return build(wStem, kStem, ['ない']);
    case 'ta':
      return build(wStem, kStem, ['た']);
    case 'nakatta':
      return build(wStem, kStem, ['なかった']);
    case 'potential':
      return build(wStem, kStem, ['られる', 'れる']);
    case 'volitional':
      return build(wStem, kStem, ['よう']);
    case 'passive':
      return build(wStem, kStem, ['られる']);
    case 'causative':
      return build(wStem, kStem, ['させる', 'さす']);
    case 'causative-passive':
      return build(wStem, kStem, ['させられる']);
    case 'imperative':
      return build(wStem, kStem, ['ろ', 'よ']);
    case 'prohibitive':
      return build(w, kana, ['な']);
    case 'ba':
      return build(wStem, kStem, ['れば']);
    case 'tara':
      return build(wStem, kStem, ['たら']);
    case 'tai':
      return build(wStem, kStem, ['たい']);
    case 'te-iru':
      return build(wStem, kStem, ['ている']);
    default:
      return null;
  }
}

/** する and its compounds (勉強する). */
function suru(word: string, kana: string, form: ConjForm): Conjugation | null {
  const forms = SURU[form];
  if (!forms) return null;
  const kPrefix = dropLast(kana, 2);
  const wPrefix = word.endsWith('する') ? dropLast(word, 2) : word.endsWith('為る') ? dropLast(word, 2) : kPrefix;
  return build(wPrefix, kPrefix, forms);
}

/** 来る / くる and compounds (持ってくる). Kanji spelling keeps 来 + okurigana. */
function kuru(word: string, kana: string, form: ConjForm): Conjugation | null {
  const forms = KURU[form];
  if (!forms) return null;
  const kPrefix = dropLast(kana, 2);
  const kanjiSpelling = word.endsWith('来る');
  const wPrefix = kanjiSpelling ? dropLast(word, 2) : word.endsWith('くる') ? dropLast(word, 2) : kPrefix;
  const pairs = forms.map((f): [string, string] => {
    const k = kPrefix + f;
    const w = kanjiSpelling ? wPrefix + '来' + f.slice(1) : wPrefix + f;
    return [w, k];
  });
  return buildPairs(pairs);
}

function irregular(word: string, kana: string, form: ConjForm): Conjugation | null {
  if (kana.endsWith('する')) return suru(word, kana, form);
  if (kana.endsWith('くる')) return kuru(word, kana, form);
  // v-irr mislabel: fall back on the shape of the word.
  return lastChar(kana) === 'る' ? ichidan(word, kana, form) : godan(word, kana, form);
}

function verb(word: string, kana: string, pos: ConjugablePos, form: ConjForm): Conjugation | null {
  if (!VERB_FORM_SET.has(form)) return null;
  if (pos === 'v-irr') return irregular(word, kana, form);
  if (pos === 'v5') {
    if (kana === 'ある' || kana === 'いる') {
      const defective = DEFECTIVE[kana === 'いる' ? 'いる_v5' : 'ある'] ?? [];
      if (defective.includes(form)) return null;
      if (kana === 'ある') {
        if (form === 'nai') return { answer: 'ない', answerKana: 'ない', alt: [] };
        if (form === 'nakatta') return { answer: 'なかった', answerKana: 'なかった', alt: [] };
      }
    }
    return godan(word, kana, form);
  }
  return ichidan(word, kana, form);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Adjectives                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** いい-compounds take the よ stem (かっこいい → かっこよく); かわいい (可愛い) does not. */
const II_COMPOUNDS = ['いい', 'かっこいい', 'かっこういい', 'きもちいい', 'ここちいい', 'なかがいい', 'あたまがいい'];

function isIiCompound(word: string, kana: string): boolean {
  if (!kana.endsWith('いい')) return false;
  if (II_COMPOUNDS.includes(kana) || kana.endsWith('がいい') || kana.endsWith('ていい')) return true;
  return word.endsWith('良い') || word.endsWith('好い');
}

function adjI(word: string, kana: string, form: ConjForm): Conjugation | null {
  if (lastChar(kana) !== 'い') return null;
  let kStem: string;
  let wStem: string;
  if (isIiCompound(word, kana)) {
    kStem = dropLast(kana, 2) + 'よ';
    wStem = word.endsWith('いい') ? dropLast(word, 2) + 'よ' : lastChar(word) === 'い' ? dropLast(word) : kStem;
  } else {
    kStem = dropLast(kana);
    wStem = lastChar(word) === 'い' ? dropLast(word) : kStem;
  }
  const isNai = kana === 'ない';
  switch (form) {
    case 'adj-neg':
      return build(wStem, kStem, isNai ? ['くない', 'くはない'] : ['くない']);
    case 'adj-past':
      return build(wStem, kStem, ['かった']);
    case 'adj-past-neg':
      return build(wStem, kStem, ['くなかった']);
    case 'adj-te':
      return build(wStem, kStem, ['くて']);
    case 'adj-adv':
      return build(wStem, kStem, ['く']);
    case 'adj-ba':
      return build(wStem, kStem, ['ければ']);
    default:
      return null;
  }
}

function adjNa(word: string, kana: string, form: ConjForm): Conjugation | null {
  const w = word.endsWith('な') && !kana.endsWith('な') ? dropLast(word) : word;
  switch (form) {
    case 'adj-neg':
      return build(w, kana, ['じゃない', 'ではない']);
    case 'adj-past':
      return build(w, kana, ['だった']);
    case 'adj-past-neg':
      return build(w, kana, ['じゃなかった', 'ではなかった']);
    case 'adj-te':
      return build(w, kana, ['で']);
    case 'adj-adv':
      return build(w, kana, ['に']);
    case 'adj-ba':
      return build(w, kana, ['なら', 'であれば']);
    default:
      return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Entry points                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Conjugates `word` (plain) / `kana` for `form`. Returns `null` for a form
 * that does not apply to the POS, an unknown form, or a defective form
 * (ある → potential …).
 */
export function conjugate(word: string, kana: string, pos: ConjugablePos, form: ConjForm): Conjugation | null {
  if (!word || !kana) return null;
  if (isVerbPos(pos)) return verb(word, kana, pos, form);
  if (!ADJ_FORM_SET.has(form)) return null;
  return pos === 'adj-i' ? adjI(word, kana, form) : adjNa(word, kana, form);
}

/** Every applicable form of a head word (form-chain builder). */
export function conjugateAll(word: string, kana: string, pos: ConjugablePos): Partial<Record<ConjForm, Conjugation>> {
  const out: Partial<Record<ConjForm, Conjugation>> = {};
  for (const f of applicableFormsFor(word, kana, pos)) {
    const c = conjugate(word, kana, pos, f);
    if (c) out[f] = c;
  }
  return out;
}

/** Every surface a grader should accept for a conjugation. */
export function acceptedSurfaces(c: Conjugation): string[] {
  const out = [c.answer];
  for (const s of [c.answerKana, ...c.alt]) if (!out.includes(s)) out.push(s);
  return out;
}
