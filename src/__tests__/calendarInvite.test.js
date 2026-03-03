import { buildMatchCalendarIcs, DEFAULT_MATCH_DURATION_MIN } from '../utils/calendarInvite';

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
});
