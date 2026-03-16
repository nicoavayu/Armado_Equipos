import {
  buildGoogleCalendarUrl,
  buildMatchCalendarIcs,
  DEFAULT_MATCH_DURATION_MIN,
} from '../utils/calendarInvite';

describe('calendarInvite', () => {
  test('builds an ics file with default duration and safe filename', () => {
    const { content, fileName } = buildMatchCalendarIcs({
      id: 77,
      nombre: 'Partido Premium',
      fecha: '2026-03-21',
      hora: '22:00',
      sede: 'Ateneo, CABA, Argentina',
    });

    expect(fileName).toBe('arma2-partido-20260321-2200.ics');
    expect(content).toContain('BEGIN:VCALENDAR');
    expect(content).toContain('SUMMARY:Partido Premium');
    expect(content).toContain('LOCATION:Ateneo');
    expect(content).toContain('DTSTART:20260321T220000');
    expect(content).toContain('DTEND:20260321T233000');
    expect(DEFAULT_MATCH_DURATION_MIN).toBe(90);
  });

  test('escapes special characters in description fields', () => {
    const { content } = buildMatchCalendarIcs({
      id: 88,
      nombre: 'Partido, Semi;Final',
      fecha: '2026-03-11',
      hora: '20:30',
      sede: 'Cancha \\ Norte',
    });

    expect(content).toContain('SUMMARY:Partido\\, Semi\\;Final');
    expect(content).toContain('LOCATION:Cancha \\\\ Norte');
  });

  test('builds a Google Calendar URL with prefilled match data', () => {
    const url = new URL(buildGoogleCalendarUrl({
      id: 77,
      nombre: 'Partido Premium',
      fecha: '2026-03-21',
      hora: '22:00',
      sede: 'Ateneo, CABA, Argentina',
    }));

    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.pathname).toBe('/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Partido Premium');
    expect(url.searchParams.get('location')).toBe('Ateneo');
    expect(url.searchParams.get('details')).toContain('Fecha: 2026-03-21');
    expect(url.searchParams.get('dates')).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  });
});
