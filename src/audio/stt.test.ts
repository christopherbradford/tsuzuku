/**
 * stt.ts — against a fake SpeechRecognition constructor under fake timers.
 */
import { nullStt } from '../shared/audio';
import { STT_STATE_LABEL } from './strings';
import {
  MAX_ALTERNATIVES,
  SHADOW_MAX_MS,
  STOP_GRACE_MS,
  concatSegments,
  createStt,
  detectRecognitionCtor,
  finalAlternatives,
  stateForError,
  type RecognitionEventLike,
  type RecognitionLike,
  type RecognitionResultListLike,
  type SttState,
} from './stt';

/* ────────────────────────────────────────────────────────────────────────── */
/* Fake recognizer                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const instances: FakeRecognition[] = [];

class FakeRecognition implements RecognitionLike {
  lang = '';
  continuous = false;
  interimResults = true;
  maxAlternatives = 1;
  onresult: ((ev: RecognitionEventLike) => void) | null = null;
  onerror: ((ev: { error?: string }) => void) | null = null;
  onend: ((ev?: unknown) => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor() {
    instances.push(this);
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  abort(): void {
    this.aborted++;
  }
  /** Deliver one final result with these alternatives (array-indexed like the browser). */
  final(alts: string[], o: { resultIndex?: number } = {}): void {
    this.onresult?.(event([{ isFinal: true, alts }], o.resultIndex));
  }
  interim(text: string): void {
    this.onresult?.(event([{ isFinal: false, alts: [text] }]));
  }
  error(code: string): void {
    this.onerror?.({ error: code });
  }
  end(): void {
    this.onend?.();
  }
}

function event(rows: { isFinal: boolean; alts: string[] }[], resultIndex = 0): RecognitionEventLike {
  const results = rows.map((r) => {
    const res: Record<number, { transcript: string }> & { isFinal: boolean; length: number } = { isFinal: r.isFinal, length: r.alts.length };
    r.alts.forEach((t, i) => {
      res[i] = { transcript: t };
    });
    return res;
  });
  const list = results as unknown as RecognitionResultListLike & Record<number, unknown>;
  return { resultIndex, results: list };
}

const last = (): FakeRecognition => instances[instances.length - 1] as FakeRecognition;

