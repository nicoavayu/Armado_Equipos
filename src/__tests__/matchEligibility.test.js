import {
  buildMatchLifecycleAudit,
  buildQuieroJugarMatchAudit,
  isMatchOperationallyOpen,
  isMatchUpcoming,
} from '../utils/matchEligibility';

describe('matchEligibility', () => {
  test('considera abierto un partido active futuro con lifecycle pendiente', () => {
    const audit = buildMatchLifecycleAudit({
      matchRow: {
        id: 101,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        survey_status: 'open',
        result_status: 'pending',
        finished_at: null,
        deleted_at: null,
      },
      now: new Date('2030-03-21T20:00:00.000Z'),
    });

    expect(audit.lifecycleEligible).toBe(true);
    expect(isMatchOperationallyOpen(audit.matchRow, { now: new Date('2030-03-21T20:00:00.000Z') })).toBe(true);
    expect(audit.exclusionReasons).toEqual([]);
  });

  test('bloquea partidos cancelados o soft deleted', () => {
    const cancelledAudit = buildMatchLifecycleAudit({
      matchRow: {
        id: 102,
        estado: 'cancelado',
        fecha: '2030-03-21',
        hora: '21:00',
      },
      now: new Date('2030-03-21T18:00:00.000Z'),
    });

    const deletedAudit = buildMatchLifecycleAudit({
      matchRow: {
        id: 103,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        deleted_at: '2030-03-20T21:00:00.000Z',
      },
      now: new Date('2030-03-21T18:00:00.000Z'),
    });

    expect(cancelledAudit.lifecycleEligible).toBe(false);
    expect(cancelledAudit.exclusionReasons).toContain('match_cancelled');
    expect(deletedAudit.lifecycleEligible).toBe(false);
    expect(deletedAudit.exclusionReasons).toContain('match_cancelled');
  });

  test('bloquea partidos active que ya pasaron su horario de inicio', () => {
    const audit = buildMatchLifecycleAudit({
      matchRow: {
        id: 104,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        survey_status: 'open',
        result_status: 'pending',
      },
      now: new Date('2030-03-22T01:00:00.000Z'),
    });

    expect(audit.lifecycleEligible).toBe(false);
    expect(audit.expired).toBe(true);
    expect(audit.exclusionReasons).toContain('match_expired');
  });

  test('bloquea partidos con lifecycle cerrado aunque el estado haya quedado active', () => {
    const finishedAudit = buildMatchLifecycleAudit({
      matchRow: {
        id: 105,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        survey_status: 'open',
        result_status: 'finished',
        finished_at: '2030-03-21T23:00:00.000Z',
      },
      now: new Date('2030-03-21T20:00:00.000Z'),
    });

    const closedSurveyAudit = buildMatchLifecycleAudit({
      matchRow: {
        id: 106,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        survey_status: 'closed',
        result_status: 'pending',
      },
      now: new Date('2030-03-21T20:00:00.000Z'),
    });

    expect(finishedAudit.lifecycleEligible).toBe(false);
    expect(finishedAudit.exclusionReasons).toContain('match_finished');
    expect(closedSurveyAudit.lifecycleEligible).toBe(false);
    expect(closedSurveyAudit.exclusionReasons).toContain('survey_closed');
  });

  test('en Quiero Jugar exige distancia válida cuando el usuario tiene ubicación', () => {
    const noDistanceAudit = buildQuieroJugarMatchAudit({
      matchRow: {
        id: 107,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        falta_jugadores: true,
        survey_status: 'open',
        result_status: 'pending',
      },
      userLocation: { lat: -34.6, lng: -58.4 },
      matchCoordinates: null,
      distanceKm: null,
      maxDistanceKm: 10,
      now: new Date('2030-03-21T19:00:00.000Z'),
    });

    expect(noDistanceAudit.baseEligible).toBe(true);
    expect(noDistanceAudit.includedInList).toBe(false);
    expect(noDistanceAudit.exclusionReasons).toContain('match_distance_unresolvable');
  });

  test('en Quiero Jugar deja pasar solo partidos dentro del radio', () => {
    const farAudit = buildQuieroJugarMatchAudit({
      matchRow: {
        id: 108,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        falta_jugadores: true,
        survey_status: 'open',
        result_status: 'pending',
      },
      userLocation: { lat: -34.6, lng: -58.4 },
      matchCoordinates: { lat: -34.7, lng: -58.5 },
      distanceKm: 15,
      maxDistanceKm: 10,
      now: new Date('2030-03-21T19:00:00.000Z'),
    });

    const nearAudit = buildQuieroJugarMatchAudit({
      matchRow: {
        id: 109,
        estado: 'active',
        fecha: '2030-03-21',
        hora: '21:00',
        falta_jugadores: true,
        survey_status: 'open',
        result_status: 'pending',
      },
      userLocation: { lat: -34.6, lng: -58.4 },
      matchCoordinates: { lat: -34.61, lng: -58.41 },
      distanceKm: 1.4,
      maxDistanceKm: 10,
      now: new Date('2030-03-21T19:00:00.000Z'),
    });

    expect(farAudit.includedInList).toBe(false);
    expect(farAudit.exclusionReasons).toContain('outside_distance_limit');
    expect(nearAudit.includedInList).toBe(true);
    expect(nearAudit.exclusionReasons).toEqual([]);
  });
});

