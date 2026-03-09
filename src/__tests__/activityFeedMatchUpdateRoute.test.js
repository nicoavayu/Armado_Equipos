jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

describe('buildActivityFeed match_update routing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('prefers admin route for match_player_joined when current user is match admin', async () => {
    const matchId = 501;
    const adminUserId = 'user-admin-1';

    const items = await buildActivityFeed([
      {
        id: 'notif-join-1',
        type: 'match_update',
        read: false,
        created_at: '2026-03-08T11:55:00.000Z',
        data: {
          match_id: matchId,
          player_name: 'Ricci',
          link: `/partido-publico/${matchId}`,
        },
        message: 'Ricci se sumó al partido.',
      },
    ], {
      activeMatches: [
        {
          id: matchId,
          nombre: 'Futbol martes',
          fecha: '2026-03-10',
          hora: '22:00',
          sede: 'Ateneo Felix Marino',
          creado_por: adminUserId,
          cupo_jugadores: 12,
          jugadores: [{ count: 11 }],
        },
      ],
      currentUserId: adminUserId,
      supabaseClient: null,
    });

    const joinedItem = items.find((item) => item.type === 'match_player_joined');
    expect(joinedItem).toBeTruthy();
    expect(joinedItem.route).toBe(`/admin/${matchId}`);
  });

  test('keeps public route for match_player_joined when current user is not admin', async () => {
    const matchId = 502;

    const items = await buildActivityFeed([
      {
        id: 'notif-join-2',
        type: 'match_update',
        read: false,
        created_at: '2026-03-08T11:55:00.000Z',
        data: {
          match_id: matchId,
          player_name: 'Ricci',
          link: `/partido-publico/${matchId}`,
        },
        message: 'Ricci se sumó al partido.',
      },
    ], {
      activeMatches: [
        {
          id: matchId,
          nombre: 'Futbol martes',
          fecha: '2026-03-10',
          hora: '22:00',
          sede: 'Ateneo Felix Marino',
          creado_por: 'another-user',
          cupo_jugadores: 12,
          jugadores: [{ count: 11 }],
        },
      ],
      currentUserId: 'user-player-1',
      supabaseClient: null,
    });

    const joinedItem = items.find((item) => item.type === 'match_player_joined');
    expect(joinedItem).toBeTruthy();
    expect(joinedItem.route).toBe(`/partido-publico/${matchId}`);
  });
});
