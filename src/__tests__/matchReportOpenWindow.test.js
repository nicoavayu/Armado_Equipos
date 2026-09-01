import { supabase } from '../services/api/supabase';
import { openTournamentMatchOperation } from '../features/torneos/api/tournamentWorkspaceService';
import {
  MATCH_OPEN_WINDOW_HOURS,
  describeEarlyOpen,
  isEarlyOpenReasonValid,
  requiresEarlyOpenReason,
} from '../features/torneos/domain/matchSchedule';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

const NOW = Date.parse('2026-08-13T12:00:00Z');
const hoursFromNow = (hours) => new Date(NOW + hours * 60 * 60 * 1000).toISOString();

// El acta se abre directo desde seis horas antes del partido. Más temprano la
// apertura sigue permitida, pero exige dejar registrado por qué se adelanta: el
// backend ya lo contemplaba y la interfaz no ofrecía dónde escribirlo.
describe('ventana de apertura del acta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  describe('cuándo hace falta un motivo', () => {
    test('dentro de la ventana se abre sin explicaciones', () => {
      expect(requiresEarlyOpenReason({ scheduledAt: hoursFromNow(1) }, NOW)).toBe(false);
      expect(requiresEarlyOpenReason({ scheduledAt: hoursFromNow(MATCH_OPEN_WINDOW_HOURS - 0.5) }, NOW)).toBe(false);
      expect(describeEarlyOpen({ scheduledAt: hoursFromNow(2) }, NOW)).toBeNull();
    });

    test('un partido que ya pasó también está dentro de la ventana', () => {
      expect(requiresEarlyOpenReason({ scheduledAt: hoursFromNow(-3) }, NOW)).toBe(false);
    });

    test('fuera de la ventana sí hace falta', () => {
      expect(requiresEarlyOpenReason({ scheduledAt: hoursFromNow(MATCH_OPEN_WINDOW_HOURS + 1) }, NOW)).toBe(true);
      expect(requiresEarlyOpenReason({ scheduledAt: hoursFromNow(72) }, NOW)).toBe(true);
    });

    test('un partido sin horario no dispara la excepción', () => {
      expect(requiresEarlyOpenReason({ scheduledAt: null }, NOW)).toBe(false);
      expect(requiresEarlyOpenReason({}, NOW)).toBe(false);
    });
  });

  describe('cómo se le explica al organizador', () => {
    const copy = describeEarlyOpen({ scheduledAt: hoursFromNow(48) }, NOW);

    test('dice por qué hace falta el motivo, en lenguaje de producto', () => {
      expect(copy.description).toContain(String(MATCH_OPEN_WINDOW_HOURS));
      expect(copy.description).toMatch(/queda registrado/i);
    });

    test('no le muestra términos técnicos', () => {
      const surfaced = [copy.title, copy.description, copy.label, copy.placeholder].join(' ');
      expect(surfaced).not.toMatch(/override/i);
      expect(surfaced).not.toMatch(/backend|rpc|payload|55000|22023/i);
      expect(surfaced).not.toMatch(/TORNEOS_/);
    });
  });

  describe('validación del motivo', () => {
    test('vacío o demasiado corto no habilita la apertura', () => {
      expect(isEarlyOpenReasonValid('')).toBe(false);
      expect(isEarlyOpenReasonValid('   ')).toBe(false);
      expect(isEarlyOpenReasonValid('ab')).toBe(false);
    });

    test('un motivo real la habilita', () => {
      expect(isEarlyOpenReasonValid('Se adelantó el partido por lluvia anunciada')).toBe(true);
    });
  });

  describe('contrato con el backend', () => {
    test('dentro de la ventana no se inventa un motivo', async () => {
      await openTournamentMatchOperation({ organizationId: 'org-a', matchId: 'match-a' });
      const [, payload] = supabase.rpc.mock.calls[0];
      expect(payload.p_override_reason).toBeNull();
    });

    test('fuera de la ventana el motivo escrito viaja tal cual', async () => {
      await openTournamentMatchOperation({
        organizationId: 'org-a',
        matchId: 'match-a',
        overrideReason: 'Se adelantó el partido por lluvia anunciada',
      });
      const [name, payload] = supabase.rpc.mock.calls[0];
      expect(name).toBe('open_tournament_match_operation');
      expect(payload.p_override_reason).toBe('Se adelantó el partido por lluvia anunciada');
    });
  });
});

// El otro rechazo del mismo botón. El organizador abre el acta de un partido que
// ya está cerrado —algo que hace naturalmente, porque el botón está ahí— y hasta
// esta corrección recibía un 500 con `55000`. Ahora es un 400 y la pantalla
// explica que el resultado ya es oficial y cuál es el camino para corregirlo.
describe('abrir el acta de un partido ya oficializado', () => {
  // Así responde PostgREST después de la corrección: clase 22, no clase 55.
  const alreadyOfficial = {
    data: null,
    error: {
      code: '22023',
      message: 'TORNEOS_MATCH_ALREADY_OFFICIAL',
      details: null,
      hint: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue(alreadyOfficial);
  });

  const openAndCatch = async () => {
    try {
      await openTournamentMatchOperation({ organizationId: 'org-a', matchId: 'match-a' });
    } catch (error) {
      return error;
    }
    throw new Error('se esperaba que la apertura fallara');
  };

  test('la pantalla explica que el acta ya fue oficializada', async () => {
    const error = await openAndCatch();
    expect(error.message).toMatch(/ya tiene un resultado oficial/i);
    expect(error.message).toMatch(/corrección/i);
  });

  test('no cae en el mensaje genérico de fallo', async () => {
    const error = await openAndCatch();
    expect(error.message).not.toBe('No pudimos abrir el acta.');
    expect(error.code).toBe('TORNEOS_MATCH_ALREADY_OFFICIAL');
  });

  test('no le muestra nada técnico al organizador', async () => {
    const { message } = await openAndCatch();
    expect(message).not.toMatch(/TORNEOS_/);
    expect(message).not.toMatch(/55000|22023|SQLSTATE/i);
    expect(message).not.toMatch(/rpc|postgrest|supabase|internal server error/i);
    expect(message).not.toMatch(/open_tournament_match_operation/);
    // Ningún UUID: ni el de la organización ni el del partido.
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(message).not.toMatch(/\bat\b.*\.js:\d+/);
  });

  test('el error original queda disponible para diagnóstico sin llegar a la pantalla', async () => {
    const error = await openAndCatch();
    expect(error.cause).toMatchObject({ code: '22023' });
    expect(String(error.cause.code).slice(0, 2)).not.toBe('55');
  });
});
