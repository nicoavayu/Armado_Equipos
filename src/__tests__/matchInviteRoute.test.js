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

  test('falls back to invite route without code when payload has only match id', () => {
    const route = resolveMatchInviteRoute({
      partido_id: 355,
      data: {
        matchId: 355,
      },
    });

    expect(route).toBe('/partido/355/invitacion');
  });

  test('routes request_join invites to public join flow', () => {
    const route = resolveMatchInviteRoute({
      partido_id: 412,
      data: {
        invite_mode: 'request_join',
      },
    });

    expect(route).toBe('/partido-publico/412');
  });

  test('accepts explicit partido-publico deep links for invite notifications', () => {
    const route = resolveMatchInviteRoute({
      data: {
        link: '/partido-publico/222',
      },
    });

    expect(route).toBe('/partido-publico/222');
  });
});
