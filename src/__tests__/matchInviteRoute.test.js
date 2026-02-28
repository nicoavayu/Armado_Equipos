import { resolveMatchInviteRoute } from '../utils/matchInviteRoute';

describe('matchInviteRoute', () => {
  test('builds invite route when match code is present', () => {
    const route = resolveMatchInviteRoute({
      partido_id: 355,
      data: {
        matchCode: 'ABC123',
      },
    });

    expect(route).toBe('/partido/355/invitacion?codigo=ABC123');
  });

  test('accepts explicit invite deep link only when it includes code', () => {
    const route = resolveMatchInviteRoute({
      data: {
        link: '/partido/355/invitacion?codigo=XYZ999',
      },
    });

    expect(route).toBe('/partido/355/invitacion?codigo=XYZ999');
  });

  test('returns null when invite has no code', () => {
    const route = resolveMatchInviteRoute({
      partido_id: 355,
      data: {
        matchId: 355,
      },
    });

    expect(route).toBeNull();
  });
});
