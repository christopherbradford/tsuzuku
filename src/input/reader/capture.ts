/**
 * TSUZUKU — 捕まえる capture and the gloss-tap side effects (design 04 §7, 05 §3–4).
 *
 *  - A tap on an UNINTRODUCED word the corpus carries → `store.captured`
 *    (deduped; captured words enter the new-item queue ahead of the station
 *    list, up to 40 % of the vocab budget from Green — `learn/intro-policy`).
 *  - A tap on a token with no item id (a word the corpus lacks) → free-text
 *    `store.bookmarks` (deduped), like the Field Mission "two things you
 *    couldn't say".
 *  - A tap on an INTRODUCED word → implicit Hard on its base card through
 *    `recordImplicit` (never `attempt:graded`), only when the caller says the
 *    card is in the window (`dueWithin3`: the design gate is "due today and not
 *    the episode's first read"; the writer re-checks `dueWithin: 3` itself).
 *
 * No bus event of its own: `Events` has no capture event; the store signal
 * `store.captured` is the fact others read.
 */
import type { CardKey, DrillId, Facet } from '../../content/types';
import { recordImplicit, type ImplicitOutcome } from '../../learn/apply';
import { cardKey, tryKindOfId } from '../../shared/ids';
import { store } from '../../store';

/** Implicit gloss-tap grades apply to cards due within this many days (design 05 §4). */
export const GLOSS_DUE_WINDOW = 3;

export type CaptureKind = 'captured' | 'already-captured' | 'bookmarked' | 'already-bookmarked' | 'implicit-hard' | 'none';

export interface CaptureOutcome {
  kind: CaptureKind;
  itemId: string | null;
  /** The card graded Hard (implicit path). */
  cardKey?: CardKey;
  implicit?: ImplicitOutcome;
}

export interface GlossTapInput {
  token: string;
  /** Linked item id (`StoryLine.tokenIds[i]`), absent when the corpus has no item. */
  itemId?: string | null;
  /** The item already has cards (`store.cards.byItem(id)` non-empty). */
  introduced: boolean;
  /** The caller's gate for the implicit Hard (due today and not the first read, design 04 §7). */
  dueWithin3: boolean;
  sessionId: string;
  /** Exercise logged on the implicit grade (default `story-read`). */
  exercise?: DrillId;
}

/** Only items that can become cards are capturable (vocab / kanji / grammar / kana / component). */
export function isCapturableId(itemId: string | null | undefined): itemId is string {
  if (!itemId) return false;
  const k = tryKindOfId(itemId);
  return k === 'vocab' || k === 'kanji' || k === 'grammar' || k === 'kana' || k === 'component';
}

export function isCaptured(itemId: string): boolean {
  return store.captured.value.includes(itemId);
}

/** Adds to `store.captured` once; `true` when it was new. */
export function captureItem(itemId: string): boolean {
  if (isCaptured(itemId)) return false;
  store.patch('captured', (prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
  return true;
}

/** Removes a capture (the learner changed their mind); `true` when something was removed. */
export function releaseCapture(itemId: string): boolean {
  if (!isCaptured(itemId)) return false;
  store.patch('captured', (prev) => prev.filter((id) => id !== itemId));
  return true;
}

/** Free-text bookmark, trimmed and deduped; `true` when it was new. Empty text is ignored. */
export function bookmarkText(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (store.bookmarks.value.includes(t)) return false;
  store.patch('bookmarks', (prev) => (prev.includes(t) ? prev : [...prev, t]));
  return true;
}

/** The facet a gloss tap grades: `rec` when it exists, else `prod` (a chunk's base facet). */
export function glossFacetFor(itemId: string): Facet | null {
  const cards = store.cards.byItem(itemId);
  if (cards.rec) return 'rec';
  if (cards.prod) return 'prod';
  return null;
}

/**
 * The gloss-tap decision (design 04 §7). Pure in its branching; writes only
 * through `store.patch` / `recordImplicit`.
 */
export function onGlossTap(o: GlossTapInput): CaptureOutcome {
  const itemId = isCapturableId(o.itemId) ? o.itemId : null;

  if (!itemId) {
    // Nothing in the corpus behind this token: keep the surface as a bookmark.
    return { kind: bookmarkText(o.token) ? 'bookmarked' : 'already-bookmarked', itemId: null };
  }

  if (!o.introduced) {
    return { kind: captureItem(itemId) ? 'captured' : 'already-captured', itemId };
  }

  if (!o.dueWithin3) return { kind: 'none', itemId };

  const facet = glossFacetFor(itemId);
  if (!facet) return { kind: 'none', itemId };
  const key = cardKey(itemId, facet);
  const r = recordImplicit({
    cardKey: key,
    rating: 2,
    exercise: o.exercise ?? 'story-read',
    sessionId: o.sessionId,
    dueWithin: GLOSS_DUE_WINDOW,
  });
  if (!r) return { kind: 'none', itemId, cardKey: key };
  return { kind: 'implicit-hard', itemId, cardKey: key, implicit: r };
}
