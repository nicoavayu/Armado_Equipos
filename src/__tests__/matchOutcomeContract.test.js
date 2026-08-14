import { supabase } from '../services/api/supabase';
import { setTournamentMatchOutcome } from '../features/torneos/api/tournamentWorkspaceService';
import {
  describeMatchOutcomeGap,
  normalizeMatchOutcome,
  outcomeRequiresSuspensionDetail,
} from '../features/torneos/domain/matchOutcome';

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

// El formulario del acta guarda el minuto de suspensión en el estado del
// componente aunque el campo sólo se muestre para "Suspendido". Antes de esta
// corrección ese valor viajaba como cadena vacía y el backend, que espera un
// `smallint`, rechazaba el caso por defecto —"Jugado"— con `22P02`.
describe('estado deportivo del acta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  describe('qué estados necesitan el detalle de suspensión', () => {
    test('sólo un partido suspendido lo exige', () => {
      expect(outcomeRequiresSuspensionDetail('suspended')).toBe(true);
      ['played', 'abandoned', 'postponed_before_start', 'cancelled', 'not_played',
        'home_no_show', 'away_no_show', 'double_no_show', 'walkover_home',
        'walkover_away', 'administrative_result'].forEach((outcomeType) => {
        expect(outcomeRequiresSuspensionDetail(outcomeType)).toBe(false);
      });
    });
  });

  describe('normalización antes de llegar al backend', () => {
    test('el caso por defecto no manda cadenas vacías donde se espera un número', () => {
      const normalized = normalizeMatchOutcome({
        outcomeType: 'played',
        reasonText: '',
        suspensionMinute: '',
        suspensionPeriod: 'second_half',
        countsForStandings: true,
        countsForPlayerStats: true,
        requiresResolution: false,
        eventsRemainValid: true,
      });
      expect(normalized.suspensionMinute).toBeNull();
      expect(normalized.suspensionPeriod).toBeNull();
      expect(normalized.reasonText).toBeNull();
      expect(normalized.outcomeType).toBe('played');
    });

    test('un partido suspendido conserva minuto, período y motivo', () => {
      const normalized = normalizeMatchOutcome({
        outcomeType: 'suspended',
        reasonText: '  Tormenta  ',
        suspensionMinute: '63',
        suspensionPeriod: 'second_half',
        countsForStandings: false,
        countsForPlayerStats: false,
        requiresResolution: true,
      });
      expect(normalized.suspensionMinute).toBe(63);
      expect(normalized.suspensionPeriod).toBe('second_half');
      expect(normalized.reasonText).toBe('Tormenta');
      expect(normalized.requiresResolution).toBe(true);
    });

    test('un minuto que no es un entero no viaja como texto', () => {
      expect(normalizeMatchOutcome({ outcomeType: 'suspended', suspensionMinute: 'x' }).suspensionMinute)
        .toBeNull();
      expect(normalizeMatchOutcome({ outcomeType: 'suspended', suspensionMinute: '12.5' }).suspensionMinute)
        .toBeNull();
    });

    test('cambiar de suspendido a jugado descarta el detalle que ya no aplica', () => {
      const normalized = normalizeMatchOutcome({
        outcomeType: 'played',
        suspensionMinute: 45,
        suspensionPeriod: 'first_half',
      });
      expect(normalized.suspensionMinute).toBeNull();
      expect(normalized.suspensionPeriod).toBeNull();
    });
  });

  describe('lo que se explica antes de guardar', () => {
    test('el caso por defecto no tiene nada pendiente', () => {
      expect(describeMatchOutcomeGap({ outcomeType: 'played' })).toBeNull();
    });

    test('un partido suspendido incompleto se explica en lenguaje de producto', () => {
      const gap = describeMatchOutcomeGap({ outcomeType: 'suspended', suspensionPeriod: 'second_half' });
      expect(gap).toMatch(/suspendido/i);
      expect(gap).toMatch(/minuto/i);
      expect(gap).toMatch(/motivo/i);
      expect(gap).not.toMatch(/smallint|null|22P02|outcome/i);
    });

    test('un partido suspendido completo puede guardarse', () => {
      expect(describeMatchOutcomeGap({
        outcomeType: 'suspended',
        suspensionMinute: 63,
        suspensionPeriod: 'second_half',
        reasonText: 'Tormenta',
      })).toBeNull();
    });
  });

  describe('contrato con el backend', () => {
    test('guardar "Jugado" manda null, no cadena vacía', async () => {
      await setTournamentMatchOutcome({
        organizationId: 'org-a',
        operationId: 'operation-a',
        outcome: {
          outcomeType: 'played',
          reasonText: '',
          suspensionMinute: '',
          suspensionPeriod: 'second_half',
          countsForStandings: true,
          countsForPlayerStats: true,
          requiresResolution: false,
          eventsRemainValid: true,
        },
      });
      const [, payload] = supabase.rpc.mock.calls[0];
      expect(payload.p_outcome.suspensionMinute).toBeNull();
      expect(payload.p_outcome.suspensionPeriod).toBeNull();
      expect(Object.values(payload.p_outcome)).not.toContain('');
    });

    test('el payload no acepta campos ajenos al contrato', async () => {
      await setTournamentMatchOutcome({
        organizationId: 'org-a',
        operationId: 'operation-a',
        outcome: { outcomeType: 'played', resolvedBy: 'forged-user', matchId: 'forged-match' },
      });
      const [, payload] = supabase.rpc.mock.calls[0];
      expect(payload.p_outcome).not.toHaveProperty('resolvedBy');
      expect(payload.p_outcome).not.toHaveProperty('matchId');
    });
  });
});
