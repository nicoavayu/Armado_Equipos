import {
  buildNotificationFallbackRoute,
  buildTeamChallengeRoute,
  extractNotificationMatchId,
  isTeamChallengeNotification,
} from '../utils/notificationRoutes';

describe('notificationRoutes', () => {
  test('extracts match id from supported payload fields', () => {
    expect(extractNotificationMatchId({ data: { matchId: 123 } })).toBe(123);
    expect(extractNotificationMatchId({ data: { match_id: 456 } })).toBe(456);
    expect(extractNotificationMatchId({ data: { team_match_id: 'tm-1' } })).toBe('tm-1');
    expect(extractNotificationMatchId({ partido_id: 789 })).toBe(789);
    expect(extractNotificationMatchId({ match_ref: '111' })).toBe('111');
  });

  test('builds fallback route to match when id exists', () => {
    const route = buildNotificationFallbackRoute({ data: { matchId: 42 } });
    expect(route).toBe('/partido-publico/42');
  });

  test('builds fallback route to activity feed when id is missing', () => {
    const route = buildNotificationFallbackRoute({});
    expect(route).toBe('/quiero-jugar');
  });

  test('builds fallback route to desafios for team notifications without ids', () => {
    const route = buildNotificationFallbackRoute({ type: 'team_invite' });
    expect(route).toBe('/desafios');
  });

  test('builds fallback route to team detail for captain transfer with team id', () => {
    const route = buildNotificationFallbackRoute({ type: 'team_captain_transfer', data: { teamId: 55 } });
    expect(route).toBe('/desafios/equipos/55');
  });

  test('detects team challenge notifications from match_update source payload', () => {
    const notification = {
      type: 'match_update',
      title: 'Desafío aceptado!',
      data: { source: 'team_challenge', challenge_id: 100, team_match_id: 999 },
    };
    expect(isTeamChallengeNotification(notification)).toBe(true);
    expect(buildTeamChallengeRoute(notification)).toBe('/desafios/equipos/partidos/999');
  });

  test('builds fallback route to desafios for team challenge notifications without team match id', () => {
    const notification = {
      type: 'match_update',
      title: 'Desafío aceptado!',
      data: { source: 'team_challenge', challenge_id: 321 },
    };
    expect(buildNotificationFallbackRoute(notification)).toBe('/desafios');
  });
});
