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
 * are plain surfaces. Production Forge keeps a plain sentence. Form Forge /
 * Form Chain on a grammar prod card carry the picked verb in `sentence`
 * (dictionary form), `kana` (its reading) and `pos` (its part of speech), and
 * `accepts` = the accepted surfaces per form (kanji, kana, engine alternates),
 * parallel to `forms` (chain) or `[targetForm]` (forge), so the drills never
 * infer the head word from the answers; the chain is always 5 links
 * (`formChain`: the point's own forms, then forms of points already met, then
 * any form the verb takes). Minimal Pair speaks either half of the pair
 * (`answer` = the one played).
 *
 * `pickStories` serves unread episodes first (`progress.storiesRead`), then the
 * best coverage, so the builder never re-serves the same episode while an
 * unread one meets the target. `storyCoverage` follows the V20 contract
 * (CONTENT_GUIDE §14.2): a token listed in its line's `plusOne` is the designed
 * +1 and counts as covered, and at Stations 1–3 the shared White allowlist
 * (`ctx.allowlist`) does too, so the texts the validator passed are the texts
 * the live gate serves.
 *
 * Kanji Read matches the example word by surface AND reading, and blanks the
 * first occurrence whose ruby aligns with the word and reads as the example
 * does (never inside a compound, never a contradicting reading); when no
 * sentence has one, the bare word is the prompt. Form Forge / Form Chain draw
 * the head word from the items that realise at least one declared form
 * (adjectives for adj-* points, verbs for verb points), so an adjective-only
 * point is drillable. `splitBunsetsu` cuts after も as well and before a
 * bunsetsu-initial hiragana word (どこ, よく, いつ…); `movableTiles` tells the
 * builder when a Scramble would be a no-op.
 */
