/**
 * TSUZUKU — `<EndCard>`: the つづく card every session ends on (design 03 §10, §12; 01 §1, §5).
 *
 * Sumi background, brush つづく, the 1.2 s rising gliss (`sfx('tsuzuku')`,
 * silent in Zen), then in order: the tally (reps · accuracy · best combo ·
 * Ippon · promotions with belt flips · XP · quests ticked), the flame, what B
 * granted during the session (badges, stamps, belts, levels — the ceremonies
 * themselves are played by G's CeremonyHost after `session:finished`), the
 * 次回予告 (three informational lines, no countdowns), the Omikuji proverb, the
 * notes from Sensei (overtraining, cramming, backlog), the one-tap ledger
 * prompt (10 / 20 / 30 / 60 → `addLedgerEntry`), "Good training. Rest." and
 * the Hanko: "Another Kata?" only while reviews remain due, else "Rest."
 * Day one of a Welcome Back shows the preview only (design 03 §10).
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BadgeId, WallpaperId } from '../shared/catalog';
import { QUESTS } from '../shared/catalog';
import { sfx } from '../shared/audio';
import type { JikaiYokoku, SessionResult } from '../shared/session-types';
import type { LedgerKind, LedgerKindName } from '../shared/store-types';
import { LEDGER_KINDS } from '../shared/store-types';
import { BELT_LABEL } from '../shared/ui/strings';
import { Ruby } from '../shared/ui/Ruby';
import { BADGE_DEFS, WALLPAPER_DEFS, addLedgerEntry, store } from '../store';
import { dueCount, streakState, type FlameState } from '../store/derived';
import { BELT_NAME } from './engine-strings';
import { ledgerPromptDue, omikuji, type CeremonyEvent } from './end-card';
import { S, fill } from './strings';
import './EndCard.css';

export interface EndCardProps {
  result: SessionResult;
  /** `null` while the preview is still being read; the card renders the rest meanwhile. */
  yokoku: JikaiYokoku | null;
  /** Lines from `endCardNotes()` plus anything the page adds (Kage result, …). */
  notes: string[];
  onAnother(): void;
  onRest(): void;
  /** Additive: the runner's `ceremonies` (B's reward events during this session). */
  ceremonies?: readonly CeremonyEvent[];
}

export const LEDGER_MINUTES: readonly number[] = [10, 20, 30, 60];

const FLAME_LINE: Record<FlameState, string> = {
  lit: S.flameLit,
  gold: S.flameGold,
  ember: S.flameEmber,
  frozen: S.flameFrozen,
  rest: S.flameRest,
  broken: S.flameBroken,
};

const FLAME_GLYPH: Record<FlameState, string> = { lit: '火', gold: '炎', ember: '残', frozen: '氷', rest: '休', broken: '火' };

function badgeName(id: BadgeId): string {
  const d = BADGE_DEFS.find((b) => b.id === id);
  return d ? `${d.nameJa} ${d.nameEn}` : id;
}

function wallpaperName(id: WallpaperId): string {
  const d = WALLPAPER_DEFS.find((w) => w.id === id);
  return d ? `${d.nameJa} ${d.nameEn}` : id;
}

function questTitle(id: string): string {
  return QUESTS.find((q) => q.id === id)?.titleEn ?? id;
}

/** One line per reward event, in the order B granted them. */
export function ceremonyLines(events: readonly CeremonyEvent[]): { key: string; text: string; kind: CeremonyEvent['name'] }[] {
  const out: { key: string; text: string; kind: CeremonyEvent['name'] }[] = [];
  events.forEach((e, i) => {
    const key = `${e.name}-${i}`;
    switch (e.name) {
      case 'badge:earned':
        out.push({ key, kind: e.name, text: fill(S.earnedBadge, { id: badgeName(e.payload.id) }) });
        break;
      case 'wallpaper:unlocked':
        out.push({ key, kind: e.name, text: fill(S.earnedWallpaper, { id: wallpaperName(e.payload.id) }) });
        break;
      case 'wallpaper:revealed':
        out.push({ key, kind: e.name, text: fill(S.earnedQuadrant, { id: wallpaperName(e.payload.id), q: e.payload.quadrant }) });
        break;
      case 'stamp:earned':
        out.push({ key, kind: e.name, text: fill(S.earnedStamp, { n: e.payload.station }) });
        break;
      case 'belt:promoted':
        out.push({ key, kind: e.name, text: fill(S.earnedBelt, { belt: BELT_NAME[e.payload.belt] }) });
        break;
      case 'level:up':
        out.push({ key, kind: e.name, text: fill(S.earnedLevel, { n: e.payload.level }) });
        break;
      case 'quest:completed':
        // Quests ticked already appear in the tally.
        break;
    }
  });
  return out;
}

