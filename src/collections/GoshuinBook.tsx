/**
 * TSUZUKU — <GoshuinBook>: the paged stamp book (design 06 §4).
 *
 * Fifty-three station pages plus one belt page after each Shinsa station,
 * read two pages per spread like an accordion book: swipe, the arrow keys or
 * the page index turn the spreads. Cleared gates show the learner's own
 * goshuin (`<GoshuinStamp>`), uncleared ones the station name in grey stone
 * with the Gatekeeper named, so the whole road is visible from day one. The
 * book exports through `art/png.ts`: one 6480 × 720 strip (desktop) or a
 * six-image phone set, both from `goshuin.bookStripImages`.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { GoshuinStamp } from '../art/GoshuinStamp';
import { MonCrest } from '../art/MonCrest';
import { PHONE_SET, bookStripImages, kanjiNumber, type BookStamp } from '../art/goshuin';
import { download, exportPng, filenameFor, type DownloadOutcome, type ExportOptions } from '../art/png';
import { BELTS, STATIONS, type Belt, type BeltDef, type StationDef } from '../content/types';
import { BELT_BADGE, type BadgeId } from '../shared/catalog';
import { hashSeed } from '../shared/hash';
import type { EpochDay, StampEntry } from '../shared/store-types';
import { formatEraDate, isoDate } from '../shared/time';
import { store } from '../store';
import { S, fill } from './strings';
import './GoshuinBook.css';

export interface GoshuinBookProps {
  /** PNG pipeline (default `exportPng`); tests inject a recorder. */
  exporter?: (o: ExportOptions) => Promise<Blob | null>;
  /** Save step (default `download`). */
  saver?: (blob: Blob, filename: string) => DownloadOutcome;
}

export type BookPage =
  | { kind: 'station'; index: number; station: StationDef; stamp: StampEntry | undefined }
  | { kind: 'belt'; index: number; belt: BeltDef; badge: BadgeId; passed: boolean; at: EpochDay | undefined };

export const PAGES_PER_SPREAD = 2;
export const SWIPE_PX = 40;

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** 53 station pages, with each belt's page right after its Shinsa station (06 §4 "53 stations + belt stamps"). */
export function buildPages(stamps: Record<number, StampEntry>, shinsaPassed: readonly Belt[], badges: Partial<Record<BadgeId, EpochDay>>): BookPage[] {
  const out: BookPage[] = [];
  for (const station of STATIONS) {
    out.push({ kind: 'station', index: out.length, station, stamp: stamps[station.number] });
    const belt = BELTS.find((b) => b.id !== 'white' && b.stations[1] === station.number);
    if (belt && belt.id !== 'white') {
      const badge = BELT_BADGE[belt.id];
      const at = badges[badge];
      out.push({ kind: 'belt', index: out.length, belt, badge, passed: shinsaPassed.includes(belt.id) || at !== undefined, at });
    }
  }
  return out;
}

export function spreadsOf(pages: readonly BookPage[]): BookPage[][] {
  const out: BookPage[][] = [];
  for (let i = 0; i < pages.length; i += PAGES_PER_SPREAD) out.push(pages.slice(i, i + PAGES_PER_SPREAD));
  return out;
}

export function spreadOfPage(index: number): number {
  return Math.floor(Math.max(0, index) / PAGES_PER_SPREAD);
}

/** The spread to open on: the latest cleared station, else the current station, else the first page. */
export function initialSpread(pages: readonly BookPage[], stamps: Record<number, StampEntry>, currentStation: number): number {
  const cleared = Object.keys(stamps)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1);
  const target = cleared.length > 0 ? Math.max(...cleared) : Math.max(1, Math.min(STATIONS.length, currentStation));
  const page = pages.find((p) => p.kind === 'station' && p.station.number === target);
  return spreadOfPage(page ? page.index : 0);
}

/** Store stamps → the book's input, skipping numbers off the road. */
export function bookStamps(stamps: Record<number, StampEntry>): BookStamp[] {
  const out: BookStamp[] = [];
  for (const [k, e] of Object.entries(stamps)) {
    const station = STATIONS.find((s) => s.number === Number(k));
    if (station && e) out.push({ station, at: e.at, perfect: e.perfect, assisted: e.assisted });
  }
  return out.sort((a, b) => a.station.number - b.station.number);
}

