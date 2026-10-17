/**
 * TSUZUKU — audio barrel (group F). `main.tsx` installs these through
 * `installServices({ audio: createWebAudio(), stt: createStt() })`.
 */
export { createWebAudio, splitUtterance, estimateMs, textToSpeak } from './tts';
export type { WebAudioOptions, WebAudioService, TtsSettings, SynthLike, UtteranceLike } from './tts';
export { createStt, detectRecognitionCtor, stateForError, SHADOW_MAX_MS } from './stt';
export type { SttOptions, SttServiceEx, SttState, RecognitionLike, RecognitionCtor } from './stt';
export { createSfx, RECIPES, SFX_DURATION_MS, VIBRATION } from './sfx';
export type { SfxEngine, Recipe } from './sfx';
export { rankVoices, pickPair, installGuide, detectPlatform, isJaVoice, voiceLabel, PAIR_OFFSET } from './voices';
export type { RankedVoice, VoicePair, VoiceLike, Platform } from './voices';
export { S as AUDIO_STRINGS, STT_STATE_LABEL } from './strings';