export function EndCard(p: EndCardProps): JSX.Element {
  const r = p.result;
  const t = r.tally;
  const zen = r.zen;
  const feel = store.settings.value.feel;
  const reduced = store.settings.value.reducedMotion;
  const today = store.today();
  const welcomeDayOne = r.mode === 'welcome';

  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    if (!zen) sfx('tsuzuku');
  }, [zen]);

  const flame = streakState();
  const due = dueCount();
  const earned = ceremonyLines(p.ceremonies ?? []);
  const proverb = omikuji(store.seed(), today);

  const [ledgerKind, setLedgerKind] = useState<LedgerKindName>('listen');
  const [ledger, setLedger] = useState<'prompt' | 'logged' | 'dismissed'>(() => (ledgerPromptDue(store.ledger.value, today) ? 'prompt' : 'dismissed'));

  const logMinutes = (minutes: number): void => {
    const kind = Math.max(0, LEDGER_KINDS.indexOf(ledgerKind)) as LedgerKind;
    addLedgerEntry({ day: today, minutes, kind, source: 1 });
    setLedger('logged');
  };

  const pct = Math.round(t.accuracy * 100);

  return (
    <section class={`end-card${reduced ? ' reduced-motion' : ''}`} data-feel={feel} data-mode={r.mode} aria-label={S.endCardAria}>
      <header class="end-card__brush">
        <h1 class="end-card__tsuzuku" lang="ja">
          {S.tsuzuku}
        </h1>
        <p class="end-card__sub">{S.toBeContinued}</p>
      </header>

      {welcomeDayOne ? (
        <p class="end-card__welcome">{S.welcomePreviewOnly}</p>
      ) : (
        <section class="end-card__tally status-window" aria-label={S.tallyTitle}>
          <h2 class="end-card__h">{S.tallyTitle}</h2>
          <dl class="end-card__stats">
            <div class="end-card__stat">
              <dt>{S.reps}</dt>
              <dd>{t.reps}</dd>
            </div>
            <div class="end-card__stat">
              <dt>{S.accuracy}</dt>
              <dd>{t.reps > 0 ? `${pct}%` : '—'}</dd>
            </div>
            {!zen ? (
              <div class="end-card__stat">
                <dt>{S.bestCombo}</dt>
                <dd>{t.bestCombo}</dd>
              </div>
            ) : null}
            {!zen ? (
              <div class="end-card__stat">
                <dt>
                  <span lang="ja">一本</span> {S.ippon}
                </dt>
                <dd>{t.ippon}</dd>
              </div>
            ) : null}
            <div class="end-card__stat end-card__stat--xp">
              <dt>{S.xp}</dt>
              <dd>+{t.xp}</dd>
            </div>
            <div class="end-card__stat">
              <dt>{S.minutes}</dt>
              <dd>{t.minutes}</dd>
            </div>
          </dl>

          {t.promotions.length > 0 ? (
            <div class="end-card__promotions">
              <h3 class="end-card__h3">{S.promotionsTitle}</h3>
              <ul class="end-card__list">
                {t.promotions.map((pr, i) => (
                  <li key={`${pr.itemId}-${i}`} class="end-card__promotion">
                    <span class="belt-flip end-card__belt" data-belt={pr.to} aria-hidden="true">
                      <span lang="ja">{BELT_LABEL[pr.to].ja}</span>
                    </span>
                    <span class="end-card__item">{pr.itemId}</span>
                    <span class="end-card__to">{fill(S.promotedTo, { belt: BELT_LABEL[pr.to].en })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {t.questsDone.length > 0 ? (
            <div class="end-card__quests">
              <h3 class="end-card__h3">{S.questsTitle}</h3>
              <ul class="end-card__list">
                {t.questsDone.map((id) => (
                  <li key={id} class="end-card__quest">
                    <span class="end-card__tick" aria-hidden="true">
                      ✓
                    </span>{' '}
                    {questTitle(id)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      <p class="end-card__flame" data-state={flame} aria-label={S.flameTitle}>
        <span class="end-card__flame-glyph" lang="ja" aria-hidden="true">
          {FLAME_GLYPH[flame]}
        </span>{' '}
        {FLAME_LINE[flame]}
      </p>

      {earned.length > 0 ? (
        <section class="end-card__earned" aria-label={S.earnedTitle}>
          <h2 class="end-card__h">{S.earnedTitle}</h2>
          <ul class="end-card__list">
            {earned.map((e) => (
              <li key={e.key} class="end-card__earned-row" data-kind={e.kind}>
                {e.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section class="end-card__yokoku" aria-label={S.yokokuSub}>
        <h2 class="end-card__h">
          <span lang="ja">{S.yokokuTitle}</span> <span class="muted">{S.yokokuSub}</span>
        </h2>
        {p.yokoku ? (
          <ol class="end-card__yokoku-lines">
            {p.yokoku.sentence ? (
              <li class="end-card__yokoku-line">
                <span class="end-card__yokoku-label">{S.yokokuSentence}</span>
                <span class="end-card__yokoku-ja">
                  <Ruby ja={p.yokoku.sentence.ja} mode="always" />
                </span>
              </li>
            ) : null}
            {p.yokoku.words.length > 0 ? (
              <li class="end-card__yokoku-line">
                <span class="end-card__yokoku-label">{S.yokokuWords}</span>
                <span class="end-card__yokoku-words" lang="ja">
                  {p.yokoku.words.map((w) => (
                    <span key={w.itemId} class="chip end-card__word">
                      {w.kana}
                    </span>
                  ))}
                </span>
              </li>
            ) : null}
            <li class="end-card__yokoku-line end-card__milestone">{p.yokoku.milestone || S.yokokuQuiet}</li>
          </ol>
        ) : (
          <p class="end-card__loading muted" role="status">
            {S.endCardLoading}
          </p>
        )}
      </section>

      <p class="end-card__omikuji">
        <span class="end-card__omikuji-label">{S.omikujiLabel}</span>
        <span class="end-card__omikuji-text" lang="ja">
          {proverb}
        </span>
      </p>

      {p.notes.length > 0 ? (
        <ul class="end-card__notes" aria-label={S.notesAria}>
          {p.notes.map((n, i) => (
            <li key={i} class="end-card__note">
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      {ledger !== 'dismissed' ? (
        <section class="end-card__ledger status-window" aria-label={S.ledgerAria}>
          {ledger === 'logged' ? (
            <p class="end-card__ledger-done" role="status">
              {S.ledgerLogged}
            </p>
          ) : (
            <>
              <p class="end-card__ledger-prompt">{S.ledgerPrompt}</p>
              <div class="end-card__ledger-row">
                <label class="end-card__ledger-kind">
                  <span class="sr-only">{S.ledgerKindAria}</span>
                  <select class="select" value={ledgerKind} onChange={(e) => setLedgerKind((e.currentTarget as HTMLSelectElement).value as LedgerKindName)}>
                    {LEDGER_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {S.ledgerKind[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <div class="end-card__ledger-minutes" role="group" aria-label={S.ledgerAria}>
                  {LEDGER_MINUTES.map((m) => (
                    <button key={m} type="button" class="btn end-card__ledger-btn" data-minutes={m} onClick={() => logMinutes(m)}>
                      {fill(S.ledgerMinutes, { n: m })}
                    </button>
                  ))}
                </div>
                <button type="button" class="btn btn--ghost btn--sm end-card__ledger-dismiss" onClick={() => setLedger('dismissed')}>
                  {S.ledgerDismiss}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <footer class="end-card__foot">
        <p class="end-card__closing">{S.closingLine}</p>
        {due > 0 ? <p class="end-card__due muted">{due === 1 ? S.dueRemainingOne : fill(S.dueRemaining, { n: due })}</p> : null}
        <div class="end-card__actions">
          {due > 0 ? (
            <button type="button" class="hanko end-card__another" onClick={() => p.onAnother()}>
              {S.anotherKata}
            </button>
          ) : null}
          <button type="button" class={due > 0 ? 'btn end-card__rest' : 'hanko end-card__rest'} onClick={() => p.onRest()}>
            {S.restButton}
          </button>
        </div>
      </footer>
    </section>
  );
}
