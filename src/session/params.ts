/**
 * TSUZUKU — step params (design 04 interaction specs; ARCHITECTURE §5 StepParams).
 *
 * `resolveParams(ctx, drill, item)` turns a content item into the fully
 * resolved `StepParams` a drill renders: choices, tiles, conjugations,
 * sentences with their blanks, story ids, rates. Deterministic: every draw goes
 * through `ctx.rng`. The item type guards, the particle tables and the
 * bunsetsu splitter live here too. Split out of `builder.ts` (which re-exports
 * everything here) so each file stays readable.
 *
 * Contract: `StepParams.sentence` carries ruby markup for every sentence drill
 * that renders through `<Ruby>` (pattern-cloze, particle-duel, kanji-read,
 * lookalike-duel, transform, judgment-call, scramble, sentence-listen, shadow);
 * `blank` / `blanks` are offsets into `toPlain(sentence)`; `answer` / `accept`
 * are plain surfaces. Production Forge keeps a plain sentence.
 */
import {
  DRILL_IDS,
  coverageTargetFor,
  type Belt,
  type ComponentDef,
  type ConjForm,
  type ContentItem,
  type DrillId,
  type GrammarItem,
  type KanaItem,
  type KanjiItem,
  type SentenceExample,
  type StoryItem,
  type StoryLine,
  type VocabItem,
} from '../content/types';
import { isChunk } from '../content/loader';
import { hasKanji, toPlain } from '../content/ruby';
import { SPEED_TIER_RATES } from '../shared/audio';
import { MISSIONS } from '../shared/catalog';
import { hashSeed, sample, shuffle } from '../shared/hash';
import { cardKey as makeKey, tryKindOfId } from '../shared/ids';
import { moraCount } from '../shared/jp';
import type { StepParams } from '../shared/session-types';
import type { ItemKind } from '../shared/store-types';
import { store } from '../store';
import { clozeTiles, conjugate, gojuonPool, isConjugable, kanaGrid, kanjiLookalikes, meaningChoices, perceptionJudge, prodPrompt, rapidFirePool, scrambleTiles, type QueueCard } from '../learn';
import { S, fill } from './engine-strings';
import type { PlanContext } from './builder';

/* ────────────────────────────────────────────────────────────────────────── */
/* Item guards and tables                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function isVocab(i: ContentItem | null | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i;
}
function isKanji(i: ContentItem | null | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i;
}
function isGrammar(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}
function isKana(i: ContentItem | null | undefined): i is KanaItem {
  return !!i && 'romaji' in i && 'script' in i;
}
function isStory(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && 'stationId' in i;
}
function isComponent(i: ContentItem | null | undefined): i is ComponentDef {
  return !!i && 'char' in i && 'name' in i && !('strokes' in i);
}
export { isVocab, isKanji, isGrammar, isKana, isStory, isComponent };

/** Item kind from an id and (when loaded) its content: set-phrase / aizuchi vocab is `chunk`. */
export function itemKindOf(itemId: string, item?: ContentItem): ItemKind | null {
  const k = tryKindOfId(itemId);
  if (k === 'vocab') return item && isChunk(item) ? 'chunk' : 'vocab';
  if (k === 'kana' || k === 'kanji' || k === 'grammar' || k === 'component') return k;
  return null;
}

/** Particle Duel keys (design 04 §4; `learn/distractors.PARTICLES` is not in the barrel). */
export const PARTICLES: readonly string[] = ['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の'];
/** Particle Duel is scheduled from this station (design 04 §4 introduction table). */
export const PARTICLE_DUEL_FROM = 5;

/** The particle cloze hints of a grammar point (what Particle Duel blanks); empty for a non-particle point. */
export function particleHints(item: GrammarItem): string[] {
  return item.clozeHints.filter((h) => PARTICLES.includes(h));
}
export function hasParticleHint(item: ContentItem | null | undefined): boolean {
  return isGrammar(item) && particleHints(item).length > 0;
}

