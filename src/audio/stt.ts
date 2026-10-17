/**
 * TSUZUKU — `SpeechRecognition` wrapper implementing `SttService` (design 07 §7).
 *
 *  - Feature-detects `SpeechRecognition` / `webkitSpeechRecognition`; without
 *    either the service is `available: false` and `recognize()` resolves `null`.
 *  - `lang 'ja-JP'`, `maxAlternatives 5`, `interimResults false` (an `interim`
 *    signal is still fed when a caller opts in).
 *  - Single line: `recognize({maxMs})` returns the first final result's ≤ 5
 *    alternatives, or `null` after `maxMs` (+ a short grace for the engine to
 *    flush) when nothing was heard.
 *  - Monologue: `recognize({maxMs, continuous: true})` restarts on `onend`
 *    until `maxMs`, concatenating each segment's alternatives position-wise
 *    (alternative 0 is the full transcript).
 *  - Errors never throw: they become typed `state` values (`denied`,
 *    `no-speech`, `network`, `audio-capture`, `aborted`, `timeout`, `error`)
 *    the speaking exercises can surface with `STT_STATE_LABEL` (or
 *    `sttFailure()`, which also tolerates a plain `SttService` without
 *    `state`), and the promise resolves with whatever was heard so far,
 *    else `null`.
 *
 * The recognizer constructor is injectable so the module runs under jsdom.
 */