import {
  DRILL_IDS,
  coverageTargetFor,
  type Belt,
  type ComponentDef,
  type ConjForm,
  type ConjugablePos,
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
import { hasKanji, parseRuby, toPlain } from '../content/ruby';
import { SPEED_TIER_RATES } from '../shared/audio';
import { MISSIONS } from '../shared/catalog';
import { hashSeed, sample, shuffle } from '../shared/hash';
import { cardKey as makeKey, tryKindOfId } from '../shared/ids';
import { equivalentJa, isHiragana, moraCount } from '../shared/jp';
import type { StepParams } from '../shared/session-types';
import type { ItemKind } from '../shared/store-types';
import { store } from '../store';
import { applicableForms, clozeTiles, conjugate, gojuonPool, isConjugable, kanaGrid, kanjiLookalikes, meaningChoices, perceptionJudge, prodPrompt, rapidFirePool, scrambleTiles, type QueueCard } from '../learn';
import { BUNSETSU_STARTERS, COMPOUND_PARTICLES, CUT_PARTICLES, PARTICLES, PARTICLE_ATOMS, PARTICLE_DUEL_FROM, hasParticleHint, movableTiles, particleHints, splitBunsetsu } from './bunsetsu';
import { S, fill } from './engine-strings';

export { BUNSETSU_STARTERS, COMPOUND_PARTICLES, CUT_PARTICLES, PARTICLES, PARTICLE_ATOMS, PARTICLE_DUEL_FROM, hasParticleHint, movableTiles, particleHints, splitBunsetsu };
import type { PlanContext } from './context';

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

/**
 * Fraction of resolved tokens (`tokenIds` non-null entries) the learner knows,
 * the V20 way: a token in its line's `plusOne` is the designed +1 and counts as
 * covered, as does any id in `allow` (the shared White allowlist at Stations
 * 1–3). The validator passes stories on exactly this notion, so the live gate
 * serves what was written for it.
 */
export function storyCoverage(story: StoryItem, known: ReadonlySet<string>, allow: ReadonlySet<string> = new Set()): number {
  let total = 0;
  let hit = 0;
  for (const line of story.lines) {
    for (const id of line.tokenIds ?? []) {
      if (id === null) continue;
      total++;
      if (known.has(id) || allow.has(id) || line.plusOne?.includes(id)) hit++;
    }
  }
  return total === 0 ? 1 : hit / total;
}

/** Stories of the loaded bundles that meet the live coverage target: unread first (`progress.storiesRead`), then best coverage. */
export function pickStories(ctx: PlanContext, o: { kind?: StoryItem['kind']; station?: number } = {}): StoryItem[] {
  const st = o.station ?? ctx.station;
  const read = new Set(store.progress.value.storiesRead ?? []);
  return ctx.stories
    .filter((s) => (o.kind ? s.kind === o.kind : true))
    .map((s) => ({ s, c: storyCoverage(s, ctx.known, ctx.allowlist), unread: read.has(s.id) ? 0 : 1 }))
    .filter(({ s, c }) => c >= coverageTargetFor(st, s.bridge === true))
    .sort((a, b) => b.unread - a.unread || b.c - a.c || (a.s.id < b.s.id ? -1 : 1))
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
 * Reading of the plain span `[start, end)` of ruby'd `ja`: ruby groups by
 * their reading, plain text as is. `null` when a ruby group straddles a span
 * boundary (the span would cut a compound such as {二時間|にじかん}).
 */
export function rubySpanReading(ja: string, start: number, end: number): string | null {
  let off = 0;
  let reading = '';
  for (const seg of parseRuby(ja)) {
    const s0 = off;
    const s1 = off + seg.base.length;
    off = s1;
    if (s1 <= start || s0 >= end) continue;
    if (seg.reading !== null) {
      if (s0 < start || s1 > end) return null;
      reading += seg.reading;
    } else {
      reading += seg.base.slice(Math.max(start, s0) - s0, Math.min(end, s1) - s0);
    }
  }
  return reading;
}

/**
 * First occurrence of `word` in the plain text of `ja` whose ruby aligns with
 * it and (when `kana` is given) reads as `kana`; `-1` when none does.
 */
export function alignedOccurrence(ja: string, word: string, kana?: string): number {
  const plain = toPlain(ja);
  for (let i = plain.indexOf(word); i >= 0; i = plain.indexOf(word, i + 1)) {
    const reading = rubySpanReading(ja, i, i + word.length);
    if (reading === null) continue;
    if (kana === undefined || equivalentJa(reading, kana)) return i;
  }
  return -1;
}

/** Form Chain length (design 04 §4: "one verb, 5 target forms in sequence"). */
export const FORM_CHAIN_LENGTH = 5;

/**
 * The 5 links of a Form Chain for `verb`: the point's own `unlocksForms` first,
 * then forms unlocked by grammar points the learner has already met (known, or
 * introduced at a station ≤ the current one), then any other form the verb
 * takes — so a point that declares one form (た, ない, て…) still yields a
 * chain instead of a single typed form. Padding order rotates with `rep`.
 */
function formChain(ctx: PlanContext, item: GrammarItem, verb: VocabItem, own: readonly ConjForm[], rep: number): ConjForm[] {
  const can = (f: ConjForm): boolean => conjugate(verb.word, verb.kana, verb.pos as never, f) !== null;
  const chain: ConjForm[] = own.slice(0, FORM_CHAIN_LENGTH);
  const rotate = <T,>(xs: T[]): T[] => (xs.length === 0 ? xs : [...xs.slice(rep % xs.length), ...xs.slice(0, rep % xs.length)]);
  const met = ctx.grammarPool.filter((g) => g.id !== item.id && (ctx.known.has(g.id) || (g.station !== undefined && g.station <= ctx.station)));
  const unlocked = rotate(shuffle(ctx.rng, Array.from(new Set(met.flatMap((g) => g.unlocksForms ?? [])))));
  const any = rotate(shuffle(ctx.rng, isConjugable(verb.pos) ? applicableForms(verb.pos) : []));
  for (const f of [...unlocked, ...any]) {
    if (chain.length >= FORM_CHAIN_LENGTH) break;
    if (!chain.includes(f) && can(f)) chain.push(f);
  }
  return chain;
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
      const kana = ex?.kana ?? '';
      // The vocab behind the example is matched by surface AND reading (a homograph read differently never lends its sentence), and
      // the sentence is the first linked story line or vocab example with an occurrence whose ruby aligns with the
      // blank and reads as the example does; otherwise the bare word is the prompt (design 04 §3 "reading in context").
      const vocab = ctx.vocabPool.find((v) => v.word === word && (kana === '' || equivalentJa(v.kana, kana)));
      const target = exercise === 'kanji-read' ? word : item.char;
      const candidates: { ja: string; en: string }[] = vocab ? [...linesWith(ctx, vocab.id).map((l) => l.story.lines[l.index] as StoryLine), ...vocab.examples] : [];
      let ruby = word;
      let en = ex?.en ?? '';
      let start = exercise === 'kanji-read' ? 0 : word.indexOf(item.char);
      for (const sx of candidates) {
        const at = alignedOccurrence(sx.ja, word, exercise === 'kanji-read' ? kana : undefined);
        if (at < 0) continue;
        ruby = sx.ja;
        en = sx.en;
        start = exercise === 'kanji-read' ? at : at + word.indexOf(item.char);
        break;
      }
      p.sentence = ruby;
      p.blank = start >= 0 ? [start, start + target.length] : [0, 0];
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
      // Only the forms the point declares are drillable (design 04 §4); the head word comes from the items that realise
      // at least one of them — adjectives for adj-* points, verbs for verb points, either for a mixed point — so an
      // adjective-only point (〜くないです) is drillable and the rotation never lands on a word that lacks the form (ある for たい).
      const declared = item.unlocksForms ?? [];
      const pool = ctx.vocabPool.filter((v) => isConjugable(v.pos) && declared.some((f) => conjugate(v.word, v.kana, v.pos as ConjugablePos, f) !== null));
      const verb = pool[((rep % Math.max(1, pool.length)) + pool.length) % Math.max(1, pool.length)];
      if (!verb || !isConjugable(verb.pos)) break;
      const pos: ConjugablePos = verb.pos;
      /** Accepted surfaces of one form, display form first (kanji, kana, engine alternates); `null` when the verb lacks it. */
      const surfaces = (f: ConjForm): string[] | null => {
        const c = conjugate(verb.word, verb.kana, pos, f);
        return c ? dedupe([c.answer, c.answerKana, ...c.alt]) : null;
      };
      const forms = declared.filter((f) => surfaces(f) !== null);
      if (forms.length === 0) break;
      p.sentence = verb.word;
      // The verb's reading and part of speech ride along (StepParams.kana / pos), and `accepts` carries the accepted
      // surfaces of every form the step asks for, so the drills never infer the head word from the answers.
      p.kana = verb.kana;
      p.pos = pos;
      p.promptEn = verb.meanings[0] ?? '';
      if (exercise === 'form-forge') {
        const form = forms[((rep % forms.length) + forms.length) % forms.length] as ConjForm;
        const row = surfaces(form);
        if (!row || row.length === 0) break;
        p.targetForm = form;
        p.answer = row[0] as string;
        p.accept = row;
        p.accepts = [row];
        p.promptEn = fill(S.formForgePrompt, { word: verb.meanings[0] ?? verb.word, form: FORM_LABEL[form] });
      } else {
        p.forms = formChain(ctx, item, verb, forms, rep);
        const rows = p.forms.map((f) => surfaces(f) ?? []);
        p.answers = rows.map((r) => r[0] ?? '');
        p.accepts = rows;
        p.accept = dedupe(rows.flat());
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
      // Either half is spoken (design 04 §5 "audio of one of two near words"); `answer` names the one played so the
      // feedback line and the drill's target agree. Always speaking the item's own word made the pair solvable by
      // recognising the familiar word.
      const pair = perceptionJudge(item, ctx.vocabPool).minimalPair;
      p.answer = rng() < 0.5 ? pair[0] : pair[1];
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
