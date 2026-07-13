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

describe('parseWhatsAppMatchText — numbered/bulleted roster lists', () => {
  const REPORTED = [
    '21hs vs Defe en Geba',
    '1- Eze',
    '2- Nacho O.',
    '3-Nico',
    '4-sergio',
    '5- Nacho v.',
    '6- nico 🙌',
    '7 - Tomi Walter',
    '8-gabi',
    '9- Fabi',
    '10- Tomi',
  ].join('\n');

  test('parses the exact reported list into ten confirmed players', () => {
    const draft = parseWhatsAppMatchText(REPORTED, { now: '2026-07-10T12:00:00-03:00' });

    expect(draft.hora).toBe('21:00');
    expect(draft.sede.toUpperCase()).toBe('GEBA');
    expect(draft.confirmedPlayers).toEqual([
      'Eze', 'Nacho O.', 'Nico', 'sergio', 'Nacho v.', 'nico', 'Tomi Walter', 'gabi', 'Fabi', 'Tomi',
    ]);
    expect(draft.confirmedPlayers).toHaveLength(10);
  });

  test('keeps the two Nicos and the two Tomis as distinct people', () => {
    const draft = parseWhatsAppMatchText(REPORTED, { now: '2026-07-10T12:00:00-03:00' });
    expect(draft.confirmedPlayers.filter((name) => /^nico$/i.test(name))).toHaveLength(2);
    expect(draft.confirmedPlayers.filter((name) => /^tomi/i.test(name))).toEqual(['Tomi Walter', 'Tomi']);
  });

  test('strips the decorative emoji from the normalized name', () => {
    const draft = parseWhatsAppMatchText(REPORTED, { now: '2026-07-10T12:00:00-03:00' });
    expect(draft.confirmedPlayers).toContain('nico');
    draft.confirmedPlayers.forEach((name) => expect(name).not.toMatch(/🙌/));
  });

  test('does not take the header, "Defe" or "Geba" as players', () => {
    const draft = parseWhatsAppMatchText(REPORTED, { now: '2026-07-10T12:00:00-03:00' });
    expect(draft.confirmedPlayers).not.toContain('Defe');
    expect(draft.confirmedPlayers).not.toContain('Geba');
    expect(draft.confirmedPlayers.some((name) => /vs Defe/i.test(name))).toBe(false);
    // "21hs" is match data, never player number 21.
    expect(draft.confirmedPlayers.some((name) => /21/.test(name))).toBe(false);
  });

  test('no longer warns that it found no confirmed players', () => {
    const draft = parseWhatsAppMatchText(REPORTED, { now: '2026-07-10T12:00:00-03:00' });
    expect(draft.warnings.some((warning) => /jugadores confirmados/i.test(warning))).toBe(false);
  });

  test('handles dashes with/without spaces, dots, parentheses, colons and accents', () => {
    const draft = parseWhatsAppMatchText(
      ['1- Juan', '2 - José Pérez', '3.María', '4. Ana', '5) Luis', '6: Pedro'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Juan', 'José Pérez', 'María', 'Ana', 'Luis', 'Pedro']);
  });

  test('understands keycap emoji digits (1️⃣ 2️⃣ 3️⃣)', () => {
    const draft = parseWhatsAppMatchText(
      ['1️⃣ Eze', '2️⃣ Nacho', '3️⃣ Nico'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Eze', 'Nacho', 'Nico']);
  });

  test('reads a bullet list as a roster', () => {
    const draft = parseWhatsAppMatchText(
      ['Confirmados:', '- Eze', '• Nacho', '* Nico'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Eze', 'Nacho', 'Nico']);
  });

  test('does not treat a normal conversation (or a lone bullet) as a roster', () => {
    const draft = parseWhatsAppMatchText(
      ['Che, ¿jugamos el jueves?', '- sí dale', 'Nico: voy'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Nico']);
  });

  test('extracts the roster out of a list mixed with chat messages', () => {
    const draft = parseWhatsAppMatchText(
      [
        'Buenas, armamos para el jueves 21hs en River',
        'Anoto a los que van:',
        '1- Eze',
        '2- Nacho',
        '3- Nico',
        'Seba: buenísimo',
      ].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Eze', 'Nacho', 'Nico']);
    expect(draft.confirmedPlayers.some((name) => /anoto|van|buenisimo/i.test(name))).toBe(false);
  });

  test('routes ✅ ❌ ❓ status glyphs to the right bucket', () => {
    const draft = parseWhatsAppMatchText(
      ['1- Eze ✅', '2- Nacho ❌', '3- Nico ❓', '4- Juan'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Eze', 'Juan']);
    expect(draft.declinedPlayers).toContain('Nacho');
    expect(draft.doubtfulPlayers).toContain('Nico');
  });

  test('collapses exact duplicate lines but keeps the sequence', () => {
    const draft = parseWhatsAppMatchText(
      ['1- Eze', '2- Nacho', '2- Nacho', '3- Nico'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Eze', 'Nacho', 'Nico']);
  });

  test('never turns times or phone numbers into players', () => {
    const draft = parseWhatsAppMatchText(
      ['1- 21:00', '2- 1155667788', '3- Eze', '4- Nacho', '5- Nico'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.confirmedPlayers).toEqual(['Eze', 'Nacho', 'Nico']);
  });

  test('uses the deterministic roster as a fallback when the analyzer finds nobody', () => {
    // No conversational keywords at all: only the numbered list carries players.
    const draft = parseWhatsAppMatchText(
      ['Jueves 22hs en El Galpón, F7', '1- Eze', '2- Nacho', '3- Nico', '4- Fabi'].join('\n'),
      { now: '2026-07-10T12:00:00-03:00' },
    );
    expect(draft.hora).toBe('22:00');
    expect(draft.confirmedPlayers).toEqual(['Eze', 'Nacho', 'Nico', 'Fabi']);
    expect(draft.warnings.some((warning) => /jugadores confirmados/i.test(warning))).toBe(false);
  });

  test('merges conversational confirmations with the roster without dropping look-alikes', () => {
    const draft = parseWhatsAppMatchText(
      [
        '[10/7/26, 20:00:00] Seba: Voy',
        'Anotados:',
        '1- Eze',
        '2- Nacho',
        '3- Seba',
      ].join('\n'),
      { now: '2026-07-10T21:00:00-03:00' },
    );
    // Seba (conversational) comes first, roster fills the rest; Seba isn't duplicated.
    expect(draft.confirmedPlayers).toEqual(['Seba', 'Eze', 'Nacho']);
  });
});
