/**
 * TSUZUKU — `voiceAudible`: whether `speak()` on the audio slot will actually
 * be heard. The body lives in the contract tier (`shared/audio.ts`, ARCHITECTURE
 * §3) so D's drills, F's `@/audio` and the input group read one definition;
 * this module keeps D's import path (`../voice`).
 */
export { voiceAudible } from '@/shared/audio';
