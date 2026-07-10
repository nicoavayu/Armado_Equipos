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
