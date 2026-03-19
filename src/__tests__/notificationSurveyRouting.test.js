jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const {
  buildNotificationFallbackRoute,
  extractNotificationMatchId,
} = require('../utils/notificationRoutes');
const {
  openNotification,
  resolveNotificationActionability,
  resolveSurveyNotificationNavigation,
  resolveSurveyNotificationRoute,
  stripShowAwardsParam,
} = require('../utils/notificationRouter');

const createSupabaseMock = ({
  partidoRow = null,
  teamMatchRow = null,
  rosterRows = [],
} = {}) => ({
  from: jest.fn((table) => {
    if (table === 'partidos') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({
              data: partidoRow,
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === 'team_matches') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({
              data: teamMatchRow,
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === 'jugadores') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            not: jest.fn(async () => ({
              data: rosterRows,
              error: null,
            })),
          })),
        })),
      };
    }

    throw new Error(`Unexpected table lookup: ${table}`);
  }),
});

describe('survey notification routing', () => {
  test('stripShowAwardsParam elimina showAwards sin romper el resto del query', () => {
    expect(stripShowAwardsParam('/resultados-encuesta/90?showAwards=1&foo=bar')).toBe('/resultados-encuesta/90?foo=bar');
    expect(stripShowAwardsParam('/resultados-encuesta/90?foo=bar&showAwards=1')).toBe('/resultados-encuesta/90?foo=bar');
    expect(stripShowAwardsParam('/resultados-encuesta/90?showAwards=1')).toBe('/resultados-encuesta/90');
  });

  test('prefers partido_id over team_match_id for survey notifications', () => {
    const notification = {
      type: 'survey_reminder',
      partido_id: 321,
      data: {
        team_match_id: 'tm-999',
      },
    };

    expect(extractNotificationMatchId(notification)).toBe(321);
  });

  test('keeps team_match_id priority for non-survey notifications', () => {
    const notification = {
      type: 'challenge_squad_open',
      partido_id: 321,
      data: {
        team_match_id: 'tm-999',
      },
    };

    expect(extractNotificationMatchId(notification)).toBe('tm-999');
  });

  test('never resolves invite links as survey destination', () => {
    const notification = {
      type: 'survey_reminder',
      partido_id: 654,
      data: {
        link: '/partido/654/invitacion?codigo=ABC',
      },
    };

    expect(resolveSurveyNotificationRoute(notification)).toBe('/encuesta/654');
  });

  test('accepts canonical survey link when present', () => {
    const notification = {
      type: 'survey_start',
      partido_id: 111,
      data: {
        link: '/encuesta/111',
      },
    };

    expect(resolveSurveyNotificationRoute(notification)).toBe('/encuesta/111');
  });

  test('normalizes legacy survey link to canonical route', () => {
    const notification = {
      type: 'survey_start',
      partido_id: 222,
      data: {
        link: '/partidos/222/encuesta?from=notif',
      },
    };

    expect(resolveSurveyNotificationRoute(notification)).toBe('/encuesta/222?from=notif');
  });

  test('keeps survey notifications on survey fallback route', () => {
    const notification = {
      type: 'survey',
      partido_id: 333,
      data: {
        matchId: 333,
      },
    };

    expect(buildNotificationFallbackRoute(notification)).toBe('/encuesta/333');
  });

  test('allows active survey notifications to navigate to the survey route', async () => {
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 444,
        fecha: '2025-01-01',
        hora: '20:00',
        estado: 'pendiente',
        survey_status: 'open',
        survey_closes_at: '2030-01-02T20:00:00.000Z',
        result_status: 'pending',
        finished_at: null,
      },
      rosterRows: [{ usuario_id: 'user-1' }],
    });

    const result = await resolveSurveyNotificationNavigation({
      notification: {
        type: 'survey_start',
        partido_id: 444,
        data: {
          link: '/encuesta/444',
          survey_deadline_at: '2030-01-02T20:00:00.000Z',
        },
      },
      supabaseClient: supabaseMock,
      userId: 'user-1',
    });

    expect(result).toEqual({
      canNavigate: true,
      route: '/encuesta/444',
      reason: 'ok',
      message: '',
    });
  });

  test('allows navigation when survey is still open even if match is finalizado', async () => {
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 446,
        fecha: '2025-01-01',
        hora: '20:00',
        estado: 'finalizado',
        survey_status: 'open',
        survey_closes_at: '2030-01-02T20:00:00.000Z',
        result_status: 'pending',
        finished_at: '2025-01-01T23:30:00.000Z',
      },
      rosterRows: [{ usuario_id: 'user-1' }],
    });

    const result = await resolveSurveyNotificationNavigation({
      notification: {
        type: 'survey_reminder',
        partido_id: 446,
        data: {
          link: '/encuesta/446',
        },
      },
      supabaseClient: supabaseMock,
      userId: 'user-1',
    });

    expect(result).toEqual({
      canNavigate: true,
      route: '/encuesta/446',
      reason: 'ok',
      message: '',
    });
  });

  test('blocks finalized survey reminders instead of navigating elsewhere', async () => {
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 555,
        fecha: '2025-01-01',
        hora: '20:00',
        estado: 'finalizado',
        survey_status: 'closed',
        survey_closes_at: '2025-01-02T20:00:00.000Z',
        result_status: 'finished',
        finished_at: '2025-01-02T20:00:00.000Z',
      },
      rosterRows: [{ usuario_id: 'user-1' }],
    });

    const result = await resolveSurveyNotificationNavigation({
      notification: {
        type: 'survey_reminder_12h',
        partido_id: 555,
        data: {
          link: '/encuesta/555',
        },
      },
      supabaseClient: supabaseMock,
      userId: 'user-1',
    });

    expect(result.canNavigate).toBe(false);
    expect(result.route).toBeNull();
    expect(result.reason).toBe('survey_closed');
  });

  test('survey_results_ready navega sin forzar showAwards aunque venga en link legacy', async () => {
    const navigate = jest.fn();
    await openNotification({
      type: 'survey_results_ready',
      partido_id: 700,
      data: {
        resultsUrl: '/resultados-encuesta/700?showAwards=1&from=legacy',
      },
    }, navigate);

    expect(navigate).toHaveBeenCalledWith('/resultados-encuesta/700?from=legacy');
  });

  test('awards_ready mantiene navegación forzada a premiación', async () => {
    const navigate = jest.fn();
    await openNotification({
      type: 'awards_ready',
      partido_id: 701,
      data: {
        resultsUrl: '/resultados-encuesta/701',
      },
    }, navigate);

    expect(navigate).toHaveBeenCalledWith(
      '/resultados-encuesta/701?showAwards=1',
      expect.objectContaining({
        state: expect.objectContaining({
          forceAwards: true,
        }),
      }),
    );
  });

  test('bloquea notificaciones operativas cuando el partido ya está finalizado', async () => {
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 810,
        fecha: '2025-01-01',
        hora: '20:00',
        estado: 'finalizado',
        result_status: 'finished',
        finished_at: '2025-01-01T22:30:00.000Z',
      },
    });

    const result = await resolveNotificationActionability({
      notification: {
        type: 'match_update',
        partido_id: 810,
      },
      supabaseClient: supabaseMock,
      nowMs: Date.parse('2025-01-02T12:00:00.000Z'),
    });

    expect(result.isActionable).toBe(false);
    expect(result.reason).toBe('match_finished');
  });

  test('bloquea notificaciones operativas viejas aunque el estado quedó pendiente', async () => {
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 811,
        fecha: '2025-01-01',
        hora: '20:00',
        estado: 'pendiente',
        result_status: 'pending',
        finished_at: null,
      },
    });

    const result = await resolveNotificationActionability({
      notification: {
        type: 'match_join_request',
        partido_id: 811,
      },
      supabaseClient: supabaseMock,
      nowMs: Date.parse('2025-01-02T12:00:00.000Z'),
    });

    expect(result.isActionable).toBe(false);
    expect(result.reason).toBe('operational_window_expired');
  });

  test('mantiene accionables notificaciones operativas de partido futuro o en curso', async () => {
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 812,
        fecha: '2030-01-10',
        hora: '21:00',
        estado: 'pendiente',
        result_status: 'pending',
        finished_at: null,
      },
    });

    const result = await resolveNotificationActionability({
      notification: {
        type: 'match_join_request',
        partido_id: 812,
      },
      supabaseClient: supabaseMock,
      nowMs: Date.parse('2030-01-10T18:00:00.000Z'),
    });

    expect(result.isActionable).toBe(true);
    expect(result.reason).toBe('ok');
  });

  test('awards_ready sigue siendo consultable aunque el partido esté finalizado', async () => {
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 813,
        fecha: '2025-01-01',
        hora: '20:00',
        estado: 'finalizado',
        result_status: 'finished',
        finished_at: '2025-01-01T22:30:00.000Z',
      },
    });

    const result = await resolveNotificationActionability({
      notification: {
        type: 'awards_ready',
        partido_id: 813,
      },
      supabaseClient: supabaseMock,
      nowMs: Date.parse('2025-01-02T12:00:00.000Z'),
    });

    expect(result.isActionable).toBe(true);
    expect(result.reason).toBe('consultable_notification');
  });

  test('openNotification no navega en notificación operativa expirada', async () => {
    const navigate = jest.fn();
    const onActionBlocked = jest.fn();
    const supabaseMock = createSupabaseMock({
      partidoRow: {
        id: 814,
        fecha: '2025-01-01',
        hora: '20:00',
        estado: 'finalizado',
        result_status: 'finished',
        finished_at: '2025-01-01T22:30:00.000Z',
      },
    });

    await openNotification({
      id: 'notif-814',
      type: 'match_join_request',
      partido_id: 814,
      data: {},
    }, navigate, {
      supabaseClient: supabaseMock,
      onActionBlocked,
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(onActionBlocked).toHaveBeenCalledWith(expect.objectContaining({
      isActionable: false,
      reason: 'match_finished',
    }));
  });
});
