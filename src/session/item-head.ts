/**
 * TSUZUKU — `itemHead`: the display surface of a content item (word, pattern,
 * kanji, kana), with the id as the honest fallback when the item is not in
 * memory. Shared by the Grudge List, the つづく card's promotions and anything
 * else that names an item to the learner.
 */
import type { ContentItem } from '../content/types';

export function itemHead(item: ContentItem | undefined, id: string): string {
  if (!item) return id;
  if ('word' in item && typeof item.word === 'string') return item.word;
  if ('pattern' in item) return item.pattern;
  if ('char' in item) return item.char;
  if ('kana' in item && typeof item.kana === 'string') return item.kana;
  return id;
}
