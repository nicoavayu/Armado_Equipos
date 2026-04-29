jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

describe('buildActivityFeed awards + ordering', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-12T18:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('includes award_won notifications in recent activity', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-award-1',
        type: 'award_won',
        read: false,
        created_at: '2026-03-12T17:55:00.000Z',
        partido_id: 501,
        data: {
          match_id: '501',
          match_name: 'Mi Partido',
          award_type: 'mvp',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('awards_ready');
    expect(items[0].route).toBe('/resultados-encuesta/501?showAwards=1');
    expect(items[0].title.toLowerCase()).toContain('ganaste un premio');
  });

  test('muestra survey_results_ready con copy de resultados de encuesta', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-results-1',
        type: 'survey_results_ready',
        read: false,
        created_at: '2026-03-12T17:56:00.000Z',
        partido_id: 502,
        data: {
          match_id: '502',
          match_name: 'Partido con resultados',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('survey_results_ready');
    expect(items[0].title).toBe('Ya están listos los resultados de la encuesta para el partido "Partido con resultados"');
    expect(items[0].route).toBe('/resultados-encuesta/502');
  });

  test('incluye survey_finished usando el mismo card de resultados', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-finished-1',
        type: 'survey_finished',
        read: false,
        created_at: '2026-03-12T17:57:00.000Z',
        partido_id: 503,
        data: {
          match_id: '503',
          match_name: 'Desafío cerrado',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('survey_results_ready');
    expect(items[0].route).toBe('/resultados-encuesta/503');
  });

  test('keeps unread notifications first in activity feed', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-vote-1',
        type: 'call_to_vote',
        read: false,
        created_at: '2026-03-12T17:59:00.000Z',
        partido_id: 777,
        data: {
          match_name: 'Nocturno',
        },
      },
    ], {
      activeMatches: [
        {
          id: 777,
          nombre: 'Nocturno',
          fecha: '2026-03-12',
          hora: '22:00',
          sede: 'Cancha Norte',
          cupo_jugadores: 10,
          creado_por: 'admin-1',
          jugadores: [{ count: 10 }],
        },
      ],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].type).toBe('call_to_vote');
  });
});
