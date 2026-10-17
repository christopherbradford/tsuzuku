/**
 * TSUZUKU — plan pickers and day counters (design 03 §2, §4–§5; 05 §3).
 *
 * The pure, store-reading helpers the builders share: the 7-day accuracy, the
 * items introduced today (counted from the review log so the cramming cap
 * survives the +3 / +10 graduations), today's new-item budget by belt
 * (`effectiveNewPerDay`, the store's one rule, re-exported here), the due
 * queue in Kata order, the easiest cards for
 * cooldowns and the Welcome Back set, today's Scrolls, the Michikusa draw, the
 * Grudge List keys (`grudgeKeys`, shared by the builder's Grudge block and the
 * Gatekeeper's rematch rule) and the week's strand minutes. Split out of
 * `builder.ts` (which re-exports them); nothing here calls back into the
 * builder at runtime.
 */
import type { CardKey } from '../content/types';
import { hashSeed } from '../shared/hash';
import { isCardKey, parseCardKey, tryKindOfId } from '../shared/ids';
import { CardFlag, hasFlag, type EpochDay, type SaveMeta } from '../shared/store-types';
import { dayStartMs } from '../shared/time';
import { effectiveNewPerDay, store } from '../store';
import { beltOfStation } from '../store/derived';
import { dueCards, kaidenQuota, nextScrolls, queueCardFor, type QueueCard, type Scroll } from '../learn';
import type { Strand } from './blocks';
import type { PlanContext } from './context';

/** 7-day accuracy from the daily rows (`ok / reps`), with the rep count behind it. */
export function accuracy7(daily: SaveMeta['daily'], today: EpochDay): { acc7: number; n: number } {
  let ok = 0;
  let reps = 0;
  for (let d = today - 6; d <= today; d++) {
    const row = daily[d];
    if (!row) continue;
    ok += row.ok;
    reps += row.reps;
  }
  return { acc7: reps > 0 ? ok / reps : 1, n: reps };
}

/**
 * Items introduced today, by kind. Counted from durable facts, not card shape:
 * a base-facet card whose last rep is today and that is either still unchecked
 * (state 0, created today) or whose EARLIEST review-log row is today (the intro
 * check is the first logged rep). A new card graduates to review state inside
 * the same session (+3 / +10), so state/reps cannot tell "born today" apart
 * from "reviewed today"; the log can (every rep of such a card is a row from
 * today). 既知 (`markKnown`) cards start at one unlogged rep and are not
 * counted, as before.
 */
export function introducedToday(today: EpochDay): { vocab: number; kanji: number; grammar: number; kana: number; component: number } {
  const out = { vocab: 0, kanji: 0, grammar: 0, kana: 0, component: 0 };
  const seen = new Set<string>();
  let dayStart: number | null = null;
  const startOfToday = (): number => {
    if (dayStart === null) {
      try {
        dayStart = dayStartMs(today, store.profile.value.tz);
      } catch {
        dayStart = dayStartMs(today);
      }
    }
    return dayStart;
  };
  store.cards.forEach((k, t) => {
    if (t[6] !== today) return;
    const { itemId, facet } = parseCardKey(k);
    if (seen.has(itemId)) return;
    const kind = tryKindOfId(itemId);
    if (!kind || !(kind in out)) return;
    const base = kind === 'kanji' ? 'comp' : kind === 'grammar' ? 'cloze' : 'rec';
    if (facet !== base && !(kind === 'vocab' && facet === 'prod')) return;
    let born = t[5] === 0;
    if (!born) {
      // Every rep the card ever had was logged today: a card from before carries reps its (rolled or absent) log
      // rows do not account for, and a 既知 card starts at one unlogged rep.
      const rows = store.log.forCard(k);
      born = rows.length > 0 && rows.length >= t[3] && rows.every((e) => e[0] >= startOfToday());
    }
    if (born) {
      seen.add(itemId);
      out[kind as keyof typeof out]++;
    }
  });
  return out;
}

/**
 * Today's new-item budget is the store's one rule (`effectiveNewPerDay` in
 * `store/defaults.ts`, shared with `derived.forecastCounts` and the projection):
 * the stored `settings.newPerDay` is the custom override only; every preset
 * follows the belt table, so the White mix onboarding stores never freezes the
 * budget at later belts. Re-exported so `builder.ts` / `SessionView.tsx` keep
 * importing it from here; no second copy of the rule lives in this group.
 */
export { effectiveNewPerDay };

/** The Grudge List as card keys: a saved entry that is not well-formed (`isCardKey`) is ignored, never parsed or counted. */
export function grudgeKeys(): CardKey[] {
  return store.progress.value.grudge.filter(isCardKey);
}