describe('isMatchUpcoming (invite selector future/past cutoff)', () => {
  // Argentina is UTC-3 (no DST). AR local time = UTC - 3h, so a match at 15:00 AR
  // starts at 18:00Z. "now" below is 2026-07-15 15:00 AR (18:00Z).
  const now = new Date('2026-07-15T18:00:00.000Z');
  const upcoming = (fecha, hora) => isMatchUpcoming({ fecha, hora }, { now });

  test('un partido de junio (pasado) no está vigente', () => {
    expect(upcoming('2026-06-10', '20:00')).toBe(false);
  });

  test('un partido de ayer no está vigente', () => {
    expect(upcoming('2026-07-14', '20:00')).toBe(false);
  });

  test('un partido de hoy cuya hora ya pasó (una hora atrás) no está vigente', () => {
    expect(upcoming('2026-07-15', '14:00')).toBe(false);
  });

  test('un partido de hoy cuya hora todavía no llegó (una hora adelante) está vigente', () => {
    expect(upcoming('2026-07-15', '16:00')).toBe(true);
  });

  test('un partido de mañana está vigente', () => {
    expect(upcoming('2026-07-16', '10:00')).toBe(true);
  });

  test('en el instante exacto del kickoff ya NO está vigente (la hora pasó)', () => {
    expect(upcoming('2026-07-15', '15:00')).toBe(false);
  });

  test('un minuto antes del kickoff sigue vigente', () => {
    expect(upcoming('2026-07-15', '15:01')).toBe(true);
  });

  test('respeta el cambio de día: un partido esta misma noche sigue vigente', () => {
    // 23:30 AR de hoy = 02:30Z de mañana, aún futuro respecto de now.
    expect(upcoming('2026-07-15', '23:30')).toBe(true);
  });

  test('fecha inválida/faltante u hora malformada → no vigente (se excluye)', () => {
    expect(upcoming(null, '20:00')).toBe(false);
    expect(upcoming('not-a-date', '20:00')).toBe(false);
    expect(upcoming('2026-07-16', '99:99')).toBe(false);
  });

  test('hora faltante se interpreta como inicio del día (consistente con el resto de la app)', () => {
    // Sin hora, parseDateTimeInTimeZone usa 00:00: un partido de mañana a
    // medianoche sigue siendo futuro; uno de ayer, no.
    expect(upcoming('2026-07-16', null)).toBe(true);
    expect(upcoming('2026-07-14', null)).toBe(false);
  });

  test('usa fecha Y hora reales, no solo la fecha (mismo día, distinta hora)', () => {
    // Mismo día que "now": antes de la hora → fuera; después → dentro. Un filtro
    // que sólo mirara la fecha los trataría igual.
    expect(upcoming('2026-07-15', '12:00')).toBe(false);
    expect(upcoming('2026-07-15', '20:00')).toBe(true);
  });
});