/**
 * Character runs a particle may not split: copula / auxiliary continuations
 * (です・でした・でしょう・ので・のに・こと・もの・とても・という…). `splitBunsetsu`
 * treats a match here as word-internal, so 「元気です」 never yields a lone 「す」.
 */
export const PARTICLE_ATOMS: readonly string[] = ['です', 'でした', 'でしょう', 'でき', 'ではな', 'ではあ', 'ので', 'のに', 'のだ', 'のです', 'こと', 'もの', 'とても', 'という', 'として', 'とう', 'とか', 'について', 'ところ'];
/** Compound particles that stay on one tile with their word (私には・それでは). */
const COMPOUND_PARTICLES: readonly string[] = ['では', 'には', 'とは', 'へは'];

const ROMAJI_46 = ['a', 'i', 'u', 'e', 'o', 'ka', 'ki', 'ku', 'ke', 'ko', 'sa', 'shi', 'su', 'se', 'so', 'ta', 'chi', 'tsu', 'te', 'to', 'na', 'ni', 'nu', 'ne', 'no', 'ha', 'hi', 'fu', 'he', 'ho', 'ma', 'mi', 'mu', 'me', 'mo', 'ya', 'yu', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'wa', 'wo', 'n'];

const DRILL_SET: ReadonlySet<string> = new Set(DRILL_IDS);
export function isDrillId(x: string): x is DrillId {
  return DRILL_SET.has(x);
}

/** Speed-read cpm targets by level (design 04 §7). */
export const SPEED_READ_CPM: Record<Belt, number> = { white: 80, yellow: 80, orange: 80, green: 150, blue: 250, purple: 250, brown: 350, black: 450 };

/* ────────────────────────────────────────────────────────────────────────── */
/* Params                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const FORM_LABEL: Record<ConjForm, string> = {
  masu: 'polite (ます)',
  masen: 'polite negative (ません)',
  mashita: 'polite past (ました)',
  'masen-deshita': 'polite past negative (ませんでした)',
  masho: 'polite volitional (ましょう)',
  te: 'te-form',
  nai: 'plain negative (ない)',
  ta: 'plain past (た)',
  nakatta: 'plain past negative (なかった)',
  potential: 'potential',
  volitional: 'volitional',
  passive: 'passive',
  causative: 'causative',
  'causative-passive': 'causative-passive',
  imperative: 'imperative',
  prohibitive: 'prohibitive (な)',
  ba: 'conditional (ば)',
  tara: 'conditional (たら)',
  tai: 'want to (たい)',
  'te-iru': 'progressive (ている)',
  'adj-neg': 'negative',
  'adj-past': 'past',
  'adj-past-neg': 'past negative',
  'adj-te': 'te-form',
  'adj-adv': 'adverbial',
  'adj-ba': 'conditional (ば)',
};

export function dedupe(xs: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const x of xs) if (x && !out.includes(x)) out.push(x);
  return out;
}

function exampleAt(examples: readonly SentenceExample[], rep: number): SentenceExample | undefined {
  if (examples.length === 0) return undefined;
  return examples[((rep % examples.length) + examples.length) % examples.length];
}

/** Pitch pattern name from the nucleus and the mora count (design 04 §2). */
export function pitchPattern(pitch: number, kana: string): string {
  const n = moraCount(kana);
  if (pitch === 0) return '平板';
  if (pitch === 1) return '頭高';
  if (pitch >= n) return '尾高';
  return '中高';
}
export const PITCH_PATTERNS = ['平板', '頭高', '中高', '尾高'] as const;

/** Rate preset for the learner's speed tier (design 04 §5). */
export function rateFor(ctx: PlanContext): number {
  return SPEED_TIER_RATES[ctx.settings.speedTier];
}

/** Story lines (station ≤ current) whose `tokenIds` name `itemId`. */
export function linesWith(ctx: PlanContext, itemId: string): { story: StoryItem; index: number }[] {
  const out: { story: StoryItem; index: number }[] = [];
  for (const story of ctx.stories) {
    story.lines.forEach((line, index) => {
      if (line.tokenIds?.includes(itemId)) out.push({ story, index });
    });
  }
  return out;
}

