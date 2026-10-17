/**
 * TSUZUKU — daily-reminder calendar file (group A, design 03 §7, 06 §7 #5).
 *
 * The app sends no notifications. A learner who wants a nudge downloads one
 * neutral `.ics`: a daily VEVENT at their chosen local time whose title is
 * exactly "The dojo is open." No countdown copy, no streak talk. RFC 5545
 * lines end in CRLF and fold at 75 octets.
 */
import { dayToCivil } from '@/shared/time';

export const ICS_SUMMARY = 'The dojo is open.';
export const ICS_DESCRIPTION = 'To be continued. Every day.';
export const ICS_FILENAME = 'tsuzuku-reminder.ics';
const ICS_UID = 'tsuzuku-daily-reminder@tsuzuku.local';
/** Default first occurrence when the caller gives none; a past date is fine for a daily rule. */
const DEFAULT_START = { year: 2026, month: 1, day: 1 } as const;

export interface IcsCivil {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
}

export interface IcsOptions {
  /** Local hour 0–23. */
  hour: number;
  /** Local minute 0–59. */
  minute: number;
  /** IANA zone, e.g. `America/Los_Angeles`. */
  tz: string;
  /** First occurrence (local calendar date). */
  start?: IcsCivil;
  /** First occurrence as an EpochDay (`store.today()`); `start` wins when both are given. */
  startDay?: number;
  /** Event length; default 20 minutes. */
  durationMinutes?: number;
  /** DTSTAMP in ms since epoch; defaults to the start date at 00:00 UTC. */
  stampMs?: number;
  uid?: string;
}

const pad = (n: number, w = 2): string => String(Math.trunc(n)).padStart(w, '0');

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Escapes text per RFC 5545 §3.3.11. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets (UTF-8), continuation lines start with one space. */
export function icsFold(line: string): string[] {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + b > limit) {
      out.push(out.length === 0 ? cur : ` ${cur}`);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(out.length === 0 ? cur : ` ${cur}`);
  return out;
}

function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function resolveStart(o: IcsOptions): IcsCivil {
  if (o.start) return { year: o.start.year, month: clampInt(o.start.month, 1, 12), day: clampInt(o.start.day, 1, 31) };
  if (typeof o.startDay === 'number' && Number.isFinite(o.startDay)) {
    const c = dayToCivil(o.startDay);
    return { year: c.year, month: c.month, day: c.day };
  }
  return { ...DEFAULT_START };
}

/** Builds the full `.ics` text (CRLF line endings). */
export function buildIcs(o: IcsOptions): string {
  const hour = clampInt(o.hour, 0, 23);
  const minute = clampInt(o.minute, 0, 59);
  const start = resolveStart(o);
  const tz = (o.tz || 'UTC').trim() || 'UTC';
  const duration = clampInt(o.durationMinutes ?? 20, 1, 24 * 60);
  const local = `${start.year}${pad(start.month)}${pad(start.day)}T${pad(hour)}${pad(minute)}00`;
  const stamp = utcStamp(o.stampMs ?? Date.UTC(start.year, start.month - 1, start.day));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TSUZUKU//Daily reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:TSUZUKU',
    'BEGIN:VEVENT',
    `UID:${o.uid ?? ICS_UID}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${tz}:${local}`,
    `DURATION:PT${duration}M`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${icsEscape(ICS_SUMMARY)}`,
    `DESCRIPTION:${icsEscape(ICS_DESCRIPTION)}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0M',
    `DESCRIPTION:${icsEscape(ICS_SUMMARY)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.flatMap(icsFold).join('\r\n') + '\r\n';
}

/**
 * Offers the text as a download. Returns `false` where object URLs are not
 * available (jsdom, very old browsers) so the caller can show the text instead.
 */
export function downloadIcs(text: string, filename: string = ICS_FILENAME, doc: Document | null = typeof document !== 'undefined' ? document : null): boolean {
  if (!doc || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  try {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