/** Load bound for due-card content: the cards the planners can draw plus the extra the sparring pool and `exclude` sets reach past `showDue`. */
export const DUE_LOAD_RESERVE = 40;

/* ────────────────────────────────────────────────────────────────────────── */
/* Pickers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** One Michikusa for today: `hash(seed, day)` over the un-collected pool of stations ≤ current + 1; a collected one (`isNew: false`) when exhausted. */
export function michikusaFor(ctx: PlanContext): { id: string; isNew: boolean } | null {
  const pool: string[] = [];
  for (const b of ctx.bundles) pool.push(...b.michikusaIds);
  if (ctx.nextBundle) pool.push(...ctx.nextBundle.michikusaIds);
  const uniq = Array.from(new Set(pool)).sort();
  if (uniq.length === 0) return null;
  const collected = new Set(store.collections.value.michikusa);
  const fresh = uniq.filter((id) => !collected.has(id));
  const h = hashSeed(ctx.seed, ctx.today, 'michikusa');
  if (fresh.length > 0) return { id: fresh[h % fresh.length] as string, isNew: true };
  return { id: uniq[h % uniq.length] as string, isNew: false };
}

/** Due cards for today in Kata order, `limit` at most, honoring backlog mode and the Kaiden lane. */
export function dueQueue(ctx: PlanContext, limit: number, exclude: ReadonlySet<CardKey> = new Set()): QueueCard[] {
  const all = dueCards({ cards: store.cards, today: ctx.today, limit: limit + exclude.size, backlog: ctx.backlog, kaidenQuota: kaidenQuota(ctx.cap) });
  return all.filter((c) => !exclude.has(c.cardKey)).slice(0, Math.max(0, limit));
}

/** Highest-R review-state cards (not due), for cooldowns when nothing due remains. */
export function easiestCards(ctx: PlanContext, n: number, exclude: ReadonlySet<CardKey>): QueueCard[] {
  const out: QueueCard[] = [];
  store.cards.forEach((k, t) => {
    if (exclude.has(k) || t[5] === 0 || hasFlag(t[7], CardFlag.archived)) return;
    const qc = queueCardFor(store.cards, k, ctx.today);
    if (qc) out.push(qc);
  });
  return out.sort((a, b) => b.r - a.r || (a.cardKey < b.cardKey ? -1 : 1)).slice(0, n);
}

/** Cards the learner most likely still knows (Welcome Back set: highest R, review state). */
export function welcomeSet(ctx: PlanContext, n: number): QueueCard[] {
  return easiestCards(ctx, n, new Set());
}

/** Scrolls for today (captured words, kana, components, vocab, kanji, grammar), limited to `max`. */
export function scrollsForToday(ctx: PlanContext, max: number): Scroll[] {
  if (!ctx.bundle || max <= 0) return [];
  const intro = introducedToday(ctx.today);
  const npd = effectiveNewPerDay(ctx.settings, ctx.belt);
  const kanaPerDay = ctx.belt === 'white' ? 20 : 0;
  const scrolls = nextScrolls({
    bundle: ctx.bundle,
    cards: store.cards,
    captured: store.captured.value,
    newPerDay: { vocab: Math.max(npd.vocab, 1), kanji: Math.max(npd.kanji, ctx.bundle.kanjiIds.length > 0 ? 1 : 0), grammar: Math.max(npd.grammar, ctx.bundle.grammarIds.length > 0 ? 1 : 0) },
    introducedToday: { vocab: intro.vocab, kanji: intro.kanji, grammar: intro.grammar },
    belt: beltOfStation(ctx.station),
    components: ctx.components,
    get: (id) => ctx.loader.get(id),
    today: ctx.today,
    kanaPerDay,
    introducedKanaToday: intro.kana,
    introducedComponentsToday: intro.component,
  });
  return scrolls.slice(0, max);
}

/** Strand minutes trained this week, from the ledger (in-app rows: kind listen/watch → input, speak → output, read → input) and the daily rows (form). */
export function weekStrandMinutes(today: EpochDay): Record<Strand, number> {
  const from = today - 6;
  const out: Record<Strand, number> = { form: 0, input: 0, output: 0 };
  for (const e of store.ledger.value.entries) {
    if (e[0] < from || e[0] > today) continue;
    if (e[2] === 3) out.output += e[1];
    else out.input += e[1];
  }
  for (let d = from; d <= today; d++) {
    const row = store.daily.value[d];
    if (row) out.form += Math.max(0, row.minutes - row.input);
  }
  return out;
}
