import { signal } from '@preact/signals';
import { installServices, nullAudio, nullStt, resetServices, services, sfx, speak, SPEED_TIER_RATES, voiceAudible, type AudioService } from './audio';

afterEach(() => resetServices());

describe('audio slot', () => {
  it('nullAudio.speak resolves; nullStt is unavailable', async () => {
    await expect(nullAudio.speak('こんにちは', { kana: 'こんにちは' })).resolves.toBeUndefined();
    expect(nullAudio.voices()).toEqual([]);
    expect(nullAudio.hasJaVoice.value).toBe(false);
    // left unset on purpose: `{ ...nullAudio, hasJaVoice: signal(true) }` doubles must stay audible via the fallback
    expect(nullAudio.canSpeak).toBeUndefined();
    expect(nullAudio.rateForTier(5)).toBe(SPEED_TIER_RATES[5]);
    expect(nullStt.available).toBe(false);
    await expect(nullStt.recognize({ maxMs: 100 })).resolves.toBeNull();
  });
  it('installServices swaps the implementation seen by earlier importers', async () => {
    const spoken: string[] = [];
    const fake: AudioService = { ...nullAudio, speak: (t) => { spoken.push(t); return Promise.resolve(); }, sfx: (n) => { spoken.push(`sfx:${n}`); } };
    const before = services; // captured before install
    installServices({ audio: fake });
    await speak('旅日記');
    sfx('ippon');
    expect(before.audio).toBe(fake);
    expect(spoken).toEqual(['旅日記', 'sfx:ippon']);
    expect(services.stt).toBe(nullStt);
    resetServices();
    expect(services.audio).toBe(nullAudio);
  });
  it('voiceAudible reads canSpeak when the service exposes it, else hasJaVoice (doubles stay audible)', () => {
    expect(voiceAudible(nullAudio)).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true) })).toBe(true);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(true), canSpeak: signal(false) })).toBe(false);
    expect(voiceAudible({ ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(true) })).toBe(true);
  });
});