import { signal, type Signal } from '@preact/signals';
import type { SttResult, SttService } from '../shared/audio';
import { STT_STATE_LABEL } from './strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Minimal Web Speech shapes (lib.dom lacks `SpeechRecognition` itself)       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}
export interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item?(i: number): RecognitionAlternativeLike;
  [index: number]: RecognitionAlternativeLike;
}
export interface RecognitionResultListLike {
  readonly length: number;
  item?(i: number): RecognitionResultLike;
  [index: number]: RecognitionResultLike;
}
export interface RecognitionEventLike {
  resultIndex?: number;
  results: RecognitionResultListLike;
}
export interface RecognitionErrorEventLike {
  error?: string;
  message?: string;
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: RecognitionEventLike) => void) | null;
  onerror: ((ev: RecognitionErrorEventLike) => void) | null;
  onend: ((ev?: unknown) => void) | null;
  onstart?: ((ev?: unknown) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionCtor = new () => RecognitionLike;

export type SttState =
  | 'idle'
  | 'listening'
  | 'done'
  | 'no-speech'
  | 'denied'
  | 'network'
  | 'audio-capture'
  | 'aborted'
  | 'timeout'
  | 'unavailable'
  | 'error';

export interface SttOptions {
  /** Default: `SpeechRecognition ?? webkitSpeechRecognition`; `null` forces unavailable. */
  ctor?: RecognitionCtor | null;
  /** Feed the `interim` signal (sets `interimResults = true`). Default false. */
  interim?: boolean;
}

export interface SttServiceEx extends SttService {
  state: Signal<SttState>;
  /** Latest interim transcript (empty when `interim` is off). */
  interim: Signal<string>;
  /** Raw error code of the last failure (`not-allowed`, `no-speech`, …). */
  lastError: Signal<string | null>;
  /** A recognition is in flight. */
  busy(): boolean;
}

/** Shadow lines are capped at 8 s (design 04 §6). */
export const SHADOW_MAX_MS = 8000;
/** Grace after `maxMs` for the engine to deliver its final result before we give up. */
export const STOP_GRACE_MS = 1500;
export const MAX_ALTERNATIVES = 5;

/** Picks the recognizer constructor from a global object. */
export function detectRecognitionCtor(g: object = globalThis): RecognitionCtor | null {
  const w = g as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Maps a Web Speech error code onto a typed state. */
export function stateForError(code: string | undefined): SttState {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    case 'audio-capture':
      return 'audio-capture';
    case 'aborted':
      return 'aborted';
    default:
      return 'error';
  }
}

/** `denied` / `network` / `audio-capture` end a continuous session; the rest let it restart. */
const FATAL: ReadonlySet<SttState> = new Set(['denied', 'network', 'audio-capture', 'aborted']);

export interface SttFailure {
  state: SttState;
  /** `STT_STATE_LABEL[state]`, Sensei voice. */
  label: string;
}

/**
 * The recognizer's typed failure after a `null` result, read from the
 * optional `state` signal (`nullStt` and plain test doubles have none):
 * `null` while idle / listening / done or when no state is exposed. Exercises
 * show `label` in place of a generic "nothing heard".
 */
export function sttFailure(stt: SttService): SttFailure | null {
  const st = (stt as Partial<Pick<SttServiceEx, 'state'>>).state?.value;
  if (!st || st === 'idle' || st === 'listening' || st === 'done') return null;
  return { state: st, label: STT_STATE_LABEL[st] };
}

function at<T>(list: { length: number; item?(i: number): T; [index: number]: T }, i: number): T | undefined {
  return typeof list.item === 'function' ? list.item(i) : list[i];
}

/** Final results of an event → one `string[]` of ≤ 5 alternatives per final result. */
export function finalAlternatives(ev: RecognitionEventLike): string[][] {
  const out: string[][] = [];
  const from = ev.resultIndex ?? 0;
  for (let i = from; i < ev.results.length; i++) {
    const r = at(ev.results, i);
    if (!r || !r.isFinal) continue;
    const alts: string[] = [];
    for (let j = 0; j < r.length && alts.length < MAX_ALTERNATIVES; j++) {
      const a = at(r, j);
      const t = a?.transcript?.trim() ?? '';
      if (t.length > 0 && !alts.includes(t)) alts.push(t);
    }
    if (alts.length > 0) out.push(alts);
  }
  return out;
}

export function interimTranscript(ev: RecognitionEventLike): string {
  let s = '';
  for (let i = 0; i < ev.results.length; i++) {
    const r = at(ev.results, i);
    if (!r) continue;
    s += at(r, 0)?.transcript ?? '';
  }
  return s.trim();
}

/**
 * Concatenates per-segment alternatives position-wise: alternative k of the
 * whole = join of alternative k (or 0 when a segment has fewer) of each
 * segment. Alternative 0 is therefore the primary full transcript.
 */
export function concatSegments(segments: readonly (readonly string[])[]): string[] {
  if (segments.length === 0) return [];
  const width = Math.min(MAX_ALTERNATIVES, Math.max(...segments.map((s) => s.length)));
  const out: string[] = [];
  for (let k = 0; k < width; k++) {
    const joined = segments.map((s) => s[k] ?? s[0] ?? '').join('');
    if (joined.length > 0 && !out.includes(joined)) out.push(joined);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Service                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export function createStt(o: SttOptions = {}): SttServiceEx {
  const Ctor = o.ctor === undefined ? detectRecognitionCtor() : o.ctor;
  const state = signal<SttState>(Ctor ? 'idle' : 'unavailable');
  const interim = signal('');
  const lastError = signal<string | null>(null);

  interface Session {
    rec: RecognitionLike | null;
    segments: string[][];
    finished: boolean;
    continuous: boolean;
    /** Set when `maxMs` elapsed: no restart after this. */
    pastDeadline: boolean;
    stopTimer: ReturnType<typeof setTimeout> | null;
    graceTimer: ReturnType<typeof setTimeout> | null;
    resolve: (r: SttResult | null) => void;
  }
  let session: Session | null = null;

  const clearTimers = (s: Session): void => {
    if (s.stopTimer) clearTimeout(s.stopTimer);
    if (s.graceTimer) clearTimeout(s.graceTimer);
    s.stopTimer = null;
    s.graceTimer = null;
  };

  const detach = (rec: RecognitionLike | null): void => {
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
  };

  /** Ends the session: resolves with everything heard (continuous) or the first segment (single). */
  const finish = (s: Session, finalState: SttState): void => {
    if (s.finished) return;
    s.finished = true;
    clearTimers(s);
    detach(s.rec);
    if (session === s) session = null;
    const alts = s.continuous ? concatSegments(s.segments) : (s.segments[0] ?? []);
    const heard = alts.length > 0;
    state.value = heard ? 'done' : finalState;
    s.resolve(heard ? { alternatives: alts } : null);
  };

  const safeStop = (rec: RecognitionLike | null, method: 'stop' | 'abort'): void => {
    if (!rec) return;
    try {
      rec[method]();
    } catch {
      /* ignore */
    }
  };

  const attach = (s: Session, rec: RecognitionLike): void => {
    rec.lang = 'ja-JP';
    rec.maxAlternatives = MAX_ALTERNATIVES;
    rec.interimResults = o.interim === true;
    rec.continuous = s.continuous;
    rec.onresult = (ev) => {
      if (s.finished) return;
      if (o.interim) interim.value = interimTranscript(ev);
      const finals = finalAlternatives(ev);
      if (finals.length === 0) return;
      s.segments.push(...finals);
      if (!s.continuous) {
        safeStop(rec, 'stop');
        finish(s, 'done');
      }
    };
    rec.onerror = (ev) => {
      if (s.finished) return;
      const code = ev?.error;
      lastError.value = code ?? 'unknown';
      const st = stateForError(code);
      if (s.continuous && !FATAL.has(st)) {
        // `no-speech` / transient errors: the engine will fire onend, which restarts.
        state.value = 'listening';
        return;
      }
      finish(s, st);
    };
    rec.onend = () => {
      if (s.finished) return;
      if (s.continuous && !s.pastDeadline) {
        // Chrome ends continuous sessions after silence: start a fresh recognizer.
        if (!start(s)) finish(s, 'error');
        return;
      }
      finish(s, s.segments.length > 0 ? 'done' : s.continuous ? 'done' : 'no-speech');
    };
  };

  const start = (s: Session): boolean => {
    if (!Ctor) return false;
    let rec: RecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      return false;
    }
    detach(s.rec);
    s.rec = rec;
    attach(s, rec);
    try {
      rec.start();
      return true;
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : 'start-failed';
      return false;
    }
  };

  const service: SttServiceEx = {
    available: Ctor !== null,
    state,
    interim,
    lastError,
    busy: () => session !== null,
    recognize(opts) {
      if (!Ctor) {
        state.value = 'unavailable';
        return Promise.resolve(null);
      }
      if (session) finish(session, 'aborted');
      const maxMs = Math.max(250, Math.floor(opts.maxMs));
      return new Promise<SttResult | null>((resolve) => {
        const s: Session = {
          rec: null,
          segments: [],
          finished: false,
          continuous: opts.continuous === true,
          pastDeadline: false,
          stopTimer: null,
          graceTimer: null,
          resolve,
        };
        session = s;
        interim.value = '';
        lastError.value = null;
        if (!start(s)) {
          finish(s, 'error');
          return;
        }
        state.value = 'listening';
        s.stopTimer = setTimeout(() => {
          if (s.finished) return;
          // Past the deadline no restart happens (onend checks the flag); ask the engine to flush.
          s.pastDeadline = true;
          safeStop(s.rec, 'stop');
          s.graceTimer = setTimeout(() => finish(s, 'timeout'), STOP_GRACE_MS);
        }, maxMs);
      });
    },
    abort() {
      const s = session;
      if (!s) return;
      safeStop(s.rec, 'abort');
      // Contract: abort → null, even mid-monologue.
      s.segments = [];
      finish(s, 'aborted');
    },
  };
  return service;
}
