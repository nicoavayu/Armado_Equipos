import { parseWhatsAppMatchText } from '../utils/whatsappMatchParser';

describe('parseWhatsAppMatchText', () => {
  test('extracts the core match data from a natural group message', () => {
    const draft = parseWhatsAppMatchText(
      'Gente, jueves 22:00 en La Terraza. F7, sale 10 lucas por persona.\nConfirmados: Nico, Pato y Fede.\nEn duda: Seba.',
      { now: '2026-07-10T12:00:00-03:00' },
    );

    expect(draft.fecha).toBe('2026-07-16');
    expect(draft.hora).toBe('22:00');
    expect(draft.sede).toBe('La Terraza');
    expect(draft.modalidad).toBe('F7');
    expect(draft.precioPorPersona).toBe(10000);
    expect(draft.confirmedPlayers).toEqual(['Nico', 'Pato', 'Fede']);
    expect(draft.doubtfulPlayers).toEqual(['Seba']);
  });

  test('understands exported WhatsApp speaker status lines', () => {
    const draft = parseWhatsAppMatchText(
      '[10/7/26, 12:10:00] Nico: Voy\n[10/7/26, 12:11:00] Juan: No puedo\n[10/7/26, 12:12:00] Pedro: En duda\nMañana a las 9 en El Poli, fútbol 5.',
      { now: '2026-07-10T12:00:00-03:00' },
    );

    expect(draft.fecha).toBe('2026-07-11');
    expect(draft.hora).toBe('21:00');
    expect(draft.modalidad).toBe('F5');
    expect(draft.confirmedPlayers).toEqual(['Nico']);
    expect(draft.doubtfulPlayers).toEqual(['Pedro']);
    expect(draft.declinedPlayers).toEqual(['Juan']);
  });

  test('detects venue on exported lines and skips status lines as venues', () => {
    const draft = parseWhatsAppMatchText(
      '[10/7/26, 12:10:00] Pedro: En duda\nMañana a las 9 en El Poli, fútbol 5.',
      { now: '2026-07-10T12:00:00-03:00' },
    );

    expect(draft.sede).toBe('El Poli');
  });

  test('resolves hoy and same-day weekday references', () => {
    const hoy = parseWhatsAppMatchText('Juega hoy a las 22:00 en La Nube', {
      now: '2026-07-10T12:00:00-03:00',
    });
    expect(hoy.fecha).toBe('2026-07-10');

    // 2026-07-10 is a Friday: "viernes" written on a Friday means today.
    const viernes = parseWhatsAppMatchText('Viernes 21hs en La Nube', {
      now: '2026-07-10T12:00:00-03:00',
    });
    expect(viernes.fecha).toBe('2026-07-10');
    expect(viernes.hora).toBe('21:00');
  });

  test('parses numeric dates rolling to the next occurrence', () => {
    const draft = parseWhatsAppMatchText('Jugamos el 12/8 a las 20:00', {
      now: '2026-07-10T12:00:00-03:00',
    });
    expect(draft.fecha).toBe('2026-08-12');
    expect(draft.hora).toBe('20:00');
  });

  test('understands day-period qualifiers and am/pm', () => {
    const now = { now: '2026-07-10T12:00:00-03:00' };
    expect(parseWhatsAppMatchText('Mañana a las 9 de la noche', now).hora).toBe('21:00');
    expect(parseWhatsAppMatchText('Mañana a las 9 de la mañana', now).hora).toBe('09:00');
    expect(parseWhatsAppMatchText('Mañana a las 10 am', now).hora).toBe('10:00');
    expect(parseWhatsAppMatchText('Mañana 22 hs', now).hora).toBe('22:00');
  });

  test('parses common price formats', () => {
    const now = { now: '2026-07-10T12:00:00-03:00' };
    expect(parseWhatsAppMatchText('Sale $9.500 por persona', now).precioPorPersona).toBe(9500);
    expect(parseWhatsAppMatchText('Sale 10k cada uno', now).precioPorPersona).toBe(10000);
    expect(parseWhatsAppMatchText('Sale 8 lucas', now).precioPorPersona).toBe(8000);
  });

  test('does not turn "somos 10" into a player named 10', () => {
    const draft = parseWhatsAppMatchText('Juan: somos 10', {
      now: '2026-07-10T12:00:00-03:00',
    });
    expect(draft.confirmedPlayers).toEqual([]);
  });

  test('a later drop-out wins over an earlier confirmation', () => {
    const draft = parseWhatsAppMatchText(
      '[10/7/26, 12:10:00] Nico: Voy\n[10/7/26, 13:00:00] Nico: Me bajo',
      { now: '2026-07-10T14:00:00-03:00' },
    );

    expect(draft.confirmedPlayers).toEqual([]);
    expect(draft.declinedPlayers).toEqual(['Nico']);
  });

  test('handles Android-style exports without brackets', () => {
    const draft = parseWhatsAppMatchText(
      '10/7/26, 12:10 - Nico: Voy\n10/7/26, 12:11 - Confirmados: Pato y Fede',
      { now: '2026-07-10T12:00:00-03:00' },
    );

    expect(draft.confirmedPlayers).toEqual(['Nico', 'Pato', 'Fede']);
    // Export timestamps must not leak into the match date/time.
    expect(draft.fecha).toBe('');
    expect(draft.hora).toBe('');
  });

  test('flags the assumed format as a warning', () => {
    const draft = parseWhatsAppMatchText('Mañana a las 21:00 en El Bajo', {
      now: '2026-07-10T12:00:00-03:00',
    });
    expect(draft.modalidad).toBe('F5');
    expect(draft.warnings).toEqual(expect.arrayContaining([
      'No encontramos el formato; asumimos F5.',
    ]));
  });

  test('keeps uncertain fields editable instead of inventing them', () => {
    const draft = parseWhatsAppMatchText('Somos: Nico, Fede y Juan', {
      now: '2026-07-10T12:00:00-03:00',
    });

    expect(draft.fecha).toBe('');
    expect(draft.hora).toBe('');
    expect(draft.sede).toBe('');
    expect(draft.warnings).toEqual(expect.arrayContaining([
      'No encontramos una fecha clara.',
      'No encontramos un horario claro.',
      'No encontramos una cancha o lugar claro.',
    ]));
  });
});
