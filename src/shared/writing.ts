/**
 * TSUZUKU — Writing Dojo bookmarks (contract tier; design 05 §8, 06 §3).
 *
 * Finished Writing Dojo sentences are kept under `store.bookmarks` with the
 * `WRITING_PREFIX`, since `SaveMeta` has no `writings` slice. The input group
 * writes them; the art tier (Tanabata, design 06 §3) reads them back for the
 * learner's wall scrolls — and ARCHITECTURE §0 forbids `art/` importing
 * `input/`, so the prefix and the reader live here, where both may import them.
 */

/** Bookmark prefix under which finished Writing Dojo sentences are kept. */
export const WRITING_PREFIX = '作文: ';

/** The sentences of every finished piece, in bookmark order, with the prefix stripped. */
export function writingSentencesFrom(bookmarks: readonly string[]): string[] {
  return bookmarks.filter((b) => b.startsWith(WRITING_PREFIX)).map((b) => b.slice(WRITING_PREFIX.length));
}
