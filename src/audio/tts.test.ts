/**
 * tts.ts — against a fake SpeechSynthesis / SpeechSynthesisUtterance under
 * fake timers. Settings come from a signal so no store is needed.
 */
import { signal } from '@preact/signals';
import { SPEED_TIER_RATES } from '../shared/audio';
import { PAIR_OFFSET, type VoiceLike } from './voices';
import {
  MAX_UTTERANCE_CHARS,
  SPEAK_TIMEOUT_GRACE_MS,
  VOICE_POLL_MS,
  VOICE_POLL_TOTAL_MS,
  createWebAudio,
  estimateMs,
  splitUtterance,
  textToSpeak,
  type SynthLike,
  type TtsSettings,
  type UtteranceLike,
  type WebAudioService,
} from './tts';

/* ────────────────────────────────────────────────────────────────────────── */
/* Fakes                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

class FakeUtterance implements UtteranceLike {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: VoiceLike | null = null;
  onend: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynth implements SynthLike {
  voices: VoiceLike[];
  spoken: FakeUtterance[] = [];
  cancels = 0;
  resumes = 0;
  speaking = false;
  paused = false;
  pending = false;
  onvoiceschanged: ((ev?: unknown) => void) | null = null;
  private listeners = new Map<string, Set<(ev?: unknown) => void>>();
  /** When false, `addEventListener` is absent (old WebKit): the service falls back to `onvoiceschanged`. */
  constructor(voices: VoiceLike[] = [], o: { withEvents?: boolean } = {}) {
    this.voices = voices;
    if (o.withEvents === false) {
      // @ts-expect-error — simulate a synth without addEventListener
      this.addEventListener = undefined;
      // @ts-expect-error — and without removeEventListener
      this.removeEventListener = undefined;
    }
  }
  getVoices(): VoiceLike[] {
    return this.voices;
  }
  speak(u: UtteranceLike): void {
    this.spoken.push(u as FakeUtterance);
    this.speaking = true;
  }
  cancel(): void {
    this.cancels++;
    this.speaking = false;
  }
  resume(): void {
    this.resumes++;
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: (ev?: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
    if (type === 'voiceschanged') this.onvoiceschanged?.();
  }
  /** Finish the current utterance like a browser would. */
  end(i = this.spoken.length - 1): void {
    const u = this.spoken[i];
    this.speaking = false;
    u?.onend?.();
  }
  fail(i = this.spoken.length - 1): void {
    const u = this.spoken[i];
    this.speaking = false;
    u?.onerror?.({ error: 'synthesis-failed' });
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const ja = (name: string, o: Partial<VoiceLike> = {}): VoiceLike => ({ voiceURI: o.voiceURI ?? `uri:${name}`, name, lang: 'ja-JP', localService: o.localService ?? true, default: false });
const en = (name: string): VoiceLike => ({ voiceURI: `uri:${name}`, name, lang: 'en-US', localService: true, default: true });

const baseSettings = (): TtsSettings => ({ sound: 0.8, feel: 'dojo', speedTier: 3 });

let services: WebAudioService[] = [];
function make(synth: FakeSynth | null, settings = signal(baseSettings()), extra: Parameters<typeof createWebAudio>[0] = {}): WebAudioService {
  const svc = createWebAudio({ synth, utteranceCtor: FakeUtterance, ctxFactory: () => undefined, settings, doc: null, win: null, ...extra });
  services.push(svc);
  return svc;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const s of services) s.dispose();
  services = [];
  vi.useRealTimers();
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

describe('splitUtterance', () => {
  it('leaves a short sentence whole', () => {
    expect(splitUtterance('おはようございます。')).toEqual(['おはようございます。']);
  });

  it('splits long text at sentence punctuation into pieces ≤ 180 chars', () => {
    const sentence = 'わたしはまいあさコーヒーをのみます。'; // 18 chars
    const text = sentence.repeat(25); // 450 chars
    const parts = splitUtterance(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(MAX_UTTERANCE_CHARS);
      expect(p.endsWith('。')).toBe(true);
    }
    expect(parts.join('')).toBe(text);
  });

  it('a single sentence over the cap splits at commas, then hard', () => {
    const clause = 'あいうえおかきくけこ、'; // 11 chars
    const text = clause.repeat(20) + 'です。'; // 223 chars, one sentence
    const parts = splitUtterance(text);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_UTTERANCE_CHARS);
    expect(parts[0]?.endsWith('、')).toBe(true);
    const hard = 'あ'.repeat(400);
    const hardParts = splitUtterance(hard);
    expect(hardParts.map((p) => p.length)).toEqual([180, 180, 40]);
  });

  it('drops whitespace-only pieces and trims', () => {
    expect(splitUtterance('  ')).toEqual([]);
    expect(splitUtterance(' はい。 ')).toEqual(['はい。']);
  });
});

describe('estimateMs / textToSpeak', () => {
  it('estimate grows with length and shrinks with rate; kanji count double', () => {
    const a = estimateMs('あいうえお', 1);
    const b = estimateMs('あいうえおかきくけこ', 1);
    expect(b).toBeGreaterThan(a);
    expect(estimateMs('あいうえお', 2)).toBeLessThan(a);
    expect(estimateMs('飲む', 1)).toBeGreaterThan(estimateMs('のむ', 1));
  });

  it('sentences speak the plain surface (ruby stripped), never the kana', () => {
    expect(textToSpeak('{私|わたし}はコーヒーを{飲|の}みます。', 'わたしはコーヒーをのみます。')).toBe('私はコーヒーを飲みます。');
    expect(textToSpeak('私はコーヒーを飲みます。')).toBe('私はコーヒーを飲みます。');
  });

  it('an isolated word speaks its kana when given (単漢字 are misread alone)', () => {
    expect(textToSpeak('日', 'ひ')).toBe('ひ');
    expect(textToSpeak('{飲|の}む', 'のむ')).toBe('のむ');
    expect(textToSpeak('飲む')).toBe('飲む');
    expect(textToSpeak('あ', 'あ')).toBe('あ');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Voices                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

describe('voices', () => {
  it('hasJaVoice false when no ja voices and speak still resolves', async () => {
    const synth = new FakeSynth([en('Alex')]);
    const svc = make(synth);
    expect(svc.hasJaVoice.value).toBe(false);
    expect(svc.voices()).toEqual([]);
    const p = svc.speak('おはよう。');
    expect(synth.spoken.length).toBe(1);
    expect(synth.spoken[0]?.voice).toBeNull();
    expect(synth.spoken[0]?.lang).toBe('ja-JP');
    synth.end();
    await expect(p).resolves.toBeUndefined();
  });

  it('voices are refreshed on voiceschanged (addEventListener path)', () => {
    const synth = new FakeSynth([]);
    const svc = make(synth);
    expect(svc.hasJaVoice.value).toBe(false);
    synth.voices = [ja('Kyoko')];
    synth.fire('voiceschanged');
    expect(svc.hasJaVoice.value).toBe(true);
    expect(svc.voices()[0]?.name).toBe('Kyoko');
  });

  it('falls back to onvoiceschanged when addEventListener is missing', () => {
    const synth = new FakeSynth([], { withEvents: false });
    const svc = make(synth);
    expect(typeof synth.onvoiceschanged).toBe('function');
    synth.voices = [ja('O-Ren')];
    synth.onvoiceschanged?.();
    expect(svc.hasJaVoice.value).toBe(true);
  });

  it('voices are polled every 250 ms for 3 s when voiceschanged never fires', () => {
    const synth = new FakeSynth([]);
    const getVoices = vi.spyOn(synth, 'getVoices');
    const svc = make(synth);
    const initialCalls = getVoices.mock.calls.length;
    vi.advanceTimersByTime(VOICE_POLL_MS * 4);
    expect(getVoices.mock.calls.length).toBe(initialCalls + 4);
    synth.voices = [ja('Kyoko')];
    vi.advanceTimersByTime(VOICE_POLL_MS);
    expect(svc.hasJaVoice.value).toBe(true);
    const afterFound = getVoices.mock.calls.length;
    vi.advanceTimersByTime(VOICE_POLL_TOTAL_MS * 2);
    // polling stops once voices are found
    expect(getVoices.mock.calls.length).toBe(afterFound);
  });

  it('polling gives up after 3 s', () => {
    const synth = new FakeSynth([]);
    const getVoices = vi.spyOn(synth, 'getVoices');
    make(synth);
    vi.advanceTimersByTime(VOICE_POLL_TOTAL_MS + VOICE_POLL_MS * 10);
    const n = getVoices.mock.calls.length;
    vi.advanceTimersByTime(VOICE_POLL_TOTAL_MS);
    expect(getVoices.mock.calls.length).toBe(n);
    expect(n).toBeLessThanOrEqual(1 + VOICE_POLL_TOTAL_MS / VOICE_POLL_MS + 1);
  });

  it('voices() marks network voices and ranks by preference', () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('Google 日本語', { localService: false })]);
    const svc = make(synth);
    expect(svc.voices().map((v) => [v.name, v.network])).toEqual([
      ['Google 日本語', true],
      ['Kyoko', false],
    ]);
    expect(svc.rankedVoices()[0]?.tier).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* speak()                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

describe('speak', () => {
  it('rateForTier follows SPEED_TIER_RATES and the default rate is the settings tier', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const settings = signal<TtsSettings>({ ...baseSettings(), speedTier: 1 });
    const svc = make(synth, settings);
    for (const t of [1, 2, 3, 4, 5] as const) expect(svc.rateForTier(t)).toBe(SPEED_TIER_RATES[t]);
    void svc.speak('はい。');
    expect(synth.spoken[0]?.rate).toBe(0.75);
    settings.value = { ...settings.value, speedTier: 5 };
    void svc.speak('はい。');
    expect(synth.spoken[1]?.rate).toBe(1.25);
    void svc.speak('はい。', { rate: 1.5 });
    expect(synth.spoken[2]?.rate).toBe(1.5);
  });

  it('long text is split into ≤180-char utterances spoken in order, resolving after the last onend', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const text = 'わたしはまいあさコーヒーをのみます。'.repeat(25);
    const p = svc.speak(text);
    let done = false;
    void p.then(() => {
      done = true;
    });
    expect(synth.spoken.length).toBe(1);
    synth.end(0);
    await Promise.resolve();
    expect(synth.spoken.length).toBe(2);
    expect(done).toBe(false);
    while (synth.speaking) {
      synth.end();
      await Promise.resolve();
    }
    await p;
    expect(done).toBe(true);
    expect(synth.spoken.map((u) => u.text).join('')).toBe(text);
    for (const u of synth.spoken) expect(u.text.length).toBeLessThanOrEqual(180);
  });

  it('cancel clears the queue, calls synth.cancel and resolves pending promises', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const text = 'わたしはまいあさコーヒーをのみます。'.repeat(25);
    const p = svc.speak(text);
    expect(svc.busy()).toBe(true);
    svc.cancel();
    expect(synth.cancels).toBe(2); // one from speak()'s interrupt, one explicit
    expect(svc.busy()).toBe(false);
    await expect(p).resolves.toBeUndefined();
    // nothing more is spoken after cancel
    vi.advanceTimersByTime(60_000);
    expect(synth.spoken.length).toBe(1);
  });

  it('interrupt (default) cancels what was playing; interrupt:false queues', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    void svc.speak('いち。');
    void svc.speak('に。');
    expect(synth.cancels).toBe(2); // one per speak() call
    expect(synth.spoken.map((u) => u.text)).toEqual(['いち。', 'に。']);
    void svc.speak('さん。', { interrupt: false });
    expect(synth.cancels).toBe(2);
    expect(synth.spoken.length).toBe(2); // queued behind に。
    synth.end(1);
    expect(synth.spoken[2]?.text).toBe('さん。');
  });

  it('speak resolves via the timeout when onend never fires', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const text = 'おはようございます。';
    const p = svc.speak(text);
    let done = false;
    void p.then(() => {
      done = true;
    });
    const budget = estimateMs(text, 1) + SPEAK_TIMEOUT_GRACE_MS;
    vi.advanceTimersByTime(budget - 1);
    await Promise.resolve();
    expect(done).toBe(false);
    vi.advanceTimersByTime(2);
    await p;
    expect(done).toBe(true);
    expect(svc.busy()).toBe(false);
  });

  it('speak resolves on onerror and moves on to the next chunk', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    const p = svc.speak('いち。に。'.repeat(40)); // > 180 chars → 2+ chunks
    synth.fail(0);
    await Promise.resolve();
    expect(synth.spoken.length).toBe(2);
    while (synth.speaking) {
      synth.end();
      await Promise.resolve();
    }
    await expect(p).resolves.toBeUndefined();
  });

  it('the kana reading is used for an isolated word, the plain surface for a sentence', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    void svc.speak('日', { kana: 'ひ' });
    expect(synth.spoken[0]?.text).toBe('ひ');
    void svc.speak('{今日|きょう}はいい{日|ひ}ですね。', { kana: 'きょうはいいひですね。' });
    expect(synth.spoken[1]?.text).toBe('今日はいい日ですね。');
  });

  it('a synth that throws on speak() still resolves', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    synth.speak = () => {
      throw new Error('busy');
    };
    const svc = make(synth);
    await expect(svc.speak('はい。')).resolves.toBeUndefined();
  });

  it('resumes a paused engine before speaking and on the keep-alive tick', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    synth.paused = true;
    void svc.speak('あ'.repeat(40)); // long enough to outlive the first keep-alive tick
    expect(synth.resumes).toBe(1);
    synth.paused = true;
    vi.advanceTimersByTime(4000);
    expect(synth.resumes).toBe(2);
    synth.end();
    synth.paused = true;
    vi.advanceTimersByTime(4000);
    expect(synth.resumes).toBe(2); // idle: no nudge
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Voice slots                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

describe('dialogue voice slots', () => {
  it('slot a / b use distinct voices when two exist; the learner picks win', () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('O-Ren')]);
    const svc = make(synth, signal({ ...baseSettings(), ttsVoiceURI: 'uri:O-Ren' }));
    void svc.speak('A。', { voice: 'a' });
    void svc.speak('B。', { voice: 'b' });
    expect(synth.spoken[0]?.voice?.name).toBe('O-Ren');
    expect(synth.spoken[1]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[1]?.pitch).toBe(1);
    expect(synth.spoken[1]?.rate).toBe(1);
  });

  it('with one voice slot b reuses it with the rate/pitch offset', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    void svc.speak('A。', { voice: 'a' });
    void svc.speak('B。', { voice: 'b' });
    expect(synth.spoken[0]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[1]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[1]?.pitch).toBe(PAIR_OFFSET.pitch);
    expect(synth.spoken[1]?.rate).toBeCloseTo(PAIR_OFFSET.rate, 6);
  });

  it('an explicit voiceURI override wins over the slots', () => {
    const synth = new FakeSynth([ja('Kyoko'), ja('O-Ren')]);
    const svc = make(synth);
    void svc.speak('A。', { voice: 'b', voiceURI: 'uri:Kyoko' });
    expect(synth.spoken[0]?.voice?.name).toBe('Kyoko');
    expect(synth.spoken[0]?.pitch).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Volume, mute, sfx, warm-up                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

describe('volume and mute', () => {
  it('utterance volume follows settings.sound and setVolume', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const settings = signal(baseSettings());
    const svc = make(synth, settings);
    void svc.speak('はい。');
    expect(synth.spoken[0]?.volume).toBe(0.8);
    svc.setVolume(0.3);
    void svc.speak('はい。');
    expect(synth.spoken[1]?.volume).toBe(0.3);
    settings.value = { ...settings.value, sound: 0.5 };
    void svc.speak('はい。');
    expect(synth.spoken[2]?.volume).toBe(0.5);
  });

  it('volume 0 mutes and skips speaking entirely but still resolves', async () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal({ ...baseSettings(), sound: 0 }));
    expect(svc.muted.value).toBe(true);
    await expect(svc.speak('はい。')).resolves.toBeUndefined();
    expect(synth.spoken.length).toBe(0);
  });

  it('Zen mutes sfx but voices still speak', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal({ ...baseSettings(), feel: 'zen' }));
    expect(svc.muted.value).toBe(true);
    void svc.speak('はい。');
    expect(synth.spoken.length).toBe(1);
    expect(synth.spoken[0]?.volume).toBe(0.8);
  });

  it('sfx plays through the engine at the master volume and is silent when muted', () => {
    const ctxCalls: number[] = [];
    const fakeCtx = {
      sampleRate: 8000,
      currentTime: 0,
      state: 'running',
      destination: {},
      createGain: () => {
        ctxCalls.push(1);
        throw new Error('stop here'); // recipe aborts safely after the master gain
      },
    } as unknown as AudioContext;
    const synth = new FakeSynth([ja('Kyoko')]);
    const settings = signal(baseSettings());
    const svc = make(synth, settings, { ctxFactory: () => fakeCtx });
    svc.sfx('correct');
    expect(ctxCalls.length).toBe(1);
    settings.value = { ...settings.value, feel: 'zen' };
    svc.sfx('correct');
    expect(ctxCalls.length).toBe(1);
    settings.value = { ...settings.value, feel: 'dojo', sound: 0 };
    svc.sfx('correct');
    expect(ctxCalls.length).toBe(1);
  });

  it('warmUp speaks one silent ja utterance once', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth);
    svc.warmUp();
    svc.warmUp();
    expect(synth.spoken.length).toBe(1);
    expect(synth.spoken[0]?.volume).toBe(0);
    expect(synth.spoken[0]?.lang).toBe('ja-JP');
  });

  it('the first gesture on the document warms up and the listener is removed', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal(baseSettings()), { doc: document });
    document.dispatchEvent(new Event('pointerdown'));
    expect(synth.spoken.length).toBe(1);
    document.dispatchEvent(new Event('keydown'));
    expect(synth.spoken.length).toBe(1);
    svc.dispose();
  });

  it('a hashchange (navigation) cancels speech', () => {
    const synth = new FakeSynth([ja('Kyoko')]);
    const svc = make(synth, signal(baseSettings()), { win: window });
    void svc.speak('はい。');
    window.dispatchEvent(new Event('hashchange'));
    expect(synth.cancels).toBe(2);
    expect(svc.busy()).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* No speechSynthesis at all                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('no speechSynthesis', () => {
  it('behaves like nullAudio for voices and resolves speak immediately', async () => {
    const svc = make(null);
    expect(svc.hasJaVoice.value).toBe(false);
    expect(svc.voices()).toEqual([]);
    await expect(svc.speak('はい。')).resolves.toBeUndefined();
    expect(() => svc.cancel()).not.toThrow();
    expect(() => svc.warmUp()).not.toThrow();
    expect(() => svc.sfx('correct')).not.toThrow();
    expect(svc.rateForTier(3)).toBe(1);
  });

  it('dispose removes listeners and stops timers', () => {
    const synth = new FakeSynth([]);
    const svc = make(synth);
    expect(synth.listenerCount('voiceschanged')).toBe(1);
    svc.dispose();
    expect(synth.listenerCount('voiceschanged')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