/** `tsuzuku-goshuin-cho-<layout>-<date>.png`, with `-<i>of<n>` for a set. */
export function bookFilename(layout: 'desktop' | 'phone', index: number, total: number, day: EpochDay): string {
  const base = filenameFor('goshuin-cho', layout, day);
  return total > 1 ? base.replace(/\.png$/, `-${index + 1}of${total}.png`) : base;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pages                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function StationPage(p: { page: Extract<BookPage, { kind: 'station' }> }): JSX.Element {
  const st = p.page.station;
  const stamp = p.page.stamp;
  return (
    <article class="goshuin-book__page" data-page={p.page.index} data-station={st.number} data-state={stamp ? 'cleared' : 'locked'}>
      <header class="goshuin-book__page-head">
        <span class="goshuin-book__ordinal" lang="ja">
          {fill(S.stationOrdinal, { n: kanjiNumber(st.number) })}
        </span>
        <h3 class="goshuin-book__name">
          <span lang="ja">{st.nameJa}</span>
          <span class="goshuin-book__romaji">
            {st.number} · {st.nameRomaji}
          </span>
        </h3>
      </header>
      {stamp ? (
        <GoshuinStamp station={st.number} at={stamp.at} perfect={stamp.perfect} assisted={stamp.assisted} size={200} caption />
      ) : (
        <div class="goshuin-book__blank" role="img" aria-label={`${st.nameJa} ${st.nameRomaji}: ${S.notCleared}`}>
          <span class="goshuin-book__blank-name" lang="ja" aria-hidden="true">
            {st.nameJa}
          </span>
          <span class="goshuin-book__blank-note" aria-hidden="true">
            {S.notCleared}
          </span>
        </div>
      )}
      <p class="goshuin-book__gate">
        {S.gateLabel}: <span lang="ja">{st.gateJa}</span> {st.gateEn}
      </p>
    </article>
  );
}

function BeltPage(p: { page: Extract<BookPage, { kind: 'belt' }> }): JSX.Element {
  const { belt, badge, passed, at } = p.page;
  const last = STATIONS.find((s) => s.number === belt.stations[1]);
  return (
    <article class="goshuin-book__page goshuin-book__page--belt" data-page={p.page.index} data-belt={belt.id} data-state={passed ? 'cleared' : 'locked'}>
      <header class="goshuin-book__page-head">
        <span class="goshuin-book__ordinal" lang="ja">
          {belt.nameJa}
        </span>
        <h3 class="goshuin-book__name">
          <span>{fill(S.beltPage, { belt: belt.nameEn })}</span>
          <span class="goshuin-book__romaji" lang="ja">
            {belt.titleJa}
          </span>
        </h3>
      </header>
      <MonCrest id={badge} earned={passed} earnedOn={at} size={128} caption={false} class="goshuin-book__crest" />
      <p class="goshuin-book__gate">
        {passed ? (
          at !== undefined ? (
            <time dateTime={isoDate(at)} lang="ja">
              {fill(S.beltPassedOn, { date: formatEraDate(at) })}
            </time>
          ) : (
            fill(S.beltPassedOn, { date: '' })
          )
        ) : (
          fill(S.beltWaits, { station: last ? `${last.nameJa} ${last.nameRomaji}` : '' })
        )}
      </p>
    </article>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Book                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export function GoshuinBook(p: GoshuinBookProps = {}): JSX.Element {
  const exporter = p.exporter ?? exportPng;
  const saver = p.saver ?? download;
  const collections = store.collections.value;
  const progress = store.progress.value;
  const pages = buildPages(collections.stamps, progress.shinsaPassed, collections.badges);
  const spreads = spreadsOf(pages);
  const [spread, setSpread] = useState(() => initialSpread(pages, collections.stamps, progress.station));
  const [busy, setBusy] = useState<'desktop' | 'phone' | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const touchX = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const last = spreads.length - 1;
  const go = (i: number): void => setSpread(Math.max(0, Math.min(last, i)));
  const cleared = bookStamps(collections.stamps).length;
  const current = spreads[Math.min(spread, last)] ?? [];
  const inSpread = new Set(current.map((pg) => pg.index));

  const onKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
        e.preventDefault();
        go(spread + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        go(spread - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(last);
        break;
      default:
        break;
    }
  };

  const onTouchStart = (e: TouchEvent): void => {
    touchX.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: TouchEvent): void => {
    const x0 = touchX.current;
    touchX.current = null;
    const x1 = e.changedTouches[0]?.clientX;
    if (x0 === null || x1 === undefined) return;
    const dx = x1 - x0;
    if (Math.abs(dx) < SWIPE_PX) return;
    go(dx < 0 ? spread + 1 : spread - 1);
  };

  const exportBook = async (layout: 'desktop' | 'phone'): Promise<void> => {
    if (busy) return;
    setBusy(layout);
    setProgressPct(0);
    setStatus(null);
    const today = store.today();
    try {
      const images = bookStripImages(bookStamps(collections.stamps), hashSeed(store.seed(), 'goshuin-book'), layout, { textInSvg: false });
      let saved = 0;
      let outcome: DownloadOutcome | null = null;
      for (let i = 0; i < images.length; i++) {
        const img = images[i]!;
        const blob = await exporter({
          svg: img.svg,
          texts: img.texts,
          width: img.w,
          height: img.h,
          onProgress: (q) => {
            if (alive.current) setProgressPct(Math.round(((i + q) / images.length) * 100));
          },
        });
        if (!blob) {
          if (alive.current) setStatus(S.exportUnavailable);
          return;
        }
        outcome = saver(blob, bookFilename(layout, i, images.length, today));
        if (outcome === 'unavailable') {
          if (alive.current) setStatus(S.exportUnavailable);
          return;
        }
        saved++;
      }
      if (alive.current) setStatus(outcome === 'opened' ? S.iosHint : fill(S.bookExported, { n: saved }));
    } catch (err) {
      console.warn('[collections] goshuin export failed', err);
      if (alive.current) setStatus(S.exportFailed);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <section class="goshuin-book" aria-label={S.bookLabel} data-spread={spread} data-spreads={spreads.length} data-cleared={cleared}>
      <p class="goshuin-book__lede">{fill(S.bookLede, { n: cleared, total: STATIONS.length })}</p>

      <div class="goshuin-book__nav">
        <button type="button" class="btn btn--ghost btn--sm" aria-label={S.prevSpread} disabled={spread <= 0} onClick={() => go(spread - 1)}>
          ←
        </button>
        <p class="goshuin-book__spread-label" aria-live="polite">
          {fill(S.spreadOf, { i: spread + 1, n: spreads.length })}
        </p>
        <button type="button" class="btn btn--ghost btn--sm" aria-label={S.nextSpread} disabled={spread >= last} onClick={() => go(spread + 1)}>
          →
        </button>
      </div>

      <div class="goshuin-book__spread" role="group" aria-label={fill(S.spreadOf, { i: spread + 1, n: spreads.length })} tabIndex={0} onKeyDown={onKey} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {current.map((pg) => (pg.kind === 'station' ? <StationPage key={pg.index} page={pg} /> : <BeltPage key={pg.index} page={pg} />))}
      </div>
      <p class="goshuin-book__hint">{S.swipeHint}</p>

      <ol class="goshuin-book__index" aria-label={S.pageIndexLabel}>
        {pages
          .filter((pg): pg is Extract<BookPage, { kind: 'station' }> => pg.kind === 'station')
          .map((pg) => (
            <li key={pg.index}>
              <button
                type="button"
                class="goshuin-book__tab"
                data-station={pg.station.number}
                data-state={pg.stamp ? 'cleared' : 'locked'}
                aria-label={fill(S.goToPage, { n: pg.station.number, name: `${pg.station.nameJa} ${pg.station.nameRomaji}` })}
                aria-current={inSpread.has(pg.index) ? 'page' : undefined}
                onClick={() => go(spreadOfPage(pg.index))}
              >
                {pg.station.number}
              </button>
            </li>
          ))}
      </ol>

      <div class="goshuin-book__export">
        <button type="button" class="btn" disabled={busy !== null} data-export="desktop" onClick={() => void exportBook('desktop')}>
          {S.exportDesktop}
        </button>
        <button type="button" class="btn" disabled={busy !== null} data-export="phone" onClick={() => void exportBook('phone')}>
          {fill(S.exportPhone, { n: PHONE_SET })}
        </button>
        {busy ? (
          <div class="progress goshuin-book__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} aria-label={fill(S.bookExporting, { p: progressPct })}>
            <div class="progress__fill" style={{ width: `${progressPct}%` }} />
          </div>
        ) : null}
        <p class="goshuin-book__status" role="status">
          {busy ? fill(S.bookExporting, { p: progressPct }) : (status ?? '')}
        </p>
      </div>
    </section>
  );
}
