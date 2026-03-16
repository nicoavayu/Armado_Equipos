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

  test('builds canonical survey route for survey-form notifications', () => {
    const route = buildNotificationFallbackRoute({
      type: 'survey_reminder_12h',
      partido_id: 812,
      data: { matchId: 812 },
    });

    expect(route).toBe('/encuesta/812');
  });

  test('builds fallback route to activity feed when id is missing', () => {
    const route = buildNotificationFallbackRoute({});
    expect(route).toBe('/quiero-jugar');
  });

  test('builds fallback route to amigos for friend notifications', () => {
    expect(buildNotificationFallbackRoute({ type: 'friend_request' })).toBe('/amigos?tab=discover');
    expect(buildNotificationFallbackRoute({ type: 'friend_accepted' })).toBe('/amigos');
  });

  test('builds fallback invite route for match invites with code', () => {
    const route = buildNotificationFallbackRoute({
      type: 'match_invite',
      partido_id: 355,
      data: {
        matchCode: 'ABC123',
      },
    });

    expect(route).toBe('/partido/355/invitacion?codigo=ABC123');
  });

  test('builds fallback public join route for request-join match invites', () => {
    const route = buildNotificationFallbackRoute({
      type: 'match_invite',
      partido_id: 412,
      data: {
        invite_mode: 'request_join',
      },
    });

    expect(route).toBe('/partido-publico/412');
  });

  test('builds voting route with code for call_to_vote notifications', () => {
    const route = buildNotificationFallbackRoute({
      type: 'call_to_vote',
      data: {
        matchCode: 'QT97MX',
      },
    });

    expect(route).toBe('/votar-equipos?codigo=QT97MX');
  });

  test('builds voting route with partido id when call_to_vote has no code', () => {
    const route = buildNotificationFallbackRoute({
      type: 'call_to_vote',
      data: {
        matchId: 398,
      },
    });

    expect(route).toBe('/votar-equipos?partidoId=398');
  });

  test('builds fallback route to mis equipos for team invites', () => {
    const route = buildNotificationFallbackRoute({ type: 'team_invite' });
    expect(route).toBe('/desafios?tab=mis-equipos');
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

  test('routes challenge squad notifications to team match detail when id exists', () => {
    const notification = {
      type: 'challenge_squad_open',
      data: { challenge_id: 'abc-1', team_match_id: 'tm-55' },
    };

    expect(isTeamChallengeNotification(notification)).toBe(true);
    expect(buildNotificationFallbackRoute(notification)).toBe('/desafios/equipos/partidos/tm-55');
  });
});
