/**
 * TSUZUKU — 設定 Settings (group A, design 01 §6, 03 §4/§7, 06 §7 #10).
 *
 * Every field of `Settings`, grouped: study (pace / custom rates / cap /
 * retention / grading toggles), display (theme, feel, furigana, vertical,
 * motion, CRT), audio (voices from `services.audio.voices()`, speed tier,
 * volume, speaking mode with the network notice), reminders and rest (rest
 * day, neutral `.ics`), privacy and data (storage meter, slot, backup and
 * the dojo's rules) and the danger zone (reset after typing つづく). Every
 * change is `store.patch` immediately; Intense asks first (03 §4).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { CardKey } from '@/content/types';
import { services, speak, type VoiceInfo } from '@/shared/audio';
import { equivalentJa } from '@/shared/jp';
import { href, navigate, type Route } from '@/shared/routes';
import { SLICE_KEYS, type Feel, type FuriganaMode, type Intensity, type Retention, type Settings, type SpeakingMode, type SpeedTier, type Theme } from '@/shared/store-types';
import { KanaInput } from '@/shared/ui/KanaInput';
import { CEILING_BYTES, INTENSITY_PRESETS, currentSlot, freshSave, newPerDayFor, store } from '@/store';
import { currentBelt } from '@/store/derived';
import { ICS_FILENAME, buildIcs, downloadIcs } from '../ics';
import { steadyReviewsInAYear } from './OnboardingPage';
import { S, WEEKDAYS, fmt, num } from './strings';
import './pages.css';

export interface SettingsPageProps {
  route: Route;
  /** Download hook for the reminder file (tests inject a spy); defaults to `downloadIcs`. */
  download?: (text: string, filename: string) => boolean;
}

type Preset = Exclude<Intensity, 'custom'>;
const PRESETS: readonly Preset[] = ['casual', 'standard', 'intense'];
const PRESET_LABEL: Record<Intensity, string> = { casual: S.setPaceCasual, standard: S.setPaceStandard, intense: S.setPaceIntense, custom: S.setCustom };
const FEELS: readonly { id: Feel; name: string; ja: string; desc: string }[] = [
  { id: 'zen', name: S.setFeelZen, ja: S.setFeelZenJa, desc: S.setFeelZenDesc },
  { id: 'dojo', name: S.setFeelDojo, ja: S.setFeelDojoJa, desc: S.setFeelDojoDesc },
  { id: 'arcade', name: S.setFeelArcade, ja: S.setFeelArcadeJa, desc: S.setFeelArcadeDesc },
];
const THEMES: readonly { id: Theme; name: string }[] = [
  { id: 'auto', name: S.setThemeAuto },
  { id: 'light', name: S.setThemeLight },
  { id: 'dark', name: S.setThemeDark },
];
const FURIGANA: readonly { id: FuriganaMode; name: string }[] = [
  { id: 'always', name: S.setFuriganaAlways },
  { id: 'fog', name: S.setFuriganaFog },
  { id: 'tap', name: S.setFuriganaTap },
  { id: 'off', name: S.setFuriganaOff },
];
const SPEAKING: readonly { id: SpeakingMode; name: string }[] = [
  { id: 'self', name: S.setSpeakingSelf },
  { id: 'recognition', name: S.setSpeakingRecognition },
  { id: 'off', name: S.setSpeakingOff },
];
const RETENTIONS: readonly Retention[] = [0.85, 0.9, 0.95];
const TIERS: readonly SpeedTier[] = [1, 2, 3, 4, 5];
const RESET_WORD = 'つづく';
const HELLO = 'こんにちは';
const DEFAULT_REMINDER = '19:00';

/* ────────────────────────────────────────────────────────────────────────── */
/* Store writers (exported for tests)                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export function patchSettings(fn: (s: Settings) => Settings): void {
  store.patch('settings', fn);
}

export function setField<K extends keyof Settings>(key: K, value: Settings[K]): void {
  patchSettings((s) => (Object.is(s[key], value) ? s : { ...s, [key]: value }));
}

/** Apply a named preset: rates for the current belt, cap and retention (design 03 §4). */
export function applyPreset(preset: Preset): void {
  const p = INTENSITY_PRESETS[preset];
  const belt = currentBelt();
  patchSettings((s) => ({ ...s, intensity: preset, newPerDay: newPerDayFor(belt, preset), maxReviews: p.maxReviews, retention: p.retention }));
}

