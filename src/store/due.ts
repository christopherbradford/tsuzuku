/**
 * TSUZUKU — the one "due review" predicate (group B).
 *
 * A card is a due review on `day` when its due day has arrived, it has been
 * reviewed at least once (state ≠ 0: a card created at introduction but never
 * served is not a review), and it is neither archived nor Kaiden. This mirrors
 * the session builder / `learn/queue.dueCards`, so the Dojo forecast, the end
 * card and the `clear-due` quest count the same reviews the session will show.
 * `CardsApi.dueOn()` stays the raw store primitive (due + flags only).
 */
import { CardFlag, hasFlag, type CardTuple, type EpochDay } from '../shared/store-types';

export function isDueReview(t: CardTuple, day: EpochDay): boolean {
  return t[0] <= day && t[5] !== 0 && !hasFlag(t[7], CardFlag.archived) && !hasFlag(t[7], CardFlag.kaiden);
}