/** Fraction of resolved tokens the learner knows (`tokenIds` non-null entries). */
export function storyCoverage(story: StoryItem, known: ReadonlySet<string>): number {
  let total = 0;
  let hit = 0;
  for (const line of story.lines) {
    for (const id of line.tokenIds ?? []) {
      if (id === null) continue;
      total++;
      if (known.has(id)) hit++;
    }
  }
  return total === 0 ? 1 : hit / total;
}

/** Stories of the loaded bundles that meet the live coverage target, best coverage first. */
export function pickStories(ctx: PlanContext, o: { kind?: StoryItem['kind']; station?: number } = {}): StoryItem[] {
  const st = o.station ?? ctx.station;
  return ctx.stories
    .filter((s) => (o.kind ? s.kind === o.kind : true))
    .map((s) => ({ s, c: storyCoverage(s, ctx.known) }))
    .filter(({ s, c }) => c >= coverageTargetFor(st, s.bridge === true))
    .sort((a, b) => b.c - a.c || (a.s.id < b.s.id ? -1 : 1))
    .map(({ s }) => s);
}

/** Sentences whose resolved tokens are all known (shadow warm-up), as story lines or vocab examples. */
export function knownSentences(ctx: PlanContext, n: number): { sentence: string; kana: string; en: string; storyId?: string; lineIndex?: number }[] {
  const out: { sentence: string; kana: string; en: string; storyId?: string; lineIndex?: number }[] = [];
  for (const story of ctx.stories) {
    story.lines.forEach((line, lineIndex) => {
      const ids = (line.tokenIds ?? []).filter((x): x is string => x !== null);
      if (ids.length === 0 || !ids.every((id) => ctx.known.has(id))) return;
      out.push({ sentence: line.ja, kana: line.kana, en: line.en, storyId: story.id, lineIndex });
    });
  }
  if (out.length < n) {
    for (const v of ctx.vocabPool) {
      if (!ctx.known.has(v.id)) continue;
      const ex = v.examples[0];
      if (ex) out.push({ sentence: ex.ja, kana: ex.kana, en: ex.en });
    }
  }
  return sample(ctx.rng, out, n);
}

/**
 * Bunsetsu-ish tiles for Scramble when no linked story line carries tokens:
 * a particle closes the tile it follows (particles attach to their word), a
 * punctuation mark is its own tile, and a `PARTICLE_ATOMS` run (です・ので・こと…)
 * is word-internal, never a boundary. Exported for tests.
 */