/** Feel change: speed grading defaults off in Zen, on otherwise (ARCHITECTURE §1). */
export function applyFeel(feel: Feel): void {
  patchSettings((s) => (s.feel === feel ? s : { ...s, feel, speedGrading: feel !== 'zen' }));
}

/** Replace this browser's save with a fresh one: slices, cards, session. The log ring is left to the store. */
export function resetSave(): void {
  const fresh = freshSave(store.now(), store.profile.value.tz);
  for (const k of SLICE_KEYS) store.patch(k, () => fresh[k] as never);
  const keys: CardKey[] = [];
  store.cards.forEach((k) => keys.push(k));
  for (const k of keys) store.cards.delete(k);
  store.session.clear();
  void store.flush();
}

export function japaneseVoices(voices: readonly VoiceInfo[]): VoiceInfo[] {
  return voices.filter((v) => /^ja\b/i.test(v.lang));
}

export function parseTime(v: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return { hour: 19, minute: 0 };
  return { hour: Math.min(23, Math.max(0, Number(m[1]))), minute: Math.min(59, Math.max(0, Number(m[2]))) };
}

export function kbOf(bytes: number): number {
  return Math.round(bytes / 1024);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Small controls                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function Radios<T extends string>(p: { name: string; value: T; options: readonly { id: T; name: string; ja?: string }[]; onChange(v: T): void; label: string }): JSX.Element {
  return (
    <div class="set__radios" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <label key={o.id} class="set__radio">
          <input type="radio" name={p.name} value={o.id} checked={p.value === o.id} onChange={() => p.onChange(o.id)} data-setting={p.name} />
          <span>{o.name}</span>
          {o.ja ? (
            <span class="set__radio-ja" lang="ja">
              {o.ja}
            </span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

function Switch(p: { id: keyof Settings; checked: boolean; label: string; hint?: string; disabled?: boolean; onChange(v: boolean): void }): JSX.Element {
  return (
    <label class="set__switch">
      <input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onChange(e.currentTarget.checked)} data-setting={p.id} />
      <span class="set__switch-text">
        <span>{p.label}</span>
        {p.hint ? <span class="field__hint">{p.hint}</span> : null}
      </span>
    </label>
  );
}

function Confirm(p: { text: string; yes: string; no: string; onYes(): void; onNo(): void; testId: string }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') p.onNo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p]);
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label={p.text} data-confirm={p.testId}>
      <div class="modal__card">
        <p class="page__modal-text">{p.text}</p>
        <div class="modal__actions page__actions">
          <button type="button" class="hanko" onClick={p.onYes} data-confirm-yes>
            {p.yes}
          </button>
          <button type="button" class="btn btn--ghost" onClick={p.onNo} data-confirm-no>
            {p.no}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function SettingsPage(p: SettingsPageProps): JSX.Element {
  const s = store.settings.value;
  const profile = store.profile.value;
  const storage = store.storage.value;
  const [intenseAsk, setIntenseAsk] = useState(false);
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER);
  const [icsStatus, setIcsStatus] = useState<'idle' | 'saved' | 'fallback'>('idle');
  const [icsText, setIcsText] = useState('');
  const [resetTyped, setResetTyped] = useState('');
  const [resetAsk, setResetAsk] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const voices = useMemo(() => japaneseVoices(services.audio.voices()), []);
  const hasJaVoice = services.audio.hasJaVoice.value;
  const download = p.download ?? downloadIcs;

  const choosePace = (v: Intensity): void => {
    if (v === 'intense') {
      setIntenseAsk(true);
      return;
    }
    if (v === 'custom') setField('intensity', 'custom');
    else applyPreset(v);
  };

  const numberField = (key: 'vocab' | 'kanji' | 'grammar', e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const n = Number(e.currentTarget.value);
    if (!Number.isFinite(n) || n < 0) return;
    patchSettings((st) => ({ ...st, intensity: 'custom', newPerDay: { ...st.newPerDay, [key]: Math.round(n * 100) / 100 } }));
  };

  const makeIcs = (): void => {
    const { hour, minute } = parseTime(reminderTime);
    const text = buildIcs({ hour, minute, tz: profile.tz, startDay: store.today(), stampMs: store.now() });
    if (download(text, ICS_FILENAME)) {
      setIcsStatus('saved');
      setIcsText('');
    } else {
      setIcsStatus('fallback');
      setIcsText(text);
    }
  };

  const resetReady = equivalentJa(resetTyped.trim(), RESET_WORD);
  const doReset = (): void => {
    setResetAsk(false);
    resetSave();
    setResetDone(true);
    setResetTyped('');
    navigate({ name: 'onboarding' }, { replace: true });
  };

  const level = storage.level;
  const ratio = Math.min(1, storage.bytes / CEILING_BYTES);
  const levelText = level === 'ceiling' ? S.setStorageLevelCeiling : level === 'warn' ? S.setStorageLevelWarn : S.setStorageLevelOk;

  return (
    <div class="page settings">
      <h1 class="page__title">
        <span class="page__title-ja brush" lang="ja">
          {S.setTitleJa}
        </span>
        <span>{S.setTitle}</span>
      </h1>

      {/* ── Study ─────────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-study">
        <h2 id="set-study">{S.setStudy}</h2>
        <div class="field">
          <span class="field__label">{S.setIntensity}</span>
          <Radios
            name="intensity"
            label={S.setIntensity}
            value={s.intensity}
            options={[...PRESETS.map((id) => ({ id, name: PRESET_LABEL[id] })), { id: 'custom' as Intensity, name: S.setCustom }]}
            onChange={choosePace}
          />
          <span class="field__hint">{s.intensity === 'custom' ? S.setCustomHint : S.setMaxReviewsHint}</span>
        </div>
        {intenseAsk ? (
          <Confirm
            text={fmt(S.onbPaceIntenseWarn, { n: num(steadyReviewsInAYear('intense')) })}
            yes={S.onbPaceIntenseYes}
            no={S.cancel}
            testId="intense"
            onYes={() => {
              applyPreset('intense');
              setIntenseAsk(false);
            }}
            onNo={() => setIntenseAsk(false)}
          />
        ) : null}
        <div class="set__grid set__grid--2">
          <fieldset class="field" data-custom-rates>
            <legend class="field__label">{S.setNewPerDay}</legend>
            <label class="field">
              <span class="field__hint">{S.setNewVocab}</span>
              <input class="input" type="number" min="0" step="0.25" value={s.newPerDay.vocab} onChange={(e) => numberField('vocab', e)} data-setting="newPerDay.vocab" />
            </label>
            <label class="field">
              <span class="field__hint">{S.setNewKanji}</span>
              <input class="input" type="number" min="0" step="0.25" value={s.newPerDay.kanji} onChange={(e) => numberField('kanji', e)} data-setting="newPerDay.kanji" />
            </label>
            <label class="field">
              <span class="field__hint">{S.setNewGrammar}</span>
              <input class="input" type="number" min="0" step="0.25" value={s.newPerDay.grammar} onChange={(e) => numberField('grammar', e)} data-setting="newPerDay.grammar" />
            </label>
          </fieldset>
          <div class="field">
            <label class="field">
              <span class="field__label">{S.setMaxReviews}</span>
              <input
                class="input"
                type="number"
                min="10"
                step="10"
                value={s.maxReviews}
                onChange={(e) => {
                  const n = Math.round(Number(e.currentTarget.value));
                  if (Number.isFinite(n) && n >= 10) patchSettings((st) => ({ ...st, intensity: 'custom', maxReviews: n }));
                }}
                data-setting="maxReviews"
              />
              <span class="field__hint">{S.setMaxReviewsHint}</span>
            </label>
            <label class="field">
              <span class="field__label">{S.setRetention}</span>
              <select class="select" value={String(s.retention)} onChange={(e) => setField('retention', Number(e.currentTarget.value) as Retention)} data-setting="retention">
                {RETENTIONS.map((r) => (
                  <option key={r} value={String(r)}>
                    {fmt(S.percent, { n: Math.round(r * 100) })}
                  </option>
                ))}
              </select>
              <span class="field__hint">{S.setRetentionHint}</span>
            </label>
          </div>
        </div>
        <div class="set__switches">
          <Switch id="classicGrading" checked={s.classicGrading} label={S.setClassicGrading} hint={S.setClassicHint} onChange={(v) => setField('classicGrading', v)} />
          <Switch id="speedGrading" checked={s.speedGrading} label={S.setSpeedGrading} hint={S.setSpeedGradingHint} onChange={(v) => setField('speedGrading', v)} />
          <Switch id="jj" checked={s.jj} label={S.setJj} hint={S.setJjHint} onChange={(v) => setField('jj', v)} />
          <Switch id="writing" checked={s.writing} label={S.setWriting} hint={S.setWritingHint} onChange={(v) => setField('writing', v)} />
        </div>
      </section>

      {/* ── Display ───────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-display">
        <h2 id="set-display">{S.setDisplay}</h2>
        <div class="field">
          <span class="field__label">{S.setTheme}</span>
          <Radios name="theme" label={S.setTheme} value={s.theme} options={THEMES} onChange={(v) => setField('theme', v)} />
        </div>
        <div class="field">
          <span class="field__label">{S.setFeel}</span>
          <Radios name="feel" label={S.setFeel} value={s.feel} options={FEELS} onChange={applyFeel} />
          <span class="field__hint">{FEELS.find((f) => f.id === s.feel)?.desc}</span>
        </div>
        <label class="field">
          <span class="field__label">{S.setFurigana}</span>
          <select class="select" value={s.furigana} onChange={(e) => setField('furigana', e.currentTarget.value as FuriganaMode)} data-setting="furigana">
            {FURIGANA.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div class="set__switches">
          <Switch id="verticalText" checked={s.verticalText} label={S.setVerticalText} hint={S.setVerticalHint} onChange={(v) => setField('verticalText', v)} />
          <Switch id="reducedMotion" checked={s.reducedMotion} label={S.setReducedMotion} onChange={(v) => setField('reducedMotion', v)} />
          <Switch id="crt" checked={s.crt} disabled={s.feel !== 'arcade'} label={S.setCrt} hint={S.setCrtHint} onChange={(v) => setField('crt', v)} />
        </div>
      </section>

      {/* ── Audio ─────────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-audio">
        <h2 id="set-audio">{S.setAudio}</h2>
        <div class="set__grid set__grid--2">
          <label class="field">
            <span class="field__label">{S.setVoice}</span>
            <select class="select" value={s.ttsVoiceURI ?? ''} onChange={(e) => setField('ttsVoiceURI', e.currentTarget.value || undefined)} data-setting="ttsVoiceURI">
              <option value="">{voices.length === 0 && !hasJaVoice ? S.setVoiceNone : S.setVoiceDefault}</option>
              {voices.map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name} · {v.network ? S.setVoiceNetwork : S.setVoiceLocal}
                </option>
              ))}
            </select>
            <span class="field__hint">{S.setVoiceHint}</span>
          </label>
          <label class="field">
            <span class="field__label">{S.setVoice2}</span>
            <select class="select" value={s.ttsVoiceURI2 ?? ''} onChange={(e) => setField('ttsVoiceURI2', e.currentTarget.value || undefined)} data-setting="ttsVoiceURI2">
              <option value="">{S.setVoiceDefault}</option>
              {voices.map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name} · {v.network ? S.setVoiceNetwork : S.setVoiceLocal}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="page__actions">
          <button type="button" class="btn" onClick={() => void speak(HELLO, { kana: HELLO, voiceURI: s.ttsVoiceURI })} data-voice-test>
            {S.setVoiceTest}
            {S.separator}
            <span lang="ja">{HELLO}</span>
          </button>
        </div>
        <label class="field">
          <span class="field__label">{S.setSpeedTier}</span>
          <select class="select" value={String(s.speedTier)} onChange={(e) => setField('speedTier', Number(e.currentTarget.value) as SpeedTier)} data-setting="speedTier">
            {TIERS.map((t) => (
              <option key={t} value={String(t)}>
                {t}
                {S.separator}
                {fmt(S.setSpeedTierHint, { rate: services.audio.rateForTier(t) })}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="field__label">{S.setSound}</span>
          <span class="set__range">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(s.sound * 100)}
              onInput={(e) => {
                const v = Math.min(1, Math.max(0, Number(e.currentTarget.value) / 100));
                setField('sound', v);
                services.audio.setVolume(v);
              }}
              aria-label={S.setSound}
              data-setting="sound"
            />
            <span class="set__range-value pixel">{fmt(S.percent, { n: Math.round(s.sound * 100) })}</span>
          </span>
          <span class="field__hint">{S.setSoundHint}</span>
        </label>
        <div class="field">
          <span class="field__label">{S.setSpeaking}</span>
          <Radios name="speaking" label={S.setSpeaking} value={s.speaking} options={SPEAKING} onChange={(v) => setField('speaking', v)} />
          <span class="field__hint">{S.setSpeakingNetwork}</span>
        </div>
      </section>

      {/* ── Reminders and rest ────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-reminders">
        <h2 id="set-reminders">{S.setReminders}</h2>
        <label class="field">
          <span class="field__label">{S.setRestDay}</span>
          <select class="select" value={s.restDay === null ? '' : String(s.restDay)} onChange={(e) => setField('restDay', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} data-setting="restDay">
            <option value="">{S.setRestDayNone}</option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={String(i)}>
                {d}
              </option>
            ))}
          </select>
          <span class="field__hint">{S.setRestDayHint}</span>
        </label>
        <div class="field">
          <span class="field__label">{S.setReminder}</span>
          <span class="field__hint">{S.setReminderHint}</span>
          <div class="page__actions">
            <label class="field">
              <span class="visually-hidden">{S.setReminderTime}</span>
              <input class="input" type="time" value={reminderTime} onInput={(e) => setReminderTime(e.currentTarget.value)} aria-label={S.setReminderTime} data-reminder-time />
            </label>
            <button type="button" class="btn" onClick={makeIcs} data-ics-download>
              {S.setReminderDownload}
            </button>
          </div>
          <p class="page__status" role="status">
            {icsStatus === 'saved' ? S.setReminderDownloaded : icsStatus === 'fallback' ? S.setReminderFailed : ''}
          </p>
          {icsStatus === 'fallback' ? <pre class="set__ics" data-ics-text>{icsText}</pre> : null}
        </div>
      </section>

      {/* ── Privacy and data ──────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-privacy">
        <h2 id="set-privacy">{S.setPrivacy}</h2>
        <div class="set__meter" data-level={level} data-storage>
          <span class="field__label">{S.setStorage}</span>
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={S.setStorage}>
            <div class="progress__fill" style={{ width: `${Math.max(1, ratio * 100)}%` }} />
          </div>
          <span class="muted" data-storage-text>
            {fmt(S.setStorageOf, { kb: num(kbOf(storage.bytes)), mb: (CEILING_BYTES / (1024 * 1024)).toFixed(1) })}
            {S.separator}
            {levelText}
          </span>
          <span class="field__hint">{S.setStorageHint}</span>
        </div>
        <div class="field">
          <span class="field__label">{S.setSlot}</span>
          <span data-slot>{fmt(S.setSlotCurrent, { n: currentSlot() })}</span>
          <span class="field__hint">
            {S.setSlotHint} {S.setSlotNote}
          </span>
        </div>
        <p class="muted">{S.onbPrivacy}</p>
        <div class="page__actions">
          <a class="btn" href={href({ name: 'backup' })}>
            {S.setBackup}
          </a>
          <a class="btn btn--ghost" href={href({ name: 'about' })}>
            {S.setRules}
            <span lang="ja"> {S.setRulesJa}</span>
          </a>
          <a class="btn btn--ghost" href={href({ name: 'about' })}>
            {S.setAbout}
          </a>
        </div>
      </section>

      {/* ── Danger zone ───────────────────────────────────────────────── */}
      <section class="panel page__section set__danger" aria-labelledby="set-danger">
        <h2 id="set-danger">{S.setDanger}</h2>
        <h3>{S.setResetTitle}</h3>
        <p>{S.setResetBody}</p>
        <label class="field">
          <span class="field__label">{S.setResetType}</span>
          <KanaInput value={resetTyped} onChange={setResetTyped} onSubmit={() => resetReady && setResetAsk(true)} label={S.setResetType} />
          {resetTyped.length > 0 && !resetReady ? <span class="field__hint">{S.setResetMismatch}</span> : null}
        </label>
        <div class="page__actions">
          <button type="button" class="btn btn--danger" disabled={!resetReady} onClick={() => setResetAsk(true)} data-reset>
            {S.setResetButton}
          </button>
          <span class="page__status" role="status">
            {resetDone ? S.setResetDone : ''}
          </span>
        </div>
        {resetAsk ? <Confirm text={S.setResetBody} yes={S.setResetButton} no={S.cancel} testId="reset" onYes={doReset} onNo={() => setResetAsk(false)} /> : null}
      </section>
    </div>
  );
}
