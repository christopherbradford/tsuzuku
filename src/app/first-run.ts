/**
 * TSUZUKU — first-run detection (group A).
 *
 * A save with no trace of a learner: blank (or non-string) name, or no
 * activity at all. A fresh save carries the default name 無名, so the name
 * alone cannot tell. The name guard tolerates a hand-edited save whose
 * `profile.name` is not a string (the store repairs it at boot; this stays
 * defensive so the boot redirect can never throw on it). Used by `main.tsx`
 * (redirect to Nihonbashi) and `DojoPage` (first-run card).
 */
import { store } from '@/store';

export function isFirstRun(): boolean {
  const profile = store.profile.value;
  if (typeof profile.name !== 'string' || profile.name.trim() === '') return true;
  const stats = store.stats.value;
  const streak = store.streak.value;
  return (
    stats.sessions === 0 &&
    streak.totalDays === 0 &&
    profile.xp === 0 &&
    profile.kanaKnown.length === 0 &&
    profile.goals.length === 0 &&
    store.cards.count() === 0
  );
}
