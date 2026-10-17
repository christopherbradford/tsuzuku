import { ICS_FILENAME, ICS_SUMMARY, buildIcs, downloadIcs, icsEscape, icsFold } from './ics';

const base = { hour: 7, minute: 30, tz: 'America/Los_Angeles', start: { year: 2026, month: 1, day: 15 } };

function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
}

describe('buildIcs', () => {
  it('is a VCALENDAR with one daily VEVENT', () => {
    const lines = unfold(buildIcs(base));
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('END:VEVENT');
    expect(lines).toContain('RRULE:FREQ=DAILY');
  });

  it('summary is exactly "The dojo is open." and carries no countdown copy', () => {
    const ics = buildIcs(base);
    expect(ICS_SUMMARY).toBe('The dojo is open.');
    expect(unfold(ics)).toContain('SUMMARY:The dojo is open.');
    expect(ics).not.toMatch(/streak|hurry|left|remaining/i);
  });

  it('uses CRLF line endings everywhere and no bare LF', () => {
    const ics = buildIcs(base);
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
  });

  it('DTSTART is local time in the given zone at the chosen hour and minute', () => {
    const lines = unfold(buildIcs(base));
    expect(lines).toContain('DTSTART;TZID=America/Los_Angeles:20260115T073000');
    expect(lines.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith('UID:'))).toBe(true);
  });

  it('clamps hour and minute and defaults the zone', () => {
    const lines = unfold(buildIcs({ hour: 27, minute: -5, tz: '', start: { year: 2026, month: 2, day: 1 } }));
    expect(lines).toContain('DTSTART;TZID=UTC:20260201T230000');
  });

  it('accepts an EpochDay start (store.today())', () => {
    // EpochDay 0 is 1970-01-01 at the 04:00 boundary.
    const lines = unfold(buildIcs({ hour: 6, minute: 0, tz: 'Asia/Tokyo', startDay: 0 }));
    expect(lines).toContain('DTSTART;TZID=Asia/Tokyo:19700101T060000');
  });

  it('folds long lines at 75 octets with a leading space', () => {
    const long = 'DESCRIPTION:' + 'あ'.repeat(60);
    const folded = icsFold(long);
    expect(folded.length).toBeGreaterThan(1);
    for (const l of folded) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    for (const l of folded.slice(1)) expect(l.startsWith(' ')).toBe(true);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long);
  });

  it('escapes text per RFC 5545', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
});

describe('downloadIcs', () => {
  it('returns false where object URLs are unavailable (jsdom) instead of throwing', () => {
    const had = 'createObjectURL' in URL;
    if (had) {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined });
    }
    expect(downloadIcs(buildIcs(base))).toBe(false);
  });

  it('clicks a temporary anchor with the .ics filename when object URLs exist', () => {
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(downloadIcs(buildIcs(base))).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(ICS_FILENAME).toMatch(/\.ics$/);
    click.mockRestore();
  });
});
