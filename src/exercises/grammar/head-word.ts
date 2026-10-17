/**
 * TSUZUKU — the conjugable head word of a Form Forge / Form Chain step.
 *
 * A vocab item that conjugates is the head word itself (`headWordOf`). On a
 * grammar `prod` card the item is the GrammarItem and the verb the planner
 * picked travels in the step: `params.sentence` (its dictionary form),
 * `params.kana` (its reading), `params.pos` (its part of speech) and
 * `params.accepts` (accepted surfaces per form, parallel to `params.forms`).
 * `inferHeadWord` takes `pos` when the step carries it; an older step without
 * it recovers the part of speech as the one conjugable pos whose engine
 * answers reproduce every planner answer (`forms[i]` → `answers[i]`, or
 * `targetForm` → `answer`) — uniquely, so a form that reads the same in two
 * groups (食べれば is 〜ば for both an ichidan and a godan 食べる) never
 * guesses; `v-irr` is a candidate only for する / くる and their compounds,
 * since the engine conjugates any other word labelled `v-irr` by its shape
 * and would merely duplicate v1 / v5. The dictionary-form tail is never
 * consulted: 帰る / 切る conjugate as godan because their answers say so, not
 * as the る-ending suggests. `null` when nothing fits; the drills then fall
 * back to the planner's flat `accept` list.
 */
import type { ConjForm, ConjugablePos, ContentItem, VocabItem } from '@/content/types';
import { conjugate, isConjugable } from '@/learn';
import type { StepParams } from '@/shared/session-types';

export function isVocabItem(i: ContentItem | null | undefined): i is VocabItem {
  return !!i && 'word' in i && 'kana' in i && 'meanings' in i && 'pos' in i;
}

/** A conjugable head word: the vocab item, or the planner's verb on a grammar prod card. */
export interface HeadWord {
  word: string;
  kana: string;
  pos: ConjugablePos;
}

export function headWordOf(item: ContentItem | null): HeadWord | null {
  if (!isVocabItem(item) || !isConjugable(item.pos)) return null;
  return { word: item.word, kana: item.kana, pos: item.pos };
}

export const CONJUGABLE_POS: readonly ConjugablePos[] = ['v1', 'v5', 'v-irr', 'adj-i', 'adj-na'];

/** The pos values worth trying for `kana`: `v-irr` only where the engine has an irregular table (する / くる). */
function candidatesFor(kana: string): readonly ConjugablePos[] {
  return kana.endsWith('する') || kana.endsWith('くる') ? CONJUGABLE_POS : CONJUGABLE_POS.filter((pos) => pos !== 'v-irr');
}

/** `(form, planner answer)` pairs the step declares: the chain's forms / answers, else the forge's targetForm / answer. */
function declaredPairs(params: StepParams): [ConjForm, string][] {
  const forms = params.forms ?? [];
  if (forms.length > 0) {
    const answers = params.answers ?? [];
    return forms.map((f, i) => [f, (answers[i] ?? '').trim()]);
  }
  if (params.targetForm) return [[params.targetForm, (params.answer ?? '').trim()]];
  return [];
}

/**
 * The planner's verb on a grammar prod card as a head word: `params.pos`
 * when present, else the unique conjugable pos that reproduces every declared
 * answer. `null` without a word, without any answer to match, or when the
 * answers fit no pos (or more than one).
 */
export function inferHeadWord(params: StepParams): HeadWord | null {
  const word = (params.sentence ?? '').trim();
  if (!word) return null;
  const kana = (params.kana ?? '').trim() || word;
  if (params.pos !== undefined && isConjugable(params.pos)) return { word, kana, pos: params.pos };
  const pairs = declaredPairs(params).filter(([, want]) => want.length > 0);
  if (pairs.length === 0) return null;
  const fits = candidatesFor(kana).filter((pos) => pairs.every(([form, want]) => conjugate(word, kana, pos, form)?.answer === want));
  return fits.length === 1 ? { word, kana, pos: fits[0] as ConjugablePos } : null;
}

/** The planner's accepted surfaces for form `i` (`params.accepts[i]`), trimmed; `[]` without them. */
export function acceptsRow(params: StepParams, i: number): string[] {
  if (i < 0) return [];
  return (params.accepts?.[i] ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}
