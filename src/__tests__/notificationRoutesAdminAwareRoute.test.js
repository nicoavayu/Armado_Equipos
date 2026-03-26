const {
  resolveAdminAwareMatchRoute,
  resolveAdminAwareNotificationRoute,
} = require('../utils/notificationRoutes');

const createSupabaseMock = ({ createdBy = null, error = null } = {}) => ({
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        maybeSingle: jest.fn(async () => ({
          data: createdBy ? { creado_por: createdBy } : null,
          error,
        })),
      })),
    })),
  })),
});

describe('resolveAdminAwareMatchRoute', () => {
  test('returns admin route for match admin even when notification link is public', async () => {
    const matchId = 901;
    const userId = 'admin-user-1';
    const supabaseMock = createSupabaseMock({ createdBy: userId });

    const route = await resolveAdminAwareMatchRoute({
      notification: {
        type: 'match_update',
        data: {
          match_id: matchId,
          link: `/partido-publico/${matchId}`,
        },
      },
      supabaseClient: supabaseMock,
      userId,
    });

    expect(route).toBe(`/admin/${matchId}`);
  });

  test('keeps public route when current user is not match admin', async () => {
    const matchId = 902;
    const supabaseMock = createSupabaseMock({ createdBy: 'another-user' });

    const route = await resolveAdminAwareMatchRoute({
      notification: {
        type: 'match_update',
        data: {
          match_id: matchId,
          link: `/partido-publico/${matchId}`,
        },
      },
      supabaseClient: supabaseMock,
      userId: 'player-user-1',
    });

    expect(route).toBe(`/partido-publico/${matchId}`);
  });

  test('uses explicit admin_link when present', async () => {
    const matchId = 903;

    const route = await resolveAdminAwareMatchRoute({
      notification: {
        type: 'match_update',
        data: {
          match_id: matchId,
          link: `/partido-publico/${matchId}`,
          admin_link: `/admin/${matchId}?tab=jugadores`,
        },
      },
      supabaseClient: null,
      userId: null,
    });

    expect(route).toBe(`/admin/${matchId}?tab=jugadores`);
  });
});

describe('resolveAdminAwareNotificationRoute', () => {
  test('resolves admin route for match_player_joined push payloads', async () => {
    const matchId = 904;
    const userId = 'admin-user-2';
    const supabaseMock = createSupabaseMock({ createdBy: userId });

    const route = await resolveAdminAwareNotificationRoute({
      notification: {
        type: 'match_player_joined',
        data: {
          match_id: matchId,
          link: `/partido-publico/${matchId}`,
        },
      },
      fallbackRoute: `/partido-publico/${matchId}`,
      supabaseClient: supabaseMock,
      userId,
    });

    expect(route).toBe(`/admin/${matchId}`);
  });

  test('keeps fallback route for non admin-aware notification types', async () => {
    const route = await resolveAdminAwareNotificationRoute({
      notification: {
        type: 'call_to_vote',
        data: {
          match_id: 905,
        },
      },
      fallbackRoute: '/votar-equipos?partidoId=905',
      supabaseClient: null,
      userId: null,
    });

    expect(route).toBe('/votar-equipos?partidoId=905');
  });
});
