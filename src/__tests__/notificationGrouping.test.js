import { groupNotificationsByMatch } from '../utils/notificationGrouping';

describe('groupNotificationsByMatch', () => {
  it('agrupa notificaciones del mismo partido y conserva la mas reciente', () => {
    const result = groupNotificationsByMatch([
      { id: '1', type: 'call_to_vote', created_at: '2026-02-19T10:00:00.000Z', read: false, data: { matchId: 10 } },
      { id: '2', type: 'survey_reminder', created_at: '2026-02-19T11:00:00.000Z', read: true, partido_id: 10 },
      { id: '3', type: 'survey_results_ready', created_at: '2026-02-19T12:00:00.000Z', read: false, data: { match_id: 20 } },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].matchId).toBe('20');
    expect(result[0].latest.id).toBe('3');
    expect(result[0].count).toBe(1);
    expect(result[1].matchId).toBe('10');
    expect(result[1].latest.id).toBe('2');
    expect(result[1].count).toBe(2);
    expect(result[1].unreadCount).toBe(1);
  });

  it('mantiene notificaciones sin partido como entradas individuales', () => {
    const result = groupNotificationsByMatch([
      { id: 'a', type: 'friend_request', created_at: '2026-02-19T10:00:00.000Z', read: false, data: { requestId: 1 } },
      { id: 'b', type: 'friend_request', created_at: '2026-02-19T11:00:00.000Z', read: false, data: { requestId: 2 } },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].matchId).toBeNull();
    expect(result[0].count).toBe(1);
    expect(result[1].matchId).toBeNull();
    expect(result[1].count).toBe(1);
  });

  it('agrupa resultados y premios aunque el partido venga solo en la ruta', () => {
    const result = groupNotificationsByMatch([
      {
        id: 'results',
        type: 'survey_results_ready',
        created_at: '2026-02-19T12:00:00.000Z',
        read: false,
        data: { resultsUrl: '/resultados-encuesta/503' },
      },
      {
        id: 'awards',
        type: 'awards_ready',
        created_at: '2026-02-19T12:01:00.000Z',
        read: false,
        data: { action_url: '/resultados-encuesta/503?showAwards=1' },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].matchId).toBe('503');
    expect(result[0].latest.id).toBe('awards');
    expect(result[0].count).toBe(2);
  });

  it('oculta notificaciones de encuesta de desafios antes de agrupar', () => {
    const result = groupNotificationsByMatch([
      {
        id: 'challenge-survey',
        type: 'survey_start',
        created_at: '2026-02-19T12:00:00.000Z',
        read: false,
        partido_id: 700,
        data: { match_name: 'Desafío: FULBO 5A vs FULBO 5B' },
      },
      {
        id: 'challenge-award',
        type: 'award_won',
        created_at: '2026-02-19T12:01:00.000Z',
        read: false,
        data: {
          team_match_id: 'tm-700',
          action_url: '/resultados-encuesta/700?showAwards=1',
        },
      },
      {
        id: 'friendly-survey',
        type: 'survey_start',
        created_at: '2026-02-19T12:02:00.000Z',
        read: false,
        partido_id: 701,
        data: { match_name: 'Amistoso FULBO 5A vs FULBO 5B' },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].latest.id).toBe('friendly-survey');
    expect(result[0].count).toBe(1);
  });
});
