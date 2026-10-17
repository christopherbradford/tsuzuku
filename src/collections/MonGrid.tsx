/**
 * TSUZUKU — <MonGrid>: all 66 Mon crests grouped by strand (design 06 §2).
 *
 * Earned crests carry their day; unearned ones are grey stone with the
 * condition in plain text, visible from day one (06 §7 #2). Tapping a crest
 * opens a detail sheet (name, tier, condition, earned day) as a modal dialog
 * with focus trapped on its close button and restored on close. Names and
 * conditions come from `BADGE_DEFS` (store contract tier); the crest art is
 * `<MonCrest>` from the art folder.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MonCrest, monCrestText } from '../art/MonCrest';
import type { BadgeId } from '../shared/catalog';
import type { EpochDay } from '../shared/store-types';
import { isoDate } from '../shared/time';
import { BADGE_DEFS, store } from '../store';
import type { BadgeDef } from '../store/badge-defs';
import { S, fill } from './strings';
import './MonGrid.css';

export type MonFilter = 'all' | 'earned' | 'locked';

/** Dojo shelf order (design 06 §5 "one slot per category"); unknown categories follow, in first-seen order. */
export const CATEGORY_ORDER: readonly string[] = ['kana', 'streak', 'training', 'road', 'belt', 'input', 'output', 'mastery', 'spirit'];

export interface MonGroup {
  category: string;
  label: string;
  defs: BadgeDef[];
  earned: number;
}

/** Badges by category in shelf order, with the earned count per group. */
export function groupBadges(defs: readonly BadgeDef[], badges: Partial<Record<BadgeId, EpochDay>>): MonGroup[] {
  const by = new Map<string, BadgeDef[]>();
  for (const d of defs) {
    const list = by.get(d.category) ?? [];
    list.push(d);
    by.set(d.category, list);
  }
  const order = [...CATEGORY_ORDER, ...Array.from(by.keys()).filter((c) => !CATEGORY_ORDER.includes(c))];
  const out: MonGroup[] = [];
  for (const category of order) {
    const list = by.get(category);
    if (!list || list.length === 0) continue;
    out.push({
      category,
      label: S.categories[category] ?? category,
      defs: list,
      earned: list.filter((d) => badges[d.id] !== undefined).length,
    });
  }
  return out;
}

const TIER_LABEL: Record<BadgeDef['tier'], string> = { bronze: S.tierBronze, silver: S.tierSilver, gold: S.tierGold };

function matches(filter: MonFilter, earned: boolean): boolean {
  return filter === 'all' || (filter === 'earned') === earned;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Detail sheet                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function MonDetail(p: { def: BadgeDef; earnedOn: EpochDay | undefined; onClose(): void }): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const earned = p.earnedOn !== undefined;
  const text = monCrestText({ id: p.def.id, earned, earnedOn: p.earnedOn });
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        p.onClose();
      } else if (e.key === 'Tab') {
        // one focusable control: keep focus on it
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p.def.id]);
  return (
    <div class="modal mon-detail" data-badge={p.def.id} onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class="modal__card mon-detail__card" role="dialog" aria-modal="true" aria-labelledby="mon-detail-title" aria-describedby="mon-detail-condition">
        <MonCrest id={p.def.id} earned={earned} size={160} caption={false} class="mon-detail__crest" />
        <h3 id="mon-detail-title" class="mon-detail__title">
          <span class="mon-detail__en">{p.def.nameEn}</span>
          <span class="mon-detail__ja" lang="ja">
            {p.def.nameJa}
          </span>
        </h3>
        <p class="mon-detail__meta">
          <span class={`chip mon-detail__tier mon-detail__tier--${p.def.tier}`}>{TIER_LABEL[p.def.tier]}</span>
          <span class="chip">{S.categories[p.def.category] ?? p.def.category}</span>
        </p>
        <p id="mon-detail-condition" class="mon-detail__condition">
          <span class="mon-detail__label">{S.conditionLabel}</span> {p.def.describe}
        </p>
        <p class="mon-detail__state">
          {earned && p.earnedOn !== undefined ? (
            <time dateTime={isoDate(p.earnedOn)} lang="ja">
              {fill(S.earnedOn, { date: text.date ?? '' })}
            </time>
          ) : (
            S.notYetEarned
          )}
        </p>
        <div class="modal__actions">
          <button type="button" class="btn" ref={closeRef} onClick={p.onClose}>
            {S.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Grid                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const FILTERS: readonly { id: MonFilter; label: string }[] = [
  { id: 'all', label: S.filterAll },
  { id: 'earned', label: S.filterEarned },
  { id: 'locked', label: S.filterLocked },
];

export function MonGrid(): JSX.Element {
  const badges = store.collections.value.badges;
  const [filter, setFilter] = useState<MonFilter>('all');
  const [open, setOpen] = useState<BadgeId | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const groups = useMemo(() => groupBadges(BADGE_DEFS, badges), [badges]);
  const earnedTotal = groups.reduce((n, g) => n + g.earned, 0);
  const total = BADGE_DEFS.length;
  const openDef = open ? BADGE_DEFS.find((d) => d.id === open) : undefined;

  const close = (): void => {
    setOpen(null);
    const t = triggerRef.current;
    triggerRef.current = null;
    t?.focus();
  };

  return (
    <section class="mon-grid" aria-label={S.tabMon} data-earned={earnedTotal} data-total={total}>
      <p class="mon-grid__lede">{fill(S.monLede, { earned: earnedTotal, total })}</p>
      <div class="mon-grid__filters" role="group" aria-label={S.monFilterLabel}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" class="btn btn--sm" aria-pressed={filter === f.id ? 'true' : 'false'} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {groups.map((g) => {
        const visible = g.defs.filter((d) => matches(filter, badges[d.id] !== undefined));
        return (
          <section key={g.category} class="mon-grid__group" data-category={g.category} aria-labelledby={`mon-group-${g.category}`}>
            <h3 id={`mon-group-${g.category}`} class="mon-grid__h3">
              <span>{g.label}</span>
              <span class="mon-grid__count tag">{fill(S.monGroupCount, { earned: g.earned, total: g.defs.length })}</span>
            </h3>
            {visible.length === 0 ? (
              <p class="mon-grid__empty muted">{S.monEmptyFilter}</p>
            ) : (
              <ul class="mon-grid__cells">
                {visible.map((d) => {
                  const at = badges[d.id];
                  const earned = at !== undefined;
                  return (
                    <li key={d.id} class="mon-grid__cell" data-badge={d.id} data-earned={earned ? 'true' : 'false'}>
                      <button
                        type="button"
                        class="mon-grid__button"
                        aria-haspopup="dialog"
                        aria-label={fill(S.monOpen, { name: `${d.nameEn} ${d.nameJa}` })}
                        onClick={(e) => {
                          triggerRef.current = e.currentTarget;
                          setOpen(d.id);
                        }}
                      >
                        <MonCrest id={d.id} earned={earned} earnedOn={at} size={72} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {openDef ? <MonDetail def={openDef} earnedOn={badges[openDef.id]} onClose={close} /> : null}
    </section>
  );
}
