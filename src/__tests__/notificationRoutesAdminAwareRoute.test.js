const { resolveAdminAwareMatchRoute } = require('../utils/notificationRoutes');

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
