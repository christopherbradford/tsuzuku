import { signal } from '@preact/signals';
import { nullAudio } from '@/shared/audio';
import { voiceAudible } from './voice';

describe('voiceAudible', () => {
  it('reads canSpeak when the service exposes it', () => {
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true), canSpeak: signal(false) })).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(true) })).toBe(true);
  });

  it('falls back to hasJaVoice for nullAudio-style doubles without canSpeak', () => {
    expect(voiceAudible(nullAudio)).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true) })).toBe(true);
  });
});
