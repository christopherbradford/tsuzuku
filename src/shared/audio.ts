/**
 * TSUZUKU — audio / speech service slot (ARCHITECTURE §3, design 07 §7).
 *
 * Interfaces plus the silent `nullAudio` / `nullStt`. Group F installs the
 * real implementations with `installServices()`; everyone else calls
 * `services.audio.speak(...)` (or the `speak` helper) and never touches
 * `speechSynthesis` directly.
 *
 * `speak(text, {kana?})` takes the PLAIN surface (`toPlain(ja)`) for sentences
 * and kana only for kana items. It resolves on `onend`, `onerror` or a timeout
 * of the estimated duration + 2 s, so an awaited `speak()` can never hang.
 */
import { signal, type Signal } from '@preact/signals';
import type { SfxName } from './catalog';

export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
  /** Sends text to the vendor's servers (marked in the picker, design 06 §7 #10). */
  network: boolean;
}

export type SpeedTier = 1 | 2 | 3 | 4 | 5;

/** Speed-tier presets (design 07 §7); Shinsa uses these only. */
export const SPEED_TIER_RATES: Record<SpeedTier, number> = { 1: 0.75, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.25 };
/** Dan-road listening rate. */
export const DAN_RATE = 1.5;

export interface SpeakOptions {
  /** Kana reading; used when the voice would misread the plain surface. */
  kana?: string;
  /** Playback rate (default: the current speed tier's preset). */
  rate?: number;
  /** Dialogue voice slot. */
  voice?: 'a' | 'b';
  /** Explicit voice override. */
  voiceURI?: string;
  /** Cancel anything queued first (default true). */
  interrupt?: boolean;
}

export interface AudioService {
  speak(text: string, o?: SpeakOptions): Promise<void>;
  cancel(): void;
  /** Warm-up utterance on first gesture (Chrome first-utterance delay). */
  warmUp(): void;
  sfx(name: SfxName): void;
  /** 0–1. */
  setVolume(v: number): void;
  muted: Signal<boolean>;
  hasJaVoice: Signal<boolean>;
  voices(): VoiceInfo[];
  rateForTier(t: SpeedTier): number;
}

export interface SttResult {
  /** Up to 5 alternatives, kanji-kana mixed as the recognizer emits them. */
  alternatives: string[];
}

export interface SttService {
  available: boolean;
  /** `continuous` restarts on `onend` until `maxMs` (Monologue). `null` = nothing heard / aborted. */
  recognize(o: { maxMs: number; continuous?: boolean }): Promise<SttResult | null>;
  abort(): void;
}

export const nullAudio: AudioService = {
  speak: () => Promise.resolve(),
  cancel() {},
  warmUp() {},
  sfx() {},
  setVolume() {},
  muted: signal(false),
  hasJaVoice: signal(false),
  voices: () => [],
  rateForTier: (t) => SPEED_TIER_RATES[t],
};

export const nullStt: SttService = {
  available: false,
  recognize: () => Promise.resolve(null),
  abort() {},
};

export interface Services {
  audio: AudioService;
  stt: SttService;
}

/** The live slot. Properties are swapped in place so earlier importers see the change. */
export const services: Services = { audio: nullAudio, stt: nullStt };

export function installServices(p: Partial<Services>): void {
  if (p.audio) services.audio = p.audio;
  if (p.stt) services.stt = p.stt;
}

/** Tests: back to silence. */
export function resetServices(): void {
  services.audio = nullAudio;
  services.stt = nullStt;
}

/** `services.audio.speak` through the slot. */
export function speak(text: string, o?: SpeakOptions): Promise<void> {
  return services.audio.speak(text, o);
}

/** `services.audio.sfx` through the slot. */
export function sfx(name: SfxName): void {
  services.audio.sfx(name);
}
