/**
 * TSUZUKU — `#/taiwa/:id` standalone Taiwa role-play page (design 04 §8, 07 §1).
 *
 * Wraps <RolePlay> with the mode the learner's station and device call for
 * (`modeFor`, design 04 §8 / §13):
 *   station < 10        choose   (Yellow: the line's 3–4 options)
 *   station 10–15       type     with a keyboard; build on a touch device
 *   station ≥ 16        speak    when recognition is available and allowed
 *                                (`settings.speaking` recognition / auto),
 *                       else type (build on touch through Green, ≤ 24)
 * When the conversation ends the page logs the speaking minutes to the
 * ledger (kind `speak`, source `app`; rounded, at least one minute for a
 * finished conversation) — `roleplay:done` carries no minutes, so unlike the
 * listening set nobody else logs them.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { ContentLoader } from '@/content/loader';
import { services } from '@/shared/audio';
import { stationOfId } from '@/shared/ids';
import { href, type Route } from '@/shared/routes';
import type { SpeakingMode } from '@/shared/store-types';
import { KIND_INDEX, addLedgerEntry, store } from '@/store';
import { RolePlay, type RolePlayResult, type TaiwaMode } from '../taiwa/RolePlay';
import { MODE_LABEL, S, fill } from '../taiwa/strings';
import './TaiwaPage.css';

/** Type mode (with recasts) from Station 10 (design 04 §13). */
export const TYPE_FROM_STATION = 10;
/** Speak mode from Green, Station 16; Choose retires there (design 04 §13). */
export const SPEAK_FROM_STATION = 16;
/** Build stays an option on touch devices through Green (Orange–Green, design 04 §8). */
export const BUILD_THROUGH_STATION = 24;

export interface ModeInputs {
  station: number;
  /** `services.stt.available`. */
  sttAvailable: boolean;
  /** `settings.speaking`: recognition is used only for `recognition` / `auto`. */
  speaking: SpeakingMode;
  /** `(pointer: coarse)`: a touch device without a hardware keyboard. */
  coarsePointer: boolean;
}

/** The role-play mode for a station and device (pure; the table is in the header). */
export function modeFor(i: ModeInputs): TaiwaMode {
  if (i.station >= SPEAK_FROM_STATION) {
    if (i.sttAvailable && (i.speaking === 'recognition' || i.speaking === 'auto')) return 'speak';
    return i.coarsePointer && i.station <= BUILD_THROUGH_STATION ? 'build' : 'type';
  }
  if (i.station >= TYPE_FROM_STATION) return i.coarsePointer ? 'build' : 'type';
  return 'choose';
}

/** `(pointer: coarse)` when the browser can answer, else false. */
export function coarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** The `taiwa` route's id, or `''` for any other route (RolePlay then shows its not-found state). */
export function taiwaIdOf(r: Route): string {
  return r.name === 'taiwa' ? r.id : '';
}

/** Minutes to log for a finished conversation: rounded elapsed time, at least one. */
export function conversationMinutes(ms: number): number {
  return Math.max(1, Math.round(Math.max(0, ms) / 60000));
}

export interface TaiwaPageProps {
  route: Route;
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'get' | 'getAsync'>;
}

export default function TaiwaPage(p: TaiwaPageProps): JSX.Element {
  const id = taiwaIdOf(p.route);
  const station = id ? stationOfId(id) : undefined;
  const settings = store.settings.value;
  const mode = modeFor({
    station: store.progress.value.station,
    sttAvailable: services.stt.available,
    speaking: settings.speaking,
    coarsePointer: coarsePointer(),
  });
  const [result, setResult] = useState<RolePlayResult | null>(null);
  const [logged, setLogged] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  const startedAt = useRef(store.now());

  const onDone = (r: RolePlayResult): void => {
    const minutes = r.total > 0 ? conversationMinutes(store.now() - startedAt.current) : 0;
    if (minutes > 0) {
      addLedgerEntry({ day: store.today(), minutes, kind: KIND_INDEX.speak, source: 0 });
      setLogged(minutes);
    }
    setResult(r);
  };

  const again = (): void => {
    setResult(null);
    setLogged(null);
    startedAt.current = store.now();
    setRun((n) => n + 1);
  };

  return (
    <section class="taiwa-page" aria-label={S.title}>
      <nav class="taiwa-page__nav" aria-label={S.pageNav}>
        <a class="btn btn--ghost btn--sm" href={href({ name: 'dojo' })}>
          {S.pageBack}
        </a>
        {station !== undefined ? (
          <a class="btn btn--ghost btn--sm" href={href({ name: 'station', n: station })}>
            {fill(S.pageStation, { n: station })}
          </a>
        ) : null}
        <span class="taiwa-page__mode">{fill(S.pageModeNote, { mode: MODE_LABEL[mode] })}</span>
      </nav>

      <RolePlay key={`${id}:${run}`} storyId={id} mode={mode} onDone={onDone} loader={p.loader} />

      {result ? (
        <nav class="taiwa-page__after" aria-label={S.pageNext}>
          {logged !== null ? (
            <p class="taiwa-page__logged" role="status">
              {fill(S.pageLogged, { n: logged })}
            </p>
          ) : null}
          <button type="button" class="btn" onClick={again}>
            {S.pageAgain}
          </button>
          <a class="btn" href={href({ name: 'listen', id })}>
            {S.pageListen}
          </a>
          <a class="btn" href={href({ name: 'story', id })}>
            {S.pageRead}
          </a>
          <a class="hanko" href={href({ name: 'dojo' })}>
            {S.pageBack}
          </a>
        </nav>
      ) : (
        <p class="taiwa-page__note">{S.pageLedger}</p>
      )}
    </section>
  );
}