export function splitBunsetsu(plain: string): string[] {
  const particles = [...PARTICLES, ...COMPOUND_PARTICLES].sort((a, b) => b.length - a.length);
  const atoms = PARTICLE_ATOMS.slice().sort((a, b) => b.length - a.length);
  const tiles: string[] = [];
  let cur = '';
  let i = 0;
  while (i < plain.length) {
    const ch = plain[i] as string;
    if ('、。！？'.includes(ch)) {
      if (cur) tiles.push(cur);
      tiles.push(ch);
      cur = '';
      i++;
      continue;
    }
    const atom = atoms.find((x) => plain.startsWith(x, i));
    if (atom) {
      cur += atom;
      i += atom.length;
      continue;
    }
    const p = particles.find((x) => plain.startsWith(x, i) && cur.length > 0);
    if (p) {
      tiles.push(cur + p);
      cur = '';
      i += p.length;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur) tiles.push(cur);
  return tiles;
}

export interface ResolveOpts {
  qc?: QueueCard;
  /** Rotation index (prompt rotation). */
  rep?: number;
  storyId?: string;
  lineIndex?: number;
}

/**
 * Resolved `StepParams` for a drill over an item (design 04 interaction specs).
 * Deterministic: every draw goes through `ctx.rng`.
 */
export function resolveParams(ctx: PlanContext, exercise: DrillId, item: ContentItem | null, o: ResolveOpts = {}): StepParams {
  const rep = o.rep ?? 0;
  const rng = ctx.rng;
  const p: StepParams = {};
  switch (exercise) {
    case 'kana-flash': {
      if (!isKana(item)) break;
      p.answer = item.romaji;
      p.accept = dedupe([item.romaji]);
      if ((o.qc?.exposures ?? 0) < 2) {
        const others = shuffle(rng, ctx.kanaPool.filter((k) => k.id !== item.id && k.romaji !== item.romaji).map((k) => k.romaji));
        const pool = others.length >= 3 ? others : others.concat(shuffle(rng, ROMAJI_46.filter((r) => r !== item.romaji && !others.includes(r))));
        p.choices = shuffle(rng, [item.romaji, ...dedupe(pool).slice(0, 3)]);
      }
      break;
    }
    case 'kana-ear': {
      if (!isKana(item)) break;
      p.answer = item.kana;
      p.choices = kanaGrid(item, ctx.kanaPool, rng);
      break;
    }
    case 'kana-forge': {
      if (!isKana(item)) break;
      p.answer = item.kana;
      p.accept = [item.kana];
      p.promptEn = item.romaji;
      break;
    }
    case 'meaning-guard':
    case 'audio-flash': {
      if (!isVocab(item)) break;
      p.answer = item.meanings[0] ?? '';
      p.accept = dedupe(item.meanings);
      if (exercise === 'meaning-guard' || (o.qc?.exposures ?? 0) < 2) p.choices = meaningChoices(item, ctx.vocabPool, rng);
      break;
    }
    case 'meaning-recall':
    case 'meaning-judge': {
      if (!isVocab(item)) break;
      p.answer = item.meanings[0] ?? '';
      p.accept = dedupe(item.meanings);
      if (item.definitionJa) p.sentence = toPlain(item.definitionJa.ja);
      break;
    }
    case 'production-forge': {
      if (!isVocab(item)) break;
      const prompt = prodPrompt(item, ctx.stories, rep);
      p.sentence = prompt.sentence;
      p.blank = prompt.blank;
      p.promptEn = `${item.meanings[0] ?? ''} — ${prompt.en}`;
      p.answer = item.word;
      p.accept = dedupe([item.word, item.kana, ...(item.altForms ?? [])]);
      const homophones = ctx.vocabPool.filter((v) => v.id !== item.id && v.kana === item.kana && v.word !== item.word).map((v) => v.word);
      p.candidates = dedupe([item.word, ...homophones]);
      const kanjiRead7 = (item.kanjiIds ?? []).some((kid) => {
        const c = store.cards.get(makeKey(kid, 'read'));
        return !!c && c[1] >= 7;
      });
      p.kanaOnlyPolicy = ctx.station >= 16 && kanjiRead7 ? 'hard' : 'good';
      break;
    }
    case 'pitch-ear': {
      if (!isVocab(item) || item.pitch === undefined) break;
      p.answer = pitchPattern(item.pitch, item.kana);
      p.choices = [...PITCH_PATTERNS];
      break;
    }
    case 'component-flash': {
      if (!isComponent(item)) break;
      p.answer = item.name;
      p.accept = [item.name];
      if ((o.qc?.exposures ?? 0) < 2) {
        const others = shuffle(rng, Array.from(ctx.components.values()).filter((c) => c.id !== item.id).map((c) => c.name));
        p.choices = shuffle(rng, [item.name, ...dedupe(others).slice(0, 3)]);
      }
      break;
    }
    case 'component-assembly': {
      if (!isKanji(item)) break;
      const names = item.components;
      // The drill builds its tiles from the component definitions (keyword captions, reveal line); the builder's
      // part is the seeded choice of distractors, passed as component ids (`params.distractorIds`).
      const fillers = shuffle(rng, Array.from(ctx.components.values()).filter((c) => !names.includes(c.name)).map((c) => c.id));
      p.distractorIds = fillers.slice(0, Math.max(0, 8 - names.length));
      p.answer = item.char;
      p.accept = [item.char];
      p.layout = names.length <= 1 ? 'enc' : hashSeed(ctx.seed, item.id) % 2 === 0 ? 'lr' : 'tb';
      p.promptEn = `${item.meanings[0] ?? ''} · ${item.on[0] ?? item.kun[0]?.replace('.', '') ?? ''}`;
      break;
    }
    case 'kanji-read':
    case 'lookalike-duel': {
      if (!isKanji(item)) break;
      const ex = item.examples[((rep % item.examples.length) + item.examples.length) % item.examples.length] ?? item.examples[0];
      const word = ex?.word ?? item.char;
      let sentence = word;
      let en = ex?.en ?? '';
      let kana = ex?.kana ?? '';
      const vocab = ctx.vocabPool.find((v) => v.word === word);
      const line = vocab ? linesWith(ctx, vocab.id)[0] : undefined;
      const sx = line ? line.story.lines[line.index] : vocab?.examples[0];
      let ruby = sentence;
      if (sx) {
        const plain = toPlain(sx.ja);
        if (plain.includes(word)) {
          sentence = plain;
          ruby = sx.ja;
          en = sx.en;
        }
      }
      const start = sentence.indexOf(exercise === 'kanji-read' ? word : item.char);
      p.sentence = ruby;
      p.blank = start >= 0 ? [start, start + (exercise === 'kanji-read' ? word.length : item.char.length)] : [0, 0];
      p.promptEn = en;
      if (exercise === 'kanji-read') {
        p.answer = kana;
        p.accept = dedupe([kana]);
      } else {
        p.answer = item.char;
        p.choices = kanjiLookalikes(item, ctx.kanjiPool, rng);
        p.accept = [item.char];
      }
      break;
    }
    case 'pattern-cloze': {
      if (!isGrammar(item)) break;
      const ex = exampleAt(item.examples, rep);
      const sentence = ex ? toPlain(ex.ja) : item.pattern;
      const hint = item.clozeHints.find((h) => sentence.includes(h)) ?? item.clozeHints[0] ?? item.pattern;
      const start = sentence.indexOf(hint);
      p.sentence = ex ? ex.ja : item.pattern;
      p.blank = start >= 0 ? [start, start + hint.length] : [0, 0];
      p.answer = hint;
      p.accept = dedupe([hint]);
      p.promptEn = ex?.en ?? item.meaning;
      if ((o.qc?.exposures ?? 0) < 2) p.tiles = clozeTiles(item, ctx.grammarPool, rng, hint);
      break;
    }
    case 'particle-duel': {
      if (!isGrammar(item)) break;
      const ex = exampleAt(item.examples, rep);
      const sentence = ex ? toPlain(ex.ja) : item.pattern;
      // Slots are the point's own particle hints (design 04 §4 "particle points"), never every particle-looking
      // character (で inside です, と inside こと). No hint in the sentence → no blanks; the drill falls back itself.
      const blanks: [number, number][] = [];
      const answers: string[] = [];
      const hints = particleHints(item).sort((a, b) => b.length - a.length);
      for (let i = 0; i < sentence.length && blanks.length < 3; i++) {
        const prt = hints.find((x) => sentence.startsWith(x, i));
        if (prt && i > 0) {
          blanks.push([i, i + prt.length]);
          answers.push(prt);
          i += prt.length - 1;
        }
      }
      p.sentence = ex ? ex.ja : item.pattern;
      p.blanks = blanks;
      p.answers = answers;
      p.answer = answers[0] ?? '';
      p.choices = [...PARTICLES];
      p.promptEn = ex?.en ?? item.meaning;
      break;
    }
    case 'form-forge':
    case 'form-chain': {
      if (!isGrammar(item)) break;
      const verbs = ctx.vocabPool.filter((v) => isConjugable(v.pos) && v.pos !== 'adj-na' && v.pos !== 'adj-i');
      const pool = verbs.length > 0 ? verbs : ctx.vocabPool.filter((v) => isConjugable(v.pos));
      const verb = pool[((rep % Math.max(1, pool.length)) + pool.length) % Math.max(1, pool.length)];
      if (!verb || !isConjugable(verb.pos)) break;
      // Only the forms the point declares are drillable (design 04 §4); `stepForCard` routes a point without them elsewhere.
      const forms = (item.unlocksForms ?? []).filter((f) => conjugate(verb.word, verb.kana, verb.pos as never, f) !== null);
      if (forms.length === 0) break;
      p.sentence = verb.word;
      p.promptEn = verb.meanings[0] ?? '';
      if (exercise === 'form-forge') {
        const form = forms[((rep % forms.length) + forms.length) % forms.length] as ConjForm;
        const c = conjugate(verb.word, verb.kana, verb.pos as never, form);
        if (!c) break;
        p.targetForm = form;
        p.answer = c.answer;
        p.accept = dedupe([c.answer, c.answerKana, ...c.alt]);
        p.promptEn = fill(S.formForgePrompt, { word: verb.meanings[0] ?? verb.word, form: FORM_LABEL[form] });
      } else {
        const chain = forms.slice(0, 5);
        p.forms = chain;
        p.answers = chain.map((f) => conjugate(verb.word, verb.kana, verb.pos as never, f)?.answer ?? '');
        p.accept = dedupe(chain.flatMap((f) => {
          const c = conjugate(verb.word, verb.kana, verb.pos as never, f);
          return c ? [c.answer, c.answerKana, ...c.alt] : [];
        }));
      }
      break;
    }
    case 'transform': {
      if (!isGrammar(item)) break;
      const target = exampleAt(item.examples, rep);
      const source = exampleAt(item.examples, rep + 1) ?? target;
      if (!target) break;
      p.sentence = source ? source.ja : '';
      p.answer = toPlain(target.ja);
      p.accept = dedupe([toPlain(target.ja), target.kana]);
      p.promptEn = fill(S.transformPrompt, { pattern: item.pattern, en: target.en });
      break;
    }
    case 'scramble': {
      if (!isGrammar(item)) break;
      const line = linesWith(ctx, item.id)[rep % Math.max(1, linesWith(ctx, item.id).length)];
      const ex = line ? line.story.lines[line.index] : exampleAt(item.examples, rep);
      if (!ex) break;
      const plain = toPlain(ex.ja);
      const tokens = line && (ex as StoryLine).tokens.length > 1 ? (ex as StoryLine).tokens : splitBunsetsu(plain);
      p.tiles = scrambleTiles(ex, tokens, rng);
      p.answer = plain;
      p.accept = [plain, ex.kana];
      p.sentence = ex.ja;
      p.promptEn = ex.en;
      break;
    }
    case 'judgment-call': {
      if (!isGrammar(item)) break;
      const mistakes = item.mistakes.map((m) => /×\s*(.+?)\s*→\s*○\s*(.+?)\s*(?:\((.*)\))?\s*$/.exec(m)).filter((m): m is RegExpExecArray => m !== null);
      const useWrong = mistakes.length > 0 && rng() < 0.5;
      if (useWrong) {
        const m = mistakes[Math.floor(rng() * mistakes.length)] as RegExpExecArray;
        p.sentence = (m[1] ?? '').trim();
        p.answer = '×';
        p.accept = [(m[2] ?? '').trim()];
        p.promptEn = (m[3] ?? '').trim() || item.meaning;
      } else {
        const ex = exampleAt(item.examples, rep);
        p.sentence = ex ? ex.ja : item.pattern;
        p.answer = '○';
        p.accept = ['○'];
        p.promptEn = ex?.en ?? item.meaning;
      }
      p.choices = ['○', '×'];
      break;
    }
    case 'sentence-listen':
    case 'shadow': {
      const sx = o.storyId !== undefined && o.lineIndex !== undefined ? ctx.loader.get<StoryItem>(o.storyId)?.lines[o.lineIndex] : undefined;
      const ex = sx ?? (isVocab(item) || isGrammar(item) ? exampleAt(item.examples, rep) : undefined);
      if (ex) {
        // Ruby markup stays: the drill grades dictation against `toKana(sentence)` and speaks `toPlain(sentence)`.
        p.sentence = ex.ja;
        p.answer = ex.kana;
        p.accept = dedupe([toPlain(ex.ja), ex.kana]);
        p.promptEn = ex.en;
      } else if (isVocab(item)) {
        p.sentence = hasKanji(item.word) ? `{${item.word}|${item.kana}}` : item.word;
        p.answer = item.kana;
        p.accept = dedupe([item.word, item.kana]);
        p.promptEn = item.meanings[0] ?? '';
      }
      if (o.storyId !== undefined) p.storyId = o.storyId;
      if (o.lineIndex !== undefined) p.lineIndex = o.lineIndex;
      p.rate = rateFor(ctx);
      break;
    }
    case 'minimal-pair': {
      if (!isVocab(item)) break;
      const pair = perceptionJudge(item, ctx.vocabPool).minimalPair;
      p.answer = item.kana;
      p.choices = shuffle(rng, [pair[0], pair[1]]);
      p.rate = rateFor(ctx);
      break;
    }
    case 'listening-set':
    case 'story-read':
    case 'speed-read':
    case 'role-play': {
      if (o.storyId !== undefined) p.storyId = o.storyId;
      else if (isStory(item)) p.storyId = item.id;
      if (exercise === 'speed-read') p.rate = SPEED_READ_CPM[ctx.belt];
      else p.rate = rateFor(ctx);
      if (exercise === 'role-play') {
        p.mode = ctx.station < 10 ? 'choose' : ctx.station < 16 ? 'type' : ctx.settings.speaking === 'self' || ctx.settings.speaking === 'off' ? 'type' : 'speak';
        const story = p.storyId ? ctx.loader.get<StoryItem>(p.storyId) : undefined;
        if (story) p.registerTarget = story.register;
      }
      break;
    }
    case 'say-three-ways': {
      const ex = isVocab(item) || isGrammar(item) ? exampleAt(item.examples, rep) : undefined;
      if (ex) {
        p.sentence = toPlain(ex.ja);
        p.promptEn = fill(S.threeWaysPrompt, { en: ex.en });
      }
      p.mode = ctx.settings.speaking === 'self' || ctx.settings.speaking === 'off' ? 'type' : 'speak';
      break;
    }
    case 'monologue': {
      const topics = S.topics;
      const topic = topics[hashSeed(ctx.seed, ctx.today, 'monologue') % topics.length] as string;
      const long = ctx.belt === 'brown' || ctx.belt === 'black';
      p.seconds = long ? 120 : 60;
      p.promptEn = fill(long ? S.monologuePromptLong : S.monologuePrompt, { topic });
      if (ctx.station >= 37 && o.storyId) {
        p.mode = 'reduce-expand';
        p.storyId = o.storyId;
        p.promptEn = fill(S.reduceExpandPrompt, { n: 60 });
      }
      break;
    }
    case 'writing-dojo': {
      const patterns = ctx.grammarPool.filter((g) => ctx.known.has(g.id)).slice(-3);
      p.patternIds = (patterns.length > 0 ? patterns : ctx.grammarPool.slice(0, 2)).map((g) => g.id);
      const n = ctx.belt === 'green' ? 3 : ctx.belt === 'blue' || ctx.belt === 'purple' ? 6 : ctx.belt === 'brown' ? 9 : ctx.belt === 'black' ? 12 : 3;
      p.seconds = n * 60;
      const topic = S.topics[hashSeed(ctx.seed, ctx.today, 'writing') % S.topics.length] as string;
      p.promptEn = fill(S.writingPrompt, { n, topic });
      break;
    }
    case 'rapid-fire': {
      p.pool = rapidFirePool(store.cards, ctx.today).map((c) => c.cardKey);
      p.seconds = 60;
      break;
    }
    case 'gojuon-fighter': {
      p.pool = gojuonPool(store.cards, ctx.today).map((c) => c.cardKey);
      break;
    }
    case 'field-mission': {
      const m = MISSIONS.filter((x) => x.fromStation <= ctx.station).slice(-1)[0] ?? MISSIONS[0];
      if (m) p.missionId = m.id;
      break;
    }
    case 'nemesis-duel':
    case 'kanji-write':
      break;
  }
  return p;
}
