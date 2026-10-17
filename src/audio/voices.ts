/**
 * TSUZUKU — Japanese voice selection (design 07 §7, 06 §7 #10).
 *
 *  rankVoices()   filter `lang` starting `ja`, order by the preference table
 *                 (Google 日本語 → Microsoft Nanami / Keita → Kyoko → O-Ren →
 *                 other named Japanese voices → the rest), local before
 *                 network inside a tier, the system default next, then name.
 *  pickPair()     two distinct voices for the dialogue slots (the learner's
 *                 picks win); with a single Japanese voice the same voice
 *                 comes back twice with a rate / pitch offset for slot B.
 *  installGuide() one-time install text per OS from the user-agent string.
 *
 * Pure: takes `SpeechSynthesisVoice`-shaped objects, never touches
 * `speechSynthesis` itself (that is `tts.ts`).
 */
import type { VoiceInfo } from '../shared/audio';
import { S } from './strings';

/** The subset of `SpeechSynthesisVoice` the ranking reads (tests pass plain objects). */
export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

export interface RankedVoice extends VoiceInfo {
  /** Preference tier, 0 = best. */
  tier: number;
  /** The platform's default voice. */
  isDefault: boolean;
}

/** Preference table, best first (design 07 §7). */
export const VOICE_PREFERENCE: readonly RegExp[] = [
  /google.*(日本語|japanese)/i,
  /nanami/i,
  /keita/i,
  /kyoko/i,
  /o-?ren/i,
  /otoya|hattori|ayumi|haruka|ichiro|sayaka|nanami|siri/i,
];

/** Slot-B offset when only one Japanese voice exists (same voice, lower and slower). */
export const PAIR_OFFSET: Readonly<{ rate: number; pitch: number }> = { rate: 0.94, pitch: 0.82 };

const JA_RE = /^ja([-_]|$)/i;

/** `lang` starts with `ja` (`ja`, `ja-JP`, `ja_JP`, case-insensitive). */
export function isJaVoice(v: Pick<VoiceLike, 'lang'>): boolean {
  return JA_RE.test(v.lang.trim());
}

export function toVoiceInfo(v: VoiceLike): VoiceInfo {
  return { uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService, network: !v.localService };
}

export function preferenceTier(name: string): number {
  for (let i = 0; i < VOICE_PREFERENCE.length; i++) {
    if ((VOICE_PREFERENCE[i] as RegExp).test(name)) return i;
  }
  return VOICE_PREFERENCE.length;
}

/**
 * Japanese voices, best first. Tier → local before network → system default
 * → name (locale-aware) → URI, so the order is total and stable.
 */
export function rankVoices(voices: readonly VoiceLike[]): RankedVoice[] {
  const out: RankedVoice[] = [];
  const seen = new Set<string>();
  for (const v of voices) {
    if (!isJaVoice(v)) continue;
    if (seen.has(v.voiceURI)) continue;
    seen.add(v.voiceURI);
    out.push({ ...toVoiceInfo(v), tier: preferenceTier(v.name), isDefault: v.default === true });
  }
  out.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.local !== b.local) return a.local ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const byName = a.name.localeCompare(b.name, 'en');
    if (byName !== 0) return byName;
    return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
  });
  return out;
}

export interface VoicePair {
  a?: VoiceInfo;
  b?: VoiceInfo;
  /** Present only when slot B had to reuse slot A's voice. */
  offset?: { rate: number; pitch: number };
}

function byUri(voices: readonly VoiceInfo[], uri: string | undefined): VoiceInfo | undefined {
  if (!uri) return undefined;
  return voices.find((v) => v.uri === uri);
}

/**
 * Dialogue voice slots. `preferred` / `preferred2` are the learner's
 * `settings.ttsVoiceURI` / `ttsVoiceURI2`; a stale URI (voice uninstalled) is
 * ignored. `b` is the best-ranked voice distinct from `a`; with one voice
 * `b === a` and `offset` carries the rate / pitch shift. Empty list → `{}`.
 */
export function pickPair(voices: readonly VoiceInfo[], preferred?: string, preferred2?: string): VoicePair {
  if (voices.length === 0) return {};
  const a = byUri(voices, preferred) ?? (voices[0] as VoiceInfo);
  const chosenB = byUri(voices, preferred2);
  const b = chosenB && chosenB.uri !== a.uri ? chosenB : voices.find((v) => v.uri !== a.uri);
  if (b) return { a, b };
  return { a, b: a, offset: { ...PAIR_OFFSET } };
}

export type Platform = 'windows' | 'mac' | 'ios' | 'android' | 'linux' | 'unknown';

/** Coarse platform from a user-agent string (iPadOS 13+ reports as a Mac with touch; we treat it as iOS when `Mobile` is present). */
export function detectPlatform(ua: string): Platform {
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/android/.test(s)) return 'android';
  if (/windows/.test(s)) return 'windows';
  if (/macintosh|mac os x/.test(s)) return /mobile/.test(s) ? 'ios' : 'mac';
  if (/cros/.test(s)) return 'android';
  if (/linux|x11/.test(s)) return 'linux';
  return 'unknown';
}

/** The one-time "add a Japanese voice" guide for this OS (design 07 §7). */
export function installGuide(ua: string): string {
  switch (detectPlatform(ua)) {
    case 'windows':
      return S.installWindows;
    case 'mac':
      return S.installMac;
    case 'ios':
      return S.installIos;
    case 'android':
      return S.installAndroid;
    case 'linux':
      return S.installLinux;
    default:
      return S.installGeneric;
  }
}

/** Picker label: name plus "network voice" when the voice is not local. */
export function voiceLabel(v: VoiceInfo): string {
  return v.network ? `${v.name} (${S.networkVoice})` : v.name;
}