beforeEach(() => {
  vi.useFakeTimers();
  instances.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

describe('helpers', () => {
  it('detectRecognitionCtor prefers the unprefixed constructor and returns null without either', () => {
    const A = class {} as unknown as new () => RecognitionLike;
    const B = class {} as unknown as new () => RecognitionLike;
    expect(detectRecognitionCtor({ SpeechRecognition: A, webkitSpeechRecognition: B })).toBe(A);
    expect(detectRecognitionCtor({ webkitSpeechRecognition: B })).toBe(B);
    expect(detectRecognitionCtor({})).toBeNull();
    // jsdom has neither
    expect(detectRecognitionCtor()).toBeNull();
  });

  it.each([
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['no-speech', 'no-speech'],
    ['network', 'network'],
    ['audio-capture', 'audio-capture'],
    ['aborted', 'aborted'],
    ['bad-grammar', 'error'],
    [undefined, 'error'],
  ] as [string | undefined, SttState][])('stateForError(%s) → %s', (code, want) => {
    expect(stateForError(code)).toBe(want);
  });

  it('finalAlternatives keeps ≤ 5 distinct non-empty alternatives of final results only, from resultIndex', () => {
    const ev = event(
      [
        { isFinal: true, alts: ['old'] },
        { isFinal: false, alts: ['interim'] },
        { isFinal: true, alts: ['はい', 'はい ', '灰', '', 'ハイ', 'はいっ', 'hai'] },
      ],
      1,
    );
    expect(finalAlternatives(ev)).toEqual([['はい', '灰', 'ハイ', 'はいっ', 'hai']]);
    expect(finalAlternatives(event([{ isFinal: true, alts: ['a'] }]))).toEqual([['a']]);
    expect(finalAlternatives(event([{ isFinal: false, alts: ['a'] }]))).toEqual([]);
  });

  it('concatSegments joins position-wise, falling back to a segment first alternative', () => {
    expect(concatSegments([])).toEqual([]);
    expect(concatSegments([['毎朝', '前朝'], ['コーヒーを飲みます']])).toEqual(['毎朝コーヒーを飲みます', '前朝コーヒーを飲みます']);
    expect(concatSegments([['a', 'b'], ['c', 'd', 'e']])).toEqual(['ac', 'bd', 'ae']);
    expect(concatSegments([['x'], ['x']])).toEqual(['xx']);
    const wide = concatSegments([['1', '2', '3', '4', '5', '6', '7']]);
    expect(wide.length).toBe(MAX_ALTERNATIVES);
  });

  it('every state has a label entry', () => {
    const states: SttState[] = ['idle', 'listening', 'done', 'no-speech', 'denied', 'network', 'audio-capture', 'aborted', 'timeout', 'unavailable', 'error'];
    for (const s of states) expect(typeof STT_STATE_LABEL[s]).toBe('string');
    expect(SHADOW_MAX_MS).toBe(8000);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Unavailable                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

describe('unavailable', () => {
  it('without a constructor the service matches nullStt behaviour', async () => {
    const stt = createStt({ ctor: null });
    expect(stt.available).toBe(false);
    expect(stt.state.value).toBe('unavailable');
    await expect(stt.recognize({ maxMs: 8000 })).resolves.toBeNull();
    expect(() => stt.abort()).not.toThrow();
    expect(stt.available).toBe(nullStt.available);
  });

  it('default detection under jsdom is unavailable', () => {
    expect(createStt().available).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Single line                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

describe('single line', () => {
  it('configures ja-JP, 5 alternatives, no interim, non-continuous, and returns the alternatives', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    expect(stt.available).toBe(true);
    const p = stt.recognize({ maxMs: SHADOW_MAX_MS });
    const rec = last();
    expect(rec.started).toBe(1);
    expect(rec.lang).toBe('ja-JP');
    expect(rec.maxAlternatives).toBe(5);
    expect(rec.interimResults).toBe(false);
    expect(rec.continuous).toBe(false);
    expect(stt.state.value).toBe('listening');
    expect(stt.busy()).toBe(true);
    rec.final(['毎朝コーヒーを飲みます', '毎朝コーヒーを飲みます。', '前朝コーヒーを飲みます']);
    const r = await p;
    expect(r).toEqual({ alternatives: ['毎朝コーヒーを飲みます', '毎朝コーヒーを飲みます。', '前朝コーヒーを飲みます'] });
    expect(stt.state.value).toBe('done');
    expect(stt.busy()).toBe(false);
    expect(rec.stopped).toBe(1);
    // a late onend after finishing is harmless
    rec.end();
    expect(stt.state.value).toBe('done');
  });

  it('timeout → null: stop() at maxMs, then the grace timer resolves with state timeout', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 8000 });
    const rec = last();
    let settled: unknown = 'pending';
    void p.then((r) => {
      settled = r;
    });
    vi.advanceTimersByTime(7999);
    await Promise.resolve();
    expect(settled).toBe('pending');
    expect(rec.stopped).toBe(0);
    vi.advanceTimersByTime(1);
    expect(rec.stopped).toBe(1);
    vi.advanceTimersByTime(STOP_GRACE_MS - 1);
    await Promise.resolve();
    expect(settled).toBe('pending');
    vi.advanceTimersByTime(1);
    await p;
    expect(settled).toBeNull();
    expect(stt.state.value).toBe('timeout');
  });

  it('a final result arriving during the grace window still counts', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 1000 });
    vi.advanceTimersByTime(1000);
    last().final(['はい']);
    await expect(p).resolves.toEqual({ alternatives: ['はい'] });
    expect(stt.state.value).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('onend without a result → null with state no-speech', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 8000 });
    last().end();
    await expect(p).resolves.toBeNull();
    expect(stt.state.value).toBe('no-speech');
  });

  it.each([
    ['not-allowed', 'denied'],
    ['no-speech', 'no-speech'],
    ['network', 'network'],
    ['audio-capture', 'audio-capture'],
    ['weird', 'error'],
  ] as [string, SttState][])('error %s → null with typed state %s and lastError kept', async (code, want) => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 8000 });
    last().error(code);
    await expect(p).resolves.toBeNull();
    expect(stt.state.value).toBe(want);
    expect(stt.lastError.value).toBe(code);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abort → null with state aborted and the recognizer aborted', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 8000 });
    stt.abort();
    expect(last().aborted).toBe(1);
    await expect(p).resolves.toBeNull();
    expect(stt.state.value).toBe('aborted');
    expect(stt.busy()).toBe(false);
  });

  it('a constructor or start() that throws never propagates', async () => {
    class Boom extends FakeRecognition {
      override start(): void {
        throw new Error('not allowed');
      }
    }
    const stt = createStt({ ctor: Boom });
    await expect(stt.recognize({ maxMs: 8000 })).resolves.toBeNull();
    expect(stt.state.value).toBe('error');
    const Bad = function () {
      throw new Error('ctor');
    } as unknown as new () => RecognitionLike;
    const stt2 = createStt({ ctor: Bad });
    await expect(stt2.recognize({ maxMs: 8000 })).resolves.toBeNull();
  });

  it('a second recognize() aborts the first (resolving it null)', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p1 = stt.recognize({ maxMs: 8000 });
    const p2 = stt.recognize({ maxMs: 8000 });
    await expect(p1).resolves.toBeNull();
    last().final(['はい']);
    await expect(p2).resolves.toEqual({ alternatives: ['はい'] });
  });

  it('interim option feeds the interim signal and sets interimResults', () => {
    const stt = createStt({ ctor: FakeRecognition, interim: true });
    void stt.recognize({ maxMs: 8000 });
    expect(last().interimResults).toBe(true);
    last().interim('まい');
    expect(stt.interim.value).toBe('まい');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Continuous (Monologue)                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

describe('continuous', () => {
  it('restarts a fresh recognizer after onend until maxMs and concatenates the alternatives', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 60_000, continuous: true });
    const first = last();
    expect(first.continuous).toBe(true);
    first.final(['毎朝', '前朝']);
    vi.advanceTimersByTime(5000);
    first.end(); // Chrome ends after silence
    expect(instances.length).toBe(2);
    const second = last();
    expect(second.started).toBe(1);
    second.final(['コーヒーを飲みます', 'コーヒーを飲みました']);
    second.final(['。']);
    vi.advanceTimersByTime(55_000); // deadline → stop()
    expect(second.stopped).toBe(1);
    second.end();
    const r = await p;
    expect(r?.alternatives[0]).toBe('毎朝コーヒーを飲みます。');
    expect(r?.alternatives[1]).toBe('前朝コーヒーを飲みました。');
    expect(stt.state.value).toBe('done');
    expect(instances.length).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no-speech errors do not end a continuous session; the restart happens on onend', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 30_000, continuous: true });
    last().error('no-speech');
    expect(stt.state.value).toBe('listening');
    last().end();
    expect(instances.length).toBe(2);
    last().final(['はい']);
    vi.advanceTimersByTime(30_000);
    last().end();
    await expect(p).resolves.toEqual({ alternatives: ['はい'] });
  });

  it('a fatal error (denied) ends the session with what was heard, or null', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 30_000, continuous: true });
    last().final(['はい']);
    last().error('not-allowed');
    await expect(p).resolves.toEqual({ alternatives: ['はい'] });
    expect(stt.lastError.value).toBe('not-allowed');

    const p2 = stt.recognize({ maxMs: 30_000, continuous: true });
    last().error('network');
    await expect(p2).resolves.toBeNull();
    expect(stt.state.value).toBe('network');
  });

  it('silence for the whole window → null with state timeout', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 10_000, continuous: true });
    vi.advanceTimersByTime(10_000 + STOP_GRACE_MS);
    await expect(p).resolves.toBeNull();
    expect(stt.state.value).toBe('timeout');
  });

  it('abort mid-monologue returns null per the contract', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 60_000, continuous: true });
    last().final(['はい']);
    stt.abort();
    await expect(p).resolves.toBeNull();
    expect(stt.state.value).toBe('aborted');
  });

  it('no restart once the deadline has passed even if onend fires late', async () => {
    const stt = createStt({ ctor: FakeRecognition });
    const p = stt.recognize({ maxMs: 5000, continuous: true });
    last().final(['はい']);
    vi.advanceTimersByTime(5000);
    last().end();
    await expect(p).resolves.toEqual({ alternatives: ['はい'] });
    expect(instances.length).toBe(1);
  });
});
